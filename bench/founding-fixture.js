import {TILE} from '../sim/map.js';

// Remove terrain barriers for a controlled founding scenario, not the occupied
// structures: erasing their tiles falsely makes overlapping seed plots buildable.
export function clearTerrainKeepingFacilities(map){
  const occupied=new Set();
  const keep=(x,y)=>{if(x>=0&&y>=0&&x<map.w&&y<map.h)occupied.add(y*map.w+x);};
  for(const f of map.facilities){
    for(let y=f.y;y<f.y+f.h;y++)for(let x=f.x;x<f.x+f.w;x++)keep(x,y);
    for(const p of [f.door,...f.resources,...(f.extraBedSlots??[])])if(p)keep(p.x,p.y);
  }
  for(let i=0;i<map.tiles.length;i++)if(!occupied.has(i))map.tiles[i]=TILE.GRASS;
  map.reachVersion=(map.reachVersion??0)+1;
}
