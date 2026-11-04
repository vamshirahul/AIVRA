export const runtime = "nodejs";

// Availability only: deliberately no request argument, imports or activation path.
export function POST() {
  return Response.json({ status: "error", error: {
    code: "ai_controls_not_ready", request_id: null,
    message: "Live Playbook AI is not enabled. Availability check only.",
  } }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
