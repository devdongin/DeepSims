import { nextFlight } from './flight-schedule.js';

const compareId = (a,b) => a<b?-1:a>b?1:0;
const comparePath = (a,b) => {
  for(let i=0;i<Math.min(a.length,b.length);i++){
    const order=compareId(a[i].linkId,b[i].linkId);if(order)return order;
  }
  return a.length-b.length;
};

// Scheduled, potentially multi-leg airport-to-airport journey. The caller owns
// access/egress BFS and validates airport existence/open status. This query never
// reserves seats: actual queues/capacity may defer a traveller to a later flight.
// Earliest-arrival Dijkstra is valid because waiting is allowed and nextFlight
// is FIFO: a later readyTick cannot produce an earlier arrival on the same link.
export function chooseFlightItinerary(links, from, to, readyTick, transferTicks, closedAirports=[]) {
  if(!Number.isSafeInteger(readyTick)||readyTick<0||!Number.isSafeInteger(transferTicks)||transferTicks<0)
    throw new RangeError('nonnegative integer itinerary timing required');
  const closed=new Set(closedAirports);
  if(closed.has(from)||closed.has(to))return null;
  if(from===to)return {from,to,readyTick,arrivalTick:readyTick,legs:[]};
  const graph=new Map(),ids=new Set();
  for(const link of [...links].sort((a,b)=>compareId(a.id,b.id))){
    if(typeof link.id!=='string'||ids.has(link.id))throw new RangeError('unique link IDs required');
    ids.add(link.id);
    if(link.blocked||closed.has(link.from)||closed.has(link.to))continue;
    for(const airport of [link.from,link.to]){
      if(!graph.has(airport))graph.set(airport,[]);
      graph.get(airport).push(link);
    }
  }
  const best=new Map([[from,{airport:from,arrivalTick:readyTick,legs:[]}]]),settled=new Set();
  while(true){
    const current=[...best.values()].filter(x=>!settled.has(x.airport)).sort((a,b)=>
      a.arrivalTick-b.arrivalTick||comparePath(a.legs,b.legs)||compareId(a.airport,b.airport))[0];
    if(!current)return null;
    if(current.airport===to)return {from,to,readyTick,arrivalTick:current.arrivalTick,legs:current.legs};
    settled.add(current.airport);
    const connectionReady=current.arrivalTick+(current.legs.length?transferTicks:0);
    if(!Number.isSafeInteger(connectionReady))throw new RangeError('connection tick overflow');
    for(const link of graph.get(current.airport)??[]){
      const leg=nextFlight(link,current.airport,connectionReady);
      if(!leg||settled.has(leg.to))continue;
      const candidate={airport:leg.to,arrivalTick:leg.arrivalTick,legs:[...current.legs,leg]};
      const prior=best.get(leg.to);
      if(!prior||candidate.arrivalTick<prior.arrivalTick||candidate.arrivalTick===prior.arrivalTick
        &&comparePath(candidate.legs,prior.legs)<0)best.set(leg.to,candidate);
    }
  }
}
