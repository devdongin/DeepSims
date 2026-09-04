// DeepSims 로컬 서버 (PLAN §5). 부팅: 락 → DB → 따라잡기 → 라이브.
import express from 'express';
import { villageSummary } from '../sim/villages.js';
import { publicBalance } from '../sim/government.js';
import { validateFoundingDecision } from '../sim/founding.js';
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
import { DEFAULT_LOGIC, POLICY_FIELDS } from '../sim/logic.js';
import { validatePolicyCommand } from '../sim/policy-command.js';
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

// §23.15 인간관계. 패널에는 #relations 자리가 처음부터 있었지만 **아무것도 쓰지 않았다** —
// 이 게임에서 사람들이 하는 일의 대부분이 관계인데 화면에는 그게 없었다.
// 호감도 행렬(world.affinity)과 티어(sim.relTiers)는 스냅샷에 안 실린다. 사람마다 인구 수만큼
// 있어서 다 보내면 투영이 세계만큼 커진다 — 그래서 고른 한 사람만 여기서 계산해 준다.
app.get('/api/relations', (req, res) => {
  const simId = Math.trunc(Number(req.query.sim));
  const w = engine.world;
  const sim = w.sims.find((s) => s.id === simId);
  if (!sim) { res.status(404).json({ error: 'no such sim' }); return; }
  const nameOf = (id) => {
    const o = w.sims.find((s) => s.id === id);
    return o ? `${o.surname ?? ''}${o.name}` : null;
  };
  const rows = [];
  for (const other of w.sims) {
    if (other.id === sim.id) continue;
    const aff = w.affinity[sim.id]?.[other.id] ?? 0;
    const met = w.interactions[sim.id]?.[other.id] ?? 0;
    const tier = sim.relTiers?.[other.id] ?? 'stranger';
    if (tier === 'stranger' && Math.abs(aff) < 500) continue; // 스쳐 간 사람은 빼고
    rows.push({ id: other.id, name: nameOf(other.id), aff, met, tier });
  }
  rows.sort((a, b) => (b.aff - a.aff) || (a.id - b.id));
  const partnerId = w.partners[sim.id];
  const parents = w.parents[sim.id] ?? [];
  const children = Object.entries(w.parents)
    .filter(([, ps]) => ps.includes(sim.id)).map(([cid]) => Number(cid));
  // §23.16 칭호. 이 사람이 **가장 자주 한 일**에서 나온다. 습관(sim.habit)은 회고가
  // 반복 행동을 눌러 담아 둔 값이라, 하루이틀 유행이 아니라 삶의 결이 드러난다.
  const HABIT_TITLE = {
    fish: '낚시광', read: '책벌레', exercise: '운동광', drink: '술꾼', cook_eat: '집밥파',
    socialize: '수다쟁이', play: '놀이꾼', work: '일벌레', shop: '장보기 담당',
    stroll: '산책가', garden: '텃밭지기', music: '악사', volunteer: '봉사왕', board_game: '보드게임광',
  };
  let title = null, bestHabit = 0;
  for (const [key, v] of Object.entries(sim.habit ?? {})) {
    const act = key.split(':')[0];
    if (!HABIT_TITLE[act]) continue;
    if (v > bestHabit) { bestHabit = v; title = HABIT_TITLE[act]; }
  }
  // §23.16 최근 기억 — "이 사람이 요즘 무엇을 겪었나". 중요도 높은 것부터 셋.
  // 기억 종류는 sim/logic.js의 memory.importance가 권위다. 여기 없는 종류가 오면
  // 영문 키가 그대로 화면에 찍히므로(실측: "child") 전부 적어 둔다.
  const MEM_KO = {
    meal: '밥을 먹었다', work_done: '일을 마쳤다', small_talk: '수다를 떨었다',
    play_time: '놀았다', drank: '한잔했다', binge: '폭식했다', hole_up: '틀어박혔다',
    workout: '운동했다', read_time: '책을 읽었다', shopping: '장을 봤다',
    home_meal: '집밥을 먹었다', fishing: '낚시했다', argument: '다퉜다',
    helped: '누군가를 도왔다', was_helped: '도움을 받았다', new_neighbor: '새 이웃을 만났다',
    unmet: '하려던 걸 못 했다', starving: '굶주렸다', lonely: '외로웠다',
    party_info: '모임 소식을 들었다', relationship_changed: '사이가 달라졌다',
    built_bed: '침대를 만들었다', found_item: '잃어버린 물건을 주웠다',
    construct_work: '공사를 거들었다', sick: '앓아누웠다', healed: '병이 나았다',
    love: '사랑에 빠졌다', wedding: '결혼했다', heartbreak: '이별했다',
    elected: '시장으로 뽑혔다', voted: '투표했다', child: '아이를 얻었다',
    club_joined: '모임에 들었다', heroic: '사람을 구했다', celebration: '축제를 즐겼다',
    milestone: '마을의 큰일을 겪었다', welfare: '나라의 도움을 받았다', governed: '마을을 이끌었다',
  };
  const memories = [...(sim.memories ?? [])]
    .sort((a, b) => (b.importance - a.importance) || (b.tick - a.tick))
    .slice(0, 3)
    .map((m) => ({
      day: Math.floor(m.tick / 1440),
      text: MEM_KO[m.kind] ?? m.kind,
      who: m.subjectSimId != null ? nameOf(m.subjectSimId) : null,
    }));
  res.json({
    simId,
    title,
    memories,
    partner: partnerId === undefined ? null
      : { id: partnerId, name: nameOf(partnerId), stage: w.partnerStage[sim.id] ?? null },
    parents: parents.map((id) => ({ id, name: nameOf(id) })).filter((x) => x.name),
    children: children.map((id) => ({ id, name: nameOf(id) })).filter((x) => x.name),
    friends: rows.filter((r) => r.tier === 'friend').slice(0, 6),
    rivals: rows.filter((r) => r.tier === 'rival').slice(-4).reverse(),
    acquaintances: rows.filter((r) => r.tier === 'acquaintance').length,
  });
});

// §23.1 일대기. sim=<id>면 그 사람의 일생, sim=-1(또는 생략)이면 마을 연대기.
// 이벤트 로그는 30일 뒤 접히지만 이 표는 남는다 — "이 사람이 어떻게 살았는가"는
// 지난 30일이 아니라 평생의 이야기다.
app.get('/api/chronicle', (req, res) => {
  const simId = Number.isFinite(Number(req.query.sim)) ? Math.trunc(Number(req.query.sim)) : -1;
  const rows = storage.getChronicle(simId, 120);
  const sim = simId >= 0 ? engine.world.sims.find((x) => x.id === simId) : null;
  res.json({
    simId,
    name: sim?.name ?? null,
    age: sim?.traits?.age ?? null,
    nowTick: engine.world.worldTick,
    rows,
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
  if (!['assign', 'create_player', 'announce', 'policy', 'zone', 'plan_center', 'found_village'].includes(command)) {
    return res.status(400).json({ error: '허용되지 않은 명령입니다' }); // logic_update는 서버 내부 전용
  }
  if (command === 'assign'
    && (typeof payload.simId !== 'number' || typeof payload.actionType !== 'string')) {
    return res.status(400).json({ error: 'assign payload는 {simId: number, actionType: string} 형식입니다' });
  }
  if (command === 'policy') {
    const v = validatePolicyCommand(engine.world,payload);
    if (!v.ok) return res.status(400).json({ error: `policy: ${v.error}` });
  }
  if(command==='found_village'){
    const v=validateFoundingDecision(payload);
    if(!v.ok)return res.status(400).json({error:`found_village: ${v.error}`});
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
    rail: engine.world.rail,
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
    publicTreasury: publicBalance(engine.world),
    incidents: engine.world.incidents,
    policy: engine.world.policy,
    policyDefaults:Object.fromEntries(Object.keys(POLICY_FIELDS).map(key=>[key,engine.world.logic.economy[key]])),
    zoneOrders: engine.world.zoneOrders,
    centers: engine.world.centers,
    plannedCenterCost: engine.world.logic.zone.plannedCenterCost,
    zoneCosts: engine.world.logic.zone.costs,
    cityTier: engine.world.cityTier,
    // §23.23 목표 화면이 지금 값을 읽어야 한다. 평판은 statsHistory에 하루 단위로만 있어
    // "지금 얼마인가"를 물으면 어제 값이 나온다 — 실측에서 목표가 0/500으로 보였다.
    reputation: engine.world.reputation,
    unlockedIndustries: engine.world.unlockedIndustries,
    statsHistory: engine.world.statsHistory,
    transportStats: { today: engine.world.transportStats.today, history: engine.world.transportStats.history },
    storyteller: engine.world.storyteller,
    foodSupply: engine.world.foodSupply,
    season: engine.world.season,
    villages: villageSummary(engine.world),
    founding: engine.world.founding,
    clubs: engine.world.clubs,
    campaigners: engine.world.campaigners,
    tokens: engine.world.tokens,
    transit: engine.world.transit ?? null, // §19.12 역 수요 관측·언락 (zone 메뉴 게이트)
    unlockedIndustries: engine.world.unlockedIndustries ?? [],
    householdDaily: engine.world.householdDaily ?? { day:-1, households:[], failures:{} },
    householdIntents: engine.world.householdIntents ?? [],
    housingMarket: engine.world.housingMarket ?? { day:-1, homes:[], facilityUse:{}, totals:{charged:0,paid:0,shortfall:0} },
  } });
}

engine.onBatch((msg) => {
  for (const ws of clients) {
    // #143 숨은 탭은 화면을 만들지 않는데도 250ms마다 전체 sims JSON을 받아 파싱했다.
    // 그 클라이언트만 전송을 쉬고, 보일 때 최신 스냅샷 하나로 따라잡는다. 엔진과 다른
    // 클라이언트는 계속 진행하며 send를 안 했으므로 해당 소켓의 seq에도 틈이 생기지 않는다.
    if (ws.clientHidden) continue;
    if (msg.type === 'tickBatch') send(ws, { type: 'tickBatch', fromTick: msg.fromTick, toTick: msg.toTick, events: msg.events, sims: msg.sims, treasury: msg.treasury, publicTreasury:msg.publicTreasury, villages:msg.villages, policyDefaults:msg.policyDefaults, incidents: msg.incidents, cityTier: msg.cityTier, projects: msg.projects, statsToday: msg.statsToday, speed: msg.speed, transit: msg.transit, rail:msg.rail, unlockedIndustries:msg.unlockedIndustries, housingMarket:msg.housingMarket, householdDaily:msg.householdDaily, plannedCenterCost: engine.world.logic.zone.plannedCenterCost, zoneCosts: engine.world.logic.zone.costs });
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
    else if (msg.type === 'visibility' && typeof msg.hidden === 'boolean') {
      const wasHidden = ws.clientHidden === true;
      ws.clientHidden = msg.hidden;
      send(ws, { type: 'visibility', hidden: ws.clientHidden });
      if (wasHidden && !ws.clientHidden) sendSnapshot(ws);
    }
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
