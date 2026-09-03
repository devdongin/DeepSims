import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function setup(){
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{style:{},dataset:{},handlers:{},children:[],disabled:false,
      addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){this.children=[];},
      appendChild(child){this.children.push(child);},querySelectorAll(){return buttons;}});
    return elements.get(id);
  };
  const buttons=['house','apartment','university','train_station'].map(type=>{
    const b=element(type);b.dataset.zt=type;return b;
  });
  const world={cityTier:3,treasury:100000,villages:[{id:'village:0',name:'본마을'},
    {id:'village:1',name:'새마을',government:{cityTier:0,treasury:6000}}],
    plots:[{plotId:1,x:10,y:10},{plotId:2,x:80,y:80,villageId:'village:1'},
      {plotId:3,x:90,y:80,villageId:'village:1',foundingPetitionId:7},
      {plotId:4,x:100,y:80},{plotId:5,x:110,y:80}],
    projects:[{plotId:4}],zoneOrders:[{plotId:5}],centers:[],unlockedIndustries:[]};
  const window={},requests=[];
  const source=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  const start=source.indexOf('// ---- §18.T2 건설 지정 모달 ----');
  const end=source.indexOf('// ---- §18.T5 시정 대시보드 ----',start);
  vm.runInNewContext(source.slice(start,end),{world,window,
    document:{getElementById:element,createElement:()=>({})},
    crypto:{randomUUID:()=> 'fixture'},setTimeout:()=>{},
    fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({})};}});
  return {world,window,element,requests};
}
test('construction modal uses selected municipality tier and treasury, not primary values',()=>{
  const {world,window,element}=setup();window.openZoneModal(world.plots[1]);
  assert.match(element('zone-info').textContent,/새마을 · 국고 6000원/);
  element('university').handlers.click();assert.equal(element('zone-go').disabled,true);
  assert.equal(element('university').style.opacity,0.4);
  world.cityTier=0;world.villages[1].government.cityTier=3;
  element('university').handlers.click();assert.equal(element('zone-go').disabled,false);
  window.openZoneModal(world.plots[0]);element('university').handlers.click();
  assert.equal(element('zone-go').disabled,true);
});
test('center command is charged to selected plot municipality, and reserved plots are omitted',async()=>{
  const {world,window,element,requests}=setup();window.openZoneModal(world.plots[1]);
  assert.deepEqual(element('zone-plot').children.map(p=>p.value),['1','2']);
  await element('zone-center').handlers.click();
  assert.deepEqual(requests[0].payload,{x:80,y:80,villageId:'village:1'});
  window.openZoneModal(world.plots[0]);await element('zone-center').handlers.click();
  assert.equal(requests[1].payload.villageId,'village:0');
});
test('missing government and unavailable station cannot submit; zone payload remains plot-owned',async()=>{
  const {world,window,element,requests}=setup();world.plots[1].villageId='missing';
  window.openZoneModal(world.plots[1]);
  await element('zone-center').handlers.click();await element('zone-go').handlers.click();
  assert.equal(requests.length,0);
  window.openZoneModal(world.plots[0]);element('train_station').handlers.click();
  await element('zone-go').handlers.click();assert.equal(requests.length,0);
  element('house').handlers.click();await element('zone-go').handlers.click();
  assert.deepEqual(requests[0].payload,{plotId:1,type:'house',dir:0});
});
