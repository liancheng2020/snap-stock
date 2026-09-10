import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { analyze } from "../lib/indicators.js";
import { enrich } from "../lib/insight.js";
import { compareMarket, benchmarks, newsContext } from "../lib/context.js";

// Offline UI integration test: all responses are explicit fixtures, never live quotes.
const bars = Array.from({ length: 160 }, (_, i) => {
  const close = 200 + i / 5 + Math.sin(i / 4) * 12;
  return {
    date: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10),
    open: close,
    close,
    high: close + 1,
    low: close - 1,
    volume: 1000 + i,
  };
});
const stock = {
  bars,
  asOf: bars.at(-1).date,
  fetchedAt: "fixture",
  source: "fixture",
};
const market = compareMarket(stock, stock, benchmarks.US);
let payload = {
  ...stock,
  ...enrich(analyze(bars), market, newsContext),
  identity: {
    name: "Fixture",
    symbol: "TEST",
    currency: "USD",
    exchange: "fixture",
  },
  warnings: ["Test data"],
  explanation: { provider: "rules", reason: "offline test" },
};
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || "msedge",
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const assets = {
    "/": ["index.html", "text/html"],
    "/app.js": ["app.js", "text/javascript"],
    "/style.css": ["style.css", "text/css"],
    "/logo.svg": ["logo.svg", "image/svg+xml"],
  };
  await page.route("http://snap.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/analysis") return route.fulfill({ json: payload });
    const asset = assets[path];
    if (!asset) return route.fulfill({ status: 404 });
    await route.fulfill({
      contentType: asset[1],
      body: await readFile(new URL("../public/" + asset[0], import.meta.url)),
    });
  });
  await page.goto("http://snap.test/");
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const available of [true, false]) {
      payload.market = available
        ? market
        : { status: "unavailable", reason: "市场背景暂不可用" };
      await page.locator("#code").fill("AAPL");
      await page.locator("#market").selectOption("US");
      await page.locator("#submit").click();
      await page.locator("#context").waitFor({ state: "visible" });
      assert.equal(await page.locator("#context > article").count(), 3);
      assert.match(await page.locator("#context").innerText(), /RSI14/);
      assert.match(await page.locator("#context").innerText(), /未接入资讯源/);
      assert.match(
        await page.locator("#context").innerText(),
        available ? /标普 500/ : /市场背景暂不可用/,
      );
      const layout = await page.evaluate(() => {
        const box = (s) => document.querySelector(s).getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          gap: Math.abs(
            box(".charts").bottom -
              box("#cursor").bottom -
              (box(".workspace > aside").bottom - box("#evidence").bottom),
          ),
          alignment: Math.abs(
            box(".charts").right - box("#context > :nth-child(2)").right,
          ),
        };
      });
      assert.equal(layout.overflow, false);
      assert.ok(layout.gap < 1);
      if (width > 850) assert.ok(layout.alignment < 1);
      console.log(width, available ? "available" : "unavailable", "PASS");
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
