import test from "node:test";
import assert from "node:assert/strict";
import { technicals, wilder, enrich } from "../lib/insight.js";
import { analyze } from "../lib/indicators.js";
import {
  compareMarket,
  marketContext,
  benchmarks,
  newsContext,
} from "../lib/context.js";
const bars = (direction = 1) =>
  Array.from({ length: 130 }, (_, i) => {
    const close = 200 + i * direction;
    return {
      date: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10),
      open: close,
      close,
      high: close + 1,
      low: close - 1,
      volume: 100,
    };
  });
const dataset = (values) => ({
  bars: values,
  asOf: values.at(-1).date,
  source: "fixture",
  fetchedAt: "2025-06-01",
});
test("Wilder seed and recursive smoothing", () => {
  assert.deepEqual(wilder([1, 2, 3, 7], 3), [null, null, 2, 11 / 3]);
});
test("RSI directional and flat boundaries, ATR range", () => {
  for (const [direction, expected] of [
    [1, 100],
    [-1, 0],
    [0, 50],
  ]) {
    const t = technicals(bars(direction));
    assert.equal(t.rsi14, expected);
    assert.equal(t.atr14, 2);
    assert.ok(Number.isFinite(t.atrPercent));
  }
});
test("ATR includes gaps and historical levels exclude current bar", () => {
  const b = bars(0);
  b.at(-1).close = 220;
  b.at(-1).open = 220;
  b.at(-1).high = 221;
  b.at(-1).low = 219;
  const t = technicals(b);
  assert.equal(t.atr14, (2 * 13 + 21) / 14);
  assert.equal(t.levels[20].high, 201);
  assert.equal(t.levels[60].low, 199);
  assert.notEqual(t.levels[20].to, b.at(-1).date);
});
test("Market comparison uses matched dates and percentage points", () => {
  const stock = dataset(bars()),
    index = dataset(bars(0).filter((_, i) => i !== 120));
  const r = compareMarket(stock, index, benchmarks.US);
  assert.equal(r.periods[20].benchmarkReturn, 0);
  assert.equal(r.periods[20].excess, r.periods[20].stockReturn);
  assert.equal(r.periods[20].from, stock.bars.at(-22).date);
  assert.equal(r.asOf, stock.asOf);
});
test("Missing and stale benchmark fails closed without blocking stock", async () => {
  const stock = dataset(bars());
  for (const index of [
    dataset(bars().slice(0, 10)),
    dataset(bars().slice(0, -1)),
  ])
    assert.throws(() => compareMarket(stock, index, benchmarks.A));
  const r = await marketContext("US", stock, async () => {
    throw Error("secret upstream error");
  });
  assert.equal(r.status, "unavailable");
  assert.ok(!r.reason.includes("secret"));
});
test("Three benchmark mappings and transparent news state", async () => {
  for (const market of ["A", "US", "HK"]) {
    const r = await marketContext(
      market,
      dataset(bars()),
      async (kind, symbol) => {
        assert.equal(kind, "INDEX");
        assert.equal(symbol, benchmarks[market].symbol);
        return dataset(bars());
      },
    );
    assert.equal(r.status, "available");
  }
  assert.equal(newsContext.status, "not_configured");
  assert.deepEqual(newsContext.items, []);
});
test("Plain language insight preserves computed evidence", () => {
  const result = enrich(
    analyze(bars()),
    { status: "unavailable" },
    newsContext,
  );
  assert.equal(result.interpretation.length, 3);
  assert.match(result.summary, /中期/);
  assert.ok(
    result.interpretation[2].text.includes(
      result.technical.levels[20].high.toFixed(2),
    ),
  );
  assert.equal(result.rows.length, 130);
});
