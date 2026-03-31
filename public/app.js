const tabButtons = [...document.querySelectorAll(".tab-trigger")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];
const promptChips = [...document.querySelectorAll(".prompt-chip")];

const chatLog = document.getElementById("chatLog");
const composer = document.getElementById("composer");
const promptInput = document.getElementById("promptInput");
const composerNote = document.getElementById("composerNote");
const sendButton = document.getElementById("sendButton");
const threadChip = document.getElementById("threadChip");
const modelValue = document.getElementById("modelValue");
const settlementValue = document.getElementById("settlementValue");
const walletStatus = document.getElementById("walletStatus");
const memoryStatus = document.getElementById("memoryStatus");
const walletBadgeValue = document.getElementById("walletBadgeValue");
const runtimeValue = document.getElementById("runtimeValue");
const setupHint = document.getElementById("setupHint");
const readinessTitle = document.getElementById("readinessTitle");
const statusStack = document.getElementById("statusStack");
const overviewMetrics = document.getElementById("overviewMetrics");
const userBio = document.getElementById("userBio");
const insightsList = document.getElementById("insightsList");
const memoryList = document.getElementById("memoryList");
const railMemoryPreview = document.getElementById("railMemoryPreview");
const studioDetails = document.getElementById("studioDetails");
const launchChecklist = document.getElementById("launchChecklist");
const endpointList = document.getElementById("endpointList");
const studioModeTag = document.getElementById("studioModeTag");

const storedThreadId = window.localStorage.getItem("gradient-recall-thread") || "";
const state = {
  threadId: storedThreadId,
  history: [],
  ready: false,
  activeTab: "overview",
  config: null,
  profile: null
};

function formatBalance(value, digits = 4) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : value || "n/a";
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "No activity yet";
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getWalletMeta() {
  const wallet = state.config?.walletStatus || null;
  const opgBalance = Number(wallet?.opgBalance);
  const ethBalance = Number(wallet?.ethBalance);
  const allowance = Number(wallet?.permit2Allowance);

  return {
    wallet,
    opgBalance,
    ethBalance,
    allowance,
    hasHealthyOpg: Number.isFinite(opgBalance) && opgBalance >= 0.1,
    hasHealthyEth: Number.isFinite(ethBalance) && ethBalance >= 0.001,
    hasAllowance: Number.isFinite(allowance) && allowance >= 0.1
  };
}

function getProfileStats() {
  return state.profile?.stats || null;
}

function setActiveTab(tabId) {
  state.activeTab = tabId;

  for (const button of tabButtons) {
    const isActive = button.dataset.tab === tabId;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }

  for (const panel of tabPanels) {
    const isActive = panel.dataset.panel === tabId;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  }
}

function renderThread() {
  threadChip.textContent = `Thread: ${state.threadId || "new session"}`;
}

function setBusy(isBusy) {
  promptInput.disabled = isBusy || !state.ready;
  sendButton.disabled = isBusy || !state.ready;
  composerNote.textContent = isBusy ? "OpenGradient is generating a verified response..." : "Ready for the next move.";
}

function appendMessage(role, content) {
  const article = document.createElement("article");
  article.className = `message message-${role}`;

  const roleLabel = document.createElement("p");
  roleLabel.className = "message-role";
  roleLabel.textContent = role;

  const body = document.createElement("p");
  body.textContent = content;

  article.append(roleLabel, body);
  chatLog.append(article);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderStatusStack() {
  const walletMeta = getWalletMeta();
  const profileStats = getProfileStats();
  const tiles = [
    {
      label: "Wallet diagnostics",
      value: walletMeta.wallet
        ? `${formatBalance(walletMeta.wallet.opgBalance)} OPG / ${formatBalance(walletMeta.wallet.ethBalance, 3)} ETH`
        : "Waiting for wallet state"
    },
    {
      label: "Cloud recall",
      value: state.config?.hasSupabase
        ? `${profileStats?.storedMessages || 0} stored turns across ${profileStats?.threadsSeen || 0} threads`
        : "Supabase not configured"
    },
    {
      label: "Vercel route shape",
      value: "Static shell + /api/config, /api/profile, /api/chat, /api/health"
    }
  ];

  statusStack.innerHTML = tiles
    .map(
      (tile) => `
        <article class="status-tile">
          <span>${tile.label}</span>
          <strong>${tile.value}</strong>
        </article>
      `
    )
    .join("");
}

function renderOverviewMetrics() {
  const walletMeta = getWalletMeta();
  const profileStats = getProfileStats();
  const metrics = [
    {
      label: "Stored turns",
      value: `${profileStats?.storedMessages || 0}`,
      note: "Saved in Supabase for recall"
    },
    {
      label: "Threads",
      value: `${profileStats?.threadsSeen || 0}`,
      note: "Conversation groups remembered"
    },
    {
      label: "Permit2",
      value: `${formatBalance(walletMeta.wallet?.permit2Allowance || 0)} OPG`,
      note: "Current allowance headroom"
    },
    {
      label: "Latest memory",
      value: profileStats?.latestActivity ? formatTimestamp(profileStats.latestActivity) : "No activity yet",
      note: profileStats?.latestUserNote || "No recent user note"
    }
  ];

  overviewMetrics.innerHTML = metrics
    .map(
      (metric) => `
        <article class="metric-card">
          <span>${metric.label}</span>
          <strong>${metric.value}</strong>
          <p>${metric.note}</p>
        </article>
      `
    )
    .join("");
}

function renderInsights() {
  const insights = state.profile?.insights || [];

  if (!insights.length) {
    insightsList.innerHTML = '<article class="insight-pill">No profile insights available yet.</article>';
    return;
  }

  insightsList.innerHTML = insights
    .map((insight) => `<article class="insight-pill">${typeof insight === "string" ? insight : JSON.stringify(insight)}</article>`)
    .join("");
}

function renderMemories(memories = []) {
  if (!memories.length) {
    memoryList.innerHTML = '<article class="memory-item">No recalled memory yet. Send a few prompts and this atlas will begin to fill in.</article>';
    railMemoryPreview.innerHTML = '<article class="mini-memory">Memory preview is waiting for the first successful recall.</article>';
    return;
  }

  memoryList.innerHTML = memories
    .map(
      (memory) => `
        <article class="memory-item">
          <div class="memory-head">
            <span>${memory.role || "memory"}</span>
            <strong>${memory.score ? `score ${memory.score}` : formatTimestamp(memory.created_at)}</strong>
          </div>
          <p>${memory.memory || memory.content || ""}</p>
        </article>
      `
    )
    .join("");

  railMemoryPreview.innerHTML = memories
    .slice(0, 3)
    .map(
      (memory) => `
        <article class="mini-memory">
          <strong>${memory.role || "memory"}</strong>
          <p>${memory.memory || memory.content || ""}</p>
        </article>
      `
    )
    .join("");
}

function renderStudioDetails() {
  const walletMeta = getWalletMeta();
  const details = [
    `Model lane: ${state.config?.model || "unknown"}`,
    `Settlement mode: ${state.config?.settlementType || "unknown"}`,
    `Endpoint strategy: ${state.config?.endpointStrategy || "unknown"}`,
    walletMeta.wallet
      ? `Wallet: ${formatBalance(walletMeta.wallet.opgBalance)} OPG / ${formatBalance(walletMeta.wallet.ethBalance, 3)} ETH`
      : "Wallet diagnostics pending",
    state.profile?.stats?.latestUserNote
      ? `Latest note: ${state.profile.stats.latestUserNote}`
      : "Latest note: none yet"
  ];

  studioDetails.innerHTML = details.map((item) => `<li>${item}</li>`).join("");
  studioModeTag.textContent = state.ready ? "Studio armed" : "Awaiting env";
}

function renderLaunch() {
  const walletMeta = getWalletMeta();
  const checks = [
    {
      title: "OpenGradient key",
      status: state.config?.hasOpenGradientKey,
      note: state.config?.hasOpenGradientKey ? "Private key is available to the backend." : "Add OG_PRIVATE_KEY in env."
    },
    {
      title: "Supabase memory",
      status: state.config?.hasSupabase,
      note: state.config?.hasSupabase ? "Cloud memory routes are online." : "Add SUPABASE_URL and a server-side key."
    },
    {
      title: "Wallet funded",
      status: walletMeta.hasHealthyOpg && walletMeta.hasHealthyEth,
      note: walletMeta.wallet
        ? `${formatBalance(walletMeta.wallet.opgBalance)} OPG / ${formatBalance(walletMeta.wallet.ethBalance, 3)} ETH`
        : "Wallet status unavailable"
    },
    {
      title: "Permit2 allowance",
      status: walletMeta.hasAllowance,
      note: walletMeta.wallet ? `${formatBalance(walletMeta.wallet.permit2Allowance)} OPG approved` : "Allowance unavailable"
    },
    {
      title: "Vercel API surface",
      status: true,
      note: "Python functions mirror the same /api contract as local dev."
    }
  ];

  launchChecklist.innerHTML = checks
    .map(
      (check) => `
        <article class="check-card ${check.status ? "is-good" : "is-warn"}">
          <div class="check-state">${check.status ? "Ready" : "Needs attention"}</div>
          <strong>${check.title}</strong>
          <p>${check.note}</p>
        </article>
      `
    )
    .join("");

  const routes = [
    { method: "GET", path: "/api/config", note: "Runtime, wallet, and deployment posture" },
    { method: "GET", path: "/api/profile", note: "Memory summary, stats, and recent turns" },
    { method: "POST", path: "/api/chat", note: "Memory-augmented verified inference" },
    { method: "GET", path: "/api/health", note: "Minimal deployment heartbeat" }
  ];

  endpointList.innerHTML = routes
    .map(
      (route) => `
        <article class="endpoint-card">
          <div class="endpoint-head">
            <span>${route.method}</span>
            <strong>${route.path}</strong>
          </div>
          <p>${route.note}</p>
        </article>
      `
    )
    .join("");
}

function renderReadinessNarrative() {
  const walletMeta = getWalletMeta();
  const profileStats = getProfileStats();

  if (!state.config?.hasOpenGradientKey) {
    readinessTitle.textContent = "Waiting for credentials";
    setupHint.textContent = "Add OG_PRIVATE_KEY to your environment, then refresh. The studio and launch checklist will unlock once the backend can sign OpenGradient requests.";
    return;
  }

  if (!walletMeta.hasHealthyOpg) {
    readinessTitle.textContent = "Top up the operator wallet";
    setupHint.textContent = `Wallet ${walletMeta.wallet?.address || ""} is below the safe OPG floor. Add more OPG from the faucet before running more verified chats.`;
    return;
  }

  if (!state.config?.hasSupabase) {
    readinessTitle.textContent = "Memory layer offline";
    setupHint.textContent = "Inference is ready, but Supabase memory is not configured. Add the project URL and a server-side key to unlock recall, profile stats, and the atlas tab.";
    return;
  }

  readinessTitle.textContent = "Runtime is armed";
  setupHint.textContent = `Wallet, memory, and deployment routes are lined up. Current memory footprint: ${profileStats?.storedMessages || 0} stored turns across ${profileStats?.threadsSeen || 0} threads.`;
}

function renderFromState() {
  const wallet = state.config?.walletStatus || null;

  modelValue.textContent = state.config?.model || "Unknown";
  settlementValue.textContent = state.config?.settlementType || "Unknown";
  memoryStatus.textContent = state.config?.hasSupabase ? "online" : "offline";
  walletStatus.textContent = wallet ? `${formatBalance(wallet.opgBalance)} OPG` : "missing";
  walletBadgeValue.textContent = wallet ? `${formatBalance(wallet.opgBalance)} OPG` : "not ready";
  runtimeValue.textContent = state.config?.openGradientRuntime || "n/a";

  renderThread();
  renderStatusStack();
  renderOverviewMetrics();
  renderInsights();
  renderMemories((state.profile?.recent_memories || []).map((memory) => ({ ...memory, memory: memory.content })));
  renderStudioDetails();
  renderLaunch();
  renderReadinessNarrative();

  userBio.textContent = state.profile?.user_bio || "Supabase memory summary not loaded yet.";
}

async function loadConfig() {
  const response = await fetch("/api/config");
  state.config = await response.json();
  state.ready = Boolean(state.config.hasOpenGradientKey);
  renderFromState();
}

async function loadProfile() {
  const response = await fetch("/api/profile");
  const profile = await response.json();

  state.profile = profile.enabled
    ? profile
    : {
        enabled: false,
        user_bio: "Supabase memory is not configured. Add SUPABASE_URL and a server-side key to unlock cloud recall.",
        stats: null,
        insights: [],
        recent_memories: []
      };

  renderFromState();
}

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    setActiveTab(button.dataset.tab);
  });
}

for (const chip of promptChips) {
  chip.addEventListener("click", () => {
    promptInput.value = chip.dataset.prompt || "";
    setActiveTab("studio");
    promptInput.focus();
  });
}

composer.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = promptInput.value.trim();

  if (!message || !state.ready) {
    return;
  }

  const historyBeforeRequest = [...state.history];
  appendMessage("user", message);
  state.history.push({ role: "user", content: message });
  promptInput.value = "";
  setBusy(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message,
        threadId: state.threadId,
        history: historyBeforeRequest
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }

    state.threadId = payload.threadId;
    window.localStorage.setItem("gradient-recall-thread", state.threadId);
    renderThread();

    appendMessage("assistant", payload.answer);
    state.history.push({ role: "assistant", content: payload.answer });
    composerNote.textContent = payload.memoryStatus === "ok"
      ? "Verified response received. Supabase recall was applied."
      : payload.memoryStatus === "disabled"
        ? "Verified response received. Cloud memory is off."
        : `Verified response received. Memory note: ${payload.memoryStatus}`;

    await loadProfile();

    const mergedRecentMemories = payload.memories?.length
      ? payload.memories
      : (state.profile?.recent_memories || []).map((memory) => ({ ...memory, memory: memory.content }));
    renderMemories(mergedRecentMemories);
  } catch (error) {
    appendMessage("assistant", `Request failed: ${error.message}`);
    state.history.pop();
    composerNote.textContent = error.message;
  } finally {
    setBusy(false);
  }
});

setActiveTab(state.activeTab);
renderThread();
setBusy(true);

await loadConfig();
await loadProfile();
