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
import { simsView } from './view.js'; // §22.8 전송용 투영
import { PROTOCOL_VERSION } from '../sim/constants.js';
import { DEFAULT_LOGIC, validatePolicy } from '../sim/logic.js';
import { industryStatus, purchasingPowerGap } from '../sim/industry.js';

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
function parseSeed(raw) {
  // §22.7 (97차 ③): Number()만 쓰면 NaN·소수·범위 밖 값이 그대로 통과해
  // makeRng가 조용히 이상한 스트림을 만든다. 유효하지 않으면 즉시 알리고 멈춘다.
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > 2 ** 31 - 1) {
    console.error(`DEEPSIMS_SEED가 올바르지 않습니다: ${JSON.stringify(raw)} — 1 ~ ${2 ** 31 - 1} 정수여야 합니다.`);
    process.exit(1);
  }
  return n;
}
const SEED = process.env.DEEPSIMS_SEED !== undefined
  ? parseSeed(process.env.DEEPSIMS_SEED)
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

// §22.12 손상 DB 안내 (QA #4). README는 "부팅 시 손상이 감지되면 서버가 **안내와 함께**
// 정지합니다"라고 약속하는데, 실제로는 raw 스택트레이스로 죽었다 — 잘린 파일은
// `SqliteError: database disk image is malformed`, 깨진 스냅샷은 `SyntaxError`.
// 마을을 잃은 사람에게 필요한 건 스택트레이스가 아니라 다음에 뭘 하면 되는지다.
let storage, engine;
try {
  storage = new Storage(DB_PATH);
  engine = new Engine(storage, { seed: SEED });
} catch (err) {
  console.error('');
  console.error('  ✖ 마을 데이터를 열 수 없습니다.');
  console.error(`     파일: ${DB_PATH}`);
  console.error(`     원인: ${String(err?.message ?? err).split('\n')[0]}`);
  console.error('');
  console.error('     복구를 시도하려면 README의 "손상 복구" 절을 따르세요 (snapshot id=2 되돌리기).');
  console.error('     이 마을을 포기하고 새로 시작하려면 위 파일을 지운 뒤 다시 실행하세요.');
  console.error('     같은 마을을 다시 만들고 싶다면 시드를 알고 있어야 합니다:');
  console.error('       DEEPSIMS_SEED=<시드> npm start');
  console.error('');
  process.exit(1);
}

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
// 부팅 정합 — 따라잡기 전에 등록 (따라잡기 전체가 새 로직).
// §22.11: 예전에는 반환값을 버려서, 로직 파일이 깨져 있으면 콘솔이 **아무 말도 안 하고**
// ops_log에만 조용히 쌓였다. 그동안 핫스왑은 통째로 죽어 있고, 파일을 고쳐 본 사람은
// "아무 일도 안 일어나네" 하고 떠난다 — 가상 플레이어가 실제로 밟은 경로다.
const bootLogic = engine.reconcileLogic(PARAMS_PATH);
if (bootLogic.reason === 'invalid' || bootLogic.reason === 'unreadable') {
  console.warn('');
  console.warn('  ⚠️  로직 파일을 읽을 수 없어 핫스왑이 꺼진 상태로 시작합니다');
  console.warn(`     파일: ${PARAMS_PATH}`);
  if (bootLogic.errors?.length) for (const e of bootLogic.errors.slice(0, 5)) console.warn(`     · ${e}`);
  console.warn('     세계는 마지막으로 유효했던 로직으로 계속 돕니다. 파일을 고쳐 저장하면');
  console.warn('     다음 틱부터 반영됩니다 (기본값으로 되돌리려면 파일을 지우고 재시작).');
  console.warn('');
}

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
  // §22.12 NaN 커서가 SQL에 NULL로 바인딩돼 200 + **빈 리포트**가 나갔다 (QA #6).
  // "부재중 아무 일도 없었습니다"와 구분이 안 되는 침묵이라 400으로 끊는다.
  // (?cursor=1&cursor=2 처럼 배열로 오는 경우도 여기서 걸린다.)
  const rawCursor = req.query.cursor;
  const parsed = rawCursor === undefined ? 0 : Number(rawCursor);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return res.status(400).json({ error: 'cursor는 0 이상의 정수여야 합니다' });
  }
  const cursor = parsed;
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
// §22.18 산업 현황 — 21개 대분류가 지금 이 마을에서 어떤 상태인지.
// 건물을 세우기 전에 **무엇이 없어서 아쉬운지**를 먼저 보여준다.
app.get('/api/industry', (_req, res) => {
  res.json({
    day: Math.floor(engine.world.worldTick / 1440),
    population: engine.world.sims.length,
    sections: industryStatus(engine.world),
    purchasingPowerGap: purchasingPowerGap(engine.world),
  });
});

app.post('/api/speed', (req, res) => {
  // §22.12 Number()는 [48]·"48"·" 48 "·true를 전부 삼킨다 (QA #5). 숫자만 받는다.
  const raw = req.body?.speed;
  const s = typeof raw === 'number' ? raw : NaN;
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
  if (!['assign', 'create_player', 'announce', 'policy', 'zone', 'plan_center'].includes(command)) {
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

// §22.12 오류 핸들러 (QA #7). 없으면 express 기본 핸들러가 절대경로가 박힌 10줄짜리
// 스택트레이스를 **HTTP 응답 본문으로** 내보낸다 — 잘못된 JSON 하나, 과대 바디 하나에.
// 클라이언트에는 짧은 JSON만 주고 상세는 서버 콘솔에만 남긴다.
app.use((err, _req, res, _next) => {
  const status = err?.status || err?.statusCode || 500;
  if (status >= 500) console.error('요청 처리 실패:', err);
  const msg = err?.type === 'entity.too.large' ? '요청 본문이 너무 큽니다'
    : status === 400 ? '요청 본문을 읽을 수 없습니다 (JSON 형식 확인)'
      : '요청을 처리하지 못했습니다';
  res.status(status).json({ error: msg });
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
    sims: simsView(engine.world.sims), // §22.8 화면이 쓰는 필드만
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
    centers: engine.world.centers,
    plannedCenterCost: engine.world.logic.zone.plannedCenterCost,
    cityTier: engine.world.cityTier,
    statsHistory: engine.world.statsHistory,
    clubs: engine.world.clubs,
    campaigners: engine.world.campaigners,
    tokens: engine.world.tokens,
    transit: engine.world.transit ?? null, // §19.12 역 수요 관측·언락 (zone 메뉴 게이트)
  } });
}

engine.onBatch((msg) => {
  for (const ws of clients) {
    if (msg.type === 'tickBatch') send(ws, { type: 'tickBatch', fromTick: msg.fromTick, toTick: msg.toTick, events: msg.events, sims: msg.sims, treasury: msg.treasury, incidents: msg.incidents, cityTier: msg.cityTier, projects: msg.projects, statsToday: msg.statsToday, speed: msg.speed, transit: msg.transit, plannedCenterCost: engine.world.logic.zone.plannedCenterCost }); // §19.12
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

// §22.12 바인딩 주소 (QA #8). 예전에는 host를 안 줘서 모든 인터페이스에 열렸다 —
// README는 "전부 로컬"이라고 하는데 실제로는 같은 Wi-Fi의 아무나 /api/input으로
// 세율·건설을 바꾸고 /api/screenshot으로 디스크에 파일을 쓸 수 있었다. 인증이 없으므로
// 기본은 루프백이고, LAN 공개는 **명시적으로 선택**해야 한다.
const HOST = process.env.DEEPSIMS_HOST || '127.0.0.1';
server.listen(PORT, HOST, async () => {
  console.log(`DeepSims 서버: http://localhost:${PORT} (db: ${DB_PATH}, tick: ${engine.world.worldTick})`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.warn(`  ⚠️  ${HOST} 로 열려 있습니다 — 인증이 없으므로 같은 망의 누구나 이 마을을 조작할 수 있습니다`);
  }
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
