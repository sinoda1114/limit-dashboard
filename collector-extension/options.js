const DEFAULT_DASHBOARD_BASE_URL = "http://127.0.0.1:43177";

const dashboardBaseUrlInput = document.getElementById("dashboardBaseUrl");
const ingestTokenInput = document.getElementById("ingestToken");
const statusEl = document.getElementById("status");
const orderValidationWarningEl = document.getElementById("orderValidationWarning");
const saveButton = document.getElementById("save");

const PROVIDER_LABELS = {
  cursor: "Cursor",
  codex: "Codex",
  claude: "Claude",
};

const providerSettingEls = {
  cursor: {
    visible: document.getElementById("showCursor"),
    order: document.getElementById("orderCursor"),
  },
  codex: {
    visible: document.getElementById("showCodex"),
    order: document.getElementById("orderCodex"),
  },
  claude: {
    visible: document.getElementById("showClaude"),
    order: document.getElementById("orderClaude"),
  },
};

async function load() {
  const stored = await chrome.storage.local.get([
    "dashboardBaseUrl",
    "dashboardBaseUrls",
    "ingestToken",
    "popupProviderPrefs",
  ]);
  const urls = normalizeDashboardUrls(stored.dashboardBaseUrls, stored.dashboardBaseUrl);
  dashboardBaseUrlInput.value = urls.join("\n");
  ingestTokenInput.value = stored.ingestToken || "";
  applyProviderPrefs(stored.popupProviderPrefs);
  updateOrderValidationUI();
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

function applyProviderPrefs(prefs) {
  const defaults = {
    cursor: { visible: true, order: 1 },
    codex: { visible: true, order: 2 },
    claude: { visible: true, order: 3 },
  };
  for (const [providerKey, elements] of Object.entries(providerSettingEls)) {
    const value = prefs?.[providerKey] ?? defaults[providerKey];
    elements.visible.checked = value.visible !== false;
    elements.order.value = String(Number(value.order) > 0 ? Number(value.order) : defaults[providerKey].order);
  }
}

function readProviderPrefs() {
  const result = {};
  for (const [providerKey, elements] of Object.entries(providerSettingEls)) {
    const parsedOrder = Number.parseInt(elements.order.value, 10);
    result[providerKey] = {
      visible: Boolean(elements.visible.checked),
      order: Number.isFinite(parsedOrder) && parsedOrder > 0 ? parsedOrder : 999,
    };
  }
  return result;
}

function validateDisplayOrders() {
  const parsed = [];
  for (const [providerKey, elements] of Object.entries(providerSettingEls)) {
    const raw = String(elements.order.value ?? "").trim();
    const n = Number.parseInt(raw, 10);
    if (raw === "" || !Number.isFinite(n) || n <= 0) {
      return {
        ok: false,
        reason: "invalid",
        message: "表示順は1以上の整数で入力してください。",
        highlightKeys: [providerKey],
      };
    }
    parsed.push({ providerKey, order: n });
  }

  const byOrder = new Map();
  for (const { providerKey, order } of parsed) {
    if (!byOrder.has(order)) byOrder.set(order, []);
    byOrder.get(order).push(providerKey);
  }

  const duplicateKeys = [];
  const duplicateParts = [];
  for (const [order, keys] of byOrder) {
    if (keys.length > 1) {
      duplicateKeys.push(...keys);
      const names = keys.map((k) => PROVIDER_LABELS[k] ?? k).join("・");
      duplicateParts.push(`「${order}」→ ${names}`);
    }
  }

  if (duplicateKeys.length > 0) {
    return {
      ok: false,
      reason: "duplicate",
      message: `表示順が重複しています（${duplicateParts.join(" / ")}）。別の番号を指定してください。`,
      highlightKeys: [...new Set(duplicateKeys)],
    };
  }

  return { ok: true };
}

function updateOrderValidationUI() {
  for (const elements of Object.values(providerSettingEls)) {
    elements.order.classList.remove("input-error");
  }

  const state = validateDisplayOrders();
  if (state.ok) {
    orderValidationWarningEl.textContent = "";
    orderValidationWarningEl.classList.remove("is-visible");
    saveButton.disabled = false;
    return;
  }

  orderValidationWarningEl.textContent = state.message;
  orderValidationWarningEl.classList.add("is-visible");
  saveButton.disabled = true;

  for (const key of state.highlightKeys ?? []) {
    providerSettingEls[key]?.order.classList.add("input-error");
  }
}

async function save() {
  const orderState = validateDisplayOrders();
  if (!orderState.ok) {
    updateOrderValidationUI();
    return;
  }

  const parsedUrls = parseDashboardUrls(dashboardBaseUrlInput.value);
  const dashboardBaseUrls = parsedUrls.length > 0 ? parsedUrls : [DEFAULT_DASHBOARD_BASE_URL];
  const dashboardBaseUrl = dashboardBaseUrls[0];
  const ingestToken = ingestTokenInput.value.trim();

  await chrome.storage.local.set({
    dashboardBaseUrl,
    dashboardBaseUrls,
    ingestToken,
    popupProviderPrefs: readProviderPrefs(),
  });

  statusEl.textContent = "保存しました";
  window.setTimeout(() => {
    statusEl.textContent = "";
  }, 1800);
}

saveButton.addEventListener("click", save);

for (const elements of Object.values(providerSettingEls)) {
  elements.order.addEventListener("input", updateOrderValidationUI);
  elements.order.addEventListener("change", updateOrderValidationUI);
}

void load();
