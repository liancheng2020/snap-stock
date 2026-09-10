import test from "node:test";
import assert from "node:assert/strict";
import { sma, ema, analyze } from "../lib/indicators.js";
import { symbolFor, parseChart } from "../lib/market.js";
const bars = (fn, n = 250) =>
  Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
    open: fn(i),
    high: fn(i) + 1,
    low: fn(i) - 1,
    close: fn(i),
    volume: 100,
  }));
test("SMA uses full window, EMA seeded with SMA", () => {
  assert.deepEqual(sma([1, 2, 3, 4], 3), [null, null, 2, 3]);
  assert.deepEqual(ema([1, 2, 3, 4], 3), [null, null, 2, 3]);
  assert.deepEqual(ema([1], 3), [null]);
});
test("Flat series has zero MACD and no crossings", () => {
  const r = analyze(bars(() => 100));
  assert.equal(r.rows.at(-1).dif, 0);
  assert.equal(r.rows.at(-1).dea, 0);
  assert.equal(r.events.length, 0);
  assert.equal(r.volumeRatio, 1);
});
test("Rising trend and return use N trading intervals", () => {
  const r = analyze(bars((i) => 100 + i));
  assert.equal(r.trend, "中期趋势偏强");
  assert.equal(r.returns[5], (349 / 344 - 1) * 100);
});
test("Insufficient history rejected", () =>
  assert.throws(() => analyze(bars(() => 100, 119)), /120/));
test("Crossover event has actual transition, not continuous state", () => {
  const r = analyze(bars((i) => 100 + Math.sin(i / 10) * 10));
  assert.ok(r.events.some((e) => e.type === "golden"));
  assert.ok(r.events.some((e) => e.type === "death"));
  for (const e of r.events) {
    if (e.type === "golden") {
      assert.ok(e.previous.dif <= e.previous.dea);
      assert.ok(e.current.dif > e.current.dea);
    } else {
      assert.ok(e.previous.dif >= e.previous.dea);
      assert.ok(e.current.dif < e.current.dea);
    }
  }
});
test("Volume denominator excludes current session", () => {
  const b = bars(() => 100);
  b.at(-1).volume = 200;
  assert.equal(analyze(b).volumeRatio, 2);
  b.forEach((r) => (r.volume = 0));
  assert.equal(analyze(b).volumeRatio, null);
});
test("Later data cannot change earlier indicators", () => {
  const b = bars((i) => 100 + Math.sin(i / 5) * 4);
  assert.deepEqual(
    analyze(b.slice(0, 180)).rows,
    analyze(b).rows.slice(0, 180),
  );
});
test("Market symbols normalized; URL injection and unsupported market rejected", () => {
  assert.equal(symbolFor("HK", "00700"), "0700.HK");
  assert.equal(symbolFor("A", "600519"), "600519.SS");
  assert.equal(symbolFor("A", "000001"), "000001.SZ");
  assert.equal(symbolFor("US", "brk.b"), "BRK-B");
  assert.throws(() => symbolFor("A", "830001"));
  assert.throws(() => symbolFor("US", "https://x"));
});
const fixture = () => ({
  meta: {
    symbol: "X",
    exchangeTimezoneName: "America/New_York",
    currency: "USD",
  },
  timestamp: [
    Date.parse("2026-09-08T13:30Z") / 1000,
    Date.parse("2026-09-09T13:30Z") / 1000,
  ],
  indicators: {
    quote: [
      {
        open: [10, 11],
        high: [12, 12],
        low: [9, 10],
        close: [11, 11],
        volume: [100, 200],
      },
    ],
    adjclose: [{ adjclose: [5.5, 5.5] }],
  },
});
test("Exchange-local current date excluded and OHLC adjusted consistently", () => {
  const d = parseChart(fixture(), new Date("2026-09-09T23:00Z"));
  assert.equal(d.bars.length, 1);
  assert.equal(d.bars[0].open, 5);
  assert.equal(d.bars[0].close, 5.5);
  assert.equal(d.asOf, "2026-09-08");
});
test("Invalid source values rejected rather than filled", () => {
  const f = fixture();
  f.indicators.quote[0].close[0] = null;
  assert.throws(() => parseChart(f, new Date("2026-09-10")), /非法/);
});
