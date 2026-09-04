import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,serialize} from '../sim/index.js';
import {commissionAirport} from '../sim/air-network.js';
import {chooseFlightItinerary} from '../sim/flight-itinerary.js';
import {newGovernment} from '../sim/government.js';
import {airView,simView,simVolatile} from '../server/view.js';
import {aircraftLabel,airportConstructionLabel,travelStateLabel} from '../client/air-ui.js';

function fixture(){
  const w=createWorld(32);w.cityTier=3;
  w.villages.push({id:'village:1',name:'Other',center:{x:150,y:100},government:newGovernment()});
  w.sims[1].villageId='village:1';
  for(const [i,x] of [[0,100],[1,150]]){
    const f={id:`airport${i}`,type:'airport',villageId:`village:${i}`,door:{x,y:100},resources:[]};
    w.map.facilities.push(f);commissionAirport(w.air,f,`private-project-${i}`,0,{speed:10,dwellTicks:2,capacity:8});
  }
  const itinerary=chooseFlightItinerary(w.air.links,'airport0','airport1',0,2);
  w.sims[0].state={kind:'waiting_flight',action:'eat',flight:{legs:itinerary.legs,legIndex:0}};
  return w;
}
test('air projection reports real gates/occupancy/closure and omits itineraries and private project records',()=>{
  const w=fixture(),before=serialize(w),view=airView(w);
  assert.equal(view.links[0].waiting,1);assert.equal(view.links[0].aircraft.passengers,0);
  assert.equal(view.construction['village:0'].reason,'airport_exists');
  assert.equal(serialize(w),before);assert.ok(!JSON.stringify(view).includes('private-project'));
  assert.ok(!JSON.stringify(view).includes('legs'));assert.ok(JSON.stringify(view).length<2000);
  w.sims[0].state.kind='flying';w.air.links[0].aircraft.passengers=[0,99999];
  assert.equal(airView(w).links[0].aircraft.passengers,1,'removed residents are not displayed as passengers');
  w.incidents=[{facilityId:'airport1'}];const closed=airView(w);
  assert.equal(closed.links[0].blocked,true);assert.equal(closed.airports[1].closed,true);
});
test('both resident projections preserve air walking flags but never expose full routes',()=>{
  const sim=fixture().sims[0];sim.state.kind='walking';sim.state.path=Array(1000).fill({x:1,y:2});
  for(const view of [simView(sim),simVolatile(sim)]){
    assert.equal(view.state.air,true);assert.equal(view.state.path,undefined);assert.equal(view.state.flight,undefined);
    assert.match(travelStateLabel(view.state),/공항 접근·이탈/);
  }
});
test('UI text distinguishes holding/diversion/repositioning, actual seats and observed investment demand',()=>{
  const w=fixture(),link=airView(w).links[0];
  for(const [phase,label] of [['holding','기내 대기'],['diverting','회항 중'],['repositioning','빈 기체 복귀']]){
    link.aircraft.phase=phase;assert.ok(aircraftLabel(link).includes(label));
  }
  assert.match(aircraftLabel(link),/0\/8명.*게이트 대기 1명/);
  assert.match(airportConstructionLabel(undefined),/확인 중/);
  assert.match(airportConstructionLabel({eligible:false,reason:'airport_demand_short',completedTrips:4,threshold:12}),/수요 부족.*4\/12회/);
  assert.equal(travelStateLabel({kind:'flying'}),'(항공기 탑승 중)');
  assert.equal(travelStateLabel({kind:'waiting_flight'}),'(공항 게이트 대기)');
});
