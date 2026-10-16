import puppeteer from "puppeteer-core";

const url = `https://solon.agency/?cb=${Date.now()}#pricing`;
const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });
await page.waitForSelector("#pricing", { timeout: 30000 });

const report = await page.evaluate(() => {
  const section = document.querySelector("#pricing");
  const cards = [...section.querySelectorAll(".box.featured")];
  const plans = cards.map((card) => {
    const name = card.querySelector("h3")?.textContent?.trim() || "";
    const h4 = card.querySelector("h4");
    const h4Text = h4?.innerText?.replace(/\s+/g, " ").trim() || "";
    const buyButtons = [...card.querySelectorAll("a.buy-btn")].map((a) => ({
      text: a.textContent?.trim() || "",
      visible: a.offsetParent !== null,
      href: a.getAttribute("href") || "",
    }));
    return { name, headingPrices: h4Text, buyButtons };
  });
  return {
    togglePresent: !!section.querySelector("#yearly"),
    billingDataset: section.dataset.billing || null,
    planCount: plans.length,
    planNames: plans.map((p) => p.name),
    plans,
    sectionSnippet: section.innerText.slice(0, 1200),
  };
});

let annualToggle = null;
if (report.togglePresent) {
  await page.click("#yearly");
  await new Promise((r) => setTimeout(r, 500));
  annualToggle = await page.evaluate(() => {
    const section = document.querySelector("#pricing");
    return [...section.querySelectorAll(".box.featured")].map((card) => ({
      name: card.querySelector("h3")?.textContent?.trim() || "",
      headingPrices: card.querySelector("h4")?.innerText?.replace(/\s+/g, " ").trim() || "",
      visibleBuyButtons: [...card.querySelectorAll("a.buy-btn")].filter((a) => a.offsetParent !== null).length,
    }));
  });
}

console.log(JSON.stringify({ url, report, annualToggle, consoleErrors }, null, 2));
await browser.close();
