(function (root) {
  function parse(text) {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length > 20) throw Error('最多输入 20 组预测号码');
    return lines.map((line, i) => {
      const parts = line.replace(/^\d+[.、)）]\s*/, '').split(/[+＋]/);
      if (parts.length !== 2) throw Error(`第 ${i + 1} 行请使用“前区5个号码 + 后区2个号码”格式`);
      const ticket = {};
      ['front', 'back'].forEach((zone, j) => {
        const tokens = parts[j].trim().split(/[\s,，、]+/);
        const count = j === 0 ? 5 : 2, max = j === 0 ? 35 : 12;
        if (tokens.length !== count || tokens.some(t => !/^\d{1,2}$/.test(t))) throw Error(`第 ${i + 1} 行${j === 0 ? '前区需5个' : '后区需2个'}整数号码`);
        const nums = tokens.map(Number);
        if (new Set(nums).size !== count || nums.some(n => n < 1 || n > max)) throw Error(`第 ${i + 1} 行号码重复或超出范围（前区1–35，后区1–12）`);
        ticket[zone] = nums.sort((a, b) => a - b);
      });
      return ticket;
    });
  }
  function metrics(ticket) {
    const f = [...ticket.front].sort((a,b) => a-b), b = [...ticket.back].sort((a,b) => a-b);
    const odd = f.filter(n => n % 2).length;
    return [f.reduce((a,b)=>a+b,0), f.at(-1)-f[0], `${odd}:${5-odd}`,
      [f.filter(n=>n<=12).length,f.filter(n=>n>=13&&n<=24).length,f.filter(n=>n>=25).length].join(':'),
      b.reduce((a,b)=>a+b,0), b.at(-1)-b[0]];
  }
  function renderCombined(table, data, start, end, predictions, options) {
    table.classList.add('combined-trend');
    const pad = n => String(n).padStart(2,'0');
    let html = '<thead><tr><th rowspan="2">期号</th><th colspan="12" class="z1">前区一区 01–12</th><th colspan="12" class="z2">前区二区 13–24</th><th colspan="11" class="z3">前区三区 25–35</th>';
    ['前和值','前跨度','奇:偶','分区比'].forEach(s => { html += `<th rowspan="2" class="metric">${s}</th>`; });
    html += '<th colspan="12" class="back-cell">后区 01–12</th><th rowspan="2" class="metric">后和值</th><th rowspan="2" class="metric">后跨度</th></tr><tr>';
    for (let n=1;n<=35;n++) html += `<th>${pad(n)}</th>`;
    for (let n=1;n<=12;n++) html += `<th class="back-cell">${pad(n)}</th>`;
    html += '</tr></thead><tbody>';
    const seen = { front:Array(36).fill(-1), back:Array(13).fill(-1) };
    for (let i=0;i<start;i++) for (const z of ['front','back']) data[i][z].forEach(n=>{seen[z][n]=i;});
    function row(ticket, i, prediction, label) {
      let out = `<tr${prediction ? ' class="prediction-row"' : ''}><td class="issue">${label}</td>`;
      const stats = metrics(ticket);
      for (const z of ['front','back']) {
        const N = z === 'front' ? 35 : 12;
        for (let n=1;n<=N;n++) {
          const hit = ticket[z].includes(n), cls = z === 'back' ? ' back-cell' : '';
          const gap = seen[z][n] < 0 ? '-' : i-seen[z][n];
          out += hit ? `<td class="combined-hit${cls}" data-zone="${z}" data-number="${n}"><span class="ball-s ${prediction ? '' : z==='front'?'f':'b'}"${prediction?' style="background:#888"':''}>${pad(n)}</span></td>`
            : `<td class="miss${cls}">${gap}</td>`;
        }
        const values = z === 'front' ? stats.slice(0,4) : stats.slice(4);
        out += values.map(v=>`<td class="metric">${v}</td>`).join('');
      }
      return out+'</tr>';
    }
    for (let i=start;i<end;i++) {
      html += row(data[i],i,false,data[i].issue);
      for (const z of ['front','back']) data[i][z].forEach(n=>{seen[z][n]=i;});
    }
    if (end===data.length) predictions.forEach((p,i)=>{html+=row(p,end,true,`预测组${i+1}`);});
    table.innerHTML = html+'</tbody>';
    const wrapper = table.parentElement;
    wrapper.querySelectorAll('.nt-svg').forEach(s=>s.remove());
    const trs = [...table.querySelectorAll('tbody tr')];
    const actual = trs.filter(tr=>!tr.classList.contains('prediction-row'));
    const points = (tr,z) => [...tr.querySelectorAll(`[data-zone="${z}"]`)].map(td=>({n:Number(td.dataset.number),x:td.offsetLeft+td.offsetWidth/2,y:td.offsetTop+td.offsetHeight/2}));
    let svg = `<svg class="nt-svg" aria-hidden="true" width="${table.offsetWidth}" height="${table.offsetHeight}">`;
    function line(a,b,color,dashed=false,width=1.4) {
      svg += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${width}" opacity="0.55"${dashed?' stroke-dasharray="4 4"':''}/>`;
    }
    for (let i=1;i<actual.length;i++) {
      for (const z of ['front','back']) {
        const a=points(actual[i-1],z), b=points(actual[i],z), color=z==='front'?'#e63946':'#2487d8';
        if (z==='back' && options.showTrend) a.forEach((p,k)=>{if(b[k])line(p,b[k],color);});
        if(z==='front') a.forEach(p=>b.forEach(q=>{
          if(p.n===q.n && (options.showTrend||options.showPattern)) line(p,q,color,false,options.showPattern?2.4:1.4);
          else if(options.showPattern && Math.abs(p.n-q.n)===1) line(p,q,color);
        }));
      }
    }
    if(options.showTrend && actual.length) for(const tr of trs.filter(tr=>tr.classList.contains('prediction-row'))) {
      for(const z of ['front','back']) {
        const a=points(actual.at(-1),z), b=points(tr,z);
        a.forEach((p,i)=>{if(b[i])line(p,b[i],z==='front'?'#e63946':'#2487d8',true);});
      }
    }
    wrapper.insertAdjacentHTML('beforeend',svg+'</svg>');
  }
  root.TrendPreview = { parse, metrics, renderCombined };
  if (typeof module !== 'undefined') module.exports = { parse, metrics };
})(typeof window === 'undefined' ? globalThis : window);
