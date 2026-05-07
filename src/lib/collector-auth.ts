import type { NextRequest } from "next/server";

export function isAuthorizedCollector(request: NextRequest) {
  const token = process.env.COLLECTOR_INGEST_TOKEN;
  if (!token) return true;

  const auth = request.headers.get("authorization");
  return auth === `Bearer ${token}`;
}
