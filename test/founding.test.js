import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../sim/world.js';
import { serialize } from '../sim/serialize.js';
import { foundingEvidence, evaluateFoundingPetitions } from '../sim/founding.js';
import { deserialize, hashWorld } from '../sim/serialize.js';
import { tick } from '../sim/tick.js';
import { migrateWorld } from '../sim/migrate.js';
import { emptyState } from '../sim/simfactory.js';

function constrainedWorld(){
  const w=createWorld(32);w.plots=[];w.projects=[];w.zoneOrders=[];
  for(const f of w.map.facilities)if(['house','apartment'].includes(f.type)){
    const n=w.sims.filter(s=>s.homeId===f.id).length;f.resources=f.resources.slice(0,n);
  }
  for(const s of w.sims){s.traits.age=25;s.traits.occupation='office_worker';s.education.course=null;}
  return w;
}

test('#32 founding evidence is read-only and excludes students and unfinished degrees from labor',()=>{
  const w=createWorld(32),v=w.villages[0],s=w.sims[0];
  s.traits.age=30;s.traits.occupation='student';
  const before=serialize(w),e=foundingEvidence(w,v.id);
  assert.equal(serialize(w),before);assert.equal(e.population,w.sims.length);
  assert.ok(!e.eligibleSettlerIds.includes(s.id));
  s.traits.occupation='office_worker';s.education.course='doctorate';s.education.completed=false;
  assert.ok(!foundingEvidence(w,v.id).eligibleSettlerIds.includes(s.id));
  s.education.completed=true;assert.ok(foundingEvidence(w,v.id).eligibleSettlerIds.includes(s.id));
  s.traits.age=18;assert.ok(!foundingEvidence(w,v.id).eligibleSettlerIds.includes(s.id));
  assert.equal(foundingEvidence(w,'missing'),null);
});

test('#32 ordered or active houses are pending capacity, not empty developable plots',()=>{
  const w=createWorld(32),v=w.villages[0];
  const p={plotId:9999,x:400,y:400,used:false,villageId:v.id};
  w.plots=[p];v.center={x:400,y:400};
  for(let y=400;y<405;y++)for(let x=400;x<407;x++)w.map.tiles[y*w.map.w+x]=0;
  assert.equal(foundingEvidence(w,v.id).localBuildablePlots,1);
  w.zoneOrders.push({plotId:p.plotId,type:'house'});
  let e=foundingEvidence(w,v.id);assert.equal(e.localBuildablePlots,0);assert.equal(e.pendingHomes,1);
  w.zoneOrders=[];w.projects.push({plotId:p.plotId,type:'house'});
  e=foundingEvidence(w,v.id);assert.equal(e.localBuildablePlots,0);assert.equal(e.pendingHomes,1);
  w.zoneOrders.push({plotId:p.plotId,type:'house'},{plotId:-1,type:'house'});
  assert.equal(foundingEvidence(w,v.id).pendingHomes,1,'duplicate or nonexistent sites cannot invent pending capacity');
});

test('#32 actual constrained days create one petition without funds/population/RNG changes',()=>{
  const w=constrainedWorld(),events=[],rng=serialize(w.rngSim),money=w.treasury,pop=w.sims.length;
  const emit=(...a)=>events.push(a);
  evaluateFoundingPetitions(w,0,emit);evaluateFoundingPetitions(w,1439,emit);
  evaluateFoundingPetitions(w,1440,emit);assert.equal(w.founding.petitions.length,0);
  evaluateFoundingPetitions(w,2880,emit);evaluateFoundingPetitions(w,4320,emit);
  assert.equal(w.founding.petitions.length,1);assert.equal(events.length,1);
  assert.equal(events[0][0],'founding_petition_created');
  assert.equal(w.treasury,money);assert.equal(w.sims.length,pop);assert.equal(serialize(w.rngSim),rng);
});

test('#32 spare beds prevent false petitions; relief withdraws pending petitions and missed days do not invent persistence',()=>{
  const w=constrainedWorld(),events=[],emit=(...a)=>events.push(a);
  evaluateFoundingPetitions(w,0,emit);evaluateFoundingPetitions(w,2880,emit);
  assert.equal(w.founding.pressure[w.villages[0].id].days,1);
  evaluateFoundingPetitions(w,4320,emit);evaluateFoundingPetitions(w,5760,emit);
  assert.equal(w.founding.petitions[0].status,'pending');
  const home=w.map.facilities.find(f=>f.type==='house');
  home.resources.push({...home.resources[0],id:'extra-fixture-bed'});
  evaluateFoundingPetitions(w,7200,emit);
  assert.equal(w.founding.petitions[0].status,'withdrawn');
  assert.equal(events.at(-1)[0],'founding_petition_withdrawn');
});

test('#32 petition persistence survives split execution without inventing past days on migration',()=>{
  const a=createWorld(32),b=deserialize(serialize(a));
  for(let i=0;i<1500;i++)assert.deepEqual(tick(a),tick(b));
  assert.equal(hashWorld(a),hashWorld(b));
  const w=createWorld(32);w.schemaVersion=66;w.logic.logicSchemaVersion=62;
  delete w.founding;delete w.logic.founding;const rng=serialize(w.rngSim);
  migrateWorld(w);assert.equal(w.schemaVersion,67);assert.equal(w.logic.logicSchemaVersion,63);
  assert.equal(w.founding.lastDay,-1);assert.deepEqual(w.founding.petitions,[]);
  assert.equal(serialize(w.rngSim),rng);
});

test('#32 the daily tick emits the petition and saving before the boundary replays identically',()=>{
  const a=constrainedWorld();
  for(const s of a.sims){s.state={...emptyState(),kind:'performing',action:'idle',ticksLeft:10000};
    s.needs={hunger:10000,energy:10000,social:10000,fun:10000};}
  for(let i=0;i<1441;i++)tick(a);
  const b=deserialize(serialize(a)),events=[];
  for(let i=0;i<1440;i++){const ea=tick(a),eb=tick(b);assert.deepEqual(ea,eb);events.push(...ea);}
  assert.ok(events.some(e=>e.type==='founding_petition_created'));
  assert.equal(hashWorld(a),hashWorld(b));
});
