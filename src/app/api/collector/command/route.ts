import { NextRequest, NextResponse } from "next/server";
import {
  createCollectorCommand,
  getCollectorCommand,
  updateCollectorStatus,
} from "@/lib/collector-command";
import {
  corsHeadersForDashboard,
  isAllowedDashboardOrigin,
  isAuthorizedCollector,
} from "@/lib/collector-auth";

export async function OPTIONS(request: NextRequest) {
  if (!isAllowedDashboardOrigin(request, false)) {
    return new NextResponse(null, { status: 403, headers: corsHeadersForDashboard(request) });
  }
  return new NextResponse(null, { status: 204, headers: corsHeadersForDashboard(request) });
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCollector(request)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: corsHeadersForDashboard(request) }
    );
  }
  return NextResponse.json(await getCollectorCommand(), { headers: corsHeadersForDashboard(request) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (body?.type === "status") {
    if (!isAuthorizedCollector(request)) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401, headers: corsHeadersForDashboard(request) }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        status: await updateCollectorStatus({
          state: body.state ?? "idle",
          commandId: body.commandId,
          message: body.message ?? "Collector status updated.",
        }),
      },
      { headers: corsHeadersForDashboard(request) }
    );
  }

  if (!isAllowedDashboardOrigin(request, false) && !isAuthorizedCollector(request)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: corsHeadersForDashboard(request) }
    );
  }

  return NextResponse.json(
    { ok: true, ...(await createCollectorCommand()) },
    { headers: corsHeadersForDashboard(request) }
  );
}
