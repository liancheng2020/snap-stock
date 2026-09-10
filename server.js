import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { history } from "./lib/market.js";
import { analyze } from "./lib/indicators.js";
import { explain } from "./lib/explanation.js";
import { marketContext, newsContext } from "./lib/context.js";
import { enrich } from "./lib/insight.js";
const assets = {
  "/": ["public/index.html", "text/html"],
  "/app.js": ["public/app.js", "text/javascript"],
  "/style.css": ["public/style.css", "text/css"],
  "/logo.svg": ["public/logo.svg", "image/svg+xml"],
};
let active = 0;
const port = Number(process.env.PORT || 3100);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("[Snap Stock] PORT 必须为 1–65535 的整数，请检查 .env。");
  process.exit(1);
}
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
  );
  const url = new URL(req.url, "http://localhost"),
    json = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
  if (req.method !== "GET") return json(405, { error: "Method not allowed" });
  if (url.pathname === "/api/analysis") {
    if (active >= 4) return json(429, { error: "请求较多，请稍后重试" });
    active++;
    try {
      if (!["A", "US", "HK"].includes(url.searchParams.get("market")))
        throw new Error("仅支持 A、US、HK 市场");
      const data = await history(
        url.searchParams.get("market"),
        url.searchParams.get("code"),
      );
      const market = await marketContext(url.searchParams.get("market"), data);
      const analysis = enrich(analyze(data.bars), market, newsContext);
      const explanation = await explain({ ...data, ...analysis });
      json(200, {
        ...data,
        ...analysis,
        explanation,
        bars: undefined,
        version: "1.0.0",
        parameters: {
          ma: [20, 60],
          rsi: { period: 14, smoothing: "Wilder", flat: 50 },
          atr: { period: 14, smoothing: "Wilder", firstTR: "high-low" },
          levels: "此前 20/60 根日线，排除当前分析日；复权价格",
          macd: [12, 26, 9],
          histogram: "2 × (DIF - DEA)",
          emaSeed: "首 N 项 SMA",
        },
      });
    } catch (e) {
      json(422, { error: e.message });
    } finally {
      active--;
    }
    return;
  }
  if (url.pathname === "/health")
    return json(200, { status: "ok", version: "1.0.0" });
  const asset = assets[url.pathname];
  if (!asset) return json(404, { error: "Not found" });
  try {
    const content = await readFile(new URL(asset[0], import.meta.url));
    res.writeHead(200, { "Content-Type": asset[1] + "; charset=utf-8" });
    res.end(content);
  } catch (error) {
    console.error("[Snap Stock] 静态资源读取失败", asset[0], error);
    json(500, { error: "页面资源加载失败，请检查部署文件或联系维护者" });
  }
});
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      "[Snap Stock] 端口 " +
        port +
        " 已被占用。若已有本项目运行，可直接访问 http://localhost:" +
        port +
        "；要重启，请先在旧终端按 Ctrl+C，或将 .env 中的 PORT 改为其他可用端口后重试。",
    );
  } else {
    console.error("[Snap Stock] 启动失败：" + error.message);
  }
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log("Snap Stock: http://localhost:" + port),
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => {
      server.closeAllConnections();
      process.exit(0);
    }, 3000).unref();
  });
}
