import { TILE, plotBuildable, zoneFootprint } from './map.js';
import { foundingSiteReserved } from './founding.js';

export function campusSiteReserved(world, plot, type, dir=0) {
  const shape = zoneFootprint(type,dir);
  return [...world.projects,...world.zoneOrders].some(order => {
    if (order.plotId === plot.plotId) return false;
    if (!['university','airport'].includes(type) && !['university','airport'].includes(order.type)) return false;
    const other = world.plots.find(p => p.plotId === order.plotId);
    if (!other) return false;
    const size = zoneFootprint(order.type,order.dir??0);
    return plot.x < other.x+size.w && plot.x+shape.w > other.x
      && plot.y < other.y+size.h && plot.y+shape.h > other.y;
  });
}

// Repair only unused road-overlapped parcels near an invested center. Roads and
// terrain are never erased; paid/active/founding reservations are never moved.
export function repairCenterPlots(world, emit) {
  const busy = new Set([...world.projects, ...world.zoneOrders].map(p => p.plotId));
  for (const petition of world.founding?.petitions ?? []) {
    if (['approved','building'].includes(petition.status)) {
      for (const id of petition.plan?.homePlotIds ?? []) busy.add(id);
    }
  }
  const overlaps = (a, w, h, b, bw, bh) => a.x < b.x+bw && a.x+w > b.x && a.y < b.y+bh && a.y+h > b.y;
  for (const plot of [...world.plots].sort((a,b) => a.plotId-b.plotId)) {
    if (plot.used || busy.has(plot.plotId) || plotBuildable(world.map, plot)
      || foundingSiteReserved(world, plot, 'university')) continue;
    const villageId = plot.villageId ?? 'village:0';
    const nearCenter = p => (world.centers ?? []).some(c => (c.villageId ?? 'village:0') === villageId
      && Math.abs(c.x-p.x)+Math.abs(c.y-p.y) < world.logic.zone.centerRadius);
    if (!nearCenter(plot)) continue;
    const tiles = Array.from({length:35}, (_,i) => world.map.tiles[(plot.y+Math.floor(i/7))*world.map.w+plot.x+i%7]);
    if (!tiles.includes(TILE.ROAD) || tiles.some(t => t !== TILE.ROAD && t !== TILE.GRASS)) continue;
    const {w,h} = zoneFootprint('university',0);
    // A road plus a crossing sidewalk can require displacement on both axes.
    // The old fixed radius8 could never fit the enlarged12x10 campus there.
    // Bound search by the protected footprint, and keep the parcel in its
    // invested center's catchment. Never clear roads/sidewalks to make it fit.
    const radius=w+h;
    const options = [];
    for (let dy=-radius;dy<=radius;dy++) for (let dx=-radius;dx<=radius;dx++) {
      if (Math.abs(dx)+Math.abs(dy)>radius) continue;
      const candidate = {...plot,x:plot.x+dx,y:plot.y+dy};
      if (!nearCenter(candidate)) continue;
      if (!plotBuildable(world.map,candidate,w,h) || foundingSiteReserved(world,candidate,'university')
        || campusSiteReserved(world,candidate,'university')) continue;
      if (world.plots.some(p => p !== plot && overlaps(candidate,w,h,p,w,h))) continue;
      if (world.map.facilities.some(f => overlaps(candidate,w,h,f,f.w??1,f.h??1)
        || overlaps(candidate,w,h,f.door,1,1))) continue;
      options.push({candidate,d:Math.abs(dx)+Math.abs(dy)});
    }
    options.sort((a,b) => a.d-b.d || a.candidate.y-b.candidate.y || a.candidate.x-b.candidate.x);
    if (!options.length) continue;
    const from = {x:plot.x,y:plot.y};
    plot.x=options[0].candidate.x; plot.y=options[0].candidate.y;
    emit('plot_relocated',null,{plotId:plot.plotId,x:plot.x,y:plot.y,from,villageId});
  }
}
