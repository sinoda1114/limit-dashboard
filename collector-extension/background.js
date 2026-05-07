const USAGE_URLS = [
  "https://cursor.com/ja/dashboard/spending",
  "https://chatgpt.com/codex/cloud/settings/analytics#usage",
  "https://claude.ai/settings/usage",
];

const AUTO_REFRESH_ALARM = "ai-usage-auto-refresh";
const AUTO_REFRESH_MINUTES = 1;
const OPENED_TAB_KEY = "aiUsageOpenedTabs";
const LAST_COMMAND_KEY = "aiUsageLastCommandId";
const STORE_KEY = "aiUsageStore";
const DEFAULT_DASHBOARD_BASE_URL = "http://127.0.0.1:43177";
let latestStore = { updatedAt: null, providers: {} };

async function getCollectorConfig() {
  const stored = await chrome.storage.local.get(["dashboardBaseUrl", "ingestToken"]);
  const dashboardBaseUrl = String(stored.dashboardBaseUrl || DEFAULT_DASHBOARD_BASE_URL).replace(/\/$/, "");
  const ingestToken = String(stored.ingestToken || "");
  return { dashboardBaseUrl, ingestToken };
}

function authHeaders(config) {
  const headers = { "content-type": "application/json" };
  if (config.ingestToken) headers.authorization = `Bearer ${config.ingestToken}`;
  return headers;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(AUTO_REFRESH_ALARM, {
    delayInMinutes: 0.05,
    periodInMinutes: AUTO_REFRESH_MINUTES,
  });
  void refreshAllUsagePages();
});

void getLocalUsageStore()
  .then((store) => {
    latestStore = store;
  })
  .catch(() => {});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(AUTO_REFRESH_ALARM, {
    delayInMinutes: 0.05,
    periodInMinutes: AUTO_REFRESH_MINUTES,
  });
  void refreshAllUsagePages();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_REFRESH_ALARM) {
    void refreshAllUsagePages();
    void checkCommandAndRefresh();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "AI_USAGE_REFRESH_NOW") {
    sendResponse({ ok: true, started: true, urls: USAGE_URLS });
    void refreshAllUsagePages().catch(() => {});
    if (sender.tab?.id) {
      void chrome.tabs.sendMessage(sender.tab.id, {
        type: "AI_USAGE_REFRESH_STARTED",
        urls: USAGE_URLS,
      });
    }
    return;
  }

  if (message?.type === "AI_USAGE_GET_STORE") {
    sendResponse({ ok: true, store: latestStore });
    return;
  }

  if (message?.type === "AI_USAGE_SNAPSHOT") {
    sendResponse({ ok: true, accepted: true });
    void saveLocalSnapshot(message.snapshot)
      .then((store) => {
        broadcastStore(store);
      })
      .catch(() => {});
    return;
  }

  if (message?.type !== "AI_USAGE_COLLECTED" || !sender.tab?.id) return;
  void closeIfCollectorOpened(sender.tab.id);
});

async function getLocalUsageStore() {
  const stored = await chrome.storage.local.get(STORE_KEY);
  return stored[STORE_KEY] ?? { updatedAt: null, providers: {} };
}

async function saveLocalSnapshot(snapshot) {
  if (!snapshot?.provider) return getLocalUsageStore();
  const current = await getLocalUsageStore();
  const next = {
    updatedAt: new Date().toISOString(),
    providers: {
      ...(current.providers ?? {}),
      [snapshot.provider]: snapshot,
    },
  };
  await chrome.storage.local.set({ [STORE_KEY]: next });
  latestStore = next;
  return next;
}

async function broadcastStore(store) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    if (!isDashboardUrl(tab.url ?? "")) continue;
    chrome.tabs.sendMessage(tab.id, { type: "AI_USAGE_STORE_SYNC", store }).catch(() => {});
  }
}

function isDashboardUrl(url) {
  return /^https:\/\/[^/]+\.vercel\.app\//.test(url) || /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(url);
}

async function refreshAllUsagePages() {
  await reportStatus("started", "使用量ページの巡回を開始しました。");
  for (const url of USAGE_URLS) {
    await openOrFocusCollectorTab(url);
  }
  await reportStatus("completed", "使用量ページを開きました。読み取り後に自動で反映されます。");
}

async function checkCommandAndRefresh() {
  try {
    const config = await getCollectorConfig();
    const response = await fetch(`${config.dashboardBaseUrl}/api/collector/command`, {
      cache: "no-store",
      headers: authHeaders(config),
    });
    const payload = await response.json();
    const commandId = payload.command?.id;
    if (!commandId) return;

    const stored = await chrome.storage.local.get(LAST_COMMAND_KEY);
    if (stored[LAST_COMMAND_KEY] === commandId) return;

    await chrome.storage.local.set({ [LAST_COMMAND_KEY]: commandId });
    await reportStatus("started", "ダッシュボードからの巡回依頼を受け取りました。", commandId);
    await refreshAllUsagePages();
  } catch (error) {
    await reportStatus("failed", `巡回依頼の確認に失敗しました: ${String(error)}`);
  }
}

async function reportStatus(state, message, commandId) {
  const config = await getCollectorConfig();
  await fetch(`${config.dashboardBaseUrl}/api/collector/command`, {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify({
      type: "status",
      state,
      message,
      commandId,
    }),
  }).catch(() => {});
}

async function openOrFocusCollectorTab(url) {
  const existing = await chrome.tabs.query({ url: `${originPattern(url)}/*` });
  const matching = existing.find((tab) => tab.url?.startsWith(url.split("#")[0]));
  if (matching?.id) {
    await chrome.tabs.reload(matching.id);
    return;
  }

  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
  } catch (error) {
    const message = String(error);
    if (!message.includes("No current window")) throw error;

    const normalWindows = await chrome.windows.getAll({ populate: false, windowTypes: ["normal"] }).catch(() => []);

    if (normalWindows.length === 0) {
      const createdWindow = await chrome.windows.create({ url, focused: false });
      tab = createdWindow.tabs?.[0];
    } else {
      tab = await chrome.tabs.create({ url, active: false, windowId: normalWindows[0].id });
    }
  }
  if (tab.id) await rememberOpenedTab(tab.id);

  setTimeout(() => {
    if (tab.id) void closeIfCollectorOpened(tab.id);
  }, 30000);
}

function originPattern(url) {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname.replace(/\/[^/]*$/, "")}`;
}

async function rememberOpenedTab(tabId) {
  const stored = await chrome.storage.session.get(OPENED_TAB_KEY);
  const ids = new Set(stored[OPENED_TAB_KEY] ?? []);
  ids.add(tabId);
  await chrome.storage.session.set({ [OPENED_TAB_KEY]: [...ids] });
}

async function closeIfCollectorOpened(tabId) {
  const stored = await chrome.storage.session.get(OPENED_TAB_KEY);
  const ids = new Set(stored[OPENED_TAB_KEY] ?? []);
  if (!ids.has(tabId)) return;

  ids.delete(tabId);
  await chrome.storage.session.set({ [OPENED_TAB_KEY]: [...ids] });

  await chrome.tabs.remove(tabId).catch(() => {});
}
