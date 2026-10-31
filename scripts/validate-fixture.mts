import assert from "node:assert/strict";
import { SyntheticDealFixtureSchema } from "../lib/contracts/demo.ts";
import { loadSyntheticDealFixture } from "../lib/fixtures/synthetic-deal.ts";

const fixture = loadSyntheticDealFixture();
assert.equal(SyntheticDealFixtureSchema.safeParse(fixture).success, true);
assert.equal(fixture.applications.filter((app) => app.company_side === "buyer").length, 15);
assert.equal(fixture.applications.filter((app) => app.company_side === "target").length, 15);
assert.equal(fixture.license_positions.length, 10);
assert.equal(fixture.tsa_services.length, 5);
const ids = [
  ...fixture.applications.map((app) => app.app_id),
  ...fixture.license_positions.map((license) => license.license_id),
  ...fixture.tsa_services.map((tsa) => tsa.tsa_id),
];
assert.equal(new Set(ids).size, ids.length);
const apps = new Map(fixture.applications.map((app) => [app.app_id, app]));
for (const license of fixture.license_positions) {
  assert.ok(apps.has(license.app_id));
  assert.equal(license.vendor, apps.get(license.app_id)?.vendor);
}
for (const tsa of fixture.tsa_services) {
  assert.ok(tsa.related_app_ids?.length);
  for (const id of tsa.related_app_ids) assert.ok(apps.has(id));
}
assert.ok(fixture.applications.some((app) => app.annual_cost === null));
assert.ok(fixture.applications.some((app) => app.annual_cost === 0));
assert.ok(fixture.license_positions.some((license) => license.seats_used === null));
assert.ok(fixture.license_positions.some((license) => license.seats_used === 0));
assert.equal(fixture.synthetic, true);
assert.equal(fixture.buyer_name, "Northstar");
assert.equal(fixture.target_name, "Meridian");
assert.equal(fixture.currency, "CAD");
assert.match(fixture.disclosure, /fictional/i);
const exported = SyntheticDealFixtureSchema.parse(JSON.parse(JSON.stringify(fixture)));
assert.equal(exported.schema_version, "1.0.0");
assert.equal(exported.dataset_version, "1.0.0");
assert.deepEqual(exported, fixture);

// Identity and references survive ordering changes; a loader call owns its graph.
const reordered = loadSyntheticDealFixture();
reordered.applications.reverse();
assert.equal(SyntheticDealFixtureSchema.safeParse(reordered).success, true);
assert.deepEqual(new Set(reordered.applications.map((app) => app.app_id)), new Set(apps.keys()));
reordered.applications[0].app_name = "Changed only by this check";
assert.deepEqual(loadSyntheticDealFixture(), fixture);
console.log("PASS: 15 buyer + 15 target apps, 10 licenses, 5 TSA services; unique IDs, links, vendor consistency, null/zero, synthetic/version metadata, JSON round trip, reorder and loader isolation");

let negativeChecks = 0;
function reject(label: string, candidate: unknown, path: string, message?: RegExp) {
  const result = SyntheticDealFixtureSchema.safeParse(candidate);
  assert.equal(result.success, false, `${label} must be rejected`);
  if (result.success) throw new Error(`Unexpected accepted case: ${label}`);
  const issue = result.error.issues.find((item) => item.path.join(".") === path && (!message || message.test(item.message)));
  assert.ok(issue, `${label}: expected useful diagnostic at ${path}; got ${result.error.message}`);
  console.log(`PASS reject ${label}: ${issue.path.join(".")} — ${issue.message}`);
  negativeChecks++;
}

reject("duplicate app ID across sides", {
  ...fixture,
  applications: fixture.applications.map((app, i) => i === 15 ? { ...app, app_id: fixture.applications[0].app_id } : app),
}, "applications.15.app_id", /Duplicate record ID/);
reject("duplicate license ID", {
  ...fixture,
  license_positions: fixture.license_positions.map((item, i) => i === 1 ? { ...item, license_id: fixture.license_positions[0].license_id } : item),
}, "license_positions.1.license_id", /Duplicate record ID/);
reject("duplicate TSA ID", {
  ...fixture,
  tsa_services: fixture.tsa_services.map((item, i) => i === 1 ? { ...item, tsa_id: fixture.tsa_services[0].tsa_id } : item),
}, "tsa_services.1.tsa_id", /Duplicate record ID/);
reject("ID reused across record kinds", {
  ...fixture,
  license_positions: [{ ...fixture.license_positions[0], license_id: fixture.applications[0].app_id }],
}, "license_positions.0.license_id", /Duplicate record ID/);
reject("dangling license application", {
  ...fixture,
  license_positions: [{ ...fixture.license_positions[0], app_id: "app-not-in-fixture" }],
}, "license_positions.0.app_id", /Unknown application ID/);
reject("dangling TSA application", {
  ...fixture,
  tsa_services: [{ ...fixture.tsa_services[0], related_app_ids: ["app-not-in-fixture"] }],
}, "tsa_services.0.related_app_ids.0", /Unknown application ID/);
reject("repeated TSA dependency", {
  ...fixture,
  tsa_services: [{ ...fixture.tsa_services[0], related_app_ids: [fixture.applications[0].app_id, fixture.applications[0].app_id] }],
}, "tsa_services.0.related_app_ids.1", /Duplicate app reference/);

function withApplication(patch: Record<string, unknown>) {
  return { ...fixture, applications: [{ ...fixture.applications[0], ...patch }, ...fixture.applications.slice(1)] };
}
function withLicense(patch: Record<string, unknown>) {
  return { ...fixture, license_positions: [{ ...fixture.license_positions[0], ...patch }] };
}
function withTSA(patch: Record<string, unknown>) {
  return { ...fixture, tsa_services: [{ ...fixture.tsa_services[0], ...patch }] };
}

reject("string cost is not coerced", withApplication({ annual_cost: "100" }), "applications.0.annual_cost");
reject("negative cost", withApplication({ annual_cost: -1 }), "applications.0.annual_cost");
reject("infinite cost", withApplication({ annual_cost: Infinity }), "applications.0.annual_cost");
reject("NaN cost", withApplication({ annual_cost: NaN }), "applications.0.annual_cost");
reject("negative license spend", withLicense({ annual_spend: -1 }), "license_positions.0.annual_spend");
reject("fractional seat quantity", withLicense({ seats_entitled: 1.5 }), "license_positions.0.seats_entitled");
reject("negative seat quantity", withLicense({ seats_used: -1 }), "license_positions.0.seats_used");
reject("blank ID", withApplication({ app_id: " " }), "applications.0.app_id");
reject("blank application name", withApplication({ app_name: " " }), "applications.0.app_name");
reject("invalid company side", withApplication({ company_side: "seller" }), "applications.0.company_side");
reject("invalid TSA status", withTSA({ status: "unknown" }), "tsa_services.0.status");
reject("impossible calendar date", withTSA({ start_date: "2027-02-30" }), "tsa_services.0.start_date");
reject("non-leap February 29", withLicense({ renewal_date: "2027-02-29" }), "license_positions.0.renewal_date");
reject("non-ISO renewal date", withLicense({ renewal_date: "06/30/2027" }), "license_positions.0.renewal_date");
reject("reversed TSA dates", withTSA({ end_date: "2026-12-31" }), "tsa_services.0.end_date", /on or after/);
reject("non-synthetic fixture", { ...fixture, synthetic: false }, "synthetic");
reject("unsupported schema version", { ...fixture, schema_version: "2.0.0" }, "schema_version");
reject("malformed dataset version", { ...fixture, dataset_version: "draft" }, "dataset_version");
reject("missing target side", { ...fixture, applications: fixture.applications.filter((app) => app.company_side === "buyer") }, "applications", /Missing target/);

// Positive boundary checks complement the invalid date/numeric checks.
assert.equal(SyntheticDealFixtureSchema.safeParse(withLicense({ renewal_date: "2028-02-29", seats_used: 121 })).success, true);
assert.equal(SyntheticDealFixtureSchema.safeParse(withTSA({ end_date: fixture.tsa_services[0].start_date, related_app_ids: undefined })).success, true);
console.log(`PASS: ${negativeChecks} negative cases; valid leap day, usage above entitlement, same-day TSA and absent optional links accepted`);
