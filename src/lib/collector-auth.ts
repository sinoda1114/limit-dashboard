import type { NextRequest } from "next/server";

function dashboardOrigins() {
  const origins = new Set([
    "http://127.0.0.1:43177",
    "http://localhost:43177",
  ]);

  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL;
  const vercelUrl = process.env.VERCEL_URL;
  if (dashboardUrl) origins.add(dashboardUrl.replace(/\/$/, ""));
  if (vercelUrl) origins.add(`https://${vercelUrl.replace(/\/$/, "")}`);
  return origins;
}

function collectorOrigins() {
  const origins = dashboardOrigins();
  origins.add("https://cursor.com");
  origins.add("https://chatgpt.com");
  origins.add("https://claude.ai");
  return origins;
}

export function isAllowedDashboardOrigin(request: NextRequest, allowMissingOrigin = true) {
  const origin = request.headers.get("origin");
  if (!origin) return allowMissingOrigin;
  return dashboardOrigins().has(origin);
}

export function isAllowedDashboardReferer(request: NextRequest) {
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return dashboardOrigins().has(new URL(referer).origin);
  } catch {
    return false;
  }
}

export function isAllowedCollectorOrigin(request: NextRequest, allowMissingOrigin = true) {
  const origin = request.headers.get("origin");
  if (!origin) return allowMissingOrigin;
  return collectorOrigins().has(origin);
}

export function corsHeadersForDashboard(request?: NextRequest) {
  const origin = request?.headers.get("origin");
  const allowedOrigin = origin && dashboardOrigins().has(origin) ? origin : "http://127.0.0.1:43177";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,content-type",
  };
}

export function corsHeadersForCollector(request?: NextRequest) {
  const origin = request?.headers.get("origin");
  const allowedOrigin = origin && collectorOrigins().has(origin) ? origin : "http://127.0.0.1:43177";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,content-type",
  };
}

export function isAuthorizedCollector(request: NextRequest) {
  const token = process.env.COLLECTOR_INGEST_TOKEN;
  if (!token) {
    return !process.env.VERCEL;
  }

  const auth = request.headers.get("authorization");
  return auth === `Bearer ${token}`;
}
