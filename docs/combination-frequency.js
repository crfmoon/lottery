(function(root) {
  function collect(data, size, target = null) {
    const groups = new Map();
    data.forEach((draw,index) => {
      const nums = [...draw.front].sort((a,b)=>a-b);
      function visit(start, picked) {
        if(picked.length===size) {
          if(target && !picked.every(n=>target.includes(n))) return;
          const key=picked.join(',');
          if(!groups.has(key)) groups.set(key,{numbers:[...picked],indices:[]});
          groups.get(key).indices.push(index); return;
        }
        for(let i=start;i<=nums.length-(size-picked.length);i++) visit(i+1,[...picked,nums[i]]);
      }
      visit(0,[]);
    });
    return [...groups.values()].filter(g=>g.indices.length>=3).sort((a,b)=>b.indices.length-a.indices.length || b.indices.at(-1)-a.indices.at(-1) || a.numbers.join(',').localeCompare(b.numbers.join(',')));
  }
  root.CombinationFrequency={collect};
  if(typeof module!=='undefined') module.exports={collect};
})(typeof window==='undefined'?globalThis:window);
