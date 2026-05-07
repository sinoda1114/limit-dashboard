const DEFAULT_DASHBOARD_BASE_URL = "http://127.0.0.1:43177";
let collectorAlive = true;
let observer = null;
let warnedUnauthorized = false;

window.addEventListener("unhandledrejection", (event) => {
  const reason = String(event.reason?.message || event.reason || "");
  if (reason.includes("A listener indicated an asynchronous response by returning true")) {
    event.preventDefault();
    return;
  }
  if (!reason.includes("Extension context invalidated")) return;
  event.preventDefault();
  stopCollector("unhandled rejection: context invalidated");
});

async function getCollectorConfig() {
  const stored = await chrome.storage.local.get(["dashboardBaseUrl", "ingestToken"]);
  const dashboardBaseUrl = String(stored.dashboardBaseUrl || DEFAULT_DASHBOARD_BASE_URL).replace(/\/$/, "");
  const ingestToken = String(stored.ingestToken || "");
  return { dashboardBaseUrl, ingestToken };
}

function isContextInvalidatedError(error) {
  return String(error?.message || error || "").includes("Extension context invalidated");
}

function stopCollector(reason) {
  if (!collectorAlive) return;
  collectorAlive = false;
  observer?.disconnect();
  console.info("[AI Usage Collector] stopped collector loop:", reason);
}

function providerFromLocation() {
  const href = window.location.href;
  if (href.includes("cursor.com")) return "cursor";
  if (href.includes("chatgpt.com/codex")) return "codex";
  if (href.includes("claude.ai/settings/usage")) return "claude";
  return null;
}

function compactText() {
  return document.body.innerText.replace(/\s+/g, " ").trim();
}

function findReset(text) {
  const reset =
    text.match(/(?:Resets on|Reset on|リセット)[^\d一-龠ぁ-んァ-ン]{0,10}([^。,.|]{2,32}?)(?=\s+(?:Total|Auto|API|Included|On-Demand|$))/i)?.[1]?.trim() ??
    text.match(/(?:Reset|Resets|リセット)[^\d一-龠ぁ-んァ-ン]{0,10}([^。,.|]{2,32}?)(?=\s+(?:Total|Auto|API|Included|On-Demand|$))/i)?.[1]?.trim() ??
    text.match(/(\d+\s*(?:days?|日)後?[^\s。,.|]{0,16})/)?.[1]?.trim();
  return (
    reset
      ?.replace(/\s+(?:Total|Auto \+ Composer|API|Included|On-Demand).*$/i, "")
      .trim()
  );
}

function metricId(provider, label) {
  if (provider === "codex" && label.includes("5時間")) return "codex-five-hour";
  if (provider === "codex" && label.includes("週あたり")) return "codex-weekly";
  if (provider === "claude" && /現在のセッション|current session/i.test(label)) return "claude-current-session";
  if (provider === "claude" && /週間制限|weekly|すべてのモデル/i.test(label)) return "claude-weekly";
  if (provider === "claude" && /ルーティン|routine/i.test(label)) return "claude-routines";
  if (provider === "claude" && /追加使用量|extra/i.test(label)) return "claude-extra";
  if (provider === "claude" && /claude\s*design/i.test(label)) return "claude-design";
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${provider}-${slug || "usage"}`;
}

function pushMetric(metrics, provider, label, usedPercentage, resetAt, detail) {
  if (!Number.isFinite(usedPercentage)) return;
  const cleanLabel = label
    .replace(/used|使用済み|利用済み/gi, "")
    .replace(/[:：|/]+$/g, "")
    .trim()
    .slice(-48) || "Usage";
  const id = metricId(provider, cleanLabel);
  if (metrics.some((metric) => metric.id === id)) return;
  metrics.push({
    id,
    label: cleanLabel,
    usedPercentage: Math.max(0, Math.min(100, Math.round(usedPercentage))),
    resetAt: resetAt === null ? undefined : resetAt,
    detail,
  });
}

function metricsFromBars(provider) {
  const metrics = [];
  const text = compactText();
  const resetAt = findReset(text);

  if (provider === "cursor") {
    const total = text.match(/(?:Included in Pro\s+)?Total\s+(\d{1,3})\s*%/i);
    if (total) pushMetric(metrics, provider, "Total", Number(total[1]), resetAt);

    const auto =
      text.match(/Auto\s*\+\s*Composer\s+(\d{1,3})\s*%/i) ??
      text.match(/(\d{1,3})\s*%\s*Auto(?:\s+and|\s|$)/i);
    if (auto) pushMetric(metrics, provider, "Auto + Composer", Number(auto[1]), resetAt);

    const api =
      text.match(/API\s+(\d{1,3})\s*%/i) ??
      text.match(/(\d{1,3})\s*%\s*API\s+used/i);
    if (api) pushMetric(metrics, provider, "API", Number(api[1]), resetAt);

    return metrics;
  }

  if (provider === "codex") {
    const fiveHour = text.match(
      /5\s*時間の使用制限\s+(\d{1,3})\s*%\s*(残り|使用済み)?[^リ]*(?:リセット[:：]\s*([^\s]+))?/i
    );
    if (fiveHour) pushMetric(metrics, provider, "5時間の使用制限", codexUsed(Number(fiveHour[1]), fiveHour[2]), fiveHour[3] ?? resetAt);

    const weekly = text.match(
      /週あたりの使用制限\s+(\d{1,3})\s*%\s*(残り|使用済み)?[^リ]*(?:リセット[:：]\s*([^\s]+(?:\s+[^\s]+)?))?/i
    );
    if (weekly) pushMetric(metrics, provider, "週あたりの使用制限", codexUsed(Number(weekly[1]), weekly[2]), weekly[3] ?? resetAt);

    const credits = text.match(/残りのクレジット\s+(\d+(?:\.\d+)?)/);
    if (credits) {
      metrics.push({
        id: "codex-credits",
        label: "残りのクレジット",
        usedPercentage: null,
        detail: credits[1],
      });
    }

    return metrics;
  }

  if (provider === "claude") {
    const current =
      text.match(/現在のセッション\s+([^%]{0,160}?)(\d{1,3})\s*%\s*使用済み/i) ??
      text.match(/current session\s+([^%]{0,160}?)(\d{1,3})\s*%\s*(?:used|使用)/i);
    if (current) pushMetric(metrics, provider, "現在のセッション", Number(current[2]), resetFromSection(current[1]) ?? null);

    const weekly =
      text.match(/週間制限\s+([^%]{0,220}?)(\d{1,3})\s*%\s*使用済み/i) ??
      text.match(/すべてのモデル\s+([^%]{0,160}?)(\d{1,3})\s*%\s*使用済み/i) ??
      text.match(/weekly\s+([^%]{0,180}?)(\d{1,3})\s*%\s*(?:used|使用)/i);
    if (weekly) pushMetric(metrics, provider, "週間制限", Number(weekly[2]), resetFromSection(weekly[1]) ?? resetAt);

    const claudeDesign =
      text.match(/Claude\s*Design\s+([^%]{0,220}?)(\d{1,3})\s*%\s*(?:使用済み|used|使用)/i) ??
      text.match(/Claude\s*Design[^0-9]{0,180}(\d{1,3})\s*%\s*(?:使用済み|used|使用)/i);
    if (claudeDesign) {
      const usedPercentage = Number(claudeDesign[2] ?? claudeDesign[1]);
      pushMetric(metrics, provider, "Claude Design", usedPercentage, resetFromSection(claudeDesign[1]));
    }

    const routines =
      text.match(/(?:ルーティン実行数|routine runs?)[^0-9]{0,80}(\d+)\s*\/\s*(\d+)/i);
    if (routines) {
      const used = Number(routines[1]);
      const limit = Number(routines[2]);
      pushMetric(
        metrics,
        provider,
        "1日の含まれるルーティン実行数",
        limit > 0 ? (used / limit) * 100 : 0,
        "毎日",
        `${used} / ${limit}`
      );
    }

    const extra =
      text.match(/追加使用量\s+([^%]{0,220}?)(\d{1,3})\s*%\s*(?:使用|used)/i) ??
      text.match(/extra usage\s+([^%]{0,220}?)(\d{1,3})\s*%\s*(?:used|使用)/i);
    if (extra) pushMetric(metrics, provider, "追加使用量", Number(extra[2]), resetFromSection(extra[1]));

    if (metrics.length > 0) return metrics;
  }

  const candidates = [...document.querySelectorAll("body *")]
    .filter((node) => node.childElementCount <= 3)
    .map((node) => node.innerText?.replace(/\s+/g, " ").trim())
    .filter((value) => Boolean(value) && value.length < 120 && !/[{}[\]<>]/.test(value));

  for (const value of candidates) {
    const percent = value.match(/(\d{1,3})\s*%/);
    if (!percent) continue;
    const usedPercentage = Math.min(100, Number(percent[1]));
    const label =
      value
        .replace(/\d{1,3}\s*%.*/, "")
        .replace(/used|使用済み|利用済み/gi, "")
        .trim() || "Usage";

    pushMetric(metrics, provider, label, usedPercentage, resetAt);
  }

  return metrics.slice(0, 10);
}

function resetFromSection(section) {
  if (!section) return undefined;
  return (
    section.match(/(\d{1,2}:\d{2}\s*\([^)]+\)\s*にリセット)/)?.[1]?.trim() ??
    section.match(/([A-Z][a-z]{2}\s+\d{1,2}\s*にリセット)/)?.[1]?.trim() ??
    section.match(/([0-9]{4}\/[0-9]{2}\/[0-9]{2}\s+[0-9]{1,2}:[0-9]{2})/)?.[1]?.trim()
  );
}

function codexUsed(value, qualifier) {
  return qualifier === "残り" ? 100 - value : value;
}

function providerName(provider) {
  if (provider === "cursor") return "Cursor";
  if (provider === "codex") return "Codex";
  return "Claude";
}

function showBadge(ok, message) {
  const id = "ai-usage-collector-badge";
  document.getElementById(id)?.remove();
  const badge = document.createElement("div");
  badge.id = id;
  badge.textContent = message;
  badge.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:2147483647",
    "padding:8px 10px",
    "border-radius:6px",
    "font:12px/1.4 system-ui,sans-serif",
    "box-shadow:0 8px 24px rgba(0,0,0,.25)",
    `background:${ok ? "#16351f" : "#3b2419"}`,
    `color:${ok ? "#b8f5c4" : "#ffd0b5"}`,
    `border:1px solid ${ok ? "#2c6f3b" : "#8a4b2d"}`,
  ].join(";");
  document.documentElement.appendChild(badge);
}

async function sendSnapshot() {
  if (!collectorAlive) return;
  const provider = providerFromLocation();
  if (!provider) return;

  let config;
  try {
    config = await getCollectorConfig();
  } catch (error) {
    if (isContextInvalidatedError(error)) {
      stopCollector("getCollectorConfig failed: context invalidated");
      return;
    }
    throw error;
  }
  const metrics = metricsFromBars(provider);
  const snapshot = {
    provider,
    name: providerName(provider),
    source: "web-collector",
    url: window.location.href,
    title: document.title,
    collectedAt: new Date().toISOString(),
    metrics,
    status: metrics.length > 0 ? "ok" : "no-metrics",
    diagnostic:
      metrics.length > 0
        ? `${metrics.length} metric(s) extracted from ${document.title}`
        : `Collector ran on ${document.title}, but no metric matched`,
  };

  chrome.runtime
    ?.sendMessage?.({
      type: "AI_USAGE_SNAPSHOT",
      snapshot,
    })
    ?.catch((error) => {
      if (isContextInvalidatedError(error)) {
        stopCollector("snapshot message rejected: context invalidated");
      }
    });

  const headers = { "content-type": "application/json" };
  if (config.ingestToken) headers.authorization = `Bearer ${config.ingestToken}`;

  try {
    const response = await fetch(`${config.dashboardBaseUrl}/api/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify(snapshot),
    });

    if (!response.ok) {
      if (response.status === 401) {
        if (!warnedUnauthorized) {
          warnedUnauthorized = true;
          console.warn("[AI Usage Collector] ingest failed 401 unauthorized. Check Collector Token setting.");
        }
      } else {
        console.warn("[AI Usage Collector] ingest failed", response.status, await response.text());
      }
    }
  } catch (error) {
    console.warn("[AI Usage Collector] ingest skipped", error);
  }

  showBadge(metrics.length > 0, `Usage collector: ${metrics.length} metric(s) saved`);
  chrome.runtime
    ?.sendMessage?.({
      type: "AI_USAGE_COLLECTED",
      provider,
      metricsCount: metrics.length,
      url: window.location.href,
    })
    ?.catch((error) => {
      if (isContextInvalidatedError(error)) {
        stopCollector("collected message rejected: context invalidated");
      }
    });
}

let timer = 0;
function scheduleSend() {
  if (!collectorAlive) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    void sendSnapshot().catch((error) => {
      if (isContextInvalidatedError(error)) {
        stopCollector("sendSnapshot rejected: context invalidated");
      }
    });
  }, 1200);
}

scheduleSend();
observer = new MutationObserver(scheduleSend);
observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
});
