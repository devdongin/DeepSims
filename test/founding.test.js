import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../sim/world.js';
import { serialize } from '../sim/serialize.js';
import { foundingEvidence, evaluateFoundingPetitions, quoteFoundingSites,
  validateFoundingDecision, applyFoundingDecision } from '../sim/founding.js';
import { fundFoundingPlans, foundingSiteReserved, foundingWorkerAllowed,
  cancelFoundingConstruction } from '../sim/founding.js';
import { deserialize, hashWorld, findNonFinite } from '../sim/serialize.js';
import { tick } from '../sim/tick.js';
import { migrateWorld } from '../sim/migrate.js';
import { emptyState } from '../sim/simfactory.js';
import { TILE, isAvailableResidence } from '../sim/map.js';
import { maybeImmigration } from '../sim/society.js';
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
  assert.equal(w.schemaVersion,SCHEMA_VERSION);assert.equal(w.logic.logicSchemaVersion,DEFAULT_LOGIC.logicSchemaVersion);
  assert.deepEqual(w.sims.map(s=>s.immuneUntil),immunity);
  assert.equal(serialize(w.rngSim),rng);assert.equal(w.founding.lastDay,-1);
  const saved=serialize(w);migrateWorld(w);assert.equal(serialize(w),saved);
});

function approvalWorld(){
  const w=constrainedWorld();for(const t of [0,1440,2880])evaluateFoundingPetitions(w,t,()=>{});
  // Controlled topology isolates quote validation from generated terrain.
  w.map.tiles.fill(TILE.GRASS);w.map.reachVersion=(w.map.reachVersion??0)+1;w.treasury=100000;
  w.villages[0].center={x:20,y:20};
  w.plots=[{plotId:1,x:400,y:400,used:false},{plotId:2,x:410,y:400,used:false}];
  return w;
}

test('#32 family-sized founding housing is actually quoted, paid and queued as an apartment',()=>{
  const w=approvalWorld(),[a,b,child]=w.sims;
  child.householdId=a.householdId;child.homeId=a.homeId;
  child.traits.age=12;child.traits.occupation='student';
  b.householdId=a.householdId;b.homeId=a.homeId;
  // Preserve the deliberately constrained fixture after changing household occupancy.
  for(const f of w.map.facilities)if(['house','apartment'].includes(f.type)){
    const count=w.sims.filter(s=>s.homeId===f.id).length;
    f.resources=Array.from({length:count},(_,i)=>({...f.resources[0],id:`fixture:${f.id}:${i}`}));
  }
  const q=quoteFoundingSites(w,0,[1]);
  assert.equal(q.ok,true);assert.equal(q.cost,w.logic.zone.costs.apartment);
  assert.deepEqual(q.homes,[{type:'apartment',residentIds:[a.id,b.id,child.id],plotId:1}]);
  assert.deepEqual(q.settlerIds,[a.id,b.id]);
  const money=w.treasury;
  applyFoundingDecision(w,{petitionId:0,decision:'approve',name:'가족마을',homePlotIds:[1]},3000,()=>{});
  fundFoundingPlans(w,3001,()=>{});
  assert.equal(w.founding.petitions[0].status,'building');
  assert.equal(w.treasury,money-w.logic.zone.costs.apartment);
  assert.equal(w.zoneOrders[0].type,'apartment');assert.equal(w.plots[0].foundingType,'apartment');
});

test('#32 approval quotes are pure, provide actual beds, and exclude all student labor',()=>{
  const w=approvalWorld(),p=w.founding.petitions[0];
  w.sims[0].traits.occupation='student';
  w.sims[1].education.course='doctorate';w.sims[1].education.completed=false;
  w.sims[2].traits.age=18;
  const before=serialize(w),q=quoteFoundingSites(w,p.id,[1,2]);
  assert.equal(q.ok,true);assert.equal(q.cost,2*w.logic.zone.costs.house);
  assert.deepEqual(q.homePlotIds,[1,2]);assert.equal(q.settlerIds.length,2);
  assert.ok(q.residents.some(r=>r.simId===w.sims[2].id),'the minor accompanies the household, not the labor force');
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

const approval=()=>({petitionId:0,decision:'approve',name:'새솔',homePlotIds:[1]});

test('#32 durable decision payload is a strict whitelist, including safe village names',()=>{
  assert.equal(validateFoundingDecision(approval()).ok,true);
  assert.equal(validateFoundingDecision({petitionId:0,decision:'reject'}).ok,true);
  for(const payload of [null,[],{}, {...approval(),petitionId:-1}, {...approval(),decision:'spawn'},
    {...approval(),money:100}, {...approval(),name:'<script>'}, {...approval(),name:' 새솔'},
    {...approval(),name:'x\n'}, {...approval(),name:'x'.repeat(41)}, {...approval(),homePlotIds:[]},
    {...approval(),homePlotIds:[1,1]}, {petitionId:0,decision:'reject',reason:'anything'}]){
    assert.equal(validateFoundingDecision(payload).ok,false,JSON.stringify(payload));
  }
});

test('#32 approval authorizes a saved plan without creating a village, spending, moving or granting population',()=>{
  const w=approvalWorld(),events=[],other=()=>serialize({...w,founding:null});
  const before=other();applyFoundingDecision(w,approval(),3000,(...e)=>events.push(e));
  const p=w.founding.petitions[0];
  assert.equal(p.status,'approved');assert.equal(p.approvedTick,3000);assert.equal(p.resolvedTick,null);
  assert.equal(p.plan.name,'새솔');assert.deepEqual(p.plan.homePlotIds,[1]);assert.equal(p.plan.settlerIds.length,2);
  assert.equal(p.plan.quotedCost,w.logic.zone.costs.house);assert.equal(other(),before);
  assert.equal(events[0][0],'founding_approved');
  const saved=serialize(w);applyFoundingDecision(w,approval(),3001,(...e)=>events.push(e));
  assert.equal(serialize(w),saved);assert.equal(events.at(-1)[2].reason,'no_pending_petition');
  for(let day=3;day<40;day++)evaluateFoundingPetitions(w,day*1440,()=>{});
  assert.equal(w.founding.petitions.length,1,'approved work cannot generate duplicate petitions or be pruned');
});

test('#32 rejection persists its reason and requires fresh shortage days; failed approvals have no effects',()=>{
  const w=approvalWorld(),events=[];
  applyFoundingDecision(w,{petitionId:0,decision:'reject',reason:'budget_priority'},3000,(...e)=>events.push(e));
  assert.equal(w.founding.petitions[0].status,'rejected');assert.equal(w.founding.petitions[0].resolvedTick,3000);
  assert.equal(events[0][0],'founding_rejected');
  evaluateFoundingPetitions(w,4320,()=>{});evaluateFoundingPetitions(w,5760,()=>{});
  assert.equal(w.founding.petitions.length,1);
  evaluateFoundingPetitions(w,7200,()=>{});assert.equal(w.founding.petitions.length,2);
  for(const [setup,reason] of [[w=>{w.treasury=0;},'treasury_short'],
    [w=>{w.villages[0].name='새솔';},'duplicate_name'],
    [w=>{for(const s of w.sims)s.traits.occupation='student';},'no_settlers']]){
    const bad=approvalWorld();setup(bad);const before=serialize(bad),ev=[];
    applyFoundingDecision(bad,approval(),3000,(...e)=>ev.push(e));
    assert.equal(serialize(bad),before);assert.equal(ev[0][0],'input_rejected');assert.equal(ev[0][2].reason,reason);
  }
});

test('#32 found_village is applied from the durable input queue and survives engine reconstruction exactly once',async()=>{
  const { Storage }=await import('../db/storage.js');
  const { Engine }=await import('../server/engine.js');
  const st=new Storage(':memory:');
  try{
    const e=new Engine(st,{seed:32,now:()=>1000});e.world=approvalWorld();
    e.world.worldTick=2880;e.world.lastDailyDay=2;e.world.lastPlanDay=2;
    st.commitBatch({world:e.world,events:[],appliedInputIds:[],epochUtcMs:e.epochUtcMs});
    const expected=deserialize(serialize(e.world));
    const input={clientInputId:'founding-approve-once',command:'found_village',payload:approval()};
    const accepted=await e.submitInput(input);
    assert.equal(accepted.duplicate,false);
    assert.deepEqual(await e.submitInput(input),{...accepted,duplicate:true});
    // Reconstruct before application: the input must come from committed SQLite.
    const resumed=new Engine(st,{seed:32,now:()=>1000});
    const actual=resumed.runLive(1).events;
    const wanted=tick(expected,[{sequence:0,command:input.command,payload:input.payload}]);
    assert.deepEqual(actual,wanted);assert.equal(hashWorld(resumed.world),hashWorld(expected));
    const after=new Engine(st,{seed:32,now:()=>1000});
    assert.equal(after.world.founding.petitions[0].status,'approved');
    assert.equal(hashWorld(after.world),hashWorld(expected));
    assert.ok(!after.runLive(1).events.some(e=>e.type==='founding_approved'));
  }finally{st.close();}
});

function fundedFixture(){
  const w=approvalWorld();w.worldTick=3000;w.lastDailyDay=2;w.lastPlanDay=2;w.mayorId=null;
  for(const s of w.sims){s.state={...emptyState(),kind:'performing',action:'idle',ticksLeft:100000};s.hasCar=false;}
  applyFoundingDecision(w,approval(),3000,()=>{});return w;
}

test('#32 funding waits until the next tick, pays once, and reserves sites without inventing houses or moving anyone',()=>{
  const w=fundedFixture(),before={money:w.treasury,out:w.externalOutflow,map:serialize(w.map),sims:serialize(w.sims),rng:serialize(w.rngSim)};
  fundFoundingPlans(w,3000,()=>{});assert.equal(w.zoneOrders.length,0);
  fundFoundingPlans(w,3001,()=>{});
  assert.equal(w.founding.petitions[0].status,'building');
  assert.equal(w.treasury+worldCost(w),before.money);assert.equal(w.externalOutflow-before.out,worldCost(w));
  assert.equal(w.zoneOrders.length,1);assert.equal(w.zoneOrders[0].foundingPetitionId,0);
  assert.equal(w.plots[0].foundingPetitionId,0);assert.equal(serialize(w.map),before.map);
  assert.equal(serialize(w.sims),before.sims);assert.equal(serialize(w.rngSim),before.rng);
  const saved=serialize(w);fundFoundingPlans(w,3002,()=>{});assert.equal(serialize(w),saved);
  assert.equal(serialize(deserialize(saved)),saved);
  assert.equal(foundingSiteReserved(w,{x:401,y:400},'office'),true);
  assert.equal(foundingSiteReserved(w,{x:400,y:405},'house'),true,'protect the outside door approach too');
  assert.equal(foundingSiteReserved(w,w.plots[0],'house',0,0),false);
});
const worldCost=w=>w.logic.zone.costs.house;

test('#32 changed approval conditions cancel before charging and never substitute another resident silently',()=>{
  for(const setup of [w=>{w.treasury=0;},w=>{w.logic.zone.costs.house++;},
    w=>{w.sims[0].education.course='masters';w.sims[0].education.completed=false;},
    w=>{w.plots[0].used=true;}]){
    const w=fundedFixture();setup(w);const other=serialize({...w,founding:null}),events=[];
    fundFoundingPlans(w,3001,(...e)=>events.push(e));
    assert.equal(w.founding.petitions[0].status,'cancelled');assert.equal(events[0][0],'founding_cancelled');
    assert.equal(serialize({...w,founding:null}),other);
  }
});

test('#32 a funded project advances only for selected adult workers physically at the site',()=>{
  const w=fundedFixture();tick(w);const project=w.projects.find(p=>p.foundingPetitionId===0);
  assert.ok(project);const plot=w.plots.find(p=>p.plotId===project.plotId),worker=w.sims[0],outsider=w.sims[2];
  assert.equal(foundingWorkerAllowed(w,outsider,project),false);
  for(const sim of [worker,outsider])sim.state={...emptyState(),kind:'performing',action:'construct',
    ticksLeft:100,facilityId:'site',resourceId:`p${plot.plotId}:spot0`};
  outsider.x=plot.x+1;outsider.y=plot.y+1;worker.x=plot.x-2;worker.y=plot.y;
  tick(w);assert.equal(project.progress,0,'neither outsiders on site nor remote selected workers provide labor');
  worker.x=plot.x+1;worker.y=plot.y+1;tick(w);assert.equal(project.progress,1);
  worker.education.course='doctorate';worker.education.completed=false;
  tick(w);assert.equal(project.progress,1,'entering an unfinished degree stops labor immediately');
  assert.equal(w.founding.petitions[0].status,'cancelled');
  assert.equal(w.projects.some(p=>p.foundingPetitionId===0),false);
});

test('#32 real walking and construction produce a reserved home, not a teleported settler or new population',()=>{
  const w=fundedFixture();w.logic.construct.requiredByType.house=3;
  const worker=w.sims[0];worker.x=397;worker.y=400;
  const homeIds=w.sims.map(s=>s.homeId),pop=w.sims.length,facCount=w.map.facilities.length;
  tick(w);assert.equal(w.map.facilities.length,facCount);
  const events=[],assignment={sequence:0,command:'assign',payload:{simId:worker.id,actionType:'construct'}};
  let previous={x:worker.x,y:worker.y},walked=0;
  for(let i=0;i<40&&w.founding.petitions[0].status!=='awaiting_settlement';i++){
    events.push(...tick(w,i===0?[assignment]:[]));
    const step=Math.abs(worker.x-previous.x)+Math.abs(worker.y-previous.y);
    assert.ok(step<=1,'ordinary one-tile movement, no teleport');walked+=step;previous={x:worker.x,y:worker.y};
  }
  assert.ok(walked>0);assert.equal(w.founding.petitions[0].status,'awaiting_settlement');
  assert.ok(events.some(e=>e.type==='founding_homes_built'));
  assert.equal(w.sims.length,pop);assert.deepEqual(w.sims.map(s=>s.homeId),homeIds);assert.equal(w.villages.length,1);
  const home=w.map.facilities.find(f=>f.foundingPetitionId===0);
  assert.equal(home.resources.length,2);assert.equal(isAvailableResidence(home),false);
  maybeImmigration(w,1440*w.logic.society.immigrationIntervalDays,w.logic.society.immigrationIntervalDays,()=>{});
  assert.equal(w.sims.length,pop,'reserved beds cannot draw immigrants');
});

test('#32 stale paid construction refunds only undelivered homes and releases reservations exactly once',()=>{
  const w=fundedFixture(),treasury=w.treasury,out=w.externalOutflow,inflow=w.externalInflow;
  fundFoundingPlans(w,3001,()=>{});w.map.tiles[400*w.map.w+400]=TILE.WALL;
  const events=tick(w);
  assert.equal(w.founding.petitions[0].status,'cancelled');assert.equal(w.treasury,treasury);
  assert.equal(w.externalOutflow-out,worldCost(w));assert.equal(w.externalInflow-inflow,worldCost(w));
  assert.equal(w.zoneOrders.length,0);assert.equal(w.projects.length,0);assert.equal(w.plots[0].foundingPetitionId,undefined);
  assert.ok(events.some(e=>e.type==='founding_cancelled'&&e.payload.refund===worldCost(w)));
  const before=serialize(w);cancelFoundingConstruction(w,0,'stale_order',3002,()=>{});assert.equal(serialize(w),before);
});

test('#32 other zone orders cannot steal an overlapping founding site',()=>{
  const w=fundedFixture();fundFoundingPlans(w,3001,()=>{});w.plots[1].x=401;
  const events=tick(w,[{sequence:0,command:'zone',payload:{plotId:2,type:'house',dir:0}}]);
  assert.ok(events.some(e=>e.type==='input_rejected'&&e.payload.reason==='site_reserved'));
  assert.ok(w.projects.some(p=>p.foundingPetitionId===0));
  assert.ok(!w.projects.some(p=>p.plotId===2));
});

test('#32 partial cancellation retains completed buildings and refunds only unfinished work',()=>{
  const w=approvalWorld();w.worldTick=3000;w.lastDailyDay=2;w.lastPlanDay=2;w.mayorId=null;
  for(const s of w.sims)s.state={...emptyState(),kind:'performing',action:'idle',ticksLeft:100000};
  w.logic.founding.minSettlers=3;
  applyFoundingDecision(w,{...approval(),homePlotIds:[1,2]},3000,()=>{});
  const treasury=w.treasury,pop=w.sims.length,homeIds=w.sims.map(s=>s.homeId),inflow=w.externalInflow;
  tick(w);assert.equal(w.projects.length,1);assert.equal(w.zoneOrders.length,1);
  w.projects[0].progress=w.projects[0].required;
  tick(w);const completed=w.map.facilities.find(f=>f.foundingPetitionId===0);
  assert.ok(completed);assert.equal(w.projects.length,1);
  cancelFoundingConstruction(w,0,'stale_order',w.worldTick,()=>{});
  assert.ok(w.map.facilities.includes(completed));assert.equal(isAvailableResidence(completed),true);
  assert.equal(w.treasury,treasury-worldCost(w));assert.equal(w.externalInflow-inflow,worldCost(w));
  assert.equal(w.projects.length,0);assert.equal(w.zoneOrders.length,0);
  assert.equal(w.sims.length,pop);assert.deepEqual(w.sims.map(s=>s.homeId),homeIds);
});

test('#32 saving a funded walking worker and resuming preserves construction, payments and completion events',()=>{
  const a=fundedFixture();a.logic.construct.requiredByType.house=6;
  a.sims[0].x=397;a.sims[0].y=400;
  tick(a);tick(a,[{sequence:0,command:'assign',payload:{simId:a.sims[0].id,actionType:'construct'}}]);
  assert.equal(a.sims[0].state.kind,'walking');
  assert.deepEqual(findNonFinite(a),[]);
  const b=deserialize(serialize(a)),events=[];
  for(let i=0;i<20;i++){const ea=tick(a),eb=tick(b);assert.deepEqual(ea,eb);events.push(...ea);}
  assert.deepEqual(findNonFinite(a),[]);assert.deepEqual(findNonFinite(b),[]);
  assert.equal(hashWorld(a),hashWorld(b));assert.equal(a.founding.petitions[0].status,'awaiting_settlement');
  assert.equal(events.filter(e=>e.type==='founding_homes_built').length,1);
  assert.ok(!events.some(e=>e.type==='founding_funded'),'resume cannot pay again');
});
