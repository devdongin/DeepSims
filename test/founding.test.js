import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../sim/world.js';
import { serialize } from '../sim/serialize.js';
import { foundingEvidence } from '../sim/founding.js';

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
