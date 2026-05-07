import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRedis } from "./redis-store";
import type { ProviderId, ProviderSnapshot, UsageMetric, UsageStore } from "./usage-types";

const dataDir = path.join(process.cwd(), ".data");
const storePath = path.join(dataDir, "usage.json");
const redisKey = "ai-usage-cockpit:usage-store";

const emptyStore: UsageStore = {
  updatedAt: null,
  providers: {},
};

export async function readUsageStore(): Promise<UsageStore> {
  const redis = getRedis();
  if (redis) {
    const store = await redis.get<UsageStore>(redisKey);
    return store ?? emptyStore;
  }

  try {
    const raw = await readFile(storePath, "utf8");
    return JSON.parse(raw) as UsageStore;
  } catch {
    return emptyStore;
  }
}

export async function writeSnapshot(snapshot: ProviderSnapshot) {
  const current = await readUsageStore();
  const next: UsageStore = {
    updatedAt: new Date().toISOString(),
    providers: {
      ...current.providers,
      [snapshot.provider]: snapshot,
    },
  };

  const redis = getRedis();
  if (redis) {
    await redis.set(redisKey, next);
    return next;
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(storePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function inferProvider(url = ""): ProviderId | null {
  if (url.includes("cursor.com")) return "cursor";
  if (url.includes("chatgpt.com/codex")) return "codex";
  if (url.includes("claude.ai/settings/usage")) return "claude";
  return null;
}

export function providerName(provider: ProviderId) {
  if (provider === "cursor") return "Cursor";
  if (provider === "codex") return "Codex";
  return "Claude";
}

export function parseWebMetrics(provider: ProviderId, text: string): UsageMetric[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  const metrics: UsageMetric[] = [];
  const seen = new Set<string>();
  const reset = findReset(normalized);

  function pushMetric(label: string, usedPercentage: number, resetOverride?: string | null, detail?: string) {
    if (!Number.isFinite(usedPercentage)) return;
    const cleanLabel = cleanupLabel(label);
    const id = metricId(provider, cleanLabel, metrics.length);
    if (seen.has(id)) return;
    seen.add(id);
    metrics.push({
      id,
      label: cleanLabel,
      usedPercentage: Math.max(0, Math.min(100, Math.round(usedPercentage))),
      resetAt: resetOverride === null ? undefined : resetOverride ?? reset,
      detail,
    });
  }

  if (provider === "cursor") {
    const total = normalized.match(/(?:Included in Pro\s+)?Total\s+(\d{1,3})\s*%/i);
    if (total) pushMetric("Total", Number(total[1]));

    const auto =
      normalized.match(/Auto\s*\+\s*Composer\s+(\d{1,3})\s*%/i) ??
      normalized.match(/(\d{1,3})\s*%\s*Auto(?:\s+and|\s|$)/i);
    if (auto) pushMetric("Auto + Composer", Number(auto[1]));

    const api =
      normalized.match(/API\s+(\d{1,3})\s*%/i) ??
      normalized.match(/(\d{1,3})\s*%\s*API\s+used/i);
    if (api) pushMetric("API", Number(api[1]));

    return metrics;
  }

  if (provider === "codex") {
    const fiveHour = normalized.match(
      /5\s*時間の使用制限\s+(\d{1,3})\s*%\s*(残り|使用済み)?[^リ]*(?:リセット[:：]\s*([^\s]+))?/i
    );
    if (fiveHour) pushMetric("5時間の使用制限", codexUsed(Number(fiveHour[1]), fiveHour[2]), fiveHour[3]);

    const weekly = normalized.match(
      /週あたりの使用制限\s+(\d{1,3})\s*%\s*(残り|使用済み)?[^リ]*(?:リセット[:：]\s*([^\s]+(?:\s+[^\s]+)?))?/i
    );
    if (weekly) pushMetric("週あたりの使用制限", codexUsed(Number(weekly[1]), weekly[2]), weekly[3]);

    const credits = normalized.match(/残りのクレジット\s+(\d+(?:\.\d+)?)/);
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
      normalized.match(/現在のセッション\s+([^%]{0,160}?)(\d{1,3})\s*%\s*使用済み/i) ??
      normalized.match(/current session\s+([^%]{0,160}?)(\d{1,3})\s*%\s*(?:used|使用)/i);
    if (current) pushMetric("現在のセッション", Number(current[2]), resetFromSection(current[1]) ?? null);

    const weekly =
      normalized.match(/週間制限\s+([^%]{0,220}?)(\d{1,3})\s*%\s*使用済み/i) ??
      normalized.match(/すべてのモデル\s+([^%]{0,160}?)(\d{1,3})\s*%\s*使用済み/i) ??
      normalized.match(/weekly\s+([^%]{0,180}?)(\d{1,3})\s*%\s*(?:used|使用)/i);
    if (weekly) pushMetric("週間制限", Number(weekly[2]), resetFromSection(weekly[1]) ?? reset);

    const claudeDesign =
      normalized.match(/Claude\s*Design\s+([^%]{0,220}?)(\d{1,3})\s*%\s*(?:使用済み|used|使用)/i) ??
      normalized.match(/Claude\s*Design[^0-9]{0,180}(\d{1,3})\s*%\s*(?:使用済み|used|使用)/i);
    if (claudeDesign) {
      const usedPercentage = Number(claudeDesign[2] ?? claudeDesign[1]);
      pushMetric("Claude Design", usedPercentage, resetFromSection(claudeDesign[1]));
    }

    const routines =
      normalized.match(/(?:ルーティン実行数|routine runs?)[^0-9]{0,80}(\d+)\s*\/\s*(\d+)/i);
    if (routines) {
      const used = Number(routines[1]);
      const limit = Number(routines[2]);
      pushMetric(
        "1日の含まれるルーティン実行数",
        limit > 0 ? (used / limit) * 100 : 0,
        "毎日",
        `${used} / ${limit}`
      );
    }

    const extra =
      normalized.match(/追加使用量\s+([^%]{0,220}?)(\d{1,3})\s*%\s*(?:使用|used)/i) ??
      normalized.match(/extra usage\s+([^%]{0,220}?)(\d{1,3})\s*%\s*(?:used|使用)/i);
    if (extra) pushMetric("追加使用量", Number(extra[2]), resetFromSection(extra[1]));

    if (metrics.length > 0) return metrics;
  }

  const percentMatches = [
    ...normalized.matchAll(
      /([A-Za-z][A-Za-z +/&-]{0,48}|合計|総計|全体|現在のセッション|週間制限|週あたり|5時間|Total|API|Auto \+ Composer)[^\d]{0,32}(\d{1,3})\s*%/g
    ),
  ];
  for (const match of percentMatches.slice(0, 8)) {
    pushMetric(match[1], Number(match[2]));
  }

  if (metrics.length === 0) {
    for (const match of normalized.matchAll(/(\d{1,3})\s*%\s*(?:used|使用|使用済み|利用済み)/gi)) {
      pushMetric(metrics.length === 0 ? "Usage" : `Usage ${metrics.length + 1}`, Number(match[1]));
    }
  }

  return metrics.slice(0, 10);
}

function resetFromSection(section?: string) {
  if (!section) return undefined;
  return (
    section.match(/(\d{1,2}:\d{2}\s*\([^)]+\)\s*にリセット)/)?.[1]?.trim() ??
    section.match(/([A-Z][a-z]{2}\s+\d{1,2}\s*にリセット)/)?.[1]?.trim() ??
    section.match(/([0-9]{4}\/[0-9]{2}\/[0-9]{2}\s+[0-9]{1,2}:[0-9]{2})/)?.[1]?.trim()
  );
}

function findReset(text: string) {
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

function cleanupLabel(label: string) {
  return (
    label
      .replace(/used|使用済み|利用済み/gi, "")
      .replace(/[:：|/]+$/g, "")
      .trim()
      .slice(-48) || "Usage"
  );
}

function codexUsed(value: number, qualifier?: string) {
  return qualifier === "残り" ? 100 - value : value;
}

function metricId(provider: ProviderId, label: string, fallback: number) {
  if (provider === "codex" && label.includes("5時間")) return "codex-five-hour";
  if (provider === "codex" && label.includes("週あたり")) return "codex-weekly";
  if (provider === "claude" && /現在のセッション|current session/i.test(label)) return "claude-current-session";
  if (provider === "claude" && /週間制限|weekly|すべてのモデル/i.test(label)) return "claude-weekly";
  if (provider === "claude" && /ルーティン|routine/i.test(label)) return "claude-routines";
  if (provider === "claude" && /追加使用量|extra/i.test(label)) return "claude-extra";
  if (provider === "claude" && /claude\s*design/i.test(label)) return "claude-design";
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${provider}-${slug || fallback}`;
}
