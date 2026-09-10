import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { history } from "./lib/market.js";
import { analyze } from "./lib/indicators.js";
const assets = {
  "/": ["public/index.html", "text/html"],
  "/app.js": ["public/app.js", "text/javascript"],
  "/style.css": ["public/style.css", "text/css"],
  "/logo.svg": ["public/logo.svg", "image/svg+xml"],
};
let active = 0;
createServer(async (req, res) => {
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
      const data = await history(
        url.searchParams.get("market"),
        url.searchParams.get("code"),
      );
      json(200, {
        ...data,
        ...analyze(data.bars),
        bars: undefined,
        version: "1.0.0",
        parameters: {
          ma: [20, 60],
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
  res.writeHead(200, { "Content-Type": asset[1] + "; charset=utf-8" });
  res.end(await readFile(new URL(asset[0], import.meta.url)));
}).listen(Number(process.env.PORT || 3100), "127.0.0.1", () =>
  console.log("Snap Stock: http://localhost:" + (process.env.PORT || 3100)),
);
