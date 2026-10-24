const assert = require('node:assert/strict');
const { generate, accepts, hits, seeded, hotPools, backtest, omission } = require('../docs/selection.js');
const pools = { front: Array.from({length:35},(_,i)=>i+1), back: Array.from({length:12},(_,i)=>i+1) };
const conditions = { min:70, max:110, odd:3, big:2, span:28, pairs:1 };
const tickets = generate(pools, 20, conditions, seeded(123));
assert.equal(tickets.length, 20);
assert.equal(new Set(tickets.map(JSON.stringify)).size, 20);
for (const t of tickets) {
  assert(accepts(t, conditions));
  assert.equal(new Set(t.front).size, 5); assert.equal(new Set(t.back).size, 2);
}
assert.deepEqual(hits({front:[1,2,3,4,5],back:[1,2]}, {front:[1,2,6,7,8],back:[2,3]}), [2,1]);
assert.throws(()=>generate({front:[1],back:[1,2]}, 1));
assert.equal(generate({front:[1,2,3,4,5],back:[1,2]}, 2, {}, seeded(1)).length, 1);
assert.equal(generate(pools, 1, {min:166}, seeded(1)).length, 0);
const history = Array.from({length:50},(_,i)=>({issue:String(i), front:[1,2,3,4,5],back:[1,2]}));
assert.deepEqual(hotPools(history,30).front.slice(0,5),[1,2,3,4,5]);
const before = backtest(history,30,10,2,{});
const after = backtest([...history,{issue:'50',front:[31,32,33,34,35],back:[11,12]}],30,11,2,{});
// Appending a future draw must not alter earlier trials or their random stream.
const futureTickets = generate(hotPools(history,30),2,{},seeded(51));
const futureBaseline = generate(pools,2,{},seeded(100050));
for (const [name,list] of [['selected',futureTickets],['random',futureBaseline]]) {
  const extra = [0,0]; list.forEach(t=>hits(t,{front:[31,32,33,34,35],back:[11,12]}).forEach((n,z)=>extra[z]+=n));
  assert.deepEqual(after[name], before[name].map((n,z)=>n+extra[z]));
}
assert.equal(after.tested,before.tested+1);
console.log('Selection generation, constraints, review and chronological backtest: OK');
const draws = Array.from({length:9}, (_,i) => ({issue:String(i), date:`2026-01-${String(i+1).padStart(2,'0')}`,
  front: [0,3,7].includes(i) ? [2,5,10,11,12] : [1,3,10,11,12], back:[2,5]}));
const pair = omission(draws,'front',[2,5]);
assert.equal(pair.current,1);
assert.equal(pair.count,3);
assert.equal(pair.average,2.5);
assert.equal(pair.maximum,3);
assert.equal(pair.intervals,2);
assert.equal(pair.last.issue,'7');
assert.equal(omission(draws,'back',[2,5]).current,0);
assert.equal(omission(draws,'back',[2,5]).maximum,0);
assert.equal(omission(draws,'front',[2]).current,1);
const never = omission(draws,'front',[2,3]);
assert.equal(never.current,9); assert.equal(never.last,null); assert.equal(never.average,null);
assert.equal(never.maximum,null); assert.equal(never.count,0);
const once = omission(draws.slice(0,3),'front',[2,5]);
assert.equal(once.current,2); assert.equal(once.average,null); assert.equal(once.maximum,null);
assert.equal(omission([],'front',[2,5]).observed,0);
assert.throws(()=>omission(draws,'front',[2,2]));
assert.throws(()=>omission(draws,'back',[2,13]));
console.log('Single and pair omission, consecutive appearances, unseen and single-appearance cases: OK');
