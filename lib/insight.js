// Wilder smoothing: first N observations seed the average.
export function wilder(values, period = 14) {
  const result = Array(values.length).fill(null);
  if (values.length < period) return result;
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = value;
  for (let i = period; i < values.length; i++) {
    value = (value * (period - 1) + values[i]) / period;
    result[i] = value;
  }
  return result;
}

export function technicals(bars) {
  const changes = bars.slice(1).map((b, i) => b.close - bars[i].close);
  const gains = wilder(changes.map((v) => Math.max(v, 0)));
  const losses = wilder(changes.map((v) => Math.max(-v, 0)));
  const rsi = [
    null,
    ...gains.map((v, i) =>
      v === null
        ? null
        : v + losses[i] === 0
          ? 50
          : (100 * v) / (v + losses[i]),
    ),
  ];
  const atr = wilder(
    bars.map((b, i) =>
      Math.max(
        b.high - b.low,
        i ? Math.abs(b.high - bars[i - 1].close) : 0,
        i ? Math.abs(b.low - bars[i - 1].close) : 0,
      ),
    ),
  );
  const levels = Object.fromEntries(
    [20, 60].map((n) => {
      const window = bars.slice(-n - 1, -1);
      const high = window.reduce((a, b) => (a.high >= b.high ? a : b));
      const low = window.reduce((a, b) => (a.low <= b.low ? a : b));
      return [
        n,
        {
          high: high.high,
          highDate: high.date,
          low: low.low,
          lowDate: low.date,
          from: window[0].date,
          to: window.at(-1).date,
        },
      ];
    }),
  );
  return {
    rsi14: rsi.at(-1),
    atr14: atr.at(-1),
    atrPercent: (atr.at(-1) / bars.at(-1).close) * 100,
    levels,
  };
}

const fmt = (n) => n.toFixed(2);
export function enrich(analysis, market, news) {
  const { rows, volumeRatio } = analysis;
  const last = rows.at(-1),
    prior = rows.at(-6);
  const technical = technicals(rows);
  const strong = last.close > last.ma60 && last.ma60 > prior.ma60;
  const weak = last.close < last.ma60 && last.ma60 < prior.ma60;
  const improving = last.dif > last.dea;
  const summary = strong
    ? improving
      ? "中期仍在走强，短线动能也偏强；这不保证上涨延续。"
      : "中期仍偏强，但短线动能减弱，上涨可能正在放缓。"
    : weak
      ? improving
        ? "短线动能有所改善，但还没摆脱中期弱势，不能据此认定反转。"
        : "中期走势偏弱，短线动能也偏弱，暂未看到两者同步改善。"
      : "中期方向还不明确，短线信号不足以确认新的趋势。";
  const level = technical.levels[20];
  const relative =
    market?.status === "available" ? market.periods[20].excess : null;
  const marketReason =
    relative === null
      ? "市场背景不可用，暂不能判断它是否跑赢大盘。"
      : "同期相比" +
        market.name +
        (relative > 0 ? "更强" : relative < 0 ? "更弱" : "持平") +
        "，但这不能解释涨跌原因。";
  const reason =
    "收盘价 " +
    fmt(last.close) +
    (last.close > last.ma60 ? " 高于" : " 不高于") +
    "中期均线 " +
    fmt(last.ma60) +
    "；" +
    (volumeRatio === null
      ? "成交量不足以比较。"
      : "当日成交量为此前 20 日均量的 " + fmt(volumeRatio) + " 倍。") +
    (technical.rsi14 >= 70
      ? "最近上涨偏急，但不等于马上会跌。"
      : technical.rsi14 <= 30
        ? "最近下跌偏急，但不等于马上会反弹。"
        : "近期涨跌力度尚未达到 RSI 的常用极端区间。") +
    marketReason;
  const watch =
    "观察此前 20 日高点 " +
    fmt(level.high) +
    "（" +
    level.highDate +
    "）与低点 " +
    fmt(level.low) +
    "（" +
    level.lowDate +
    "）。" +
    (last.close > level.high
      ? "收盘已超过该高点，后续看能否保持。"
      : last.close < level.low
        ? "收盘已低于该低点，后续看能否收回。"
        : "目前仍在这个区间内，走出区间后再观察能否保持。") +
    "这些是历史观察位，不保证始终有效。";
  return {
    ...analysis,
    summary,
    technical,
    market,
    news,
    interpretation: [
      { title: "现在怎么看", text: summary },
      { title: "为什么这么说", text: reason },
      { title: "接下来观察什么", text: watch },
    ],
  };
}
