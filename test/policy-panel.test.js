// DOM event contract, not a browser rendering/screenshot test. Exercise the real
// panel initializer without loading Phaser or connecting to the user's server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
const start=source.indexOf('// ---- §18.T1 시정 운영 패널 ----');
const end=source.indexOf('// ---- 상단 미니 추이 그래프',start);
assert.ok(start>=0&&end>start,'policy panel initializer must be identifiable');

function panel(fetch){
  const nodes=new Map();
  const element=()=>({style:{display:'none'},disabled:false,value:'',textContent:'',children:[],listeners:{},
    addEventListener(type,fn){this.listeners[type]=fn;},append(child){this.children.push(child);},
    replaceChildren(){this.children=[];this.value='';},
    fire(type){if(type==='click'&&this.disabled)return;return this.listeners[type]?.();}});
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element};
  const world={treasury:500,policy:{taxPct:15},policyDefaults:{taxPct:12,welfareAmount:250,welfareThreshold:400,healthCopayPct:80,childAllowance:50},
    villages:[{id:'village:0',name:'해솔'},{id:'village:1',name:'새솔',government:{treasury:70,policy:{taxPct:25}}}]};
  const context=vm.createContext({document,world,updatePolicySummary:()=>{},fetch,setTimeout:()=>{}});
  vm.runInContext(source.slice(start,end),context);
  return {world,context,node:id=>document.getElementById(id)};
}

test('#32 policy panel selects actual municipal policy/defaults and refreshes balance without erasing edits',()=>{
  const {world,context,node}=panel(()=>assert.fail('opening a panel is read-only'));
  node('policy-btn').fire('click');
  assert.deepEqual(node('pol-village').children.map(c=>[c.value,c.textContent]),[['village:0','해솔'],['village:1','새솔']]);
  assert.equal(Number(node('pol-tax').value),15);
  node('pol-village').value='village:1';node('pol-village').fire('change');
  assert.equal(Number(node('pol-tax').value),25);assert.equal(Number(node('pol-amt').value),250);
  assert.match(node('pol-village-info').textContent,/새솔.*70원/);
  node('pol-tax').value='22';node('pol-tax').fire('input');
  world.villages[1].government.treasury=90;context.updatePolicySummary();
  assert.match(node('pol-village-info').textContent,/90원/);assert.equal(node('pol-tax').value,'22');
  assert.equal(world.villages[1].government.policy.taxPct,25,'editing is not an optimistic simulation mutation');
});

test('#32 policy panel submits one explicit target and stays disabled through close/reopen while pending',async()=>{
  let resolve,captured;
  const pending=new Promise(done=>{resolve=done;});
  const {node,world}=panel(async(url,options)=>{captured={url,...JSON.parse(options.body)};return pending;});
  node('policy-btn').fire('click');node('pol-village').value='village:1';node('pol-village').fire('change');
  node('pol-tax').value='20';
  const result=node('pol-apply').fire('click');
  assert.equal(node('pol-apply').disabled,true);assert.equal(node('pol-village').disabled,true);
  node('pol-close').fire('click');node('policy-btn').fire('click');
  assert.equal(node('pol-apply').disabled,true);
  assert.equal(captured.url,'/api/input');assert.equal(captured.command,'policy');
  assert.equal(captured.payload.villageId,'village:1');assert.equal(captured.payload.taxPct,20);
  assert.equal(world.policy.taxPct,15);assert.equal(world.villages[1].government.policy.taxPct,25);
  resolve({ok:true,json:async()=>({duplicate:false})});await result;
  assert.equal(node('pol-apply').disabled,false);assert.equal(node('pol-village').disabled,false);
  assert.match(node('pol-msg').textContent,/새솔 정책 입력이 저장/);
});

test('#32 a policy network failure is visible and does not mutate either municipality',async()=>{
  const {node,world}=panel(async()=>{throw new Error('offline');});
  node('policy-btn').fire('click');const before=JSON.stringify(world);
  await node('pol-apply').fire('click');
  assert.equal(JSON.stringify(world),before);assert.match(node('pol-msg').textContent,/응답을 받지 못/);
  assert.equal(node('pol-apply').disabled,false);assert.equal(node('policy-modal').style.display,'flex');
});

test('#32 a vanished selection disables policy submission without falling back to the original town',()=>{
  const {node,context,world}=panel(()=>assert.fail('invalid target cannot submit'));
  node('policy-btn').fire('click');node('pol-village').value='village:1';node('pol-village').fire('change');
  world.villages.pop();context.updatePolicySummary();
  assert.equal(node('pol-apply').disabled,true);assert.match(node('pol-village-info').textContent,/확인할 수 없습니다/);
  node('pol-apply').fire('click');assert.equal(world.policy.taxPct,15);
});
