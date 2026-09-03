import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../sim/world.js';
import { serialize } from '../sim/serialize.js';
import { foundingEvidence, evaluateFoundingPetitions, quoteFoundingSites } from '../sim/founding.js';
import { deserialize, hashWorld } from '../sim/serialize.js';
import { tick } from '../sim/tick.js';
import { migrateWorld } from '../sim/migrate.js';
import { emptyState } from '../sim/simfactory.js';
import { TILE } from '../sim/map.js';
import { SCHEMA_VERSION } from '../sim/constants.js';
import { DEFAULT_LOGIC } from '../sim/logic.js';

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
  migrateWorld(w);assert.equal(w.schemaVersion,SCHEMA_VERSION);assert.equal(w.logic.logicSchemaVersion,DEFAULT_LOGIC.logicSchemaVersion);
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

test('#32 migration from the released immunity schema preserves existing immunity and adds only new founding state',()=>{
  const w=createWorld(32);w.schemaVersion=67;w.logic.logicSchemaVersion=63;
  delete w.founding;delete w.logic.founding;
  w.sims[0].immuneUntil=12345;
  const rng=serialize(w.rngSim),immunity=w.sims.map(s=>s.immuneUntil);
  migrateWorld(w);
  assert.equal(w.schemaVersion,68);assert.equal(w.logic.logicSchemaVersion,64);
  assert.deepEqual(w.sims.map(s=>s.immuneUntil),immunity);
  assert.equal(serialize(w.rngSim),rng);assert.equal(w.founding.lastDay,-1);
  const saved=serialize(w);migrateWorld(w);assert.equal(serialize(w),saved);
});

function approvalWorld(){
  const w=constrainedWorld();for(const t of [0,1440,2880])evaluateFoundingPetitions(w,t,()=>{});
  // Controlled topology isolates quote validation from generated terrain.
  w.map.tiles.fill(TILE.GRASS);w.map.reachVersion++;w.treasury=100000;
  w.villages[0].center={x:20,y:20};
  w.plots=[{plotId:1,x:400,y:400,used:false},{plotId:2,x:410,y:400,used:false}];
  return w;
}

test('#32 approval quotes are pure, provide actual beds, and exclude all student labor',()=>{
  const w=approvalWorld(),p=w.founding.petitions[0];
  w.sims[0].traits.occupation='student';
  w.sims[1].education.course='doctorate';w.sims[1].education.completed=false;
  w.sims[2].traits.age=18;
  const before=serialize(w),q=quoteFoundingSites(w,p.id,[1]);
  assert.equal(q.ok,true);assert.equal(q.cost,w.logic.zone.costs.house);
  assert.deepEqual(q.homePlotIds,[1]);assert.equal(q.settlerIds.length,2);
  assert.ok(q.settlerIds.every(id=>!w.sims.slice(0,3).some(s=>s.id===id)));
  assert.equal(serialize(w),before,'no cost, reservation, resident, RNG or approval mutation');
  w.logic.founding.minSettlers=3;
  assert.equal(quoteFoundingSites(w,p.id,[1]).reason,'invalid_sites','three residents need more than two beds');
  assert.deepEqual(quoteFoundingSites(w,p.id,[2,1]).homePlotIds,[1,2],'stable plot order');
});

test('#32 approval rejects invalid, overlapping, reserved, unaffordable and stale sites without mutation',()=>{
  const cases=[
    ['invalid_sites',w=>{},[1,1]],
    ['invalid_sites',w=>{},[1.5]],
    ['site_unavailable',w=>{w.plots[0].used=true;}],
    ['not_buildable',w=>{w.map.tiles[400*w.map.w+400]=TILE.ROAD;}],
    ['site_reserved',w=>{w.zoneOrders.push({plotId:1,type:'house',dir:0});}],
    ['site_reserved',w=>{w.plots[1].x=401;w.projects.push({plotId:2,type:'house',dir:0});}],
    ['sites_overlap',w=>{w.logic.founding.minSettlers=3;w.plots[1].x=401;},[1,2]],
    ['blocked_entrance',w=>{w.logic.founding.minSettlers=3;w.plots[1].x=400;w.plots[1].y=405;},[1,2]],
    ['invalid_distance',w=>{w.villages.push({id:'other',center:{x:400,y:400}});}],
    ['invalid_distance',w=>{w.logic.founding.minSettlers=3;w.plots[1].x=450;},[1,2]],
    ['treasury_short',w=>{w.treasury=0;}],
    ['conditions_changed',w=>{w.map.facilities.find(f=>f.type==='house').resources.push({id:'extra',kind:'bed'});}],
    ['no_settlers',w=>{for(const s of w.sims)s.traits.occupation='student';}],
    ['no_pending_petition',w=>{w.founding.petitions[0].status='withdrawn';}],
    ['unreachable',w=>{for(let y=0;y<w.map.h;y++)w.map.tiles[y*w.map.w+300]=TILE.WALL;w.map.reachVersion++;}],
  ];
  for(const [reason,setup,ids=[1]] of cases){
    const w=approvalWorld();setup(w);const before=serialize(w);
    assert.equal(quoteFoundingSites(w,0,ids).reason,reason);
    assert.equal(serialize(w),before,reason);
  }
});
