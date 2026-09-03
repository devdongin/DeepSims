import { TILE, plotBuildable, zoneFootprint } from './map.js';
import { foundingSiteReserved } from './founding.js';

export function campusSiteReserved(world, plot, type, dir=0) {
  const shape = zoneFootprint(type,dir);
  return [...world.projects,...world.zoneOrders].some(order => {
    if (order.plotId === plot.plotId) return false;
    if (type !== 'university' && order.type !== 'university') return false;
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
    if (!(world.centers ?? []).some(c => (c.villageId ?? 'village:0') === villageId
      && Math.abs(c.x-plot.x)+Math.abs(c.y-plot.y) < world.logic.zone.centerRadius)) continue;
    const tiles = Array.from({length:35}, (_,i) => world.map.tiles[(plot.y+Math.floor(i/7))*world.map.w+plot.x+i%7]);
    if (!tiles.includes(TILE.ROAD) || tiles.some(t => t !== TILE.ROAD && t !== TILE.GRASS)) continue;
    const {w,h} = zoneFootprint('university',0);
    const options = [];
    for (let dy=-8;dy<=8;dy++) for (let dx=-8;dx<=8;dx++) {
      if (Math.abs(dx)+Math.abs(dy)>8) continue;
      const candidate = {...plot,x:plot.x+dx,y:plot.y+dy};
      if (!plotBuildable(world.map,candidate,w,h) || foundingSiteReserved(world,candidate,'university')) continue;
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
