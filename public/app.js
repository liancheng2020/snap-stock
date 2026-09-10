const $ = (s) => document.querySelector(s);
let data, selected;
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : "—");
function element(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}
$("#market").onchange = () => {
  $("#code").placeholder = {
    A: "例如 600519",
    US: "例如 AAPL",
    HK: "例如 00700",
  }[$("#market").value];
};
$("#search").onsubmit = async (e) => {
  e.preventDefault();
  $("#submit").disabled = true;
  $("#result").hidden = true;
  $("#empty").hidden = false;
  $("#status").textContent = "正在读取行情、计算指标并生成解读，最多约 45 秒…";
  try {
    const r = await fetch(
      "/api/analysis?" +
        new URLSearchParams({
          market: $("#market").value,
          code: $("#code").value,
        }),
    );
    const body = await r.json();
    if (!r.ok) throw Error(body.error);
    data = body;
    selected = null;
    render();
    $("#status").textContent =
      data.explanation?.provider === "deepseek"
        ? "已完成 · DeepSeek 辅助解读；指标与信号仍由程序计算"
        : "已完成 · " + (data.explanation?.reason || "规则解读");
  } catch (error) {
    $("#status").textContent = error.message;
    data = null;
  } finally {
    $("#submit").disabled = false;
  }
};
function render() {
  $("#empty").hidden = true;
  $("#result").hidden = false;
  $("#identity").textContent =
    data.identity.name + " · " + data.identity.symbol;
  $("#meta").textContent = [
    data.identity.exchange,
    data.identity.currency,
    "截至 " + data.asOf,
    "日线",
    "规则引擎 v1",
  ].join(" / ");
  $("#warnings").textContent = data.warnings.join(" ");
  $("#summary").textContent = data.summary;
  $("#stats").replaceChildren(
    ...Object.entries(data.returns).map(([n, v]) => {
      const d = element("div", n + " 个交易日涨跌幅", "stat");
      d.append(element("b", (v > 0 ? "+" : "") + fmt(v) + "%"));
      return d;
    }),
    (() => {
      const d = element("div", "成交量 / 前20日均量", "stat");
      d.append(element("b", fmt(data.volumeRatio) + " ×"));
      return d;
    })(),
  );
  $("#interpretation").replaceChildren(
    ...data.interpretation.map((i) => {
      const d = element("article", undefined, "panel");
      d.append(element("h3", i.title), element("p", i.text));
      return d;
    }),
  );
  if (data.explanation?.provider === "deepseek") {
    const titles = [
      "DeepSeek · 趋势解释",
      "DeepSeek · 动能解释",
      "DeepSeek · 分歧与局限",
    ];
    data.explanation.sections.forEach((section, index) => {
      const card = element("article", undefined, "panel");
      const details = element("details");
      details.append(element("summary", "查看引用的程序事实"));
      section.factIds.forEach((id) =>
        details.append(
          element("p", id + "：" + JSON.stringify(data.explanation.facts[id])),
        ),
      );
      card.append(
        element("h3", titles[index]),
        element("p", section.text),
        details,
      );
      $("#interpretation").append(card);
    });
  }
  $("#source").textContent =
    data.source +
    " · " +
    data.adjustment +
    " · 获取于 " +
    data.fetchedAt +
    (data.cached ? "（5 分钟内缓存）" : "");
  $("#events").replaceChildren(
    ...data.events.toReversed().map((event) => {
      const b = element("button", event.title, event.type);
      b.append(element("small", event.date + " · " + event.context));
      b.onclick = () => {
        selected = event.date;
        $("#evidence").textContent =
          event.date +
          " " +
          event.title +
          "\n" +
          event.context +
          "\n前一日 DIF " +
          fmt(event.previous.dif) +
          " / DEA " +
          fmt(event.previous.dea) +
          "\n当日 DIF " +
          fmt(event.current.dif) +
          " / DEA " +
          fmt(event.current.dea) +
          "\n" +
          (event.type === "golden"
            ? "短期动能改善，不代表趋势已反转。"
            : "短期动能减弱，不代表未来必然下跌。");
        draw();
      };
      return b;
    }),
  );
  if (!data.events.length)
    $("#events").textContent = "计算范围内没有交叉事件。";
  $("#evidence").textContent = "选择信号查看前后数值与解释。";
  draw();
}
const ns = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs, text) {
  const e = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
}
function draw() {
  const count = Number($("#range").value);
  let end = data.rows.length;
  if (selected) {
    const index = data.rows.findIndex((r) => r.date === selected);
    if (index < end - count)
      end = Math.min(data.rows.length, index + Math.floor(count / 2));
  }
  const rows = data.rows.slice(Math.max(0, end - count), end),
    W = 800,
    H = 500,
    left = 58,
    right = 15,
    step = (W - left - right) / rows.length;
  const svg = svgEl("svg", {
    viewBox: "0 0 800 500",
    class: "chart",
    role: "img",
    "aria-label": "日线 K 线、成交量与 MACD 图",
  });
  const x = (i) => left + (i + 0.5) * step;
  const min = Math.min(
      ...rows.flatMap((r) => [r.low, r.ma20, r.ma60].filter((v) => v !== null)),
    ),
    max = Math.max(
      ...rows.flatMap((r) =>
        [r.high, r.ma20, r.ma60].filter((v) => v !== null),
      ),
    );
  const y = (v) => 220 - ((v - min) / (max - min || 1)) * 185;
  for (let k = 0; k <= 4; k++) {
    const value = min + ((max - min) * k) / 4;
    svg.append(
      svgEl("line", {
        x1: left,
        y1: y(value),
        x2: 785,
        y2: y(value),
        stroke: "#29373a",
      }),
      svgEl(
        "text",
        { x: 0, y: y(value) + 4, fill: "#9caeb0", "font-size": 11 },
        fmt(value),
      ),
    );
  }
  const line = (key, scale, color) =>
    svg.append(
      svgEl("polyline", {
        points: rows
          .map((r, i) => (r[key] === null ? null : x(i) + "," + scale(r[key])))
          .filter(Boolean)
          .join(" "),
        fill: "none",
        stroke: color,
        "stroke-width": 1.5,
      }),
    );
  rows.forEach((r, i) => {
    const color = r.close >= r.open ? "#99f0cc" : "#f092a1",
      bw = Math.max(1, step * 0.65);
    svg.append(
      svgEl("line", {
        x1: x(i),
        x2: x(i),
        y1: y(r.high),
        y2: y(r.low),
        stroke: color,
      }),
      svgEl("rect", {
        x: x(i) - bw / 2,
        y: Math.min(y(r.open), y(r.close)),
        width: bw,
        height: Math.max(1, Math.abs(y(r.open) - y(r.close))),
        fill: color,
      }),
    );
  });
  line("ma20", y, "#ebcc7e");
  line("ma60", y, "#baabf5");
  const maxVol = Math.max(...rows.map((r) => r.volume), 1);
  rows.forEach((r, i) =>
    svg.append(
      svgEl("rect", {
        x: x(i) - step * 0.3,
        y: 310 - (r.volume / maxVol) * 65,
        width: Math.max(1, step * 0.6),
        height: (r.volume / maxVol) * 65,
        fill: r.close >= r.open ? "#508675" : "#955761",
      }),
    ),
  );
  const extent = Math.max(
      ...rows.flatMap((r) => [
        Math.abs(r.dif || 0),
        Math.abs(r.dea || 0),
        Math.abs(r.hist || 0),
      ]),
      0.01,
    ),
    ym = (v) => 407 - (v / extent) * 65;
  svg.append(
    svgEl("line", { x1: left, x2: 785, y1: 407, y2: 407, stroke: "#46565a" }),
  );
  rows.forEach((r, i) =>
    svg.append(
      svgEl("rect", {
        x: x(i) - step * 0.3,
        y: Math.min(407, ym(r.hist || 0)),
        width: Math.max(1, step * 0.6),
        height: Math.max(1, Math.abs(ym(r.hist || 0) - 407)),
        fill: r.hist >= 0 ? "#508675" : "#955761",
      }),
    ),
  );
  line("dif", ym, "#ebcc7e");
  line("dea", ym, "#baabf5");
  for (const [label, yy] of [
    ["成交量（源单位）", 244],
    ["MACD · DIF / DEA / 2×柱", 335],
  ])
    svg.append(
      svgEl(
        "text",
        { x: left, y: yy, fill: "#9caeb0", "font-size": 11 },
        label,
      ),
    );
  const report = (r) => {
    $("#cursor").textContent =
      r.date +
      " | O " +
      fmt(r.open) +
      " H " +
      fmt(r.high) +
      " L " +
      fmt(r.low) +
      " C " +
      fmt(r.close) +
      " | MA20 " +
      fmt(r.ma20) +
      " MA60 " +
      fmt(r.ma60) +
      " | DIF " +
      fmt(r.dif) +
      " DEA " +
      fmt(r.dea);
  };
  rows.forEach((r, i) => {
    if (data.events.some((e) => e.date === r.date))
      svg.append(svgEl("circle", { cx: x(i), cy: 18, r: 3, fill: "#ebcc7e" }));
    if (r.date === selected)
      svg.append(
        svgEl("line", {
          x1: x(i),
          x2: x(i),
          y1: 10,
          y2: 477,
          stroke: "#fff",
          "stroke-dasharray": "4 4",
        }),
      );
    const hit = svgEl("rect", {
      x: left + i * step,
      y: 10,
      width: step,
      height: 467,
      fill: "transparent",
      tabindex: 0,
      "aria-label": r.date + " 收盘 " + fmt(r.close),
    });
    hit.onmouseenter = () => report(r);
    hit.onfocus = () => report(r);
    hit.onclick = () => {
      selected = r.date;
      draw();
    };
    svg.append(hit);
  });
  svg.append(
    svgEl(
      "text",
      { x: left, y: 496, fill: "#9caeb0", "font-size": 11 },
      rows[0].date,
    ),
    svgEl(
      "text",
      { x: 700, y: 496, fill: "#9caeb0", "font-size": 11 },
      rows.at(-1).date,
    ),
  );
  $("#chart").replaceChildren(svg);
  report(rows.find((r) => r.date === selected) || rows.at(-1));
}
$("#range").onchange = () => {
  selected = null;
  draw();
};
$("#export").onclick = () => {
  if (!data) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = element("a");
  a.href = url;
  a.download = data.identity.symbol + "-" + data.asOf + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
