import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
const start=source.indexOf('  followSelected() {');
const end=source.indexOf('\n  }',start);
assert.ok(start>=0&&end>start);
const method=source.slice(start,end+4);
function run(id,{sprite=true,present=true}={}){
  const calls=[],camera={scrollX:0,scrollY:0,width:100,height:100};
  const context=vm.createContext({followSimId:id,world:{sims:present?[{id:0,x:10,y:20}]:[]},
    simSprites:new Map(sprite&&present?[[0,{x:200,y:300}]]:[]),
    isoX:(x,y)=>(x-y)*16,isoY:(x,y)=>(x+y)*8,setFollow:id=>calls.push(id),camera});
  vm.runInContext(`({${method}}).followSelected.call({cameras:{main:camera}})`,context);
  return {camera,calls};
}
test('camera follows resident ID zero using the rendered sprite position',()=>{
  const {camera,calls}=run(0);
  assert.equal(camera.scrollX,(200-50)/8);assert.equal(camera.scrollY,(300-50)/8);
  assert.deepEqual(calls,[]);
});
test('offscreen resident zero is followed from world coordinates; departed target clears selection',()=>{
  const {camera}=run(0,{sprite:false});
  assert.equal(camera.scrollX,(-160-50)/8);assert.equal(camera.scrollY,(240-50)/8);
  assert.deepEqual(run(0,{present:false}).calls,[null]);
});
test('no selected follow target leaves the camera unchanged',()=>{
  const {camera,calls}=run(null);assert.equal(camera.scrollX,0);assert.equal(camera.scrollY,0);assert.deepEqual(calls,[]);
});
