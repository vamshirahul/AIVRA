# Local-live ALA validation

## Authorization and preflight

Founder authorized local-development-only ALA code with OpenAI primary and OpenRouter fallback wiring. Code development only: no billable tests, actual credentials, hosting, public deployment or live activation of other modules. Initial fallback remains OFF; dummy fallback credentials must not be read or sent. This is separate from U91/G5 release preparation and changes no approved baseline or decision register.

Origin `https://github.com/vamshirahul/AIVRA.git`; tracked tree/index initially clean, with only 15 approved documents untracked. Founder confirmation of merged PR #45 accepted without a merge-status recheck. Safe fetch/switch/ff-only synchronized main/origin/main to **57b401fb064f6b45ef6f8ac577f1d50cddd111d4**. Branch **codex/local-live-ala** created after hash verification. No reset, clean, stash, rebase or unrelated-work discard.

## Implementation

- Dedicated `dev:local-ala` launcher binds 127.0.0.1, default port 3000, with a fresh private process marker. Optional local port supports an occupied default without stopping another process.
- New `/api/local-ala` handler fails closed outside dedicated development execution; production/CI/Vercel, missing flags, nonlocal/mismatched Host/Origin, forwarded clients and missing custom header are denied before body/key/config access.
- Local-only capability and `UsageStore.kind=local-demo` permit only ALA through **existing createAIRouter**. Default/offline/public authorization paths remain unchanged; the local store is rejected as an offline store. Original `/api/ai/ala`, `/api/ai/playbook` and `createOpenAITransport` hard stops remain unchanged.
- Actual SDK factories: OpenAI Responses API and OpenRouter-compatible chat API via the installed OpenAI SDK provider. Fixed HTTPS URLs, no redirects or automatic retries. Explicit configured models, strict structured outputs and server-owned prompt are retained. OpenRouter pins one operator-configured upstream with internal fallback disabled. Disabled fallback is omitted before reading its key; enabled dummy credentials are rejected.
- Real cost-only local file ledger, independent primary/fallback exposure, exclusive lock across processes, one concurrent request, five admissions/minute and twenty campaign reservations. Full conservative reservations remain charged; successful low usage never refunds. Replayed/late receipts do not double charge or refund; proven overruns block. Uncertain usage/crash/corrupt state fails closed. This is not the TEST fake store, durable public authorization or a provider-enforced hard spending cap.
- Strict current DemoSession, known bundled fictional deal, nonce and byte/deadline checks. Edited/free-text/CSV deals are deliberately refused; a synthetic flag alone is insufficient. All existing ALA result/ID/side/evidence/coverage validation and server projection reused.
- Existing reviewed-export contract supplies a strict empty-review HTTP receipt to the local UI. Nonce/session/revision/current applications are checked before display. Original outputs remain distinct from visitor edits in the existing review workspace. Failure keeps prior current results; source changes/Reset/unmount suppress pending or stale results. No downstream result publication or new transaction persistence.

See [private setup and limitations](docs/development/Local_Live_ALA.md). No real values were written to `.env.local` or elsewhere. `.env.example` stays blank. No model or price was selected on the founder's behalf.

## Acceptance and evidence

| Requirement | Result | Evidence |
| --- | --- | --- |
| OpenAI primary and OpenRouter future wiring | PASS (offline wiring) | Existing ALA action suite intercepts both actual SDK request constructions before any network; exact HTTPS endpoint, model, JSON-schema format, store:false and pinned OpenRouter routing checked. No new completion fixture. |
| Existing guarded route and real local accounting | PASS | Existing structured fixture through actual ALA owner/router with local capability and real temporary ledger. Invalid/missing capability, wrong module and offline misuse rejected. |
| Initial dummy fallback never dispatched | PASS | Disabled fallback key getter deliberately throws if touched; untouched. Primary budget exhaustion with fallback off returns `fallback_unavailable`, zero provider dispatch. Enabling dummy key fails configuration. |
| Future explicit fallback activation | PASS (offline) | Same existing fixture through guarded local fallback when paid deliberately disabled; correct provider/mode/reason. Independent genuine-key/config gate and real SDK request format tested without network. |
| Loopback and missing-config hard stops | PASS | Exact Host/Origin and port, both local aliases, spoofed forwarded client, production/CI/hosted/missing markers/flags, invalid budget/model/key configuration and unchanged public 503 checked. |
| Source, request and response validation | PASS | Strict schemas, exact bundled source, altered-source/oversized/slow body rejection, existing ALA malformed-ID/disposition/provenance checks and local receipt nonce/session mismatch checks. No clipping or local recommendations. |
| Accounting preservation | PASS | Cross-instance lock exclusion, durable reserved exposure, replay settlement, unresolved receipt block and deleted initialized ledger refusal. Existing rate/fallback/error regressions reused. |
| Local UI connected / safe unavailable | PASS (providers OFF) | Actual dedicated local server and Chromium at1440/390/320; keyboard Analyze reaches guarded service with exact disabled-fallback code, no source changes, no overflow or external page requests. Hostile origin and original public endpoint return503. |
| Review rendering / source freshness | PASS (offline regressions) | Existing ALA grid/review/export suites; strict local receipt parser uses actual guarded specimen. Generation, abort and full current-source binding suppress asynchronous stale results. Populated real-model browser execution is NOT RUN. |
| One final check:ci | PASS | Exactly one completed `npm.cmd run check:ci`, exit 0; all registered regressions, TypeScript and production build. |
| Genuine API inference / model quality / billing | NOT RUN / UNAUTHORIZED | No real OpenAI/OpenRouter calls, keys or charges. Only intercepted SDK requests and existing offline specimens. |
| Public/hosted live AI, other modules, deployment | NOT RUN / UNAUTHORIZED | Remain disabled. This does not resolve broader public protected-result delivery/G5 blockers. |

## Focused commands / outcomes

- `npm.cmd run check:ala-action`: PASS, **10 groups**, including three added local groups; reused existing `data()`/fixture, no new response fixtures or test framework.
- `npm.cmd run check:ai-controls -- '--filter=default|protected import graph|independent fallback|provider error'`: PASS, **five groups**; unchanged public hard stops, independent caps, no retry/error failover and narrow import topology.
- `npm.cmd run check:ai-adapter`: PASS,14 groups. `check:ala-grid`: PASS,10 groups. `check:ala-review`: PASS,9 groups. `check:ala-export`: PASS,8 groups. TypeScript focused checks PASS.
- `npm.cmd run check:privacy-acceptance`: PASS before staging and within final CI across **116 production paths**, including all new runtime files. No private `.env.local` values inspected.
- Local browser: `AIVRA_LOCAL_ALA_BROWSER=1 AIVRA_BASE_URL=http://127.0.0.1:3130 AIVRA_CHROMIUM_PATH=<installed Chrome> node --conditions=react-server scripts/check-data-mapper-preview.mts --ala-browser`: PASS after fixes. Uses the existing harness, no fabricated HTTP/model responses. Local server was launched with BOTH `AIVRA_LOCAL_PAID_ENABLED=false` and `AIVRA_LOCAL_FALLBACK_ENABLED=false`, so no real key was read/used. Server stopped after testing.

Final production negative check: PASS with `NODE_ENV=production`, local activation flags and a marker-shaped value set, but both provider paths forced off. `/api/local-ala` refused both local and hostile origins with503; the public endpoint stayed503 and the public UI remained readiness-only. Existing production ALA Chromium regression PASS at1440/390/320: body-free public POST, no mount/Reset/navigation/refresh AI calls, pending double-click guard, stale/unmount suppression, unchanged session, zero external page requests. No private keys or model calls involved. These are actual disabled-path browser checks, not genuine-model UAT.

The default port3000 was already occupied; the launcher safely refused to bind. That process was not stopped or modified. Validation used3130 through the explicit local port configuration; default3000 remains the founder setup default.

Initial strengthened browser checks found two implementation defects before final CI: Next normalizes server URLs to localhost even when incoming Host/Origin are127.0.0.1; the guard now permits the two internal loopback aliases but still requires actual Host/Origin equality on the launcher port. Both disabled paths also needed distinct inert model IDs for the existing identity-isolation schema. Corrected both and reran focused Node/browser checks successfully. Final source includes no temporary diagnostics. The request-deadline test additionally confirms that canceled reads cannot accept a truncated valid JSON prefix.

## Final CI / review

**PASS: exactly one completed `npm.cmd run check:ci`, exit 0**, `AIVRA_AI_ENABLED=false`, `NEXT_TELEMETRY_DISABLED=1`. Log `.temp/local-ala/final-ci.log`, exit `.temp/local-ala/final-ci.exit`. No U90 acceptance suites rerun separately; they remain registered regressions. No real provider execution is permitted in CI.

Final `git diff --check` and exact staged-file review PASS. The full CI privacy check included all **116 staged production paths**, blank environment template and no high-confidence secret matches. No private environment/ledger or baseline files are staged. Hosted Actions not yet available before PR creation; no hosted PASS claimed. Stop immediately after opening the PR.

## Changed files and rollback

Runtime: `app/api/local-ala/route.ts`, `app/[module]/page.tsx`, `components/ala/analyze-applications.tsx`, `components/ala/local-analyze-applications.tsx`, `lib/ala/local-display.ts`, `lib/server/ai/local-authority.ts`, `lib/server/ai/router.ts`, `lib/server/ai/usage-store.ts`, and `lib/server/local-ala/{config,http,ledger,page-availability,providers}.ts`.

Operations: `scripts/dev-local-ala.mjs`, `package.json`, `.env.example`, `.gitignore`, `README.md`, `docs/development/Local_Live_ALA.md`.

Existing checks extended: `scripts/check-ala-action.mts`, `scripts/check-ai-controls.mts`, `scripts/check-ai-adapter.mts`, `scripts/check-ala-grid.mts`, `scripts/check-ala-review.mts`. Topology allowlists add only the new guarded local endpoint/provider seam, not arbitrary endpoints or adapter imports. No dependencies/lockfile, public endpoint implementation, original OpenAI factory, shared session, financial/scenario/TSA/license/Playbook/Assistant/dashboard calculation or provider configuration changed. The seven Future Features stay inert. Next-generated dev type-path changes from testing are excluded.

Rollback: stop the dedicated server, disable local flags, revert the single feature commit through review. Keep private keys and `.local-ala/` out of Git. Preserve/reconcile recorded exposure and unresolved requests; do not delete ledgers to regain allowance. No transaction schema/data migration or cloud rollback. Local counters are conservative estimates; provider spending backstops and trusted single-machine operations remain mandatory. Corrupt/missing initialized state or an uncertain live call may require manual reconciliation before another request.

## Limitations / remaining manual steps

Founder must privately supply genuine key, exact supported model, conservative rates and explicit budget before manual billable use. No real-model success/coverage/latency or provider retention/privacy/price compatibility has been verified. The existing max2048 output tokens can truncate complex portfolios; the app will reject invalid output, not fill missing analysis. Only bundled unmodified synthetic deal content is accepted. Results/reviews are volatile component memory; no public protected delivery or downstream integration is added. Any local process can forge headers; never expose/forward this dev server. Multiple checkout ledgers/operator file edits are not global billing enforcement. Future OpenRouter requires genuine key plus explicit config/approval and restart, not another development unit; it is OFF initially.

## Baseline preservation

All15 historical U90.03 hashes matched at preflight and remain untracked/excluded. Final recheck PASS for all 15 (`.temp/local-ala/final-baseline-checks.json`); all remain unchanged, untracked and unstaged. No authoritative document or register was rewritten.

| File | SHA-256 | Historical match |
| --- | --- | --- |
| `docs/architecture/AIVRA_Public_Preview_G1_Architecture_Options_v0.1.md` | `14FB2C3F85BFE33B3B4A0E1F67EE08FAD122BD2CCD34530463A93FA61DBE43ED` | MATCH |
| `docs/architecture/AIVRA_Public_Preview_G1_UIUX_v0.1.md` | `C45E82C796580A6EB2E53AB19C7DCE26FC92C499708D851C83BBAA98F328A336` | MATCH |
| `docs/architecture/G1_Approval_Record_2026-10-30.md` | `8D3548B4463DB32321AB5EAA2F5A5A4DDE6D75011714152A0CF87B643F26C698` | MATCH |
| `docs/discovery/AIVRA_Project_Intake_v0.2.md` | `1AAF79B7E948D462C8D3B5444886B645484D838C6187FF7AA2AEB375C8A72D1D` | MATCH |
| `docs/discovery/AIVRA_Public_Preview_G0_Requirements_v0.2.md` | `128B3B509D1911C45AAB0731AF98BB7A3EC883FA678375E96D6EB5CD13021FCF` | MATCH |
| `docs/discovery/G0_Approval_Record.md` | `3E12E9B38CF6BE5F4C6A0E8980B4609DB1607A140F782998F9B1D2838E644DC2` | MATCH |
| `docs/implementation/AIVRA_Public_Preview_G2_Implementation_Plan_v0.1.md` | `2E533B640FC6ECDF69D751644609A11BA89A7702405DFFC9084935E95A1C3D22` | MATCH |
| `docs/implementation/G2_Approval_Record_2026-10-30.md` | `4ABD6201A1067B3F3B8CE0CADD0944926DBEC7535F7D614E1933489DA61374F0` | MATCH |
| `docs/implementation/G2_Review_Checklist_v0.1.md` | `50782E9653EFF340B73122ACD170E708AC1048974239D697108977499903C2CE` | MATCH |
| `docs/implementation/U00.01_Codex_Packet_rev1_READY_FOR_APPROVAL.md` | `BC2D4BCAA21A952A853054DE6E399D3C02F8134802C17E903624D753567BF91E` | MATCH |
| `docs/registers/decision-register.csv` | `EDC4C564D7D7BAEC097E8415D66588C13DF11255F8025782D755960D36DF5A11` | MATCH |
| `docs/registers/risk-register.csv` | `2E79864D485F6203293DF71E57D4EE67D08B849AC888DD8363DABBE077A3F0B3` | MATCH |
| `docs/registers/unit-register.csv` | `B1E08E10CB695628E34B7B121F5E90027EB63FB3BC69825CC38A0EFEEADE18AC` | MATCH |
| `docs/ux-preview/AIVRA_Light_Theme_Options_A1_A2_A3.html` | `EA57E7C9508B0C1FFBED4FEFC1851045CBF9725BD2807510EB687F673CB711EB` | MATCH |
| `docs/ux-preview/AIVRA_Theme_Decision_v0.1.md` | `68102CD64DCDC7FEF4596DD365134E46DF8F1EEB6E4D0ACC99E50FD5C982B731` | MATCH |
