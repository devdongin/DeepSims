// Deterministic, fare-free public shuttle. Stations fund infrastructure; this
// minimal model does not simulate fuel, staffing, transfers or operating costs.
import {bfsPath} from './pathfind.js';
import {TILE,isWalkable,zoneFootprint} from './map.js';
import {emptyState} from './simfactory.js';
import {recordRailStep,recordRailWait} from './transport-stats.js';

export function makeRailState(){return {links:[],nextId:0,stationVersion:-1,checkedVersion:-1,
  stats:{boardings:0,alightings:0,passengerTiles:0,passengerTicks:0,waitingTicks:0,cancelledRides:0}};}
export function initializeRail(world){
  world.rail??=makeRailState();world.map.railTracks??={};
  world.map.stationVersion??=world.map.facilities.filter(f=>f.type==='train_station').length;
}

// Rail uses public walkable terrain, never a shortcut through a house. Preserve
// underlying tiles (including bridges) and protect corridors using an overlay.
function corridor(world,a,b){
  const map=world.map,tiles=map.tiles.slice(),block=(x,y,w,h)=>{
    for(let j=Math.max(0,y);j<Math.min(map.h,y+h);j++)for(let i=Math.max(0,x);i<Math.min(map.w,x+w);i++)tiles[j*map.w+i]=TILE.WALL;
  };
  for(const f of map.facilities)if(f.w&&f.h)block(f.x,f.y,f.w,f.h);
  // Leave the ordinary8x6 parcels available for later local growth as well as
  // protecting actual larger/rotated reservations against construction races.
  for(const p of world.plots)if(!p.used)block(p.x,p.y,8,6);
  for(const q of [...world.projects,...world.zoneOrders]){
    const p=world.plots.find(p=>p.plotId===q.plotId);if(!p)continue;
    const fp=zoneFootprint(q.type,q.dir??0);block(p.x,p.y,fp.w,fp.h);
  }
  for(const f of [a,b])tiles[f.door.y*map.w+f.door.x]=TILE.FLOOR;
  const path=bfsPath({...map,tiles},a.door.x,a.door.y,b.door.x,b.door.y);
  return path?.length?[{...a.door},...path]:null;
}

export function syncRailNetwork(world,t,emit){
  const rail=world.rail,map=world.map;
  if(rail.stationVersion===(map.stationVersion??0)&&rail.checkedVersion===(map.reachVersion??0))return;
  rail.stationVersion=map.stationVersion??0;rail.checkedVersion=map.reachVersion??0;
  const stations=map.facilities.filter(f=>f.type==='train_station').sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  if(stations.length<2)return;
  map.railTracks??={};
  // A bridge may connect two previously separate groups. Skip only stations
  // already in the same component, not every station that has any service.
  const parent=new Map(stations.map(s=>[s.id,s.id]));
  const root=id=>{while(parent.get(id)!==id)id=parent.get(id);return id;};
  const join=(a,b)=>parent.set(root(a),root(b));
  for(const l of rail.links)if(parent.has(l.from)&&parent.has(l.to))join(l.from,l.to);
  for(let i=1;i<stations.length;i++){
    const a=stations[i];
    let best=null;
    for(const b of stations.slice(0,i)){
      if(root(a.id)===root(b.id))continue;
      const path=corridor(world,b,a);
      if(path&&(!best||path.length<best.path.length))best={b,path};
    }
    if(!best)continue;
    const L=world.logic.transport,id=`rail:${rail.nextId++}`,path=best.path;
    const link={id,from:best.b.id,to:a.id,path,openedTick:t,speed:L.railSpeedTiles,
      dwellTicks:L.railDwellTicks,capacity:L.railCapacity,blocked:false,trackAvailable:true,pausedTicks:0,checkedVersion:map.reachVersion??0,
      train:{x:path[0].x,y:path[0].y,index:0,passengers:[]}};
    rail.links.push(link);
    join(link.from,link.to);
    for(const p of path)map.railTracks[p.y*map.w+p.x]=true;
    emit('rail_opened',null,{linkId:id,from:link.from,to:link.to,tiles:path.length-1,capacity:link.capacity});
  }
}

function schedule(link,t){
  const distance=link.path.length-1,ride=Math.ceil(distance/link.speed),d=link.dwellTicks;
  const period=2*(d+ride),phase=((t-link.openedTick-link.pausedTicks)%period+period)%period;
  if(phase<d)return {index:0,station:link.from,period,ride,phase};
  if(phase<d+ride)return {index:Math.min(distance,(phase-d+1)*link.speed),station:null,period,ride,phase};
  if(phase<2*d+ride)return {index:distance,station:link.to,period,ride,phase};
  return {index:Math.max(0,distance-(phase-2*d-ride+1)*link.speed),station:null,period,ride,phase};
}

// One train leg, with walking to/from its stations. Capacity can add another
// cycle of waiting; this is a schedule estimate, not a promise of actual speedup.
export function chooseRailJourney(world,sim,target,direct,t){
  if(!direct.length||['settle_village','escort_child_doctor','respond_fire','construct','supply_groceries'].includes(target.action))return null;
  const directTicks=Math.ceil(direct.length/(sim.hasCar?world.logic.transport.carSpeedTiles:1));
  let best=null;
  for(const link of world.rail.links){
    if(link.blocked)continue;
    for(const reverse of [false,true]){
      const from=reverse?link.to:link.from,to=reverse?link.from:link.to;
      const start=link.path[reverse?link.path.length-1:0],end=link.path[reverse?0:link.path.length-1];
      const lower=Math.abs(sim.x-start.x)+Math.abs(sim.y-start.y)+Math.ceil((link.path.length-1)/link.speed)
        +Math.abs(end.x-target.res.x)+Math.abs(end.y-target.res.y);
      if(lower>=directTicks)continue;
      const access=bfsPath(world.map,sim.x,sim.y,start.x,start.y);if(!access)continue;
      const egress=bfsPath(world.map,end.x,end.y,target.res.x,target.res.y);if(!egress)continue;
      const arrival=t+Math.max(1,access.length),s=schedule(link,arrival);
      const departure=reverse?2*link.dwellTicks+s.ride:link.dwellTicks;
      const wait=(departure-s.phase+s.period)%s.period||s.period;
      const estimatedTicks=Math.max(1,access.length)+wait+s.ride-1+egress.length;
      if(estimatedTicks>=directTicks||best&&estimatedTicks>=best.rail.estimatedTicks)continue;
      const segment=reverse?[...link.path].reverse():link.path;
      best={access,fullPath:[...access,...segment.slice(1),...egress],rail:{linkId:link.id,from,to,
        phase:access.length?'access':'waiting',egress,waitingSince:access.length?null:t,
        estimatedTicks,directTicks,plannedTick:t,boardedTick:null}};
    }
  }
  return best;
}

function matches(sim,link){return sim?.state?.rail?.linkId===link.id&&sim.state.kind==='riding_train';}
function abandon(world,sim,t,emit,arrive,reason){
  const state=sim.state,action=state.action;
  const f=world.map.facilities.find(f=>f.id===state.facilityId),r=f?.resources.find(r=>r.id===state.resourceId);
  const path=r?bfsPath(world.map,sim.x,sim.y,r.x,r.y):null;
  world.rail.stats.cancelledRides++;emit('rail_cancelled',sim.id,{linkId:state.rail?.linkId,reason});
  if(state.rail?.cancelOnAlight){
    sim.state=emptyState();emit('action_failed',sim.id,{action,reason:'lifecycle_changed'});return;
  }
  delete state.rail;
  if(path){state.path=path;state.kind='walking';if(!path.length)arrive(sim);}
  else{delete world.reservations[`${state.facilityId}:${state.resourceId}`];sim.state=emptyState();emit('action_failed',sim.id,{action,reason:'no_path'});}
}

export function advanceRail(world,t,emit,arrive){
  const rail=world.rail;
  for(const link of rail.links){
    const train=link.train;
    train.passengers=train.passengers.filter(id=>matches(world.sims.find(s=>s.id===id),link));
    const stations=world.map.facilities.filter(f=>f.id===link.from||f.id===link.to);
    if(link.checkedVersion!==(world.map.reachVersion??0))link.trackAvailable=link.path.every(p=>isWalkable(world.map,p.x,p.y));
    const unavailable=stations.length!==2||stations.some(f=>world.incidents.some(i=>i.facilityId===f.id))||!link.trackAvailable;
    if(unavailable&&!link.blocked)emit('rail_suspended',null,{linkId:link.id,reason:'route_unavailable'});
    if(!unavailable&&link.blocked)emit('rail_resumed',null,{linkId:link.id});
    link.blocked=unavailable;
    link.checkedVersion=world.map.reachVersion??0;
    if(link.blocked){
      link.pausedTicks++;
      for(const sim of world.sims)if(sim.state.rail?.linkId===link.id)abandon(world,sim,t,emit,arrive,'route_unavailable');
      train.passengers=[];continue;
    }
    const s=schedule(link,t),oldIndex=train.index;
    train.index=s.index;train.x=link.path[s.index].x;train.y=link.path[s.index].y;
    // The route is a real adjacent-tile path. No wear, item pickup or street
    // greetings are awarded while riding; passengers stay at their train.
    for(const id of [...train.passengers]){
      const sim=world.sims.find(p=>p.id===id),state=sim.state,journey=state.rail;
      const direction=Math.sign(s.index-oldIndex),tiles=Math.abs(s.index-oldIndex);
      if(tiles){rail.stats.passengerTicks++;rail.stats.passengerTiles+=tiles;
        for(let k=1;k<=tiles;k++){
          const p=link.path[oldIndex+direction*k];sim.x=p.x;sim.y=p.y;recordRailStep(world,sim,t);
        }
      }
      const destinationIndex=journey.to===link.from?0:link.path.length-1;
      if(s.index===destinationIndex){
        train.passengers=train.passengers.filter(pid=>pid!==id);rail.stats.alightings++;
        emit('rail_alighted',id,{linkId:link.id,stationId:journey.to,rideTicks:t-journey.boardedTick});
        if(journey.cancelOnAlight){
          sim.state=emptyState();emit('action_failed',id,{action:state.action,reason:'lifecycle_changed'});continue;
        }
        // Do not alias the saved itinerary with the consumable walking queue:
        // JSON resume copies them separately, so shifting an alias breaks replay.
        state.path=journey.egress.map(p=>({...p}));journey.phase='egress';state.kind='walking';
        if(!state.path.length)arrive(sim);
      }
    }
    const waiting=world.sims.filter(sim=>sim.state.kind==='waiting_train'&&sim.state.rail?.linkId===link.id)
      .sort((a,b)=>a.state.rail.waitingSince-b.state.rail.waitingSince||a.id-b.id);
    for(const sim of waiting){
      const j=sim.state.rail;rail.stats.waitingTicks++;recordRailWait(world,sim);
      if(s.station!==j.from||sim.x!==train.x||sim.y!==train.y||train.passengers.length>=link.capacity)continue;
      train.passengers.push(sim.id);rail.stats.boardings++;sim.state.kind='riding_train';j.phase='riding';j.boardedTick=t;
      emit('rail_boarded',sim.id,{linkId:link.id,from:j.from,to:j.to,waitTicks:t-j.waitingSince});
    }
  }
}
