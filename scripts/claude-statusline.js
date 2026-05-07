#!/usr/bin/env node

const endpoint = process.env.AI_USAGE_DASHBOARD_URL ?? "http://127.0.0.1:43177/api/ingest";
const token = process.env.COLLECTOR_INGEST_TOKEN ?? process.env.AI_USAGE_DASHBOARD_TOKEN ?? "";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function metric(label, windowName, value) {
  if (!value || typeof value.used_percentage !== "number") return null;
  return {
    id: `claude-${windowName}`,
    label,
    usedPercentage: Math.round(value.used_percentage),
    resetAt: value.resets_at,
    detail: value.remaining ? `Remaining: ${value.remaining}` : undefined,
  };
}

(async () => {
  const raw = await readStdin();
  const payload = JSON.parse(raw || "{}");
  const rateLimits = payload.rate_limits ?? payload.rateLimits ?? {};
  const metrics = [
    metric("5 hour limit", "five-hour", rateLimits.five_hour),
    metric("7 day limit", "seven-day", rateLimits.seven_day),
  ].filter(Boolean);

  if (metrics.length > 0) {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;

    await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: "claude",
        source: "claude-statusline",
        url: "claude-code://statusline",
        metrics,
      }),
    });
  }

  const fiveHour = metrics.find((item) => item.id === "claude-five-hour");
  const sevenDay = metrics.find((item) => item.id === "claude-seven-day");
  const five = fiveHour ? `${100 - fiveHour.usedPercentage}%` : "?";
  const seven = sevenDay ? `${100 - sevenDay.usedPercentage}%` : "?";
  process.stdout.write(`Claude ${five} / weekly ${seven}`);
})().catch(() => {
  process.stdout.write("Claude usage unavailable");
});
