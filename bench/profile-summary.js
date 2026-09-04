// Read-only summary of a Node --cpu-prof artifact. Includes setup and warmup;
// it is not the measured-only interval printed by bench/popscale.js.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
assert.ok(process.argv[2], 'usage: node bench/profile-summary.js /path/to/profile.cpuprofile');
const profile=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(profile.samples.length,profile.timeDeltas.length);
const nodes=new Map(profile.nodes.map(n=>[n.id,n]));
const rows=new Map();
let totalUs=0;
for(let i=0;i<profile.samples.length;i++){
  const frame=nodes.get(profile.samples[i]).callFrame;
  const key=JSON.stringify([frame.url,frame.functionName]);
  const row=rows.get(key)??{name:frame.functionName,file:frame.url,us:0};
  row.us+=profile.timeDeltas[i]; totalUs+=profile.timeDeltas[i]; rows.set(key,row);
}
console.log(JSON.stringify({scope:'whole-process sampled self time including setup/warmup',
  totalMs:totalUs/1000,top:[...rows.values()].sort((a,b)=>b.us-a.us).slice(0,20)
    .map(({us,...row})=>({...row,ms:us/1000,pct:totalUs?100*us/totalUs:0}))},null,2));
