const providersEl = document.getElementById("providers");
const statusEl = document.getElementById("status");
const updatedAtEl = document.getElementById("updatedAt");
const refreshButton = document.getElementById("refreshNow");
const openOptionsButton = document.getElementById("openOptions");
const DEFAULT_PROVIDER_PREFS = {
  cursor: { visible: true, order: 1 },
  codex: { visible: true, order: 2 },
  claude: { visible: true, order: 3 },
};
const PROVIDER_UI = {
  cursor: { icon: "➤", className: "provider-cursor" },
  codex: { icon: "&lt;/&gt;", className: "provider-codex" },
  claude: { icon: "✶", className: "provider-claude" },
};

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
  const resetMeta = metric.resetAt ? `リセット: ${metric.resetAt}` : "";
  const rawDetail = metric.resetAt ? "" : metric.detail || "";
  const detail = percentage === null && String(rawDetail) === String(rightText) ? "" : rawDetail;

  return `
    <div class="metric">
      <div class="line">
        <span class="line-main">
          <span>${escapeHtml(metric.label || "Usage")}</span>
          ${resetMeta ? `<span class="line-sub">${escapeHtml(resetMeta)}</span>` : ""}
        </span>
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
  const providerUi = PROVIDER_UI[providerKey] ?? { icon: "•", className: "provider-default" };
  const body =
    metrics.length > 0
      ? metrics.map(metricRow).join("")
      : '<div class="meta">まだメトリクスがありません。</div>';

  return `
    <article class="provider ${providerUi.className}">
      <h2><span class="provider-icon">${providerUi.icon}</span><span>${escapeHtml(providerName)}</span></h2>
      ${body}
    </article>
  `;
}

function toProviderOrderValue(providerKey, prefs) {
  const order = Number(prefs?.[providerKey]?.order);
  if (Number.isFinite(order) && order > 0) return order;
  return 999;
}

function isProviderVisible(providerKey, prefs) {
  const value = prefs?.[providerKey];
  if (!value) return true;
  return value.visible !== false;
}

function renderStore(store, providerPrefs) {
  const providers = store?.providers ?? {};
  const entries = Object.entries(providers)
    .filter(([providerKey]) => isProviderVisible(providerKey, providerPrefs))
    .sort(([a], [b]) => {
      const orderDiff = toProviderOrderValue(a, providerPrefs) - toProviderOrderValue(b, providerPrefs);
      return orderDiff !== 0 ? orderDiff : a.localeCompare(b);
    });
  updatedAtEl.textContent = `最終更新: ${formatDateTime(store?.updatedAt)}`;

  if (entries.length === 0) {
    providersEl.innerHTML = '<div class="empty">表示対象のデータがありません。設定で表示対象を確認してください。</div>';
    return;
  }

  providersEl.innerHTML = entries
    .map(([providerKey, snapshot]) => providerCard(providerKey, snapshot))
    .join("");
}

async function loadPopupPrefs() {
  const stored = await chrome.storage.local.get(["popupProviderPrefs"]);
  return { ...DEFAULT_PROVIDER_PREFS, ...(stored.popupProviderPrefs ?? {}) };
}

async function loadStore() {
  const popupPrefs = await loadPopupPrefs();
  const response = await chrome.runtime.sendMessage({ type: "AI_USAGE_GET_STORE" }).catch((error) => {
    if (String(error?.message || error).includes("Extension context invalidated")) {
      throw new Error("拡張が更新されました。拡張を再読み込みしてください。");
    }
    throw error;
  });
  if (!response?.ok) {
    throw new Error(response?.error || "ストア取得に失敗しました");
  }
  renderStore(response.store, popupPrefs);
}

async function refreshNow() {
  refreshButton.disabled = true;
  statusEl.textContent = "更新しています。数秒後に再読み込みします...";
  try {
    const result = await chrome.runtime.sendMessage({ type: "AI_USAGE_REFRESH_NOW" });
    if (!result?.ok) throw new Error(result?.error || "更新開始に失敗しました");
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
      if (statusEl.textContent.startsWith("更新")) statusEl.textContent = "";
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
