export const runtime = "nodejs";

// Unconditional availability rejection. No request argument/body, imports or activation switch.
export function POST() {
  return Response.json({ status: "error", error: {
    code: "ai_controls_not_ready", request_id: null,
    message: "Live AI analysis is not enabled. Availability check only.",
  } }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
