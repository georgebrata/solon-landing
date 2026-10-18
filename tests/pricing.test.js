"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const {
  isNetopiaLink,
  roInclusion,
  model,
  render,
  validate,
  validateSnapshot,
  validateLivePayload,
  fetchTab,
  fetchData,
  fetchWithSafeRedirect,
  resolvePricingData,
  sanitizeSnapshotPayload,
  ABONAMENTE_SNAPSHOT_KEYS,
  REQUEST_TIMEOUT_MS,
} = require("../scripts/build-pricing");

const root = path.join(__dirname, "..");
const snapshotPath = path.join(root, "data", "abonamente.snapshot.json");
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

/** @param {number} count */
const makeServicii = (count) =>
  Array.from({ length: count }, (_unused, index) => ({
    id: `service-${index + 1}`,
    Service: `Service ${index + 1}`,
    Activ: true,
  }));

const legacyServicii = Array.isArray(snapshot.Servicii) ? snapshot.Servicii : makeServicii(20);

test("only NETOPIA https links are accepted, never Stripe or placeholders", () => {
  assert.ok(isNetopiaLink("https://mpy.ro/99mzfyjht?language=ro"));
  assert.ok(isNetopiaLink("https://secure.mobilpay.ro/ro/buy-product/x"));
  assert.ok(!isNetopiaLink("https://buy.stripe.com/abc"));
  assert.ok(!isNetopiaLink("https://solon.agency/bronze/lunar"));
  assert.ok(!isNetopiaLink("http://mpy.ro/x"));
  assert.ok(!isNetopiaLink("-"));
});

test("inactive packages are not rendered", () => {
  const data = validateSnapshot(JSON.parse(JSON.stringify(snapshot)));
  data.Abonamente.push({ "Nume abonament": "Hidden", Activ: false, "Pret lunar (RON)": 1, "Pret anual (RON)": 2 });
  const names = model(data).plans.map((plan) => plan.name);
  assert.ok(!names.includes("Hidden"));
  assert.ok(!names.includes("Lithium"));
});

test("committed index.html matches the snapshot render", () => {
  assert.strictEqual(render(html, model(validate(snapshot))), html);
});

test("committed snapshot rows only contain allowlisted keys", () => {
  const allowed = new Set(ABONAMENTE_SNAPSHOT_KEYS);
  for (const row of snapshot.Abonamente) {
    for (const key of Object.keys(row)) {
      assert.ok(allowed.has(key), `unexpected snapshot key "${key}"`);
    }
  }
  assert.ok(!("Servicii" in snapshot), "Servicii tab must not be stored in the snapshot file");
  assert.ok(!snapshot.Abonamente.some((row) => "Notes" in row || "Addons disponibile" in row));
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
  for (const plan of model(validate(snapshot)).plans) {
    if (plan.monthly) assert.ok(block.includes("lei/lună"));
    assert.ok(block.includes(plan.name.toUpperCase()));
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
  const data = validateSnapshot(JSON.parse(JSON.stringify(snapshot)));
  data.Abonamente[1].Servicii = "<script>x</script>";
  const out = render(html, model(data));
  assert.ok(!out.includes("<script>x</script>"));
});

test("validate rejects payloads without active priced packages", () => {
  assert.throws(() => validateSnapshot({}));
  assert.throws(() =>
    validateSnapshot({
      Abonamente: [{ "Nume abonament": "Bronze", Activ: true, "Pret lunar (RON)": 1, "Pret anual (RON)": 2 }],
    }),
  );
});

test("validate rejects fewer than four active packages (partial sheet)", () => {
  const data = validateSnapshot(JSON.parse(JSON.stringify(snapshot)));
  const active = data.Abonamente.filter((row) => row.Activ === true);
  data.Abonamente = active.slice(0, 3);
  assert.throws(() => validateSnapshot(data), /got 3/);
});

test("validate rejects five active packages", () => {
  const data = validateSnapshot(JSON.parse(JSON.stringify(snapshot)));
  data.Abonamente.push({
    "Nume abonament": "Extra",
    Activ: true,
    "Pret lunar (RON)": 1,
    "Pret anual (RON)": 2,
  });
  assert.throws(() => validateSnapshot(data), /got 5/);
});

test("validate rejects unknown active package name", () => {
  const data = validateSnapshot(JSON.parse(JSON.stringify(snapshot)));
  const bronze = data.Abonamente.find((row) => row.Activ === true && row["Nume abonament"] === "Bronze");
  bronze["Nume abonament"] = "Mystery";
  assert.throws(() => validateSnapshot(data), /unknown active package name: Mystery/);
});

test("validate rejects duplicate active package names", () => {
  const data = validateSnapshot(JSON.parse(JSON.stringify(snapshot)));
  const silver = data.Abonamente.find((row) => row.Activ === true && row["Nume abonament"] === "Silver");
  silver["Nume abonament"] = "Bronze";
  assert.throws(() => validateSnapshot(data), /duplicate active package: Bronze/);
});

test("validateLivePayload rejects empty Servicii tab", () => {
  const data = validateSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.throws(() => validateLivePayload({ Abonamente: data.Abonamente, Servicii: [] }), /Servicii tab is empty/);
});

test("validate rejects active package missing monthly price", () => {
  const data = validateSnapshot(JSON.parse(JSON.stringify(snapshot)));
  const bronze = data.Abonamente.find((row) => row["Nume abonament"] === "Bronze");
  bronze["Pret lunar (RON)"] = 0;
  assert.throws(() => validateSnapshot(data), /missing monthly price/);
});

test("validate rejects active package missing annual price", () => {
  const data = validateSnapshot(JSON.parse(JSON.stringify(snapshot)));
  const silver = data.Abonamente.find((row) => row["Nume abonament"] === "Silver");
  silver["Pret anual (RON)"] = 0;
  assert.throws(() => validateSnapshot(data), /missing annual price/);
});

test("model renders canonical package names regardless of sheet casing", () => {
  const data = validateSnapshot(JSON.parse(JSON.stringify(snapshot)));
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
const fakeApi = (tabs, { pageSize = 2, envelope } = {}) => {
  const calls = [];
  const fetchImpl = (url, init) => {
    const requestUrl = new URL(url);
    calls.push({ url: requestUrl, init });
    if (envelope) return { ok: true, json: () => Promise.resolve(envelope) };
    const rows = tabs[requestUrl.searchParams.get("sheet")];
    if (!rows) {
      return {
        ok: true,
        json: () => Promise.resolve({ success: false, error: { code: "NOT_FOUND", message: "Sheet not found." } }),
      };
    }
    const offset = Number(requestUrl.searchParams.get("offset"));
    const pageRows = rows.slice(offset, offset + pageSize);
    return {
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          sheet: requestUrl.searchParams.get("sheet"),
          data: pageRows,
          pagination: { total: rows.length, offset, limit: pageSize, hasMore: offset + pageRows.length < rows.length },
        }),
    };
  };
  return { fetchImpl, calls };
};

const withIds = (rows, prefix) => rows.map((row, index) => ({ id: `${prefix}-${index + 1}`, ...row }));

test("SOLON API: paginated tabs render the same homepage as the snapshot", async () => {
  const abRows = withIds(validateSnapshot(snapshot).Abonamente, "ab");
  const { fetchImpl, calls } = fakeApi({ Abonamente: abRows, Servicii: makeServicii(20) });
  const data = await fetchData({ fetchImpl, baseUrl: "https://example.test/exec", apiKey: "test-key" });
  assert.strictEqual(data.Abonamente.length, snapshot.Abonamente.length);
  assert.ok(!("Servicii" in data));
  assert.strictEqual(render(html, model(data)), html);
  assert.ok(calls.every((call) => call.url.searchParams.get("apiKey") === "test-key"));
  assert.deepStrictEqual([...new Set(calls.map((call) => call.url.searchParams.get("sheet")))], ["Abonamente", "Servicii"]);
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

test("SOLON API: empty Abonamente fails validation", async () => {
  const { fetchImpl } = fakeApi({ Abonamente: [], Servicii: makeServicii(3) });
  await assert.rejects(fetchData({ fetchImpl, baseUrl: "https://example.test/exec", apiKey: "k" }), /got 0/);
});

test("SOLON API: safe redirect follows script.googleusercontent.com once", async () => {
  const fetchImpl = (url, init) => {
    const requestUrl = new URL(url);
    if (requestUrl.hostname === "example.test") {
      assert.strictEqual(init.redirect, "manual");
      return {
        status: 302,
        ok: false,
        headers: { get: (name) => (name.toLowerCase() === "location" ? "https://script.googleusercontent.com/macros/echo?nocache=1" : null) },
      };
    }
    assert.strictEqual(requestUrl.hostname, "script.googleusercontent.com");
    assert.ok(!requestUrl.searchParams.has("apiKey"));
    return { ok: true, json: () => Promise.resolve({ success: true, data: [{ id: "x" }], pagination: { hasMore: false } }) };
  };
  const rows = await fetchTab("Abonamente", { fetchImpl, baseUrl: "https://example.test/exec", apiKey: "test-key" });
  assert.strictEqual(rows.length, 1);
});

test("SOLON API: rejects redirect to foreign host", async () => {
  const fetchImpl = () => ({
    status: 302,
    ok: false,
    headers: { get: () => "https://evil.example/phish" },
  });
  await assert.rejects(
    fetchWithSafeRedirect(fetchImpl, "https://example.test/exec", {}, "Abonamente"),
    /REDIRECT_HOST/,
  );
});

test("SOLON API: per-request timeout aborts hung fetch", async () => {
  const fetchImpl = (_url, init) =>
    new Promise((_resolve, reject) => {
      if (init?.signal) {
        init.signal.addEventListener("abort", () => {
          reject(init.signal.reason ?? new DOMException("Aborted", "AbortError"));
        });
      }
    });
  const started = Date.now();
  await assert.rejects(fetchTab("Abonamente", { fetchImpl, baseUrl: "https://example.test/exec", apiKey: "k" }), (err) => {
    assert.ok(err.name === "AbortError" || /abort/i.test(String(err)));
    return true;
  });
  assert.ok(Date.now() - started >= REQUEST_TIMEOUT_MS - 500);
});

test("resolvePricingData falls back to snapshot when live data is partial", async () => {
  const partialAb = withIds(validateSnapshot(snapshot).Abonamente.slice(0, 2), "ab");
  const { fetchImpl } = fakeApi({ Abonamente: partialAb, Servicii: makeServicii(5) });
  const resolved = await resolvePricingData({ fetchImpl, baseUrl: "https://example.test/exec", apiKey: "k" });
  assert.strictEqual(resolved.source, "snapshot");
  assert.ok(resolved.errorMessage);
  assert.ok(!resolved.errorMessage.includes("apiKey"));
  assert.ok(!resolved.errorMessage.includes("http"));
  assert.strictEqual(render(html, model(resolved.data)), html);
});
