from __future__ import annotations

import asyncio
import uuid

from flask import Flask, jsonify, redirect, request

from vercel_api.opengradient_runtime import chat as og_chat
from vercel_api.opengradient_runtime import format_payment_error, get_wallet_status
from vercel_api.server_state import build_system_prompt, config, memory_store, normalize_history

app = Flask(__name__)


@app.get("/")
def home_route():
    return redirect("/index.html", code=302)


@app.get("/api/config")
def config_route():
    wallet_status = get_wallet_status(config) if config.open_gradient_key else None
    return jsonify(
        {
            "model": config.model,
            "settlementType": config.settlement_type,
            "openGradientRuntime": "python-sdk",
            "pythonExecutable": "vercel-python-runtime",
            "endpointStrategy": "registry-discovery",
            "hasOpenGradientKey": bool(config.open_gradient_key),
            "walletStatus": wallet_status,
            "hasSupabase": memory_store.is_configured(),
            "memoryUserId": memory_store.get_user_id(),
        }
    )


@app.get("/api/profile")
def profile_route():
    if not memory_store.is_configured():
        return jsonify(
            {
                "enabled": False,
                "user_bio": "",
                "stats": None,
                "insights": [],
                "recent_memories": [],
            }
        )

    try:
        profile = memory_store.get_profile()
        return jsonify({"enabled": True, **profile})
    except Exception as error:
        return jsonify({"error": str(error)}), 502


@app.post("/api/chat")
def chat_route():
    if not config.open_gradient_key:
        return (
            jsonify(
                {
                    "error": "OG_PRIVATE_KEY is not configured yet. Add it to your Vercel environment before sending chat requests."
                }
            ),
            500,
        )

    body = request.get_json(silent=True) or {}
    message = body.get("message", "").strip() if isinstance(body.get("message"), str) else ""
    thread_id = body.get("threadId", "").strip() if isinstance(body.get("threadId"), str) else ""
    history = normalize_history(body.get("history"))

    if not message:
        return jsonify({"error": "Message is required."}), 400

    if not thread_id:
        thread_id = str(uuid.uuid4())

    memory_search_result = None
    memory_status = "disabled"

    if memory_store.is_configured():
        try:
            memory_search_result = memory_store.search(message)
            memory_status = "ok"
        except Exception as error:
            memory_status = str(error)

    messages = [
        {"role": "system", "content": build_system_prompt(memory_search_result)},
        *history,
        {"role": "user", "content": message},
    ]

    try:
        result = asyncio.run(og_chat(config, messages))

        if memory_store.is_configured():
            try:
                memory_store.store_conversation(
                    thread_id,
                    [
                        {"role": "user", "content": message},
                        {"role": "assistant", "content": result["content"]},
                    ],
                )
            except Exception as error:
                if memory_status == "ok":
                    memory_status = str(error)

        return jsonify(
            {
                "threadId": thread_id,
                "answer": result["content"],
                "usage": result.get("usage"),
                "model": result.get("model", config.model),
                "settlementType": result.get("settlementType", config.settlement_type),
                "memoryStatus": memory_status,
                "userBio": memory_search_result.get("user_bio", "") if memory_search_result else "",
                "stats": memory_search_result.get("stats") if memory_search_result else None,
                "insights": memory_search_result.get("insights", []) if memory_search_result else [],
                "memories": memory_search_result.get("memories", []) if memory_search_result else [],
            }
        )
    except Exception as error:
        error_message = str(error) or "OpenGradient request failed."

        if "402 Payment Required" in error_message:
            wallet_status = get_wallet_status(config)
            return (
                jsonify(
                    {
                        "error": format_payment_error(error_message, wallet_status),
                        "walletStatus": wallet_status,
                    }
                ),
                402,
            )

        return jsonify({"error": error_message}), 502


@app.get("/api/health")
def health_route():
    return jsonify(
        {
            "ok": True,
            "model": config.model,
            "settlementType": config.settlement_type,
        }
    )
