import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fixture } from "./check-playbook-review.mts";
import { createPlaybookReviewSource } from "../lib/server/playbook/review-source.ts";
import { PlaybookOutcomeSchema } from "../lib/server/playbook/generate.ts";
import { createPlaybookReviewDraft, projectPlaybookReview, savePlaybookEdit, readPlaybookSource, restorePlaybookRow } from "../lib/playbook-generator/review-draft.ts";
import { capturePlaybookExport, preparePlaybookDownload, downloadReviewedPlaybook, revokePlaybookExport, playbookMarkdownText, MAX_PLAYBOOK_EXPORT_BYTES, PLAYBOOK_EXPORT_VERSION } from "../lib/playbook-generator/review-export.ts";
import type { PlaybookExportState, PlaybookExportPermit } from "../lib/playbook-generator/review-export.ts";
import type { DownloadPort } from "../lib/ala/review-export.ts";
import { updateTSA, createDemoSession } from "../lib/session/session.ts";
import { POST } from "../app/api/ai/playbook/route.ts";

// Fabricated owner/provider/store only. No file/parser/boolean is authority.
const originalFetch = globalThis.fetch; let network = 0, groups = 0;
globalThis.fetch = async () => { network++; throw Error("Offline export test forbids network"); };
async function check(name: string, test: () => unknown | Promise<unknown>) { await test(); groups++; console.log(`PASS: ${name}`); }
async function setup() {
  const f = await fixture(true); let state: PlaybookExportState | null = { source: f.source, draft: f.draft, session: f.read().current_session, editing: false, revision: 0 };
  return { f, read: () => state, set: (v: PlaybookExportState | null) => { state = v; }, get: () => state! };
}
async function capture(s: Awaited<ReturnType<typeof setup>>) { const r = await capturePlaybookExport(s.read); assert.ok(r.ok, JSON.stringify(r)); return r.permit; }
function prepare(p: PlaybookExportPermit, format: "md" | "json") { const r = preparePlaybookDownload(p, format); assert.ok(r.ok, JSON.stringify(r)); return r; }
function edit(s: Awaited<ReturnType<typeof setup>>, kind: "activity" | "milestone", id: string, values: Record<string, string | null>) {
  const state = s.get(), r = savePlaybookEdit(state.source, state.draft, { binding: state.draft!.binding, kind, id, values, visitor_reason: "Offline visitor justification — not approval" }); assert.ok(r.ok); s.set({ ...state, draft: r.draft, revision: state.revision + 1 });
}
try {
  await check("G2 exact REQ-043/U04.03 authority, prerequisite sources and existing protected contracts", async () => {
    assert.match(await readFile("docs/registers/unit-register.csv", "utf8"), /U04.04,M04 Playbook,Export reviewed playbook Markdown plus structured data,U04.03,REQ-043,[^\r\n]*Markdown and JSON export carry draft caveat and current revisions/);
    for (const p of ["docs/contracts/U04.01_Playbook_Contract.md", "docs/contracts/U04.02_Playbook_Guarded_Generation_Contract.md", "docs/contracts/U04.03_Playbook_Review_Edit_Contract.md", "lib/server/playbook/review-source.ts"]) assert.ok((await readFile(p, "utf8")).length);
  });
  await check("real issued owner required; clone/import/schema/boolean/null/stale-binding/forged-permit bypasses refused", async () => {
    const s = await setup(), { f } = s;
    for (const source of [null, { authorized: true, original: f.result }, JSON.parse(JSON.stringify(f.source)), createPlaybookReviewSource(f.owner, structuredClone(f.result), f.read, f.subscribe)]) { s.set({ ...s.get(), source: source as never }); assert.equal((await capturePlaybookExport(s.read)).ok, false); }
    s.set({ source: f.source, draft: { ...f.draft, binding: { ...f.draft.binding, request_id: crypto.randomUUID() } }, session: f.read().current_session, editing: false, revision: 0 }); assert.equal((await capturePlaybookExport(s.read)).ok, false);
    assert.equal(preparePlaybookDownload({} as never, "json").ok, false);
    assert.ok(PlaybookOutcomeSchema.safeParse(f.result).success); assert.equal(createPlaybookReviewDraft(JSON.parse(JSON.stringify(f.result))), null);
  });
  await check("strict versioned JSON round-trip, original vs overlay/effective parity, Unicode/null/order/provenance", async () => {
    const s = await setup(), original = JSON.stringify(s.f.result), before = JSON.stringify(s.f.read());
    const p = projectPlaybookReview(s.f.source, s.get().draft)!;
    edit(s, "activity", "activity_0", { ...p.activities[0].values, title: "Visitor café 🌊 title", description: "Exact\r\nUnicode Δ\ttext", ownership_role: null } as never);
    edit(s, "milestone", "milestone_1", { title: "Proposed milestone", proposed_date: null, date_assumption: null });
    const permit = await capture(s), json = prepare(permit, "json"), a = JSON.parse(json.content);
    assert.equal(a.contract_version, PLAYBOOK_EXPORT_VERSION); assert.deepEqual(Object.keys(a), ["contract_version", "artifact_kind", "illustrative_unapproved", "disclosures", "original", "review", "effective", "source_identity"]);
    assert.deepEqual(a.original, s.f.result); assert.deepEqual(a.review, s.get().draft); assert.equal(a.effective.phases[0].activities[0].values.title, "Visitor café 🌊 title"); assert.equal(a.effective.phases[0].activities[0].original.title, "Fabricated discovery activity");
    assert.equal(a.effective.phases[1].milestones[0].values.proposed_date, null); assert.equal(a.original.envelope.data.milestones[1].proposed_date, "2027-01-31");
    assert.equal(a.effective.phases[0].activities[0].values.description, "Exact\r\nUnicode Δ\ttext"); assert.deepEqual(a.source_identity.coverage, s.f.result.status !== "error" && s.f.result.coverage);
    assert.deepEqual(a.effective.phases.map((p: { phase: { sequence: number } }) => p.phase.sequence), [1, 2]); assert.equal(prepare(permit, "json").content, json.content);
    assert.equal(JSON.stringify(s.f.result), original); assert.equal(JSON.stringify(s.f.read()), before); assert.equal(s.f.calls(), 1);
    const md = prepare(permit, "md"); for (const text of ["NOT APPROVED", "Visitor café 🌊 title", "Original AI provenance", "Original dependency activity IDs", "Original after-activity IDs", "risk", "Unknown / not supplied", "visitor", "Original limitations", "incomplete"]) assert.ok(md.content.includes(text), text);
    assert.equal(json.mime, "application/json;charset=utf-8"); assert.equal(md.mime, "text/markdown;charset=utf-8"); assert.equal(md.filename, "aivra-playbook-reviewed-v1.md"); assert.equal(json.filename, "aivra-playbook-reviewed-v1.json"); revokePlaybookExport(permit);
  });
  await check("Markdown injection, HTML, links, fences, entity/bidi/control breakouts represented literally", async () => {
    const hostile = '# APPROVED\r\n![x](https://evil.invalid)\n```\n<script>bad()</script>|[x][y]&lt;\u0000\u001b\u202e';
    const safe = playbookMarkdownText(hostile); assert.doesNotMatch(safe, /[<>`|\r\n\u0000\u001b\u202e]/); assert.ok(safe.includes("&#35; APPROVED")); assert.ok(safe.includes("&#92;u202e"));
    // Decode numeric references only, AFTER Markdown tokenization: no second parse.
    const decoded = safe.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))); assert.equal(decoded, hostile.replace(/[\r\n\u0000\u001b\u202e]/g, c => `\\u${c.codePointAt(0)!.toString(16).padStart(4, "0")}`));
    const s = await setup(), p = projectPlaybookReview(s.f.source, s.get().draft)!; edit(s, "activity", "activity_0", { ...p.activities[0].values, title: "# APPROVED <img src=x>", description: hostile, ownership_role: "[CEO](https://evil.invalid)" } as never);
    const permit = await capture(s), md = prepare(permit, "md"); assert.doesNotMatch(md.content, /<img|<script|^# APPROVED|!\[x\]|```|\u202e/m); assert.equal(JSON.parse(prepare(permit, "json").content).review.overrides[0].changes.description, hostile); revokePlaybookExport(permit);
  });
  await check("dirty/open form, Save/Cancel/Restore/navigation/unmount/session/reset/draft-content changes revoke permanently", async () => {
    for (const mutate of [(v: PlaybookExportState) => ({ ...v, editing: true }), (v: PlaybookExportState) => ({ ...v, revision: v.revision + 1 }), (v: PlaybookExportState) => ({ ...v, draft: structuredClone(v.draft) }), (v: PlaybookExportState) => ({ ...v, session: createDemoSession() }), (v: PlaybookExportState) => ({ ...v, session: updateTSA(v.session!, v.session!.current_deal.tsa_services[0].tsa_id, { status: "active" }) }), () => null]) {
      const s = await setup(), before = s.get(), permit = await capture(s); s.set(mutate(before)); assert.equal(preparePlaybookDownload(permit, "json").ok, false); s.set(before); assert.equal(preparePlaybookDownload(permit, "md").ok, false);
    }
    const s = await setup(), permit = await capture(s); revokePlaybookExport(permit); assert.equal(preparePlaybookDownload(permit, "json").ok, false); s.set({ ...s.get(), editing: true }); assert.equal((await capturePlaybookExport(s.read)).ok, false);
  });
  await check("protected source/review/scenario revocation, replacement and digest-await races cannot download", async () => {
    const s = await setup(), permit = await capture(s), changed = structuredClone(s.f.read()); changed.selected_scenario = "baseline"; s.f.replace(changed); assert.equal(preparePlaybookDownload(permit, "md").ok, false);
    const r = await setup(), pending = capturePlaybookExport(r.read); r.set({ ...r.get(), editing: true, revision: 1 }); assert.equal((await pending).ok, false);
    const t = await setup(), p = await capture(t), replacement = await t.f.owner.generate(t.f.read, { client_key: "a".repeat(64) }); t.set({ ...t.get(), source: createPlaybookReviewSource(t.f.owner, replacement, t.f.read, t.f.subscribe) }); assert.equal(preparePlaybookDownload(p, "json").ok, false);
    const raw = await setup(), session = structuredClone(raw.get().session!); session.current_deal.tsa_services[0].title = "Unversioned local mismatch"; raw.set({ ...raw.get(), session }); assert.equal((await capturePlaybookExport(raw.read)).ok, false);
  });
  await check("bounded UTF8 capture and independent format-size refusal without truncation (instrumented boundary)", async () => {
    const Native = globalThis.TextEncoder, s = await setup();
    // Valid source bounds are much smaller than 1.5MB. Inject measured encoder
    // results only at the export boundary to exercise otherwise defensive branches.
    class SizedEncoder extends Native { encode(v?: string) { return v?.startsWith('{"contract_version":"playbook/review-export/v1"') ? new Uint8Array(MAX_PLAYBOOK_EXPORT_BYTES + 1) : super.encode(v); } }
    try { globalThis.TextEncoder = SizedEncoder; const r = await capturePlaybookExport(s.read); assert.ok(!r.ok && r.code === "export_too_large"); } finally { globalThis.TextEncoder = Native; }
    const jsonPermit = await capture(s);
    try { globalThis.TextEncoder = SizedEncoder; const r = preparePlaybookDownload(jsonPermit, "json"); assert.ok(!r.ok && r.code === "export_too_large"); } finally { globalThis.TextEncoder = Native; }
    assert.equal(preparePlaybookDownload(jsonPermit, "md").ok, false);
    const permit = await capture(s);
    class MarkdownSizeEncoder extends Native { encode(v?: string) { return v?.startsWith("# Reviewed integration") ? new Uint8Array(MAX_PLAYBOOK_EXPORT_BYTES + 1) : super.encode(v); } }
    try { globalThis.TextEncoder = MarkdownSizeEncoder; const r = preparePlaybookDownload(permit, "md"); assert.ok(!r.ok && r.code === "export_too_large"); } finally { globalThis.TextEncoder = Native; }
    assert.equal(preparePlaybookDownload(permit, "json").ok, false); assert.equal(new Native().encode("🌊").length, 4);
  });
  await check("Blob bytes/MIME/names, all port failures cleanup, delayed callbacks and stale append guards", async () => {
    const s = await setup();
    for (const failAt of ["none", "url", "anchor", "append", "click", "remove", "defer", "stale"]) {
      const p = await capture(s); let urls = 0, revoked = 0, removed = 0, clicks = 0, blob: Blob | null = null; const a = { href: "", download: "", click() { if (failAt === "click") throw Error("secret"); clicks++; }, remove() { removed++; if (failAt === "remove") throw Error(); } };
      const port: DownloadPort = { createURL(b) { if (failAt === "url") throw Error(); blob = b; urls++; return "blob:offline"; }, createAnchor() { if (failAt === "anchor") throw Error(); return a; }, appendAnchor() { if (failAt === "append") throw Error(); if (failAt === "stale") s.set({ ...s.get(), revision: s.get().revision + 1 }); }, revokeURL() { revoked++; }, deferCleanup(f) { if (failAt === "defer") throw Error(); f(); } };
      const result = downloadReviewedPlaybook(p, "json", port); assert.equal(result.ok, failAt === "none"); assert.equal(revoked, urls); if (failAt !== "url" && failAt !== "anchor") assert.equal(removed, 1); if (failAt === "stale") assert.equal(clicks, 0);
      if (failAt === "none") { assert.equal((blob as unknown as Blob).type, "application/json;charset=utf-8"); assert.equal(await (blob as unknown as Blob).text(), prepare(p, "json").content); assert.equal(a.download, "aivra-playbook-reviewed-v1.json"); }
      revokePlaybookExport(p);
    }
  });
  await check("Restore affects only new captures; public503/no-store, no client server import/storage/provider changes", async () => {
    const s = await setup(), p = projectPlaybookReview(s.f.source, s.get().draft)!; edit(s, "activity", "activity_0", { ...p.activities[0].values, title: "Visitor export title" } as never); const permit = await capture(s);
    const restored = restorePlaybookRow(s.f.source, s.get().draft, "activity", "activity_0"); assert.ok(restored.ok); s.set({ ...s.get(), draft: restored.draft, revision: s.get().revision + 1 }); assert.equal(preparePlaybookDownload(permit, "md").ok, false);
    const next = await capture(s); assert.equal(JSON.parse(prepare(next, "json").content).review.overrides.length, 0); revokePlaybookExport(next);
    const r = POST(); assert.equal(r.status, 503); assert.equal(r.headers.get("cache-control"), "no-store");
    const code = (await readFile("lib/playbook-generator/review-export.ts", "utf8")).replace(/^import type .*$/gm, ""); assert.doesNotMatch(code, /server-only|lib\/server|fetch\(|sessionStorage|localStorage|process\.env|dangerouslySetInnerHTML/); assert.equal(network, 0);
    const f = await fixture(true), replacement = await f.owner.generate(f.read, { client_key: "a".repeat(64) }); await mkdir(".temp/u04-04", { recursive: true }); await writeFile(".temp/u04-04/fixture.json", JSON.stringify({ session: f.read().current_session, view: readPlaybookSource(f.source), replacementView: readPlaybookSource(createPlaybookReviewSource(f.owner, replacement, f.read, f.subscribe)) }));
  });
  console.log(`PASS: ${groups} U04.04 groups; owner-issued export, lossless JSON, safe Markdown, atomic refusal, immutable originals; zero network.`);
} finally { globalThis.fetch = originalFetch; }
