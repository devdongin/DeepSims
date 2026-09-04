// Opt-in real-browser check. Set PLAYWRIGHT_MODULE to an installed index.mjs.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const dir=await mkdtemp(path.join(tmpdir(),'deepsims-world-ui-'));
const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port=reservation.address().port;await new Promise(r=>reservation.close(r));
let server,browser;
try{
  server=spawn(process.execPath,['server/index.js'],{
    cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),DEEPSIMS_DB:path.join(dir,'test.db'),DEEPSIMS_SEED:'32'},
    stdio:['ignore','pipe','pipe'],
  });
  await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(new Error(`server timeout: ${output}`)),20000);
    server.stdout.on('data',b=>{output+=b;if(output.includes('따라잡기 완료')){clearTimeout(timer);resolve();}});
    server.stderr.on('data',b=>{output+=b;});
    server.once('exit',code=>{clearTimeout(timer);reject(new Error(`server exit ${code}: ${output}`));});
  });
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'networkidle'});
  await page.locator('#ob-name').fill('검증 주민');
  await page.locator('#ob-submit').click();
  await page.locator('#onboard').waitFor({state:'hidden'});
  await page.locator('#world-events-btn').click();
  const dialog=page.locator('dialog'),status=dialog.locator('[role=status]');
  await dialog.locator('pre').filter({hasText:'적용 중인 사건 없음'}).waitFor();
  await dialog.locator('[name=effect]').selectOption('mood');
  await dialog.locator('[name=value]').fill('-1000');
  const sent=[];let drop=true;
  await page.route('**/api/input',async route=>{
    sent.push(route.request().postDataJSON());
    if(drop){drop=false;await route.fetch();await route.abort('failed');}
    else await route.continue();
  });
  await dialog.locator('button[type=submit]').click();
  await status.filter({hasText:'저장 여부를 확인하지 못했습니다'}).waitFor();
  assert.equal(await dialog.locator('[name=value]').isDisabled(),true);
  await dialog.locator('button[type=submit]').click();
  await status.filter({hasText:'입력이 저장됐습니다'}).waitFor();
  assert.equal(await dialog.locator('[name=value]').isEnabled(),true);
  assert.equal(sent.length,2);assert.deepEqual(sent[1],sent[0]);
  await dialog.locator('pre').filter({hasText:'기분 충격: -1000'}).waitFor();
  await page.screenshot({path:'/tmp/deepsims-world-event-ui.png'});
  await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);
  await page.reload({waitUntil:'networkidle'});
  await page.locator('#world-events-btn').click();
  await dialog.locator('pre').filter({hasText:'기분 충격: -1000'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: actual UI submit, saved-but-lost response retry, active projection, Escape and reconnect');
}finally{
  await browser?.close();
  if(server&&server.exitCode===null){const exited=once(server,'exit');server.kill('SIGTERM');await exited;}
  await rm(dir,{recursive:true,force:true});
}
