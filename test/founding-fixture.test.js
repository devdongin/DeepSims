import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../sim/index.js';
import {TILE,plotBuildable,isWalkable,addBuilding} from '../sim/map.js';
import {clearTerrainKeepingFacilities} from '../bench/founding-fixture.js';

test('blanket terrain clearing reproduces the restaurant-seat overwrite behind the23 benchmark route failures',()=>{
  const w=createWorld(32),plot=w.plots.find(p=>p.plotId===9),restaurant=w.map.facilities.find(f=>f.id==='restaurant');
  assert.equal(plotBuildable(w.map,plot),false);
  w.map.tiles.fill(TILE.GRASS);assert.equal(plotBuildable(w.map,plot),true);
  addBuilding(w.map,'house',plot);
  for(const id of ['seat1','seat3']){const r=restaurant.resources.find(r=>r.id===id);assert.equal(isWalkable(w.map,r.x,r.y),false);}
});
test('controlled terrain clearing preserves every existing facility tile and excludes overlapping construction plots',()=>{
  const w=createWorld(32),before=[...w.map.tiles],version=w.map.reachVersion??0;
  clearTerrainKeepingFacilities(w.map);
  assert.equal(w.map.reachVersion,version+1);
  for(const f of w.map.facilities){
    for(let y=f.y;y<f.y+f.h;y++)for(let x=f.x;x<f.x+f.w;x++)
      assert.equal(w.map.tiles[y*w.map.w+x],before[y*w.map.w+x]);
    for(const r of f.resources)assert.equal(isWalkable(w.map,r.x,r.y),true);
  }
  assert.equal(plotBuildable(w.map,w.plots.find(p=>p.plotId===9)),false);
  assert.equal(w.map.tiles[255*w.map.w+255],TILE.GRASS,'unoccupied terrain still clears');
});
