import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,serialize} from '../sim/index.js';
import {TILE} from '../sim/map.js';
import {collectCandidates} from '../sim/tick.js';
import {patrolTarget,fireTargets,patrolShortfallKind,fireResponseShortfallKind} from '../sim/public-service-targets.js';

function fixture(){
  const w=createWorld(88),s=w.sims[0];
  w.map={w:16,h:16,tiles:Array(256).fill(TILE.GRASS),reachVersion:0,facilities:[
    {id:'station',type:'police_station',villageId:'village:0',door:{x:2,y:2},resources:[]},
    {id:'target',type:w.logic.patrol.targets[0],villageId:'village:0',door:{x:8,y:8},resources:[]},
    {id:'foreign',type:w.logic.patrol.targets[0],villageId:'village:1',door:{x:12,y:12},resources:[]},
  ]};
  s.traits.age=30;s.traits.occupation='police';s.education.course=null;s.education.completed=true;
  s.employment={facilityId:'station',occupation:'police',assignedTick:0,homeId:s.homeId};
  s.patrolIdx=0;s.money=0;s.noPathCool={};w.reservations={};w.incidents=[];
  return {w,s};
}

test('patrol shares jurisdiction, target order and N/S/E/W/door geometry without mutation',()=>{
  const {w,s}=fixture(),positions=[[8,7],[8,9],[9,8],[7,8],[8,8]];
  for(const [x,y] of positions){
    const before=serialize(w);
    assert.deepEqual(patrolTarget(w,s),{facilityId:'target',res:{id:'patrol:target',x,y}});
    assert.equal(serialize(w),before);
    w.map.tiles[y*16+x]=TILE.WALL;
  }
  assert.equal(patrolTarget(w,s).res,null);
  assert.equal(patrolShortfallKind(w,s,1),'unreachable');
  w.map.facilities=w.map.facilities.filter(f=>f.id!=='target');
  assert.equal(patrolTarget(w,s),null); // foreign targets do not fill local gaps
  assert.equal(patrolShortfallKind(w,s,1),'no_target');
});

test('patrol reservations and cooldown use the actual virtual key, not station slots',()=>{
  const {w,s}=fixture(),key='patrol:patrol:target';
  assert.equal(patrolShortfallKind(w,s,600),null);
  w.reservations[key]=s.id+1;
  assert.equal(patrolShortfallKind(w,s,600),'reserved');
  w.reservations[key]=s.id;
  assert.equal(patrolShortfallKind(w,s,600),null);
  s.noPathCool[key]=601;
  assert.equal(patrolShortfallKind(w,s,600),'unreachable');
  assert.equal(patrolShortfallKind(w,s,601),null);
});

test('fire target order, self reservations and historical lack of cooldown filtering are retained',()=>{
  const {w,s}=fixture();s.traits.occupation='firefighter';
  assert.equal(fireResponseShortfallKind(w,s),'no_target');
  w.incidents=[{facilityId:'foreign',sinceTick:0},{facilityId:'target',sinceTick:0}];
  assert.deepEqual(fireTargets(w).map(t=>t.res),[
    {id:'fire:foreign',x:12,y:11},{id:'fire:target',x:8,y:7},
  ]);
  for(const id of ['foreign','target']){
    w.reservations[`firesite:fire:${id}`]=s.id+1;
    s.noPathCool[`firesite:fire:${id}`]=1000;
  }
  assert.equal(fireResponseShortfallKind(w,s),'reserved');
  w.reservations['firesite:fire:target']=s.id;
  assert.equal(fireResponseShortfallKind(w,s),null);
  const before=serialize(w),candidates=collectCandidates(w,s,['respond_fire'],600,true);
  assert.deepEqual(candidates.map(c=>[c.facilityId,c.resourceId]),[['firesite','fire:target']]);
  assert.equal(serialize(w),before);
});
