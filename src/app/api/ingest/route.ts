import { NextRequest, NextResponse } from "next/server";
import {
  corsHeadersForCollector,
  corsHeadersForDashboard,
  isAllowedCollectorOrigin,
  isAllowedDashboardOrigin,
  isAllowedDashboardReferer,
  isAuthorizedCollector,
} from "@/lib/collector-auth";
import type { ProviderId, ProviderSnapshot, UsageMetric } from "@/lib/usage-types";
import { publishUsage } from "@/lib/usage-events";
import {
  inferProvider,
  parseWebMetrics,
  providerName,
  readUsageStore,
  writeSnapshot,
} from "@/lib/usage-store";

type IngestBody = {
  provider?: ProviderId;
  source?: ProviderSnapshot["source"];
  url?: string;
  title?: string;
  plan?: string;
  metrics?: UsageMetric[];
  rawText?: string;
  diagnostic?: string;
};

const ALLOWED_PROVIDERS = new Set<ProviderId>(["cursor", "codex", "claude"]);
const MAX_RAW_TEXT_LENGTH = 4000;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 256;
const MAX_PLAN_LENGTH = 256;
const MAX_DIAGNOSTIC_LENGTH = 1024;
const ALLOWED_SOURCES = new Set<ProviderSnapshot["source"]>(["web-collector", "claude-statusline"]);

function sanitizeString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.slice(0, maxLength) : undefined;
}

export async function OPTIONS(request: NextRequest) {
  if (!isAllowedCollectorOrigin(request, false)) {
    return new NextResponse(null, { status: 403, headers: corsHeadersForCollector(request) });
  }

  return new NextResponse(null, { status: 204, headers: corsHeadersForCollector(request) });
}

export async function GET(request: NextRequest) {
  // Browser fetch to same-origin may omit Origin header, so allow dashboard Referer as fallback.
  const isDashboardRequest = isAllowedDashboardOrigin(request, false) || isAllowedDashboardReferer(request);
  if (!isDashboardRequest && !isAuthorizedCollector(request)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: corsHeadersForDashboard(request) }
    );
  }

  return NextResponse.json(await readUsageStore(), { headers: corsHeadersForDashboard(request) });
}

export async function POST(request: NextRequest) {
  try {
    if (!isAllowedCollectorOrigin(request)) {
      return NextResponse.json(
        { ok: false, error: "origin is not allowed" },
        { status: 403, headers: corsHeadersForCollector(request) }
      );
    }

    if (!isAuthorizedCollector(request)) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401, headers: corsHeadersForCollector(request) }
      );
    }

    const rawBody = (await request.json()) as Record<string, unknown> | null;
    if (!rawBody || typeof rawBody !== "object") {
      return NextResponse.json(
        { ok: false, error: "invalid request body" },
        { status: 400, headers: corsHeadersForCollector(request) }
      );
    }

    if (rawBody.provider != null && (typeof rawBody.provider !== "string" || !ALLOWED_PROVIDERS.has(rawBody.provider as ProviderId))) {
      return NextResponse.json(
        { ok: false, error: "provider is invalid" },
        { status: 400, headers: corsHeadersForCollector(request) }
      );
    }

    const source =
      typeof rawBody.source === "string" && ALLOWED_SOURCES.has(rawBody.source as ProviderSnapshot["source"])
        ? (rawBody.source as ProviderSnapshot["source"])
        : undefined;
    const metrics = Array.isArray(rawBody.metrics) ? (rawBody.metrics as UsageMetric[]) : undefined;

    const body: IngestBody = {
      provider: rawBody.provider as ProviderId | undefined,
      source,
      url: sanitizeString(rawBody.url, MAX_URL_LENGTH),
      title: sanitizeString(rawBody.title, MAX_TITLE_LENGTH),
      plan: sanitizeString(rawBody.plan, MAX_PLAN_LENGTH),
      diagnostic: sanitizeString(rawBody.diagnostic, MAX_DIAGNOSTIC_LENGTH),
      rawText: sanitizeString(rawBody.rawText, MAX_RAW_TEXT_LENGTH),
      metrics,
    };
    const provider = body.provider ?? inferProvider(body.url);

    if (!provider) {
      return NextResponse.json(
        { ok: false, error: "provider is required or must be inferable from url" },
        { status: 400, headers: corsHeadersForCollector(request) }
      );
    }

    const parsedMetrics =
      body.metrics?.filter((metric) => metric.usedPercentage == null || Number.isFinite(metric.usedPercentage)) ??
      (body.rawText ? parseWebMetrics(provider, body.rawText) : []);

    const snapshot: ProviderSnapshot = {
      provider,
      name: providerName(provider),
      source: body.source ?? "web-collector",
      url: body.url,
      title: body.title,
      plan: body.plan,
      collectedAt: new Date().toISOString(),
      metrics: parsedMetrics,
      status: parsedMetrics.length > 0 ? "ok" : "no-metrics",
      diagnostic:
        body.diagnostic ??
        (parsedMetrics.length > 0
          ? `${parsedMetrics.length} metric(s) collected`
          : `Collector reached page, but no usage percentages were detected. rawText length: ${
              body.rawText?.length ?? 0
            }`),
      rawText:
        process.env.COLLECTOR_DEBUG_RAW === "1"
          ? body.rawText?.slice(0, 4000)
          : undefined,
    };

    const store = await writeSnapshot(snapshot);
    publishUsage(store);
    return NextResponse.json({ ok: true, store }, { headers: corsHeadersForCollector(request) });
  } catch (error) {
    const errorMessage = process.env.NODE_ENV === "production" ? "ingest failed" : error instanceof Error ? error.message : "Unknown ingest error";
    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
      },
      { status: 500, headers: corsHeadersForCollector(request) }
    );
  }
}
