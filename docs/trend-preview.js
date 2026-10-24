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
  root.TrendPreview = { parse };
  if (typeof module !== 'undefined') module.exports = { parse };
})(typeof window === 'undefined' ? globalThis : window);
