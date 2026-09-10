import { chromium } from "playwright";
import assert from "node:assert/strict";
import { analyze } from "../lib/indicators.js";
import { enrich } from "../lib/insight.js";
import { newsContext } from "../lib/context.js";

// Deterministic fixtures exercise rendering without market or model requests.
const bars = Array.from({ length: 260 }, (_, i) => {
  const close = 200 + i / 10 + 20 * Math.sin(i / 6);
  return {
    date: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10),
    open: close - 1,
    close,
    high: close + 2,
    low: close - 2,
    volume: 1000 + i,
  };
});
const result = {
  ...enrich(
    analyze(bars),
    { status: "unavailable", reason: "测试：市场背景暂不可用" },
    newsContext,
  ),
  identity: {
    name: "布局测试",
    symbol: "TEST",
    exchange: "TEST",
    currency: "USD",
  },
  asOf: bars.at(-1).date,
  warnings: ["离线测试数据，不是真实行情"],
  source: "fixture",
  adjustment: "fixture",
  fetchedAt: "2025-10-01",
};
result.explanation = {
  provider: "deepseek",
  facts: { trend: result.trend },
  sections: result.interpretation.map((s) => ({
    text: s.text,
    factIds: ["trend"],
  })),
};
const browser = await chromium.launch(
  process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {},
);
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/analysis?*", (route) =>
    route.fulfill({ json: result }),
  );
  for (const width of [1440, 1100, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(process.env.BASE_URL || "http://localhost:3111");
    await page.locator("#code").fill("AAPL");
    await page.locator("#submit").click();
    await page.locator("#result").waitFor({ state: "visible" });
    assert.equal(await page.locator("#interpretation > .panel").count(), 2);
    assert.equal(
      await page.locator("#interpretation .panel .panel").count(),
      0,
    );
    assert.equal(await page.locator(".insight-flow li").count(), 6);
    assert.ok(await page.locator("meter").isVisible());
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    if (width > 850) {
      const list = await page.locator("#events").boundingBox();
      const evidence = await page.locator("#evidence").boundingBox();
      assert.ok(Math.abs(evidence.y - list.y - list.height - 16) < 2);
      assert.ok(list.height >= 120);
    }
    await page.locator("#events button").first().click();
    assert.match(await page.locator("#evidence").innerText(), /前一日 DIF/);
    assert.equal(
      await page.locator('#events button[aria-pressed="true"]').count(),
      1,
    );
    await page.locator(".analysis-details > summary").first().click();
    assert.ok(await page.locator(".context-sections").isVisible());
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `/tmp/snap-stock-layout-${width}.png`,
      fullPage: true,
    });
    console.log("PASS layout", width);
  }
  result.explanation = {
    provider: "rules",
    reason: "未配置模型，使用程序解读",
  };
  result.events = [];
  await page.locator("#submit").click();
  await page.locator("#result").waitFor({ state: "visible" });
  assert.equal(await page.locator("#interpretation > .panel").count(), 2);
  assert.match(await page.locator("#interpretation").innerText(), /未配置模型/);
  assert.match(await page.locator("#events").innerText(), /没有交叉事件/);
  assert.deepEqual(errors, []);
  console.log("PASS fallback, empty events, no page errors");
} finally {
  await browser.close();
}
