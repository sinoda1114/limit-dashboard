import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCollector } from "@/lib/collector-auth";
import type { ProviderId, ProviderSnapshot, UsageMetric } from "@/lib/usage-types";
import { publishUsage } from "@/lib/usage-events";
import {
  inferProvider,
  parseWebMetrics,
  providerName,
  readUsageStore,
  writeSnapshot,
} from "@/lib/usage-store";

function allowedOrigins() {
  const origins = new Set([
    "http://127.0.0.1:43177",
    "http://localhost:43177",
    "https://cursor.com",
    "https://chatgpt.com",
    "https://claude.ai",
  ]);

  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL;
  const vercelUrl = process.env.VERCEL_URL;
  if (dashboardUrl) origins.add(dashboardUrl.replace(/\/$/, ""));
  if (vercelUrl) origins.add(`https://${vercelUrl.replace(/\/$/, "")}`);
  return origins;
}

function corsHeadersFor(request?: NextRequest) {
  const origin = request?.headers.get("origin");
  const allowedOrigin = origin && allowedOrigins().has(origin) ? origin : "http://127.0.0.1:43177";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,content-type",
  };
}

function isAllowedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || allowedOrigins().has(origin);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://127.0.0.1:43177",
  "Vary": "Origin",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type",
};

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

export async function OPTIONS(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return new NextResponse(null, { status: 403, headers: corsHeaders });
  }

  return new NextResponse(null, { status: 204, headers: corsHeadersFor(request) });
}

export async function GET() {
  return NextResponse.json(await readUsageStore(), { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    if (!isAllowedOrigin(request)) {
      return NextResponse.json(
        { ok: false, error: "origin is not allowed" },
        { status: 403, headers: corsHeaders }
      );
    }

    if (!isAuthorizedCollector(request)) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401, headers: corsHeadersFor(request) }
      );
    }

    const body = (await request.json()) as IngestBody;
    const provider = body.provider ?? inferProvider(body.url);

    if (!provider) {
      return NextResponse.json(
        { ok: false, error: "provider is required or must be inferable from url" },
        { status: 400, headers: corsHeadersFor(request) }
      );
    }

    const metrics =
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
      metrics,
      status: metrics.length > 0 ? "ok" : "no-metrics",
      diagnostic:
        body.diagnostic ??
        (metrics.length > 0
          ? `${metrics.length} metric(s) collected`
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
    return NextResponse.json({ ok: true, store }, { headers: corsHeadersFor(request) });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown ingest error",
      },
      { status: 500, headers: corsHeadersFor(request) }
    );
  }
}
