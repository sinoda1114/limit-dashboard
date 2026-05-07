function postToDashboard(message) {
  window.postMessage({ source: "AI_USAGE_COLLECTOR_EXTENSION", ...message }, "*");
}

function syncStore() {
  chrome.runtime.sendMessage({ type: "AI_USAGE_GET_STORE" }, (response) => {
    if (response?.ok) {
      postToDashboard({ type: "AI_USAGE_STORE_SYNC", store: response.store });
    }
  });
}

postToDashboard({ type: "AI_USAGE_BRIDGE_READY" });
syncStore();

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== "AI_USAGE_DASHBOARD") return;
  if (event.data?.type !== "AI_USAGE_REFRESH_NOW") return;

  chrome.runtime.sendMessage({ type: "AI_USAGE_REFRESH_NOW" }, (response) => {
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
