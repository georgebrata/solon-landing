"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { isNetopiaLink, roInclusion, model, render, validate } = require("../scripts/build-pricing");

const root = path.join(__dirname, "..");
const snapshot = JSON.parse(fs.readFileSync(path.join(root, "data/abonamente.snapshot.json"), "utf8"));
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("only NETOPIA https links are accepted, never Stripe or placeholders", () => {
  assert.ok(isNetopiaLink("https://mpy.ro/99mzfyjht?language=ro"));
  assert.ok(isNetopiaLink("https://secure.mobilpay.ro/ro/buy-product/x"));
  assert.ok(!isNetopiaLink("https://buy.stripe.com/abc"));
  assert.ok(!isNetopiaLink("https://solon.agency/bronze/lunar"));
  assert.ok(!isNetopiaLink("http://mpy.ro/x"));
  assert.ok(!isNetopiaLink("-"));
});

test("inactive packages are not rendered", () => {
  const data = JSON.parse(JSON.stringify(snapshot));
  data.Abonamente.push({ "Nume abonament": "Hidden", Activ: false, "Pret lunar (RON)": 1 });
  const names = model(data).plans.map((p) => p.name);
  assert.ok(!names.includes("Hidden"));
  assert.ok(!names.includes("Lithium"));
});

test("committed index.html matches the snapshot render", () => {
  assert.strictEqual(render(html, model(validate(snapshot))), html);
});

test("pricing HTML has no Stripe links and prices are in RON", () => {
  const block = html.match(/<!-- PRICING:START[\s\S]*?<!-- PRICING:END -->/u)[0];
  assert.ok(!/stripe/i.test(block));
  assert.ok(!/€/u.test(block));
  for (const p of model(snapshot).plans) {
    if (p.monthly) assert.ok(block.includes("lei/lună"));
    assert.ok(block.includes(p.name.toUpperCase()));
  }
});

test("sheet text is HTML-escaped", () => {
  const data = JSON.parse(JSON.stringify(snapshot));
  data.Abonamente[1].Servicii = "<script>x</script>";
  const out = render(html, model(data));
  assert.ok(!out.includes("<script>x</script>"));
});

test("validate rejects payloads without active priced packages", () => {
  assert.throws(() => validate({}));
  assert.throws(() => validate({ Abonamente: [{ "Nume abonament": "X", Activ: true }], Servicii: [] }));
});

test("validate rejects fewer than four active packages (partial sheet)", () => {
  const data = JSON.parse(JSON.stringify(snapshot));
  const active = data.Abonamente.filter((row) => row.Activ === true);
  data.Abonamente = active.slice(0, 3);
  assert.throws(() => validate(data), /expected 4 active packages, got 3/);
});

test("known English sheet phrases become Romanian", () => {
  assert.strictEqual(roInclusion("- 2 website updates / month;"), "2 modificări pe website / lună");
  assert.strictEqual(roInclusion("- GoogleMyBusines maintenance, "), "Mentenanță Google My Business");
});
