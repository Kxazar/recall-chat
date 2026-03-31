from __future__ import annotations

import asyncio
from typing import Any

from opengradient import LLM
from opengradient.types import TEE_LLM, x402SettlementMode
from web3 import Web3
from x402.mechanisms.evm.constants import PERMIT2_ADDRESS

from .settings import AppConfig

BASE_SEPOLIA_RPC = "https://sepolia.base.org"
BASE_OPG_ADDRESS = "0x240b09731D96979f50B2C649C9CE10FcF9C7987F"
SUPPORTED_MODELS = {model.value for model in TEE_LLM}
SETTLEMENT_MODES = {mode.value: mode for mode in x402SettlementMode}
ERC20_BALANCE_ABI = [
    {
        "inputs": [{"name": "owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
        ],
        "name": "allowance",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]


def normalize_private_key(private_key: str) -> str:
    if not private_key:
        raise ValueError("OG_PRIVATE_KEY is missing.")

    return private_key if private_key.startswith("0x") else f"0x{private_key}"


def normalize_messages(raw_messages: Any) -> list[dict[str, str]]:
    if not isinstance(raw_messages, list):
        raise ValueError("OpenGradient chat expects 'messages' to be an array.")

    messages: list[dict[str, str]] = []

    for item in raw_messages:
        if not isinstance(item, dict):
            continue

        role = str(item.get("role") or "user").strip().lower()
        content = item.get("content")

        if not isinstance(content, str):
            continue

        content = content.strip()

        if not content:
            continue

        if role not in {"system", "user", "assistant"}:
            role = "user"

        messages.append({"role": role, "content": content})

    if not messages:
        raise ValueError("OpenGradient chat payload must include at least one non-empty message.")

    return messages


def extract_content(raw_content: Any) -> str:
    if isinstance(raw_content, str):
        return raw_content

    if isinstance(raw_content, list):
        parts: list[str] = []

        for item in raw_content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())

        return "\n".join(parts).strip()

    return ""


def build_client(config: AppConfig) -> LLM:
    return LLM(
        private_key=normalize_private_key(config.open_gradient_key),
        rpc_url=config.rpc_url,
        tee_registry_address=config.tee_registry_address,
    )


async def chat(config: AppConfig, messages: list[dict[str, str]]) -> dict[str, Any]:
    if config.model not in SUPPORTED_MODELS:
        supported = ", ".join(sorted(SUPPORTED_MODELS))
        raise ValueError(f"Unsupported OG_MODEL '{config.model}'. Supported models: {supported}")

    settlement_mode = SETTLEMENT_MODES.get(config.settlement_type)

    if settlement_mode is None:
        supported = ", ".join(sorted(SETTLEMENT_MODES.keys()))
        raise ValueError(f"Unsupported OG_SETTLEMENT_TYPE '{config.settlement_type}'. Supported values: {supported}")

    client: LLM | None = None

    try:
        client = build_client(config)
        result = await client.chat(
            model=TEE_LLM(config.model),
            messages=normalize_messages(messages),
            max_tokens=config.max_tokens,
            x402_settlement_mode=settlement_mode,
        )

        chat_output = result.chat_output or {}
        content = extract_content(chat_output.get("content"))

        if not content:
            raise RuntimeError(
                f"OpenGradient returned an empty assistant message for model '{config.model}'. "
                "Try anthropic/claude-haiku-4-5 or google/gemini-2.5-flash."
            )

        return {
            "content": content,
            "raw": chat_output,
            "usage": None,
            "model": config.model,
            "settlementType": config.settlement_type,
            "finishReason": result.finish_reason,
            "teeEndpoint": result.tee_endpoint,
            "teeTimestamp": result.tee_timestamp,
            "teeId": result.tee_id,
            "teePaymentAddress": result.tee_payment_address,
        }
    finally:
        if client is not None:
            await client.close()


def ensure_approval(config: AppConfig, min_allowance: float = 1.0, approve_amount: float | None = None) -> dict[str, Any]:
    client: LLM | None = None

    try:
        client = build_client(config)
        result = client.ensure_opg_approval(min_allowance=min_allowance, approve_amount=approve_amount)
        return {
            "minAllowance": min_allowance,
            "approveAmount": approve_amount,
            "allowanceBefore": str(result.allowance_before),
            "allowanceAfter": str(result.allowance_after),
            "txHash": result.tx_hash,
        }
    finally:
        if client is not None:
            asyncio.run(client.close())


def get_wallet_status(config: AppConfig) -> dict[str, Any]:
    client: LLM | None = None

    try:
        client = build_client(config)
        wallet_address = client._wallet_account.address
        base_sepolia = Web3(Web3.HTTPProvider(BASE_SEPOLIA_RPC))
        owner = Web3.to_checksum_address(wallet_address)
        spender = Web3.to_checksum_address(PERMIT2_ADDRESS)
        opg_token = base_sepolia.eth.contract(
            address=Web3.to_checksum_address(BASE_OPG_ADDRESS),
            abi=ERC20_BALANCE_ABI,
        )

        eth_balance = base_sepolia.from_wei(base_sepolia.eth.get_balance(owner), "ether")
        opg_balance = opg_token.functions.balanceOf(owner).call() / 10**18
        permit2_allowance = opg_token.functions.allowance(owner, spender).call() / 10**18

        return {
            "ok": True,
            "address": wallet_address,
            "ethBalance": f"{eth_balance:.18f}".rstrip("0").rstrip("."),
            "opgBalance": f"{opg_balance:.18f}".rstrip("0").rstrip("."),
            "permit2Allowance": f"{permit2_allowance:.18f}".rstrip("0").rstrip("."),
        }
    finally:
        if client is not None:
            asyncio.run(client.close())


def format_payment_error(error_message: str, wallet_status: dict[str, Any] | None) -> str:
    if not wallet_status:
        return error_message

    opg_balance = float(wallet_status.get("opgBalance") or 0)
    eth_balance = float(wallet_status.get("ethBalance") or 0)
    permit2_allowance = float(wallet_status.get("permit2Allowance") or 0)

    if opg_balance < 0.1:
        return (
            f"OpenGradient payment failed because wallet {wallet_status['address']} only has "
            f"{wallet_status['opgBalance']} OPG. Top up more OPG from the faucet, then try again."
        )

    if permit2_allowance < 0.1:
        return (
            f"OpenGradient payment failed because Permit2 allowance is only "
            f"{wallet_status['permit2Allowance']} OPG. Run npm.cmd run og:approve -- 1, then try again."
        )

    if eth_balance < 0.001:
        return (
            f"OpenGradient payment failed because wallet {wallet_status['address']} is low on Base Sepolia ETH "
            f"({wallet_status['ethBalance']}). Add more gas and try again."
        )

    return (
        f"{error_message} Wallet diagnostics: {wallet_status['opgBalance']} OPG, "
        f"{wallet_status['ethBalance']} ETH, allowance {wallet_status['permit2Allowance']} OPG."
    )
