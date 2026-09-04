import {test} from 'node:test';
import assert from 'node:assert/strict';
import {arrivalObserver,observeSettlementTraffic} from '../bench/settlement-traffic.js';
import {createWorld,advance,serialize,deserialize} from '../sim/index.js';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const row=(arrivals,walkingTicks)=>({from:'village:0',to:'village:1',purpose:'shopping',arrivals,walkingTicks});

test('founded municipalities build paid stations and sustain reciprocal rail for 30 service days across saves',()=>{
  // Controlled initial saturation/terrain/approval; ordinary paid commands and
  // real construction thereafter. This does not test natural founding frequency.
  const run=(extra=[])=>JSON.parse(execFileSync(process.execPath,[
    fileURLToPath(new URL('../bench/founding-construction.js',import.meta.url)),
    '32','--settle','--family','--traffic','--retain-native-plots',
    '--station-orders','--expand-centers','--traffic-days=70','--complete-service-window',...extra,
  ],{encoding:'utf8',timeout:360000}));
  const a=run(),b=run(['--resume-traffic','--audit-traffic']);
  assert.deepEqual(a,b,'all observations and final world hash must survive a midpoint save');
  assert.equal(a.founded,1);assert.equal(a.ineligibleWork,0);
  const t=a.traffic,r=t.railObservation,window=r.serviceWindow;
  assert.equal(t.initialMunicipalities.length,2);
  // §23.47 중심 투자는 이 시나리오의 **부수 조건**이다: bench/settlement-traffic.js:84가
  // "역 지을 땅이 막혔을 때(blocked('land'))에만" 유료 중심을 주문한다. 거절이 호감도를
  // 움직이면서 궤적이 밀리자 새 마을이 매번 땅을 찾아, 막히는 상황 자체가 안 왔다
  // (founded 1·역 주문 2·30일 상호 운행·폐쇄 회계 115063은 모두 그대로다).
  // 이 테스트의 이름이 주장하는 것은 '유료 역과 30일 상호 철도'이지 중심 주문이 아니다.
  // 유료 중심 자체는 test/municipal-land.test.js가 비용·귀속·결정성까지 직접 검증한다.
  assert.ok(r.centerOrders.length <= 1, `중심 주문이 두 번 이상 나갔다 (${r.centerOrders.length})`);
  for (const order of r.centerOrders) assert.equal(order.cost, 5000);
  assert.equal(r.stationOrders.length,2);
  assert.deepEqual(new Set(r.stationOrders.map(o=>o.villageId)),new Set(['village:0','village:1']));
  for(const order of r.stationOrders){
    assert.equal(order.cost,8000);assert.ok(order.treasury>=0);
    const labor=r.stationLabor.find(p=>p.plotId===order.plotId);
    assert.ok(labor&&labor.startedTick>=order.tick,'paid order must start its real station project');
    assert.ok(labor.required>0&&labor.labor>=labor.required,'completion must consume observed project labor');
    assert.ok(labor.positiveLaborTicks>0&&labor.constructionStarts>0&&labor.walkingSteps>0);
    assert.ok(labor.eligibleWorkers.length>0,'eligible residents must reach and work at each station site');
    assert.ok(t.construction.some(c=>c.type==='train_station'&&c.villageId===order.villageId&&c.tick>order.tick));
  }
  assert.ok(window?.complete,'must observe 30 full days after intermunicipal service actually opens');
  assert.ok(window.startTick<=t.startTick+70*1440,'service must still open within the original70-day deadline');
  assert.ok(t.endTick<=t.startTick+100*1440,'follow-through must never be an unbounded wait');
  assert.equal(window.endTick-window.startTick,30*1440);
  assert.equal(window.observedUntil,window.endTick);
  for(const [from,to] of [['village:0','village:1'],['village:1','village:0']]){
    assert.ok(window.directions[`${from}>${to}`]>0,'actual boardings, not planned trips');
    assert.ok(window.arrivals.some(row=>row.from===from&&row.to===to&&row.arrivals>0));
  }
  assert.ok(r.stats.alightings>0);assert.ok(r.stats.passengerTiles>0);
  assert.equal(r.stats.cancelledRides,0);assert.deepEqual(t.noPath,{});
  assert.equal(t.closedMoney,115063,'observer also checks the closed ledger every tick');
});
test('rail service follow-through rejects unbounded or non-station observations',()=>{
  const w=createWorld(32);
  assert.throws(()=>observeSettlementTraffic(w,{days:336,stations:true,completeServiceWindow:true}));
  assert.throws(()=>observeSettlementTraffic(w,{days:1,completeServiceWindow:true}));
  const {report}=observeSettlementTraffic(w,{days:1,stations:true,completeServiceWindow:true});
  assert.equal(report.endTick-report.startTick,1440,'no opening does not extend the deadline');
  assert.equal(report.railObservation.serviceWindow,null);
});
test('post-founding arrival observation excludes pre-window traffic even when today is mutated in place',()=>{
  const today={day:18,municipalVisits:{route:row(4,100)}},observer=arrivalObserver(today);
  today.municipalVisits.route.arrivals++;today.municipalVisits.route.walkingTicks+=30;
  observer.collect(today);observer.collect(today);
  assert.deepEqual(observer.rows(),[row(1,30)]);
  const result=observer.rows();result[0].arrivals=99;assert.equal(observer.rows()[0].arrivals,1);
});
test('post-founding arrival totals survive more than the transport history ring and daily counter resets',()=>{
  const observer=arrivalObserver({day:0});
  for(let day=1;day<=30;day++)observer.collect({day,municipalVisits:{route:row(2,40)}});
  assert.deepEqual(observer.rows(),[row(60,1200)]);
  assert.throws(()=>observer.collect({day:29}),/backwards/);
  assert.throws(()=>observer.collect({day:30,municipalVisits:{route:row(1,20)}}),/monotone/);
});
test('post-settlement observer makes no world changes beyond real ticks and midpoint saves replay identically',()=>{
  const w=createWorld(32),copy=deserialize(serialize(w)),control=deserialize(serialize(w));
  const a=observeSettlementTraffic(w,{days:2}),b=observeSettlementTraffic(copy,{days:2,resume:true});
  assert.deepEqual(a.report,b.report);assert.equal(serialize(a.world),serialize(b.world));
  advance(control,{},2*1440);assert.equal(serialize(a.world),serialize(control));
  assert.equal(a.report.endTick-a.report.startTick,2*1440);assert.equal(a.report.initialMunicipalities[0].population,10);
});

test('actual family founding with seed-native plots supports local construction and reciprocal service arrivals',()=>{
  const result=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('../bench/founding-construction.js',import.meta.url)),
    // This includes construction plus 30 more simulated days. Allow scheduling
    // headroom when the full suite runs alongside other worktrees on this host.
    '32','--settle','--family','--traffic','--retain-native-plots'],{encoding:'utf8',timeout:180000}));
  assert.equal(result.founded,1);assert.equal(result.ineligibleWork,0);assert.equal(result.retainedNativePlots,95);
  const traffic=result.traffic;
  assert.equal(traffic.days,30);assert.equal(traffic.endTick-traffic.startTick,30*1440);
  assert.equal(traffic.initialMunicipalities.length,2);
  assert.deepEqual(traffic.initialMunicipalities[1].facilities,{apartment:1});
  assert.ok(traffic.initialMunicipalities[1].buildableUnusedPlots>0);
  assert.ok(traffic.construction.some(f=>f.villageId==='village:1'&&f.type!=='apartment'));
  assert.deepEqual(traffic.noPath,{},'preserved facilities must not be overwritten by native-plot construction');
  assert.deepEqual(traffic.noPathSamples,[]);
  for(const [from,to] of [['village:0','village:1'],['village:1','village:0']])
    assert.ok(traffic.arrivals.some(v=>v.from===from&&v.to===to&&v.arrivals>0));
});
