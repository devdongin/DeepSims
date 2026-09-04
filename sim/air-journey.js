import {bfsPath} from './pathfind.js';
import {sameRegion} from './map.js';
import {airDistance} from './flight-schedule.js';
import {chooseFlightItinerary} from './flight-itinerary.js';
import {unavailableAirports} from './air-network.js';

// Ordinary personal travel, including returning home after a remote work/visit.
// Household relocation, emergency/public duty, escort and freight stay separate.
const ACTIONS=new Set(['work','study','eat','socialize','play','drink','binge_eat','exercise','read',
  'shop','fish','stroll','volunteer','board_game','stock_food','visit_culture','sleep','cook_eat','hole_up','see_doctor']);
const cmp=(a,b)=>a<b?-1:a>b?1:0;

// Query only. Access/egress are real BFS paths; air legs never masquerade as a
// walkable coordinate array. Seats remain allocated at real departure time.
// The caller also compares this estimate with its existing rail option.
export function chooseAirJourney(world,sim,target,tick,directPath=undefined){
  if(!world.air?.links.length||!ACTIONS.has(target.action)||target.facilityId==='patrol')return null;
  const ground=directPath===undefined?bfsPath(world.map,sim.x,sim.y,target.res.x,target.res.y):directPath;
  if(ground?.length===0)return null;
  const directTicks=ground?Math.ceil(ground.length/(sim.hasCar?world.logic.transport.carSpeedTiles:1)):null;
  const closed=unavailableAirports(world.air,world.map.facilities,world.incidents),closedSet=new Set(closed);
  const airports=world.air.airports.filter(a=>!closedSet.has(a.id)).sort((a,b)=>cmp(a.id,b.id));
  const access=new Map(),egress=new Map(),links=new Map(world.air.links.map(l=>[l.id,l]));
  for(const airport of airports){
    const p=airport.door;
    if(sameRegion(world.map,sim.x,sim.y,p.x,p.y)){
      const path=bfsPath(world.map,sim.x,sim.y,p.x,p.y);if(path!==null)access.set(airport.id,path);
    }
    if(sameRegion(world.map,p.x,p.y,target.res.x,target.res.y)){
      const path=bfsPath(world.map,p.x,p.y,target.res.x,target.res.y);if(path!==null)egress.set(airport.id,path);
    }
  }
  let best=null;
  for(const from of airports){
    if(!access.has(from.id))continue;
    // Decisions occur after the current tick's service update, so even a resident
    // already at the gate can first board on the next tick, never retroactively.
    const ready=tick+Math.max(1,access.get(from.id).length);
    for(const to of airports){
      if(to.id===from.id||!egress.has(to.id))continue;
      const itinerary=chooseFlightItinerary(world.air.links,from.id,to.id,ready,world.logic.transport.airTransferTicks,closed);
      if(!itinerary)continue;
      const estimatedTicks=itinerary.arrivalTick-tick+egress.get(to.id).length;
      if(directTicks!==null&&estimatedTicks>=directTicks||best&&estimatedTicks>=best.estimatedTicks)continue;
      const distance=access.get(from.id).length+egress.get(to.id).length+itinerary.legs.reduce((n,leg)=>{
        const link=links.get(leg.linkId);return n+airDistance(link.fromPoint,link.toPoint);
      },0);
      best={access:access.get(from.id),egress:egress.get(to.id),itinerary,estimatedTicks,directTicks,
        physicalDistance:ground?.length??distance,airJourneyDistance:distance};
    }
  }
  return best;
}
