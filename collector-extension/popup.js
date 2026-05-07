const providersEl = document.getElementById("providers");
const statusEl = document.getElementById("status");
const updatedAtEl = document.getElementById("updatedAt");
const refreshButton = document.getElementById("refreshNow");
const openOptionsButton = document.getElementById("openOptions");

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function metricRow(metric) {
  const percentage =
    typeof metric.usedPercentage === "number"
      ? Math.max(0, Math.min(100, metric.usedPercentage))
      : null;
  const rightText = percentage === null ? (metric.detail || "-") : `${percentage}%`;
  const detail = metric.resetAt ? `リセット: ${metric.resetAt}` : metric.detail || "";

  return `
    <div class="metric">
      <div class="line">
        <span>${escapeHtml(metric.label || "Usage")}</span>
        <strong>${escapeHtml(rightText)}</strong>
      </div>
      ${percentage === null ? "" : `<div class="bar"><span style="width:${percentage}%"></span></div>`}
      ${detail ? `<div class="meta">${escapeHtml(detail)}</div>` : ""}
    </div>
  `;
}

function providerCard(providerKey, snapshot) {
  const providerName = snapshot?.name || providerKey;
  const metrics = Array.isArray(snapshot?.metrics) ? snapshot.metrics : [];
  const body =
    metrics.length > 0
      ? metrics.map(metricRow).join("")
      : '<div class="meta">まだメトリクスがありません。</div>';

  return `
    <article class="provider">
      <h2>${escapeHtml(providerName)}</h2>
      ${body}
    </article>
  `;
}

function renderStore(store) {
  const providers = store?.providers ?? {};
  const entries = Object.entries(providers);
  updatedAtEl.textContent = `最終更新: ${formatDateTime(store?.updatedAt)}`;

  if (entries.length === 0) {
    providersEl.innerHTML = '<div class="empty">データがまだありません。「今すぐ巡回」を押して収集してください。</div>';
    return;
  }

  providersEl.innerHTML = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([providerKey, snapshot]) => providerCard(providerKey, snapshot))
    .join("");
}

async function loadStore() {
  const response = await chrome.runtime.sendMessage({ type: "AI_USAGE_GET_STORE" }).catch((error) => {
    if (String(error?.message || error).includes("Extension context invalidated")) {
      throw new Error("拡張が更新されました。拡張を再読み込みしてください。");
    }
    throw error;
  });
  if (!response?.ok) {
    throw new Error(response?.error || "ストア取得に失敗しました");
  }
  renderStore(response.store);
}

async function refreshNow() {
  refreshButton.disabled = true;
  statusEl.textContent = "巡回を開始しました。数秒後に再読込します...";
  try {
    const result = await chrome.runtime.sendMessage({ type: "AI_USAGE_REFRESH_NOW" });
    if (!result?.ok) throw new Error(result?.error || "巡回開始に失敗しました");
    window.setTimeout(() => {
      void loadStore().catch((error) => {
        statusEl.textContent = `更新に失敗: ${error.message}`;
      });
    }, 2500);
  } catch (error) {
    statusEl.textContent = `エラー: ${error.message}`;
  } finally {
    window.setTimeout(() => {
      refreshButton.disabled = false;
      if (statusEl.textContent.startsWith("巡回")) statusEl.textContent = "";
    }, 1200);
  }
}

refreshButton.addEventListener("click", () => {
  void refreshNow();
});

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

void loadStore().catch((error) => {
  statusEl.textContent = `読み込みに失敗: ${error.message}`;
});
