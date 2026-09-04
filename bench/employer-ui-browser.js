// Opt-in actual-browser smoke test, isolated port and generated disposable DB.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const dir=await mkdtemp(path.join(tmpdir(),'deepsims-employer-ui-'));
const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port=reservation.address().port;await new Promise(r=>reservation.close(r));
let server,browser;
try{
  server=spawn(process.execPath,['server/index.js'],{cwd:new URL('..',import.meta.url),
    env:{...process.env,PORT:String(port),DEEPSIMS_DB:path.join(dir,'test.db'),DEEPSIMS_SEED:'32'},
    stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(Error(`server timeout: ${output}`)),30000);
    server.stdout.on('data',b=>{output+=b;if(output.includes('따라잡기 완료')){clearTimeout(timer);resolve();}});
    server.stderr.on('data',b=>{output+=b;});
    server.once('exit',code=>{clearTimeout(timer);reject(Error(`server exit ${code}: ${output}`));});
  });
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  await page.addInitScript(()=>{
    const Native=window.WebSocket;
    window.WebSocket=class extends Native{constructor(...args){super(...args);
      this.addEventListener('message',event=>{
        const m=JSON.parse(event.data);
        for(const s of [...(m.sims??[]),...(m.statics??[])])if(s.employment)
          window.__employerTest={id:s.id,facilityId:s.employment.facilityId};
      });
    }};
  });
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'networkidle'});
  await page.locator('#ob-name').fill('고용 검증');await page.locator('#ob-submit').click();
  await page.locator('#onboard').waitFor({state:'hidden'});
  await page.waitForFunction(()=>window.__employerTest);
  const target=await page.evaluate(()=>window.__employerTest);
  await page.evaluate(id=>window.__select(id),target.id);
  await page.locator('#traits').filter({hasText:`(${target.facilityId})`}).waitFor();
  assert.match(await page.locator('#traits').innerText(),/근무지:/);
  await page.screenshot({path:'/tmp/deepsims-employer-ui.png'});
  await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__employerTest);
  await page.evaluate(id=>window.__select(id),target.id);
  await page.locator('#traits').filter({hasText:`(${target.facilityId})`}).waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pass:true,port,target,screenshot:'/tmp/deepsims-employer-ui.png'}));
}finally{
  await browser?.close();
  if(server&&server.exitCode===null){const exited=once(server,'exit');server.kill('SIGTERM');await exited;}
  await rm(dir,{recursive:true,force:true});
}
