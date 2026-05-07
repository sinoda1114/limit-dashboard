import { NextRequest, NextResponse } from "next/server";
import {
  corsHeadersForDashboard,
  isAllowedDashboardOrigin,
  isAllowedDashboardReferer,
} from "@/lib/collector-auth";
import { readUsageStore } from "@/lib/usage-store";
import { subscribeUsage } from "@/lib/usage-events";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function event(store: unknown) {
  return encoder.encode(`event: usage\ndata: ${JSON.stringify(store)}\n\n`);
}

function heartbeat() {
  return encoder.encode(`event: ping\ndata: {}\n\n`);
}

export async function GET(request: NextRequest) {
  // EventSource may omit Origin, so we fallback to Referer.
  if (!isAllowedDashboardOrigin(request, false) && !isAllowedDashboardReferer(request)) {
    return NextResponse.json(
      { ok: false, error: "origin is not allowed" },
      { status: 403, headers: corsHeadersForDashboard(request) }
    );
  }

  let unsubscribe = () => {};
  let heartbeatId: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(event(await readUsageStore()));

      unsubscribe = subscribeUsage((store) => {
        controller.enqueue(event(store));
      });

      heartbeatId = setInterval(() => {
        controller.enqueue(heartbeat());
      }, 15000);
    },
    cancel() {
      if (heartbeatId) clearInterval(heartbeatId);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...corsHeadersForDashboard(request),
    },
  });
}
