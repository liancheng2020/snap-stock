export function sma(a, n) {
  return a.map((_, i) =>
    i < n - 1 ? null : a.slice(i - n + 1, i + 1).reduce((s, v) => s + v, 0) / n,
  );
}
export function ema(a, n) {
  const r = Array(a.length).fill(null);
  if (a.length < n) return r;
  let v = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  r[n - 1] = v;
  for (let i = n; i < a.length; i++) {
    v += ((a[i] - v) * 2) / (n + 1);
    r[i] = v;
  }
  return r;
}
export function analyze(bars) {
  if (bars.length < 120) throw new Error("至少需要 120 根有效已收盘日线");
  const p = bars.map((b) => b.close),
    f = ema(p, 12),
    s = ema(p, 26),
    dif = p.map((_, i) => (s[i] === null ? null : f[i] - s[i]));
  const dea = [...Array(25).fill(null), ...ema(dif.slice(25), 9)],
    m20 = sma(p, 20),
    m60 = sma(p, 60),
    events = [];
  const rows = bars.map((b, i) => {
    if (i > 33) {
      const up = dif[i - 1] <= dea[i - 1] && dif[i] > dea[i],
        down = dif[i - 1] >= dea[i - 1] && dif[i] < dea[i];
      if (up || down)
        events.push({
          date: b.date,
          index: i,
          type: up ? "golden" : "death",
          title: up ? "MACD 金叉" : "MACD 死叉",
          previous: { dif: dif[i - 1], dea: dea[i - 1] },
          current: { dif: dif[i], dea: dea[i] },
          context: dif[i] < 0 ? "交叉位于零轴下方" : "交叉位于零轴上方",
        });
    }
    return {
      ...b,
      ma20: m20[i],
      ma60: m60[i],
      dif: dif[i],
      dea: dea[i],
      hist: dea[i] === null ? null : 2 * (dif[i] - dea[i]),
    };
  });
  const last = rows.at(-1),
    prior = rows.at(-6);
  const trend =
    last.close > last.ma60 && last.ma60 > prior.ma60
      ? "中期趋势偏强"
      : last.close < last.ma60 && last.ma60 < prior.ma60
        ? "中期趋势偏弱"
        : "中期方向尚不明确";
  const momentum =
      last.dif > last.dea
        ? "短期动能相对改善"
        : last.dif < last.dea
          ? "短期动能相对偏弱"
          : "短期动能持平",
    avg = bars.slice(-21, -1).reduce((s, b) => s + b.volume, 0) / 20;
  return {
    rows,
    events: events.slice(-12),
    trend,
    momentum,
    summary: momentum + "，" + trend + "。信号描述历史变化，不保证未来方向。",
    returns: Object.fromEntries(
      [5, 20, 60].map((n) => [n, (last.close / p.at(-n - 1) - 1) * 100]),
    ),
    volumeRatio: avg > 0 ? last.volume / avg : null,
    interpretation: [
      {
        title: "趋势",
        text:
          trend +
          "：收盘价" +
          (last.close > last.ma60
            ? "高于"
            : last.close < last.ma60
              ? "低于"
              : "等于") +
          " MA60，MA60 较 5 个交易日前" +
          (last.ma60 > prior.ma60 ? "上升" : "下降或持平") +
          "。",
      },
      {
        title: "动能",
        text:
          momentum +
          "：DIF " +
          (last.dif > last.dea ? "高于" : "不高于") +
          " DEA。当前状态不等于今天刚发生交叉。",
      },
      {
        title: "注意分歧",
        text: "均线与 MACD 都来自价格，不能当作独立证据投票。震荡期交叉可能反复失效；金叉不是买入指令。",
      },
    ],
  };
}
