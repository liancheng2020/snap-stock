import { history } from "./market.js";

export const benchmarks = {
  A: { symbol: "000300.SS", name: "沪深 300" },
  US: { symbol: "^GSPC", name: "标普 500" },
  HK: { symbol: "^HSI", name: "恒生指数" },
};

export function compareMarket(stock, index, benchmark) {
  const prices = new Map(index.bars.map((b) => [b.date, b.close]));
  const common = stock.bars.filter((b) => prices.has(b.date));
  if (common.length < 21) throw new Error("共同交易日不足 21 个");
  const last = common.at(-1);
  if (last.date !== stock.asOf) throw new Error("指数尚未更新到个股截至日期");
  const periods = Object.fromEntries(
    [5, 20].map((n) => {
      const first = common.at(-n - 1);
      const stockReturn = (last.close / first.close - 1) * 100;
      const benchmarkReturn =
        (prices.get(last.date) / prices.get(first.date) - 1) * 100;
      return [
        n,
        {
          from: first.date,
          to: last.date,
          stockReturn,
          benchmarkReturn,
          excess: stockReturn - benchmarkReturn,
        },
      ];
    }),
  );
  return {
    status: "available",
    ...benchmark,
    asOf: last.date,
    periods,
    source: index.source,
    fetchedAt: index.fetchedAt,
    note: "按共同交易日期比较；差值为百分点，不代表因果或行业排名。宽基指数不一定适合所有个股；源复权收益与价格指数口径并非完全一致。",
  };
}

export async function marketContext(market, stock, getHistory = history) {
  const benchmark = benchmarks[market];
  try {
    const index = await getHistory("INDEX", benchmark.symbol);
    return compareMarket(stock, index, benchmark);
  } catch {
    return {
      status: "unavailable",
      ...benchmark,
      reason:
        "指数行情暂不可用、日期不齐或历史不足；仅解读个股，不推断市场背景。",
    };
  }
}

export const newsContext = {
  status: "not_configured",
  items: [],
  reason:
    "尚未接入经过覆盖、时效与许可核验的资讯源。本次不包含近期新闻、公告或财报日历，也不据此解释涨跌原因。",
};
