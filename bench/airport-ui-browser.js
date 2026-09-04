// Opt-in real Chrome check. Controlled travel fixture, NOT proof of natural
// airport growth or paid construction. Never reads/writes the player's DB/port.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Storage} from '../db/storage.js';
import {tick} from '../sim/tick.js';
import {TILE,addBuilding} from '../sim/map.js';
import {emptyState} from '../sim/simfactory.js';
import {newGovernment} from '../sim/government.js';
import {commissionAirport} from '../sim/air-network.js';
import {TICK_DURATION_MS} from '../sim/time.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const dir=await mkdtemp(path.join(tmpdir(),'deepsims-airport-ui-'));
const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port=reservation.address().port;await new Promise(r=>reservation.close(r));
let server,browser;
try{
  const db=path.join(dir,'test.db'),storage=new Storage(db);
  try{
    const {world:w}=storage.loadOrCreate({seed:32,nowUtcMs:Date.now()});
    w.map={w:128,h:32,tiles:Array(4096).fill(TILE.GRASS),facilities:[],reachVersion:0};
    for(let y=0;y<32;y++)w.map.tiles[y*128+64]=TILE.WATER;
    w.villages[0].center={x:10,y:15};
    w.villages.push({id:'village:1',name:'바다 건너 마을',center:{x:110,y:15},government:newGovernment()});
    const home=addBuilding(w.map,'house',{x:0,y:10,villageId:'village:0'});
    addBuilding(w.map,'cafe',{x:112,y:10,villageId:'village:1'});
    w.worldTick=539;w.cityTier=3;w.lastDailyDay=0;w.lastPlanDay=0;w.projects=[];w.zoneOrders=[];
    w.plots=[{plotId:500,x:35,y:10,villageId:'village:0',used:false}];
    w.sims=w.sims.slice(0,2);
    for(const s of w.sims){s.homeId=home.id;s.villageId='village:0';Object.assign(s,home.door);
      s.traits.age=30;s.traits.occupation='jobless';s.education.course=null;s.education.completed=true;
      s.state=emptyState();s.money=10000;s.hasCar=true;s.isPlayer=s.id===0;
      s.needs={hunger:10000,energy:10000,social:10000,fun:10000};}
    for(const [i,x] of [[0,10],[1,90]]){
      const f=addBuilding(w.map,'airport',{x,y:0,villageId:`village:${i}`});
      commissionAirport(w.air,f,`browser-fixture:${i}`,539,{speed:1,dwellTicks:4,capacity:1});
    }
    tick(w,w.sims.map(s=>({sequence:s.id,command:'assign',payload:{simId:s.id,actionType:'eat'}})));
    for(let i=0;i<500&&!w.sims.some(s=>s.state.kind==='flying');i++)tick(w);
    assert.equal(w.sims.filter(s=>s.state.kind==='flying').length,1);
    assert.equal(w.sims.filter(s=>s.state.kind==='waiting_flight').length,1);
    const epoch=Date.now()-w.worldTick*TICK_DURATION_MS;
    storage.commitBatch({world:w,events:[],appliedInputIds:[],epochUtcMs:epoch});
    storage.setClock({epochUtcMs:epoch,speed:1});
  }finally{storage.close();}
  server=spawn(process.execPath,['server/index.js'],{cwd:new URL('..',import.meta.url),
    env:{...process.env,PORT:String(port),DEEPSIMS_DB:db,DEEPSIMS_SEED:'32'},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(Error(`server timeout: ${output}`)),20000);
    server.stdout.on('data',b=>{output+=b;if(output.includes('따라잡기 완료')){clearTimeout(timer);resolve();}});
    server.stderr.on('data',b=>{output+=b;});
    server.once('exit',code=>{clearTimeout(timer);reject(Error(`server exit ${code}: ${output}`));});
  });
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.setDefaultTimeout(10000);
  await page.addInitScript(()=>{
    window.__airSockets=[];window.__airSnapshots=0;const Native=window.WebSocket;
    window.WebSocket=class extends Native{constructor(...args){super(...args);window.__airSockets.push(this);
      this.addEventListener('message',e=>{const m=JSON.parse(e.data);
        if(m.type==='snapshot'){window.__airSnapshots++;window.__airFrame=m.world.air;}
        if(m.air){window.__airFrame=m.air;window.__airBatch=true;}
      });}};
  });
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'networkidle'});
  if(await page.locator('#guide-close').isVisible())await page.locator('#guide-close').click();
  if(await page.locator('#modal').isVisible())await page.locator('#modal button').click();
  await page.waitForFunction(()=>window.__game?.scene?.scenes?.[0]?.airMarkers?.size===1&&window.__airBatch);
  assert.equal(await page.evaluate(()=>window.__airFrame.links[0].aircraft.passengers),1);
  assert.equal(await page.evaluate(()=>window.__airFrame.links[0].waiting),1);
  assert.deepEqual(await page.evaluate(()=>{
    const scene=window.__game.scene.scenes[0];
    const count=()=>scene.propSprites.filter(p=>p.getData?.('airportPart')==='runway').length;
    const before=count();scene.drawWorld();return {before,after:count()};
  }),{before:2,after:2},'real airport geometry redraw must not duplicate retained graphics');
  await page.evaluate(()=>window.__select(0));await page.locator('#action').filter({hasText:'항공기 탑승 중'}).waitFor();
  await page.evaluate(()=>window.__select(1));await page.locator('#action').filter({hasText:'공항 게이트 대기'}).waitFor();
  await page.locator('#planning-btn').click();await page.locator('[data-zt=airport]').click();
  await page.locator('#zone-info').filter({hasText:'공항 또는 공항 공사 있음'}).waitFor();
  assert.equal(await page.locator('#zone-go').isDisabled(),true);
  await page.locator('#zone-close').click();
  await page.locator('#dash-btn').click();
  await page.locator('#dash-modal summary').filter({hasText:'경찰·소방 관측'}).click();
  await page.locator('#public-services').filter({hasText:'시설 신축 수요/필요 인원과 별개'}).waitFor();
  assert.ok((await page.locator('#public-services').innerText()).includes('주민·서비스·사유별 하루 1회'));
  await page.screenshot({path:'/tmp/deepsims-public-service-ui.png'});
  await page.setViewportSize({width:420,height:720});
  const dashboard=await page.locator('#dash-modal .box').boundingBox();
  assert.ok(dashboard.x>=0&&dashboard.x+dashboard.width<=420);
  assert.ok(dashboard.y>=0&&dashboard.y+dashboard.height<=720);
  await page.screenshot({path:'/tmp/deepsims-public-service-ui-narrow.png'});
  await page.locator('#dash-close').click();
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{
    const scene=window.__game.scene.scenes[0],marker=[...scene.airMarkers.values()][0];
    scene.cameras.main.centerOn(marker.x,marker.y);scene.cameras.main.setZoom(1);
  });
  await page.screenshot({path:'/tmp/deepsims-airport-ui.png'});
  const snapshots=await page.evaluate(()=>window.__airSnapshots);
  await page.evaluate(()=>window.__airSockets.at(-1).close());
  await page.waitForFunction(n=>window.__airSnapshots>n,snapshots);
  assert.equal(await page.evaluate(()=>window.__game.scene.scenes[0].airMarkers.size),1);
  assert.equal(await page.evaluate(()=>window.__game.scene.scenes[0].propSprites.filter(p=>p.getData?.('airportPart')==='terminal').length),2);
  assert.ok((await page.evaluate(()=>[...window.__game.scene.scenes[0].airMarkers.values()][0].text)).includes('게이트 대기'));
  await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__game?.scene?.scenes?.[0]?.airMarkers?.size===1);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pass:true,port,screenshot:'/tmp/deepsims-airport-ui.png',checks:'real snapshot/batch, aircraft and gate counts, resident states, construction gate, reconnect and reload'}));
}finally{
  await browser?.close();
  if(server&&server.exitCode===null){const exited=once(server,'exit');server.kill('SIGTERM');await exited;}
  await rm(dir,{recursive:true,force:true});
}
