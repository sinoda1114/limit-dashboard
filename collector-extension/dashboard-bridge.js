const DEFAULT_DASHBOARD_BASE_URL = "http://127.0.0.1:43177";
let dashboardOrigin = null;

function normalizeDashboardUrls(maybeList, maybeSingle) {
  const fromList = Array.isArray(maybeList)
    ? maybeList.map((value) => String(value).trim().replace(/\/$/, "")).filter(Boolean)
    : [];
  if (fromList.length > 0) return Array.from(new Set(fromList));
  const fallback = String(maybeSingle || DEFAULT_DASHBOARD_BASE_URL).trim().replace(/\/$/, "");
  return [fallback];
}

function postToDashboard(message) {
  if (!dashboardOrigin) return;
  window.postMessage({ source: "AI_USAGE_COLLECTOR_EXTENSION", ...message }, dashboardOrigin);
}

function syncStore() {
  chrome.runtime.sendMessage({ type: "AI_USAGE_GET_STORE" }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.ok) {
      postToDashboard({ type: "AI_USAGE_STORE_SYNC", store: response.store });
    }
  });
}

function initBridge() {
  chrome.storage.local.get(["dashboardBaseUrl", "dashboardBaseUrls"], (stored) => {
    const dashboardBaseUrls = normalizeDashboardUrls(stored.dashboardBaseUrls, stored.dashboardBaseUrl);
    const configuredOrigins = dashboardBaseUrls.map((baseUrl) => {
      try {
        return new URL(baseUrl).origin;
      } catch {
        return null;
      }
    }).filter(Boolean);
    if (!configuredOrigins.includes(window.location.origin)) return;

    dashboardOrigin = window.location.origin;
    postToDashboard({ type: "AI_USAGE_BRIDGE_READY" });
    syncStore();
  });
}

window.addEventListener("message", (event) => {
  if (!dashboardOrigin) return;
  if (event.source !== window) return;
  if (event.origin !== dashboardOrigin) return;
  if (event.data?.source !== "AI_USAGE_DASHBOARD") return;
  if (event.data?.type !== "AI_USAGE_REFRESH_NOW") return;

  chrome.runtime.sendMessage({ type: "AI_USAGE_REFRESH_NOW" }, (response) => {
    if (chrome.runtime.lastError) return;
    postToDashboard({
      type: "AI_USAGE_REFRESH_ACK",
      ok: Boolean(response?.ok),
      error: response?.error,
      urls: response?.urls ?? [],
    });
    syncStore();
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "AI_USAGE_REFRESH_STARTED") {
    postToDashboard({
      type: "AI_USAGE_REFRESH_STARTED",
      urls: message.urls ?? [],
    });
  }

  if (message?.type === "AI_USAGE_STORE_SYNC") {
    postToDashboard({
      type: "AI_USAGE_STORE_SYNC",
      store: message.store,
    });
  }
});

initBridge();
