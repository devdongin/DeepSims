// ABBA in fresh processes. Both checkouts must remain frozen for the run.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
if(process.argv[2]==='--worker'){
  const root=resolve(process.argv[3]);
  const {makeSynthWorld}=await import(pathToFileURL(`${root}/bench/synthpop.js`));
  const {advance,hashWorld,serialize}=await import(pathToFileURL(`${root}/sim/index.js`));
  const {pfStats}=await import(pathToFileURL(`${root}/sim/pathfind.js`));
  const world=makeSynthWorld(20260831,200);
  advance(world,{},1440);
  const before={...pfStats},start=performance.now();
  const events=advance(world,{},2880);
  const ms=performance.now()-start;
  console.log(JSON.stringify({ms,endPop:world.sims.length,world:hashWorld(world),
    events:createHash('sha256').update(serialize(events)).digest('hex'),
    bfsCalls:pfStats.calls-before.calls,bfsCells:pfStats.cells-before.cells}));
}else{
  assert.ok(process.argv[2],'usage: node bench/memory-overlap-cost.js /frozen/reference/checkout');
  const reference=resolve(process.argv[2]);
  const candidate=fileURLToPath(new URL('..',import.meta.url));
  const rows=[];
  for(const [variant,root] of [['base',reference],['candidate',candidate],['candidate',candidate],['base',reference]]){
    const run=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',root],{encoding:'utf8',maxBuffer:1024*1024});
    assert.equal(run.status,0,run.stderr);
    const row={variant,...JSON.parse(run.stdout)};rows.push(row);console.log(JSON.stringify(row));
  }
  const invariant=({ms,variant,...row})=>row;
  for(const row of rows)assert.deepEqual(invariant(row),invariant(rows[0]),'full world/events and BFS work must match');
  const mean=variant=>rows.filter(r=>r.variant===variant).reduce((sum,r)=>sum+r.ms,0)/2;
  console.log(JSON.stringify({equivalencePass:true,performanceClaim:'none; inspect ABBA timings, not a speedup gate',
    candidateToBaseMeanRatio:mean('candidate')/mean('base'),
    scope:'synthetic200; 1 warmup day + 2 measured days; no live save writes',rows}));
}
