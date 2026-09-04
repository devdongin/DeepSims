import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordUnservedAirTrip as record,recentUnservedAirDemand as demand,unservedAirSummary} from '../sim/unserved-air-demand.js';
import {TILE} from '../sim/map.js';
import {makeTransportStats} from '../sim/transport-stats.js';
import {makeAirNetwork,commissionAirport} from '../sim/air-network.js';

function fixture(){
  const s={id:0,villageId:'A',homeId:'home',x:1,y:2};
  const home={id:'home',type:'house',villageId:'A',door:{x:1,y:2},resources:[]};
  const cafe={id:'cafe',type:'cafe',villageId:'B',door:{x:61,y:2},resources:[{id:'seat',x:61,y:2}]};
  const w={map:{w:64,h:8,tiles:Array(512).fill(TILE.GRASS),facilities:[home,cafe],reachVersion:0},
    sims:[s,{id:1,villageId:'B'}],villages:[{id:'A',center:{x:1,y:2}},{id:'B',center:{x:61,y:2}}],
    transportStats:makeTransportStats(0),logic:{transport:{longTripMin:30}}};
  for(let y=0;y<8;y++)w.map.tiles[y*64+32]=TILE.WATER;
  return {w,s,target:{action:'eat',facilityId:'cafe',resourceId:'seat',res:cafe.resources[0]}};
}

test('unserved intent is one resident/route/day and never a completed trip',()=>{
  const {w,s,target}=fixture();assert.equal(record(w,s,target),true);
  for(let i=0;i<20;i++)assert.equal(record(w,s,{...target,action:'socialize'}),false);
  assert.equal(demand(w.transportStats,'A','B',0),1);assert.equal(demand(w.transportStats,'B','A',0),1);
  assert.equal(w.transportStats.today.arrivals,0);assert.equal(w.transportStats.today.departures,0);
  assert.equal(w.transportStats.today.municipalVisits,undefined);
});

test('unserved observations expire after today plus thirteen previous days and summaries hide IDs',()=>{
  const {w,s,target}=fixture();record(w,s,target);
  const rows=unservedAirSummary(w.transportStats.today.unservedAirTrips);
  assert.deepEqual(Object.values(rows),[{from:'A',to:'B',intents:1}]);
  w.transportStats.history=[{day:0,unservedAirTrips:rows}];w.transportStats.today={day:13};
  assert.equal(demand(w.transportStats,'A','B',13),1);assert.equal(demand(w.transportStats,'A','B',14),0);
  assert.throws(()=>demand(w.transportStats,'A','B',-1),/day/);
});

test('local trips, empty destinations, special actions and inaccessible rooms are not airport demand',()=>{
  for(const condition of ['local','empty','special','room','connected','away']){
    const {w,s,target}=fixture();
    if(condition==='local')w.map.facilities[1].villageId='A';
    if(condition==='empty')w.sims.pop();
    if(condition==='special')target.action='construct';
    if(condition==='room'){
      target.res={id:'seat',x:63,y:7};w.map.facilities[1].resources=[target.res];
      w.map.tiles[6*64+63]=TILE.WATER;w.map.tiles[7*64+62]=TILE.WATER;
    }
    if(condition==='connected')w.map.tiles[2*64+32]=TILE.GRASS;
    if(condition==='away')s.x=60;
    assert.equal(record(w,s,target),false,condition);
    assert.equal(w.transportStats.today.unservedAirTrips,undefined);
  }
});

test('new airport parent uses unserved evidence but never adds it to completed trips',()=>{
  for(const mixed of [false,true]){
    const network=makeAirNetwork(),config={speed:8,dwellTicks:10,capacity:8};
    const facility=(id,x)=>({id,type:'airport',villageId:id,door:{x,y:0}});
    commissionAirport(network,facility('A',0),'pA',0,config);
    commissionAirport(network,facility('B',100),'pB',0,config);
    const stats={today:{day:0,unservedAirTrips:{a:{from:'C',to:'A',intents:mixed?6:12}},
      municipalVisits:mixed?{a:{from:'C',to:'A',arrivals:6},b:{from:'C',to:'B',arrivals:7}}:{}}};
    commissionAirport(network,facility('C',101),'pC',0,config,stats);
    assert.equal(network.links[1].from,mixed?'B':'A');assert.equal(network.links.length,2);
  }
});
