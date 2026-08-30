// DeepSims 클라이언트 — Phaser 아이소메트릭 렌더 + WS 동기화 (PLAN §6).
// 이벤트 문장화는 클라이언트 몫 (구조화 payload → 한국어).
import Phaser from 'phaser';

const TW = 32, TH = 16; // 아이소 타일 (2:1)
const TILE_COLORS = { 0: 0x4a6b3a, 1: 0x6b6154, 2: 0x8a7a5c, 3: 0x5c4a3a, 4: 0x2f4a28, 5: 0x2a3d5c };
const FACILITY_COLORS = { house: 0xc4694a, office: 0x7a8ba8, cafe: 0x4aa87a, park: 0x3a8a4a };
const SIM_COLORS = [0xe8a94e, 0x7ab5e8, 0x8fd48a, 0xc79ae8, 0xe87a7a, 0xffd97a, 0x7ae8d4, 0xe87ab5, 0xa8e87a, 0xb59ae8];

let world = null;
let selectedSimId = null;
let simSprites = new Map();
let scene = null;
let lastSeq = -1;

// ---- 좌표 변환 ----
const isoX = (x, y) => (x - y) * (TW / 2);
const isoY = (x, y) => (x + y) * (TH / 2);

// ---- Phaser ----
class TownScene extends Phaser.Scene {
  preload() {
    // 도트 캐릭터 스프라이트 (Codex imagegen). 없으면 색 원 폴백.
    for (let i = 0; i < 10; i++) this.load.image(`sim${i}`, `./sprites/sim${i}.png`);
    this.load.image('player', './sprites/player.png');
    this.load.on('loaderror', () => { /* 폴백이 처리 */ });
  }

  create() {
    scene = this;
    this.cameras.main.setBackgroundColor('#14121a');
    this.mapLayer = this.add.graphics();
    const center = () => this.cameras.main.centerOn(isoX(24, 24), isoY(24, 24)); // = (0, 384)
    this.cameras.main.setZoom(0.85);
    center();
    this.scale.on('resize', center); // RESIZE 모드가 뷰포트를 갱신한 뒤 재센터
    this.input.on('wheel', (_p, _o, _dx, dy) => {
      const z = this.cameras.main.zoom * (dy > 0 ? 0.9 : 1.1);
      this.cameras.main.setZoom(Phaser.Math.Clamp(z, 0.5, 3));
    });
    this.input.on('pointermove', (p) => {
      if (!p.isDown) return;
      this.cameras.main.scrollX -= (p.x - p.prevPosition.x) / this.cameras.main.zoom;
      this.cameras.main.scrollY -= (p.y - p.prevPosition.y) / this.cameras.main.zoom;
    });
    // 심 선택: 씬 레벨에서 최근접 심 탐색 (작은 스프라이트 히트박스보다 견고)
    this.input.on('pointerup', (p) => {
      if (!world) return;
      if (Math.abs(p.x - p.downX) > 6 || Math.abs(p.y - p.downY) > 6) return; // 드래그는 무시
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      let best = null, bestD = 24 * 24;
      for (const sim of world.sims) {
        const dx = wp.x - isoX(sim.x, sim.y), dy = wp.y - (isoY(sim.x, sim.y) - 8);
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = sim; }
      }
      if (best) selectSim(best.id);
    });
    if (world) this.drawWorld();
  }

  drawTile(g, x, y, color, lift = 0) {
    const cx = isoX(x, y), cy = isoY(x, y) - lift;
    g.fillStyle(color, 1);
    g.beginPath();
    g.moveTo(cx, cy - TH / 2); g.lineTo(cx + TW / 2, cy); g.lineTo(cx, cy + TH / 2); g.lineTo(cx - TW / 2, cy);
    g.closePath(); g.fillPath();
    g.lineStyle(1, 0x14121a, 0.25); g.strokePath();
  }

  drawWorld() {
    const g = this.mapLayer; g.clear();
    const { map } = world;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y * map.w + x];
      const lift = (t === 3 || t === 4) ? 10 : 0; // 벽·나무는 살짝 올림
      this.drawTile(g, x, y, TILE_COLORS[t], lift);
    }
    for (const fac of map.facilities) {
      const label = { house: '집', office: '직장', cafe: '카페', park: '공원' }[fac.type];
      const tx = isoX(fac.x + fac.w / 2, fac.y), ty = isoY(fac.x + fac.w / 2, fac.y) - 24;
      this.add.text(tx, ty, label, { fontSize: '11px', color: '#ffd97a', stroke: '#14121a', strokeThickness: 3 }).setOrigin(0.5);
      g.fillStyle(FACILITY_COLORS[fac.type], 0.35);
      for (let j = fac.y; j < fac.y + fac.h; j++) for (let i = fac.x; i < fac.x + fac.w; i++) {
        if (map.tiles[j * map.w + i] === 3) this.drawTile(g, i, j, FACILITY_COLORS[fac.type], 10);
      }
    }
    this.syncSims();
  }

  syncSims() {
    for (const sim of world.sims) {
      let sp = simSprites.get(sim.id);
      const tx = isoX(sim.x, sim.y), ty = isoY(sim.x, sim.y) - 8;
      if (!sp) {
        const key = sim.isPlayer ? 'player' : `sim${sim.id}`;
        let body;
        if (this.textures.exists(key)) {
          body = this.add.image(0, -12, key);
          body.setScale(36 / body.height); // 표시 높이 ~36px로 정규화
        } else {
          body = this.add.circle(0, 0, 6, SIM_COLORS[sim.id % SIM_COLORS.length]).setStrokeStyle(1.5, 0x14121a);
        }
        const label = this.add.text(0, -28, sim.name, { fontSize: '10px', color: '#e8e2d8', stroke: '#14121a', strokeThickness: 3 }).setOrigin(0.5);
        const c = this.add.container(tx, ty, [body, label]);
        sp = c; simSprites.set(sim.id, sp);
      }
      this.tweens.add({ targets: sp, x: tx, y: ty, duration: 900, ease: 'Linear' });
      sp.setDepth(1000 + sim.x + sim.y);
    }
  }
}

new Phaser.Game({
  type: Phaser.CANVAS, // 임베디드 브라우저의 WebGL 프레임버퍼 이슈 회피
  parent: 'game',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: TownScene,
  banner: false,
});

// ---- UI ----
const $ = (id) => document.getElementById(id);

function fmtClock(tick) {
  const day = Math.floor(tick / 1440);
  const tod = tick % 1440;
  const hh = String(Math.floor(tod / 60)).padStart(2, '0');
  const mm = String(tod % 60).padStart(2, '0');
  return `Day ${day} ${hh}:${mm}`;
}

const ACTION_KO = { eat: '식사', sleep: '수면', work: '근무', socialize: '수다', play: '놀이', idle: '멍때리기' };
const OCC_KO = { office_worker: '회사원', barista: '바리스타', freelancer: '프리랜서', student: '학생', retired: '은퇴' };
const NEED_KO = { hunger: '배고픔', energy: '수면 욕구', social: '외로움', fun: '심심함', money: '돈 걱정' };
function simName(id) { return world?.sims.find((s) => s.id === id)?.name ?? `심${id}`; }

// 판단 사유 문장화 (PLAN §14.1)
function reasonText(r) {
  if (!r) return '';
  if (r.assigned) return ' (지시받음)';
  if (r.noCandidates) return ' (할 게 없음)';
  const parts = [];
  if (r.urgencyOverride) parts.push('위급!');
  if (r.need) parts.push(`${NEED_KO[r.need] ?? r.need} ${Math.round((r.deficit ?? 0) / 100)}%`);
  if (r.moodMod > 0) parts.push('기분 전환');
  if (r.persFactor > 120) parts.push('성향');
  if (r.memoryMod > 0) parts.push('좋은 기억');
  if (r.memoryMod < 0) parts.push('나쁜 기억에도 불구');
  if (r.stateMod > 0) parts.push('친구 있음');
  if (r.stateMod < 0) parts.push('라이벌 있음에도');
  if (r.habitMod > 0) parts.push('단골');
  if (r.partyPull) parts.push('모임 참석');
  if (r.planFactor > 100 && !r.partyPull) parts.push('일과');
  return parts.length ? ` (${parts.join('·')})` : '';
}

function eventText(e) {
  const n = simName(e.simId);
  switch (e.type) {
    case 'action_started': return e.payload.action === 'idle' ? null : `${n}: ${ACTION_KO[e.payload.action]} 시작${reasonText(e.payload.reason)}`;
    case 'action_completed': return `${n}: ${ACTION_KO[e.payload.action]} 완료`;
    case 'action_failed': return `${n}: 행동 실패 (${e.payload.reason})`;
    case 'money_changed': return `${n}: ${e.payload.delta > 0 ? '+' : ''}${e.payload.delta}원 (잔액 ${e.payload.balance})`;
    case 'starving': return `⚠️ ${n}이(가) 굶고 있습니다!`;
    case 'lonely': return `${n}이(가) 혼자 시간을 보냈습니다…`;
    case 'argument': return `💢 ${n}과(와) ${simName(e.payload.withSimId)}이(가) 말다툼했습니다`;
    case 'input_rejected': return `지시 거부됨 (${e.payload.reason})`;
    case 'player_created': return `🏠 ${e.payload.name}이(가) 마을에 이사 왔습니다! (${OCC_KO[e.payload.occupation]})`;
    case 'logic_changed': return `🔧 심들의 판단 로직이 갱신되었습니다 (${e.payload.hash})`;
    case 'token_created': {
      const place = e.payload.placeId === 'cafe' ? '카페' : '공원';
      return e.payload.announced
        ? `📣 ${n}이(가) ${place} 모임을 공지했습니다! (${fmtClock(e.payload.scheduledTick)})`
        : `📅 ${place}에서 모임 소문이 돌기 시작했습니다 (${fmtClock(e.payload.scheduledTick)})`;
    }
    case 'gathering': {
      const place = e.payload.placeId === 'cafe' ? '카페' : '공원';
      return `🎉 ${place} 모임에 ${e.payload.count}명이 모였습니다!`;
    }
    default: return null;
  }
}

function pushFeed(e) {
  const text = eventText(e);
  if (!text) return;
  // 이름 등 사용자 유래 문자열이 섞이므로 innerHTML 금지 — DOM 노드로 조립
  const div = document.createElement('div');
  div.className = 'ev' + (['starving', 'argument', 'lonely'].includes(e.type) ? ' warn' : '');
  const ts = document.createElement('span');
  ts.className = 't';
  ts.textContent = fmtClock(e.tick);
  div.append(ts, document.createTextNode(text));
  const feed = $('feed');
  feed.prepend(div);
  while (feed.children.length > 80) feed.lastChild.remove();
}

function selectSim(id) { selectedSimId = id; renderPanel(); }

function renderPanel() {
  const panel = $('simpanel');
  if (selectedSimId === null || !world) { panel.style.display = 'none'; return; }
  const sim = world.sims.find((s) => s.id === selectedSimId);
  panel.style.display = 'block';
  $('simname').textContent = sim.name;
  for (const k of ['hunger', 'energy', 'social', 'fun']) {
    $(`b-${k}`).style.width = `${sim.needs[k] / 100}%`;
  }
  $('b-mood').style.width = `${((sim.mood ?? 0) + 10000) / 200}%`;
  const tr = sim.traits;
  if (tr) {
    const mbti = (tr.mbti.EI < 50 ? 'E' : 'I') + (tr.mbti.SN < 50 ? 'S' : 'N')
      + (tr.mbti.TF < 50 ? 'T' : 'F') + (tr.mbti.JP < 50 ? 'J' : 'P');
    const g = { F: '여', M: '남', X: '-' }[tr.gender];
    $('traits').textContent = `${mbti} · ${tr.age}세 · ${g} · ${OCC_KO[tr.occupation]}${sim.isPlayer ? ' · ⭐나' : ''}`;
  }
  $('money').textContent = `💰 ${sim.money}원`;
  $('action').textContent = `현재: ${ACTION_KO[sim.state.action] ?? '대기'} ${sim.state.kind === 'walking' ? '(이동 중)' : ''}`;
}

$('assigns').addEventListener('click', async (ev) => {
  const a = ev.target.dataset?.a;
  if (!a || selectedSimId === null) return;
  const res = await fetch('/api/input', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientInputId: crypto.randomUUID(), command: 'assign', payload: { simId: selectedSimId, actionType: a } }),
  }).then((r) => r.json()); // 피드 반영은 서버 이벤트로만 (중복 방지)
});

// ---- 온보딩 (PLAN §13): 플레이어 심이 없으면 배경 입력 폼 ----
const MBTI_TYPES = ['ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP','ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ'];
{
  const sel = $('ob-mbti');
  for (const t of MBTI_TYPES) { const o = document.createElement('option'); o.value = t; o.textContent = t; sel.append(o); }
  sel.value = 'ENFP';
}

function maybeShowOnboarding() {
  const hasPlayer = world?.sims.some((s) => s.isPlayer);
  $('onboard').style.display = hasPlayer ? 'none' : 'flex';
  $('announce').style.display = hasPlayer ? 'flex' : 'none'; // 모임 공지는 플레이어가 있어야 (PLAN D7)
}

$('an-btn').addEventListener('click', async () => {
  await fetch('/api/input', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientInputId: crypto.randomUUID(), command: 'announce',
      payload: { placeId: $('an-place').value, hoursFromNow: Number($('an-hours').value) },
    }),
  });
});

$('ob-submit').addEventListener('click', async () => {
  const name = $('ob-name').value.trim();
  const age = Number($('ob-age').value);
  const type = $('ob-mbti').value;
  const axisVal = (letter, first) => (letter === first ? 25 : 75); // 글자 → 축 값 (완만한 극단)
  const payload = {
    name,
    gender: $('ob-gender').value,
    age,
    mbti: { EI: axisVal(type[0], 'E'), SN: axisVal(type[1], 'S'), TF: axisVal(type[2], 'T'), JP: axisVal(type[3], 'J') },
    occupation: $('ob-occ').value,
  };
  if (!name) { $('ob-error').textContent = '이름을 입력하세요'; return; }
  const res = await fetch('/api/input', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientInputId: crypto.randomUUID(), command: 'create_player', payload }),
  }).then((r) => r.json());
  if (res.error) { $('ob-error').textContent = res.error; return; }
  $('onboard').style.display = 'none'; // 생성 결과는 다음 tickBatch로 도착 (거부 시 피드에 표시)
});

// ---- 부재중 리포트 ----
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

async function showReport() {
  const cursor = Number(lsGet('deepsims.lastSeenTick') || 0);
  const rep = await fetch(`/api/report?cursor=${cursor}`).then((r) => r.json());
  lsSet('deepsims.lastSeenTick', String(rep.nextCursor));
  if (rep.toTick - rep.fromTick < 60) return; // 1게임시간 미만 공백은 생략
  const lines = []; // 문자열은 전부 textContent로 렌더 (이름 유래 XSS 방지)
  const hours = Math.floor((rep.toTick - rep.fromTick) / 60);
  lines.push(`당신이 없는 동안 게임 시간 ${Math.floor(hours / 24)}일 ${hours % 24}시간이 흘렀습니다.`);
  const count = (t) => rep.counts.find((c) => c.type === t)?.n ?? 0;
  lines.push(`완료된 행동 ${count('action_completed')}건, 말다툼 ${count('argument')}건, 굶주림 ${count('starving')}건.`);
  for (const m of rep.meals) lines.push(`· ${simName(m.sim_id)}: 식사 ${m.n}회`);
  for (const w of rep.works) lines.push(`· ${simName(w.sim_id)}: 근무 ${w.n}회`);
  for (const mo of rep.moneyBySim) lines.push(`· ${simName(mo.sim_id)}: 잔액 ${mo.delta > 0 ? '+' : ''}${mo.delta}원 변동`);
  if (rep.highlights.length) {
    lines.push('◆ 주요 사건');
    for (const h of rep.highlights.slice(0, 10)) {
      const t = eventText({ ...h, simId: h.sim_id });
      if (t) lines.push(`· ${fmtClock(h.tick)} ${t}`);
    }
  }
  if (rep.prunedAggregates?.length) {
    lines.push('◆ 오래된 기간 요약 (일 단위 집계)');
    const byDay = new Map();
    for (const a of rep.prunedAggregates) {
      const day = Math.floor(a.day_start_tick / 1440);
      byDay.set(day, (byDay.get(day) ?? 0) + a.count);
    }
    for (const [day, n] of [...byDay.entries()].sort((x, y) => x[0] - y[0])) {
      lines.push(`· Day ${day}: 사건 ${n}건`);
    }
  }
  const rc = $('report');
  rc.replaceChildren(...lines.map((l) => {
    const div = document.createElement('div');
    div.textContent = l;
    if (l.startsWith('◆')) div.style.fontWeight = 'bold';
    return div;
  }));
  $('modal').style.display = 'flex';
}

// ---- WebSocket ----
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  lastSeq = -1;

  ws.onmessage = (raw) => {
    const msg = JSON.parse(raw.data);
    if (msg.seq !== lastSeq + 1 && msg.type !== 'snapshot') {
      ws.send(JSON.stringify({ type: 'resync' })); // 갭 감지 (PLAN §5)
      lastSeq = msg.seq;
      return;
    }
    lastSeq = msg.seq;
    switch (msg.type) {
      case 'hello':
        $('status').textContent = '동기화 중…';
        break;
      case 'catchingUp':
        $('status').textContent = `세계 따라잡는 중… ${msg.progress.current}${msg.progress.target ? '/' + msg.progress.target : ''}`;
        break;
      case 'snapshot':
        world = msg.world;
        $('status').textContent = '● 라이브';
        $('clock').textContent = fmtClock(world.worldTick);
        if (scene) { simSprites.forEach((s) => s.destroy()); simSprites.clear(); scene.drawWorld(); }
        showReport();
        maybeShowOnboarding();
        renderPanel();
        break;
      case 'tickBatch':
        if (!world) return;
        world.worldTick = msg.toTick;
        world.sims = msg.sims;
        $('clock').textContent = fmtClock(world.worldTick);
        for (const e of msg.events) pushFeed(e);
        if (msg.events.some((e) => e.type === 'player_created')) maybeShowOnboarding();
        if (scene) scene.syncSims();
        renderPanel();
        lsSet('deepsims.lastSeenTick', String(world.worldTick));
        break;
    }
  };
  ws.onclose = () => {
    $('status').textContent = '연결 끊김 — 재접속 중…';
    setTimeout(connect, 2000);
  };
}
connect();
