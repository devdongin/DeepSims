// DeepSims 로컬 서버 (PLAN §5). 부팅: 락 → DB → 따라잡기 → 라이브.
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import { randomInt } from 'node:crypto'; // §22.7 첫 실행 시드 추첨 (시뮬 밖 — 결정성 무관)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Storage } from '../db/storage.js';
import { Engine, MAX_SPEED } from './engine.js';
import { PROTOCOL_VERSION } from '../sim/constants.js';
import { DEFAULT_LOGIC, validatePolicy } from '../sim/logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DEEPSIMS_DB || path.join(ROOT, 'deepsims.db');
// §22.7 시드 (사용자 지시: "모든 사용자가 최초에 프로젝트를 시작하면 같은 환경일테니 시드를 적용하자")
// 기본값이 고정이라 **누가 클론하든 똑같은 마을**이 나왔다 — 같은 지형, 같은 열 명, 같은 이름.
// 이제 첫 실행에서 시드를 무작위로 뽑아 **각자의 마을**이 생긴다.
// 시드는 세계 생성에만 쓰이고 DB에 박히므로, 한 번 만들어진 마을은 이후 실행에서 그대로다.
// 결정성은 그대로다 — 같은 시드 + 같은 입력 = 같은 세계라는 계약은 변하지 않는다.
// DEEPSIMS_SEED를 주면 그 값을 쓴다 (친구와 같은 마을을 만들거나, 버그를 재현할 때).
const SEED = process.env.DEEPSIMS_SEED
  ? Number(process.env.DEEPSIMS_SEED)
  : randomInt(1, 2 ** 31 - 1);
const LOCK_PATH = DB_PATH + '.lock.pid';

// 단일 인스턴스 락 (PLAN §4): O_EXCL 배타 생성으로 원자적 획득. 죽은 pid면 스테일 제거 후 1회 재시도.
function acquireLock(retry = true) {
  try {
    const fd = fs.openSync(LOCK_PATH, 'wx'); // 원자적 — 동시 기동 경합 방지
    fs.writeSync(fd, `${process.pid}\n${Date.now()}\n`);
    fs.closeSync(fd);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const pid = Number(fs.readFileSync(LOCK_PATH, 'utf8').split('\n')[0]);
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* dead */ }
    if (alive || !retry) {
      console.error(`다른 DeepSims 서버(pid ${pid})가 이미 실행 중입니다. 종료합니다.`);
      process.exit(1);
    }
    try { fs.unlinkSync(LOCK_PATH); } catch { /* 경합 시 다음 시도에서 판정 */ }
    return acquireLock(false);
  }
  const release = () => { try { fs.unlinkSync(LOCK_PATH); } catch { /* ignore */ } };
  process.on('exit', release);
  process.on('SIGINT', () => process.exit(0));
  process.on('exit', () => { try { engine.flushLive(); } catch { /* 이미 커밋됨 */ } });
  process.on('SIGTERM', () => process.exit(0));
}

acquireLock();
const storage = new Storage(DB_PATH);
const engine = new Engine(storage, { seed: SEED });

// 판단 로직 파일 (PLAN §14.1): 없으면 기본값 생성, 변경 감지 시 logic_update 입력으로 등록
const PARAMS_PATH = process.env.DEEPSIMS_LOGIC || path.join(ROOT, 'logic', 'params.json');
if (!fs.existsSync(PARAMS_PATH)) {
  fs.mkdirSync(path.dirname(PARAMS_PATH), { recursive: true });
  fs.writeFileSync(PARAMS_PATH, JSON.stringify(DEFAULT_LOGIC, null, 2) + '\n');
} else {
  // 구버전 로직 파일은 기존 수치를 보존한 채 새 섹션 기본값을 병합해 업그레이드 (PLAN §14.1 D2)
  try {
    const cur = JSON.parse(fs.readFileSync(PARAMS_PATH, 'utf8'));
    if ((cur.logicSchemaVersion ?? 1) < DEFAULT_LOGIC.logicSchemaVersion) {
      const { mergeLogicDefaults } = await import('../sim/logic.js');
      fs.writeFileSync(PARAMS_PATH, JSON.stringify(mergeLogicDefaults(cur), null, 2) + '\n');
      console.log('로직 파일을 logicSchemaVersion', DEFAULT_LOGIC.logicSchemaVersion, '으로 업그레이드했습니다');
    }
  } catch { /* 파싱 불가 파일은 reconcile이 ops_log에 기록 */ }
}
engine.reconcileLogic(PARAMS_PATH); // 부팅 정합 — 따라잡기 전에 등록 (따라잡기 전체가 새 로직)

let watchDebounce = null;
fs.watch(path.dirname(PARAMS_PATH), (_ev, file) => {
  if (file !== path.basename(PARAMS_PATH)) return;
  clearTimeout(watchDebounce);
  watchDebounce = setTimeout(() => {
    const r = engine.reconcileLogic(PARAMS_PATH);
    if (r.registered) console.log(`로직 갱신 감지 → rev ${r.revision} (${r.hash}) 다음 틱부터 적용`);
    else if (r.reason === 'invalid') console.warn('로직 파일 검증 실패:', r.errors?.slice(0, 3));
  }, 500);
});

const app = express();
app.use(express.json({ limit: '12mb' })); // §22.3 화면 캡처(data URL) 수용

const DIST = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(DIST)) app.use(express.static(DIST));
else app.get('/', (_req, res) => res.status(503).send('클라이언트가 빌드되지 않았습니다: npm run build 를 먼저 실행하세요.'));

app.get('/api/report', (req, res) => {
  const cursor = Math.max(0, Number(req.query.cursor || 0));
  // §17.8: 리포트는 커밋된 틱까지만 — 30틱 캐던스의 미커밋 상태를 노출하지 않는다
  const committed = storage.getMetaInt('lastSimulatedTick', 0);
  res.json(storage.getReport(Math.min(cursor, committed), committed));
});

// §22.3 화면 캡처 — 사용자 지시: "브라우저에 띄워져 있을 게임 화면을 캡처해서 보여줘,
// 1시간마다 최소 한 번". 헤드리스 브라우저는 Phaser 캔버스를 그리지 못해서,
// **이미 렌더링 중인 페이지**가 자기 캔버스를 PNG로 올리는 경로를 둔다.
// 로컬 개발 도구다 — 시뮬 상태를 건드리지 않고 logs/screens/ 에만 쓴다.
app.post('/api/screenshot', (req, res) => {
  const dataUrl = req.body?.dataUrl;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    return res.status(400).json({ error: 'data:image/png;base64, 로 시작하는 dataUrl이 필요합니다' });
  }
  const b64 = dataUrl.slice('data:image/png;base64,'.length);
  if (b64.length > 12 * 1024 * 1024) return res.status(413).json({ error: '캡처가 너무 큽니다' });
  const dir = path.join(ROOT, 'logs', 'screens');
  fs.mkdirSync(dir, { recursive: true });
  const day = Math.floor(engine.world.worldTick / 1440);
  const file = path.join(dir, `world-day${String(day).padStart(5, '0')}.png`);
  try {
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  } catch (e) {
    return res.status(500).json({ error: String(e.message ?? e) });
  }
  res.json({ file, day, tick: engine.world.worldTick, pop: engine.world.sims.length });
});

// §20 배속: 서버 런타임 설정 (시뮬 상태 아님 — 입력 로그·세이브에 들어가지 않는다).
// 틱 내용은 불변이므로 결정성·리플레이에 영향 없음.
app.post('/api/speed', (req, res) => {
  const s = Number(req.body?.speed);
  if (!Number.isInteger(s) || s < 1 || s > MAX_SPEED) {
    return res.status(400).json({ error: `speed는 1~${MAX_SPEED} 정수여야 합니다` });
  }
  const applied = engine.setSpeed(s);
  for (const ws of clients) send(ws, { type: 'speed', speed: applied }); // 모든 뷰어에 즉시 반영
  res.json({ speed: applied });
});

app.post('/api/input', async (req, res) => {
  const { clientInputId, command, payload } = req.body ?? {};
  if (typeof clientInputId !== 'string' || clientInputId.length === 0 || clientInputId.length > 128
    || typeof command !== 'string'
    || payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: 'clientInputId(문자열), command(문자열), payload(객체)가 필요합니다' });
  }
  if (!['assign', 'create_player', 'announce', 'policy', 'zone'].includes(command)) {
    return res.status(400).json({ error: '허용되지 않은 명령입니다' }); // logic_update는 서버 내부 전용
  }
  if (command === 'assign'
    && (typeof payload.simId !== 'number' || typeof payload.actionType !== 'string')) {
    return res.status(400).json({ error: 'assign payload는 {simId: number, actionType: string} 형식입니다' });
  }
  if (command === 'policy') {
    const v = validatePolicy(payload); // §18.T1 화이트리스트·범위 (시뮬과 단일 권위 공유)
    if (!v.ok) return res.status(400).json({ error: `policy: ${v.error}` });
  }
  const result = await engine.submitInput({ clientInputId, command, payload });
  res.json(result); // insert 커밋 후에만 응답 (PLAN §3)
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Set();

function send(ws, msg) {
  if (ws.readyState !== ws.OPEN) return;
  ws.seq = (ws.seq ?? -1) + 1;
  ws.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, worldTick: engine.world.worldTick, seq: ws.seq, ...msg }));
}

function sendSnapshot(ws) {
  send(ws, { type: 'snapshot', world: {
    worldTick: engine.world.worldTick,
    map: engine.world.map,
    sims: engine.world.sims,
    affinity: engine.world.affinity,
    weather: engine.world.weather,
    lostItems: engine.world.lostItems,
    plots: engine.world.plots,
    projects: engine.world.projects,
    complaints: engine.world.complaints,
    speed: engine.speed ?? 1,
    partners: engine.world.partners,
    partnerStage: engine.world.partnerStage,
    mayorId: engine.world.mayorId,
    treasury: engine.world.treasury,
    incidents: engine.world.incidents,
    policy: engine.world.policy,
    zoneOrders: engine.world.zoneOrders,
    cityTier: engine.world.cityTier,
    statsHistory: engine.world.statsHistory,
    clubs: engine.world.clubs,
    campaigners: engine.world.campaigners,
    tokens: engine.world.tokens,
  } });
}

engine.onBatch((msg) => {
  for (const ws of clients) {
    if (msg.type === 'tickBatch') send(ws, { type: 'tickBatch', fromTick: msg.fromTick, toTick: msg.toTick, events: msg.events, sims: msg.sims, treasury: msg.treasury, incidents: msg.incidents, cityTier: msg.cityTier, projects: msg.projects, statsToday: msg.statsToday, speed: msg.speed });
    else send(ws, msg);
  }
});

wss.on('connection', async (ws) => {
  ws.seq = -1;
  ws.connectionId = crypto.randomUUID();
  clients.add(ws);

  // 핸들러는 첫 await 이전에 등록 — 따라잡기 대기 중 끊겨도 누수 없음
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'resync') sendSnapshot(ws); // 갭 감지 → 새 스냅샷 (PLAN §5)
  });
  ws.on('close', () => {
    clients.delete(ws);
    if (clients.size === 0) engine.stopLive(); // 마지막 퇴장: 루프 정지 (매 반복 커밋되어 있음)
  });

  send(ws, { type: 'hello', connectionId: ws.connectionId });

  // 0-클라이언트 상태에서의 접속 = 부팅과 동일 전이 (PLAN §5)
  if (engine.catchingUp) {
    send(ws, { type: 'catchingUp', progress: { current: engine.world.worldTick, target: null } });
    await engine.catchupPromise;
  } else {
    await engine.catchUp();
  }
  if (ws.readyState !== ws.OPEN) return; // 따라잡기 중 끊긴 연결
  sendSnapshot(ws);
  if (clients.size > 0) engine.startLive();
});

server.listen(PORT, async () => {
  console.log(`DeepSims 서버: http://localhost:${PORT} (db: ${DB_PATH}, tick: ${engine.world.worldTick})`);
  // §22.7 시드 안내 — 새 마을이면 크게, 이어가는 마을이면 한 줄로.
  if (engine.createdNow) {
    console.log(`\n  🌱 당신만의 마을이 생겼습니다 — 시드 ${engine.world.seed}`);
    console.log(`     같은 마을을 다시 만들려면: DEEPSIMS_SEED=${engine.world.seed} npm start\n`);
  } else {
    console.log(`  시드 ${engine.world.seed} (이어가는 중)`);
  }
  await engine.catchUp(); // 부팅 따라잡기
  engine.assertLogicSynced(PARAMS_PATH); // 부팅 정합 ⑤
  console.log(`따라잡기 완료: tick ${engine.world.worldTick}`);
});
