// Unmodified seeded worlds: durable work events, closed money, and save replay.
// node bench/employer-lifecycle.js [seed] [days] [--resume]
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWorld,tick,serialize,deserialize,hashWorld} from '../sim/index.js';
import {canWork} from '../sim/education.js';
import {publicBalance} from '../sim/government.js';
import {employerRoster} from '../sim/employer-roster.js';
import {EVENT_TYPES} from '../sim/constants.js';
import {Storage} from '../db/storage.js';

const seed=Number(process.argv[2]??32),days=Number(process.argv[3]??30),resume=process.argv.includes('--resume');
assert.ok(Number.isSafeInteger(seed));assert.ok(Number.isSafeInteger(days)&&days>=1&&days<=365);
let world=createWorld(seed);
const ledger=w=>publicBalance(w)+w.sims.reduce((n,s)=>n+s.money,0)
  +w.map.facilities.reduce((n,f)=>n+(f.revenue??0),0)+w.externalOutflow-w.externalInflow;
const initialMoney=ledger(world),employers=new Map(),digest=createHash('sha256');
const stats={assigned:0,ended:0,workStarts:0,workCompletions:0,positiveWages:0,
  wageShortfalls:0,maxPayloadBytes:0,peakPopulation:world.sims.length};
const storage=new Storage(':memory:');let pending=[];
try{
  storage.loadOrCreate({seed,nowUtcMs:1000});
  for(let n=0;n<days*1440;n++){
    if(resume&&n===Math.floor(days*1440/2))world=deserialize(serialize(world));
    const events=tick(world);digest.update(JSON.stringify(events));pending.push(...events);
    for(const e of events){
      assert.ok(EVENT_TYPES.includes(e.type),`unregistered ${e.type}`);
      const size=Buffer.byteLength(JSON.stringify(e.payload??{}),'utf8');
      stats.maxPayloadBytes=Math.max(stats.maxPayloadBytes,size);
      assert.ok(size<=1024,`${e.type} exceeds stored payload limit: ${size}`);
      if(e.type==='employment_started'){employers.set(e.simId,e.payload);stats.assigned++;}
      if(e.type==='employment_ended'){employers.delete(e.simId);stats.ended++;}
      if(['action_started','action_completed'].includes(e.type)&&e.payload.action==='work'){
        const job=employers.get(e.simId);
        assert.ok(job,`work without employer at ${e.tick}: ${e.simId}`);
        assert.ok(job.facilityId===e.payload.facilityId||job.occupation==='police'&&e.payload.facilityId==='patrol',
          `wrong employer at ${e.tick}: ${e.simId}`);
        if(e.type==='action_started')stats.workStarts++;else stats.workCompletions++;
      }
      if(e.type==='money_changed'&&e.payload.action==='work'&&e.payload.delta>0)stats.positiveWages++;
      if(e.type==='wage_shortfall')stats.wageShortfalls++;
    }
    for(const s of world.sims)if(s.employment){
      assert.ok(canWork(s)&&s.traits.occupation!=='retired');
      assert.equal(s.employment.occupation,s.traits.occupation);
    }
    assert.equal(ledger(world),initialMoney,`closed money at ${world.worldTick}`);
    stats.peakPopulation=Math.max(stats.peakPopulation,world.sims.length);
    if(world.worldTick%1440===0){
      storage.commitBatch({world,events:pending,appliedInputIds:[],epochUtcMs:1000});pending=[];
    }
  }
  assert.ok(stats.workCompletions>0&&stats.positiveWages>0,'observe real paid work');
  assert.equal(hashWorld(storage.loadOrCreate({seed,nowUtcMs:1000}).world),hashWorld(world));
  console.log(JSON.stringify({seed,days,stats,initialMoney,finalMoney:ledger(world),population:world.sims.length,
    storedEvents:storage.db.prepare('SELECT count(*) AS n FROM events').get().n,
    eventHash:digest.digest('hex'),worldHash:hashWorld(world),roster:employerRoster(world)},null,2));
}finally{storage.close();}
