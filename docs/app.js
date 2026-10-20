// 大乐透历史数据分析 - 前端逻辑
const DATA = window.DLT_DATA || [];
const META = window.DLT_META || {};
const FRONT_N = 35, BACK_N = 12;

const SECTIONS = [
  { id: "overview", name: "总览" },
  { id: "trend", name: "号码走势" },
  { id: "sum", name: "和值分布" },
  { id: "road", name: "012路" },
  { id: "odd", name: "奇偶·大小" },
  { id: "repeat", name: "重号分析" },
  { id: "missing", name: "遗漏冷热" },
  { id: "span", name: "跨度分析" },
  { id: "dup", name: "重复组合" },
  { id: "prize", name: "奖金·销量" },
];
const CHART_ID = {
  sum: "sumChart", road: "roadChart",
  odd: "oddChart", repeat: "repChart", missing: "missChart", span: "spanChart", dup: "dupChart", prize: "prizeChart",
};
const charts = {};
let curZone = "front";   // front / back
let curRoad = "num";     // num / pie
let curOdd = "odd";      // odd / big
let sumView = "num", sumPage = -1;     // 和值：数字连线 / 历史分布
let roadPage = -1;                     // 012路 分期页码
let oddView = "num", oddPage = -1;     // 奇偶大小
let repView = "num", repPage = -1;     // 重号
let spanView = "num", spanPage = -1;   // 跨度：数字连线 / 历史分布
let dupMin = 3, dupTargetIndex = -1;    // 重复组合：最小重复数 / 当前查看期索引
let dupMode = "single";                  // single=当前期 / all=全部历史期对

// ---------- 工具 ----------
const sumFront = d => d.front.filter(x => x != null).reduce((a, b) => a + b, 0);
const oddCount = d => d.front.filter(x => x != null && x % 2 === 1).length;
const bigCount = d => d.front.filter(x => x != null && x > 18).length;
const roadCount = d => {
  const c = [0, 0, 0];
  d.front.forEach(x => { if (x != null) c[x % 3]++; });
  return c;
};
function getChart(id) {
  if (!charts[id]) charts[id] = echarts.init(document.getElementById(id));
  return charts[id];
}

// ---------- 分页 / 走势通用工具 ----------
// 返回 [start, end, page]；page=-1 表示定位到最新一页
function pageBounds(page) {
  const t = Math.ceil(DATA.length / GROUP);
  if (page < 0 || page >= t) page = t - 1;
  return [page * GROUP, Math.min(page * GROUP + GROUP, DATA.length), page];
}
function setPageInfo(id, p, s, e) {
  const t = Math.ceil(DATA.length / GROUP);
  document.getElementById(id).textContent =
    `第 ${p + 1}/${t} 页 · ${DATA[s].issue} – ${DATA[e - 1].issue}`;
}
function stepPage(cur, d) {
  const t = Math.ceil(DATA.length / GROUP);
  if (cur < 0 || cur >= t) cur = t - 1;
  return Math.min(Math.max(cur + d, 0), t - 1);
}
// 数字连线走势表：每期一行，值以圆点显示在对应列，同色系列相邻期用折线相连
function buildNumTrend(wrapId, cols, rows, colW) {
  const firstW = 74;
  const widths = cols.map(c => c.w || colW);
  let html = '<table class="tt nt"><thead><tr><th style="width:' + firstW + 'px">期号</th>';
  cols.forEach(c => html += `<th style="width:${c.w || colW}px">${c.label}</th>`);
  html += '</tr></thead><tbody>';
  rows.forEach(r => {
    html += `<tr><td class="issue">${r.issue}</td>`;
    cols.forEach((c, ci) => {
      const p = r.pts.find(q => q.col === ci);
      html += p
        ? `<td class="hitc"><span class="nt-dot" style="background:${p.color}">${p.text}</span></td>`
        : '<td></td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  const wrap = document.getElementById(wrapId);
  wrap.innerHTML = html;
  const tbl = wrap.querySelector("table");
  const trs = tbl.querySelectorAll("tbody tr");
  const ptsByColor = {};
  rows.forEach((r, ri) => r.pts.forEach(p => {
    const td = trs[ri].children[p.col + 1];   // +1 跳过期号列
    p.x = td.offsetLeft + td.offsetWidth / 2;
    p.y = td.offsetTop + td.offsetHeight / 2;
    (ptsByColor[p.color] = ptsByColor[p.color] || []).push(p);
  }));
  let svg = `<svg class="nt-svg" width="${tbl.offsetWidth}" height="${tbl.offsetHeight}">`;
  for (const [color, pts] of Object.entries(ptsByColor)) {
    svg += `<polyline points="${pts.map(p => p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ")}" fill="none" stroke="${color}" stroke-width="1.3" opacity="0.55"/>`;
  }
  svg += "</svg>";
  wrap.insertAdjacentHTML("beforeend", svg);
}

// ---------- 导航 ----------
function buildTabs() {
  const nav = document.getElementById("tabs");
  SECTIONS.forEach(s => {
    const b = document.createElement("button");
    b.textContent = s.name;
    b.dataset.id = s.id;
    if (s.id === "overview") b.classList.add("active");
    b.onclick = () => showSection(s.id);
    nav.appendChild(b);
  });
}
function showSection(id) {
  document.querySelectorAll("nav button").forEach(b =>
    b.classList.toggle("active", b.dataset.id === id));
  document.querySelectorAll("section").forEach(s =>
    s.classList.toggle("active", s.id === id));
  const render = {
    overview: renderOverview, trend: renderTrend, sum: renderSum,
    road: renderRoad, odd: renderOdd, repeat: renderRepeat,
    missing: renderMissing, span: renderSpan, dup: renderDup, prize: renderPrize,
  }[id];
  if (render) render();
}

// ---------- 总览 ----------
function renderOverview() {
  let sub = `共 ${META.count} 期 · ${META.first} → ${META.last} · 数据源：体彩官网历史开奖接口`;
  if (META.updated) sub += ` · 更新于 ${META.updated}`;
  document.getElementById("subtitle").textContent = sub;
  const last = DATA[DATA.length - 1];
  const maxSale = Math.max(...DATA.map(d => d.sale || 0));
  const maxPool = Math.max(...DATA.map(d => d.pool || 0));
  const cards = [
    { k: "总期数", v: META.count },
    { k: "起始期号", v: META.first },
    { k: "最新期号", v: last.issue + " (" + last.date + ")" },
    { k: "最大单期销售额", v: (maxSale / 1e8).toFixed(2) + " 亿" },
    { k: "最大奖池滚存", v: (maxPool / 1e8).toFixed(2) + " 亿" },
  ];
  document.getElementById("ovCards").innerHTML = cards.map(c =>
    `<div class="card"><div class="k">${c.k}</div><div class="v">${c.v}</div></div>`).join("");
  const balls = last.front.filter(x => x != null)
    .map(x => `<div class="ball f">${String(x).padStart(2, "0")}</div>`).join("") +
    last.back.filter(x => x != null)
    .map(x => `<div class="ball b">${String(x).padStart(2, "0")}</div>`).join("");
  document.getElementById("ovLatest").innerHTML = balls;
}

// ---------- 号码走势（传统表格走势图，30 期/组） ----------
const GROUP = 30;
let curPage = -1; // -1 = 定位到最新一页
let curView = "table"; // table | line
let showTrend = true;   // 同号纵向走势线
let showPattern = true; // 重号/连号/斜连 高亮
const missCache = { front: null, back: null };

function ensureMiss(zone) {
  if (missCache[zone]) return missCache[zone];
  const N = zone === "front" ? FRONT_N : BACK_N;
  const miss = DATA.map(() => new Array(N).fill(null));
  const last = new Array(N).fill(-1);
  DATA.forEach((d, i) => {
    for (let m = 0; m < N; m++) miss[i][m] = last[m] === -1 ? null : i - last[m];
    (d[zone] || []).forEach(x => { if (x != null) last[x - 1] = i; });
  });
  missCache[zone] = miss;
  return miss;
}
function trendTotal() { return Math.ceil(DATA.length / GROUP); }

function renderTrend() {
  if (curView === "line") { renderTrendLine(); return; }
  const total = trendTotal();
  if (curPage < 0 || curPage >= total) curPage = total - 1;
  const zone = curZone;
  const N = zone === "front" ? FRONT_N : BACK_N;
  const miss = ensureMiss(zone);
  const ranges = zone === "front"
    ? [[1, 12], [13, 24], [25, 35]]
    : [[1, 4], [5, 8], [9, 12]];
  const pad = m => String(m).padStart(2, "0");
  const start = curPage * GROUP;
  const end = Math.min(start + GROUP, DATA.length);

  // 表头：第一行分区标题（跨列），第二行号码
  let html = '<thead><tr><th rowspan="2">期号</th>';
  ranges.forEach((r, idx) => {
    html += `<th colspan="${r[1] - r[0] + 1}" class="zt z${idx + 1}">${idx + 1}区 ${pad(r[0])}-${pad(r[1])}</th>`;
  });
  html += '<th colspan="3" class="zt zc">各区出号</th></tr><tr>';
  ranges.forEach(r => {
    for (let m = r[0]; m <= r[1]; m++) {
      html += m === r[0] ? `<th class="zstart">${pad(m)}</th>` : `<th>${pad(m)}</th>`;
    }
  });
  html += '<th class="zstart">1</th><th>2</th><th>3</th></tr></thead><tbody>';

  for (let i = start; i < end; i++) {   // 最新在最下（自上而下沉旧→新）
    const d = DATA[i];
    const cnt = [0, 0, 0];
    const nums = d[zone] || [];
    html += `<tr><td class="issue">${d.issue}</td>`;
    for (let m = 1; m <= N; m++) {
      if (nums.includes(m)) {
        html += `<td class="hitc"><span class="ball-s ${zone === "front" ? "f" : "b"}">${pad(m)}</span></td>`;
        ranges.forEach((r, idx) => { if (m >= r[0] && m <= r[1]) cnt[idx]++; });
      } else {
        const v = miss[i][m - 1];
        html += `<td class="miss">${v == null ? "-" : v}</td>`;
      }
    }
    html += `<td class="sum">${cnt[0]}</td><td class="sum">${cnt[1]}</td><td class="sum">${cnt[2]}</td></tr>`;
  }
  html += "</tbody>";
  const tbl = document.getElementById("trendTable");
  tbl.innerHTML = html;
  drawTrendLines(tbl, N);
  document.getElementById("trendPageInfo").textContent =
    `第 ${curPage + 1}/${total} 页 · ${DATA[start].issue} – ${DATA[end - 1].issue}`;
}
// 在遗漏表上叠加连线（受 showTrend / showPattern 开关控制）：
// 同号竖向走势线、连号(同期相邻号)、重号(邻期同号)、斜连(连续>=3期相邻号同向)
function drawTrendLines(tbl, N) {
  const scroller = tbl.parentElement;
  scroller.style.position = "relative";
  scroller.querySelectorAll(".nt-svg").forEach(s => s.remove());
  if (!showTrend && !showPattern) return;
  const trs = Array.from(tbl.querySelectorAll("tbody tr"));
  const rows = trs.length;
  const colHits = {};            // m -> [{r,x,y}] 该号码在本页各命中位置
  const hitPos = [];             // 每行 -> [{m,x,y,r}]
  for (let m = 1; m <= N; m++) colHits[m] = [];
  trs.forEach((tr, r) => {
    const list = [];
    for (let m = 1; m <= N; m++) {
      const td = tr.children[m];
      if (td && td.classList.contains("hitc")) {
        const x = td.offsetLeft + td.offsetWidth / 2;
        const y = td.offsetTop + td.offsetHeight / 2;
        list.push({ m, x, y, r });
        colHits[m].push({ r, x, y });
      }
    }
    hitPos.push(list);
  });

  let svg = `<svg class="nt-svg" width="${tbl.offsetWidth}" height="${tbl.offsetHeight}">`;

  // 同号竖向走势线（按号着色，弱显，作底图）
  if (showTrend) {
    for (let m = 1; m <= N; m++) {
      const pts = colHits[m];
      if (pts.length > 1) {
        const color = `hsl(${Math.round((m - 1) / N * 320)}, 70%, 50%)`;
        svg += `<polyline points="${pts.map(p => p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ")}" fill="none" stroke="${color}" stroke-width="1.2" opacity="0.3"/>`;
      }
    }
  }

  if (showPattern) {
    // 连号（同期内相邻号码）-> 青色横线
    hitPos.forEach(row => {
      for (let i = 0; i < row.length; i++) {
        for (let j = i + 1; j < row.length; j++) {
          if (row[j].m - row[i].m === 1) {
            svg += `<line x1="${row[i].x.toFixed(1)}" y1="${row[i].y.toFixed(1)}" x2="${row[j].x.toFixed(1)}" y2="${row[j].y.toFixed(1)}" stroke="#2a9d8f" stroke-width="2.4" opacity="0.85"/>`;
          }
        }
      }
    });

    // 重号（相邻两期同号）-> 橙色粗段
    for (let r = 0; r < rows - 1; r++) {
      const setB = new Set(hitPos[r + 1].map(p => p.m));
      hitPos[r].forEach(p => {
        if (setB.has(p.m)) {
          const q = hitPos[r + 1].find(z => z.m === p.m);
          svg += `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}" stroke="#f4a261" stroke-width="3" opacity="0.92"/>`;
        }
      });
    }

    // 斜连：连续 >=3 期、每期号码 ±1 的同向斜线（按 m-r / m+r 分组共线，再按连续期号拆段）
    const groups = {};
    hitPos.forEach(row => row.forEach(p => {
      (groups["R" + (p.m - p.r)] = groups["R" + (p.m - p.r)] || []).push(p);
      (groups["L" + (p.m + p.r)] = groups["L" + (p.m + p.r)] || []).push(p);
    }));
    Object.values(groups).forEach(arr => {
      if (arr.length < 3) return;
      arr.sort((a, b) => a.r - b.r);
      let seg = [arr[0]];
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].r === arr[i - 1].r + 1) seg.push(arr[i]);
        else { if (seg.length >= 3) svg += polyFrom(seg); seg = [arr[i]]; }
      }
      if (seg.length >= 3) svg += polyFrom(seg);
    });
  }

  svg += "</svg>";
  scroller.insertAdjacentHTML("beforeend", svg);
}

// 生成一条斜连折线
function polyFrom(seg) {
  return `<polyline points="${seg.map(p => p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ")}" fill="none" stroke="#9b5de5" stroke-width="2" opacity="0.75"/>`;
}

function pageMove(d) {
  const total = trendTotal();
  if (curPage < 0 || curPage >= total) curPage = total - 1;
  curPage = Math.min(Math.max(curPage + d, 0), total - 1);
  renderTrend();
}

function setZone(z) {
  curZone = z;
  curPage = -1;
  document.querySelectorAll('[data-zone]').forEach(b =>
    b.classList.toggle("active", b.dataset.zone === z));
  renderTrend();
}

// 基本走势线：每期开出的号码按大小排序为 K 条轨迹曲线
function renderTrendLine() {
  const zone = curZone;
  const N = zone === "front" ? FRONT_N : BACK_N;
  const K = zone === "front" ? 5 : 2;
  const total = trendTotal();
  if (curPage < 0 || curPage >= total) curPage = total - 1;
  const start = curPage * GROUP;
  const end = Math.min(start + GROUP, DATA.length);
  const issues = DATA.slice(start, end).map(d => d.issue);
  const colors = ["#e63946", "#457b9d", "#2a9d8f", "#e9c46a", "#9b5de5"];
  const series = [];
  for (let k = 0; k < K; k++) {
    series.push({
      name: "第" + (k + 1) + "位",
      type: "line", showSymbol: true, symbolSize: 6,
      connectNulls: false, lineStyle: { width: 1.5 },
      itemStyle: { color: colors[k % colors.length] },
      data: DATA.slice(start, end).map(d => {
        const a = (d[zone] || []).filter(x => x != null).sort((p, q) => p - q);
        return a[k] != null ? a[k] : null;
      }),
    });
  }
  const chart = getChart("trendChart");
  chart.setOption({
    tooltip: { trigger: "axis" },
    legend: { top: 6 },
    grid: { left: 40, right: 20, top: 40, bottom: 50 },
    xAxis: { type: "category", data: issues,
      axisLabel: { interval: Math.max(0, Math.floor(issues.length / 10)) } },
    yAxis: { type: "value", min: 1, max: N, name: zone === "front" ? "前区号码" : "后区号码" },
    series,
  }, true);
}

function setView(v) {
  curView = v;
  document.querySelectorAll('[data-view]').forEach(b =>
    b.classList.toggle("active", b.dataset.view === v));
  document.getElementById("trendTableView").style.display = v === "table" ? "block" : "none";
  document.getElementById("trendLineView").style.display = v === "line" ? "block" : "none";
  renderTrend();
}

function toggleTrend() {
  showTrend = !showTrend;
  document.querySelectorAll('[data-line="trend"]').forEach(b =>
    b.classList.toggle("active", showTrend));
  renderTrend();
}

function togglePattern() {
  showPattern = !showPattern;
  document.querySelectorAll('[data-line="pattern"]').forEach(b =>
    b.classList.toggle("active", showPattern));
  renderTrend();
}

// ---------- 和值 ----------
function renderSum() {
  if (sumView === "num") {
    const [s, e, p] = pageBounds(sumPage);
    const cols = [];
    for (let a = 15; a <= 145; a += 10) cols.push({ label: `${a}-${a + 9}`, w: 46 });
    cols.push({ label: "155", w: 46 });
    const rows = DATA.slice(s, e).map(d => {
      const v = sumFront(d);
      const col = v >= 155 ? 14 : Math.floor((v - 15) / 10);
      return { issue: d.issue, pts: [{ col, text: String(v), color: "#e63946" }] };
    });
    buildNumTrend("sumTrendWrap", cols, rows, 46);
    setPageInfo("sumPageInfo", p, s, e);
    return;
  }
  const chart = getChart("sumChart");
  const counts = {};
  DATA.forEach(d => { const s = sumFront(d); counts[s] = (counts[s] || 0) + 1; });
  const keys = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const avg = (keys.reduce((a, k) => a + k * counts[k], 0) /
    keys.reduce((a, k) => a + counts[k], 0)).toFixed(1);
  chart.setOption({
    tooltip: { trigger: "axis" },
    grid: { left: 50, right: 30, top: 30, bottom: 50 },
    xAxis: { type: "category", data: keys, name: "和值" },
    yAxis: { type: "value", name: "出现期数" },
    series: [{
      type: "bar", data: keys.map(k => counts[k]), itemStyle: { color: "#e63946" },
      markLine: { data: [{ xAxis: avg }], label: { formatter: "均值 " + avg } },
    }],
  }, true);
}
function setSumView(v) {
  sumView = v;
  document.querySelectorAll('[data-sv]').forEach(b =>
    b.classList.toggle("active", b.dataset.sv === v));
  document.getElementById("sumTrendWrap").style.display = v === "num" ? "block" : "none";
  document.getElementById("sumChart").style.display = v === "dist" ? "block" : "none";
  document.getElementById("sumPager").style.display = v === "num" ? "" : "none";
  renderSum();
}
function sumPageMove(d) { sumPage = stepPage(sumPage, d); renderSum(); }

// ---------- 012路 ----------
function renderRoad() {
  if (curRoad === "num") {
    const [s, e, p] = pageBounds(roadPage);
    const colors = ["#457b9d", "#2a9d8f", "#e9c46a"];
    const cols = [];
    ["0路", "1路", "2路"].forEach(n => {
      for (let k = 0; k <= 5; k++) cols.push({ label: k === 0 ? n : String(k), w: 30 });
    });
    const rows = DATA.slice(s, e).map(d => ({
      issue: d.issue,
      pts: roadCount(d).map((v, g) => ({ col: g * 6 + v, text: String(v), color: colors[g] })),
    }));
    buildNumTrend("roadTrendWrap", cols, rows, 30);
    setPageInfo("roadPageInfo", p, s, e);
    return;
  }
  const chart = getChart("roadChart");
  if (curRoad === "pie") {
    const tot = [0, 0, 0];
    DATA.forEach(d => roadCount(d).forEach((c, i) => tot[i] += c));
    chart.setOption({
      tooltip: { trigger: "item" },
      legend: { data: ["0路", "1路", "2路"], top: 10 },
      series: [{
        type: "pie", radius: ["35%", "65%"],
        data: [0, 1, 2].map(i => ({ name: i + "路", value: tot[i] })),
      }],
    }, true);
  }
}
function setRoad(v) {
  curRoad = v;
  document.querySelectorAll('[data-v]').forEach(b =>
    b.classList.toggle("active", b.dataset.v === v));
  document.getElementById("roadTrendWrap").style.display = v === "num" ? "block" : "none";
  document.getElementById("roadChart").style.display = v === "pie" ? "block" : "none";
  document.getElementById("roadPager").style.display = v === "num" ? "" : "none";
  renderRoad();
}
function roadPageMove(d) { roadPage = stepPage(roadPage, d); renderRoad(); }

// ---------- 奇偶 / 大小 ----------
function renderOdd() {
  if (oddView === "num") {
    const [s, e, p] = pageBounds(oddPage);
    const metric = curOdd === "odd" ? oddCount : bigCount;
    const color = curOdd === "odd" ? "#e07a5f" : "#457b9d";
    const cols = [0, 1, 2, 3, 4, 5].map(k => ({ label: String(k), w: 42 }));
    const rows = DATA.slice(s, e).map(d => {
      const v = metric(d);
      return { issue: d.issue, pts: [{ col: v, text: String(v), color }] };
    });
    buildNumTrend("oddTrendWrap", cols, rows, 42);
    setPageInfo("oddPageInfo", p, s, e);
    return;
  }
  const chart = getChart("oddChart");
  const metric = curOdd === "odd" ? oddCount : bigCount;
  const dist = [0, 0, 0, 0, 0, 0];
  DATA.forEach(d => { const n = metric(d); if (n >= 0 && n <= 5) dist[n]++; });
  const title = curOdd === "odd" ? "前区奇偶比（奇数个数）" : "前区大小比（大号>18个数）";
  chart.setOption({
    title: { text: title, left: "center", textStyle: { fontSize: 14 } },
    tooltip: { trigger: "axis" },
    grid: { left: 50, right: 30, top: 50, bottom: 40 },
    xAxis: { type: "category", data: ["0", "1", "2", "3", "4", "5"], name: "个数" },
    yAxis: { type: "value", name: "出现期数" },
    series: [{
      type: "bar", data: dist, barWidth: "55%",
      itemStyle: { color: "#457b9d" },
      markLine: { data: [{ type: "average", name: "均值" }] },
    }],
  }, true);
}
function setOdd(v) {
  curOdd = v;
  document.querySelectorAll('[data-o]').forEach(b =>
    b.classList.toggle("active", b.dataset.o === v));
  renderOdd();
}
function setOddView(v) {
  oddView = v;
  document.querySelectorAll('[data-ov]').forEach(b =>
    b.classList.toggle("active", b.dataset.ov === v));
  document.getElementById("oddTrendWrap").style.display = v === "num" ? "block" : "none";
  document.getElementById("oddChart").style.display = v === "dist" ? "block" : "none";
  document.getElementById("oddPager").style.display = v === "num" ? "" : "none";
  renderOdd();
}
function oddPageMove(d) { oddPage = stepPage(oddPage, d); renderOdd(); }

// ---------- 重号分析 ----------
function repCount(i) {
  const a = new Set(DATA[i - 1].front.filter(x => x != null));
  let n = 0;
  DATA[i].front.forEach(x => { if (x != null && a.has(x)) n++; });
  return n;
}
function renderRepeat() {
  if (repView === "num") {
    const [s, e, p] = pageBounds(repPage);
    const cols = [0, 1, 2, 3, 4, 5].map(k => ({ label: String(k), w: 42 }));
    const rows = [];
    for (let i = s; i < e; i++) {
      const v = i === 0 ? null : repCount(i);
      rows.push({
        issue: DATA[i].issue,
        pts: v == null ? [] : [{ col: v, text: String(v), color: "#2a9d8f" }],
      });
    }
    buildNumTrend("repTrendWrap", cols, rows, 42);
    setPageInfo("repPageInfo", p, s, e);
    return;
  }
  const chart = getChart("repChart");
  const freq = [0, 0, 0, 0, 0, 0];
  for (let i = 1; i < DATA.length; i++) {
    const n = repCount(i);
    if (n >= 0 && n <= 5) freq[n]++;
  }
  const total = freq.reduce((a, b) => a + b, 0);
  const avg = (freq.reduce((a, c, i) => a + c * i, 0) / total).toFixed(2);
  chart.setOption({
    tooltip: { trigger: "axis" },
    grid: { left: 50, right: 30, top: 30, bottom: 40 },
    xAxis: { type: "category", data: ["0", "1", "2", "3", "4", "5"], name: "重号个数" },
    yAxis: { type: "value", name: "出现期数" },
    series: [{
      type: "bar", data: freq, barWidth: "55%", itemStyle: { color: "#2a9d8f" },
      label: { show: true, position: "top" },
      markLine: { data: [{ xAxis: avg }], label: { formatter: "均值 " + avg } },
    }],
  }, true);
}
function setRepView(v) {
  repView = v;
  document.querySelectorAll('[data-rv]').forEach(b =>
    b.classList.toggle("active", b.dataset.rv === v));
  document.getElementById("repTrendWrap").style.display = v === "num" ? "block" : "none";
  document.getElementById("repChart").style.display = v === "dist" ? "block" : "none";
  document.getElementById("repPager").style.display = v === "num" ? "" : "none";
  renderRepeat();
}
function repPageMove(d) { repPage = stepPage(repPage, d); renderRepeat(); }

// ---------- 遗漏 / 冷热 ----------
// 每个号码计算：当前遗漏、平均遗漏、最大遗漏、历史总频次
function omissionStat(m) {
  let app = 0, maxOmit = 0, last = -1;
  for (let i = 0; i < DATA.length; i++) {
    if (DATA[i].front.includes(m)) {
      if (last >= 0) maxOmit = Math.max(maxOmit, i - last - 1);
      last = i; app++;
    }
  }
  const cur = last >= 0 ? DATA.length - 1 - last : DATA.length;  // 当前遗漏(期)
  const avg = app > 0 ? (DATA.length - app) / app : DATA.length;  // 平均遗漏(期)
  return { cur, avg: Math.round(avg * 10) / 10, max: maxOmit, app };
}
function renderMissing() {
  const miss = [], avg = [], max = [], freq = [];
  for (let m = 1; m <= FRONT_N; m++) {
    const s = omissionStat(m);
    miss.push(s.cur); avg.push(s.avg); max.push(s.max); freq.push(s.app);
  }
  const chart = getChart("missChart");
  chart.setOption({
    tooltip: { trigger: "axis" },
    legend: { data: ["当前遗漏", "平均遗漏", "最大遗漏", "历史总频次"], top: 10 },
    grid: { left: 50, right: 55, top: 45, bottom: 40 },
    xAxis: { type: "category", data: Array.from({ length: FRONT_N }, (_, i) => i + 1) },
    yAxis: [
      { type: "value", name: "遗漏(期)", position: "left" },
      { type: "value", name: "频次", position: "right" },
    ],
    series: [
      { name: "当前遗漏", type: "bar", data: miss, itemStyle: { color: "#e63946" } },
      { name: "平均遗漏", type: "bar", data: avg, itemStyle: { color: "#f4a261" } },
      { name: "最大遗漏", type: "bar", data: max, itemStyle: { color: "#9b5de5" } },
      { name: "历史总频次", type: "line", yAxisIndex: 1, data: freq, itemStyle: { color: "#457b9d" } },
    ],
  }, true);
}

// ---------- 跨度 ----------
const spanFront = d => {
  const a = d.front.filter(x => x != null);
  return a.length ? Math.max(...a) - Math.min(...a) : 0;
};
function renderSpan() {
  if (spanView === "num") {
    const [s, e, p] = pageBounds(spanPage);
    const cols = [];
    for (let v = 4; v <= 34; v++) cols.push({ label: String(v), w: 28 });
    const rows = DATA.slice(s, e).map(d => {
      const v = spanFront(d);
      return { issue: d.issue, pts: [{ col: v - 4, text: String(v), color: "#9b5de5" }] };
    });
    buildNumTrend("spanTrendWrap", cols, rows, 28);
    setPageInfo("spanPageInfo", p, s, e);
    return;
  }
  const chart = getChart("spanChart");
  const counts = {};
  for (let v = 4; v <= 34; v++) counts[v] = 0;
  DATA.forEach(d => { const v = spanFront(d); if (counts[v] != null) counts[v]++; });
  const keys = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const avg = (keys.reduce((a, k) => a + k * counts[k], 0) /
    keys.reduce((a, k) => a + counts[k], 0)).toFixed(1);
  chart.setOption({
    tooltip: { trigger: "axis" },
    grid: { left: 50, right: 30, top: 30, bottom: 50 },
    xAxis: { type: "category", data: keys, name: "前区跨度(最大-最小)" },
    yAxis: { type: "value", name: "出现期数" },
    series: [{
      type: "bar", data: keys.map(k => counts[k]), itemStyle: { color: "#9b5de5" },
      markLine: { data: [{ xAxis: avg }], label: { formatter: "均值 " + avg } },
    }],
  }, true);
}
function setSpanView(v) {
  spanView = v;
  document.querySelectorAll('[data-span]').forEach(b =>
    b.classList.toggle("active", b.dataset.span === v));
  document.getElementById("spanTrendWrap").style.display = v === "num" ? "block" : "none";
  document.getElementById("spanChart").style.display = v === "dist" ? "block" : "none";
  document.getElementById("spanPager").style.display = v === "num" ? "" : "none";
  renderSpan();
}
function spanPageMove(d) { spanPage = stepPage(spanPage, d); renderSpan(); }

// ---------- 重复组合（前区 5 码历史重复） ----------
let _dupRevIndex = null;   // 号码 -> [期索引,...]
let _dupDist = null;       // 缓存：全量历史按重叠数的重复对数量 {3,4,5}
function dupRevIndex() {
  if (_dupRevIndex) return _dupRevIndex;
  const idx = {};
  DATA.forEach((d, i) => d.front.forEach(x => { (idx[x] = idx[x] || []).push(i); }));
  _dupRevIndex = idx;
  return idx;
}
function dupGlobalDist() {
  if (_dupDist) return _dupDist;
  const idx = dupRevIndex();
  const dist = { 3: 0, 4: 0, 5: 0 };
  const N = DATA.length;
  for (let i = 0; i < N; i++) {
    const cand = {};
    DATA[i].front.forEach(x => (idx[x] || []).forEach(j => {
      if (j > i) cand[j] = (cand[j] || 0) + 1;
    }));
    for (const j in cand) { const c = cand[j]; if (c >= 3 && c <= 5) dist[c]++; }
  }
  _dupDist = dist;
  return dist;
}
function dupMatches(targetIndex) {
  const idx = dupRevIndex();
  const nums = DATA[targetIndex].front;
  const tally = {};
  nums.forEach(x => (idx[x] || []).forEach(j => {
    if (j !== targetIndex) tally[j] = (tally[j] || 0) + 1;
  }));
  const matches = [];
  for (const j in tally) {
    const c = tally[j];
    if (c >= dupMin) {
      const sj = DATA[j].front;
      const inter = nums.filter(n => sj.includes(n)).sort((a, b) => a - b);
      matches.push({ j: Number(j), count: c, inter });
    }
  }
  matches.sort((a, b) => b.count - a.count || b.j - a.j);
  return matches;
}
const pad2 = x => String(x).padStart(2, "0");

// 全量历史期对：按最小重复数收集（上限 cap）
function dupAllPairs(min, cap) {
  const idx = dupRevIndex();
  const N = DATA.length;
  const out = [];
  for (let i = 0; i < N && out.length < cap; i++) {
    const cand = {};
    DATA[i].front.forEach(x => (idx[x] || []).forEach(j => {
      if (j > i) cand[j] = (cand[j] || 0) + 1;
    }));
    for (const j in cand) {
      const c = cand[j];
      if (c >= min) {
        const a = DATA[i].front, b = DATA[Number(j)].front;
        const inter = a.filter(n => b.includes(n)).sort((x, y) => x - y);
        out.push({ i, j: Number(j), count: c, inter });
        if (out.length >= cap) break;
      }
    }
  }
  return out;
}

function renderDupAll(wrap) {
  const dist = dupGlobalDist();
  const total = dupMin === 3 ? (dist[3] + dist[4] + dist[5])
    : dupMin === 4 ? (dist[4] + dist[5]) : dist[5];
  const cap = 1000;
  const pairs = dupAllPairs(dupMin, cap);
  let html = `<table class="tt dup"><thead><tr>
    <th>期号A</th><th>A号码</th><th>期号B</th><th>B号码</th><th>重复号码</th><th>重复数</th></tr></thead><tbody>`;
  if (!pairs.length) {
    html += `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--sub)">无重复 ≥${dupMin} 个的期对</td></tr>`;
  } else {
    pairs.forEach(p => {
      const a = DATA[p.i], b = DATA[p.j];
      const ba = a.front.map(x => `<span class="db ${p.inter.includes(x) ? "hl" : ""}">${pad2(x)}</span>`).join("");
      const bb = b.front.map(x => `<span class="db ${p.inter.includes(x) ? "hl" : ""}">${pad2(x)}</span>`).join("");
      const inter = p.inter.map(x => `<span class="db hl">${pad2(x)}</span>`).join(" ");
      html += `<tr><td>${a.issue}<br><span class="d">${a.date}</span></td><td>${ba}</td>
        <td>${b.issue}<br><span class="d">${b.date}</span></td><td>${bb}</td>
        <td>${inter}</td><td><b>${p.count}</b></td></tr>`;
    });
  }
  html += "</tbody></table>";
  if (total > pairs.length) html += `<p class="hint">共 ${total} 对，仅显示前 ${pairs.length} 对。</p>`;
  wrap.innerHTML = html;
}

function renderDup() {
  if (dupTargetIndex < 0) dupTargetIndex = DATA.length - 1;
  const dist = dupGlobalDist();
  const total = (dist[3] || 0) + (dist[4] || 0) + (dist[5] || 0);
  // 期号下拉（只填充一次）
  const sel = document.getElementById("dupIssueSel");
  if (!sel.dataset.filled) {
    for (let i = DATA.length - 1; i >= 0; i--) {
      const o = document.createElement("option");
      o.value = i; o.textContent = DATA[i].issue + " (" + DATA[i].date + ")";
      sel.appendChild(o);
    }
    sel.dataset.filled = "1";
  }
  sel.value = dupTargetIndex;
  document.getElementById("dupSummary").innerHTML =
    `全量历史中，前区两期重复 <b>≥3</b> 个号码的组合共 <b>${total}</b> 对（重复3个 ${dist[3] || 0}、4个 ${dist[4] || 0}、5个 ${dist[5] || 0}）。点击柱状图可直接查看该重叠数的全部期对。`;
  // 分布柱状图（可点击联动）
  const chart = getChart("dupChart");
  chart.off("click");
  chart.setOption({
    tooltip: { trigger: "axis" },
    grid: { left: 55, right: 20, top: 20, bottom: 30 },
    xAxis: { type: "category", data: ["重复3个", "重复4个", "重复5个"] },
    yAxis: { type: "value", name: "对数" },
    series: [{
      type: "bar", data: [dist[3] || 0, dist[4] || 0, dist[5] || 0],
      itemStyle: { color: "#e63946" }, label: { show: true, position: "top" },
    }],
  }, true);
  chart.on("click", p => {
    if (p.componentType !== "series") return;
    dupMin = 3 + p.dataIndex;
    dupMode = "all";
    document.querySelectorAll('[data-dmin]').forEach(b =>
      b.classList.toggle("active", Number(b.dataset.dmin) === dupMin));
    document.querySelectorAll('[data-dmode]').forEach(b =>
      b.classList.toggle("active", b.dataset.dmode === "all"));
    renderDup();
  });
  // 表格
  const targetBox = document.getElementById("dupTarget");
  const wrap = document.getElementById("dupTableWrap");
  if (dupMode === "all") {
    targetBox.style.display = "none";
    renderDupAll(wrap);
    return;
  }
  targetBox.style.display = "";
  const ti = DATA[dupTargetIndex];
  targetBox.innerHTML =
    `当前查看期 <b>${ti.issue}</b>（${ti.date}）前区： ` +
    ti.front.map(x => `<span class="db">${pad2(x)}</span>`).join(" ");
  // 匹配表
  const matches = dupMatches(dupTargetIndex);
  let html = `<table class="tt dup"><thead><tr>
    <th>重复期号</th><th>重复期号码</th><th>重复号码</th><th>重复数</th></tr></thead><tbody>`;
  if (matches.length === 0) {
    html += `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--sub)">无重复 ≥${dupMin} 个的期次</td></tr>`;
  } else {
    matches.forEach(m => {
      const sj = DATA[m.j];
      const ballsJ = sj.front.map(x =>
        `<span class="db ${m.inter.includes(x) ? "hl" : ""}">${pad2(x)}</span>`).join("");
      const inter = m.inter.map(x => `<span class="db hl">${pad2(x)}</span>`).join(" ");
      html += `<tr><td>${sj.issue}<br><span class="d">${sj.date}</span></td>
        <td>${ballsJ}</td><td>${inter}</td><td><b>${m.count}</b></td></tr>`;
    });
  }
  html += "</tbody></table>";
  wrap.innerHTML = html;
}
function setDupMin(n) {
  dupMin = n;
  document.querySelectorAll('[data-dmin]').forEach(b =>
    b.classList.toggle("active", Number(b.dataset.dmin) === n));
  renderDup();
}
function setDupMode(m) {
  dupMode = m;
  document.querySelectorAll('[data-dmode]').forEach(b =>
    b.classList.toggle("active", b.dataset.dmode === m));
  renderDup();
}
function onDupIssueChange(sel) {
  dupTargetIndex = Number(sel.value);
  dupMode = "single";
  document.querySelectorAll('[data-dmode]').forEach(b =>
    b.classList.toggle("active", b.dataset.dmode === "single"));
  renderDup();
}

// ---------- 奖金 / 销量 ----------
function renderPrize() {
  const chart = getChart("prizeChart");
  chart.setOption({
    tooltip: { trigger: "axis" },
    legend: { data: ["奖池滚存(元)", "销售额(元)"], top: 10 },
    grid: { left: 70, right: 70, top: 40, bottom: 50 },
    xAxis: { type: "category", data: DATA.map(d => d.issue),
      axisLabel: { interval: Math.floor(DATA.length / 12) } },
    yAxis: [
      { type: "value", name: "奖池", axisLabel: { formatter: v => (v / 1e8).toFixed(1) + "亿" } },
      { type: "value", name: "销售额", axisLabel: { formatter: v => (v / 1e8).toFixed(1) + "亿" } },
    ],
    series: [
      { name: "奖池滚存(元)", type: "line", showSymbol: false, data: DATA.map(d => d.pool),
        itemStyle: { color: "#e63946" }, connectNulls: false },
      { name: "销售额(元)", type: "line", yAxisIndex: 1, showSymbol: false,
        data: DATA.map(d => d.sale), itemStyle: { color: "#457b9d" }, connectNulls: false },
    ],
  }, true);
}

// ---------- 初始化 ----------
buildTabs();
showSection("overview");
window.addEventListener("resize", () => {
  Object.values(charts).forEach(c => c.resize());
});

// 打开网页时：若由本地后端(serve.py)托管，则自动拉取一次最新数据；
// 仅当确有新期(changes)才刷新页面，避免无限刷新；双击 file:// 打开会安全忽略。
(function autoUpdate() {
  fetch("/api/update").then(r => (r.ok ? r.json() : null)).then(j => {
    if (j && j.ok && j.changed) location.reload();
  }).catch(() => {});
})();
