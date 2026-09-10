import { fetch, ProxyAgent } from "undici";
const cache = new Map();
export function symbolFor(market, code) {
  code = String(code || "")
    .trim()
    .toUpperCase();
  if (market === "US" && /^[A-Z]{1,6}([.-][A-Z])?$/.test(code))
    return code.replace(".", "-");
  if (market === "HK" && /^\d{1,5}$/.test(code) && Number(code) > 0)
    return String(Number(code)).padStart(4, "0") + ".HK";
  if (market === "A" && /^\d{6}$/.test(code)) {
    if (/^[69]/.test(code)) return code + ".SS";
    if (/^[03]/.test(code)) return code + ".SZ";
  }
  throw new Error(
    "请输入沪深六位代码、港股数字代码或美股英文代码；暂不支持北交所与名称搜索",
  );
}
export function parseChart(r, now = new Date()) {
  const m = r.meta,
    q = r.indicators.quote[0],
    adj = r.indicators.adjclose?.[0]?.adjclose;
  if (!m.exchangeTimezoneName || !adj)
    throw new Error("行情缺少时区或复权信息");
  const dateOf = (t) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: m.exchangeTimezoneName,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(t));
  const today = dateOf(now),
    bars = [],
    seen = new Set();
  for (let i = 0; i < (r.timestamp || []).length; i++) {
    const date = dateOf(r.timestamp[i] * 1000);
    if (date >= today) continue;
    const a = [q.open[i], q.high[i], q.low[i], q.close[i], adj[i], q.volume[i]];
    if (
      a.some((v) => !Number.isFinite(v)) ||
      a.slice(0, 5).some((v) => v <= 0) ||
      q.volume[i] < 0 ||
      seen.has(date)
    )
      throw new Error("行情存在缺失、重复或非法日线，不会静默填补");
    if (
      q.low[i] > Math.min(q.open[i], q.close[i]) ||
      q.high[i] < Math.max(q.open[i], q.close[i])
    )
      throw new Error("OHLC 数据不一致");
    const k = adj[i] / q.close[i];
    bars.push({
      date,
      open: q.open[i] * k,
      high: q.high[i] * k,
      low: q.low[i] * k,
      close: adj[i],
      volume: q.volume[i],
    });
    seen.add(date);
  }
  bars.sort((a, b) => a.date.localeCompare(b.date));
  return {
    bars,
    identity: {
      symbol: m.symbol,
      name: m.longName || m.shortName || m.symbol,
      exchange: m.fullExchangeName || m.exchangeName,
      currency: m.currency,
      timezone: m.exchangeTimezoneName,
    },
    asOf: bars.at(-1)?.date,
    source: "Yahoo Finance（非官方接口）",
    fetchedAt: now.toISOString(),
    adjustment: "OHLC 按源 adjclose/close 比例调整；成交量为源值",
    warnings: [
      "保守排除交易所当地今天的全部 K 线，收盘后也延至次日纳入。",
      "非实时行情；停牌、休市或源延迟可能导致截至日期落后。",
      "复权因子可能随公司行动修订，历史指标也可能变化。",
    ],
  };
}
export async function history(market, code) {
  const symbol = symbolFor(market, code),
    saved = cache.get(symbol);
  if (saved && Date.now() - saved.time < 300000)
    return { ...saved.data, cached: true };
  let dispatcher;
  try {
    if (process.env.DATA_PROXY_URL)
      dispatcher = new ProxyAgent(process.env.DATA_PROXY_URL);
    const res = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/" +
        encodeURIComponent(symbol) +
        "?range=2y&interval=1d&events=div%2Csplits",
      {
        dispatcher,
        signal: AbortSignal.timeout(20000),
        headers: { "User-Agent": "SnapStock/1.0" },
      },
    );
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(
        "行情源拒绝或未能完成请求（" +
          res.status +
          "）。" +
          (process.env.DATA_PROXY_URL
            ? "已使用 DATA_PROXY_URL，请检查代理线路。"
            : "当前为直连，请在 .env 设置可用的 DATA_PROXY_URL 后重启。") +
          "DeepSeek 无法替代缺失的真实行情。",
      );
    }
    const j = await res.json();
    if (j.chart?.error || !j.chart?.result?.[0])
      throw new Error("未找到证券或行情暂不可用");
    const data = parseChart(j.chart.result[0]);
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(symbol, { time: Date.now(), data });
    return { ...data, cached: false };
  } catch (e) {
    if (/行情|证券|数据/.test(e.message)) throw e;
    throw new Error(
      "无法连接行情源，请检查网络或 DATA_PROXY_URL；不会以模拟数据替代",
    );
  } finally {
    await dispatcher?.close();
  }
}
