// 大乐透历史数据分析 - 前端逻辑
const DATA = window.DLT_DATA || [];
const META = window.DLT_META || {};
const FRONT_N = 35, BACK_N = 12;

const SECTIONS = [
  { id: "overview", name: "总览" },
  { id: "selection", name: "下期选号参考" },
  { id: "trend", name: "号码走势" },
  { id: "metrics", name: "形态指标" },
  { id: "heat", name: "冷热·遗漏" },
  { id: "dup", name: "重复组合" },
  { id: "prize", name: "奖金·销量" },
];
const charts = {};
let curZone = "both";   // both / front / back
let curMetric = "sum";  // sum | span | odd | big | road | repeat | ac | zone3 | tail | back
let metricView = "num"; // num | dist
let metricPage = -1;
let dupMin = 3, dupTargetIndex = -1;
let dupMode = "single"; // single=当前期 / all=全部历史期对
let lawZone = "front";  // 冷热·遗漏：front / back

// ---------- 工具 ----------
const sumFront = d => d.front.filter(x => x != null).reduce((a, b) => a + b, 0);
const oddCount = d => d.front.filter(x => x != null && x % 2 === 1).length;
const bigCount = d => d.front.filter(x => x != null && x > 18).length;
const spanFront = d => {
  const a = d.front.filter(x => x != null);
  return a.length ? Math.max(...a) - Math.min(...a) : 0;
};
const roadCount = d => {
  const c = [0, 0, 0];
  d.front.forEach(x => { if (x != null) c[x % 3]++; });
  return c;
};
function acValue(nums) {
  const diffs = new Set();
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      diffs.add(Math.abs(nums[j] - nums[i]));
    }
  }
  return Math.max(0, diffs.size - (nums.length - 1));
}
function zone3Ratio(nums) {
  return [
    nums.filter(n => n <= 12).length,
    nums.filter(n => n >= 13 && n <= 24).length,
    nums.filter(n => n >= 25).length,
  ].join(":");
}
function getChart(id) {
  if (!charts[id]) charts[id] = echarts.init(document.getElementById(id));
  return charts[id];
}

// ---------- 分页 / 走势通用工具 ----------
const METRIC_GROUP = 30;
function pageBounds(page, groupSize = METRIC_GROUP) {
  if (!DATA.length) return [0, 0, 0];
  const t = Math.ceil(DATA.length / groupSize);
  if (page < 0 || page >= t) page = t - 1;
  return [page * groupSize, Math.min(page * groupSize + groupSize, DATA.length), page];
}
function setPageInfo(id, p, s, e, groupSize = METRIC_GROUP) {
  if (!DATA.length) { document.getElementById(id).textContent = "暂无数据"; return; }
  const t = Math.ceil(DATA.length / groupSize);
  document.getElementById(id).textContent =
    `第 ${p + 1}/${t} 页 · ${DATA[s].issue} – ${DATA[e - 1].issue}`;
}
function stepPage(cur, d, groupSize = METRIC_GROUP) {
  const t = Math.max(1, Math.ceil(DATA.length / groupSize));
  if (cur < 0 || cur >= t) cur = t - 1;
  return Math.min(Math.max(cur + d, 0), t - 1);
}
// 数字连线走势表：每期一行，值以圆点显示在对应列，同色系列相邻期用折线相连
function buildNumTrend(wrapId, cols, rows, colW) {
  const firstW = 74;
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
    const td = trs[ri].children[p.col + 1];
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
    overview: renderOverview,
    trend: renderTrend,
    metrics: renderMetrics,
    heat: renderHeat,
    selection: () => window.initSelection(DATA),
    dup: renderDup,
    prize: renderPrize,
  }[id];
  if (render) {
    render();
    setTimeout(() => Object.values(charts).forEach(c => c.resize()), 0);
  }
}

// ---------- 总览 ----------
function renderOverview() {
  if (!DATA.length) {
    document.getElementById("ovCards").innerHTML = '<div class="card"><div class="k">状态</div><div class="v">暂无历史开奖数据</div></div>';
    document.getElementById("ovLatest").innerHTML = "";
    return;
  }
  const last = DATA[DATA.length - 1];
  const maxSale = Math.max(...DATA.map(d => d.sale || 0));
  const maxPool = Math.max(...DATA.map(d => d.pool || 0));
  const cards = [
    { k: "总期数", v: META.count || DATA.length },
    { k: "起始期号", v: META.first || DATA[0].issue },
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

// ---------- 号码走势（支持 30/50/100 期、年份跳转、表底汇总） ----------
let trendGroupSize = 30;
let curPage = -1;
let showTrend = true;
let showPattern = false;
const missCache = { front: null, back: null };
const zoneSummaryCache = { front: null, back: null };
let trendPredictions = [];

function initTrendYears() {
  const sel = document.getElementById("trendYearSel");
  if (!sel || sel.dataset.filled) return;
  const years = [...new Set(DATA.map(d => d.date && d.date.slice(0, 4)).filter(Boolean))].reverse();
  years.forEach(y => {
    const o = document.createElement("option");
    o.value = y;
    o.textContent = y + " 年";
    sel.appendChild(o);
  });
  sel.dataset.filled = "1";
}
function setTrendGroup(val) {
  trendGroupSize = Number(val) || 30;
  curPage = -1;
  renderTrend();
}
function jumpTrendYear(year) {
  if (!year) return;
  const idx = DATA.findIndex(d => d.date && d.date.startsWith(year));
  if (idx >= 0) {
    curPage = Math.floor(idx / trendGroupSize);
    renderTrend();
  }
}

function applyTrendPredictions() {
  const status = document.getElementById('trendPredictionStatus');
  try {
    const parsed = TrendPreview.parse(document.getElementById('trendPredictionInput').value);
    trendPredictions = parsed;
    curPage = -1;
    renderTrend();
    status.textContent = parsed.length ? `已追加 ${parsed.length} 组预测。灰色球为预测号码，非开奖号码；切换前后区可查看对应预览。` : '已清除预测预览。';
  } catch (e) { status.textContent = e.message + '；保留此前预览。'; }
}
function clearTrendPredictions() {
  document.getElementById('trendPredictionInput').value = '';
  trendPredictions = [];
  document.getElementById('trendPredictionStatus').textContent = '已清除预测预览。';
  renderTrend();
}

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
function ensureZoneSummary(zone) {
  if (zoneSummaryCache[zone]) return zoneSummaryCache[zone];
  const N = zone === "front" ? FRONT_N : BACK_N;
  const total = new Array(N + 1).fill(0);
  const maxGap = new Array(N + 1).fill(0);
  const lastIdx = new Array(N + 1).fill(-1);
  DATA.forEach((d, i) => {
    (d[zone] || []).forEach(n => {
      total[n]++;
      if (lastIdx[n] >= 0) maxGap[n] = Math.max(maxGap[n], i - lastIdx[n] - 1);
      lastIdx[n] = i;
    });
  });
  const curGap = new Array(N + 1).fill(0);
  for (let n = 1; n <= N; n++) curGap[n] = lastIdx[n] >= 0 ? DATA.length - 1 - lastIdx[n] : DATA.length;
  zoneSummaryCache[zone] = { total, maxGap, curGap };
  return zoneSummaryCache[zone];
}
function appendTrendSummary(table, start, end, zoneMode) {
  if (!DATA.length) return;
  table.querySelectorAll("tfoot").forEach(el => el.remove());
  const zones = zoneMode === "both" ? ["front", "back"] : [zoneMode];
  const pageSlice = DATA.slice(start, end);
  const pageCount = { front: new Array(FRONT_N + 1).fill(0), back: new Array(BACK_N + 1).fill(0) };
  pageSlice.forEach(d => zones.forEach(z => (d[z] || []).forEach(n => { pageCount[z][n]++; })));

  const rowsMeta = [
    { label: "本页出次", get: (z, n) => pageCount[z][n] },
    { label: "历史总次", get: (z, n) => ensureZoneSummary(z).total[n] },
    { label: "当前遗漏", get: (z, n) => ensureZoneSummary(z).curGap[n] },
    { label: "最大遗漏", get: (z, n) => ensureZoneSummary(z).maxGap[n] },
  ];
  let html = "<tfoot>";
  rowsMeta.forEach(rm => {
    html += `<tr><td class="issue">${rm.label}</td>`;
    zones.forEach(z => {
      const N = z === "front" ? FRONT_N : BACK_N;
      const cls = z === "back" ? ' class="back-cell"' : "";
      for (let n = 1; n <= N; n++) {
        html += `<td${cls}>${rm.get(z, n)}</td>`;
      }
      if (zoneMode === "both") {
        const tail = z === "front" ? 4 : 2;
        for (let k = 0; k < tail; k++) html += '<td class="metric">-</td>';
      }
    });
    if (zoneMode !== "both") html += '<td class="sum">-</td><td class="sum">-</td><td class="sum">-</td>';
    html += "</tr>";
  });
  html += "</tfoot>";
  table.insertAdjacentHTML("beforeend", html);
}
function trendTotal() { return Math.max(1, Math.ceil(DATA.length / trendGroupSize)); }

function renderTrend() {
  initTrendYears();
  if (!DATA.length) return;
  const total = trendTotal();
  if (curPage < 0 || curPage >= total) curPage = total - 1;
  const table = document.getElementById('trendTable');
  table.classList.toggle('hide-miss', !document.getElementById('trendShowMiss').checked);
  const start = curPage * trendGroupSize, end = Math.min(start + trendGroupSize, DATA.length);
  if (curZone === 'both') {
    TrendPreview.renderCombined(table, DATA, start, end, trendPredictions, { showTrend, showPattern });
    appendTrendSummary(table, start, end, 'both');
    document.getElementById('trendPageInfo').textContent = `第 ${curPage + 1}/${total} 页 · ${DATA[start].issue} – ${DATA[end - 1].issue}`;
    return;
  }
  table.classList.remove('combined-trend');
  const zone = curZone;
  const N = zone === "front" ? FRONT_N : BACK_N;
  const miss = ensureMiss(zone);
  const ranges = zone === "front"
    ? [[1, 12], [13, 24], [25, 35]]
    : [[1, 4], [5, 8], [9, 12]];
  const pad = m => String(m).padStart(2, "0");

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

  for (let i = start; i < end; i++) {
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
  if (end === DATA.length) {
    const lastSeen = Array(N + 1).fill(-1);
    DATA.forEach((d, i) => d[zone].forEach(n => { lastSeen[n] = i; }));
    trendPredictions.forEach((ticket, index) => {
      const nums = ticket[zone], cnt = ranges.map(([lo, hi]) => nums.filter(n => n >= lo && n <= hi).length);
      html += `<tr class="prediction-row"><td class="issue">预测组${index + 1}</td>`;
      for (let m = 1; m <= N; m++) {
        html += nums.includes(m)
          ? `<td class="prediction-hit"><span class="ball-s" style="background:#5f6368">${pad(m)}</span></td>`
          : `<td class="miss">${lastSeen[m] < 0 ? '-' : DATA.length - lastSeen[m]}</td>`;
      }
      html += cnt.map(n => `<td class="sum">${n}</td>`).join('') + '</tr>';
    });
  }
  html += "</tbody>";
  table.innerHTML = html;
  drawTrendLines(table, N);
  appendTrendSummary(table, start, end, zone);
  document.getElementById("trendPageInfo").textContent =
    `第 ${curPage + 1}/${total} 页 · ${DATA[start].issue} – ${DATA[end - 1].issue}`;
}
function drawTrendLines(tbl, N) {
  const scroller = tbl.parentElement;
  scroller.style.position = "relative";
  scroller.querySelectorAll(".nt-svg").forEach(s => s.remove());
  if (!showTrend && !showPattern) return;
  const trs = Array.from(tbl.querySelectorAll("tbody tr:not(.prediction-row)"));
  const rows = trs.length;
  const colHits = {};
  const hitPos = [];
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
    hitPos.forEach(row => {
      for (let i = 0; i < row.length; i++) {
        for (let j = i + 1; j < row.length; j++) {
          if (row[j].m - row[i].m === 1) {
            svg += `<line x1="${row[i].x.toFixed(1)}" y1="${row[i].y.toFixed(1)}" x2="${row[j].x.toFixed(1)}" y2="${row[j].y.toFixed(1)}" stroke="#1e8e3e" stroke-width="2.4" opacity="0.85"/>`;
          }
        }
      }
    });
    for (let r = 0; r < rows - 1; r++) {
      const setB = new Set(hitPos[r + 1].map(p => p.m));
      hitPos[r].forEach(p => {
        if (setB.has(p.m)) {
          const q = hitPos[r + 1].find(z => z.m === p.m);
          svg += `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}" stroke="#f9ab00" stroke-width="3" opacity="0.92"/>`;
        }
      });
    }
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
  if (showTrend && trs.length) {
    const lastHits = hitPos[hitPos.length - 1];
    tbl.querySelectorAll('.prediction-row').forEach(tr => {
      const targets = Array.from(tr.querySelectorAll('.prediction-hit'));
      targets.forEach((td, i) => {
        const source = lastHits[i];
        if (source) svg += `<line x1="${source.x}" y1="${source.y}" x2="${td.offsetLeft + td.offsetWidth / 2}" y2="${td.offsetTop + td.offsetHeight / 2}" stroke="#5f6368" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.65"/>`;
      });
    });
  }
  svg += "</svg>";
  scroller.insertAdjacentHTML("beforeend", svg);
}
function polyFrom(seg) {
  return `<polyline points="${seg.map(p => p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ")}" fill="none" stroke="#9334e6" stroke-width="2" opacity="0.75"/>`;
}
function pageMove(d) {
  curPage = stepPage(curPage, d, trendGroupSize);
  renderTrend();
}
function setZone(z) {
  curZone = z;
  curPage = -1;
  document.querySelectorAll('[data-zone]').forEach(b =>
    b.classList.toggle("active", b.dataset.zone === z));
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

// ---------- 形态指标（统一标签页：和值/跨度/奇偶/大小/012路/重号/AC值/三区比/尾数/后区形态） ----------
const DIST_ONLY_METRICS = new Set(["zone3", "tail", "back"]);
const METRIC_HINTS = {
  sum: "前区和值（5码之和）：数字连线按30期一组，历史分布展示全部期次和值频数及均值线。",
  span: "前区跨度 = 最大值 − 最小值（范围 4–34）：数字连线按30期一组，历史分布含均值线。",
  odd: "前区奇偶比：每期前区5码中奇数个数（0–5）。",
  big: "前区大小比：前区以 18 为界（>18 为大），统计大号个数（0–5）。",
  road: "012路 = 号码除以 3 的余数；数字连线分 0/1/2 路三组，总体占比为全历史比例。",
  repeat: "重号 = 本期前区与上期前区重复的号码个数（0–5）。",
  ac: "AC值（数字复杂度）= 前区5码两两差值绝对值的去重个数 − 4（范围 0–6）。值越大表示号码越分散、等差结构越少；柱状图同时对比全历史与近100期占比。",
  zone3: "前区三区比（一区 01–12 / 二区 13–24 / 三区 25–35）：统计历史最常见分区比例 Top 15，并对比近100期占比。",
  tail: "同尾·尾数分析：左图对比 0–9 尾数在全历史与近100期的出现频率；右图统计每期前区5码包含的不同尾数个数（5个表示无同尾，≤4表示存在同尾号）。",
  back: "后区形态（01–12）：左为后区两码和值（3–23）分布，右为后区跨度（1–11）分布，补齐后区统计维度。",
};
function setMetric(m) {
  curMetric = m;
  metricPage = -1;
  document.querySelectorAll("#metricTabs button").forEach(b =>
    b.classList.toggle("active", b.dataset.metric === m));
  if (DIST_ONLY_METRICS.has(m)) metricView = "dist";
  renderMetrics();
}
function setMetricView(v) {
  metricView = v;
  document.querySelectorAll('[data-mv]').forEach(b =>
    b.classList.toggle("active", b.dataset.mv === v));
  renderMetrics();
}
function metricPageMove(d) {
  metricPage = stepPage(metricPage, d);
  renderMetrics();
}
function repCount(i) {
  const a = new Set(DATA[i - 1].front.filter(x => x != null));
  let n = 0;
  DATA[i].front.forEach(x => { if (x != null && a.has(x)) n++; });
  return n;
}
function renderMetrics() {
  if (!DATA.length) return;
  const distOnly = DIST_ONLY_METRICS.has(curMetric);
  const showNum = !distOnly && metricView === "num";
  document.getElementById("metricViewBtns").style.display = distOnly ? "none" : "";
  document.getElementById("metricPager").style.display = showNum ? "" : "none";
  document.getElementById("metricTrendWrap").style.display = showNum ? "block" : "none";
  document.getElementById("metricChart").style.display = showNum ? "none" : "block";
  document.querySelectorAll('[data-mv]').forEach(b =>
    b.classList.toggle("active", b.dataset.mv === (showNum ? "num" : "dist")));
  document.getElementById("metricHint").textContent = METRIC_HINTS[curMetric] || "";

  if (showNum) {
    const [s, e, p] = pageBounds(metricPage);
    if (curMetric === "sum") {
      const cols = [];
      for (let a = 15; a <= 145; a += 10) cols.push({ label: `${a}-${a + 9}`, w: 46 });
      cols.push({ label: "155", w: 46 });
      const rows = DATA.slice(s, e).map(d => {
        const v = sumFront(d);
        return { issue: d.issue, pts: [{ col: v >= 155 ? 14 : Math.floor((v - 15) / 10), text: String(v), color: "#d93025" }] };
      });
      buildNumTrend("metricTrendWrap", cols, rows, 46);
    } else if (curMetric === "span") {
      const cols = [];
      for (let v = 4; v <= 34; v++) cols.push({ label: String(v), w: 28 });
      const rows = DATA.slice(s, e).map(d => {
        const v = spanFront(d);
        return { issue: d.issue, pts: [{ col: v - 4, text: String(v), color: "#9334e6" }] };
      });
      buildNumTrend("metricTrendWrap", cols, rows, 28);
    } else if (curMetric === "odd" || curMetric === "big") {
      const fn = curMetric === "odd" ? oddCount : bigCount;
      const color = curMetric === "odd" ? "#ea4335" : "#1a73e8";
      const cols = [0, 1, 2, 3, 4, 5].map(k => ({ label: String(k), w: 44 }));
      const rows = DATA.slice(s, e).map(d => {
        const v = fn(d);
        return { issue: d.issue, pts: [{ col: v, text: String(v), color }] };
      });
      buildNumTrend("metricTrendWrap", cols, rows, 44);
    } else if (curMetric === "road") {
      const colors = ["#1a73e8", "#1e8e3e", "#f9ab00"];
      const cols = [];
      ["0路", "1路", "2路"].forEach(n => {
        for (let k = 0; k <= 5; k++) cols.push({ label: k === 0 ? n : String(k), w: 30 });
      });
      const rows = DATA.slice(s, e).map(d => ({
        issue: d.issue,
        pts: roadCount(d).map((v, g) => ({ col: g * 6 + v, text: String(v), color: colors[g] })),
      }));
      buildNumTrend("metricTrendWrap", cols, rows, 30);
    } else if (curMetric === "repeat") {
      const cols = [0, 1, 2, 3, 4, 5].map(k => ({ label: String(k), w: 44 }));
      const rows = [];
      for (let i = s; i < e; i++) {
        const v = i === 0 ? null : repCount(i);
        rows.push({ issue: DATA[i].issue, pts: v == null ? [] : [{ col: v, text: String(v), color: "#1e8e3e" }] });
      }
      buildNumTrend("metricTrendWrap", cols, rows, 44);
    } else if (curMetric === "ac") {
      const cols = [0, 1, 2, 3, 4, 5, 6].map(k => ({ label: "AC " + k, w: 46 }));
      const rows = DATA.slice(s, e).map(d => {
        const v = acValue(d.front);
        return { issue: d.issue, pts: [{ col: v, text: String(v), color: "#1a73e8" }] };
      });
      buildNumTrend("metricTrendWrap", cols, rows, 46);
    }
    setPageInfo("metricPageInfo", p, s, e);
    return;
  }

  const chart = getChart("metricChart");
  chart.resize();
  if (curMetric === "sum") {
    const counts = {};
    DATA.forEach(d => { const s = sumFront(d); counts[s] = (counts[s] || 0) + 1; });
    const keys = Object.keys(counts).map(Number).sort((a, b) => a - b);
    const avg = (keys.reduce((a, k) => a + k * counts[k], 0) / DATA.length).toFixed(1);
    chart.setOption({
      tooltip: { trigger: "axis" },
      grid: { left: 50, right: 30, top: 30, bottom: 50 },
      xAxis: { type: "category", data: keys, name: "和值" },
      yAxis: { type: "value", name: "出现期数" },
      series: [{ type: "bar", data: keys.map(k => counts[k]), itemStyle: { color: "#d93025" },
        markLine: { data: [{ xAxis: avg }], label: { formatter: "均值 " + avg } } }],
    }, true);
  } else if (curMetric === "span") {
    const counts = {};
    for (let v = 4; v <= 34; v++) counts[v] = 0;
    DATA.forEach(d => { const v = spanFront(d); if (counts[v] != null) counts[v]++; });
    const keys = Object.keys(counts).map(Number).sort((a, b) => a - b);
    const avg = (keys.reduce((a, k) => a + k * counts[k], 0) / DATA.length).toFixed(1);
    chart.setOption({
      tooltip: { trigger: "axis" },
      grid: { left: 50, right: 30, top: 30, bottom: 50 },
      xAxis: { type: "category", data: keys, name: "跨度" },
      yAxis: { type: "value", name: "出现期数" },
      series: [{ type: "bar", data: keys.map(k => counts[k]), itemStyle: { color: "#9334e6" },
        markLine: { data: [{ xAxis: avg }], label: { formatter: "均值 " + avg } } }],
    }, true);
  } else if (curMetric === "odd" || curMetric === "big") {
    const fn = curMetric === "odd" ? oddCount : bigCount;
    const dist = [0, 0, 0, 0, 0, 0];
    DATA.forEach(d => { const n = fn(d); if (n >= 0 && n <= 5) dist[n]++; });
    chart.setOption({
      title: { text: curMetric === "odd" ? "前区奇偶比（奇数个数）" : "前区大小比（大号>18个数）", left: "center", textStyle: { fontSize: 14 } },
      tooltip: { trigger: "axis" },
      grid: { left: 50, right: 30, top: 50, bottom: 40 },
      xAxis: { type: "category", data: ["0", "1", "2", "3", "4", "5"], name: "个数" },
      yAxis: { type: "value", name: "出现期数" },
      series: [{ type: "bar", data: dist, barWidth: "50%", itemStyle: { color: "#1a73e8" }, label: { show: true, position: "top" } }],
    }, true);
  } else if (curMetric === "road") {
    const tot = [0, 0, 0];
    DATA.forEach(d => roadCount(d).forEach((c, i) => tot[i] += c));
    chart.setOption({
      tooltip: { trigger: "item" },
      legend: { data: ["0路", "1路", "2路"], top: 10 },
      series: [{ type: "pie", radius: ["38%", "66%"], color: ["#1a73e8", "#1e8e3e", "#f9ab00"],
        data: [0, 1, 2].map(i => ({ name: i + "路", value: tot[i] })) }],
    }, true);
  } else if (curMetric === "repeat") {
    const freq = [0, 0, 0, 0, 0, 0];
    for (let i = 1; i < DATA.length; i++) freq[repCount(i)]++;
    const total = freq.reduce((a, b) => a + b, 0) || 1;
    const avg = (freq.reduce((a, c, i) => a + c * i, 0) / total).toFixed(2);
    chart.setOption({
      tooltip: { trigger: "axis" },
      grid: { left: 50, right: 30, top: 30, bottom: 40 },
      xAxis: { type: "category", data: ["0", "1", "2", "3", "4", "5"], name: "重号个数" },
      yAxis: { type: "value", name: "出现期数" },
      series: [{ type: "bar", data: freq, barWidth: "50%", itemStyle: { color: "#1e8e3e" },
        label: { show: true, position: "top" }, markLine: { data: [{ xAxis: avg }], label: { formatter: "均值 " + avg } } }],
    }, true);
  } else if (curMetric === "ac") {
    const all = [0, 0, 0, 0, 0, 0, 0], r100 = [0, 0, 0, 0, 0, 0, 0];
    const recent = DATA.slice(-100);
    DATA.forEach(d => { all[acValue(d.front)]++; });
    recent.forEach(d => { r100[acValue(d.front)]++; });
    chart.setOption({
      tooltip: { trigger: "axis", valueFormatter: v => v + "%" },
      legend: { data: ["全历史占比(%)", "近100期占比(%)"], top: 10 },
      grid: { left: 55, right: 30, top: 45, bottom: 40 },
      xAxis: { type: "category", data: ["AC 0", "AC 1", "AC 2", "AC 3", "AC 4", "AC 5", "AC 6"] },
      yAxis: { type: "value", name: "占比(%)" },
      series: [
        { name: "全历史占比(%)", type: "bar", data: all.map(c => Number((c * 100 / DATA.length).toFixed(1))), itemStyle: { color: "#1a73e8" } },
        { name: "近100期占比(%)", type: "bar", data: r100.map(c => Number((c * 100 / recent.length).toFixed(1))), itemStyle: { color: "#f9ab00" } },
      ],
    }, true);
  } else if (curMetric === "zone3") {
    const allMap = {}, r100Map = {}, recent = DATA.slice(-100);
    DATA.forEach(d => { const k = zone3Ratio(d.front); allMap[k] = (allMap[k] || 0) + 1; });
    recent.forEach(d => { const k = zone3Ratio(d.front); r100Map[k] = (r100Map[k] || 0) + 1; });
    const topKeys = Object.keys(allMap).sort((a, b) => allMap[b] - allMap[a]).slice(0, 15);
    chart.setOption({
      tooltip: { trigger: "axis", valueFormatter: v => v + "%" },
      legend: { data: ["全历史占比(%)", "近100期占比(%)"], top: 10 },
      grid: { left: 55, right: 25, top: 45, bottom: 45 },
      xAxis: { type: "category", data: topKeys, name: "三区比" },
      yAxis: { type: "value", name: "占比(%)" },
      series: [
        { name: "全历史占比(%)", type: "bar", data: topKeys.map(k => Number((allMap[k] * 100 / DATA.length).toFixed(1))), itemStyle: { color: "#1a73e8" } },
        { name: "近100期占比(%)", type: "bar", data: topKeys.map(k => Number(((r100Map[k] || 0) * 100 / recent.length).toFixed(1))), itemStyle: { color: "#ea4335" } },
      ],
    }, true);
  } else if (curMetric === "tail") {
    const tailAll = new Array(10).fill(0), tailR100 = new Array(10).fill(0);
    const uniqDist = [0, 0, 0, 0, 0, 0];
    const recent = DATA.slice(-100);
    DATA.forEach(d => {
      const s = new Set();
      d.front.forEach(n => { tailAll[n % 10]++; s.add(n % 10); });
      uniqDist[s.size]++;
    });
    recent.forEach(d => d.front.forEach(n => { tailR100[n % 10]++; }));
    chart.setOption({
      tooltip: { trigger: "axis" },
      legend: { data: ["全历史尾数占比(%)", "近100期尾数占比(%)", "不同尾数个数期数"], top: 10 },
      grid: [{ left: "6%", right: "52%", top: 55, bottom: 45 }, { left: "58%", right: "5%", top: 55, bottom: 45 }],
      xAxis: [
        { type: "category", gridIndex: 0, data: ["0尾","1尾","2尾","3尾","4尾","5尾","6尾","7尾","8尾","9尾"] },
        { type: "category", gridIndex: 1, data: ["2种尾","3种尾","4种尾(含同尾)","5种尾(无同尾)"] },
      ],
      yAxis: [
        { type: "value", gridIndex: 0, name: "占比(%)" },
        { type: "value", gridIndex: 1, name: "期数" },
      ],
      series: [
        { name: "全历史尾数占比(%)", type: "bar", xAxisIndex: 0, yAxisIndex: 0, data: tailAll.map(c => Number((c * 100 / (DATA.length * 5)).toFixed(1))), itemStyle: { color: "#1a73e8" } },
        { name: "近100期尾数占比(%)", type: "bar", xAxisIndex: 0, yAxisIndex: 0, data: tailR100.map(c => Number((c * 100 / (recent.length * 5)).toFixed(1))), itemStyle: { color: "#1e8e3e" } },
        { name: "不同尾数个数期数", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: [uniqDist[2], uniqDist[3], uniqDist[4], uniqDist[5]], itemStyle: { color: "#ea4335" }, label: { show: true, position: "top" } },
      ],
    }, true);
  } else if (curMetric === "back") {
    const sumMap = {}, spanMap = {};
    for (let s = 3; s <= 23; s++) sumMap[s] = 0;
    for (let p = 1; p <= 11; p++) spanMap[p] = 0;
    DATA.forEach(d => {
      const b = d.back.filter(x => x != null);
      if (b.length === 2) {
        sumMap[b[0] + b[1]] = (sumMap[b[0] + b[1]] || 0) + 1;
        spanMap[Math.abs(b[1] - b[0])] = (spanMap[Math.abs(b[1] - b[0])] || 0) + 1;
      }
    });
    const sumKeys = Object.keys(sumMap).map(Number).sort((a, b) => a - b);
    const spanKeys = Object.keys(spanMap).map(Number).sort((a, b) => a - b);
    chart.setOption({
      tooltip: { trigger: "axis" },
      legend: { data: ["后区和值期数", "后区跨度期数"], top: 10 },
      grid: [{ left: "6%", right: "52%", top: 55, bottom: 45 }, { left: "56%", right: "4%", top: 55, bottom: 45 }],
      xAxis: [
        { type: "category", gridIndex: 0, data: sumKeys, name: "后区和值" },
        { type: "category", gridIndex: 1, data: spanKeys, name: "后区跨度" },
      ],
      yAxis: [
        { type: "value", gridIndex: 0, name: "期数" },
        { type: "value", gridIndex: 1, name: "期数" },
      ],
      series: [
        { name: "后区和值期数", type: "bar", xAxisIndex: 0, yAxisIndex: 0, data: sumKeys.map(k => sumMap[k]), itemStyle: { color: "#1a73e8" } },
        { name: "后区跨度期数", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: spanKeys.map(k => spanMap[k]), itemStyle: { color: "#1e8e3e" }, label: { show: true, position: "top" } },
      ],
    }, true);
  }
}

// ---------- 冷热·遗漏（合并原 missing 与 law，同时支持前/后区） ----------
function omissionStat(m, zone) {
  let app = 0, maxOmit = 0, last = -1;
  for (let i = 0; i < DATA.length; i++) {
    if ((DATA[i][zone] || []).includes(m)) {
      if (last >= 0) maxOmit = Math.max(maxOmit, i - last - 1);
      last = i; app++;
    }
  }
  const cur = last >= 0 ? DATA.length - 1 - last : DATA.length;
  const avg = app > 0 ? (DATA.length - app) / app : DATA.length;
  return { cur, avg: Math.round(avg * 10) / 10, max: maxOmit, app };
}
function lawStats(zone) {
  const N = zone === "front" ? FRONT_N : BACK_N;
  const counts = new Array(N + 1).fill(0);
  const appear = Array.from({ length: N + 1 }, () => []);
  DATA.forEach((d, i) => {
    (d[zone] || []).forEach(x => { counts[x]++; appear[x].push(i); });
  });
  const gaps = [];
  for (let m = 1; m <= N; m++) {
    const ap = appear[m];
    for (let k = 0; k < ap.length - 1; k++) gaps.push(ap[k + 1] - ap[k] - 1);
  }
  const ranked = [];
  for (let m = 1; m <= N; m++) ranked.push({ m, c: counts[m] });
  ranked.sort((a, b) => b.c - a.c);
  const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const maxG = gaps.length ? Math.max(...gaps) : 0;
  const leAvg = gaps.length ? gaps.filter(g => g <= avg).length / gaps.length : 0;
  return { N, counts, ranked, avg, maxG, gaps, leAvg };
}
function renderHeat() {
  if (!DATA.length) return;
  const zone = lawZone;
  const s = lawStats(zone);
  const maxC = Math.max(...s.counts.slice(1));
  const minC = Math.min(...s.counts.slice(1));
  const heat = document.getElementById("lawHeat");
  heat.className = "law-grid" + (zone === "back" ? " back" : "");
  heat.innerHTML = s.counts.slice(1).map((c, i) => {
    const m = i + 1;
    const t = maxC === minC ? 0.5 : (c - minC) / (maxC - minC);
    const hue = 220 - 220 * t;
    const bg = `hsl(${hue},70%,${58 - t * 12}%)`;
    return `<div class="law-cell" style="background:${bg}">${m}<span>${c}</span></div>`;
  }).join("");
  const hot = s.ranked.slice(0, 5).map(r => `${r.m}(${r.c})`).join("、");
  const cold = s.ranked.slice(-5).reverse().map(r => `${r.m}(${r.c})`).join("、");
  document.getElementById("lawSummary").innerHTML =
    `${zone === "front" ? "前区 35" : "后区 12"}码出号密度：最热 <b>${hot}</b>；最冷 <b>${cold}</b>。` +
    `遗漏回补：平均遗漏 <b>${s.avg.toFixed(1)}</b> 期，最大 <b>${s.maxG}</b> 期；约 <b>${(s.leAvg * 100).toFixed(0)}%</b> 的回补发生在遗漏 ≤ 平均遗漏 时。`;

  const miss = [], avg = [], max = [], freq = [];
  for (let m = 1; m <= s.N; m++) {
    const st = omissionStat(m, zone);
    miss.push(st.cur); avg.push(st.avg); max.push(st.max); freq.push(st.app);
  }
  getChart("missChart").setOption({
    tooltip: { trigger: "axis" },
    legend: { data: ["当前遗漏", "平均遗漏", "最大遗漏", "历史总频次"], top: 8 },
    grid: { left: 50, right: 55, top: 45, bottom: 35 },
    xAxis: { type: "category", data: Array.from({ length: s.N }, (_, i) => String(i + 1).padStart(2, "0")) },
    yAxis: [
      { type: "value", name: "遗漏(期)", position: "left" },
      { type: "value", name: "频次", position: "right" },
    ],
    series: [
      { name: "当前遗漏", type: "bar", data: miss, itemStyle: { color: "#d93025" } },
      { name: "平均遗漏", type: "bar", data: avg, itemStyle: { color: "#f9ab00" } },
      { name: "最大遗漏", type: "bar", data: max, itemStyle: { color: "#9334e6" } },
      { name: "历史总频次", type: "line", yAxisIndex: 1, data: freq, itemStyle: { color: "#1a73e8" } },
    ],
  }, true);

  const binW = 5;
  const maxBin = Math.max(1, Math.floor(s.maxG / binW));
  const bins = new Array(maxBin + 1).fill(0);
  s.gaps.forEach(g => { bins[Math.min(Math.floor(g / binW), maxBin)]++; });
  const labels = [];
  for (let b = 0; b <= maxBin; b++) {
    const lo = b * binW, hi = lo + binW - 1;
    labels.push(b === maxBin ? `${lo}+` : `${lo}-${hi}`);
  }
  const avgBin = Math.min(Math.floor(s.avg / binW), maxBin);
  getChart("lawGapChart").setOption({
    tooltip: { trigger: "axis" },
    legend: { data: ["回补次数"], top: 8 },
    grid: { left: 55, right: 25, top: 40, bottom: 35 },
    xAxis: { type: "category", data: labels, name: "遗漏期数" },
    yAxis: { type: "value", name: "回补次数" },
    series: [{
      name: "回补次数", type: "bar", data: bins, itemStyle: { color: "#1a73e8" },
      markLine: { symbol: "none", data: [{ xAxis: labels[avgBin], label: { formatter: "均值 " + s.avg.toFixed(1) } }] },
    }],
  }, true);
}
function setLawZone(z) {
  lawZone = z;
  document.querySelectorAll('[data-lawzone]').forEach(b =>
    b.classList.toggle("active", b.dataset.lawzone === z));
  renderHeat();
}

// ---------- 重复组合（前区 5 码历史重复，带组合频次缓存） ----------
let _dupRevIndex = null;
let _dupDist = null;
const _comboCache = new Map();
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
  matches.sort((a, b) => Number(isCurrentDrawYear(DATA[b.j])) - Number(isCurrentDrawYear(DATA[a.j])) || b.j - a.j || b.count - a.count);
  return matches;
}
const pad2 = x => String(x).padStart(2, "0");

function dupAllPairs(min, cap) {
  const idx = dupRevIndex();
  const N = DATA.length;
  const out = [];
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => Number(isCurrentDrawYear(DATA[b])) - Number(isCurrentDrawYear(DATA[a])) || b - a);
  for (const j of order) {
    if (out.length >= cap) break;
    const cand = {};
    DATA[j].front.forEach(x => (idx[x] || []).forEach(i => {
      if (i < j) cand[i] = (cand[i] || 0) + 1;
    }));
    for (const i of Object.keys(cand).map(Number).sort((a, b) => Number(isCurrentDrawYear(DATA[b])) - Number(isCurrentDrawYear(DATA[a])) || b - a)) {
      const c = cand[i];
      if (c >= min) {
        const a = DATA[i].front, b = DATA[Number(j)].front;
        const inter = a.filter(n => b.includes(n)).sort((x, y) => x - y);
        out.push({ i, j, count: c, inter });
        if (out.length >= cap) break;
      }
    }
  }
  return out;
}

const dupCalendarYear = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date());
function isCurrentDrawYear(draw) {
  return Boolean(draw.date && draw.date.slice(0, 4) === dupCalendarYear);
}
function dupYearBadge(draw) {
  return isCurrentDrawYear(draw)
    ? `<span class="current-year-badge">${draw.date.slice(0, 4)}年 · 今年</span>` : '';
}
function dupIssueCell(draw) {
  const badge = dupYearBadge(draw);
  return `<td${badge ? ' class="current-year-cell"' : ''}>${draw.issue}${badge}<br><span class="d">${draw.date}</span></td>`;
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
      html += `<tr>${dupIssueCell(a)}<td>${ba}</td>
        ${dupIssueCell(b)}<td>${bb}</td>
        <td>${inter}</td><td><b>${p.count}</b></td></tr>`;
    });
  }
  html += "</tbody></table>";
  if (total > pairs.length) html += `<p class="hint">共 ${total} 对，仅显示前 ${pairs.length} 对。</p>`;
  wrap.innerHTML = html;
}

function renderComboFrequency() {
  if (!DATA.length) return;
  const size = Number(document.getElementById('comboSize').value);
  const scope = document.getElementById('comboScope').value;
  const target = scope === 'current' ? DATA[dupTargetIndex < 0 ? DATA.length - 1 : dupTargetIndex].front : null;
  const cacheKey = size + ':' + (target ? target.join(',') : 'all');
  let groups = _comboCache.get(cacheKey);
  if (!groups) {
    groups = CombinationFrequency.collect(DATA, size, target);
    groups.sort((a, b) => Number(b.indices.some(i => isCurrentDrawYear(DATA[i]))) - Number(a.indices.some(i => isCurrentDrawYear(DATA[i]))) || b.indices.at(-1) - a.indices.at(-1) || b.indices.length - a.indices.length);
    _comboCache.set(cacheKey, groups);
  }
  const host = document.getElementById('comboFrequency'); host.replaceChildren();
  for (const [label, filter] of [['出现3次', g => g.indices.length === 3], ['出现4次及以上', g => g.indices.length >= 4]]) {
    const list = groups.filter(filter), section = document.createElement('div'), title = document.createElement('h4');
    title.textContent = `${label}：${list.length} 组`; section.appendChild(title);
    const body = document.createElement('div'); section.appendChild(body);
    let shown = 0;
    const more = document.createElement('button'); more.className = 'pgbtn'; more.textContent = '再显示50组';
    function appendPage() {
      list.slice(shown, shown + 50).forEach(g => {
        const detail = document.createElement('details'); detail.style.margin = '8px 0';
        const summary = document.createElement('summary');
        summary.textContent = `${g.numbers.map(pad2).join(' ')} · 同出 ${g.indices.length} 次 · 最近 ${DATA[g.indices.at(-1)].issue} 期${g.indices.some(i => isCurrentDrawYear(DATA[i])) ? ' · 含今年开奖' : ''}`;
        detail.appendChild(summary);
        detail.addEventListener('toggle', () => {
          if (!detail.open || detail.dataset.filled) return;
          detail.dataset.filled = '1';
          const table = document.createElement('table'); table.className = 'tt dup';
          table.innerHTML = '<thead><tr><th>出现期号 / 日期</th><th>当期前区号码</th></tr></thead><tbody>' + [...g.indices].sort((a, b) => Number(isCurrentDrawYear(DATA[b])) - Number(isCurrentDrawYear(DATA[a])) || b - a).map(i => {
            const d = DATA[i];
            return `<tr>${dupIssueCell(d)}<td>${d.front.map(n => `<span class="db ${g.numbers.includes(n) ? 'hl' : ''}">${pad2(n)}</span>`).join('')}</td></tr>`;
          }).join('') + '</tbody>';
          detail.appendChild(table);
        });
        body.appendChild(detail);
      });
      shown = Math.min(shown + 50, list.length); more.hidden = shown >= list.length;
    }
    if (!list.length) body.textContent = '暂无符合条件的组合。';
    more.onclick = appendPage; section.appendChild(more); appendPage(); host.appendChild(section);
  }
}
function renderDup() {
  if (!DATA.length) return;
  if (dupTargetIndex < 0) dupTargetIndex = DATA.length - 1;
  renderComboFrequency();
  const dist = dupGlobalDist();
  const total = (dist[3] || 0) + (dist[4] || 0) + (dist[5] || 0);
  const sel = document.getElementById("dupIssueSel");
  if (!sel.dataset.filled) {
    for (let i = DATA.length - 1; i >= 0; i--) {
      const o = document.createElement("option");
      o.value = i; o.textContent = DATA[i].issue + " (" + DATA[i].date + ")" + (dupYearBadge(DATA[i]) ? ' · 今年' : '');
      sel.appendChild(o);
    }
    sel.dataset.filled = "1";
  }
  sel.value = dupTargetIndex;
  document.getElementById("dupSummary").innerHTML =
    `全量历史中，前区两期重复 <b>≥3</b> 个号码的组合共 <b>${total}</b> 对（重复3个 ${dist[3] || 0}、4个 ${dist[4] || 0}、5个 ${dist[5] || 0}）。点击柱状图可直接查看该重叠数的全部期对。`;
  const chart = getChart("dupChart");
  chart.off("click");
  chart.setOption({
    tooltip: { trigger: "axis" },
    grid: { left: 55, right: 20, top: 20, bottom: 30 },
    xAxis: { type: "category", data: ["重复3个", "重复4个", "重复5个"] },
    yAxis: { type: "value", name: "对数" },
    series: [{
      type: "bar", data: [dist[3] || 0, dist[4] || 0, dist[5] || 0],
      itemStyle: { color: "#d93025" }, label: { show: true, position: "top" },
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
    `当前查看期 <b>${ti.issue}</b>（${ti.date}）${dupYearBadge(ti)} 前区： ` +
    ti.front.map(x => `<span class="db">${pad2(x)}</span>`).join(" ");
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
      html += `<tr>${dupIssueCell(sj)}
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
  if (!DATA.length) return;
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
        itemStyle: { color: "#d93025" }, connectNulls: false },
      { name: "销售额(元)", type: "line", yAxisIndex: 1, showSymbol: false,
        data: DATA.map(d => d.sale), itemStyle: { color: "#1a73e8" }, connectNulls: false },
    ],
  }, true);
}

// ---------- 初始化 ----------
buildTabs();
showSection("overview");
let _resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    Object.values(charts).forEach(c => c.resize());
    if (document.getElementById('trend').classList.contains('active')) renderTrend();
  }, 180);
});

// 打开网页时：若由本地后端(serve.py)托管，则自动拉取一次最新数据；
// 仅当确有新期(changes)才刷新页面，避免无限刷新；双击 file:// 打开会安全忽略。
(async function autoUpdate() {
  const notice = document.createElement("div");
  notice.setAttribute("role", "status");
  notice.className = "status-banner";
  document.body.prepend(notice);
  const loaded = window.DLT_META || {};
  const current = `当前数据：${loaded.last || "未知"}期。`;
  if (location.protocol === "file:") {
    notice.textContent = current + "直接打开文件无法自动更新，请通过本地启动脚本打开网站。";
    return;
  }
  notice.textContent = current + "正在检查更新…";
  try {
    const response = await fetch("/api/update", { cache: "no-store" });
    let result;
    if ((response.headers.get("content-type") || "").includes("application/json")) {
      result = await response.json();
    }
    if (result && typeof result.ok === "boolean") {
      if (!result.ok) throw new Error(result.error?.message || "更新失败");
      // 不能仅依赖 changed：后端会缓存更新结果，刷新后仍可能返回 changed=true。
      const dataResponse = await fetch("data.js", { cache: "no-store" });
      if (!dataResponse.ok) throw new Error("读取更新后的数据失败");
      const source = await dataResponse.text();
      const match = source.match(/window\.DLT_META = (.*);/);
      if (!match) throw new Error("数据版本信息无效");
      const latest = JSON.parse(match[1]);
      if (latest.revision !== loaded.revision || latest.last !== loaded.last) {
        location.reload();
        return;
      }
      notice.textContent = current + "已完成官方数据同步检查。";
      return;
    }
    // 静态托管没有更新接口，显示定时任务状态，不静默忽略失败。
    const statusResponse = await fetch("update-status.json", { cache: "no-store" });
    if (!statusResponse.ok) throw new Error("无法读取定时更新状态");
    const status = await statusResponse.json();
    notice.textContent = current + (status.ok
      ? `最近同步：${status.checked_at}。静态站点由定时任务更新。`
      : `最近同步失败：${status.error?.message || "未知原因"}。检查时间：${status.checked_at}`);
  } catch (error) {
    notice.textContent = current + `自动更新失败：${error.message}。当前继续显示已有数据。`;
  }
})();
