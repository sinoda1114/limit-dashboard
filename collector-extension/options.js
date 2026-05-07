const DEFAULT_DASHBOARD_BASE_URL = "http://127.0.0.1:43177";

const dashboardBaseUrlInput = document.getElementById("dashboardBaseUrl");
const ingestTokenInput = document.getElementById("ingestToken");
const statusEl = document.getElementById("status");

async function load() {
  const stored = await chrome.storage.local.get(["dashboardBaseUrl", "ingestToken"]);
  dashboardBaseUrlInput.value = stored.dashboardBaseUrl || DEFAULT_DASHBOARD_BASE_URL;
  ingestTokenInput.value = stored.ingestToken || "";
}

async function save() {
  const dashboardBaseUrl = dashboardBaseUrlInput.value.trim().replace(/\/$/, "");
  const ingestToken = ingestTokenInput.value.trim();

  await chrome.storage.local.set({
    dashboardBaseUrl: dashboardBaseUrl || DEFAULT_DASHBOARD_BASE_URL,
    ingestToken,
  });

  statusEl.textContent = "保存しました";
  window.setTimeout(() => {
    statusEl.textContent = "";
  }, 1800);
}

document.getElementById("save").addEventListener("click", save);
void load();
