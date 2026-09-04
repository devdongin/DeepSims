import {test} from 'node:test';
import assert from 'node:assert/strict';
import {airportGeometry,airportPoint,drawAirportExterior} from '../client/airport-visual.js';

test('airport runway, terminal and tower fit all four rotated footprints',()=>{
  for(let dir=0;dir<4;dir++){
    const fac={id:'airport0',x:10,y:20,dir,w:dir%2?12:20,h:dir%2?20:12};
    const shapes=airportGeometry(fac);
    for(const kind of ['runway','terminal','tower','tower-cabin','gate-line'])assert.ok(shapes.some(s=>s.kind===kind));
    for(const s of shapes)for(const p of s.points){
      assert.ok(p.x>=fac.x&&p.x<fac.x+fac.w);assert.ok(p.y>=fac.y&&p.y<fac.y+fac.h);
    }
    const door=airportPoint(fac,10,11);
    assert.ok(door.x===fac.x||door.x===fac.x+fac.w-1||door.y===fac.y||door.y===fac.y+fac.h-1);
  }
});

test('airport drawings are owned cleanup objects, without fake aircraft',()=>{
  const drawn=[],scene={add:{graphics(){
    const data={},g={data,setData(k,v){data[k]=v;return this;},setDepth(v){this.depth=v;return this;}};
    for(const name of ['fillStyle','beginPath','moveTo','lineTo','closePath','fillPath'])g[name]=()=>g;
    drawn.push(g);return g;
  }}};
  const objects=drawAirportExterior(scene,{id:'airport4',x:0,y:0,dir:0},(x,y)=>16*(x-y),(x,y)=>8*(x+y));
  assert.deepEqual(objects,drawn);assert.ok(objects.every(g=>g.data.airportId==='airport4'));
  assert.equal(objects.filter(g=>g.data.airportPart==='runway')[0].depth,1);
  assert.ok(objects.filter(g=>g.data.airportPart==='terminal')[0].depth>1000);
  assert.ok(objects.every(g=>!g.data.airportPart.includes('aircraft')));
});
