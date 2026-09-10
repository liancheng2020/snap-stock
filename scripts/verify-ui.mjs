import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch(
  process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {},
);
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:3100");
  assert.equal(await page.locator("#code").inputValue(), "");
  for (const [market, code, symbol] of [
    ["A", "600519", "600519.SS"],
    ["US", "AAPL", "AAPL"],
    ["HK", "00700", "0700.HK"],
  ]) {
    await page.locator("#market").selectOption(market);
    await page.locator("#code").fill(code);
    await page.locator("#submit").click();
    await page.waitForFunction(
      () => !document.querySelector("#submit").disabled,
      {},
      { timeout: 30000 },
    );
    assert.ok(
      await page.locator("#result").isVisible(),
      await page.locator("#status").innerText(),
    );
    assert.ok((await page.locator("#identity").innerText()).includes(symbol));
    assert.equal(await page.locator("svg.chart").count(), 1);
    if (await page.locator("#events button").count()) {
      await page.locator("#events button").first().click();
      assert.match(await page.locator("#evidence").innerText(), /前一日 DIF/);
    }
    await page.locator("#range").selectOption("132");
    const download = page.waitForEvent("download");
    await page.locator("#export").click();
    assert.ok((await download).suggestedFilename().endsWith(".json"));
    console.log("PASS live", market, symbol);
  }
  await page.screenshot({ path: "docs/screenshot.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.locator("#market").selectOption("US");
  await page.locator("#code").fill("bad/url");
  await page.locator("#submit").click();
  await page.waitForFunction(() => !document.querySelector("#submit").disabled);
  assert.ok(!(await page.locator("#result").isVisible()));
  assert.match(await page.locator("#status").innerText(), /代码/);
  assert.deepEqual(errors, []);
  console.log("PASS mobile, invalid input, no page errors");
} finally {
  await browser.close();
}
