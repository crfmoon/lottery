/* Pure selection functions are also exported for offline Node tests. */
(function (root) {
  const range = n => Array.from({ length: n }, (_, i) => i + 1);
  const full = { front: range(35), back: range(12) };
  const key = t => t.front.join(',') + '/' + t.back.join(',');
  function sample(pool, n, random) {
    const a = [...pool];
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(random() * (a.length - i));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n).sort((a, b) => a - b);
  }
  function accepts(t, c) {
    const a = t.front, sum = a.reduce((x, y) => x + y, 0);
    return (c.min == null || sum >= c.min) && (c.max == null || sum <= c.max) &&
      (c.odd == null || a.filter(n => n % 2).length === c.odd) &&
      (c.big == null || a.filter(n => n > 18).length === c.big) &&
      (c.span == null || a[4] - a[0] <= c.span) &&
      (c.pairs == null || a.slice(1).filter((n, i) => n === a[i] + 1).length <= c.pairs);
  }
  function generate(pools, count, conditions = {}, random = Math.random) {
    if (pools.front.length < 5 || pools.back.length < 2) throw Error('候选池至少需要 5 个前区和 2 个后区号码');
    const seen = new Set(), tickets = [], usage = {};
    // Bounded rejection sampling: do not relax user constraints silently.
    for (let i = 0; i < 5000 && tickets.length < count; i++) {
      const candidates = [];
      for (let j = 0; j < 6; j++) {
        const t = { front: sample(pools.front, 5, random), back: sample(pools.back, 2, random) };
        if (!seen.has(key(t)) && accepts(t, conditions)) candidates.push(t);
      }
      candidates.sort((a, b) => score(a) - score(b));
      if (candidates.length) {
        const t = candidates[0]; tickets.push(t); seen.add(key(t));
        ['front', 'back'].forEach(z => t[z].forEach(n => { usage[z + n] = (usage[z + n] || 0) + 1; }));
      }
    }
    function score(t) { return ['front', 'back'].reduce((s, z) => s + t[z].reduce((v, n) => v + (usage[z + n] || 0), 0), 0); }
    return tickets;
  }
  function hits(t, draw) {
    return [t.front.filter(n => draw.front.includes(n)).length, t.back.filter(n => draw.back.includes(n)).length];
  }
  function seeded(seed) {
    return () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
  }
  function hotPools(history, windowSize, frontCount = 15, backCount = 6) {
    const recent = history.slice(-windowSize);
    return Object.fromEntries(['front', 'back'].map(z => [z, [...full[z]].sort((a, b) =>
      recent.filter(d => d[z].includes(b)).length - recent.filter(d => d[z].includes(a)).length || a - b
    ).slice(0, z === 'front' ? frontCount : backCount)]));
  }
  function backtest(data, windowSize, periods, count, conditions) {
    const result = { tested: 0, skipped: 0, selected: [0, 0], random: [0, 0] };
    for (let i = Math.max(windowSize, data.length - periods); i < data.length; i++) {
      const tickets = generate(hotPools(data.slice(0, i), windowSize), count, conditions, seeded(i + 1));
      if (tickets.length !== count) { result.skipped++; continue; }
      const baseline = generate(full, count, {}, seeded(i + 100000));
      for (const [name, list] of [['selected', tickets], ['random', baseline]]) {
        list.forEach(t => hits(t, data[i]).forEach((n, z) => { result[name][z] += n; }));
      }
      result.tested++;
    }
    return result;
  }
  function omission(data, zone, numbers) {
    if (!full[zone] || !numbers.length || new Set(numbers).size !== numbers.length ||
        numbers.some(n => !full[zone].includes(n))) throw Error('请选择同一区内不同的有效号码');
    const indices = [];
    data.forEach((draw, i) => { if (numbers.every(n => draw[zone].includes(n))) indices.push(i); });
    // Only completed intervals between appearances count toward historical statistics.
    const gaps = indices.slice(1).map((index, i) => index - indices[i] - 1);
    const lastIndex = indices.length ? indices[indices.length - 1] : -1;
    return { current: lastIndex < 0 ? data.length : data.length - lastIndex - 1,
      count: indices.length, intervals: gaps.length,
      average: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
      maximum: gaps.length ? Math.max(...gaps) : null,
      last: lastIndex < 0 ? null : data[lastIndex], observed: data.length };
  }
  const api = { generate, accepts, hits, seeded, hotPools, backtest, omission };
  if (typeof module !== 'undefined') module.exports = api;
  if (!root.document) return;
  let initialized = false, draft = null;
  root.initSelection = function (data) {
    if (initialized) return;
    initialized = true;
    const host = document.getElementById('selectionApp');
    host.innerHTML = `<style>
      .pick-grid{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 18px}
      .pick-grid button{padding:5px;width:65px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer}
      .pick-grid button[aria-pressed=true]{background:#e8f2ff;border-color:#457b9d}
      .pick-grid small{display:block;font-size:10px;color:#555}
      #selectionApp input{width:75px;padding:6px;border:1px solid #ddd;border-radius:6px}
      #selectionApp h4{margin:16px 0 8px}.pick-ticket{padding:8px 0;border-bottom:1px solid #eee}
      .omission-number{font-size:24px;font-weight:700;color:#457b9d}
      .ticket-number{border:1px solid #ddd;border-radius:8px;background:white;padding:5px 8px;margin:3px;cursor:pointer}
      .ticket-number small{display:block;color:#666;font-size:11px}
    </style>
    <div class="toolbar" style="margin-top:14px">
      <label>统计范围 <select id="pickWindow"><option>30</option><option>50</option><option>100</option></select> 期</label>
      <button id="pickAll">全选号码</button><button id="pickHot">频次前 15 / 后 6</button>
    </div>
    <p class="hint">点击切换候选号码。小字为所选范围内的出现次数 / 截至最新一期的遗漏期数。</p>
    <h4>二码组合遗漏</h4>
    <div class="toolbar"><label>区域 <select id="pairZone"><option value="front">前区</option><option value="back">后区</option></select></label><span>点选两个号码：</span><strong id="pairSelected"></strong></div>
    <div id="pairNumbers" class="pick-grid"></div><div id="pairStats" aria-live="polite"></div>
    <p class="hint">同出指两个号码在同一期、同一区同时开出。最新一期同出时遗漏为 0；历史平均 / 最大遗漏只统计两次同出之间已结束的间隔，不含当前尚未结束的遗漏。所有遗漏使用完整历史，与上方近期频次范围无关。遗漏久不代表下期更容易开出。</p>
    <h4>前区候选池</h4><div id="pickFront" class="pick-grid"></div>
    <h4>后区候选池</h4><div id="pickBack" class="pick-grid"></div>
    <div class="toolbar">
      <label>注数 <input id="pickCount" type="number" min="1" max="20" value="5"></label>
      <label>前区和值 <input id="pickMin" type="number" placeholder="不限" min="15" max="165"> 至 <input id="pickMax" type="number" placeholder="不限" min="15" max="165"></label>
      <label>奇数个数 <input id="pickOdd" type="number" placeholder="不限" min="0" max="5"></label>
      <label>大号个数（19–35）<input id="pickBig" type="number" placeholder="不限" min="0" max="5"></label>
      <label>最大跨度 <input id="pickSpan" type="number" placeholder="不限" min="4" max="34"></label>
      <label>最多相邻连号对 <input id="pickPairs" type="number" placeholder="不限" min="0" max="4"></label>
    </div>
    <div class="toolbar"><button id="pickGenerate">按条件生成</button><button id="pickRandom">全号码随机对照</button><button id="pickSave">保存当前方案</button></div>
    <p id="pickMessage" role="status"></p><div id="pickOutput"></div>
    <h4>历史回测</h4><p class="hint">固定策略：每期仅用此前所选范围的历史，取频次前 15 个前区、6 个后区，再应用当前条件。自定义候选池不参与回测。与相同注数的全号码随机对照比较；结果不代表未来收益。</p>
    <div class="toolbar"><label>回测期数 <select id="pickPeriods"><option>30</option><option>50</option><option>100</option></select></label><button id="pickTest">运行回测</button></div><div id="pickTestOutput" role="status"></div>
    <h4>已保存方案与开奖复盘</h4><p class="hint">方案关联保存时最新一期之后的首期开奖，跨年无需手填期号。浏览器本地记录可修改，不作为开奖前公证。最多保留 100 份。</p><div id="pickSaved"></div>`;
    const el = id => document.getElementById(id);
    let pools = { front: [...full.front], back: [...full.back] };
    let pairZone = 'front', pairNumbers = [2, 5];
    function renderPair() {
      const box = el('pairNumbers'); box.replaceChildren();
      el('pairSelected').textContent = pairNumbers.map(n => String(n).padStart(2, '0')).join('、');
      full[pairZone].forEach(n => {
        const b = document.createElement('button'); b.textContent = String(n).padStart(2, '0');
        b.setAttribute('aria-pressed', pairNumbers.includes(n));
        b.onclick = () => {
          if (pairNumbers.includes(n)) pairNumbers = pairNumbers.filter(x => x !== n);
          else pairNumbers = [...pairNumbers.slice(-1), n];
          renderPair();
        };
        box.appendChild(b);
      });
      const stats = el('pairStats'); stats.replaceChildren();
      if (pairNumbers.length !== 2) { stats.textContent = '请再选一个号码，查看二码组合遗漏。'; return; }
      const s = omission(data, pairZone, pairNumbers);
      if (!s.count) { stats.textContent = `历史未同出，已观察 ${s.observed} 期；暂无历史平均 / 最大遗漏。`; return; }
      const cards = document.createElement('div'); cards.className = 'cards';
      for (const [label, value] of [['当前遗漏', `${s.current} 期`], ['历史平均遗漏', s.average == null ? '暂无完整间隔' : `${s.average.toFixed(1)} 期`],
        ['历史最大遗漏', s.maximum == null ? '暂无完整间隔' : `${s.maximum} 期`], ['历史同出次数', `${s.count} 次`]]) {
        const card = document.createElement('div'); card.className = 'card';
        const name = document.createElement('div'); name.className = 'k'; name.textContent = label;
        const v = document.createElement('div'); v.className = 'omission-number'; v.textContent = value;
        card.append(name, v); cards.appendChild(card);
      }
      const last = document.createElement('p'); last.className = 'hint';
      last.textContent = `最近同出：${s.last.issue} 期（${s.last.date}） · 已观察 ${s.observed} 期 · 完整间隔 ${s.intervals} 个`;
      stats.append(cards, last);
    }
    el('pairZone').onchange = () => { pairZone = el('pairZone').value; pairNumbers = [2, 5]; renderPair(); };
    const message = s => { el('pickMessage').textContent = s; };
    function windowSize() { return Number(el('pickWindow').value); }
    function renderPools() {
      for (const z of ['front', 'back']) {
        const box = el(z === 'front' ? 'pickFront' : 'pickBack'); box.replaceChildren();
        full[z].forEach(n => {
          const b = document.createElement('button');
          const freq = data.slice(-windowSize()).filter(d => d[z].includes(n)).length;
          let gap = 0; for (let i = data.length - 1; i >= 0 && !data[i][z].includes(n); i--) gap++;
          b.innerHTML = `${String(n).padStart(2, '0')}<small>${freq}次 / 遗漏${gap}期</small>`;
          b.setAttribute('aria-pressed', pools[z].includes(n));
          b.onclick = () => { pools[z] = pools[z].includes(n) ? pools[z].filter(x => x !== n) : [...pools[z], n]; renderPools(); };
          box.appendChild(b);
        });
      }
    }
    function config() {
      const count = Number(el('pickCount').value);
      if (!Number.isInteger(count) || count < 1 || count > 20) throw Error('注数必须为 1–20 的整数');
      const conditions = {};
      for (const [name, id, lo, hi] of [['min','Min',15,165],['max','Max',15,165],['odd','Odd',0,5],['big','Big',0,5],['span','Span',4,34],['pairs','Pairs',0,4]]) {
        const value = el('pick' + id).value;
        if (value !== '') {
          const n = Number(value);
          if (!Number.isInteger(n) || n < lo || n > hi) throw Error(`条件输入须为 ${lo}–${hi} 的整数`);
          conditions[name] = n;
        }
      }
      if (conditions.min != null && conditions.max != null && conditions.min > conditions.max) throw Error('和值下限不能大于上限');
      return { count, conditions };
    }
    function ticketText(t) { return t.front.map(n => String(n).padStart(2, '0')).join(' ') + ' + ' + t.back.map(n => String(n).padStart(2, '0')).join(' '); }
    function renderTicket(t) {
      const p = document.createElement('div'); p.className = 'pick-ticket';
      for (const z of ['front', 'back']) {
        const label = document.createElement('span'); label.textContent = z === 'front' ? '前区 ' : ' 后区 '; p.appendChild(label);
        t[z].forEach(n => {
          const b = document.createElement('button'); b.className = 'ticket-number';
          const s = omission(data, z, [n]);
          b.textContent = String(n).padStart(2, '0');
          const small = document.createElement('small'); small.textContent = s.count ? `遗漏 ${s.current} 期` : `未开出 · 已观察 ${s.observed} 期`;
          b.appendChild(small); b.title = '点击选入二码遗漏查询，再点同一区另一个号码';
          b.onclick = () => {
            if (pairZone !== z) pairNumbers = [];
            pairZone = z; el('pairZone').value = z;
            if (!pairNumbers.includes(n)) pairNumbers = [...pairNumbers.slice(-1), n];
            renderPair(); el('pairStats').scrollIntoView({ behavior: 'smooth', block: 'center' });
          };
          p.appendChild(b);
        });
      }
      return p;
    }
    function make(random) {
      try {
        const c = config(), tickets = generate(random ? full : pools, c.count, random ? {} : c.conditions);
        draft = { tickets, basedOn: data[data.length - 1].issue, createdAt: new Date().toISOString(),
          mode: random ? '全号码随机对照' : '条件选号', conditions: random ? {} : c.conditions,
          pools: JSON.parse(JSON.stringify(random ? full : pools)), window: windowSize() };
        el('pickOutput').replaceChildren();
        tickets.forEach(t => el('pickOutput').appendChild(renderTicket(t)));
        const front = new Set(tickets.flatMap(t => t.front)).size, back = new Set(tickets.flatMap(t => t.back)).size;
        message(`${draft.mode}：生成 ${tickets.length}/${c.count} 注，覆盖前区 ${front} 个、后区 ${back} 个号码。${tickets.length < c.count ? '条件过严或组合不足，可放宽条件后重试。' : ''}`);
      } catch (e) { draft = null; el('pickOutput').replaceChildren(); message(e.message); }
    }
    const storageKey = 'dlt-selection-plans-v1';
    function readSaved() {
      const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (!Array.isArray(value)) throw Error('保存记录格式无效');
      return value;
    }
    function renderSaved() {
      const box = el('pickSaved'); box.replaceChildren();
      try {
        const saved = readSaved();
        if (!saved.length) box.textContent = '暂无保存方案。';
        saved.forEach(plan => {
          const wrap = document.createElement('div'), title = document.createElement('p');
          const draw = data.find(d => d.issue > plan.basedOn);
          title.textContent = `${plan.mode} · 基于 ${plan.basedOn} 期 · ${new Date(plan.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间） · ${draw ? '复盘 ' + draw.issue + ' 期' : '等待下一期开奖'}`;
          wrap.appendChild(title);
          plan.tickets.forEach(t => { const p = document.createElement('p'); p.className = 'pick-ticket'; p.textContent = ticketText(t) + (draw ? ` → 命中前区 ${hits(t, draw)[0]} / 后区 ${hits(t, draw)[1]}` : ''); wrap.appendChild(p); });
          box.appendChild(wrap);
        });
      } catch (_) { box.textContent = '无法读取本地记录，请检查浏览器存储权限或记录格式。'; }
    }
    el('pickWindow').onchange = renderPools;
    el('pickAll').onclick = () => { pools = { front: [...full.front], back: [...full.back] }; renderPools(); };
    el('pickHot').onclick = () => { pools = hotPools(data, windowSize()); renderPools(); };
    el('pickGenerate').onclick = () => make(false);
    el('pickRandom').onclick = () => make(true);
    el('pickSave').onclick = () => {
      if (!draft || !draft.tickets.length) return message('请先生成有效方案');
      try {
        const saved = readSaved();
        if (saved.some(p => p.createdAt === draft.createdAt)) return message('该方案已保存');
        localStorage.setItem(storageKey, JSON.stringify([draft, ...saved].slice(0, 100)));
        message('方案已保存在当前浏览器'); renderSaved();
      } catch (_) { message('保存失败，请检查浏览器存储权限或容量'); }
    };
    el('pickTest').onclick = () => {
      try {
        const c = config(), size = windowSize(), periods = Number(el('pickPeriods').value);
        el('pickTest').disabled = true; el('pickTestOutput').textContent = '正在逐期回测…';
        setTimeout(() => {
          try {
            const r = backtest(data, size, periods, c.count, c.conditions), divisor = r.tested * c.count;
            el('pickTestOutput').textContent = `完成 ${r.tested} 期，组合不足跳过 ${r.skipped} 期（两组均不计入）。` + (divisor ?
              `每注平均命中：条件选号 前区 ${(r.selected[0]/divisor).toFixed(3)} / 后区 ${(r.selected[1]/divisor).toFixed(3)}；随机对照 前区 ${(r.random[0]/divisor).toFixed(3)} / 后区 ${(r.random[1]/divisor).toFixed(3)}。固定随机种子便于复查，单次比较不能证明优势。` : '没有可比较的期次，请放宽条件。');
          } catch (e) { el('pickTestOutput').textContent = e.message; }
          finally { el('pickTest').disabled = false; }
        }, 30);
      } catch (e) { el('pickTestOutput').textContent = e.message; }
    };
    renderPair(); renderPools(); renderSaved();
  };
})(typeof window === 'undefined' ? globalThis : window);
