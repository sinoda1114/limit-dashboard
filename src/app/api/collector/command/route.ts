import { NextRequest, NextResponse } from "next/server";
import {
  createCollectorCommand,
  getCollectorCommand,
  updateCollectorStatus,
} from "@/lib/collector-command";
import { isAuthorizedCollector } from "@/lib/collector-auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  return NextResponse.json(await getCollectorCommand(), { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (body?.type === "status") {
    if (!isAuthorizedCollector(request)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: corsHeaders });
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
      { headers: corsHeaders }
    );
  }

  return NextResponse.json({ ok: true, ...(await createCollectorCommand()) }, { headers: corsHeaders });
}
