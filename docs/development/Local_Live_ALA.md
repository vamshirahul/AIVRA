# Local-only live Application Rationalization

This is founder-authorized code for a **single-machine development demo**, not public/hosted AI activation, G5 approval or permission for Codex to make billable calls. Other modules, public AI endpoints and the original OpenAI factory hard stops remain unchanged.

## Private setup (founder only; may incur charges)

1. Use the existing pinned Node/npm and locked installation from README. Start from the repository root. Do not run multiple copies, proxies, tunnels, shared development servers or port forwards.
2. Create your own ignored `.env.local` privately. Never commit it, paste keys into the browser or share it in logs. `.env.example` contains names only; this implementation supplies no real keys, model choices, rates or positive spending defaults.
3. Set `AIVRA_AI_ENABLED=true` and `AIVRA_LOCAL_DEMO_ONLY=true`. Paid mode defaults on **only inside this independently activated mode**; set `AIVRA_LOCAL_PAID_ENABLED=true` explicitly for clarity. Set `AIVRA_LOCAL_FALLBACK_ENABLED=false` for the initial demo.
4. Supply your genuine `OPENAI_API_KEY` and explicit approved `AIVRA_PAID_MODEL_ID`. Choose an account-supported model with strict structured-output support; no model is auto-selected or evaluated by Codex.
5. Supply `AIVRA_LOCAL_PAID_BUDGET_USD` (>0, at most USD 10 campaign exposure) and positive integer `AIVRA_LOCAL_PAID_INPUT_MICRO_USD` / `AIVRA_LOCAL_PAID_OUTPUT_MICRO_USD`. One micro-USD is USD 0.000001. Use operator-verified conservative upward-rounded prices, including applicable overheads/fees; no production price is invented here.
6. OpenRouter is initially OFF. `AIVRA_FALLBACK_API_KEY` may be blank or a dummy placeholder while off: the factory returns before reading it, creates no fallback transport and never sends it. Exhausted paid allowance returns a controlled unavailable result, not an attempted fallback.
7. Run **`npm.cmd run dev:local-ala`** (or `npm run dev:local-ala`). The dedicated launcher binds **127.0.0.1:3000**, passes a fresh private process marker, and fails on a busy port. Open `http://localhost:3000/application-rationalization` or `http://127.0.0.1:3000/application-rationalization`. A matching Host/Origin is required. Optional `AIVRA_LOCAL_PORT` changes the one bound loopback port; default is 3000. Both browser URL and server must use that port.
8. Click Analyze applications explicitly. There are no requests on mount. Only actual validated model results can populate the existing grid/review workspace. No canned result or local recommendation engine is installed.

Ordinary `npm run dev` has no private launcher marker and cannot enable this path merely from `.env.local`. `npm start`, production builds, CI and Vercel execution cannot activate it even with the flags set. Keep activation flags off outside your private session. Restart the dedicated server after configuration changes; the server-owned service deliberately holds one fixed configuration for that process.

## Source boundary and output

The endpoint requires a strict DemoSession, known fixture identity, `synthetic:true`, an explicit synthetic-only declaration and request nonce. For this initial safety boundary the current deal must exactly match the bundled fictional fixture, not just a visitor-provided synthetic label. Free-text edits, CSV replacements and altered license/TSA/deal data are refused before provider construction. Use a fresh browser session if it was edited. Reset is destructive to tab edits; only choose it after preserving any work you need. This prevents accidentally forwarding real transaction text; it intentionally does not support arbitrary allegedly synthetic uploads.

The existing ALA prompt/schema, guarded router, source token, ID/side/action/evidence/coverage validation and server projection are reused. A validated original projection travels through the existing reviewed-export contract with an **empty** visitor review. The local client checks nonce, session/revision and source names/evidence against its captured snapshot before displaying it. This is an authorized loopback HTTP handoff, not a general JSON-import ownership grant for protected modules. There is no import-result UI or downstream publication. Review edits remain separate from original LLM results; financial/scenario/license/TSA/Playbook/Assistant/dashboard behavior is unchanged.

On app changes, Reset or unmount, in-flight display is revoked and stale results are hidden. Invalid results are never repaired. Failed calls preserve previous valid results and review edits for an unchanged source. Results/reviews remain in component memory and are lost on refresh/navigation; no new deal/result persistence is introduced.

## Limits and configuration

| Variable | Rule |
| --- | --- |
| `AIVRA_AI_ENABLED`, `AIVRA_LOCAL_DEMO_ONLY` | Both literal `true`, development mode and dedicated launcher required |
| `AIVRA_LOCAL_PAID_ENABLED` | Optional `true`/`false`; local paid defaults on |
| `AIVRA_LOCAL_FALLBACK_ENABLED` | Optional `true`/`false`; defaults OFF |
| `OPENAI_API_KEY`, `AIVRA_PAID_MODEL_ID` | Server environment only; required for enabled primary |
| `AIVRA_FALLBACK_API_KEY`, `AIVRA_FALLBACK_MODEL_ID`, `AIVRA_FALLBACK_PROVIDER` | Server only; enabled fallback requires a genuine non-placeholder key, explicit model and provider `openrouter` |
| `AIVRA_LOCAL_{PAID,FALLBACK}_BUDGET_USD` | Explicit >0 to USD 10 per enabled path; separate cumulative campaign caps |
| `AIVRA_LOCAL_{PAID,FALLBACK}_{INPUT,OUTPUT}_MICRO_USD` | Explicit positive integer per-token conservative prices per enabled path |
| `AIVRA_LOCAL_MAX_INPUT_BYTES` | Optional 1,024?128,000 bytes; default 128,000, full invocation plus output schema |
| `AIVRA_LOCAL_MAX_OUTPUT_TOKENS` | Optional 128?2,048; default 2,048, existing SDK/adapter bound preserved |
| `AIVRA_LOCAL_PORT` | Optional 1,024?65,535; default 3000, exclusive loopback bind |
| `AIVRA_LOCAL_OPEN_WEIGHT_APPROVED`, `AIVRA_LOCAL_OPEN_WEIGHT_EVIDENCE` | Required `true` and operator-verified HTTPS evidence for future enabled fallback; not global ADR-012 approval |
| `AIVRA_LOCAL_OPENROUTER_UPSTREAM` | Explicit single OpenRouter upstream/provider slug for future fallback |

Internal `AIVRA_LOCAL_ALA_LAUNCHER` / `AIVRA_LOCAL_ALA_PORT` are generated/set only by the launcher; do not put them in configuration or copy them to another server. One concurrent request maximum, five admitted requests per minute, twenty reservations across the campaign ledger. Request body is capped at 128,000 bytes with a three-second read deadline; complete invocation and schema face the existing independently configured cap. Provider timeout remains 15 seconds, browser timeout 25 seconds. No clipping, retries, background analysis or automatic result fabrication.

The full worst-case reservation is `(max_input_bytes + 512) * input_micro_usd + max_output_tokens * output_micro_usd`. Your cap must cover a whole reservation or no primary request is dispatched. Lower actual usage **does not refund** local exposure. This is intentionally conservative. Large/complex results may exceed the existing 2,048 output-token limit or model capability and be refused safely; no live compatibility/answer-quality claim has been established.

## Future OpenRouter activation ? no further code unit required

After separately deciding to incur fallback charges, configure the explicit open-weight model, its genuine key, `AIVRA_FALLBACK_PROVIDER=openrouter`, independent budget/rates, evidence/approval and upstream slug above. Then set `AIVRA_LOCAL_FALLBACK_ENABLED=true` and restart the dedicated local server. A dummy key is rejected when enabled. No automatic model selectors are accepted by the existing policy.

Only paid budget insufficiency or deliberate paid-disable may select fallback. Provider errors, timeouts, bad JSON/IDs, rates/capacity and store failures never trigger another provider. The pinned SDK already supports OpenAI-compatible chat requests, so no dependency was added. OpenRouter requests use its fixed HTTPS API, the exact configured model and `provider.only=[configured upstream]`, `allow_fallbacks=false`, `require_parameters=true`; SDK retries remain zero. OpenAI uses its fixed Responses API endpoint with `store:false`. Redirects are refused, streaming/tools are not enabled, and provider-supplied warning narratives are suppressed in the local model wrapper to avoid warning-log disclosure.

References: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Responses storage setting](https://developers.openai.com/api/docs/guides/migrate-to-responses), [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection). Exact account/model compatibility, real pricing, upstream availability and provider retention terms require operator verification; `store:false` is not a general confidentiality guarantee.

## Accounting, recovery and shutdown

`.local-ala/` is ignored by Git and is not a Next public directory. It contains only bounded request UUIDs, route, reserved micro-USD exposure, timestamps and accounting flags?no keys, prompts, application data, answers or review text. It is a real local file ledger, **not** the test fake usage store and **not** production authorization. Exclusive file creation locks one request across processes. Reservation is flushed before dispatch; atomic replacement retains exposure across restarts. Missing/corrupt initialized ledgers fail closed rather than creating fresh allowance. No automatic calendar reset exists; period fields in the reused router do not make this campaign accounting a monthly invoice.

Unknown usage/provider failure/timeout retains the full exposure **and an active unresolved record**; further execution is blocked. A crashed process may leave `request.lock`. Stop the server first. Review the provider's actual completion/billing and the cost-only ledger, retain a backup and reconcile unresolved flags/locks manually without deleting charges or inventing refunds. Restore a verified ledger backup if damaged; do not delete `initialized`/ledger to bypass limits. There is no HTTP reset or automatic lock expiry. Budget/key/model changes require restart; existing recorded charges remain accounted against configured caps.

These are estimates/exposure authorizations, not provider-enforced hard spend caps or guarantees against delayed billing, hidden fees, tokenizer assumptions, cancellation races, operator file changes, OS/disk failures, multiple checkout directories or malicious local processes. Configure provider-side spending limits/backstops before using real keys. Trusted single-machine local use is assumed; any local process can forge HTTP headers. Do not expose this dev server through tunnels/proxies. No enterprise/multi-user/public safety or durable cloud accounting is claimed.

Stop with Ctrl+C and set activation flags off for subsequent ordinary development. Do not delete the ledger on shutdown. To roll back code, revert this feature commit and keep the ledger/private configuration out of Git; retain/reconcile all recorded exposure. If a key was exposed, revoke/rotate it with the provider privately. Production/public deployment and all other live modules remain unauthorized.
