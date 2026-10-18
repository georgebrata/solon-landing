"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { isNetopiaLink, roInclusion, model, render, validate, fetchTab, fetchData } = require("../scripts/build-pricing");

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

test("pricing marker references SOLON API sheet (not legacy spreadsheet title)", () => {
  const start = html.match(/<!-- PRICING:START[^>]*>/u);
  assert.ok(start);
  assert.match(start[0], /sheet "SOLON API"/u);
  assert.ok(!/SOLON Data\s*\|\s*Machine-readable/iu.test(html));
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

test("pricing block omits notes and add-ons", () => {
  const rendered = render(html, model(validate(snapshot)));
  const block = rendered.match(/<!-- PRICING:START[\s\S]*?<!-- PRICING:END -->/u)[0];
  const absent = [
    "pricing-notes",
    "pricing-addons",
    "addon-list",
    "addon-name",
    "addon-price",
    "Servicii suplimentare",
    "Prețurile sunt în lei",
    "plătitoare de TVA",
    "Sincronizarea social media",
    "abonament mai vechi",
    "Reducere la juridis.ro",
  ];
  for (const phrase of absent) {
    assert.ok(!block.includes(phrase), phrase);
  }
  assert.match(block, /pricing-billing-toggle/);
  for (const plan of model(validate(snapshot)).plans) {
    for (const period of ["monthly", "annual"]) {
      const link = plan.links[period];
      if (typeof link === "string" && isNetopiaLink(link)) {
        const href = link.replace(
          /[&<>"']/g,
          (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
        );
        assert.ok(
          block.includes(
            `<a href="${href}" target="_blank" rel="noopener" class="buy-btn" data-plan="${plan.slug}" data-billing="${period}">`,
          ),
          `${plan.slug}/${period}`,
        );
      } else {
        assert.ok(block.includes(`PAYMENT-LINK ${plan.slug}/${period}`), `${plan.slug}/${period}`);
      }
    }
  }
  for (const name of ["BRONZE", "SILVER", "GOLD", "PLATINUM"]) {
    assert.ok(block.includes(name), name);
  }
  const after = rendered.split("<!-- PRICING:END -->")[1];
  assert.match(after, /Pentru o <b>ofertă personalizată<\/b>/);
  const css = fs.readFileSync(path.join(root, "assets/css/style.css"), "utf8");
  assert.ok(!css.includes(".pricing-notes"));
  assert.ok(!css.includes(".pricing-addons"));
  assert.ok(!css.includes(".addon-list"));
  assert.ok(!css.includes(".addon-price"));
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
  assert.throws(() => validate(data), /got 3/);
});

test("validate rejects five active packages", () => {
  const data = JSON.parse(JSON.stringify(snapshot));
  data.Abonamente.push({
    "Nume abonament": "Extra",
    Activ: true,
    "Pret lunar (RON)": 1,
    "Pret anual (RON)": 2,
  });
  assert.throws(() => validate(data), /got 5/);
});

test("validate rejects unknown active package name", () => {
  const data = JSON.parse(JSON.stringify(snapshot));
  const bronze = data.Abonamente.find((row) => row.Activ === true && row["Nume abonament"] === "Bronze");
  bronze["Nume abonament"] = "Mystery";
  assert.throws(() => validate(data), /unknown active package name: Mystery/);
});

test("validate rejects duplicate active package names", () => {
  const data = JSON.parse(JSON.stringify(snapshot));
  const silver = data.Abonamente.find((row) => row.Activ === true && row["Nume abonament"] === "Silver");
  silver["Nume abonament"] = "Bronze";
  assert.throws(() => validate(data), /duplicate active package: Bronze/);
});

test("model renders canonical package names regardless of sheet casing", () => {
  const data = JSON.parse(JSON.stringify(snapshot));
  const bronze = data.Abonamente.find((row) => row.Activ === true && row["Nume abonament"] === "Bronze");
  bronze["Nume abonament"] = "bRoNzE";
  const names = model(data).plans.map((plan) => plan.name);
  assert.ok(names.includes("Bronze"));
  assert.ok(!names.includes("bRoNzE"));
});

test("known English sheet phrases become Romanian", () => {
  assert.strictEqual(roInclusion("- 2 website updates / month;"), "2 modificări pe website / lună");
  assert.strictEqual(roInclusion("- GoogleMyBusines maintenance, "), "Mentenanță Google My Business");
});

/** Fake SOLON API: serves rows in pages and records requested URLs. */
function fakeApi(tabs, { pageSize = 2, envelope } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(u);
    if (envelope) return { ok: true, json: async () => envelope };
    const rows = tabs[u.searchParams.get("sheet")];
    if (!rows) return { ok: true, json: async () => ({ success: false, error: { code: "NOT_FOUND", message: "Sheet not found." } }) };
    const offset = Number(u.searchParams.get("offset"));
    const data = rows.slice(offset, offset + pageSize);
    return {
      ok: true,
      json: async () => ({ success: true, sheet: u.searchParams.get("sheet"), data, pagination: { total: rows.length, offset, limit: pageSize, hasMore: offset + data.length < rows.length } }),
    };
  };
  return { fetchImpl, calls };
}

const withIds = (rows, prefix) => rows.map((row, index) => ({ id: `${prefix}-${index + 1}`, ...row }));

test("SOLON API: paginated tabs render the same homepage as the snapshot", async () => {
  const { fetchImpl, calls } = fakeApi({ Abonamente: withIds(snapshot.Abonamente, "ab"), Servicii: withIds(snapshot.Servicii, "sv") });
  const data = await fetchData({ fetchImpl, baseUrl: "https://example.test/exec", apiKey: "test-key" });
  assert.strictEqual(data.Abonamente.length, snapshot.Abonamente.length);
  assert.strictEqual(data.Servicii.length, snapshot.Servicii.length);
  assert.strictEqual(render(html, model(data)), html);
  assert.ok(calls.every((u) => u.searchParams.get("apiKey") === "test-key"));
  assert.deepStrictEqual([...new Set(calls.map((u) => u.searchParams.get("sheet")))], ["Abonamente", "Servicii"]);
});

test("SOLON API: success:false is an error and never leaks the key", async () => {
  const { fetchImpl } = fakeApi({}, { envelope: { success: false, error: { code: "UNAUTHORIZED", message: "Invalid or missing API key." } } });
  await assert.rejects(fetchTab("Abonamente", { fetchImpl, baseUrl: "https://example.test/exec", apiKey: "secret-123" }), (err) => {
    assert.match(err.message, /UNAUTHORIZED/);
    assert.ok(!err.message.includes("secret-123"));
    return true;
  });
});

test("SOLON API: missing key fails before any request", async () => {
  const { fetchImpl, calls } = fakeApi({ Abonamente: [] });
  await assert.rejects(fetchTab("Abonamente", { fetchImpl, baseUrl: "https://example.test/exec", apiKey: "" }), /SHEETS_API_KEY/);
  assert.strictEqual(calls.length, 0);
});

test("SOLON API: tab without ids (empty list) fails validation so the snapshot is kept", async () => {
  const { fetchImpl } = fakeApi({ Abonamente: [], Servicii: [] });
  await assert.rejects(fetchData({ fetchImpl, baseUrl: "https://example.test/exec", apiKey: "k" }), /got 0/);
});
