const DEFAULT_DASHBOARD_BASE_URL = "http://127.0.0.1:43177";

const dashboardBaseUrlInput = document.getElementById("dashboardBaseUrl");
const ingestTokenInput = document.getElementById("ingestToken");
const statusEl = document.getElementById("status");

async function load() {
  const stored = await chrome.storage.local.get(["dashboardBaseUrl", "dashboardBaseUrls", "ingestToken"]);
  const urls = normalizeDashboardUrls(stored.dashboardBaseUrls, stored.dashboardBaseUrl);
  dashboardBaseUrlInput.value = urls.join("\n");
  ingestTokenInput.value = stored.ingestToken || "";
}

function parseDashboardUrls(rawValue) {
  return Array.from(
    new Set(
      String(rawValue || "")
        .split(/[\n,]/)
        .map((value) => value.trim().replace(/\/$/, ""))
        .filter(Boolean)
    )
  );
}

function normalizeDashboardUrls(maybeList, maybeSingle) {
  const fromList = Array.isArray(maybeList)
    ? maybeList.map((value) => String(value).trim().replace(/\/$/, "")).filter(Boolean)
    : [];
  if (fromList.length > 0) return Array.from(new Set(fromList));

  const fallback = String(maybeSingle || DEFAULT_DASHBOARD_BASE_URL).trim().replace(/\/$/, "");
  return [fallback];
}

async function save() {
  const parsedUrls = parseDashboardUrls(dashboardBaseUrlInput.value);
  const dashboardBaseUrls = parsedUrls.length > 0 ? parsedUrls : [DEFAULT_DASHBOARD_BASE_URL];
  const dashboardBaseUrl = dashboardBaseUrls[0];
  const ingestToken = ingestTokenInput.value.trim();

  await chrome.storage.local.set({
    dashboardBaseUrl,
    dashboardBaseUrls,
    ingestToken,
  });

  statusEl.textContent = "保存しました";
  window.setTimeout(() => {
    statusEl.textContent = "";
  }, 1800);
}

document.getElementById("save").addEventListener("click", save);
void load();
