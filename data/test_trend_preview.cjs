const assert = require('node:assert/strict');
const { parse } = require('../docs/trend-preview.js');
assert.deepEqual(parse('1. 34 03 10 14 25 + 09 01\n2. 06，11，19，26，33 ＋ 07、12'), [
  { front:[3,10,14,25,34], back:[1,9] }, { front:[6,11,19,26,33], back:[7,12] }
]);
assert.deepEqual(parse(' \n'), []);
for (const text of ['03 03 10 14 25 + 01 09', '03 10 14 25 36 + 01 09',
  '03 10 14 25 34 + 01 13', '03 10 14 25 34 + 01 01', '03 10 14 25 + 01 09',
  '<script> + 01 09', '03 10 14 25 34', '03 10 14 25 34 + 01 09 + 02']) assert.throws(() => parse(text));
assert.throws(() => parse(Array(21).fill('03 10 14 25 34 + 01 09').join('\n')));
console.log('Trend prediction input validation: OK');
