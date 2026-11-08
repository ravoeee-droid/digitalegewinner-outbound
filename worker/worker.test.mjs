import test from "node:test";
import assert from "node:assert/strict";
import { parseSite } from "./enrichers/website.mjs";
import { nameMatches } from "./enrichers/meta-ads.mjs";
import { parseFollowers } from "./enrichers/social.mjs";
import { computeLift, signalsOf } from "./learn.mjs";
import { robotsAllows } from "./lib.mjs";

test("parseSite findet Kontakt, Social, Tech, Personen", () => {
  const html = `<html><head><title>Pflegedienst Muster</title><meta name="viewport" content="x"><meta name="generator" content="WordPress 6"></head><body>
  <a href="mailto:info@muster-pflege.de">Mail</a> kontakt (at) muster-pflege (dot) de <a href="tel:+49 521 123456">Tel</a>
  <a href="https://www.facebook.com/musterpflege">FB</a><a href="https://www.instagram.com/musterpflege/">IG</a>
  Geschäftsführer: Anna Beispiel © 2019 <script>fbq('init')</script> Jobs bei uns</body></html>`;
  const r = parseSite(html, "https://muster-pflege.de/");
  assert.ok(r.emails.includes("info@muster-pflege.de")); assert.ok(r.emails.includes("kontakt@muster-pflege.de"));
  assert.equal(r.phones[0], "+49521123456"); assert.ok(r.social.facebook && r.social.instagram);
  assert.ok(r.tech.includes("WordPress")); assert.ok(r.tracking.includes("Meta Pixel"));
  assert.equal(r.people[0].name, "Anna Beispiel"); assert.equal(r.copyrightYear, 2019); assert.equal(r.mobileReady, true);
});
test("nameMatches ignoriert Rechtsformen, verhindert Fremdtreffer", () => {
  assert.ok(nameMatches("Pflegedienst Muster", "Pflegedienst Muster GmbH"));
  assert.ok(!nameMatches("Autohaus Meier", "Pflegedienst Muster GmbH"));
});
test("parseFollowers", () => { assert.equal(parseFollowers("1,2 Tsd. Follower"), 1200); assert.equal(parseFollowers("3.400 Follower"), 3400); assert.equal(parseFollowers("nichts"), null); });
test("robots.txt", () => { const t = "User-agent: *\nDisallow: /privat\nAllow: /privat/offen"; assert.ok(!robotsAllows(t, "/privat/x")); assert.ok(robotsAllows(t, "/privat/offen/a")); assert.ok(robotsAllows(t, "/impressum")); });
test("computeLift: Signal mit mehr Erfolg bekommt Lift > 1, wenig Daten werden ignoriert", () => {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({ positive: i < 12, signals: ["ads:meta"] });
  for (let i = 0; i < 30; i++) rows.push({ positive: i < 3, signals: ["web:veraltet"] });
  rows.push({ positive: true, signals: ["selten"] });
  const l = computeLift(rows);
  assert.ok(l.find((x) => x.signal === "ads:meta").lift > 1); assert.ok(l.find((x) => x.signal === "web:veraltet").lift < 1); assert.ok(!l.find((x) => x.signal === "selten"));
});
test("signalsOf", () => { const s = signalsOf({ mobileReady: false, https: true, mentionsJobs: true, hasJobPostingSchema: false, tech: ["Wix"], tracking: [] }, { runsAds: true }); assert.ok(["web:nicht_mobil", "web:jobs_ohne_schema", "tech:Wix", "ads:meta", "web:kein_tracking"].every((x) => s.includes(x))); });
import { parseAgentResult } from "./enrichers/tinyfish.mjs";
test("parseAgentResult versteht Objekt, JSON-String und Codeblock", () => {
  assert.deepEqual(parseAgentResult({ a: 1 }), { a: 1 });
  assert.deepEqual(parseAgentResult('{"followers": 12}'), { followers: 12 });
  assert.deepEqual(parseAgentResult('Hier:\n```json\n{"runsAds": true}\n```'), { runsAds: true });
  assert.ok(parseAgentResult("kein json").text);
});
