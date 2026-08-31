// DeepSims 클라이언트 — Phaser 아이소메트릭 렌더 + WS 동기화 (PLAN §6).
// 이벤트 문장화는 클라이언트 몫 (구조화 payload → 한국어).
import Phaser from 'phaser';

const TW = 32, TH = 16; // 아이소 타일 (2:1)
const TILE_COLORS = { 0: 0x4a6b3a, 1: 0x6b6154, 2: 0x8a7a5c, 3: 0x5c4a3a, 4: 0x2f4a28, 5: 0x2a3d5c };
const FACILITY_COLORS = { house: 0xc4694a, office: 0x7a8ba8, cafe: 0x4aa87a, park: 0x3a8a4a, bar: 0x8a5aa8, library: 0x5a7aa8, market: 0xa89a4a, pond: 0x4a8aa8, hospital: 0xd47a7a, city_hall: 0x8aa8d4, school: 0xd4b45a, restaurant: 0xd4885a, gym: 0x5ad4a8, cinema: 0x6a5ad4 };
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
// 에셋 목록 — Phaser 로더가 임베디드 환경에서 32개+ 동시 로드 시 멈추는 문제를 피해
// 브라우저 네이티브 Image로 직접 프리로드 후 textures.addImage로 주입한다.
const SPRITE_KEYS = [...Array.from({ length: 10 }, (_, i) => [`sim${i}`, `./sprites/sim${i}.png`]), ['player', './sprites/player.png']];
const PROP_KEYS = ['tree', 'bed', 'cafe_table', 'desk', 'bench', 'streetlamp', 'flowerbed', 'slide', 'fountain', 'bush', 'mailbox', 'cat', 'bar_counter', 'beer', 'dumbbell', 'bookshelf', 'market_stall', 'fishing_sign', 'coin', 'umbrella_stand', 'construction', 'plot_sign', 'hospital_cross', 'pill_bottle', 'ballot_box', 'flag_pole', 'wedding_arch', 'dog', 'school_desk', 'noticeboard', 'bus_stop', 'campaign_banner', 'restaurant_table', 'gym_rack', 'cinema_screen', 'popcorn', 'festival_lantern']
  .map((p) => [p, `./props/${p}.png`]);

function loadImagesNative() {
  const entries = [...SPRITE_KEYS, ...PROP_KEYS];
  return Promise.all(entries.map(([key, url]) => new Promise((res) => {
    const img = new Image();
    img.onload = () => res([key, img]);
    img.onerror = () => res([key, null]); // 실패 시 폴백(색 도형)
    img.src = url;
  })));
}

class TownScene extends Phaser.Scene {

  // 소품 배치 (Codex imagegen 에셋) — 시설 자원·맵 지형에서 위치 유도.
  // resync 재호출 시 중복 방지를 위해 기존 소품을 지우고 다시 그린다.
  drawProps() {
    if (this.propSprites) for (const p of this.propSprites) p.destroy();
    this.propSprites = [];
    const put = (key, x, y, h = 26, dy = -4) => {
      if (!this.textures.exists(key)) return;
      const img = this.add.image(isoX(x, y), isoY(x, y) + dy, key).setOrigin(0.5, 1);
      img.setScale(h / img.height);
      img.setDepth(1000 + x + y - 0.5); // 같은 타일의 심보다 살짝 뒤
      this.propSprites.push(img);
    };
    const { map } = world;
    // 나무 타일 → 나무 스프라이트
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (map.tiles[y * map.w + x] === 4) put('tree', x, y, 42, 4);
    }
    for (const fac of map.facilities) {
      if (fac.type === 'house') {
        for (const r of fac.resources) put('bed', r.x, r.y, 24);
        put('mailbox', fac.door.x + 1, fac.door.y + 1, 20);
      } else if (fac.type === 'cafe') {
        for (const r of fac.resources) put('cafe_table', r.x, r.y, 24);
      } else if (fac.type === 'office') {
        for (const r of fac.resources) put('desk', r.x, r.y, 24);
      } else if (fac.type === 'bar') {
        put('bar_counter', fac.x + 3, fac.y + 3, 30);
        for (const r of fac.resources) put('beer', r.x, r.y, 16);
      } else if (fac.type === 'library') {
        for (const r of fac.resources) put('bookshelf', r.x, r.y, 26);
        put('umbrella_stand', fac.door.x + 1, fac.door.y + 1, 20);
      } else if (fac.type === 'market') {
        for (const r of fac.resources) put('market_stall', r.x, r.y, 28);
      } else if (fac.type === 'pond') {
        put('fishing_sign', fac.door.x - 1, fac.door.y, 24);
      } else if (fac.type === 'hospital') {
        put('hospital_cross', fac.door.x + 1, fac.door.y - 1, 26);
        for (const r of fac.resources.filter((x) => x.kind === 'clinic')) put('pill_bottle', r.x, r.y, 16);
        for (const r of fac.resources.filter((x) => x.kind === 'slot')) put('desk', r.x, r.y, 22);
      } else if (fac.type === 'city_hall') {
        put('flag_pole', fac.door.x - 2, fac.door.y - 1, 36);
        put('ballot_box', fac.door.x + 2, fac.door.y + 1, 20);
        put('noticeboard', fac.x + 6, fac.y + 6, 24);
        for (const r of fac.resources) put('desk', r.x, r.y, 22);
      } else if (fac.type === 'school') {
        for (const r of fac.resources) put('school_desk', r.x, r.y, 22);
      } else if (fac.type === 'restaurant') {
        for (const r of fac.resources) put('restaurant_table', r.x, r.y, 24);
      } else if (fac.type === 'gym') {
        put('gym_rack', fac.x + 3, fac.y + 2, 24);
        for (const r of fac.resources) put('dumbbell', r.x, r.y, 16);
      } else if (fac.type === 'cinema') {
        put('cinema_screen', fac.x + 4, fac.y + 1, 30);
        put('popcorn', fac.door.x + 1, fac.door.y + 1, 16);
        for (const r of fac.resources) put('bench', r.x, r.y, 18);
      } else if (fac.type === 'park') {
        fac.resources.forEach((r, i) => {
          if (i < 4) put('bench', r.x, r.y, 22);
          else if (i === 8) put('slide', r.x, r.y, 30);
          else if (i === 12) put('dumbbell', r.x, r.y, 18);
        });
        put('fountain', fac.x + 8, fac.y + 5, 34);
        put('flowerbed', fac.x + 2, fac.y + 8, 18);
        put('flowerbed', fac.x + 13, fac.y + 2, 18);
      }
    }
    // §16.5: 공터 표지판·공사 현장
    for (const p of (world.plots ?? [])) {
      if (p.used) continue;
      if (world.project && world.project.plotId === p.plotId) {
        put('construction', p.x + 3, p.y + 2, 34);
      } else {
        put('plot_sign', p.x + 3, p.y + 2, 20);
      }
    }
    // 가로등: 도로 교차 지점, 덤불: 공터, 고양이: 카페 앞 단골
    for (const [lx, ly] of [[22, 9], [25, 22], [22, 40], [45, 24], [10, 22], [25, 38]]) put('streetlamp', lx, ly, 38, 2);
    for (const [bx, by] of [[8, 12], [16, 16], [40, 6], [6, 28], [44, 36], [18, 44]]) put('bush', bx, by, 18);
    put('cat', 16, 31, 14);
    put('bus_stop', 3, 22, 26); // §17.1 이민자가 내리는 곳
    if ((world.campaigners ?? []).length > 0) put('campaign_banner', 24, 21, 26); // 유세 중
    if ((world.tokens ?? []).some((tk) => tk.topic === 'festival')) {
      put('festival_lantern', 33, 11, 30);
      put('festival_lantern', 39, 11, 30);
    }
    put('dog', 27, 26, 15);
    put('wedding_arch', 36, 20, 30); // 공원 결혼식 자리
  }

  create() {
    scene = this;
    // 네이티브 프리로드 결과 주입 (게임 부팅과 병행 — 완료 시 재드로우)
    loadImagesNative().then((pairs) => {
      for (const [key, img] of pairs) {
        if (img && !this.textures.exists(key)) this.textures.addImage(key, img);
      }
      if (world) { simSprites.forEach((s) => s.destroy()); simSprites.clear(); this.drawWorld(); }
    });
    this.cameras.main.setBackgroundColor('#14121a');
    this.mapLayer = this.add.graphics();
    const center = () => this.cameras.main.centerOn(isoX(32, 32), isoY(32, 32)); // 구시가 중심 (128맵)
    this.cameras.main.setZoom(0.65);
    center();
    this.scale.on('resize', center); // RESIZE 모드가 뷰포트를 갱신한 뒤 재센터
    this.input.on('wheel', (_p, _o, _dx, dy) => {
      const z = this.cameras.main.zoom * (dy > 0 ? 0.9 : 1.1);
      this.cameras.main.setZoom(Phaser.Math.Clamp(z, 0.25, 3));
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
    const hasTreeSprite = this.textures.exists('tree');
    // §17.0: 지면은 거대 다각형 1개(잔디색) — 262k 타일 개별 렌더는 불가
    g.fillStyle(TILE_COLORS[0], 1);
    g.beginPath();
    g.moveTo(isoX(0, 0), isoY(0, 0) - 8);
    g.lineTo(isoX(map.w, 0), isoY(map.w, 0));
    g.lineTo(isoX(map.w, map.h), isoY(map.w, map.h) + 8);
    g.lineTo(isoX(0, map.h), isoY(0, map.h));
    g.closePath(); g.fillPath();
    // 비-GRASS 타일만 개별 렌더
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y * map.w + x];
      if (t === 0) continue;
      if (t === 4 && hasTreeSprite) continue; // 나무는 스프라이트로
      const lift = (t === 3 || t === 4) ? 10 : 0; // 벽·나무는 살짝 올림
      this.drawTile(g, x, y, TILE_COLORS[t], lift);
    }
    this.drawProps();
    for (const fac of map.facilities) {
      const label = { house: '집', office: '직장', cafe: '카페', park: '공원', bar: '술집', library: '도서관', market: '시장', pond: '낚시터', hospital: '병원', city_hall: '시청', school: '학교', restaurant: '식당', gym: '헬스장', cinema: '영화관' }[fac.type];
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

// ---- 동적 오브젝트: 분실 동전 (§16.C) ----
const itemSprites = new Map();
function syncItems() {
  if (!scene || !world?.lostItems) return;
  const alive = new Set(world.lostItems.map((it) => it.itemId));
  for (const [id, sp] of itemSprites) {
    if (!alive.has(id)) { sp.destroy(); itemSprites.delete(id); }
  }
  for (const it of world.lostItems) {
    if (itemSprites.has(it.itemId)) continue;
    if (!scene.textures.exists('coin')) continue;
    const img = scene.add.image(isoX(it.x, it.y), isoY(it.x, it.y) - 2, 'coin').setOrigin(0.5, 1);
    img.setScale(14 / img.height);
    img.setDepth(1000 + it.x + it.y - 0.6);
    scene.tweens.add({ targets: img, y: img.y - 3, duration: 600, yoyo: true, repeat: -1 });
    itemSprites.set(it.itemId, img);
  }
}

// ---- 날씨 시각화 (§16.D) ----
function updateStats() {
  const el = document.getElementById('stats');
  if (!el || !world) return;
  const couples = Object.keys(world.partners ?? {}).length / 2;
  const married = Object.values(world.partnerStage ?? {}).filter((s) => s === 'married').length / 2;
  const mayor = world.mayorId !== null && world.mayorId !== undefined ? simName(world.mayorId) : '없음';
  el.textContent = `👥${world.sims.length} 💑${Math.floor(couples)} 💍${Math.floor(married)} 👑${mayor}`;
}

function applyWeather() {
  const kind = world?.weather?.kind ?? 'sunny';
  const icon = { sunny: '☀️', cloudy: '☁️', rain: '🌧️' }[kind];
  const el = document.getElementById('weather');
  if (el) el.textContent = icon;
  const fx = document.getElementById('rainfx');
  if (fx) fx.style.display = kind === 'rain' ? 'block' : 'none';
  if (scene) scene.cameras.main.setBackgroundColor(kind === 'rain' ? '#0e1018' : kind === 'cloudy' ? '#121219' : '#14121a');
}

// ---- 말풍선·이모트 (D10: 기존 이벤트에서 파생되는 순수 시각 효과) ----
const bubbles = new Map(); // simId -> {container, timer}

function showBubble(simId, text, ms = 4000) {
  if (!scene) return;
  const sp = simSprites.get(simId);
  if (!sp) return;
  const old = bubbles.get(simId);
  if (old) { old.container.destroy(); clearTimeout(old.timer); }
  const label = scene.add.text(0, 0, text, {
    fontSize: '11px', color: '#14121a', backgroundColor: '#f5efdf',
    padding: { x: 6, y: 3 }, wordWrap: { width: 150 },
  }).setOrigin(0.5, 1);
  const c = scene.add.container(sp.x, sp.y - 34, [label]).setDepth(99999);
  const timer = setTimeout(() => { c.destroy(); bubbles.delete(simId); }, ms);
  bubbles.set(simId, { container: c, timer });
}

function showEmoteAt(x, y, text, ms = 3000) {
  if (!scene) return;
  const t = scene.add.text(x, y, text, { fontSize: '18px' }).setOrigin(0.5, 1).setDepth(99999);
  scene.tweens.add({ targets: t, y: y - 14, alpha: 0.2, duration: ms, onComplete: () => t.destroy() });
}

const PLACE_KO = { cafe: '카페', park: '공원', bar: '술집', office: '직장', library: '도서관', market: '시장', pond: '낚시터', hospital: '병원', city_hall: '시청', school: '학교', restaurant: '식당', gym: '헬스장', cinema: '영화관', site: '공사장' };
function placeKo(id) {
  if (!id) return '동네';
  if (id.startsWith('house')) return '집';
  return PLACE_KO[id] ?? id;
}

// 대화 문장 생성 — 구조화 payload(detail)의 실제 데이터로 구체적인 말을 만든다 (§16 강화).
// 변형 선택은 tick 기반(코스메틱): 같은 이벤트는 항상 같은 문장.
function pick(arr, t) { return arr[t % arr.length]; }

function conversationLine(e) {
  const t = e.tick;
  const d = e.payload.detail ?? {};
  const about = e.payload.aboutSimId !== null && e.payload.aboutSimId !== undefined
    ? simName(e.payload.aboutSimId) : null;
  switch (e.payload.topic) {
    case 'party_invite': {
      const when = d.scheduledTick ? fmtClock(d.scheduledTick) : '곧';
      return pick([
        `${when}에 ${placeKo(d.placeId)}에서 모인대! 같이 가자!`,
        `${placeKo(d.placeId)} 모임 얘기 들었어? ${when}이래. 올 거지?`,
      ], t);
    }
    case 'gossip': {
      if (d.sentiment > 0) {
        return pick([
          `${about}랑 요즘 진짜 친해졌어. 좋은 사람이야`,
          `${about} 알지? 어제도 같이 놀았는데 완전 잘 맞아`,
          `${about}${d.tier === 'friend' ? '는 진짜 베프야' : '이랑 요즘 자주 봐'}`,
        ], t);
      }
      return pick([
        `${about} 때문에 요즘 좀 스트레스야…`,
        `${about}랑 지난번에 좀 틀어졌거든… 어색해`,
        `${about} 걔는 왜 그러는지 모르겠어`,
      ], t);
    }
    case 'memory_share': {
      const place = placeKo(d.placeId);
      switch (d.kind) {
        case 'argument': return about ? `오늘 ${place}에서 ${about}랑 말다툼했어… 아직도 속상해` : `오늘 ${place}에서 크게 싸웠어…`;
        case 'fishing': return pick([`오늘 낚시터에서 손맛 좀 봤지~`, `아까 낚시하는데 월척인 줄 알았다니까`], t);
        case 'drank': return `어제 술집에서 좀 달렸더니 아직도 어질어질해`;
        case 'workout': return `오늘 공원에서 운동했는데 개운하다!`;
        case 'work_done': return pick([`오늘 일 진짜 많았어…`, `드디어 오늘치 일 끝냈다`], t);
        case 'meal': return `아까 ${place}에서 먹은 거 괜찮더라`;
        case 'home_meal': return `요즘 집밥 해먹는데 생각보다 할 만해`;
        case 'starving': return `오늘 하루종일 쫄쫄 굶었어… 죽는 줄`;
        case 'lonely': return `아까 ${place}에서 혼자 뻘쭘하게 있었잖아…`;
        case 'party_info': return `요즘 ${place} 모임 얘기가 돌던데?`;
        case 'found_item': return `오늘 길에서 돈 주웠다? 완전 럭키`;
        case 'built_bed': return `집에 침대 하나 새로 만들었어. 뿌듯해`;
        case 'relationship_changed': return about ? `${about}랑 요즘 사이가 달라진 것 같아` : `요즘 인간관계가 좀 변했어`;
        default: return `오늘 ${place}에서 별일이 다 있었어`;
      }
    }
    case 'work_gripe': {
      const occ = d.occupation;
      return pick({
        office_worker: ['회사 일이 끝이 없다 끝이 없어…', '오늘도 야근각이야', '월급날만 기다린다'],
        barista: ['오늘 카페 손님 미쳤었어…', '원두 냄새가 꿈에 나올 지경이야'],
        freelancer: ['일감이 들쭉날쭉해서 불안해', '마감이 코앞인데 잠이 온다'],
        student: ['과제가 산더미야…', '시험 기간 진짜 싫다'],
      }[occ] ?? ['일이 너무 많아…'], t);
    }
    case 'food': {
      return d.hungry
        ? pick(['배고파 죽겠어… 뭐라도 먹자', '아 오늘 제대로 못 먹었더니 어지러워'], t)
        : pick(['여기 커피 진짜 맛있지 않아?', '요즘 뭐 맛있는 거 먹었어?', '시장에서 장 봐다 해먹는 것도 좋더라'], t);
    }
    case 'sweet_talk': {
      return d.stage === 'married'
        ? pick(['오늘 저녁 같이 먹을까, 여보?', '요즘 당신 덕에 매일이 좋아', '주말에 공원 데이트 어때?'], t)
        : pick(['보고 싶었어!', '오늘따라 더 좋아 보인다?', '이따 낚시터에서 볼래?'], t);
    }
    case 'club_talk': {
      const cn = { book_club: '이번 책', fishing_club: '요즘 입질', fitness_club: '운동 루틴', drinking_pals: '오늘 한잔' }[d.clubId] ?? '모임';
      return pick([`${cn} 얘기 좀 하자`, `다음 모임 언제더라?`, `${cn} 어땠어?`], t);
    }
    case 'politics': {
      if (d.phase === 'campaign') {
        return pick([`이번 선거, ${about} 어때? 나쁘지 않던데`, `${about}이(가) 요즘 인사를 그렇게 하고 다닌대`, '이번엔 투표 꼭 하자'], t);
      }
      return pick([`${simName(d.mayorId)} 시장, 일 잘할까?`, '새 시장 됐다며? 공사가 빨라진대', '시장님 공약 기억하지?'], t);
    }
    case 'couple_news': {
      const other = simName(d.otherId);
      return d.kind === 'married'
        ? pick([`${about}랑 ${other} 결혼했대!! 대박`, `${about}네 결혼식 얘기 들었어?`], t)
        : pick([`${about}랑 ${other} 사귄대!`, `${about}이(가) 요즘 ${other}만 만난다?`], t);
    }
    case 'family_talk': {
      return d.relation === 'child'
        ? pick([`우리 ${about} 벌써 학교에 다녀. 시간 참 빠르지`, `${about}이(가) 요즘 낚시에 빠졌다니까`, `애 키우는 게 보통이 아니야`], t)
        : pick([`부모님이 어제 집밥 해주셨어`, `${about}이(가) 잔소리는 해도 고마운 분이지`], t);
    }
    case 'weather': {
      return pick({
        sunny: ['날씨 진짜 좋다~', '이런 날엔 공원이지', '햇살 봐, 나가길 잘했어'],
        cloudy: ['날이 꾸물꾸물하네', '흐린 날엔 괜히 기분도 가라앉아'],
        rain: ['비 오는 소리 좋다…', '우산 챙겨왔어? 밖에 비 많이 와', '이런 날엔 실내가 최고야'],
      }[d.kind ?? 'sunny'] ?? ['날씨가 애매하네'], t);
    }
    default: return '요즘 어떻게 지내?';
  }
}

// 청자 반응 — 화자에 대한 호감(listenerWarmth)과 주제로 온도를 정한다
function replyLine(e) {
  const t = e.tick;
  const warm = e.payload.listenerWarmth ?? 0;
  if (e.payload.topic === 'party_invite') return warm >= 0 ? pick(['갈래갈래!', '오 좋아, 시간 비워둘게'], t) : pick(['음… 생각해볼게', '가면 보고'], t);
  if (e.payload.topic === 'gossip') return warm >= 0 ? pick(['헐 진짜?', '그니까 말이야', '더 얘기해봐'], t) : pick(['글쎄…', '남 얘긴 그만하자'], t);
  if (warm > 0) return pick(['응응!', '완전 공감해', 'ㅋㅋㅋ 맞아'], t);
  if (warm < 0) return pick(['아 그래…', '흠…', '그렇구나'], t);
  return pick(['응응', '오 그래?', 'ㅋㅋ'], t);
}

function handleVisualEvent(e) {
  const sp = (id) => simSprites.get(id);
  switch (e.type) {
    case 'conversation': {
      const line = conversationLine(e);
      showBubble(e.simId, line, 4500);
      if (sp(e.payload.withSimId)) {
        setTimeout(() => showBubble(e.payload.withSimId, replyLine(e), 2800), 1600);
      }
      break;
    }
    case 'greeting':
      showBubble(e.simId, '👋', 2000);
      showBubble(e.payload.withSimId, '👋', 2000);
      break;
    case 'argument':
      showBubble(e.simId, '💢', 2500);
      showBubble(e.payload.withSimId, '💢', 2500);
      break;
    case 'lonely': showBubble(e.simId, '💧…', 2500); break;
    case 'hangover': showBubble(e.simId, '🥴', 2500); break;
    case 'bed_built': showBubble(e.simId, '🔨✨', 3000); break;
    case 'fell_sick': showBubble(e.simId, '🤒', 3000); break;
    case 'started_dating': showBubble(e.simId, '💕', 3500); showBubble(e.payload.withSimId, '💕', 3500); break;
    case 'married': showBubble(e.simId, '💒🎉', 4000); showBubble(e.payload.withSimId, '💒🎉', 4000); break;
    case 'broke_up': showBubble(e.simId, '💔', 3500); showBubble(e.payload.withSimId, '💔', 3500); break;
    case 'election': showBubble(e.simId, '🗳️👑', 4000); break;
    case 'festival': {
      const park = world?.map.facilities.find((f) => f.type === 'park');
      if (park) showEmoteAt(isoX(park.x + 8, park.y + 5), isoY(park.x + 8, park.y + 5) - 30, '🏮🎆', 5000);
      break;
    }
    case 'starving': showBubble(e.simId, '🍚…!', 3000); break;
    case 'gathering': {
      const fac = world?.map.facilities.find((f) => f.id === e.payload.placeId);
      if (fac && e.payload.count > 0) {
        showEmoteAt(isoX(fac.x + fac.w / 2, fac.y + fac.h / 2), isoY(fac.x + fac.w / 2, fac.y + fac.h / 2) - 20, `🎉×${e.payload.count}`);
      }
      break;
    }
  }
}

// ---- UI ----
const $ = (id) => document.getElementById(id);

function fmtClock(tick) {
  const day = Math.floor(tick / 1440);
  const tod = tick % 1440;
  const hh = String(Math.floor(tod / 60)).padStart(2, '0');
  const mm = String(tod % 60).padStart(2, '0');
  return `Day ${day} ${hh}:${mm}`;
}

const ACTION_KO = {
  eat: '식사', sleep: '수면', work: '근무', socialize: '수다', play: '놀이', idle: '멍때리기',
  drink: '술 한잔', binge_eat: '폭식', hole_up: '은둔', exercise: '운동', build: '침대 만들기',
  read: '독서', shop: '장보기', fish: '낚시', cook_eat: '집밥', construct: '공사 돕기', see_doctor: '병원 진료',
};
const BLOCK_KO = {
  no_money: '돈 부족', off_hours: '시간 아님', full: '자리 없음', sated: '필요 없음',
  not_coping: '멀쩡함', not_needed: '불필요',
};
const OCC_KO = { office_worker: '회사원', barista: '바리스타', freelancer: '프리랜서', student: '학생', retired: '은퇴' };
const NEED_KO = { hunger: '배고픔', energy: '수면 욕구', social: '외로움', fun: '심심함', money: '돈 걱정', mood: '울적함', space: '집이 좁음' };
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
  let out = parts.length ? ` (${parts.join('·')})` : '';
  // §15.1.C 사고 흐름: 막힌 대안 표시
  const blocked = (r.chain ?? []).filter((c) => ['no_money', 'off_hours', 'full'].includes(c.b));
  if (blocked.length) {
    out += ` [${blocked.slice(0, 2).map((c) => `${ACTION_KO[c.a]}✗${BLOCK_KO[c.b]}`).join(', ')}]`;
  }
  return out;
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
    case 'conversation': return `💬 ${n} → ${simName(e.payload.withSimId)}: "${conversationLine(e)}"`;
    case 'hangover': return `🥴 ${n}이(가) 과음했습니다… 내일이 걱정입니다`;
    case 'weather_changed': return { sunny: '☀️ 화창한 아침입니다', cloudy: '☁️ 날이 흐립니다', rain: '🌧️ 비가 내리기 시작했습니다' }[e.payload.kind];
    case 'item_spawned': return null; // 어디 떨어졌는지는 비밀 — 발견의 재미
    case 'item_found': return `✨ ${n}이(가) 길에서 ${e.payload.amount}원을 주웠습니다!`;
    case 'fish_caught': return `🎣 ${n}이(가) ${e.payload.amount}원짜리 물고기를 낚았습니다!`;
    case 'project_started': {
      const tp = { house: '새 집', cafe: '새 카페', park: '새 공원' }[e.payload.type];
      return `🏗️ 마을에 ${tp} 공사가 시작됐습니다! 심들이 힘을 보탭니다`;
    }
    case 'facility_built': {
      const tp = { house: '집', cafe: '카페', park: '공원' }[e.payload.type];
      return `🎊 ${tp}이(가) 완공됐습니다! 마을이 넓어졌어요`;
    }
    case 'moved_home': return `📦 ${n}이(가) 새 집으로 이사했습니다`;
    case 'child_settled': return `👶 ${simName(e.payload.parentA)}·${simName(e.payload.parentB)} 부부의 자녀 ${e.payload.name}이(가) 마을에서 자립을 시작했습니다!`;
    case 'immigrated': return `🚌 ${e.payload.name}이(가) 해솔마을로 이사 왔습니다! (${OCC_KO[e.payload.occupation] ?? e.payload.occupation})`;
    case 'fell_sick': return `🤒 ${n}이(가) 감기에 걸렸습니다`;
    case 'recovered': return e.payload.how === 'doctor' ? `💊 ${n}이(가) 진료를 받고 나았습니다` : `🌤️ ${n}이(가) 감기에서 회복했습니다`;
    case 'election': return `🗳️ 선거 결과 — ${n}이(가) 해솔마을 시장이 되었습니다! (득표 ${e.payload.votes.join(':')})`;
    case 'started_dating': return `💕 ${n}과(와) ${simName(e.payload.withSimId)}이(가) 사귀기 시작했습니다!`;
    case 'married': return `💒 ${n}과(와) ${simName(e.payload.withSimId)}이(가) 결혼했습니다! 🎉`;
    case 'broke_up': return `💔 ${n}과(와) ${simName(e.payload.withSimId)}이(가) 헤어졌습니다…`;
    case 'new_year': return `🎆 해솔마을의 새해가 밝았습니다! (${e.payload.year}년차)`;
    case 'festival': return `🏮 해솔마을 축제가 오늘 저녁 공원에서 열립니다! 모두 오세요!`;
    case 'graduated': return `🎓 ${n}이(가) 학교를 졸업하고 취직했습니다`;
    case 'retired_now': return `🌅 ${n}이(가) 은퇴했습니다. 수고하셨습니다`;
    case 'joined_club': {
      const cn = { book_club: '독서회', fishing_club: '낚시회', fitness_club: '운동모임', drinking_pals: '술벗' }[e.payload.clubId];
      return `🎪 ${n}이(가) ${cn}에 가입했습니다`;
    }
    case 'road_formed': return `🛤️ 많이 다니던 길이 도로가 되었습니다 (${e.payload.x}, ${e.payload.y})`;
    case 'bed_built': return `🛏️ ${n}이(가) 집에 침대를 새로 만들었습니다!`;
    case 'greeting': return `👋 ${n}과(와) ${simName(e.payload.withSimId)}이(가) 지나가며 인사했습니다`;
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
    let extra = '';
    const pid = world.partners?.[sim.id];
    if (pid !== undefined) extra += ` · ${world.partnerStage?.[sim.id] === 'married' ? '💍' : '💕'}${simName(pid)}`;
    if (world.mayorId === sim.id) extra += ' · 👑시장';
    if (sim.sick) extra += ' · 🤒';
    $('traits').textContent = `${mbti} · ${tr.age}세 · ${g} · ${OCC_KO[tr.occupation]}${sim.isPlayer ? ' · ⭐나' : ''}${extra}`;
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
let wsRef = null;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  wsRef = ws;
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
        syncItems();
        applyWeather();
        updateStats();
        break;
      case 'tickBatch':
        if (!world) return;
        world.worldTick = msg.toTick;
        world.sims = msg.sims;
        $('clock').textContent = fmtClock(world.worldTick);
        for (const e of msg.events) { pushFeed(e); handleVisualEvent(e); }
        // §15.1.B: 세계 변형 이벤트를 클라이언트 맵에 반영
        let mapDirty = false;
        for (const e of msg.events) {
          if (e.type === 'road_formed' && world) {
            world.map.tiles[e.payload.y * world.map.w + e.payload.x] = 1;
            mapDirty = true;
          } else if (e.type === 'bed_built' && world) {
            const fac = world.map.facilities.find((f) => f.id === e.payload.facilityId);
            if (fac && !fac.resources.some((r) => r.id === e.payload.resourceId)) {
              fac.resources.push({ id: e.payload.resourceId, kind: 'bed', x: e.payload.x, y: e.payload.y });
            }
            mapDirty = true;
          }
        }
        for (const e of msg.events) {
          if (e.type === 'item_spawned' && world) {
            world.lostItems = world.lostItems ?? [];
            world.lostItems.push({ itemId: e.payload.itemId, x: e.payload.x, y: e.payload.y });
          } else if (e.type === 'item_found' && world?.lostItems) {
            world.lostItems = world.lostItems.filter((it) => it.itemId !== e.payload.itemId);
          } else if (e.type === 'facility_built' || e.type === 'project_started') {
            wsRef?.send(JSON.stringify({ type: 'resync' })); // 맵 대변형 — 새 스냅샷으로 재동기화
          } else if (e.type === 'weather_changed' && world) {
            world.weather = { day: e.payload.day, kind: e.payload.kind };
            applyWeather();
          }
        }
        syncItems();
        if (mapDirty && scene) scene.drawWorld();
        if (msg.events.some((e) => e.type === 'player_created')) maybeShowOnboarding();
        if (msg.events.some((e) => ['immigrated', 'started_dating', 'married', 'broke_up', 'election'].includes(e.type))) {
          wsRef?.send(JSON.stringify({ type: 'resync' })); // 사회 상태(파트너·시장·인구) 갱신
        }
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
