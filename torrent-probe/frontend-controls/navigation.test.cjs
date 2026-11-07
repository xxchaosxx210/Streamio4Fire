const assert=require('node:assert/strict');
const {directionScore}=require('./vega-tv.js');
const r={x:100,y:100,width:50,height:40};
assert.equal(directionScore(r,{...r,x:20},'ArrowRight'),null);
assert.equal(directionScore(r,{...r,y:100},'ArrowUp'),null);
assert.ok(directionScore(r,{...r,x:170},'ArrowRight')<directionScore(r,{...r,x:170,y:200},'ArrowRight'));
assert.ok(directionScore(r,{...r,y:30},'ArrowUp')!==null);
assert.ok(directionScore(r,{...r,y:180},'ArrowDown')!==null);
console.log('Navigation geometry checks passed');
