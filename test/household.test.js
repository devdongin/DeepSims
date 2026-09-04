import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createWorld } from '../sim/world.js';
import { migrateWorld } from '../sim/migrate.js';
import { evaluateHouseholds, applyHouseholdIntents } from '../sim/household.js';
import { simView } from '../server/view.js';
import { serialize, deserialize } from '../sim/serialize.js';

function fixture() {
  const w=createWorld(51),parent=w.sims[0],child=w.sims[1];
  parent.traits.age=50; child.traits.age=19; child.traits.occupation='office_worker'; child.money=5000;
  child.homeId=parent.homeId; child.householdId=parent.householdId; w.parents[child.id]=[parent.id];
  w.logic.household={independenceAge:19,stableDays:2,reserveMoney:2400};
  for(const s of w.sims.filter(s=>s.homeId==='house4'))s.homeId='house3';
  const events=[],emit=(type,simId,payload)=>events.push({type,simId,payload});
  return{w,parent,child,events,emit};
}

test('#96 unfinished degree is not projected employment or independence income',()=>{
  const {w,child,emit}=fixture();child.education.course='doctorate';child.education.completed=false;
  evaluateHouseholds(w,100,1,emit);evaluateHouseholds(w,200,2,emit);
  assert.equal(w.householdIntents.length,0);
  const row=w.householdDaily.households.flatMap(h=>h.residents).find(s=>s.simId===child.id);
  assert.equal(row.employed,false);assert.equal(row.income,0);
});

test('#51 stable employed adult child creates a durable intent, then separates on the next tick',()=>{
  const{w,child,events,emit}=fixture();
  evaluateHouseholds(w,100,1,emit);assert.equal(w.householdIntents.length,0);
  evaluateHouseholds(w,200,2,emit);assert.equal(w.householdIntents.length,1);assert.equal(child.homeId,'house0');
  const intent=w.householdIntents[0];assert.equal(intent.applyTick,201);
  applyHouseholdIntents(w,200,emit);assert.equal(child.homeId,'house0');
  applyHouseholdIntents(w,201,emit);assert.equal(child.homeId,'house4');
  assert.notEqual(child.householdId,w.sims[0].householdId);
  assert.deepEqual(events.filter(e=>e.type.startsWith('household_intent')).map(e=>e.type),
    ['household_intent_created','household_intent_applied']);
});

test('#51 next-tick revalidation rejects lost reserves without moving or inventing money',()=>{
  const{w,child,events,emit}=fixture();
  evaluateHouseholds(w,100,1,emit);evaluateHouseholds(w,200,2,emit);
  const total=w.sims.reduce((n,s)=>n+s.money,0);child.money=0;
  applyHouseholdIntents(w,201,emit);
  assert.equal(child.homeId,'house0');assert.equal(child.independenceDays,0);
  assert.equal(events.at(-1).payload.reason,'reserve_short');
  assert.equal(w.sims.reduce((n,s)=>n+s.money,0),total-5000);
});

test('#51 roommates and students do not become adult-child separation candidates',()=>{
  const{w,parent,child,emit}=fixture();w.logic.household.stableDays=1;
  w.parents[child.id]=[];evaluateHouseholds(w,100,1,emit);assert.equal(w.householdIntents.length,0);
  w.parents[child.id]=[parent.id];child.traits.occupation='student';evaluateHouseholds(w,200,2,emit);
  assert.equal(w.householdIntents.length,0);assert.equal(child.independenceDays,0);
});

test('#51 daily household observation reports family, money, income, employment and bed capacity',()=>{
  const{w,child,emit}=fixture();evaluateHouseholds(w,100,1,emit);
  const row=w.householdDaily.households.find(h=>h.householdId===child.householdId);
  assert.deepEqual(row.members,[0,1]);assert.equal(row.money,w.sims[0].money+child.money);
  assert.equal(Number.isSafeInteger(row.employed),true);assert.equal(row.beds,2);assert.equal(row.freeBeds,0);
  assert.equal(row.income,row.residents.reduce((n,r)=>n+r.income,0));
  assert.equal(row.residents.every(r=>Number.isSafeInteger(r.income)),true);
  assert.deepEqual(row.residents[1].parentIds,[0]);
  w.logic.household.stableDays=1;evaluateHouseholds(w,200,2,emit);child.money=0;applyHouseholdIntents(w,201,emit);
  assert.equal(w.householdDaily.failures.reserve_short,1);
});

test('#51 no vacant residence prevents stability from accumulating',()=>{
  const { w,child,emit }=fixture();
  const homes=w.map.facilities.filter(f=>f.type==='house'&&f.id!=='house0');
  homes.forEach((home,i)=>{w.sims[i+2].homeId=home.id;});
  evaluateHouseholds(w,100,1,emit);
  assert.equal(child.independenceDays,0);assert.equal(w.householdIntents.length,0);
});

test('#51/§23.39 투영에는 화면이 읽는 필드만 있다 (죽은 payload 금지)',()=>{
  // 이 테스트는 원래 homeId·householdId가 **투영에 있는지**를 검사했다. 그런데 화면은
  // 그 둘을 한 번도 읽지 않는다(전수 확인) — 아무도 안 보는 것을 250ms마다 보내는 계약을
  // 굳히고 있었던 셈이다. 성능 리뷰가 같은 부류로 affinity 1.27MB가 스냅샷에 실려 나가는
  // 것을 잡았다. 그래서 계약을 뒤집는다: **투영의 모든 필드는 클라이언트가 읽어야 한다.**
  // §23.41 다만 "안 쓴다"와 "필요 없다"는 다르다. 로드맵에 있는 필드는 남긴다 —
  // 대신 **왜 남기는지를 여기 적게** 해서, 아무도 안 보는 payload가 조용히 쌓이지 않게 한다.
  const ROADMAP = {
    homeId: 'PLAN §125~126 가구 개념 · #51/#32 진행 중 — 정적 쪽에 있어 배치 비용 없음',
    householdId: 'PLAN §125~126 가구 개념 · #51/#32 진행 중 — 정적 쪽에 있어 배치 비용 없음',
  };
  const client = fs.readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');
  const { child } = fixture();
  const dead = Object.keys(simView(child))
    .filter((k) => !ROADMAP[k] && !new RegExp(`\\b${k}\\b`).test(client));
  assert.deepEqual(dead, [],
    `화면이 안 읽고 로드맵 근거도 없는 필드가 투영에 있다: ${dead.join(', ')}\n`
    + '읽게 하거나, 빼거나, ROADMAP에 이유를 적어라.');
});

test('#51 v58 migration derives households deterministically and preserves married households across homes',()=>{
  const w=createWorld(51),rng=JSON.stringify(w.rngSim);w.schemaVersion=58;
  for(const s of w.sims){delete s.householdId;delete s.independenceDays;}
  delete w.householdIntents;delete w.nextHouseholdIntentId;delete w.householdDaily;
  w.partners[0]=2;w.partners[2]=0;w.partnerStage[0]='married';w.partnerStage[2]='married';
  const m=migrateWorld(w);
  assert.equal(m.sims[0].householdId,m.sims[2].householdId);
  assert.equal(m.sims[1].householdId,'household:house0');
  assert.deepEqual(m.householdIntents,[]);assert.equal(JSON.stringify(m.rngSim),rng);
});

test('#51 pending intent survives canonical save/resume and applies identically',()=>{
  const {w,emit}=fixture();evaluateHouseholds(w,100,1,emit);evaluateHouseholds(w,200,2,emit);
  const resumed=migrateWorld(deserialize(serialize(w))),a=[],b=[];
  applyHouseholdIntents(w,201,(...e)=>a.push(e));applyHouseholdIntents(resumed,201,(...e)=>b.push(e));
  assert.equal(serialize(resumed),serialize(w));assert.deepEqual(b,a);
});
