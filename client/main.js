// DeepSims 클라이언트 — Phaser 아이소메트릭 렌더 + WS 동기화 (PLAN §6).
// 이벤트 문장화는 클라이언트 몫 (구조화 payload → 한국어).
import Phaser from 'phaser';
import {resetSimCache,mergeSimBatch} from './sim-stream.js';

const TW = 32, TH = 16; // 아이소 타일 (2:1)
const TILE_COLORS = { 0: 0x4a6b3a, 1: 0x6b6154, 2: 0x8a7a5c, 3: 0x5c4a3a, 4: 0x2f4a28, 5: 0x2a3d5c,
  6: 0x3a6b9a, 7: 0x7a6b4a, 8: 0xd4c48a, 9: 0x6b6b72, 10: 0x5a7a4a, 11: 0x8a6a4a }; // §19 R-A
const FACILITY_COLORS = { house: 0xc4694a, office: 0x7a8ba8, cafe: 0x4aa87a, park: 0x3a8a4a, bar: 0x8a5aa8, library: 0x5a7aa8, market: 0xa89a4a, pond: 0x4a8aa8, hospital: 0xd47a7a, city_hall: 0x8aa8d4, school: 0xd4b45a, restaurant: 0xd4885a, gym: 0x5ad4a8, cinema: 0x6a5ad4, police_station: 0x4a5ad4, fire_station: 0xd44a3a, apartment: 0xb08a5a, factory: 0x8a8a92, mall: 0xd49ad4, university: 0x5ab0d4 };
const SIM_COLORS = [0xe8a94e, 0x7ab5e8, 0x8fd48a, 0xc79ae8, 0xe87a7a, 0xffd97a, 0x7ae8d4, 0xe87ab5, 0xa8e87a, 0xb59ae8];
FACILITY_COLORS.train_station = 0x739da8; // Dedicated tile-render fallback until station art exists.

let world = null;
let updatePolicySummary=()=>{};
let selectedSimId = null;
let simSprites = new Map();
// §23.39 심의 **안 변하는 부분** (이름·성·특성·능력치·잠재치·학력). 배치는 변동분만
// 보내므로 여기 기억해 둔 것과 합쳐 쓴다. 서버가 달라진 사람만 statics로 다시 보낸다.
const simStatic = new Map();
let scene = null;
let lastSeq = -1;

// ---- 좌표 변환 ----
const isoX = (x, y) => (x - y) * (TW / 2);
const isoY = (x, y) => (x + y) * (TH / 2);

// ---- Phaser ----
// 에셋 목록 — Phaser 로더가 임베디드 환경에서 32개+ 동시 로드 시 멈추는 문제를 피해
// 브라우저 네이티브 Image로 직접 프리로드 후 textures.addImage로 주입한다.
const SPRITE_KEYS = [...Array.from({ length: 10 }, (_, i) => [`sim${i}`, `./sprites/sim${i}.png`]), ['player', './sprites/player.png']];
// §17.14 걷기 시트 (Codex imagegen → tools/slice-sheet.js): 원형 N종 × 4프레임.
// 존재하는 것만 로드 — 아직 생성 안 된 원형은 정적 sim 이미지로 폴백.
const WALK_ARCHETYPES = 16; // §22.5: 10 child · 11 chef · 12 clerk · 13 worker / §22.36: 14 노년여 · 15 여아
const WALK_KEYS = [];
for (let i = 0; i < WALK_ARCHETYPES; i++) for (let f = 0; f < 4; f++) {
  WALK_KEYS.push([`walk${i}_${f}`, `./sprites/walk${i}_${f}.png`]);
}
for (let f = 0; f < 4; f++) WALK_KEYS.push([`walkp_${f}`, `./sprites/walkp_${f}.png`]); // 플레이어
for (let i = 0; i < WALK_ARCHETYPES; i++) for (let f = 0; f < 4; f++) {
  WALK_KEYS.push([`walkup${i}_${f}`, `./sprites/walkup${i}_${f}.png`]);   // 후면 걷기
}
for (let f = 0; f < 4; f++) WALK_KEYS.push([`walkupp_${f}`, `./sprites/walkupp_${f}.png`]);
for (let i = 0; i < WALK_ARCHETYPES; i++) for (let f = 0; f < 4; f++) {
  WALK_KEYS.push([`pose${i}_${f}`, `./sprites/pose${i}_${f}.png`]);       // 서기↙·앉기↙·서기↖·앉기↖
}
for (let f = 0; f < 4; f++) WALK_KEYS.push([`posep_${f}`, `./sprites/posep_${f}.png`]);
const SIT_ACTIONS = ['eat', 'read', 'work', 'drink', 'cook_eat', 'see_doctor', 'binge_eat',
  'music', 'board_game']; // §23.8 연주·보드게임은 앉아서 한다 (산책·텃밭·봉사는 선 자세)
// 직업 → 스프라이트 원형 (제복 정합): 경찰은 경찰복, 의사·간호사는 가운, 소방관은 소방복
const ARCH_OF_OCCUPATION = {
  police: 7, firefighter: 8, doctor: 5, nurse: 5, teacher: 6, student: 3,
  retired: 4, barista: 2, office_worker: 1, civil_servant: 1, politician: 1, fisher: 9,
  // §22.5 새 직군 — 매핑이 없으면 id%10으로 떨어져 **아이가 어른 모습으로** 보였다.
  child: 10, chef: 11, clerk: 12, worker: 13,
};

// §22.36 **스프라이트가 실제로 무엇을 그리는지** (에셋 육안 확인).
// 이 표가 없어서 archOf가 직업만 보고 성별·나이를 무시했다 — 라이브 100명 중
// 30명이 반대 성별로, 8명이 다른 나이대로 그려지고 있었다(사용자 지적).
// 제복 스프라이트는 성별이 하나씩뿐이라(경찰·의사·간호사·교사·요리사는 여성만,
// 소방관·점원·노동자·바리스타는 남성만) 직업만 보면 반드시 절반이 어긋난다.
const ARCH_LOOK = {
  0: { g: 'F', band: 'adult' },   // 정장 블라우스 + 가방
  1: { g: 'M', band: 'adult' },   // 양복 + 백팩
  2: { g: 'M', band: 'adult' },   // 앞치마 (바리스타)
  3: { g: 'M', band: 'adult' },   // 재킷 차림
  4: { g: 'M', band: 'old' },     // **유일한 노인** — 백발·안경·지팡이
  5: { g: 'F', band: 'adult' },   // 흰 가운 + 청진기
  6: { g: 'F', band: 'adult' },   // 안경 + 서류 (교사)
  7: { g: 'F', band: 'adult' },   // 경찰 제복
  8: { g: 'M', band: 'adult' },   // 소방 방화복
  9: { g: 'M', band: 'adult' },   // 밀짚모자 + 멜빵
  10: { g: 'M', band: 'child' },  // **유일한 아이** — 남아
  11: { g: 'F', band: 'adult' },  // 조리모 (요리사)
  12: { g: 'M', band: 'adult' },  // 조끼 (점원)
  13: { g: 'M', band: 'adult' },  // 안전모 + 작업복
  14: { g: 'F', band: 'old' },   // §22.36 노년 여성 — walk0(성인 여성)을 노년화 (5차에 합격)
  15: { g: 'F', band: 'child' }, // §22.36 여아 — walk10(남아)을 픽셀 편집해 만든 것
};
// 제복이 없는 평상복 원형. 성별이 맞는 직업 스프라이트가 없을 때 여기로 떨어진다.
// **여성 평상복이 하나뿐**이라 제복 없는 여성이 다 같아 보인다 — 에셋 부족이고,
// 반대 성별로 그리는 것보다는 낫다는 판단이다 (§22.36).
const GENERIC_ARCH = { M: [1, 3], F: [0] };
// 이 세계의 성별은 셋이다: sim/traits.js의 GENDERS = ['F','M','X'], 각 1/3씩 균등.
// 라이브 104명 중 X가 28명이라 **X를 남성으로 몰면 그것대로 4분의 1이 어긋난다.**
// X는 '지정 없음'이고(정보판도 이미 '-'로 표시한다) 어떤 스프라이트와도 모순되지
// 않으므로, 제복도 평상복도 양쪽을 다 쓴다.
const GENERIC_ARCH_ANY = [...GENERIC_ARCH.M, ...GENERIC_ARCH.F];
// 나이대 경계는 시뮬의 상수를 따른다: child 직업은 age < 15, society.retireAge = 65.
const CHILD_MAX_AGE = 15;
const OLD_MIN_AGE = 65;
// 심 스프라이트 일괄 폐기 — stopTimer 콜백이 폐기된 body를 만지지 않도록 함께 정리 (Codex 37차)
function destroySimSprites() {
  simSprites.forEach((s) => {
    if (s.stopTimer) s.stopTimer.remove();
    // §22.10: Phaser 3의 destroy는 트윈을 죽이지 않고 Tween도 타깃 파괴를 듣지 않는다.
    // 남은 트윈이 파괴된 컨테이너를 계속 붙들어 GC를 막는다 — 이동 트윈은 매 배치 새로 붙으므로
    // 인구×배속에 비례해 쌓인다.
    if (scene) scene.tweens.killTweensOf(s);
    s.destroy();
  });
  simSprites.clear();
}

// §17.19 내부 모드: 열려 있는 시설 id — 건물 클릭으로 토글, 지붕이 걷히고 내부·심이 보인다
const interiorOpen = new Set();

// §22.36 스프라이트 고르기 — **나이대 → 성별 → 직업** 순서다.
//
// 예전에는 직업만 봤고 traits.gender·traits.age를 아예 읽지 않았다. 서버는 그 둘을
// 이미 보내주고 있었는데(server/view.js) 클라가 쓰지 않은 것이다. 결과:
//   · 남자 교사가 여자로, 여자 사무원이 남자로 — 100명 중 30명이 반대 성별
//   · 87세 프리랜서가 청년 모습으로 — 은퇴자만 노인으로 보였다
//   · freelancer는 ARCH_OF_OCCUPATION에 아예 없어 id%10으로 떨어졌다 → 성별 무작위
//
// 우선순위를 이렇게 둔 이유: 87세를 청년으로 그리는 어긋남이 제복을 잃는 것보다 크고,
// 성별이 틀린 것은 그보다도 더 크게 어긋난다. 제복은 마지막에 맞출 수 있으면 맞춘다.
function archOf(sim) {
  if (sim.isPlayer) return 'p';
  const tr = sim.traits ?? {};
  // 'X'(지정 없음)와 미상은 null로 둔다 — 남성으로 몰지 않는다.
  const g = (tr.gender === 'F' || tr.gender === 'M') ? tr.gender : null;
  const age = Number.isFinite(tr.age) ? tr.age : 30;

  // ① 나이대가 먼저다. 아이·노인 모두 여성 원형이 생겨 성별까지 맞출 수 있다
  //    (14 노년 여성 · 15 여아 — §22.36에서 다섯 번 만에 통과했다).
  if (age < CHILD_MAX_AGE) return g === 'F' ? 15 : 10;
  if (age >= OLD_MIN_AGE) return g === 'F' ? 14 : 4;

  // ② 직업 제복은 **성별이 어긋나지 않을 때만** 쓴다. X는 어긋날 것이 없으므로 다 쓴다.
  const occ = ARCH_OF_OCCUPATION[tr.occupation];
  const look = ARCH_LOOK[occ];
  if (look !== undefined && look.band === 'adult' && (g === null || look.g === g)) return occ;

  // ③ 평상복. id로 갈라 같은 성별끼리도 조금은 달라 보이게 한다.
  const pool = g === null ? GENERIC_ARCH_ANY : GENERIC_ARCH[g];
  return pool[sim.id % pool.length];
}
// §17.14 건물 스프라이트 (Codex imagegen — 존재하는 것만 로드, 없으면 타일 폴백)
const BLD_TYPES = ['apartment', 'factory', 'mall', 'university', 'house_a', 'house_b', 'house_c', 'cafe', 'office', 'hospital', 'city_hall', 'school',
  'restaurant', 'gym', 'cinema', 'bar', 'library', 'market', 'police', 'fire',
  'primary_school', 'middle_school', 'high_school', 'workshop', 'lab', 'warehouse'];
const BLD_KEYS = BLD_TYPES.map((t) => [`bld_${t}`, `./props/bld_${t}.png`]);
BLD_KEYS.push(['firework', './ui/fx_firework.png']); // §18.T4 승급 연출
for (const t of ['grass', 'pavement', 'road', 'river', 'river_bank', 'sand', 'mountain', 'hill', 'bridge', 'water_deep']) {
  BLD_KEYS.push([`tile_${t}`, `./props/tile_${t}.png`]); // 지형 (§UI, §19 R-A)
}
// §19 R-A: 타일 코드 → 텍스처 키 (스탬프 레이어가 사용)
const TILE_TEX = { 1: 'tile_road', 2: 'tile_pavement', 5: 'tile_water_deep', 6: 'tile_river',
  7: 'tile_river_bank', 8: 'tile_sand', 9: 'tile_mountain', 10: 'tile_hill', 11: 'tile_bridge', 12: 'tile_pavement' };
for (const t of ['house_a', 'cafe']) BLD_KEYS.push([`bld_${t}_night`, `./props/bld_${t}_night.png`]); // 야간 점등 변형
for (const t of ['house_a', 'cafe', 'office', 'primary_school', 'middle_school', 'high_school', 'workshop', 'lab', 'warehouse']) for (const d of [1, 2, 3]) {
  BLD_KEYS.push([`bld_${t}_d${d}`, `./props/bld_${t}_d${d}.png`]); // §18.T2 회전 외형
}
for (const t of ['apartment', 'factory', 'mall', 'university', 'house', 'cafe', 'office', 'hospital', 'city_hall', 'school', 'restaurant', 'gym',
  'cinema', 'bar', 'library', 'market', 'police', 'fire', 'primary_school', 'middle_school', 'high_school', 'workshop', 'lab', 'warehouse']) {
  BLD_KEYS.push([`bld_${t}_int`, `./props/bld_${t}_int.png`]); // §17.19 내부 컷어웨이
}
const BLD_OF_FACILITY = { apartment: 'bld_apartment', factory: 'bld_factory', mall: 'bld_mall', university: 'bld_university', workshop:'bld_workshop',lab:'bld_lab',warehouse:'bld_warehouse',
  cafe: 'bld_cafe', office: 'bld_office', hospital: 'bld_hospital',
  city_hall: 'bld_city_hall', school: 'bld_school',
  primary_school: 'bld_primary_school', middle_school: 'bld_middle_school', high_school: 'bld_high_school',
  restaurant: 'bld_restaurant', gym: 'bld_gym',
  cinema: 'bld_cinema', bar: 'bld_bar', library: 'bld_library', market: 'bld_market',
  police_station: 'bld_police', fire_station: 'bld_fire' };
const PROP_KEYS = ['tree', 'bed', 'cafe_table', 'desk', 'bench', 'streetlamp', 'flowerbed', 'slide', 'fountain', 'bush', 'mailbox', 'cat', 'bar_counter', 'beer', 'dumbbell', 'bookshelf', 'market_stall', 'fishing_sign', 'coin', 'umbrella_stand', 'construction', 'plot_sign', 'hospital_cross', 'pill_bottle', 'ballot_box', 'flag_pole', 'wedding_arch', 'dog', 'school_desk', 'noticeboard', 'bus_stop', 'campaign_banner', 'restaurant_table', 'gym_rack', 'cinema_screen', 'popcorn', 'festival_lantern', 'police_car', 'fire_truck', 'ambulance', 'well', 'jangdok', 'laundry', 'bicycle', 'cart', 'flower_bed2', 'fence_wood', 'lamp_stone', 'street_tree_lit', 'bench2',
  // §22.10: 'car'·'smoke'는 렌더 코드(main.js 차량 아이콘·굴뚝 연기)와 에셋이 둘 다 있는데
  // 이 목록에만 빠져 있었다 — 텍스처 주입점이 여기뿐이라 exists()가 영원히 false였고,
  // 두 기능이 조용히 죽어 있었다. 차 구매(society.js)·이동속도 2배(tick.js)는 계속 돌고 있었다.
  'car', 'smoke',
  // §22.63 정원 잔디 — 목업의 지면 문법은 "마을 전체가 석재 포장, 잔디는 정원·화단 구획 안에만".
  // 에셋 에이전트가 다섯 회차 연속 이 키를 요청했는데 **배선이 없어서** 만들어도 안 보였다.
  // 배선을 먼저 둔다: 파일이 아직 없으면 loadImagesNative가 null로 받고 exists()가 false라
  // 아래 drawGardens가 통째로 건너뛴다 — 즉 지금은 무해하고, PNG가 생기는 순간 살아난다.
  'tile_garden', 'wall_stone', 'hedge_low', 'flower_row', 'path_stone', 'garden_pot', 'tree_young']
  .map((p) => [p, `./props/${p}.png`]);

// §22.98 **브라우저 페이지 OOM 수리** (사용자 지적: "브라우저에서 페이지 OOM이 나오던거였음").
// 원인은 텍스처 총량이다. 원화를 그대로 GPU에 올리면 RGBA 4B/px로 **219MB**다
// (props 142장 138MB + sprites 215장 81MB). 그런데 화면이 쓰는 크기는 훨씬 작다 —
// 건물은 발자국 대각 폭 `(w+h)/2 × TW`라 7×5 건물이 192px, 소품은 h=16~42px다.
// 즉 1,580px짜리 원화를 192px로 줄여 그리면서 그 큰 텍스처를 계속 들고 있었다.
//
// 로드 시점에 **높이 384 상한**으로 한 번 줄여 올린다(219MB → 115MB). 표시 최대치의
// 1.5배가 남으므로 화면 품질은 그대로다. 픽셀아트라 보간을 끄고(nearest) 줄인다 —
// 켜면 §4에서 겪은 "축소하면 뭉개진다"가 로드 시점에 박제된다.
const TEXTURE_MAX_H = 384;
let texDownscaled = 0; let texPixelsSaved = 0;
function downscaleIfHuge(img) {
  if (!img || img.height <= TEXTURE_MAX_H) return img;
  const s = TEXTURE_MAX_H / img.height;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * s));
  c.height = TEXTURE_MAX_H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false; // 픽셀아트 — 뭉개지 않는다
  g.drawImage(img, 0, 0, c.width, c.height);
  texDownscaled++; texPixelsSaved += img.width * img.height - c.width * c.height;
  return c;
}

function loadImagesNative() {
  const entries = [...SPRITE_KEYS, ...WALK_KEYS, ...BLD_KEYS, ...PROP_KEYS];
  return Promise.all(entries.map(([key, url]) => new Promise((res) => {
    const img = new Image();
    img.onload = () => res([key, downscaleIfHuge(img)]);
    img.onerror = () => res([key, null]); // 실패 시 폴백(색 도형)
    img.src = url;
  })));
}

class TownScene extends Phaser.Scene {

  // 소품 배치 (Codex imagegen 에셋) — 시설 자원·맵 지형에서 위치 유도.
  // resync 재호출 시 중복 방지를 위해 기존 소품을 지우고 다시 그린다.
  // 시설 렌더 모드: 'ext' 외형 스프라이트 / 'int' 컷어웨이 / 'tile' 타일 폴백 (이슈 #15)
  computeFacModes() {
    this.facMode = new Map();
    let hi = 0;
    for (const fac of world.map.facilities) {
      if (!fac.w) continue;
      let ext = fac.type === 'house' ? `bld_house_${'abc'[hi++ % 3]}` : BLD_OF_FACILITY[fac.type];
      const intKey = fac.type === 'house' ? 'bld_house_int' : `${BLD_OF_FACILITY[fac.type]}_int`;
      if (interiorOpen.has(fac.id)) {
        this.facMode.set(fac.id, this.textures.exists(intKey) ? 'int' : 'tile');
      } else {
        this.facMode.set(fac.id, ext && this.textures.exists(ext) ? 'ext' : 'tile');
      }
    }
  }

  drawProps() {
    if (this.propSprites) for (const p of this.propSprites) p.destroy();
    this.propSprites = [];
    // 스프라이트/컷어웨이로 그려지는 발자국 안의 프롭은 생략 — 지붕·가구 이중 렌더 방지 (이슈 #15)
    const coveredBy = (x, y) => world.map.facilities.find((f) => f.w
      && x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h
      && this.facMode.get(f.id) !== 'tile' && f.type !== 'park' && f.type !== 'pond');
    const put = (key, x, y, h = 26, dy = -4) => {
      if (!this.textures.exists(key)) return;
      if (coveredBy(x, y)) return;
      const img = this.add.image(isoX(x, y), isoY(x, y) + dy, key).setOrigin(0.5, 1);
      img.setScale(h / img.height);
      img.setDepth(1000 + x + y - 0.5); // 같은 타일의 심보다 살짝 뒤
      this.propSprites.push(img);
    };
    const { map } = world;
    // 나무 타일 → 나무 스프라이트
    // §22.104 나무도 보이는 범위만 — 맵 전체를 훑으면 변두리 숲까지 스프라이트가 된다
    this.forEachVisibleTile(this.visibleUV(48), (x, y, i) => {
      if (map.tiles[i] === 4) put('tree', x, y, 42, 4);
    });
    for (const fac of map.facilities) {
      if (fac.type === 'house') {
        for (const r of fac.resources) put('bed', r.x, r.y, 24);
        put('mailbox', fac.door.x + 1, fac.door.y + 1, 20);
        // §17.21 마당 장식 — 좌표 기반 결정적 변형 (배치 5)
        const yard = (fac.x * 7 + fac.y * 13) % 3;
        if (yard === 0) put('jangdok', fac.x + fac.w, fac.y + 1, 18);
        else if (yard === 1) put('laundry', fac.x + fac.w, fac.y + 2, 22);
        else put('bicycle', fac.x - 1, fac.y + 3, 16);
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
        put('cart', fac.door.x - 2, fac.door.y - 1, 20);
        for (const r of fac.resources) put('market_stall', r.x, r.y, 28);
      } else if (fac.type === 'pond') {
        put('fishing_sign', fac.door.x - 1, fac.door.y, 24);
      } else if (fac.type === 'hospital') {
        put('hospital_cross', fac.door.x + 1, fac.door.y - 1, 26);
        put('ambulance', fac.door.x - 2, fac.door.y - 1, 34); // §17.19 차량
        for (const r of fac.resources.filter((x) => x.kind === 'clinic')) put('pill_bottle', r.x, r.y, 16);
        for (const r of fac.resources.filter((x) => x.kind === 'slot')) put('desk', r.x, r.y, 22);
      } else if (fac.type === 'city_hall') {
        put('flag_pole', fac.door.x - 2, fac.door.y - 1, 36);
        put('ballot_box', fac.door.x + 2, fac.door.y + 1, 20);
        put('noticeboard', fac.x + 6, fac.y + 6, 24);
        for (const r of fac.resources) put('desk', r.x, r.y, 22);
      } else if (fac.type === 'police_station') {
        put('police_car', fac.door.x - 2, fac.door.y - 1, 34); // §17.19 차량
        for (const r of fac.resources) put('desk', r.x, r.y, 22);
      } else if (fac.type === 'fire_station') {
        put('fire_truck', fac.door.x - 2, fac.door.y - 1, 38); // §17.19 차량
        for (const r of fac.resources) put('desk', r.x, r.y, 22);
      } else if (fac.type === 'factory') {
        put('smoke', fac.x + 1, fac.y - 1, 30); // §18.T3 굴뚝 연기
        for (const r of fac.resources) put('desk', r.x, r.y, 20);
      } else if (fac.type === 'apartment') {
        for (const r of fac.resources) put('bed', r.x, r.y, 22);
        put('mailbox', fac.door.x + 1, fac.door.y + 1, 20);
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
          // §22.30 벤치 두 종류를 번갈아 — bench2는 로드만 되고 한 번도 안 그려지던 프롭이다.
          if (i < 4) put(i % 2 ? 'bench2' : 'bench', r.x, r.y, 22);
          else if (i === 8) put('slide', r.x, r.y, 30);
          else if (i === 12) put('dumbbell', r.x, r.y, 18);
        });
        // §22.30 낮은 나무 울타리 — 목업의 "구획 경계는 낮은 석벽·나무 울타리" 문법.
        // Codex 배선 요청("fence_wood를 공원·화단 경계에 배치 필요")을 받은 자리다.
        // 울타리 한 칸은 +x 축으로 2타일을 덮는다(32×24 원화를 h=24로 놓으면 폭 32px
        // = 2칸의 수평 거리 2×TW/2). 그래서 2칸 간격으로 이어 붙인다.
        // **공원 크기에 상대적으로** 놓는다 — 이 마을의 공원은 16×10짜리 하나와
        // 7×5짜리 열 개가 섞여 있어서, 아래 분수·화단처럼 좌표를 박아 두면
        // 작은 공원에서는 경계 밖으로 밀려난다.
        //
        // 2타일이 **온전히 들어갈 때만** 놓는다. 그냥 fx < x+w 로 돌면 폭이 홀수인
        // 7×5 공원에서 마지막 울타리가 경계를 한 칸 넘어 이웃 도로를 가로막는다
        // (Codex 리뷰 NO-GO 지적).
        // §22.65 목업의 경계는 "낮은 석벽·나무 울타리" **둘 다**다. Codex가 wall_stone(32×24,
        // fence_wood와 같은 규격)을 만들며 혼합 배치를 요청했다. 무작위가 아니라 위치로 정한다 —
        // 3칸마다 한 번 석벽. 같은 공원은 늘 같은 무늬가 나오고, 리플레이·리싱크에도 안 흔들린다.
        // §22.70 조경 3종을 돌린다 — 석벽·관목·나무 울타리. 목업의 경계는 한 재질이 아니라
        // 섞여 있다. 무작위가 아니라 위치로 정해 같은 공원은 늘 같은 무늬가 나온다.
        const EDGE_CYCLE = ['wall_stone', 'hedge_low', 'fence_wood'];
        const edgeKey = (fx, fy) => EDGE_CYCLE[Math.abs((fx - fac.x) / 2 + fy) % EDGE_CYCLE.length];
        const fenceRow = (fy) => {
          for (let fx = fac.x; fx + 1 < fac.x + fac.w; fx += 2) put(edgeKey(fx, fy), fx, fy, 24, -2);
          // 폭이 홀수면 끝 한 칸이 빈다. 밖으로 내밀지 말고 안쪽에서 한 칸 겹쳐 채운다 —
          // 널빤지 울타리는 겹쳐도 자연스럽지만 삐져나가면 남의 길을 막는다.
          // w<3이면 2타일짜리가 아예 안 들어간다(넣으면 왼쪽으로 삐져나간다).
          if (fac.w % 2 && fac.w >= 3) put('fence_wood', fac.x + fac.w - 2, fy, 24, -2);
        };
        fenceRow(fac.y - 1);          // 뒤쪽(-y) 경계
        fenceRow(fac.y + fac.h);      // 앞쪽(+y) 경계
        put('fountain', fac.x + 8, fac.y + 5, 34);
        put('flowerbed', fac.x + 2, fac.y + 8, 18);
        put('flowerbed', fac.x + 13, fac.y + 2, 18);
        put('well', fac.x - 1, fac.y - 1, 24);          // 배치 5 장식
        put('lamp_stone', fac.x + fac.w, fac.y + fac.h, 16);
        put('flower_bed2', fac.x + 7, fac.y - 1, 16);
      }
    }
    // §16.5: 공터 표지판·공사 현장
    for (const p of (world.plots ?? [])) {
      if (p.used) continue;
      if ((world.projects ?? []).some((pr) => pr.plotId === p.plotId)) { // §19.3 다중 프로젝트
        put('construction', p.x + 3, p.y + 2, 34);
      } else {
        put('plot_sign', p.x + 3, p.y + 2, 20);
      }
    }
    // 가로등: 도로 교차 지점, 덤불: 공터, 고양이: 카페 앞 단골
    for (const [lx, ly] of [[22, 9], [25, 22], [22, 40], [45, 24], [10, 22], [25, 38]]) put('streetlamp', lx, ly, 38, 2);
    for (const [bx, by] of [[8, 12], [16, 16], [40, 6], [6, 28], [44, 36], [18, 44]]) put('bush', bx, by, 18);
    // §22.30 등불 달린 가로수 — 이것도 PROP_KEYS에만 있고 그려진 적이 없던 프롭이다.
    // 가로등과 같은 성격이라 같은 방식(중심가 고정 좌표)으로 둔다.
    for (const [tx, ty] of [[24, 15], [20, 27], [30, 33], [12, 19], [38, 28]]) put('street_tree_lit', tx, ty, 40, 2);
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
      if (texDownscaled > 0) {
        // §22.98 확인용 한 줄 — 몇 장을 줄여 몇 MB를 아꼈는지 콘솔에서 바로 읽힌다
        console.log(`[tex] ${texDownscaled}장 축소, GPU 텍스처 약 ${(texPixelsSaved * 4 / 1e6).toFixed(0)}MB 절약 (상한 h=${TEXTURE_MAX_H})`);
      }
      {
      }
      this.ensureTerrain();
      if (world) { simSprites.forEach((s) => s.destroy()); simSprites.clear(); this.drawWorld(); }
    });
    this.cameras.main.setBackgroundColor('#14121a');
    this.ensureTerrain();
    this.mapLayer = this.add.graphics();
    this.tileLayer = this.add.graphics(); // §22.104 컬링되는 바닥 타일 전용 (시설 폴백과 분리)
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
      // §23.18 손으로 화면을 옮기면 따라가기는 그만둔다. 안 그러면 카메라가 손과 싸운다.
      if (followSimId !== null) setFollow(null);
    });
    // 심 선택: 씬 레벨에서 최근접 심 탐색 (작은 스프라이트 히트박스보다 견고)
    this.input.on('pointerup', (p) => {
      if (!world) return;
      if (Math.abs(p.x - p.downX) > 6 || Math.abs(p.y - p.downY) > 6) return; // 드래그는 무시
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      // §23.3 **걷는 사람은 클릭이 안 됐다.** 판정은 서버가 준 타일(isoX(sim.x, sim.y))을
      // 봤는데, 화면의 스프라이트는 900ms 트윈으로 따라가는 중이라 둘이 떨어져 있다.
      // 배치는 250ms마다 오므로 트윈은 28%만 진행되고 나머지는 잘린다. 정상 상태 지연은
      //   지연 = 한 배치 이동칸 / 0.385
      // ×1이면 1칸이라 우연히 맞았지만 ×12는 8칸, ×48은 31칸 어긋난다. 반경은 24였다.
      // 그래서 **눈에 보이는 자리**, 즉 스프라이트 컨테이너 좌표로 찾는다. 멈춰 있는 심은
      // 트윈이 없어 예전과 같은 자리이므로 기존 동작은 그대로다.
      const best = this.pickSimAt(wp);
      if (best) { selectSim(best.id); return; }
      // 심이 아니면 건물 토글 (§17.19 내부 모드): 화면→타일 역변환 후 발자국 검사
      const tx2 = (wp.x / (TW / 2) + wp.y / (TH / 2)) / 2;
      const ty2 = (wp.y / (TH / 2) - wp.x / (TW / 2)) / 2;
      // 지붕 여유(북서 3타일) 포함 후보 수집 → 발자국 중심 최근접 선택 (겹침 결정적, Codex 38차)
      let fac = null; let facD = Infinity;
      for (const f of world.map.facilities) {
        if (!f.w || tx2 < f.x - 3 || tx2 >= f.x + f.w || ty2 < f.y - 3 || ty2 >= f.y + f.h) continue;
        const dcx = tx2 - (f.x + f.w / 2); const dcy = ty2 - (f.y + f.h / 2);
        const d = dcx * dcx + dcy * dcy;
        if (d < facD) { facD = d; fac = f; }
      }
      if (fac && fac.type !== 'park' && fac.type !== 'pond') {
        if (interiorOpen.has(fac.id)) interiorOpen.delete(fac.id);
        else interiorOpen.add(fac.id);
        destroySimSprites();
        this.drawWorld();
        return;
      }
      // §18.T2: 빈 공터 클릭 → 건설 지정 모달
      const plot = world.plots?.find((p) => !p.used
        && tx2 >= p.x && tx2 < p.x + 7 && ty2 >= p.y && ty2 < p.y + 5);
      if (plot && typeof window.openZoneModal === 'function') window.openZoneModal(plot);
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

  // §UI 지형(멱등): 바탕 합성 셀 + 월드 TileSprite — 네이티브 로드 완료 후에도 안전 (Codex 59차)
  //
  // ⚠️ §22.32 이름 주의: 'tile_grass'·'grass_cell'·grassBg는 **더 이상 잔디가 아니다.**
  // 목업의 "마을 전체가 따뜻한 회갈색 석재 포장" 문법에 맞추느라 tile_grass.png의
  // 내용물이 석재 광장 텍스처로 바뀌었다(맵의 90.4%가 이 타일이다). 키 이름만 옛것이다.
  // 초록으로 되돌리지 마라 — 그러면 마을 전체가 다시 잔디밭이 된다.
  // 목업이 말하는 잔디는 **정원·화단 구획 안에만** 있어야 하고, 그건 이 바탕이 아니라
  // 별도 텍스처와 구획 데이터가 생겨야 가능하다(아직 없음).
  ensureTerrain() {
    if (this.grassBg || !this.textures.exists('tile_grass')) return;
    if (!this.textures.exists('grass_cell')) {
      const src = this.textures.get('tile_grass').getSourceImage();
      const cell = document.createElement('canvas');
      cell.width = 32; cell.height = 16;
      const cx2 = cell.getContext('2d');
      cx2.imageSmoothingEnabled = false;
      cx2.drawImage(src, 0, 0, 32, 16);
      for (const [ox, oy] of [[-16, -8], [16, -8], [-16, 8], [16, 8]]) cx2.drawImage(src, ox, oy, 32, 16);
      this.textures.addCanvas('grass_cell', cell);
    }
    // §22.10 뷰포트 크기 잔디 배경.
    // 이전에는 월드 전체(512×512)를 덮는 16,448×8,224 TileSprite였다. Phaser CANVAS 렌더러는
    // TileSprite 백킹 캔버스를 표시 크기 그대로 잡으므로(TileSprite.js CanvasPool.create) 이는
    // 541 MB RGBA이고, 매 프레임 그 전체를 소스로 drawImage 한다 — 실측 6.42 ms/frame.
    // (WEBGL이면 gl 경로가 캔버스를 건너뛰지만 임베디드 브라우저 이슈로 CANVAS 고정이다.)
    // 화면만 한 캔버스를 두고 카메라를 따라다니게 하면 같은 그림이 0.08 ms에 나온다.
    const cam = this.cameras.main;
    this.grassBg = this.add.tileSprite(0, 0, Math.max(1, cam.width), Math.max(1, cam.height), 'grass_cell')
      .setOrigin(0, 0).setDepth(-10);
    this.grassBg.__vw = 0; this.grassBg.__vh = 0; // 리사이즈 감지용
    this.syncGrassBg();
  }

  // 잔디 배경을 카메라 월드뷰에 맞춘다 (§22.10).
  //   백킹 캔버스 = 화면 픽셀, 오브젝트 스케일 = 1/zoom → 월드뷰를 정확히 덮는다.
  //   tileScale = zoom → 무늬 한 칸이 화면에서 32*zoom px, 즉 월드 스케일이 유지된다.
  //   tilePosition = 월드뷰 좌상단 + 원래 위상(16, 8) → 예전과 같은 자리에 같은 무늬가 온다.
  // 값이 바뀔 때만 대입한다 — TileSprite 세터는 무조건 dirty를 세워 캔버스를 다시 채우기 때문.
  // §23.18 따라가기. 이 게임의 재미는 **한 사람을 오래 보는 것**인데, 지금까지는 사람이
  // 화면 밖으로 걸어 나가면 그걸로 끝이었다. 카메라를 스프라이트에 붙인다 —
  // 서버 좌표가 아니라 눈에 보이는 자리를 따라가야 그림이 튀지 않는다(§23.3과 같은 이유).
  followSelected() {
    if (!followSimId || !world) return;
    const sp = simSprites.get(followSimId);
    const cam = this.cameras.main;
    let tx, ty;
    if (sp) { tx = sp.x; ty = sp.y; }
    else {
      const sim = world.sims.find((s) => s.id === followSimId);
      if (!sim) { setFollow(null); return; } // 떠났거나 죽었다
      tx = isoX(sim.x, sim.y); ty = isoY(sim.x, sim.y);
    }
    // 부드럽게 — 매 프레임 순간이동하면 화면이 떨린다. 8분의 1씩 좁힌다.
    const cx = cam.scrollX + cam.width / 2, cy = cam.scrollY + cam.height / 2;
    cam.scrollX += (tx - cx) / 8;
    cam.scrollY += (ty - cy) / 8;
  }

  // §23.3 화면에 보이는 자리로 사람을 고른다. 핸들러에서 떼어 놓아야 콘솔에서 검증할 수 있다.
  pickSimAt(wp) {
    if (!world) return null;
    let best = null, bestD = Infinity;
    const R = 26; // 몸통 반폭 — 아래 dy 보정으로 머리부터 발끝까지 덮는다
    for (const sim of world.sims) {
      const sp = simSprites.get(sim.id);
      const bx = sp ? sp.x : isoX(sim.x, sim.y);
      const by = sp ? sp.y : isoY(sim.x, sim.y);
      const dx = wp.x - bx, dy = wp.y - (by - 16);
      const d = dx * dx + dy * dy * 0.6; // 세로로 길쭉한 판정 (사람은 세로로 서 있다)
      if (d < R * R && d < bestD) { bestD = d; best = sim; }
    }
    return best;
  }

  // §23.12 **차도와 인도를 나눈다.** 시뮬레이션의 도로는 한 종류(TILE.ROAD)뿐이라
  // 17,323칸이 전부 같은 아스팔트로 보였다 — 사용자 지적 "차도와 인도가 아직 분리가
  // 안 되어 있다".
  //
  // 어디를 인도로 볼 것인가로 두 규칙을 재봤다:
  //   ① 도로 덩어리의 가장자리(비도로와 맞닿은 칸) → 15,214칸(88%). 거의 전부가 인도가
  //      되어 차도가 사라진다. 뒤집힌 그림이다.
  //   ② 건물 발자국에 맞닿은 칸 → 1,748칸(10%). 건물을 두르는 띠가 생기고 그 사이가
  //      차도로 남는다. 실제 거리의 생김새다.
  // ②를 쓴다. 이건 **그리기 분류**이지 지형 변경이 아니다 — 세계는 그대로다.
  sidewalkSet() {
    const map = world.map;
    const key = `${map.facilities.length}:${world.terrainVersion ?? 0}`;
    if (this.__swKey === key && this.__sw) return this.__sw;
    const set = new Set();
    for (const f of map.facilities) {
      for (let y = f.y - 1; y <= f.y + f.h; y++) {
        if (y < 0 || y >= map.h) continue;
        for (let x = f.x - 1; x <= f.x + f.w; x++) {
          if (x < 0 || x >= map.w) continue;
          set.add(y * map.w + x);
        }
      }
    }
    this.__swKey = key; this.__sw = set;
    return set;
  }

  // §22.104 타일 컬링. 맵은 512×512 = 26만 칸이고 그중 비-잔디가 37,594칸이다.
  // 지금까지는 화면 밖 · 접근조차 못 하는 변두리까지 전부 폴리곤으로 채웠다. 아이소 좌표는
  // u = x-y (가로), v = x+y (세로)로 분리되므로 카메라 사각형을 u·v 구간으로 뒤집으면
  // 보이는 칸만 정확히 훑을 수 있다. margin은 카메라가 조금 움직여도 다시 안 그리게 하는 여유.
  visibleUV(marginTiles = 16) {
    const cam = this.cameras.main;
    const zoom = cam.zoom > 0 ? cam.zoom : 1;
    const hw = cam.width / (2 * zoom), hh = cam.height / (2 * zoom);
    const cx = cam.scrollX + cam.width / 2, cy = cam.scrollY + cam.height / 2;
    const u0 = (cx - hw) / (TW / 2), u1 = (cx + hw) / (TW / 2);
    const v0 = (cy - hh) / (TH / 2), v1 = (cy + hh) / (TH / 2);
    return {
      minU: Math.floor(u0) - marginTiles, maxU: Math.ceil(u1) + marginTiles,
      minV: Math.floor(v0) - marginTiles, maxV: Math.ceil(v1) + marginTiles,
    };
  }

  // 보이는 칸을 (x, y)로 넘겨준다. v = x+y를 훑고 u는 같은 홀짝만 유효하다.
  forEachVisibleTile(uv, fn) {
    const map = world.map;
    const vLo = Math.max(0, uv.minV), vHi = Math.min(map.w + map.h - 2, uv.maxV);
    for (let v = vLo; v <= vHi; v++) {
      // x = (u+v)/2, y = (v-u)/2 → u는 v와 같은 홀짝
      let uLo = Math.max(uv.minU, v - 2 * (map.h - 1), -v);
      let uHi = Math.min(uv.maxU, v, 2 * (map.w - 1) - v);
      if ((uLo + v) % 2 !== 0) uLo++;
      for (let u = uLo; u <= uHi; u += 2) {
        const x = (u + v) >> 1, y = (v - u) >> 1;
        if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
        fn(x, y, y * map.w + x);
      }
    }
  }

  // 카메라가 여유분(margin)을 넘게 움직였을 때만 바닥을 다시 칠한다. 시설·심은 건드리지 않는다.
  syncTileCulling() {
    if (!world || !this.tileLayer) return;
    const cam = this.cameras.main;
    const d = this.__cullAt;
    if (d) {
      const dx = Math.abs(cam.scrollX - d.sx), dy = Math.abs(cam.scrollY - d.sy);
      const slack = 12 * TW / (cam.zoom > 0 ? cam.zoom : 1);
      if (cam.zoom === d.zoom && dx < slack && dy < slack) return;
    }
    this.redrawTiles();
  }

  redrawTiles() {
    if (!world || !this.tileLayer) return;
    const cam = this.cameras.main;
    this.__cullAt = { sx: cam.scrollX, sy: cam.scrollY, zoom: cam.zoom };
    const uv = this.visibleUV();
    this.bakeGround(uv);
    this.drawGardens(uv);
    const g = this.tileLayer; g.clear();
    const map = world.map;
    const hasTreeSprite = this.textures.exists('tree');
    this.forEachVisibleTile(uv, (x, y, i) => {
      const t = map.tiles[i];
      if (t === 0) return;
      if (t === 4 && hasTreeSprite) return;
      if (this.stamped && this.stamped.has(i)) return;
      const lift = (t === 3 || t === 4) ? 10 : 0;
      this.drawTile(g, x, y, TILE_COLORS[t], lift);
    });
  }

  syncGrassBg() {
    const bg = this.grassBg;
    if (!bg) return;
    const cam = this.cameras.main;
    const zoom = cam.zoom;
    if (!(zoom > 0) || cam.width <= 0 || cam.height <= 0) return;
    // 뷰포트보다 사방 1px 크게 잡는다 — 줌 배율에 따라 월드뷰 폭이 정수로 안 떨어져
    // 가장자리에 최대 0.5px 틈이 생기고, 그 자리에 카메라 배경색이 비친다 (실측 zoom 2.7).
    const cw = cam.width + 2, ch = cam.height + 2;
    if (bg.__vw !== cw || bg.__vh !== ch) {
      bg.setSize(cw, ch);
      bg.__vw = cw; bg.__vh = ch;
    }
    // worldView는 카메라 preRender에서 갱신되므로 한 프레임 늦다 — 직접 계산한다.
    const inv = 1 / zoom;
    const vx = cam.scrollX + cam.width / 2 - cam.width / (2 * zoom) - inv;
    const vy = cam.scrollY + cam.height / 2 - cam.height / (2 * zoom) - inv;
    if (bg.x !== vx || bg.y !== vy) bg.setPosition(vx, vy);
    if (bg.scaleX !== inv) bg.setScale(inv);
    if (bg.tileScaleX !== zoom) bg.setTileScale(zoom);
    // 위상은 오브젝트 좌상단 기준이므로 vx/vy와 같은 원점을 써야 예전 무늬와 일치한다.
    const px = vx + 16, py = vy + 8;
    if (bg.tilePositionX !== px) bg.tilePositionX = px;
    if (bg.tilePositionY !== py) bg.tilePositionY = py;
  }

  update() {
    this.syncGrassBg();
    this.syncTileCulling();
    this.followSelected();
    // §23.21 미니맵은 6프레임마다 — 사람 200명 점 찍기를 매 프레임 할 이유가 없다.
    this.__miniTick = (this.__miniTick ?? 0) + 1;
    if (this.__miniTick % 6 === 0) drawMinimap();
  }

  // §UI 도로·바닥 레이어(59차 ③ 재검토): 구시가 한정(0..132) 개별 스탬프 — 실측 1,419개.
  // RenderTexture·캔버스 베이크가 본 임베디드 CANVAS 환경에서 무출력이라(2회 검증) 실측상
  // 원활한 스탬프 방식을 채택, 영역 캡으로 오브젝트 수를 고정한다. 밖은 그래픽 폴백.
  bakeGround(uv = null) {
    this.stamped = new Set(); // 타일 루프와 공유 — 셋에 없으면 그래픽 폴백 (60차)
    if (!world || !this.textures.exists('tile_road')) return;
    if (this.roadSprites) for (const r of this.roadSprites) r.destroy();
    this.roadSprites = [];
    // §22.104 예전엔 "구시가 0..132"로 잘랐다. 도시가 466칸까지 뻗은 지금 그 경계는
    // 화면과 아무 상관이 없다 — 변두리를 보면 도로가 텍스처 없는 단색으로 나왔다.
    // 이제 자르는 기준은 **보이는가**뿐이라, 상한 2,500장이 화면 어디서나 텍스처를 덮는다.
    const STAMP_MAX = 2500; // 명시적 오브젝트 상한 (60차)
    const map = world.map;
    const bounds = uv ?? this.visibleUV();
    const sidewalk = this.textures.exists('tile_pavement') ? this.sidewalkSet() : null;
    this.forEachVisibleTile(bounds, (x, y, i) => {
      if (this.roadSprites.length >= STAMP_MAX) return;
      let key = TILE_TEX[map.tiles[i]];
      // §23.12 건물을 두르는 도로 칸은 인도로 깐다 (차도는 그 사이에 남는다)
      if (key === 'tile_road' && sidewalk && sidewalk.has(i)) key = 'tile_pavement';
      if (!key || !this.textures.exists(key)) return;
      const im = this.add.image(isoX(x, y), isoY(x, y), key).setDisplaySize(TW, TH).setDepth(-5);
      this.roadSprites.push(im);
      this.stamped.add(i);
    });
  }

  // §22.63 정원 잔디. 목업에서 잔디는 **구획 안에만** 있다 — 공원 발자국이 그 구획이다.
  // 스탬프(-5)·바탕(-10) 사이(-7)에 깔아 도로 타일을 덮지 않는다. 도로·물·벽 타일이 지나가는
  // 칸은 건너뛴다 — 길이 잔디에 잘리면 목업의 "길은 이어진다"가 깨진다.
  drawGardens(uv = null) {
    for (const im of this.gardenSprites ?? []) im.destroy();
    this.gardenSprites = [];
    if (!this.textures.exists('tile_garden')) return; // 에셋이 아직 없다 (무해)
    const map = world.map;
    const b = uv ?? this.visibleUV();
    for (const fac of map.facilities) {
      if (fac.type !== 'park') continue;
      // §22.104 공원 하나가 잔디·디딤돌·화단으로 수백 장을 만든다. 화면 밖 공원은 아예 건넌다.
      const u0 = fac.x - (fac.y + fac.h), u1 = (fac.x + fac.w) - fac.y;
      const v0 = fac.x + fac.y, v1 = fac.x + fac.w + fac.y + fac.h;
      if (u1 < b.minU || u0 > b.maxU || v1 < b.minV || v0 > b.maxV) continue;
      for (let y = fac.y; y < fac.y + fac.h; y++) {
        for (let x = fac.x; x < fac.x + fac.w; x++) {
          if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
          const t = map.tiles[y * map.w + x];
          if (t === 5 || t === 6) continue; // 물만 뺀다 — 연못 위에 잔디를 깔 수는 없다
          // §22.66 **길 칸을 건너뛰면 잔디에 구멍이 뚫린다.** 이 마을의 큰 공원은 안쪽 510칸 중
          // 292칸이 사람들이 다녀 생긴 길이라(§road_formed), 길을 비우면 잔디가 조각조각 나고
          // 사이로 회갈색 바탕이 비친다 — 사용자가 "에셋이 타일에 올라가면 빈공간이 보임"으로
          // 지적한 것이 이 자리다. 목업은 반대다: **잔디가 먼저 깔리고 그 위로 길이 지난다.**
          // 깊이 -7은 도로 스탬프(-5)보다 아래라, 길 칸에도 깔아 두면 길이 위를 덮는다.
          const im = this.add.image(isoX(x, y), isoY(x, y), 'tile_garden').setDisplaySize(TW, TH).setDepth(-7);
          this.gardenSprites.push(im);
          // §22.72 화단은 **경계가 아니라 잔디 안쪽**에 놓는다(Codex 배선 요청).
          // 길이 아닌 칸에만, 4칸마다 한 줄. 위치로 정해 같은 정원은 늘 같은 자리다.
          // §22.73 디딤돌 — 잔디를 가로지르는 좁은 길. 도로 타일과 달리 잔디가 사이로 보인다
          // (원화의 15%만 불투명). 화단과 겹치지 않게 다른 주기를 쓴다.
          if (t !== 1 && t !== 2 && this.textures.exists('path_stone') && (x * 2 + y) % 5 === 0) {
            const ps = this.add.image(isoX(x, y), isoY(x, y) - 2, 'path_stone').setDisplaySize(TW, 24).setDepth(-6);
            this.gardenSprites.push(ps);
          }
          // §22.80 어린 나무 — 정원 안쪽에 13칸 주기. 기존 tree(160×160, h=42)는 숲 타일용이고
          // 이건 정원용 소품이라 크기·주기가 다르다. 화단 7·디딤돌 5와 서로소라 겹침이 드물다.
          if (t !== 1 && t !== 2 && this.textures.exists('tree_young') && (x * 5 + y * 3) % 13 === 0) {
            const ty = this.add.image(isoX(x, y), isoY(x, y) - 6, 'tree_young').setDisplaySize(TW, 24).setDepth(isoY(x, y));
            this.gardenSprites.push(ty);
          }
          // §22.76 화분은 단품이라 드물게 놓는다 — 잔디 가장자리(정원 첫 줄·끝 줄)에만 11칸 주기.
          if (this.textures.exists('garden_pot') && (y === fac.y || y === fac.y + fac.h - 1) && (x * 3 + y) % 11 === 0) {
            const gp = this.add.image(isoX(x, y), isoY(x, y) - 6, 'garden_pot').setDisplaySize(TW, 24).setDepth(isoY(x, y));
            this.gardenSprites.push(gp);
          }
          if (t !== 1 && t !== 2 && this.textures.exists('flower_row') && (x + y * 2) % 7 === 0) {
            const fl = this.add.image(isoX(x, y), isoY(x, y) - 4, 'flower_row').setDisplaySize(TW, 24).setDepth(isoY(x, y));
            this.gardenSprites.push(fl);
          }
        }
      }
    }
  }

  drawWorld() {
    const g = this.mapLayer; g.clear();
    const { map } = world;
    const hasTreeSprite = this.textures.exists('tree');
    this.ensureTerrain(); // 텍스처가 이미 로드됐다면 여기서도 멱등 생성 (59차 ①)
    if (!this.grassBg) {
      // §17.0: 지면은 거대 다각형 1개(잔디색) — 잔디 텍스처 부재 시 폴백 (텍스처가 있으면
      // grassBg(-10)가 담당하고, 다각형은 스탬프(-5)를 덮으므로 그리지 않는다 — 59차 후속)
      g.fillStyle(TILE_COLORS[0], 1);
      g.beginPath();
      g.moveTo(isoX(0, 0), isoY(0, 0) - 8);
      g.lineTo(isoX(map.w, 0), isoY(map.w, 0));
      g.lineTo(isoX(map.w, map.h), isoY(map.w, map.h) + 8);
      g.lineTo(isoX(0, map.h), isoY(0, map.h));
      g.closePath(); g.fillPath();
    }
    this.__cullAt = null; // 지형이 바뀌었을 수 있다 — 카메라가 그대로여도 다시 칠한다
    this.redrawTiles(); // §22.104 바닥·스탬프·정원은 보이는 칸만
    this.computeFacModes();
    this.drawProps();
    let houseIdx = 0;
    for (const fac of map.facilities) {
      const label = facilityName(fac); // §23.7 가게마다 제 이름 (아래 SHOP_NAMES)
      // §17.14 건물 스프라이트: 발자국 바닥 중앙 앵커, 깊이 = 남쪽 모서리 (심 오클루전)
      const mode = this.facMode.get(fac.id) ?? 'tile';
      const opened = interiorOpen.has(fac.id);
      const hv = fac.type === 'house' ? houseIdx++ : 0; // 모드 무관 1회 증가 — 변형 고정 (Codex 40차)
      let bldKey = null;
      if (mode === 'int') {
        bldKey = fac.type === 'house' ? 'bld_house_int' : `${BLD_OF_FACILITY[fac.type]}_int`;
      } else if (mode === 'ext') {
        bldKey = fac.type === 'house' ? `bld_house_${'abc'[hv % 3]}` : BLD_OF_FACILITY[fac.type];
        // §18.T2 회전 외형: dir 텍스처 존재 시 사용 (없으면 d0 폴백)
        if (fac.dir && this.textures.exists(`${bldKey}_d${fac.dir}`)) bldKey = `${bldKey}_d${fac.dir}`;
        // 야간(19~06시) 점등 변형이 있으면 교체 — 하루 2번 낮밤 전환 시 drawWorld 재호출로 반영
        const hh = world ? Math.floor((world.worldTick % 1440) / 60) : 12;
        if ((hh >= 19 || hh < 6) && this.textures.exists(`${bldKey}_night`)) bldKey = `${bldKey}_night`;
      }
      if (bldKey) {
        const cx = isoX(fac.x + fac.w / 2, fac.y + fac.h / 2);
        const cy = isoY(fac.x + fac.w / 2, fac.y + fac.h / 2);
        const img = this.add.image(cx, cy + TH, bldKey).setOrigin(0.5, 1);
        const wpx = (fac.w + fac.h) / 2 * TW; // 발자국 대각 폭 = 트림된 내용 폭 (이슈 #15)
        img.setScale(wpx / img.width);
        // 내부 모드는 북쪽 모서리 깊이 → 안의 심·가구가 위에 그려짐
        img.setDepth(opened ? 1000 + fac.x + fac.y : 1000 + fac.x + fac.w + fac.y + fac.h - 1);
        this.propSprites.push(img);
      } else {
        g.fillStyle(FACILITY_COLORS[fac.type], 0.35);
        for (let j = fac.y; j < fac.y + fac.h; j++) for (let i = fac.x; i < fac.x + fac.w; i++) {
          if (map.tiles[j * map.w + i] === 3) this.drawTile(g, i, j, FACILITY_COLORS[fac.type], 10);
        }
      }
      const tx = isoX(fac.x + fac.w / 2, fac.y), ty = isoY(fac.x + fac.w / 2, fac.y) - (bldKey ? 40 : 24);
      const lb = this.add.text(tx, ty, label, { fontSize: '11px', color: '#ffd97a', stroke: '#14121a', strokeThickness: 3 }).setOrigin(0.5);
      lb.setDepth(5000);
      this.propSprites.push(lb);
    }
    this.syncSims();
  }

  // 원형·방향별 걷기 애니메이션 등록 (프레임이 전부 로드된 것만). dir: '' 정면 ↙, 'up' 후면 ↖
  ensureWalkAnim(arch, dir = '') {
    const key = `walk${dir}anim${arch}`;
    if (this.anims.exists(key)) return key;
    const frames = [0, 1, 2, 3].map((f) => ({ key: `walk${dir}${arch}_${f}` }));
    if (!frames.every((fr) => this.textures.exists(fr.key))) return null;
    this.anims.create({ key, frames, frameRate: 8, repeat: -1 });
    return key;
  }

  // 정지 포즈 텍스처: pose 시트 [0 서↙, 1 앉↙, 2 서↖, 3 앉↖] — 없으면 걷기 frame 0 폴백
  poseTexture(arch, sitting, back) {
    const idx = (back ? 2 : 0) + (sitting ? 1 : 0);
    const key = `pose${arch}_${idx}`;
    if (this.textures.exists(key)) return key;
    return this.textures.exists(`walk${arch}_0`) ? `walk${arch}_0` : null;
  }

  syncRail() {
    const links=world?.rail?.links??[];
    this.railMarkers??=new Map();
    this.railGraphics??=this.add.graphics().setDepth(20);
    if(!this.railGeometry||links.length!==this.railGeometry.length||links.some((l,i)=>l.path!==this.railGeometry[i].path||l.blocked!==this.railGeometry[i].blocked)){
      this.railGraphics.clear();
      for(const l of links){
        this.railGraphics.lineStyle(3,l.blocked?0xb35b53:0xa6bec9,0.9);this.railGraphics.beginPath();
        for(const [i,p] of (l.path??[]).entries()){
          const x=isoX(p.x,p.y),y=isoY(p.x,p.y);
          if(i===0)this.railGraphics.moveTo(x,y);else this.railGraphics.lineTo(x,y);
        }
        this.railGraphics.strokePath();
      }
      this.railGeometry=links.map(l=>({path:l.path,blocked:l.blocked}));
    }
    for(const l of links){
      let marker=this.railMarkers.get(l.id);const x=isoX(l.train.x,l.train.y),y=isoY(l.train.x,l.train.y)-8;
      if(!marker){marker=this.add.text(x,y,'',{fontSize:'16px',color:'#ffffff',backgroundColor:'#203441',padding:{x:3,y:2}}).setOrigin(0.5,1).setDepth(6000);this.railMarkers.set(l.id,marker);}
      marker.setText(`${l.blocked?'⏸':'🚆'} ${l.train.passengers.length}/${l.capacity}`);
      this.tweens.killTweensOf(marker);this.tweens.add({targets:marker,x,y,duration:200});
    }
    for(const [id,marker] of this.railMarkers)if(!links.some(l=>l.id===id)){marker.destroy();this.railMarkers.delete(id);}
  }

  syncSims() {
    this.syncRail();
    // §23.38 **화면 밖 사람은 스프라이트를 갖지 않는다.** 여태 전원에게 컨테이너(그림자 +
    // 몸 + 이름표, 차가 있으면 아이콘까지)를 만들었다. 인구 249면 오브젝트 1,000개, 그리고
    // 배치마다 전원에게 트윈을 만들고 죽였다(초당 약 1,000회). 지도가 다 보일 일은 없는데
    // 사람은 전부 살아 있었다 — 페이지가 튕기던 이유의 한 축이다.
    // 범위는 타일 컬링(§22.104)과 같은 u·v 역변환을 쓰되, 사람은 움직이므로 여유를 더 준다.
    const uv = this.visibleUV(40);
    for (const sim of world.sims) {
      const u = sim.x - sim.y, v = sim.x + sim.y;
      if (u < uv.minU || u > uv.maxU || v < uv.minV || v > uv.maxV) {
        // 밖으로 나갔으면 정리한다. 다시 들어오면 그때 만든다 — 상태는 world.sims에 있다.
        const gone = simSprites.get(sim.id);
        if (gone) {
          this.tweens.killTweensOf(gone); gone.destroy(); simSprites.delete(sim.id);
          const b = bubbles.get(sim.id); // 말풍선도 같이 — 안 그러면 빈 자리에 떠 있는다
          if (b) { clearTimeout(b.timer); b.container.destroy(); bubbles.delete(sim.id); }
        }
        continue;
      }
      let sp = simSprites.get(sim.id);
      const tx = isoX(sim.x, sim.y), ty = isoY(sim.x, sim.y) - 8;
      if (!sp) {
        const arch = archOf(sim); // §22.36 나이대 → 성별 → 직업 제복 순
        const animKey = this.ensureWalkAnim(arch);
        let body;
        if (animKey) {
          body = this.add.sprite(0, -12, `walk${arch}_0`);
          body.setScale(38 / body.height);
        } else if (this.textures.exists(sim.isPlayer ? 'player' : `sim${arch}`)) {
          body = this.add.image(0, -12, sim.isPlayer ? 'player' : `sim${arch}`);
          body.setScale(36 / body.height);
        } else {
          body = this.add.circle(0, 0, 6, SIM_COLORS[sim.id % SIM_COLORS.length]).setStrokeStyle(1.5, 0x14121a);
        }
        const shadow = this.add.ellipse(0, 1, 18, 7, 0x000000, 0.28); // 발밑 그림자 — 접지감
        const label = this.add.text(0, -30, `${sim.isPlayer ? '◆ ' : ''}${sim.isGenius ? '⭐ ' : ''}${sim.name}`, { fontSize: '10px', color: '#e8e2d8', stroke: '#14121a', strokeThickness: 3 }).setOrigin(0.5);
        const c = this.add.container(tx, ty, [shadow, body, label]);
        c.bodyRef = body; c.animKey = animKey;
        c.labelRef = label; c.shadowRef = shadow; // §22.87 주행 중 숨길 것들
        sp = c; simSprites.set(sim.id, sp);
      }
      const arch = archOf(sim);
      // 타일 델타로 4방향: 정/후면 = sign(ddx+ddy), 좌/우 = 화면 dx 부호(flipX)
      const prev = sp.lastTile ?? { x: sim.x, y: sim.y };
      const ddx = sim.x - prev.x, ddy = sim.y - prev.y;
      sp.lastTile = { x: sim.x, y: sim.y };
      // §19 R-B: 자가용 보유자는 이동 중 차량 아이콘을 단다
      if (sim.hasCar && !sp.carIcon && this.textures.exists('car')) {
        // §23.2 차가 사람보다 작았다(높이 16px, 사람 몸 32px). 실물 비례가 뒤집혀 있으면
        // "차를 탔다"가 아니라 "장난감을 들고 간다"로 보인다. 차 한 대는 두 칸 길이라
        // 아이소 타일 폭(32)보다 넓어야 한다 — 높이 30, 사람 옆이 아니라 **자리 중앙**에.
        const src = this.textures.get('car').getSourceImage();
        sp.carIcon = this.add.image(0, 2, 'car').setScale(30 / src.height);
        sp.add(sp.carIcon);
      }
      // §22.87 차를 타면 **차만 보인다** (사용자 지시: "자동차를 타면 자동차만 보여야지
      // 사람이랑 같이 보이지 않게 한다"). 예전에는 차 아이콘이 걸어가는 사람 위에 겹쳐서
      // 사람과 차가 한 몸처럼 붙어 다녔다. 이동 중에는 몸·이름표를 숨기고 차만 남긴다.
      sp.setVisible(sim.state?.kind!=='riding_train'); // Aboard a train, show the train rather than overlapping bodies/cars.
      const driving = sim.hasCar && !sim.state?.rail && sim.state?.kind === 'walking';
      if (sp.carIcon) {
        sp.carIcon.setVisible(driving);
        if (driving && tx - sp.x !== 0) sp.carIcon.setFlipX(tx - sp.x > 0); // 가는 쪽을 본다
      }
      if (sp.bodyRef) sp.bodyRef.setVisible(!driving);
      if (sp.labelRef) sp.labelRef.setVisible(!driving);
      if (sp.shadowRef) sp.shadowRef.setVisible(!driving);
      const dx = tx - sp.x;
      const moving = Math.abs(dx) + Math.abs(ty - sp.y) > 1;
      const body = sp.bodyRef;
      if (body && sp.animKey) {
        if (moving) {
          // §23.5 방향이 틀리는 이유는 방향표가 아니라 **두 델타의 기준이 달라서**였다.
          // back은 타일 델타(ddx+ddy)에서 오고 flipX는 화면 델타(tx - sp.x)에서 왔는데,
          // 화면 델타는 900ms 트윈이 따라가는 중의 지연을 품고 있어 배속에서 부호가 어긋난다.
          // 게다가 지도가 더러워진 배치에서는 syncSims가 두 번 돈다(drawWorld 끝에서 한 번,
          // 배치 처리 끝에서 또 한 번). 두 번째에는 ddx=ddy=0이라 back이 늘 false가 되어
          // **북쪽으로 걷는 사람이 전부 정면으로 뒤집혔다** — 사용자가 본 그 증상이다.
          // 그래서 화면 델타를 버리고 타일 델타 하나에서 둘 다 뽑고, 0델타면 방향을 건드리지 않는다.
          if (ddx !== 0 || ddy !== 0) {
            const back = (ddx + ddy) < 0; // 북쪽(카메라 반대)으로 이동 → 후면
            const animKey = (back && this.ensureWalkAnim(arch, 'up')) || this.ensureWalkAnim(arch);
            body.setFlipX((ddx - ddy) > 0); // 화면 x = (x−y)·16 — 오른쪽으로 가면 반전
            body.anims.play(animKey, true);
            sp.lastBack = back && this.ensureWalkAnim(arch, 'up') !== null;
            sp.lastFlip = body.flipX;
          } else if (sp.animKey) {
            body.anims.play(sp.lastBack ? this.ensureWalkAnim(arch, 'up') ?? sp.animKey : sp.animKey, true);
            if (sp.lastFlip !== undefined) body.setFlipX(sp.lastFlip);
          }
          if (sp.stopTimer) { sp.stopTimer.remove(); }
          sp.stopTimer = this.time.delayedCall(950, () => {
            body.anims.stop();
            const sitting = sim.state?.kind === 'performing' && SIT_ACTIONS.includes(sim.state.action);
            body.setTexture(this.poseTexture(arch, sitting, sp.lastBack) ?? `walk${arch}_0`);
          });
        } else if (sim.state?.kind === 'performing') {
          // 정지 수행 중: 착석 행동이면 앉기 포즈 유지
          const sitting = SIT_ACTIONS.includes(sim.state.action);
          const tex = this.poseTexture(arch, sitting, sp.lastBack);
          if (tex && !body.anims.isPlaying && body.texture.key !== tex) body.setTexture(tex);
        }
      }
      // §22.100 **트윈이 쌓여 브라우저를 죽인다.** 심마다 매 tickBatch에 이동 트윈을
      // 새로 만들면서 이전 트윈을 끊지 않았다 — 배속을 올리면 배치가 900ms보다 자주 와서
      // 완료되지 못한 트윈이 계속 겹친다. 실측: 25초에 12,397 → 30,154개(초당 +710),
      // 힙은 분당 29~52MB. 스프라이트 정리(§22.99)만으로는 안 잡혔던 진짜 누수다.
      // 새 목적지를 주기 전에 그 스프라이트의 이전 트윈을 끊는다.
      // §22.100 **탭이 숨으면 트윈이 쌓여 페이지가 죽는다.** 브라우저는 숨은 탭의
      // requestAnimationFrame을 멈추므로 Phaser의 업데이트 루프가 서지만, 서버 tickBatch는
      // 계속 들어온다 — 그래서 완료되지 못한 이동 트윈이 무한히 겹친다.
      // 실측(숨긴 탭): 25초에 8,404 → 26,648개, 힙 분당 25~52MB. 탭 한도 4GB면 곧 죽는다.
      //
      // 안 보이는 동안은 **트윈 없이 즉시 배치**한다. 눈에 보이지 않는 보간에 메모리를
      // 쓸 이유가 없고, 다시 보일 때는 어차피 최신 위치가 맞다.
      // 그리고 어떤 이유로든 트윈이 넘치면(2,000개) 전부 끊고 스냅으로 돌린다 — 안전판이다.
      const tweenCount = this.tweens.getTweens().length;
      if (document.hidden || tweenCount > 2000) {
        if (tweenCount > 2000) this.tweens.killAll();
        sp.x = tx; sp.y = ty;
      } else {
        this.tweens.killTweensOf(sp);
        this.tweens.add({ targets: sp, x: tx, y: ty, duration: 900, ease: 'Linear' });
      }
      sp.setDepth(1000 + sim.x + sim.y);
    }
    // §22.99 **떠난 심의 스프라이트를 지운다 — 브라우저 OOM의 실제 원인이었다.**
    // 분실물(syncItems)·화재(syncFires)에는 이 정리가 있는데 심에만 없었다. 사망은 드물어
    // 여태 티가 안 났지만, #115 이주가 들어오면서 사람이 계속 떠난다 — 컨테이너(몸·이름표·
    // 그림자·차 아이콘)와 트윈이 통째로 남아 힙이 **분당 29MB**씩 자랐다(실측). 탭 한도
    // 4GB면 두 시간 남짓에 페이지가 죽는다.
    const live = new Set(world.sims.map((s) => s.id));
    for (const [id, sp] of simSprites) {
      if (live.has(id)) continue;
      this.tweens.killTweensOf(sp); // repeat 트윈은 destroy로 죽지 않는다 (§22.10 전례)
      sp.destroy();
      simSprites.delete(id);
      const b = bubbles.get(id);
      if (b) { clearTimeout(b.timer); b.container.destroy(); bubbles.delete(id); }
    }
  }
}

// §22.99 진단 창구 — OOM을 쫓을 때 "무엇이 몇 개인가"를 콘솔에서 바로 본다.
// 힙 수치만 보면 GC 타이밍에 속는다. 개수는 속지 않는다.
window.__select = (id) => selectSim(id); // §23.1 진단 창구 — 패널·일대기 검증용
window.__diag = () => ({
  tileCmds: window.__game?.scene?.scenes?.[0]?.tileLayer?.commandBuffer?.length ?? 0, // §22.104 바닥 그리기 명령 수
  sims: world?.sims?.length ?? 0,
  simSprites: simSprites.size,
  bubbles: bubbles.size,
  items: itemSprites.size,
  props: scene?.propSprites?.length ?? 0,
  roads: scene?.roadSprites?.length ?? 0,
  gardens: scene?.gardenSprites?.length ?? 0,
  tweens: scene?.tweens?.getTweens?.().length ?? 0,
  // 트윈이 어디서 오는지 — 대상 종류별로 센다 (OOM 추적용)
  tweensBy: (() => {
    const t = scene?.tweens?.getTweens?.() ?? [];
    const by = {};
    for (const x of t) {
      const g = x.targets?.[0];
      const k = g?.type ?? g?.constructor?.name ?? 'unknown';
      by[k] = (by[k] ?? 0) + 1;
    }
    return by;
  })(),
  displayList: scene?.children?.list?.length ?? 0,
  feed: document.querySelectorAll('#feed > *').length,
  heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
});

// #143 장시간 검증용. ?diag=1에서만 현재 진단값을 DOM 속성 하나에 덮어써서,
// 콘솔 전역에 접근할 수 없는 자동 브라우저도 같은 __diag 결과를 읽을 수 있게 한다.
// 누적 배열/DOM은 만들지 않으며 일반 플레이에는 타이머 자체가 없다.
if (new URLSearchParams(location.search).get('diag') === '1') {
  const publishDiag = () => {
    try { document.documentElement.dataset.deepsimsDiag = JSON.stringify(window.__diag()); }
    catch { /* 모듈의 뒤쪽 게임 객체가 초기화되기 전이면 다음 수집에서 기록 */ }
  };
  window.__publishDiag = publishDiag;
  setTimeout(publishDiag, 0);
  setInterval(publishDiag, 60_000);
  document.addEventListener('visibilitychange', publishDiag);
}

const game = new Phaser.Game({
  type: Phaser.CANVAS, // 임베디드 브라우저의 WebGL 프레임버퍼 이슈 회피
  parent: 'game',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: TownScene,
  banner: false,
});

window.__game = game; // §22.104 컬링 실측 창구 (씬·카메라·커맨드 버퍼)

// #106 창 크기가 바뀌어도 캔버스가 로드 시점 크기에 머무는 문제.
// RESIZE 모드는 부모(#game)를 따라가지만 그리드 폭 변화를 놓치는 경우가 있어
// window.resize에서 실제 부모 크기로 직접 맞춘다. 리사이즈 폭주를 막게 디바운스(120ms).
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const parent = document.getElementById('game');
    if (!parent || !game.scale) return;
    const w = Math.max(1, Math.floor(parent.clientWidth));  // 0은 캔버스를 지운다 — 최소 1
    const h = Math.max(1, Math.floor(parent.clientHeight));
    game.scale.resize(w, h);
    if (scene) scene.drawWorld(); // 새 크기에 맞춰 아이소메트릭 배치 재계산
  }, 120);
});

// ---- 동적 오브젝트: 분실 동전 (§16.C) ----
const itemSprites = new Map();
function syncItems() {
  if (!scene || !world?.lostItems) return;
  const alive = new Set(world.lostItems.map((it) => it.itemId));
  for (const [id, sp] of itemSprites) {
    // §22.10 repeat:-1 트윈은 destroy로 죽지 않는다 — 먼저 끊고 파괴한다
    if (!alive.has(id)) { scene.tweens.killTweensOf(sp); sp.destroy(); itemSprites.delete(id); }
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
// §18.T5 상단 지표는 스냅샷뿐 아니라 매 tickBatch에서도 갱신한다(#104).
// 배치마다 호출되므로 문자열이 실제로 달라졌을 때만 DOM에 쓴다 — 불필요한 리페인트 방지.
let lastStatsText = null;
function updateStats() {
  const el = document.getElementById('stats');
  if (!el || !world) return;
  const couples = Object.keys(world.partners ?? {}).length / 2;
  const married = Object.values(world.partnerStage ?? {}).filter((s) => s === 'married').length / 2;
  const mayor = world.mayorId !== null && world.mayorId !== undefined ? simName(world.mayorId) : '없음';
  const tre = world.treasury ?? 0;
  const text = `👥${world.sims.length} 💑${Math.floor(couples)} 💍${Math.floor(married)} 👑${mayor} 🏛️${tre.toLocaleString()}원`;
  if (text === lastStatsText) return;
  lastStatsText = text;
  el.textContent = text;
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
  // §22.68 화면 밖이면 만들지 않는다. Text 생성이 §22.10에서 잰 렌더 병목이었고,
  // 배속을 올리면 보이지도 않는 말풍선이 초당 수십 개씩 생겼다 사라졌다.
  {
    const cam = scene.cameras?.main;
    if (cam) {
      const v = cam.worldView;
      const pad = 80; // 말풍선은 심 위로 뻗으니 여유를 둔다
      if (sp.x < v.x - pad || sp.x > v.right + pad || sp.y < v.y - pad || sp.y > v.bottom + pad) return;
    }
  }
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

const PLACE_KO = { cafe: '카페', park: '공원', bar: '술집', office: '직장', library: '도서관', market: '시장', pond: '낚시터', hospital: '병원', city_hall: '시청', school: '학교', restaurant: '식당', gym: '헬스장', cinema: '영화관', police_station: '경찰서', fire_station: '소방서', apartment: '아파트', factory: '공장', mall: '상가', university: '대학', workshop:'공방',lab:'연구소',warehouse:'창고', site: '공사장' };
Object.assign(PLACE_KO, {primary_school:'초등학교',middle_school:'중학교',high_school:'고등학교',train_station:'기차역'});
// §22.12 한국어 조사 — 종성(받침)으로 고른다.
// 예전에는 이름 뒤에 조사를 하드코딩해 "수아이(가)", "은지이(가)", "수아과(와)"가
// 나왔다. 이벤트 피드는 가상 플레이어 3인이 모두 이 게임 최고의 자산으로 꼽은
// 주 서사 화면이라, 여기서 글이 어색하면 그 자산이 그만큼 깎인다 (QA #15).
function hasJong(word) {
  const ch = String(word ?? '').trim().slice(-1);
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0; // 한글 음절
  if (ch >= '0' && ch <= '9') return '0136780'.includes(ch); // 영·일·삼·육·칠·팔
  return false; // 판별 불가(영문 등)는 받침 없는 형태로 — 이 게임의 이름은 전부 한글이다
}
const ga = (w) => `${w}${hasJong(w) ? '이' : '가'}`;
const wa = (w) => `${w}${hasJong(w) ? '과' : '와'}`;
const eul = (w) => `${w}${hasJong(w) ? '을' : '를'}`;
const eun = (w) => `${w}${hasJong(w) ? '은' : '는'}`;
const rang = (w) => `${w}${hasJong(w) ? '이랑' : '랑'}`;
const ne = (w) => `${w}${hasJong(w) ? '이네' : '네'}`;
// §23.1 로/으로 — 받침이 없거나 받침이 ㄹ이면 '로'다 ("점원로"가 아니라 "점원으로").
const ro = (w) => {
  const ch = String(w ?? '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  const isHangul = code >= 0xac00 && code <= 0xd7a3;
  const jong = isHangul ? (code - 0xac00) % 28 : 0;
  return `${w}${(!isHangul || jong === 0 || jong === 8) ? '로' : '으로'}`; // 8 = ㄹ
};

// §22.28 unmet 기억의 placeId는 **장소가 아니라 행동 이름**이다(라이브 확인: 'eat').
// placeKo에 넣으면 "eat 하려는데"가 그대로 찍힌다 — 장소 이름과 행동 이름은 다른 어휘다.
// 아래쪽 ACTION_KO와 별개로 둔다: 저건 UI 라벨용 명사형('식사'), 이건 대사용 동사형이라
// 문장에서 서로 바꿔 쓸 수 없다("식사 하려는데 갈 데가 없더라"는 어색하다).
const ACTION_TRY_KO = {
  eat: '밥 먹으려', sleep: '자려', work: '일하려', socialize: '사람 만나려',
  play: '놀려', drink: '한잔하려', binge_eat: '뭐 좀 먹으려', hole_up: '좀 쉬려',
  exercise: '운동하려', build: '뭘 좀 만들려', read: '책 좀 읽으려', study: '수업 들으려', shop: '장 보려',
  fish: '낚시하려', cook_eat: '밥 해 먹으려', construct: '공사 거들려',
  see_doctor: '병원 가려', seek_food_aid: '공공 식사 받으려', idle: '좀 쉬려',
  escort_child_doctor: '아이와 병원 가려',
  stroll: '바람 좀 쐬려', garden: '텃밭 좀 보려', music: '악기 좀 켜려',
  volunteer: '봉사 좀 하려', board_game: '보드게임 한판 하려',
};
function actKo(id) { return ACTION_TRY_KO[id] ?? '뭘 좀 하려'; }

function placeKo(id) {
  if (!id) return '동네';
  if (id.startsWith('house')) return '집';
  const facility = world?.map?.facilities?.find((f) => f.id === id);
  if (facility) return PLACE_KO[facility.type] ?? '동네';
  return PLACE_KO[id] ?? '동네';
}

// 대화 문장 생성 — 구조화 payload(detail)의 실제 데이터로 구체적인 말을 만든다 (§16 강화).
// 변형 선택은 tick 기반(코스메틱): 같은 이벤트는 항상 같은 문장.
function pick(arr, t, seed = '') {
  // §22.67 pick도 같은 함정에 걸려 있었다: 간격 30, 표 길이 3·5·10이면 인덱스가 하나로 굳는다.
  return arr[hash32(`${t}|${seed}`) % arr.length];
}

// §22.39 가중치 있는 결정적 선택 (사용자 지시: "가중치로 다르게 답변할 수 있게").
//
// pick(arr,t)는 t % len이라 **모든 문장이 똑같이 자주 나온다.** 실제 구어는 그렇지
// 않다 — "덥다 진짜"는 흔하고 "난 괜찮은데"는 가끔이다. 빈도가 곧 그 말의 성격이라
// 균등 분포는 말투 자체를 어색하게 만든다.
//
// [무게, 문장] 행을 누적합으로 펼쳐 t를 대응시킨다. **rng를 쓰지 않으므로** 같은
// 이벤트는 여전히 같은 문장이고, 드로우 순서 계약(§17.8)과 무관하다 — 클라 전용이다.
// §22.67 **tick을 그대로 인덱스로 쓰면 확률이 아니라 한 줄만 나온다.**
// 같은 쌍의 대화는 30틱 간격으로 일어난다(실측: 1,676표본 중 1,323건이 30틱).
// 그래서 t % 10 은 늘 같은 값이고, 무게 4/3/2/1(합 10)짜리 표는 **가장 흔한 답 하나로 고정**됐다.
// 사용자 지적: "가중치가 가장 높은 대화만을 채택하는 게 아니라 전체가중치 분모의 확률로 얘기하는 것".
// tick을 섞어서 그 확률이 실제로 나오게 한다 — 난수가 아니라 해시라 같은 입력이면 늘 같은 답이다.
function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 0x2545f491) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}

// §23.7 가게 이름. "카페 두 군데의 이름이 같음" — 같은 종류라고 같은 가게는 아니다.
// 시뮬레이션에는 이름 필드가 없고(시설은 id·좌표·매출뿐), 이름은 **보는 사람의 것**이므로
// 화면에서 짓는다. id가 곧 자리이므로 같은 가게는 언제 봐도 같은 이름이다.
const SHOP_NAMES = {
  cafe: ['해솔다방', '달빛커피', '아침커피', '골목카페', '온기다방', '민들레커피', '창가커피', '노을다방'],
  restaurant: ['한밭식당', '손칼국수', '우리식탁', '골목분식', '해솔밥상', '옛맛식당', '참숯화로'],
  bar: ['밤바다', '한잔집', '등대주점', '골목선술집', '달빛한잔'],
  market: ['해솔상회', '새벽마트', '골목슈퍼', '한아름상회', '아침시장'],
  office: ['해솔사무소', '새벽상사', '늘봄기획', '한빛사무소', '두레상사'],
  gym: ['튼튼체육관', '해솔짐', '새벽운동실'],
  cinema: ['해솔극장', '달빛시네마', '동네영화관'],
  library: ['마을도서관', '해솔문고', '숲속서재'],
  hospital: ['해솔의원', '마을병원', '새벽의원'],
  school: ['해솔학교', '마을학교'],
  park: ['해솔공원', '달빛공원', '숲길공원', '햇살공원', '개울공원'],
  pond: ['해솔못', '달빛저수지', '버들못'],
  city_hall: ['시청'], house: ['집'], apartment: ['아파트'],
  police_station: ['파출소'], fire_station: ['소방서'], mall: ['해솔몰', '달빛상가'],
};
const PLACE_FALLBACK = {
  house: '집', apartment: '아파트', office: '직장', cafe: '카페', park: '공원', bar: '술집',
  library: '도서관', market: '시장', pond: '낚시터', hospital: '병원', city_hall: '시청',
  school: '학교', restaurant: '식당', gym: '헬스장', cinema: '영화관', mall: '쇼핑몰',
  police_station: '파출소', fire_station: '소방서', train_station:'기차역',
};
// 해시로 고르면 카페 9곳에 이름 8개라 반드시 겹친다. 그래서 **같은 종류 안에서 몇 번째인가**로
// 고른다 — 이름이 동나면 "2호점"이 붙는다. id 정렬이라 목록 순서가 바뀌어도 이름은 그대로다.
let __nameCache = { key: '', map: null };
function facilityNames() {
  const facs = world?.map?.facilities ?? [];
  const key = `${facs.length}:${facs[facs.length - 1]?.id ?? ''}`;
  if (__nameCache.key === key && __nameCache.map) return __nameCache.map;
  const byType = new Map();
  for (const f of facs) {
    if (!byType.has(f.type)) byType.set(f.type, []);
    byType.get(f.type).push(f.id);
  }
  const out = new Map();
  for (const [type, ids] of byType) {
    ids.sort();
    const pool = SHOP_NAMES[type];
    ids.forEach((id, i) => {
      if (!pool || pool.length === 0) { out.set(id, PLACE_FALLBACK[type] ?? type); return; }
      const branch = Math.floor(i / pool.length);
      out.set(id, pool[i % pool.length] + (branch > 0 ? ` ${branch + 1}호점` : ''));
    });
  }
  __nameCache = { key, map: out };
  return out;
}
function facilityName(fac) {
  if (!fac) return '';
  if (fac.type === 'house' || fac.type === 'apartment') return PLACE_FALLBACK[fac.type];
  return facilityNames().get(fac.id) ?? PLACE_FALLBACK[fac.type] ?? fac.type;
}

function pickW(rows, t, seed = '') {
  let total = 0;
  for (const r of rows) total += r[0];
  if (total <= 0) return rows[0];
  let x = hash32(`${t}|${seed}`) % total; // 무게 비례 — 분모는 전체 무게
  for (const r of rows) { x -= r[0]; if (x < 0) return r; }
  return rows[rows.length - 1];
}


// §22.62 **같은 질문에 사람마다 다르게 답한다** (사용자 지시: "대화가 가중치를 그대로
// 따라가려고 하니 성격 +mbti와 같이 가중치를 곱한 값으로 계산한다").
//
// 표의 무게는 "이 동네에서 이 답이 얼마나 흔한가"이고, 성격은 "이 사람이 그런 답을
// 하는 사람인가"다. 둘을 곱한다 — 표를 다시 쓰지 않고도 답하는 사람이 바뀐다.
//
// 어조는 문장에서 읽는다. 60여 개 표에 태그를 손으로 달면 새 줄마다 빠뜨리기 때문에,
// 문장 자체가 근거가 되게 했다.
function toneOf(text) {
  if (/[?？]\s*$/.test(text)) return 'ask';                                  // 되묻기
  if (/(아니|안 |못 |싫|별로|그래도|난 |나는 |말고)/.test(text)) return 'deny'; // 반대·유보
  if (/(그래|맞|좋|다행|고생|축하|괜찮|대단|고마|힘들|그치|그러게|알아|이해)/.test(text)) return 'warm'; // 공감·수용
  return 'flat';                                                             // 담담한 진술
}

// 정수 나눗셈 — 음수에서도 0 쪽이 아니라 아래로 내린다(시뮬의 floorDiv과 같은 규약).
// 성격 계수가 음수라 Math.trunc를 쓰면 방향에 따라 1씩 어긋난다.
function floorDiv(a, b) { return Math.floor(a / b); }

// 축은 0~100이고 50 미만이 E·S·T·J다(sim/traits.js mbtiString). dev = 값 - 50.
// 계수는 십분율 정수 — 부동소수 없이 계산해 같은 입력이면 늘 같은 값이 나온다.
const TONE_WEIGHTS = {
  //        EI(+면 I)  SN(+면 N)  TF(+면 F)  JP(+면 P)
  ask:  { EI: -5, SN: 6, TF: 0, JP: 4 },   // 외향·직관·인식형이 더 되묻는다
  warm: { EI: -4, SN: 0, TF: 8, JP: 0 },   // 감정형이 더 받아 준다
  deny: { EI: 2, SN: 0, TF: -7, JP: -3 },  // 사고형·판단형이 더 반박한다
  flat: { EI: 5, SN: -3, TF: 0, JP: 0 },   // 내향·감각형이 짧고 담담하게 답한다
};

function personalityMult(text, mbti) {
  if (!mbti) return 100;
  const w = TONE_WEIGHTS[toneOf(text)];
  let m = 100;
  for (const axis of ['EI', 'SN', 'TF', 'JP']) {
    const v = mbti[axis];
    if (!Number.isFinite(v)) continue;
    m += floorDiv(w[axis] * (v - 50), 10);
  }
  return Math.max(40, Math.min(220, m)); // 한쪽으로 쏠려도 어떤 답도 죽지 않는다
}

// 성격으로 무게를 곱해서 고른다. 무게가 0이 되는 답은 없다(최소 1) —
// 성격이 극단이어도 "저 사람은 저런 말 절대 안 해"가 되지는 않게 한다.
function pickWP(rows, t, mbti, seed = '') {
  const scaled = rows.map((r) => [Math.max(1, floorDiv(r[0] * personalityMult(r[1], mbti), 100)), r[1]]);
  return pickW(scaled, t, seed);
}

// §22.39 질문 → 가중 응답 사슬 (사용자 지시: "질문 응답을 연결시켜서").
//
// 키는 **실제로 뱉은 문장 그대로**다. replyLine은 conversationLine과 같은 이벤트를
// 받으므로 상대가 무슨 말을 했는지 정확히 안다. 그래서 주제·분기 로직을 전혀 건드리지
// 않고 **이 표만 늘리면** 대화가 넓어진다 — 자율 사이클이 매 회차 여기에 줄을 더한다.
//
// 무게는 구어의 빈도다: 흔한 대답에 큰 수, 가끔 나오는 대답에 작은 수.
// 말투는 구어체로 — 문어체 완성문이 아니라 입에서 나오는 형태로 쓴다.
//
// 키가 실제 발화와 한 글자라도 다르면 그 사슬은 영원히 안 걸린다. QA-17이 모든 키를
// 발화 공간과 대조해 막는다 (§22.28·§22.30·§22.33에서 세 번 반복된 결함 부류다).
const QA_CHAINS = {
  // §22.95 공장·공무원 발화 4줄 신규 + 답
  '작업화가 벌써 닳았어': [[4, '얼마나 신었어?'], [3, '새로 받아야지'], [2, '발 아프겠다'], [1, '나는 몇 년 신었어']],
  '안전화 새로 받았어': [[4, '잘됐네'], [3, '편해?'], [2, '길들이는 데 시간 걸리지'], [1, '전 게 더 나았는데']],
  '민원 대기표가 오늘 백 번을 넘었어': [[4, '정신없었겠다'], [3, '무슨 일 때문에?'], [2, '사람 더 필요하네'], [1, '나도 거기 있었어']],
  '점심시간에도 창구를 못 비워': [[4, '교대로 먹어야지'], [3, '밥은 먹었어?'], [2, '그건 좀 아니지'], [1, '급하니까 그렇겠지']],
  // §22.94 프리랜서·바리스타 발화 4줄 신규 + 답
  '오늘은 카페에서 일했어': [[4, '집중 잘 돼?'], [3, '어느 카페?'], [2, '커피값이 사무실 임대료네'], [1, '나는 집이 편한데']],
  '견적 메일 쓰는 게 제일 어려워': [[4, '값 매기는 게 제일 어렵지'], [3, '얼마 부를 거야?'], [2, '깎아주지 마'], [1, '그냥 보내']],
  '단골이 오늘 안 왔어': [[4, '무슨 일 있으신가'], [3, '매일 오는 분이야?'], [2, '내일 오시겠지'], [1, '그럴 때도 있지']],
  '신메뉴 반응이 궁금해': [[4, '내가 마셔볼게'], [3, '뭐 만들었어?'], [2, '반응 좋았어?'], [1, '기존 게 낫던데']],
  // §22.93 경찰·소방 발화 4줄 신규 + 답
  '인도에 자전거 세워두는 분이 많아': [[4, '치우라고 해야지'], [3, '어디가 제일 심해?'], [2, '나도 봤어'], [1, '세울 데가 없으니까']],
  '야간 순찰은 손전등이 반이야': [[4, '어둡긴 하지'], [3, '가로등이 부족한가'], [2, '조심해서 다녀'], [1, '요즘 손전등 좋잖아']],
  '소화기 위치는 눈 감고도 안다': [[4, '든든하다'], [3, '몇 개나 있어?'], [2, '우리 집에도 하나 둬야겠네'], [1, '쓸 일이 없어야지']],
  '사다리차 점검이 오늘 일이었어': [[4, '고생했어'], [3, '얼마나 높이 올라가?'], [2, '무섭지 않아?'], [1, '한번 타보고 싶다']],
  // §22.92 교사·학생 발화 4줄 신규 + 답
  '급식 시간이 제일 시끄러워': [[4, '애들이 신나서 그렇지'], [3, '뭐 나왔어?'], [2, '귀 아프겠다'], [1, '조용한 급식실이 더 이상해']],
  '학부모 상담이 오늘 셋이야': [[4, '고생이 많다'], [3, '무슨 얘기 하셨어?'], [2, '목 아프겠네'], [1, '그게 더 어렵지']],
  '도서관 자리가 없어': [[4, '일찍 가야 하는데'], [3, '사람이 그렇게 많아?'], [2, '내 옆에 앉아'], [1, '집에서 해']],
  '조별 과제가 제일 싫어': [[5, '진짜 그래'], [3, '누구랑 하는데'], [2, '네가 다 하는 거 아니야?'], [1, '나는 조별이 편한데']],
  // §22.90 점원·경찰 발화 4줄 신규 + 답
  '오늘 문 닫고 나오는데 비가 오더라': [[4, '우산 있었어?'], [3, '비 맞고 왔구나'], [2, '고생했네'], [1, '나는 비 오는 게 좋던데']],
  '포장 상자가 모자라': [[4, '주문해야겠네'], [3, '얼마나 부족한데'], [2, '내가 좀 갖다줄까'], [1, '그냥 봉투에 담아']],
  '길 물어보는 분이 오늘만 셋이야': [[4, '표지판이 부족한가 봐'], [3, '어디를 찾던데?'], [2, '친절하게 알려줬겠지'], [1, '지도 좀 보고 다니지']],
  '자전거 도난 신고가 늘었어': [[4, '조심해야겠네'], [3, '어디서 자꾸 없어져?'], [2, '내 것도 걱정된다'], [1, '잠그면 되잖아']],
  // §22.88 은퇴·의사 발화 4줄 신규 + 답
  '손주 얘기만 나오면 말이 길어져': [[4, '들려주세요'], [3, '몇 살이에요?'], [2, '보고 싶으시겠다'], [1, '자주 오나요?']],
  '병원 다니는 게 일과가 됐어': [[4, '많이 편찮으세요?'], [3, '그래도 챙기시는 게 낫죠'], [2, '누가 같이 가요?'], [1, '저도 요즘 자주 가요']],
  '차트 정리가 진료보다 오래 걸려': [[4, '그럴 것 같아'], [3, '누가 도와주는 사람 없어?'], [2, '고생이 많다'], [1, '기록이 남아야 하니까']],
  '오늘은 큰 일 없이 지나갔어': [[5, '그게 제일 좋지'], [3, '다행이다'], [2, '한가한 날도 있구나'], [1, '내일이 문제지']],
  // §22.86 공장·정치인 발화 4줄 신규 + 답
  '오늘은 라인이 안 멈췄어': [[4, '그럼 좋은 날이네'], [3, '자주 멈춰?'], [2, '고생했어'], [1, '멈추면 쉬는 거 아니야?']],
  '교대 전에 커피 한 잔이 살려': [[4, '나도 그거 없으면 못 해'], [3, '어디서 마셔?'], [2, '카페인 너무 많이 마시지 마'], [1, '나는 차가 낫던데']],
  '숫자보다 사람 얼굴이 먼저 떠올라': [[4, '그런 마음이 필요하지'], [3, '누구 얼굴?'], [2, '그래서 결정이 어렵구나'], [1, '숫자도 봐야 해']],
  '설명할 자리가 늘 모자라': [[4, '그래서 오해가 생기지'], [3, '동네 모임에서 해보지'], [2, '들으러 갈게'], [1, '설명보다 결과지']],
  // §22.85 바리스타·간호사 발화 4줄 신규 + 답
  '라떼 아트가 오늘은 잘 나왔어': [[4, '사진 찍어두지 그랬어'], [3, '뭐 그렸는데'], [2, '나도 한 잔 마시러 갈게'], [1, '맛이 중요하지']],
  '기계가 자꾸 말썽이야': [[4, '고쳐야겠네'], [3, '얼마나 오래 썼는데'], [2, '수리비 나오겠다'], [1, '손으로 내리면 되잖아']],
  '교대 시간만 기다렸어': [[4, '고생했어'], [3, '몇 시간 했는데'], [2, '이제 좀 쉬어'], [1, '나도 그 마음 알아']],
  '보호자 설득이 더 어려울 때가 있어': [[4, '그럴 것 같아'], [3, '무슨 일 있었어?'], [2, '마음이 급해서 그렇지'], [1, '환자보다 더?']],
  // §22.84 사무직·학생 발화 4줄 신규 + 답
  '메일함이 줄지를 않아': [[4, '읽어도 또 오지'], [3, '몇 통이나 되는데'], [2, '나중에 몰아서 봐'], [1, '나는 안 읽고 지워']],
  '점심시간이 제일 짧게 느껴져': [[5, '진짜 그래'], [3, '오늘 뭐 먹었어?'], [2, '천천히 좀 먹어'], [1, '나는 거를 때가 많아']],
  '노트를 잃어버렸어': [[4, '어디서 잃어버렸는데'], [3, '분실물함 가봐'], [2, '내 거 빌려줄까'], [1, '또?']],
  '오늘 수업은 좀 재밌었어': [[4, '뭐 배웠는데'], [3, '오 웬일이야'], [2, '선생님이 잘 가르치나 봐'], [1, '나는 졸았는데']],
  // §22.83 공무원·프리랜서 발화 4줄 신규 + 답
  '규정집이 매년 두꺼워져': [[4, '누가 다 읽어'], [3, '얼마나 되는데'], [2, '고생이 많다'], [1, '그래도 있어야지']],
  '창구에서 웃는 것도 일이더라': [[4, '감정노동이지'], [3, '오늘 힘든 분 왔어?'], [2, '그래서 늘 친절하구나'], [1, '나한텐 안 웃던데']],
  '이번 달은 좀 들어왔어': [[4, '잘됐다'], [3, '얼마나?'], [2, '한턱 쏴'], [1, '다음 달이 문제지']],
  '혼자 하니까 쉬는 날도 내가 정해': [[4, '부럽다'], [3, '그래서 언제 쉬는데'], [2, '쉬긴 쉬어?'], [1, '나는 그게 더 힘들 것 같아']],
  // §22.82 요리사·점원 발화 4줄 신규 + 답
  '칼 가는 날이 제일 마음이 편해': [[4, '왠지 알 것 같아'], [3, '얼마나 자주 갈아?'], [2, '손 조심해'], [1, '나는 그거 무섭던데']],
  '남은 재료로 뭘 할지가 진짜 실력이지': [[4, '맞는 말이야'], [3, '오늘은 뭐 만들었어?'], [2, '나도 좀 배우고 싶다'], [1, '남기지 않는 게 먼저 아니야?']],
  '진열만 바꿔도 잘 나가는 게 달라져': [[4, '오 신기하네'], [3, '뭐가 제일 잘 나가?'], [2, '그런 것도 감이 있구나'], [1, '나는 늘 못 찾겠던데']],
  '단골이 찾는 물건은 외워두게 되더라': [[4, '기억력 좋다'], [3, '내 것도 알아?'], [2, '그게 장사지'], [1, '나는 단골도 아니네']],
  // §22.81 의사·교사 발화 4줄 신규 + 답
  '요즘 같은 증상이 자꾸 들어와': [[4, '유행인가?'], [3, '조심해야겠네'], [2, '뭐 때문인데?'], [1, '나도 요즘 좀 그래']],
  '설명하는 게 치료의 절반이더라': [[4, '맞는 말이야'], [3, '다들 알아들어?'], [2, '그래서 오래 걸리는구나'], [1, '설명 잘하는 의사가 드물지']],
  '한 명이 알아들으면 그날은 성공이야': [[4, '멋지다'], [3, '오늘은 몇 명?'], [2, '기준이 소박하네'], [1, '나머지는 어쩌고']],
  '목이 남아나질 않네': [[4, '따뜻한 거 마셔'], [3, '많이 떠들었구나'], [2, '쉬엄쉬엄해'], [1, '마이크라도 쓰지']],
  // §22.79 경찰·소방 발화 5줄 신규 + 답
  '사람들이 인사해줄 때가 제일 좋더라': [[4, '그 맛에 하는 거지'], [3, '동네 사람들이 알아보나 봐'], [2, '나도 인사할게'], [1, '무서워서 하는 거 아니고?']],
  '순찰 코스를 바꿔볼까 싶어': [[4, '왜, 뭐 있었어?'], [3, '좋은 생각이야'], [2, '우리 동네도 좀 들러줘'], [1, '늘 가던 데가 편하지']],
  '별일 없어도 눈은 늘 굴러가': [[4, '직업병이네'], [3, '고생이 많다'], [2, '뭐 수상한 거 봤어?'], [1, '좀 쉬면서 해']],
  '사이렌 소리에 아직도 심장이 뛴다': [[4, '그럴 만하지'], [3, '오늘 출동 있었어?'], [2, '익숙해지진 않는구나'], [1, '나는 그 소리만 들어도 무서워']],
  '훈련은 몸이 기억할 때까지 하는 거야': [[4, '멋있다'], [3, '얼마나 해?'], [2, '그래서 다들 든든하지'], [1, '몸 상하지 않게 해']],
  // §22.77 선거철 발화 4줄 신규 + 답
  '요즘 시청 앞이 시끌시끌하더라': [[4, '뭐 때문에?'], [3, '선거철이잖아'], [2, '나도 봤어'], [1, '늘 그렇지 뭐']],
  '나는 사람보다 하는 걸 봐': [[4, '그게 맞지'], [3, '누가 제일 하던데?'], [2, '말만 하는 사람 많아'], [1, '사람도 봐야지']],
  '지난번엔 뽑고 나서 후회했잖아': [[4, '그러게 말이야'], [3, '이번엔 잘 보자'], [2, '누구 얘기야'], [1, '나는 안 후회했는데']],
  '투표소 어디로 가야 해?': [[4, '시청 앞이야'], [3, '나도 몰라'], [2, '같이 가자'], [1, '공지에 붙어 있던데']],
  // §22.75 식사 발화 4줄 신규 + 답
  '여기 뭐가 제일 맛있어?': [[4, '아무거나 다 괜찮아'], [3, '나는 늘 먹던 거'], [2, '처음 왔어?'], [1, '여긴 그냥 그래']],
  '한 그릇 더 시킬까 고민 중이야': [[4, '시켜 시켜'], [3, '그만 먹어'], [2, '나눠 먹자'], [1, '배 안 불러?']],
  '아까부터 냄새가 계속 나더라': [[4, '나도 맡았어'], [3, '어디서 나는 거지'], [2, '배고파진다'], [1, '나는 모르겠는데']],
  '너 밥은 뭐로 때웠어?': [[4, '대충 먹었어'], [3, '아직 못 먹었어'], [2, '집에서 해먹었지'], [1, '왜, 사주게?']],
  // §22.71 잡담 발화 6줄 신규 — 표를 넓히고 답도 같이 단다
  '요 며칠 뭐 하고 지냈어?': [[4, '별거 없었어'], [3, '일하느라 정신없었지'], [2, '너는?'], [1, '얘기하자면 길어']],
  '지나가다 보여서 그냥 왔어': [[5, '잘 왔어'], [3, '반갑다'], [2, '무슨 일 있어?'], [1, '나 지금 바쁜데']],
  '이 시간에 여기서 다 보네': [[4, '그러게 말이야'], [3, '너야말로'], [2, '나 여기 자주 와'], [1, '오늘은 좀 늦었어']],
  '밥은 먹고 다녀?': [[4, '먹었지'], [3, '아직'], [2, '너나 잘 챙겨'], [1, '같이 먹을래?']],
  '요즘 뭐가 제일 재밌어?': [[4, '글쎄다'], [3, '요즘 낚시가 좀'], [2, '너는 뭐가 재밌는데'], [1, '재밌는 게 있나']],
  '그냥 앉아 있기 좀 그래서': [[4, '잘 나왔어'], [3, '나도 그래'], [2, '집에 있으면 답답하지'], [1, '그럴 땐 걸어']],
  // §22.69 다툼·침대·관계 변화·투표·장보기·결혼식·연심·육아
  '밤새 뚝딱거렸는데 그래도 쓸 만해': [[4, '오 대단한데'], [3, '잠은 잤어?'], [2, '보러 갈게'], [1, '튼튼하긴 해?']],
  '한 표라도 보태야지': [[4, '그럼 그럼'], [3, '누구 찍었어?'], [2, '나도 갔다 왔어'], [1, '찍을 사람이 없던데']],
  '누굴 찍을지 끝까지 고민했어': [[4, '다들 그렇지'], [3, '결국 누구?'], [2, '나도 헷갈렸어'], [1, '고민한 보람 있길']],
  '시장에서 장 좀 봐 왔어': [[4, '뭐 샀는데'], [3, '고생했네'], [2, '싸게 샀어?'], [1, '나도 갈걸']],
  // §22.64 퇴근·공사·장보기·놀이·독서·동아리·모임 소문
  '오늘 공사장에서 일 좀 거들었어': [[4, '고생했어'], [3, '뭐 짓는데?'], [2, '몸은 괜찮아?'], [1, '돈은 받았고?']],
  '짓는 걸 보고 있으면 뿌듯하더라': [[4, '그렇지'], [3, '언제 다 지어?'], [2, '나도 한번 거들어볼까'], [1, '보는 거랑 하는 건 다르지']],
  '몸은 힘든데 뭔가 남는 일이야': [[4, '그런 일이 좋은 거야'], [3, '많이 힘들어?'], [2, '내일도 나가?'], [1, '무리하지 마']],
  '살 게 많아서 한참 돌았네': [[4, '뭐 샀는데'], [3, '고생했네'], [2, '무겁겠다'], [1, '나눠서 사지 그랬어']],
  '아무 생각 없이 노는 것도 필요하더라': [[4, '맞아 맞아'], [3, '뭐 하고 놀았어?'], [2, '나도 좀 쉬어야 하는데'], [1, '너 요즘 계속 노는 것 같은데']],
  '요즘 읽는 게 있는데 꽤 재밌어': [[4, '뭔데?'], [3, '오 나도 읽어볼까'], [2, '어디서 빌렸어?'], [1, '나는 책만 펴면 졸려']],
  '사람들이랑 뭘 같이 하니 좋더라': [[4, '무슨 모임인데'], [3, '보기 좋다'], [2, '나도 껴줘'], [1, '나는 혼자가 편하던데']],
  '모임 얘기가 여기저기서 나오더라': [[4, '언제 한대?'], [3, '나도 들었어'], [2, '누가 여는 건데'], [1, '난 못 들었는데']],
  // §22.61 용기·잡담·퇴근·복지·잔치·이정표
  '오늘 좀 위험한 일이 있었는데 그냥 몸이 먼저 움직였어': [[4, '다친 데는 없어?'], [3, '무슨 일이었는데'], [2, '대단하다'], [1, '조심 좀 해']],
  '할 말이 있어서라기보단 그냥 반가워서': [[5, '나도 반가워'], [3, '오랜만이지'], [2, '얼굴 보니 좋다'], [1, '무슨 일 있는 줄 알았네']],
  '시청에서 나온 돈으로 겨우 장 봤어': [[4, '그래도 다행이야'], [3, '뭐 샀는데'], [2, '많이 빠듯해?'], [1, '나도 요즘 그래']],
  '오늘 동네에 잔치가 있었어': [[4, '어디서?'], [3, '나도 갈걸'], [2, '재밌었어?'], [1, '난 못 들었는데']],
  '다들 모여서 웃고 떠들었지': [[4, '보기 좋았겠다'], [3, '누구누구 왔어?'], [2, '나도 갔어야 했는데'], [1, '시끄러웠겠네']],
  '오늘 좀 특별한 날이야': [[4, '무슨 날인데'], [3, '축하해'], [2, '얘기해봐'], [1, '나만 몰랐네']],
  '돌아보니 여기까지 왔네': [[4, '고생 많았어'], [3, '무슨 생각 들어?'], [2, '앞으로도 잘될 거야'], [1, '갑자기 왜 그래']],
  // §22.60 연인·폭식·이별·공장·은퇴
  '요즘 당신 덕에 매일이 좋아': [[4, '나도 그래'], [3, '갑자기 왜 그래'], [2, '고마워'], [1, '무슨 부탁 있지?']],
  '네 얘기 듣는 게 제일 재밌어': [[4, '내 얘기만 하고 있었네'], [3, '진짜?'], [2, '너도 얘기해'], [1, '듣기 좋으라고 하는 말이지']],
  '오늘따라 더 좋아 보인다?': [[4, '그래?'], [3, '너도 좋아 보여'], [2, '오늘 좀 잘 잤어'], [1, '뭐 잘못했어?']],
  '이따 낚시터에서 볼래?': [[4, '좋아, 몇 시에?'], [3, '거기 뭐 잡히나'], [2, '오늘은 좀 어려워'], [1, '낚시는 지루하던데']],
  '이러다 나 큰일 나겠다': [[4, '왜 무슨 일인데'], [3, '엄살은'], [2, '진정해'], [1, '나도 그래']],
  '허기가 아니라 다른 게 고팠던 것 같아': [[4, '무슨 일 있었어?'], [3, '그런 날 있지'], [2, '얘기 좀 해봐'], [1, '나도 가끔 그래']],
  '일이 너무 많아…': [[4, '고생이다'], [3, '뭐가 그렇게 많아'], [2, '좀 나눠서 해'], [1, '나도야']],
  // §22.59 공장·정치인·은퇴·연인
  '장갑을 벗으면 손이 얼얼해': [[4, '손 좀 봐봐'], [3, '오늘 많이 했어?'], [2, '따뜻한 물에 담가'], [1, '장갑을 두 겹 껴']],
  '서서 하는 일은 다리가 먼저 안다니까': [[4, '진짜 그래'], [3, '몇 시간 서 있었는데'], [2, '좀 앉아 있어'], [1, '나는 앉아서 허리가 나가']],
  '말 한마디가 어디까지 가는지 이제 알아': [[4, '무슨 일 있었어?'], [3, '그러니까 조심해야지'], [2, '누가 옮겼는데'], [1, '그래도 할 말은 해야지']],
  '오늘은 좀 고된 날이었어': [[4, '고생했어'], [3, '무슨 일 있었어?'], [2, '푹 쉬어'], [1, '나도 그랬어']],
  '일이 손에 안 잡히는 날도 있지': [[4, '그런 날 있지'], [3, '무슨 걱정 있어?'], [2, '오늘은 그냥 쉬어'], [1, '나는 매일 그래']],
  '주말에 공원 데이트 어때?': [[5, '좋아'], [3, '몇 시에?'], [2, '날씨 봐서'], [1, '집에서 쉬면 안 될까']],
  '같이 늙어가는 거 나쁘지 않네': [[4, '나도 그렇게 생각해'], [3, '갑자기 왜 그래'], [2, '벌써 그런 소리를'], [1, '아직 멀었거든']],
  '당신이랑 있으면 하루가 짧아': [[4, '나도 그래'], [3, '오늘따라 왜 이래'], [2, '고마워'], [1, '뭐 잘못했어?']],
  '이따 시간 돼? 잠깐이라도 보자': [[4, '좋아, 언제'], [3, '어디서 볼까'], [2, '오늘은 좀 어려워'], [1, '무슨 일인데?']],
  // §22.58 간호사·공장·정치인·은퇴·육아·잡담
  '오늘 한 사람이라도 놓쳤으면 어쩔 뻔했나 싶어': [[4, '잘 넘겼으니 됐어'], [3, '많이 긴장했겠다'], [2, '무슨 일 있었어?'], [1, '너무 자책하지 마']],
  '내 실수 하나가 어떻게 되는지 아니까 늘 긴장이야': [[4, '그 마음이 프로지'], [3, '어깨에 힘 좀 빼'], [2, '실수한 적 있어?'], [1, '나는 상상도 안 된다']],
  '기계 소리가 퇴근하고도 귀에 남아': [[4, '그 정도야?'], [3, '귀마개 써봐'], [2, '고생이 많다'], [1, '나도 그런 적 있어']],
  '하나 틀리면 처음부터라 눈을 못 떼겠어': [[4, '피곤하겠다'], [3, '몇 개나 하는데'], [2, '쉬어가면서 해'], [1, '그러다 눈 나빠져']],
  '오늘도 양쪽 얘기를 다 듣고 왔어': [[4, '어느 쪽이 맞는 것 같아?'], [3, '고생이다'], [2, '그게 일이지'], [1, '결국 아무도 만족 안 하잖아']],
  '약속한 건 지켜야지, 그게 제일 어렵고': [[4, '지키면 인정해줄게'], [3, '무슨 약속인데'], [2, '말이라도 고맙다'], [1, '다들 그렇게 말하더라']],
  '가끔은 불려 나가서 뭐라도 하고 싶어': [[4, '그럼 나오세요'], [3, '뭐 하고 싶은데'], [2, '그 마음 알 것 같아'], [1, '이제 좀 쉬셔']],
  '별일은 없었는데, 그냥 얘기하고 싶어서': [[5, '잘 왔어'], [3, '그럼 얘기하자'], [2, '무슨 일 있는 거 아니지?'], [1, '나도 마침 심심했어']],
  // §22.57 인사·동아리·연애 소문·부부
  '둘이 언제부터 그랬대?': [[4, '나도 몰라'], [3, '꽤 됐다던데'], [2, '본인들한테 물어봐'], [1, '다들 알고 있었어']],
  '오늘 저녁 같이 먹을까, 여보?': [[5, '좋지'], [3, '뭐 먹을까'], [2, '오늘은 좀 늦어'], [1, '당신이 해줘']],
  '보고 싶었어!': [[5, '나도'], [3, '갑자기 왜 그래'], [2, '어제 봤잖아'], [1, '무슨 일 있었어?']],
  '들어갈 때 장 좀 봐 갈까?': [[4, '그래, 뭐 필요해?'], [3, '내가 봐 갈게'], [2, '집에 있는 것 같은데'], [1, '오늘은 그냥 가자']],
  '오늘 무슨 좋은 일 있었어?': [[4, '아니 왜?'], [3, '티 나?'], [2, '별일 없었는데'], [1, '너 보니까 좋네']],
  // §22.56 배고픔·질병·당선·복지·관계
  '지금은 뭘 줘도 맛있을 것 같아': [[4, '뭐 시킬까'], [3, '그 정도야?'], [2, '천천히 먹어'], [1, '나는 입맛이 없는데']],
  '점심을 걸렀더니 손이 떨려': [[5, '빨리 뭐 좀 먹어'], [3, '왜 걸렀는데'], [2, '내가 뭐 사올게'], [1, '나도 못 먹었어']],
  '뱃속에서 소리 나는 거 들었지…': [[4, '들었어 ㅋㅋ'], [3, '밥 먹으러 가자'], [2, '못 들은 걸로 할게'], [1, '나도 방금 났어']],
  '아 오늘 제대로 못 먹었더니 어지러워': [[4, '앉아 있어'], [3, '뭐라도 먹어야지'], [2, '무슨 일 있었어?'], [1, '나도 하루 종일 굶었어']],
  '며칠 앓았는데 이제 괜찮아': [[4, '다행이다'], [3, '고생했어'], [2, '무리하지 마'], [1, '뭐 때문에 아팠어?']],
  '나 이번에 뽑혔어. 잘해야 할 텐데': [[4, '축하해'], [3, '잘할 거야'], [2, '뭐부터 할 건데'], [1, '이제 시작이지']],
  '이번에 지원금 나왔더라. 숨통이 좀 트여': [[4, '다행이다'], [3, '얼마나 나왔는데'], [2, '나도 신청해봐야겠다'], [1, '그걸로 되겠어?']],
  // §22.55 바리스타·의사·경찰·공무원·식사·은퇴 (day0 플레이에서 답 없던 상위 발화)
  '오늘 카페 손님 미쳤었어…': [[4, '많이 바빴구나'], [3, '무슨 일 있었어?'], [2, '장사 잘되면 좋은 거지'], [1, '나도 거기 있었는데']],
  '한 명이라도 나아서 가면 그걸로 됐지': [[4, '멋지다 진짜'], [3, '오늘은 어땠어?'], [2, '그 마음이 오래 갔으면'], [1, '너부터 좀 챙겨']],
  '오늘 순찰 돌다 다리 아파 죽는 줄': [[4, '얼마나 걸었는데'], [3, '고생했어'], [2, '좀 앉아 있어'], [1, '운동 됐네 뭐']],
  '내가 만든 규칙도 아닌데 내가 설명해야 해': [[4, '그게 제일 억울하지'], [3, '오늘 뭐라고들 해?'], [2, '고생이 많다'], [1, '그래도 누군가는 해야지']],
  '오늘은 창구에 사람이 끊이질 않았어': [[4, '고생했어'], [3, '무슨 일 때문에?'], [2, '점심은 먹었어?'], [1, '요즘 다들 바쁘더라']],
  '집밥이 제일이더라': [[5, '맞아 맞아'], [3, '뭐 해먹었는데'], [2, '해주는 사람이 있어야지'], [1, '난 사 먹는 게 좋던데']],
  '먹고 나니까 살 것 같다': [[4, '많이 배고팠구나'], [3, '뭐 먹었어?'], [2, '천천히 먹어'], [1, '나도 이제 먹으러 간다']],
  '시장에서 장 봐다 해먹는 것도 좋더라': [[4, '뭐 사 왔는데'], [3, '나도 그렇게 해볼까'], [2, '시장이 싸긴 하지'], [1, '해먹는 게 더 귀찮던데']],
  '평생 하던 걸 안 하니까 손이 심심해': [[4, '뭐라도 하나 시작해봐'], [3, '그 마음 알 것 같아'], [2, '이제 좀 쉬어도 되잖아'], [1, '나랑 뭐라도 하자']],
  // §22.54 굶주림·외로움·습득·침대·도움·이웃
  '배가 고픈 걸 넘어서 이제 기운이 없다': [[5, '뭐라도 먹자, 내가 살게'], [3, '언제부터 못 먹었어'], [2, '시청 지원 받아봐'], [1, '앉아, 일단 앉아']],
  '하루 굶으니까 아무 생각도 안 나더라': [[4, '지금은 먹었어?'], [3, '그러다 쓰러져'], [2, '무슨 일 있어?'], [1, '나도 그런 적 있어']],
  '혼자 있는 게 익숙해지는 게 좀 그래': [[4, '나랑 자주 보자'], [3, '나도 그래'], [2, '익숙해지면 편하기도 해'], [1, '모임 하나 들어봐']],
  '길에 떨어진 걸 주웠는데 기분이 묘하네': [[4, '뭐 주웠는데'], [3, '주인 찾아줘야지'], [2, '횡재했네'], [1, '그냥 두지 그랬어']],
  '오늘은 운이 좀 따라주는 날인가 봐': [[4, '뭐 좋은 일 있었어?'], [3, '부럽다'], [2, '그럼 오늘 한턱 쏴'], [1, '그런 날은 조심해야 돼']],
  '손수 만들어 놓으니 이제 집 같아졌어': [[4, '오 보러 갈게'], [3, '뭐 만들었는데'], [2, '손재주 좋네'], [1, '나도 하나 해줘']],
  // §22.53 낚시·숙취·운동·일·식사
  '아까 낚시하는데 월척인 줄 알았다니까': [[4, '그래서 잡았어?'], [3, '또 놓쳤구나'], [2, '얼마나 컸는데'], [1, '낚시꾼 얘기는 반만 믿어']],
  '물가에 앉아 있으면 시간 가는 줄 몰라': [[4, '나도 가끔 그래'], [3, '거기 어디야?'], [2, '모기 안 물려?'], [1, '집에서도 그러던데']],
  '어제 한잔이 두잔 되고… 오늘 하루 다 갔다': [[4, '맨날 그러더라'], [3, '좀 괜찮아?'], [2, '누구랑 마셨는데'], [1, '나도 어제 그랬어']],
  '술기운에 별 얘길 다 했나 봐': [[4, '무슨 얘기 했는데'], [3, '기억 안 나?'], [2, '괜찮아, 다들 그래'], [1, '나한테도 했어']],
  '며칠 쉬었더니 몸이 무겁더라': [[4, '다시 시작하면 돼'], [3, '얼마나 쉬었는데'], [2, '나는 계속 무거워'], [1, '오늘 같이 뛸래?']],
  '오늘 일 진짜 많았어…': [[5, '고생했어'], [3, '무슨 일이 그렇게 많았어?'], [2, '나도 오늘 그랬어'], [1, '내일은 좀 낫겠지']],
  '혼자 먹었는데도 맛있더라': [[4, '뭐 먹었는데'], [3, '혼밥도 나쁘지 않지'], [2, '다음엔 같이 먹자'], [1, '혼자 먹으면 맛이 덜하던데']],
  '오늘은 대충 차렸는데 그게 더 맛있네': [[4, '원래 그래'], [3, '뭐 차렸는데'], [2, '배고파서 그런 거야'], [1, '나도 좀 줘']],
  '집에서 먹으면 마음이 편해': [[4, '그치, 집이 최고야'], [3, '설거지는 누가 해?'], [2, '나는 나가서 먹는 게 편한데'], [1, '오늘 뭐 해먹었어']],
  // §22.52 낚시·술자리·운동·퇴근·쾌유·당선·시정
  '오늘 낚시터에서 손맛 좀 봤지~': [[4, '뭐 잡았는데'], [3, '오 부럽다'], [2, '몇 마리?'], [1, '또 놓친 얘기 아니지?']],
  '낚싯대만 담가놔도 마음이 조용해져': [[4, '나도 한번 가볼까'], [3, '그게 낚시 맛이지'], [2, '잡히긴 해?'], [1, '나는 지루해서 못 해']],
  '어제 그렇게 웃어본 거 오랜만이야': [[4, '뭐가 그렇게 웃겼는데'], [3, '좋았겠다'], [2, '누구랑 마셨어?'], [1, '술 때문에 웃긴 거 아니고?']],
  '오늘 공원에서 운동했는데 개운하다!': [[4, '오 부지런하네'], [3, '뭐 했는데'], [2, '나도 같이 하자'], [1, '나는 숨쉬기 운동만']],
  '운동하고 나면 밥이 두 배로 맛있어': [[4, '그래서 살이 안 빠지는 거야'], [3, '맞아 진짜'], [2, '오늘 뭐 먹을 거야'], [1, '그럼 밥 사']],
  '일 끝내고 앉으니 이제야 숨 쉬는 것 같아': [[4, '고생했어'], [3, '오늘 많이 바빴어?'], [2, '푹 쉬어'], [1, '내일 또 해야지 뭐']],
  '병원 다녀오고 나니 훨씬 낫다': [[4, '다행이다'], [3, '뭐래?'], [2, '약은 잘 챙겨 먹고'], [1, '진작 가지']],
  '맡겨준 만큼은 해야지': [[4, '그래 잘해봐'], [3, '뭐부터 할 건데'], [2, '말은 쉽지'], [1, '기대할게']],
  '동네가 조금씩 바뀌는 게 보여': [[4, '뭐가 바뀌었는데'], [3, '나도 느꼈어'], [2, '글쎄, 나는 잘 모르겠어'], [1, '바뀐 게 좋은 거야?']],
  // §22.51 다툼·낚시·숙취·운동·퇴근·쾌유·당선
  '오늘은 입질이 영 없더라': [[4, '그런 날 있지'], [3, '자리를 옮겨봐'], [2, '뭐 썼는데'], [1, '고기가 다 어디 갔대']],
  '해장이 급하다 진짜': [[4, '얼마나 마셨어'], [3, '국밥 먹으러 가자'], [2, '자업자득'], [1, '나도 어제 그랬어']],
  '땀 빼고 나니까 머리가 맑아': [[4, '부럽다'], [3, '뭐 했는데'], [2, '나도 내일 같이 가'], [1, '나는 뛰면 더 어지러워']],
  '오늘은 좀 무리했나 봐. 다리가 후들거려': [[4, '쉬엄쉬엄 해'], [3, '얼마나 했는데'], [2, '내일 근육통 오겠다'], [1, '그게 운동한 맛이지']],
  '드디어 오늘치 일 끝냈다': [[5, '고생했어'], [3, '오늘 많았어?'], [2, '한잔할래?'], [1, '나는 아직이야']],
  '퇴근길 공기가 제일 달아': [[4, '진짜 그래'], [3, '오늘 몇 시에 끝났어?'], [2, '출근길은 왜 안 그럴까'], [1, '집에 가면 또 일이지']],
  '아프고 나니 건강이 최고인 걸 알겠어': [[4, '이제 괜찮아?'], [3, '그러게, 건강이 최고야'], [2, '뭘 잘못 먹었어?'], [1, '나도 요즘 몸이 안 좋아']],
  '표를 받고 나니 어깨가 무겁다': [[4, '잘할 거야'], [3, '축하해'], [2, '뭐부터 할 거야?'], [1, '기대할게, 지켜본다']],
  // §22.50 직업 푸념 4차(사무·바리스타·프리랜서·의사·교사·소방관·점원·공무원)
  '자리에 앉자마자 퇴근하고 싶어': [[5, '나도'], [3, '아직 아침이야'], [2, '오늘 뭐 힘든 일 있어?'], [1, '그럼 퇴근해']],
  '이번 달만 버티면 좀 나아지려나': [[4, '그 말 지난달에도 했어'], [3, '좀 나아질 거야'], [2, '뭐가 바뀌는데?'], [1, '버티는 게 어디야']],
  '원두 냄새가 꿈에 나올 지경이야': [[4, '좋은 냄새잖아'], [3, '그 정도야?'], [2, '나는 하루 종일 맡고 싶은데'], [1, '휴가 좀 써']],
  '이번 건 끝나면 좀 쉬려고': [[4, '언제 끝나는데'], [3, '꼭 쉬어'], [2, '지난번에도 그랬잖아'], [1, '쉬면 뭐 할 거야']],
  '오늘 환자가 끊이질 않았어': [[4, '고생했어'], [3, '무슨 일 있어? 다들 아픈 거야?'], [2, '밥은 먹었고?'], [1, '환절기라 그래']],
  '가르치다 보면 내가 배워': [[4, '멋진 말이다'], [3, '오늘은 뭘 배웠는데'], [2, '애들이 그렇게 가르쳐?'], [1, '그래도 월급은 네가 받잖아']],
  '장비 점검만 해도 하루가 가': [[4, '그게 제일 중요한 거지'], [3, '뭐 점검하는데'], [2, '출동 없었으면 됐어'], [1, '지루하겠다']],
  '재고 정리하다 하루 다 갔어': [[4, '많이 들어왔어?'], [3, '허리 아프겠다'], [2, '그거 다 세는 거야?'], [1, '나도 도와줄까']],
  '천천히라도 되게 만드는 게 내 일이지': [[4, '그래도 되긴 되네'], [3, '뭐가 그렇게 느린데'], [2, '고맙다 진짜'], [1, '좀 빨리 되게 해봐']],
  // §22.49 폭식·칩거·용기·직업 푸념 3차
  '먹고 나서 오히려 마음이 안 좋더라': [[4, '왜, 너무 많이 먹었어?'], [3, '그럴 때 있지'], [2, '뭐 속상한 일 있어?'], [1, '다음엔 같이 먹자']],
  '나가기가 싫어서 계속 누워 있었어': [[4, '오늘은 나왔네'], [3, '괜찮아?'], [2, '그런 날도 있지'], [1, '그러다 몸 굳어']],
  '무섭긴 했는데 가만있을 수가 없더라': [[4, '대단하다'], [3, '다친 데는 없어?'], [2, '나였으면 못 했을 거야'], [1, '다음엔 조심해']],
  '회사 일이 끝이 없다 끝이 없어…': [[4, '원래 그래'], [3, '뭐가 그렇게 많아'], [2, '나도 마찬가지야'], [1, '그만둬']],
  '서서 일하니 다리가 남아나질 않네': [[4, '앉아서 좀 쉬어'], [3, '몇 시간 서 있었는데'], [2, '나도 그래'], [1, '편한 신발 신어']],
  '출퇴근이 없는 대신 퇴근도 없어': [[4, '그게 제일 무섭지'], [3, '몇 시에 끝나는데'], [2, '그래도 자유롭잖아'], [1, '시간 정해놓고 해']],
  '학교 급식이 그래도 낫더라': [[4, '오늘 뭐 나왔어?'], [3, '그치 급식이 최고야'], [2, '나는 집밥이 나은데'], [1, '맛없는 날도 있잖아']],
  '오늘 재료가 좋더라고': [[4, '뭐 들어왔는데'], [3, '그럼 오늘 맛있겠네'], [2, '나 먹으러 갈게'], [1, '비싼 거 아니야?']],
  '서류 한 장 넘기는 데 도장이 몇 개인지 몰라': [[4, '몇 개인데'], [3, '그게 다 절차지'], [2, '나도 신청하다 지쳤어'], [1, '좀 줄여봐']],
  // §22.48 칩거·구조·육아·과제·요리사·간호사·은퇴
  '며칠 집에만 있었어': [[4, '무슨 일 있어?'], [3, '나와서 바람 좀 쐬'], [2, '가끔은 그래도 돼'], [1, '나도 그럴 때 있어']],
  '사람 만나는 게 버거운 날이 있더라': [[4, '있지, 그런 날'], [3, '오늘은 괜찮아?'], [2, '무리하지 마'], [1, '그래도 나왔네']],
  '다들 무사해서 다행이야': [[5, '진짜 다행이다'], [3, '무슨 일이었는데'], [2, '너는 괜찮아?'], [1, '대단하다 너']],
  '과제가 산더미야…': [[4, '언제까진데'], [3, '빨리 해'], [2, '나도 밀렸어'], [1, '나눠서 해']],
  '불 앞에 있으면 여름이 두 배야': [[4, '고생이다'], [3, '물 많이 마셔'], [2, '그래도 맛있게 해줘'], [1, '겨울엔 좋겠네']],
  '퇴근하고도 아까 그 환자 생각이 나': [[4, '많이 안 좋았어?'], [3, '그런 마음이 좋은 간호사 만드는 거야'], [2, '집에선 좀 내려놔'], [1, '나도 그럴 때 있어']],
  '이제야 아침 해를 제대로 봐': [[4, '좋겠다'], [3, '몇 시에 일어나는데'], [2, '나는 아직 못 봐'], [1, '그게 그렇게 좋아?']],
  // §22.47 잡담·은퇴·공장 노동·공무원·식사·부부
  '오늘 뭐 했어? 난 별거 없었어': [[5, '나도 별거 없었어'], [3, '일했지 뭐'], [2, '그게 제일 좋은 거야'], [1, '별거 없는 게 어딨어, 말해봐']],
  '이런 날은 그냥 사람 얼굴 보는 게 좋더라': [[4, '그러게'], [3, '나도 나오길 잘했다'], [2, '무슨 일 있어?'], [1, '나 얼굴 보러 온 거야?']],
  '일 안 하니 하루가 길어. 그것도 적응이 필요하더라': [[4, '부럽다'], [3, '뭐 하면서 지내?'], [2, '취미 하나 만들어봐'], [1, '나는 얼른 그러고 싶어']],
  '바쁠 땐 몰랐는데 사람이 그립더라': [[4, '자주 나와'], [3, '나도 그래'], [2, '모임 같은 데 나가봐'], [1, '그래서 나 보러 왔구나']],
  '하루 종일 같은 동작만 하니까 팔이 내 것 같지가 않아': [[4, '푹 쉬어'], [3, '몇 시간이나 했는데'], [2, '파스 붙여'], [1, '나도 어깨 나갔어']],
  '민원 앞에서는 규정이 방패이자 벽이야': [[4, '그건 진짜 그렇지'], [3, '오늘 힘든 민원 있었어?'], [2, '나도 창구에서 답답했던 적 있어'], [1, '그래도 규정은 규정이지']],
  '배고파 죽겠어… 뭐라도 먹자': [[5, '그래 가자'], [3, '뭐 먹을래'], [2, '나 방금 먹었는데'], [1, '돈 있어?']],
  '여기 커피 진짜 맛있지 않아?': [[4, '어 맛있다'], [3, '나는 좀 쓰던데'], [2, '뭐 시켰어?'], [1, '집에서 타 먹는 게 낫지']],
  '오늘 하루 어땠어?': [[4, '그냥 그랬어'], [3, '피곤해'], [2, '좋았어, 너는?'], [1, '얘기하자면 길어']],
  // §22.46 기억 공유 2차(일·집밥·습득·침대·도움·공사·독서·동아리·고비)
  '오늘은 손이 착착 맞더라': [[4, '그런 날 있지'], [3, '뭐 했는데'], [2, '부럽다, 난 꼬였어'], [1, '내일도 그러면 좋겠네']],
  '장 봐다 해먹으니 돈이 덜 들더라': [[4, '확실히 그렇지'], [3, '얼마나 아껴져?'], [2, '시간이 더 들잖아'], [1, '나는 귀찮아서 못 해']],
  '오늘 길에서 돈 주웠다? 완전 럭키': [[4, '얼마?'], [3, '오 좋겠다'], [2, '주인 찾아줘야지'], [1, '한턱 쏴']],
  '집에 침대 하나 새로 만들었어. 뿌듯해': [[4, '직접 만든 거야?'], [3, '오 손재주 있네'], [2, '튼튼해?'], [1, '나도 하나 만들어줘']],
  '동네 공사에 손 보태고 왔어': [[4, '고생했어'], [3, '뭐 짓는 거야?'], [2, '나도 내일 갈까'], [1, '몸 괜찮아?']],
  '도서관에 앉아 있으면 시간이 잘 가': [[4, '나도 가끔 가'], [3, '뭐 읽는데'], [2, '조용해서 좋지'], [1, '나는 거기 가면 잠 와']],
  '처음엔 어색했는데 이제 갈 만해': [[4, '다 그렇지'], [3, '사람들은 어때?'], [2, '나도 가볼까'], [1, '벌써 적응했어?']],
  '한 고비 넘긴 것 같아': [[4, '고생했다'], [3, '무슨 일 있었어?'], [2, '다음 고비도 잘 넘길 거야'], [1, '한잔해야겠네']],
  // §22.45 기억 공유(집밥·복지·시정·장보기·독서·동아리·잔치·결혼식)
  '요즘 집밥 해먹는데 생각보다 할 만해': [[4, '오 뭐 해먹었어'], [3, '나도 해볼까'], [2, '설거지가 문제지'], [1, '나는 사 먹는 게 편해']],
  '지원이 없었으면 이번 달 못 넘겼어': [[4, '다행이다'], [3, '요즘 많이 힘들어?'], [2, '나도 신청해볼까'], [1, '다음 달은 어쩌려고']],
  '요즘 시청이 일을 좀 하는 것 같지 않아?': [[4, '글쎄다'], [3, '뭐가 달라졌는데'], [2, '길은 좀 나아졌지'], [1, '선거 앞이라 그래']],
  '필요한 것만 사려고 했는데 또 이만큼이야': [[5, '맨날 그렇지'], [3, '뭘 그렇게 샀어'], [2, '나도 어제 그랬어'], [1, '장바구니 들고 가봐']],
  '한 권 끝냈어. 뿌듯하네': [[4, '뭐 읽었는데'], [3, '오 대단하다'], [2, '재밌었어?'], [1, '나는 한 장도 못 넘겨']],
  '나 모임 하나 들었어': [[4, '무슨 모임?'], [3, '오 좋다'], [2, '나도 껴줘'], [1, '시간은 나고?']],
  '이런 날이 자주 있으면 좋겠다': [[5, '그러게'], [3, '다음엔 언제래?'], [2, '자주 하면 질려'], [1, '준비하는 사람은 힘들겠지']],
  // §22.44 굶주림·외로움·복지·정책·물가 (이웃·연애·이별 발화는 QA-17 스윕에 안 잡혀 제외)
  '오늘 하루종일 아무것도 못 먹었어': [[5, '지금이라도 뭐 좀 먹어'], [3, '왜, 무슨 일 있어?'], [2, '내가 뭐 사줄까'], [1, '그러다 쓰러져']],
  '먹을 걸 살 돈이 모자랐어': [[4, '얼마나 모자라'], [3, '시청에 지원 신청해봐'], [2, '내가 좀 보태줄게'], [1, '요즘 다들 그래']],
  '요즘 하루에 한마디도 안 할 때가 있어': [[4, '나랑 이렇게 얘기하잖아'], [3, '나도 그럴 때 있어'], [2, '모임 같은 데 나가봐'], [1, '그게 편할 때도 있지']],
  '없는 것보단 낫지만 빠듯해': [[4, '그래도 나온 게 어디야'], [3, '얼마 나왔는데'], [2, '다들 빠듯하지'], [1, '더 올려야 돼']],
  '정책이 바뀌었다던데 체감은 아직이야': [[4, '나도 아직'], [3, '뭐가 바뀐 건데'], [2, '시간이 좀 걸리겠지'], [1, '난 좀 다른 것 같던데']],
  '요즘 물가가 만만치 않더라': [[5, '진짜 너무 올랐어'], [3, '뭐가 제일 올랐어?'], [2, '장 볼 때마다 놀라'], [1, '그래도 여긴 나은 편이야']],
  // §22.43 직업 푸념 2차(사무·학생·프리랜서·바리스타·경찰·소방관·점원)
  '회의가 회의를 부르더라': [[4, '그거 진짜 뭐야'], [3, '몇 개나 했는데'], [2, '회의가 일이지'], [1, '그냥 빠져']],
  '졸업하면 뭐 하지': [[4, '글쎄다'], [3, '나도 몰라'], [2, '일단 놀아'], [1, '벌써 그 생각해?']],
  '어제 밤새웠어. 지금 정신이 없어': [[4, '가서 자'], [3, '뭐 하느라'], [2, '커피라도 마셔'], [1, '나도 밤샜어']],
  '혼자 일하니 말할 사람이 없다': [[4, '나랑 얘기하면 되지'], [3, '그래서 나온 거야?'], [2, '그게 편할 때도 있잖아'], [1, '카페 가서 일해봐']],
  '단골 얼굴은 이제 다 외웠지': [[4, '내 얼굴도?'], [3, '몇 명이나 되는데'], [2, '대단하다'], [1, '이름은 몰라도?']],
  '동네가 조용해서 다행이야': [[5, '그러게'], [3, '요즘 아무 일도 없지?'], [2, '너무 조용한 것도 심심하지'], [1, '덕분이지']],
  '연기 냄새는 익숙해지질 않아': [[4, '그건 익숙해지면 안 되는 거야'], [3, '오늘 출동했어?'], [2, '옷에 배지 않아?'], [1, '고생 많다']],
  '계산 실수 안 하려고 늘 긴장해': [[4, '실수한 적 있어?'], [3, '그러다 병나'], [2, '기계가 해주잖아'], [1, '나는 맨날 틀려']],
  // §22.42 직업 푸념(사무·바리스타·학생·의사·경찰·점원·요리사) + 배고픔
  '오늘도 야근각이야': [[4, '또?'], [3, '고생이다'], [2, '나도야'], [1, '그냥 퇴근해버려']],
  '월급날만 기다린다': [[5, '나도'], [3, '며칠 남았어?'], [2, '받아도 금방 없어져'], [1, '그 돈으로 뭐 하게']],
  '주문 밀릴 때는 손이 네 개였으면 좋겠어': [[4, '오늘 그렇게 바빴어?'], [3, '알바 더 뽑아야겠네'], [2, '나도 그런 날 있어'], [1, '그래도 손님 있는 게 어디야']],
  '시험 기간 진짜 싫다': [[4, '언제까진데'], [3, '나도 싫어'], [2, '공부는 했어?'], [1, '끝나면 뭐 할 거야']],
  '밥 먹을 틈도 없었다니까': [[4, '지금이라도 먹어'], [3, '환자가 그렇게 많았어?'], [2, '몸 상한다'], [1, '그래도 대단하다']],
  '별일 없는 게 제일 좋은 거야': [[5, '그렇지'], [3, '오늘은 조용했어?'], [2, '심심하진 않고?'], [1, '그래도 뭐 있긴 하지']],
  '손님이 물어보는 게 다 달라': [[4, '뭘 그렇게 물어봐'], [3, '외우기도 힘들겠다'], [2, '나도 자주 물어보는데'], [1, '그게 일이지 뭐']],
  '맛있게 먹었다는 말 들으면 힘나': [[4, '오늘 그런 말 들었어?'], [3, '나도 잘 먹었어'], [2, '그 맛에 하는 거지'], [1, '나한테도 한 번 해줘']],
  // §22.41 아이·교사·프리랜서·소방관 푸념 + 쾌유
  '애들이 오늘따라 말을 안 듣더라': [[4, '그런 날이 있지'], [3, '날씨 탓인가'], [2, '몇 반이 그래?'], [1, '나는 애들이 제일 무서워']],
  '수업 준비가 수업보다 오래 걸려': [[4, '그게 원래 그래'], [3, '몇 시간이나 걸리는데'], [2, '고생 많다'], [1, '그냥 대충 하면 안 돼?']],
  '일감이 들쭉날쭉해서 불안해': [[4, '그게 제일 힘들지'], [3, '요즘은 어때'], [2, '그래도 자유롭잖아'], [1, '취직할 생각은 없고?']],
  '마감이 코앞인데 잠이 온다': [[4, '커피 마셔'], [3, '언제까진데'], [2, '자고 하는 게 나아'], [1, '나도 그래']],
  '출동 없는 날이 제일 좋은 날이지': [[5, '그렇지'], [3, '오늘은 조용했어?'], [2, '그래도 심심하지 않아?'], [1, '다들 덕분에 편히 자']],
  '이제 좀 살 것 같아. 다 나았어': [[5, '다행이다'], [3, '고생했어'], [2, '무리하지 마'], [1, '뭐가 잘 들었어?']],
  // §22.40 식사·간호사·정치인 — 라이브 상위 주제 중 답이 없던 발화
  '요즘 뭐 맛있는 거 먹었어?': [[4, '딱히… 맨날 먹던 거'], [3, '어제 국수 먹었는데 괜찮더라'], [2, '너부터 말해봐'], [1, '먹을 게 뭐가 있어야지']],
  '식당 새로 생긴 거 가봤어?': [[4, '아직'], [3, '어 가봤어, 괜찮던데'], [2, '거기 어디야?'], [1, '비싸다며']],
  '다음엔 같이 밥 먹자': [[5, '그래 그러자'], [3, '언제?'], [2, '네가 사는 거지?'], [1, '요즘 시간이 안 나네']],
  '화내는 분들 상대하는 게 제일 지쳐': [[4, '그건 진짜 힘들지'], [3, '어떻게 참아'], [2, '고생이 많다'], [1, '그래도 고맙다는 사람도 있잖아']],
  '손 씻다가 하루가 다 가는 것 같아': [[4, '손 다 트겠다'], [3, '그게 일이지 뭐'], [2, '몇 번이나 씻는데?'], [1, '나는 하루 두 번도 안 씻어']],
  '모두를 만족시키는 답은 애초에 없더라': [[4, '그건 그래'], [3, '그래도 해야지'], [2, '누가 제일 서운해해?'], [1, '그래서 다들 욕하잖아']],
  '결정하고 나면 꼭 누군가는 서운해해': [[4, '어쩔 수 없지'], [3, '그 자리가 원래 그래'], [2, '이번엔 누구야'], [1, '나도 좀 서운했어']],
  '둘이 사귄다는 게 사실이야?': [[4, '어 맞대'], [3, '나도 들은 얘기라…'], [2, '본인들은 아직 말 안 했어'], [1, '아니라던데?']],
  '너는 누구 생각하고 있어?': [[4, '아직 안 정했어'], [3, '음… 비밀'], [2, '너는?'], [1, '나는 정했지']],
  '다들 뭐라고들 해?': [[4, '반반이야'], [3, '다들 말을 아끼더라'], [2, '나한텐 얘기 안 해'], [1, '얘기 많지 뭐']],
  '오늘 학교에서 재밌는 일 있었다?': [[4, '뭔데뭔데'], [3, '오 얘기해봐'], [2, '재밌었겠다'], [1, '또 뭐 사고 쳤어?']],
  '좋은 날이지? 안 그래?': [[5, '응 좋아'], [3, '그러게'], [2, '딱 좋다'], [1, '난 더운데']],
  '많이 온다, 그치?': [[5, '많이 오네'], [3, '엄청 와'], [2, '금방 그치겠지'], [1, '난 비 좋아']],
  '비 올 것 같은데 우산 챙겼어?': [[4, '아, 안 챙겼는데'], [3, '어 챙겼어'], [2, '뛰면 되지'], [1, '같이 쓰자']],
  '우산 챙겨왔어? 밖에 비 많이 와': [[4, '아니, 같이 쓰자'], [3, '어 있어'], [2, '좀 있다 가려고'], [1, '그냥 맞고 갈래']],
  '해 있을 때 좀 걷자': [[4, '좋지, 어디로?'], [3, '그래 나가자'], [2, '조금만'], [1, '난 좀 이따']],
  '덥긴 덥다': [[5, '덥다 진짜'], [3, '그늘 가자'], [2, '어제보단 낫지'], [1, '난 괜찮은데']],
  // §22.34 정치 얘기는 의견을 말하는 자리가 아니라 관리하는 자리다 — 유보·동조에
  // 큰 무게를, 딱 잘라 말하는 답에 작은 무게를 준다. 라이브 439건(2위)인데
  // 답이 하나도 안 달려 있었다.
  '나는 아직 마음을 못 정했어': [[4, '나도'], [3, '아직 시간 있잖아'], [2, '뭐 보고 정할 건데?'], [1, '난 정했어']],
  '글쎄… 누가 되든 크게 다를까 싶기도 하고': [[4, '그런 면도 있지'], [3, '그래도 다르긴 다르더라'], [2, '해봐야 아는 거고'], [1, '난 다르다고 봐']],
  '좋은 말이야 다들 하니까': [[5, '그러니까'], [3, '말은 다 잘하지'], [2, '해놓고 봐야지'], [1, '그래도 안 하는 것보단 낫잖아']],
  '뽑아놓고 봐야 아는 거지 뭐': [[4, '맞는 말이야'], [3, '그게 제일 맞지'], [2, '그래도 좀 보고 뽑아야지'], [1, '난 미리 좀 알아봤어']],
  '동네 일은 동네 사람이 제일 잘 알지': [[5, '그건 맞지'], [3, '그러게 말이야'], [2, '꼭 그렇지도 않더라'], [1, '누가 하든 비슷하지 않나']],
  '누가 되든 세금 얘기는 하겠지': [[4, '안 할 수가 없지'], [3, '그 얘기 나오면 다들 조용해지더라'], [2, '올린단 얘긴 없던데'], [1, '난 좀 내려줬으면']],
  '공약보다 길이 언제 포장되는지가 궁금해': [[4, '그게 제일 급하지'], [3, '우리 쪽은 아직이야'], [2, '요즘 좀 하는 것 같던데'], [1, '말만 하고 안 하더라']],
  '우리 동네까지 신경 써줄 사람이면 좋겠어': [[4, '그러게'], [3, '여기까진 잘 안 오지'], [2, '말이라도 좀 해줬으면'], [1, '이번엔 다르지 않을까']],
  '이번엔 투표 꼭 하자': [[5, '그래 가자'], [3, '당연하지'], [2, '몇 시까지 하더라?'], [1, '난 좀 고민 중이야']],
  // 아이의 '일'은 학교와 숙제다(§22.33). 라이브 76건.
  // 받는 쪽은 어른일 수도 또래일 수도 있으니 훈수와 맞장구를 섞는다.
  '숙제 다 하면 놀아도 된댔어': [[4, '그럼 얼른 해야지'], [3, '뭐 하고 놀 건데?'], [2, '많이 남았어?'], [1, '같이 해줄까?']],
  '받아쓰기 또 틀렸어…': [[4, '괜찮아, 다음에 잘 보면 되지'], [3, '몇 개 틀렸는데?'], [2, '나도 어릴 때 그랬어'], [1, '자꾸 쓰다 보면 늘어']],
  '빨리 커서 어른 되고 싶어': [[4, '천천히 커도 돼'], [3, '어른도 별거 없어'], [2, '왜? 뭐 하고 싶은데?'], [1, '지금이 제일 좋을 때야']],
  '학교 끝나고 뭐 할지 벌써 정했어': [[4, '오 뭔데?'], [3, '좋겠다'], [2, '숙제는 하고?'], [1, '나도 같이 갈까?']],
  // 아픈 얘기는 진지한 자리다 — 농담 없이 담백하게, 걱정과 권유 위주로.
  // 라이브 82건으로 memory_share 중 최다.
  '요 며칠 몸이 안 좋아. 자꾸 처지네': [[4, '무리하지 마'], [3, '좀 쉬어야겠다'], [2, '병원은 가봤어?'], [1, '나도 요즘 그래']],
  '아침부터 몸살 기운이 있어': [[4, '오늘은 일찍 들어가'], [3, '약은 먹었어?'], [2, '푹 자야 낫지'], [1, '따뜻하게 입고 다녀']],
  '병원에 가봐야 하나 싶어': [[4, '가보는 게 낫지'], [3, '미루지 말고 가'], [2, '많이 안 좋아?'], [1, '같이 가줄까?']],
  '쉬어도 낫질 않아서 걱정이야': [[4, '그럼 진료를 받아보자'], [3, '오래 가네…'], [2, '무슨 증상인데?'], [1, '너무 걱정하진 마']],
  // 흐린 날 (라이브 109건). §22.38 교감적 언어사용 — 날씨 응답은 동의가 기본이라
  // 맞장구에 큰 무게, 딴소리에 작은 무게를 준다.
  '날이 꾸물꾸물하네': [[5, '그러게'], [3, '비 오려나'], [2, '이런 날씨 딱 싫은데'], [1, '난 이런 날이 좋아']],
  '흐린 날엔 괜히 기분도 가라앉아': [[4, '나도 좀 그래'], [3, '날씨 탓이지 뭐'], [2, '커피라도 한잔할까'], [1, '난 별로 안 그렇던데']],
  '이런 날은 딱 낮잠인데': [[5, '그러게 말이야'], [3, '자고 싶다'], [2, '나 어제 낮잠 잤어'], [1, '자면 밤에 못 자']],
  '해가 안 보이니 시간 감각이 없다': [[4, '지금 몇 시지?'], [3, '나도 방금 그 생각 했어'], [2, '벌써 이렇게 됐네'], [1, '난 배고프면 알아']],
  '구름이 낮게 깔렸어': [[4, '한바탕 오려나'], [3, '우산 챙겨야겠다'], [2, '무겁게 껴 있네'], [1, '금방 걷힐 것 같은데']],
  '뭐 이런 날도 있는 거지': [[5, '그렇지 뭐'], [3, '맞아'], [2, '내일은 개겠지'], [1, '난 좀 답답해']],
  '흐리네': [[5, '흐리다'], [3, '응 흐려'], [2, '비 올까?'], [1, '선선해서 좋은데']],
  // 연애 소식 (라이브 420건, 2위). 이름이 안 들어가는 유일한 고정문이다.
  '어쩐지 요즘 표정이 좋더라니': [[5, '그러게 말이야'], [3, '티가 나더라'], [2, '좋을 때지'], [1, '난 전혀 몰랐어']],
  // 임기 중 정치 얘기 (라이브 314건, 2위). 유세 때와 같은 §22.34 원칙 — 평가를
  // 유보하는 답에 큰 무게, 딱 잘라 평가하는 답에 작은 무게.
  '새 시장 됐다며? 공사가 빨라진대': [[4, '그래? 아직 모르겠던데'], [3, '빨라지면 좋고'], [2, '두고 봐야지'], [1, '벌써 티가 나?']],
  '시장님 공약 기억하지?': [[4, '뭐였더라'], [3, '세금 얘기 아니었나'], [2, '지키나 보자'], [1, '난 안 믿어']],
  '요즘 길이 좀 나아진 것 같지 않아?': [[4, '그런가?'], [3, '우리 쪽은 그대로야'], [2, '좀 그렇긴 해'], [1, '진짜 포장했더라']],
  '세금 얘기 나오면 다들 조용해지더라': [[5, '그러니까'], [3, '말해 봤자지'], [2, '낼 건 내야지 뭐'], [1, '난 할 말 많은데']],
  '나라 일은 몰라도 동네 일은 눈에 보이잖아': [[5, '그건 맞지'], [3, '보이니까 더 답답해'], [2, '그래서 더 신경 쓰이지'], [1, '보여도 어쩌겠어']],
  '바뀌고 나서 좀 나아졌나? 나는 잘 모르겠던데': [[4, '나도 잘 모르겠어'], [3, '시간이 좀 필요하겠지'], [2, '딱히 달라진 건 없어'], [1, '조금은 나아졌어']],
  '기대는 안 했는데 그래도 뭔가는 하네': [[4, '그러게 뭔가 하긴 해'], [3, '안 하는 것보단 낫지'], [2, '뭘 했는데?'], [1, '그것도 못 하면 큰일이지']],
  '평가는 임기 끝나고 하는 거지': [[5, '그렇지'], [3, '맞아, 두고 보자'], [2, '그때 가서 뭘 평가해'], [1, '난 지금도 할 수 있는데']],
  '나쁘다는 소리는 아직 못 들었어': [[4, '나도'], [3, '아직 초반이니까'], [2, '좋다는 소리도 못 들었지만'], [1, '나쁜 소리 나올 게 없지']],
  // 가족 얘기 (child 157 · parent 96). §22.35의 부류를 지킨다 — 화목한 말엔 맞장구,
  // 소원한 말엔 가볍게 넘기지 않는 답, 후회 섞인 말엔 위로. 농담은 넣지 않는다.
  '애가 크니까 내가 늙는 게 보이더라': [[4, '그러게, 시간 참 빨라'], [3, '우리도 늙는 거지 뭐'], [2, '아직 젊어'], [1, '애가 몇 살인데?']],
  '애 키우는 게 보통이 아니야': [[5, '고생 많다 진짜'], [3, '그래도 예쁘잖아'], [2, '요즘 제일 힘든 게 뭐야?'], [1, '나는 엄두도 안 나']],
  '크고 나니 각자 사는 것 같기도 하고': [[4, '그맘때가 다 그렇더라'], [3, '그래도 한집에 있잖아'], [2, '먼저 말 걸어봐'], [1, '나도 그랬어, 지나가']],
  '부모님이 어제 집밥 해주셨어': [[5, '좋겠다'], [3, '뭐 해주셨는데?'], [2, '그 밥이 제일이지'], [1, '나도 오랜만에 가봐야겠다']],
  '가족은 있을 때 잘해야 하는데': [[4, '그 말이 맞지…'], [3, '지금이라도 하면 되지'], [2, '나도 요즘 그 생각 해'], [1, '연락 한번 드려']],
  '요즘 자주 못 찾아뵀네': [[4, '가까울수록 더 그렇더라'], [3, '이번 주말에 가봐'], [2, '나도 마찬가지야'], [1, '멀어?']],
  '연락은 하는데 할 말이 길지가 않아': [[4, '안부만 물어도 되지 뭐'], [3, '원래 가족이 그래'], [2, '그래도 하는 게 어디야'], [1, '무슨 얘기 하는데?']],
};



// §22.35 가족 대화 — 발화와 응답을 **짝으로** 묶는다.
//
// Silverstein, Gans, Lowenstein, Giarrusso & Bengtson (2010), *Journal of Marriage
// and Family* 72(4) 1006-1021. 6개국 노년 부모-성인 자녀 관계를 애정과 갈등 두 축의
// 잠재계층분석으로 나누면 네 부류가 나온다:
//   amicable(화목, 애정↑갈등↓) ~61% · detached(소원, 둘 다↓) ~23% ·
//   disharmonious(불화, 애정↓갈등↑) ~9% · ambivalent(양가, **둘 다↑**) ~8%
// 즉 가족 관계의 약 40%는 그냥 따뜻하지 않다. 특히 양가 부류는 애정과 갈등을
// **동시에** 갖는다 — 어느 한쪽으로 정리되지 않는 것이 그 관계의 성질이다.
//
// 이 세계의 가족 대사는 11줄이 **전부 화목**이었다(라이브 272건). 위 비율에 맞춰
// 소원·불화·양가를 섞는다. payload에 애정·갈등 신호가 없어 계층을 판정할 수는 없으므로,
// **배열 안의 비율로** 분포를 근사한다.
//
// 발화와 응답을 한 줄에 묶어 둔 이유: pick()은 같은 tick을 쓰므로 배열 길이가 같으면
// 같은 인덱스가 뽑힌다. 따로 두면 "또 언성이 높아졌어" → "가족이 최고지" 같은 어긋남이
// 생기고, 한쪽 배열에만 줄을 더하면 조용히 어긋난다. 짝으로 두면 어긋날 자리가 없다.
const FAMILY_TALK = {
  // 자기 자식 얘기
  child: [
    // ── 화목 (8/13 ≈ 62%)
    [(n) => `우리 ${n} 벌써 학교에 다녀. 시간 참 빠르지`, '벌써 그렇게 됐어?'],
    [(n) => `${ga(n)} 요즘 낚시에 빠졌다니까`, '누구 닮았대?'],
    [(n) => `${ga(n)} 요즘 부쩍 컸어`, '애들은 금방이더라'],
    [(n) => `${n} 밥 먹는 것만 봐도 배부르다`, '그 맛에 키우는 거지'],
    [() => '애가 크니까 내가 늙는 게 보이더라', '나도 요즘 그 생각 해'],
    [(n) => `${ga(n)} 웃는 거 보면 하루가 다 풀려`, '좋겠다…'],
    [(n) => `${n} 학교 얘기 듣는 게 요즘 낙이야`, '뭐래? 재밌는 거 있어?'],
    [() => '애 키우는 게 보통이 아니야', '고생 많다 진짜'],
    // ── 소원 (3/13 ≈ 23%)
    [(n) => `${ga(n)} 요즘 나한테 말을 잘 안 해`, '그맘때가 다 그렇더라'],
    [() => '크고 나니 각자 사는 것 같기도 하고', '그래도 한집에 있잖아'],
    [(n) => `${n} 하루가 어떤지 나도 잘 몰라`, '물어보면 얘기해줄지도'],
    // ── 불화 (1/13 ≈ 8%)
    [(n) => `${rang(n)} 요즘 자주 부딪혀`, '무슨 일로?'],
    // ── 양가 (1/13 ≈ 8%) — 애정과 갈등이 동시에. 한쪽으로 정리하지 않는다.
    [(n) => `${n} 생각하면 좋기도 하고 걱정도 되고 그래`, '둘 다인 게 당연한 거야'],
  ],
  // 자기 부모 얘기
  parent: [
    // ── 화목 (8/13)
    [() => '부모님이 어제 집밥 해주셨어', '그 밥이 제일이지'],
    [(n) => `${n} 목소리 들으면 마음이 놓여`, '나도 오랜만에 연락해봐야겠다'],
    [(n) => `${ga(n)} 잔소리는 해도 고마운 분이지`, '다 걱정이라 그러시는 거야'],
    [(n) => `${eun(n)} 늘 내 편이었지`, '그런 사람 하나면 되는 거야'],
    [(n) => `${ga(n)} 요즘은 좀 편해 보이셔`, '다행이다'],
    [(n) => `어릴 때 ${ga(n)} 해주던 얘기가 요즘 생각나`, '무슨 얘긴데?'],
    [() => '가족은 있을 때 잘해야 하는데', '그 말이 맞지…'],
    [(n) => `${wa(n)} 같이 걸으면 말이 편해져`, '자주 걸으셔?'],
    // ── 소원 (3/13)
    [() => '요즘 자주 못 찾아뵀네', '가까울수록 더 그렇더라'],
    [() => '연락은 하는데 할 말이 길지가 않아', '안부만 물어도 되지 뭐'],
    [(n) => `${ga(n)} 요즘 어떻게 지내시는지 잘 몰라`, '한번 여쭤보지 그래'],
    // ── 불화 (1/13)
    [(n) => `${wa(n)} 얘기하다 또 언성이 높아졌어`, '그런 날은 좀 떨어져 있는 게 낫더라'],
    // ── 양가 (1/13)
    [(n) => `${n} 걱정하는 마음인 건 아는데, 그게 또 부담이야`, '고맙고 무겁고, 같이 오지'],
  ],
};

// §22.38 날씨 얘기는 날씨에 관한 얘기가 아니다 — 교감적 언어사용(phatic communion).
//
// Malinowski가 이 개념을 만들면서 든 예가 바로 "inquiries about health, comments on
// weather"와 인사말이었다 (Senft, "Phatic communion", Handbook of Pragmatics 인용).
// 그가 말하는 요지:
//   · "Are words in Phatic Communion used primarily to convey meaning …? Certainly not!
//      They fulfil a social function and that is their principal aim"
//   · "phatic communion serves to establish bonds of personal union … and does not serve
//      any purpose of communicating ideas"
//   · 'Nice day to-day' 같은 말은 "마주 서서 침묵할 때 느끼는 낯설고 불편한 긴장을
//      넘기기 위해" 필요하다 — 침묵을 깨는 것이 목적이다.
//   · 첫 마디 뒤에는 "purposeless expressions of preference or aversion, accounts of
//      irrelevant happenings, comments on what is [perfectly obvious]"가 이어진다.
//
// 라이브 3000건 중 weather가 330건(5위)인데 detail 조합이 **하나뿐**이고(전부 sunny)
// 그 8줄이 330건을 다 감당하고 있었다. 게다가 이 세계의 날씨 대사는 전부 **날씨를
// 서술**한다 — 정작 이 주제의 본령인 '접촉을 만드는 말'이 없었다. 그래서 세 갈래를
// 더한다: 침묵 깨기 · 뻔한 것에 대한 논평 · 동조 요구.
//
// 발화·응답을 짝으로 둔다 (§22.35와 같은 이유, 그리고 여기선 실제로 어긋나 있었다 —
// §22.29에서 공용 응답 풀에 넣은 '우산은 챙겼어?'가 맑은 날 대사에 돌아가고 있었다).
// 교감적 대화에서 응답은 **동의**가 기본이다. 날씨를 두고 반박하는 사람은 드물고,
// 그 무해함이야말로 이 주제가 접촉의 도구로 쓰이는 이유다.
const WEATHER_TALK = {
  sunny: [
    // 서술
    ['날씨 진짜 좋다~', '그러게, 딱 좋다'],
    ['이런 날엔 공원이지', '나도 방금 그 생각 했어'],
    ['햇살 봐, 나가길 잘했어', '나오길 잘했지'],
    ['이런 날 집에 있으면 손해야', '맞아, 좀 걷자'],
    ['빨래 널기 딱 좋은 날인데', '나도 아침에 널고 나왔어'],
    ['바람이 선선해서 살 것 같다', '그늘은 더 좋더라'],
    ['해 있을 때 좀 걷자', '좋지, 어디로?'],
    ['하늘색 봐라. 사진 찍고 싶네', '진짜 파랗다'],
    // 침묵 깨기 — 말의 목적이 내용이 아니라 접촉인 자리
    ['어, 안녕. 날씨 좋네', '안녕! 그러게'],
    ['여기서 다 보네', '그러게, 오랜만이야'],
    ['오늘은 날씨 얘기밖에 할 게 없네', '그래도 좋으니까 됐지'],
    // 뻔한 것에 대한 논평 — Malinowski가 'comments on what is obvious'라 부른 것
    ['해가 밝다', '밝지'],
    ['덥긴 덥다', '덥다 진짜'],
    ['오늘은 그냥… 날씨가 좋다', '응, 좋다'],
    // 동조 요구
    ['좋은 날이지? 안 그래?', '응, 좋아'],
    ['이런 날 싫어하는 사람은 없지', '없지'],
  ],
  cloudy: [
    ['날이 꾸물꾸물하네', '그러게'],
    ['흐린 날엔 괜히 기분도 가라앉아', '나도 좀 그래'],
    ['비 올 것 같은데 우산 챙겼어?', '아, 안 챙겼는데'],
    ['이런 날은 딱 낮잠인데', '그러게 말이야'],
    ['해가 안 보이니 시간 감각이 없다', '지금 몇 시지?'],
    ['구름이 낮게 깔렸어', '한바탕 오려나'],
    ['뭐 이런 날도 있는 거지', '그렇지 뭐'],
    ['흐리네', '흐리다'],
  ],
  rain: [
    ['비 오는 소리 좋다…', '나도 그 소리 좋아해'],
    ['우산 챙겨왔어? 밖에 비 많이 와', '아니, 같이 쓰자'],
    ['이런 날엔 실내가 최고야', '나가기 싫다 진짜'],
    ['신발 다 젖었어…', '좀 말리고 가'],
    ['빗소리 들으면서 커피 마시는 거 좋아해', '그거 좋다'],
    ['오늘은 일찍 들어가야겠다', '조심히 가'],
    ['비 그치면 공기가 좋아지겠지', '그건 그래'],
    ['비 온다', '오네'],
    ['많이 온다, 그치?', '많이 오네'],
  ],
};
const WEATHER_FALLBACK = [['날씨가 애매하네', '그러게, 뭐라 말하기 그렇다'],
  ['오늘 날씨 뭐라 말하기 애매하다', '딱 잘라 말하기 어렵네']];
function weatherPair(kind, t) { return pick(WEATHER_TALK[kind] ?? WEATHER_FALLBACK, t); }

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
    // §22.31 험담은 대부분 험담이 아니다.
    // Robbins & Karan (2020) SPPS 11(2) 185-195: 467명을 EAR로 자연 관찰해 모은
    // 험담 4,003건 중 **거의 4분의 3이 중립**이었고(부정 604 · 긍정 376), 내용은
    // 대개 '사회적 정보'였다. 즉 사람들은 남 얘기를 **평가하려고**가 아니라
    // **전하려고** 한다.
    //
    // 이 세계의 대사는 정반대였다 — gossip 8줄이 전부 평가였다("좋은 사람이야",
    // "정 많더라"). 라이브 3000건 중 gossip이 780건(26%)으로 1위인데 쓸 수 있는
    // 문장이 8개뿐이라 같은 평가가 계속 돌아왔다.
    // 그래서 **그냥 전하는 말**(어디서 봤다·뭐 한다더라·요즘 안 보인다)을 넣는다.
    //
    // tier로도 가른다. 라이브 780건은 friend 727 · acquaintance 53인데 tier를 보는
    // 줄이 8개 중 1개뿐이었다. 친구 얘기와 얼굴만 아는 사람 얘기는 거리가 다르다.
    case 'gossip': {
      if (d.sentiment > 0) {
        if (d.tier === 'friend') {
          return pick([
            // 평가 — 친한 사이에서 나오는 말
            `${rang(about)} 요즘 진짜 친해졌어. 좋은 사람이야`,
            `${about} 알지? 어제도 같이 놀았는데 완전 잘 맞아`,
            `${eun(about)} 진짜 베프야`,
            `${ga(about)} 생각보다 정 많더라`,
            `${about} 얘기 나온 김에 — 나한테 진짜 잘해줬어`,
            `${rang(about)} 얘기하면 시간 가는 줄 몰라`,
            `${ga(about)} 요즘 표정이 밝아졌더라. 보기 좋아`,
            `${about} 덕분에 요즘 동네 다닐 맛 나`,
            // 중립 — 평가 없이 그냥 전하는 사회적 정보 (연구의 4분의 3)
            `${about} 요즘 시장 쪽에서 자주 보이더라`,
            `${ga(about)} 일 바꿨다던데, 들었어?`,
            `${about} 요새 통 안 보이네`,
            `${ga(about)} 요즘 도서관에 자주 간대`,
            `${eun(about)} 아침형이더라. 나는 절대 못 해`,
            `${ga(about)} 이번에 뭐 하나 해냈다더라`,
            `${about} 집이 이 근처라던데`,
            `${ga(about)} 요즘 부쩍 바쁜 것 같아`,
            `어제 시청 앞에서 ${eul(about)} 봤어`,
            `${eun(about)} 요즘 뭐 하고 지낸대?`,
          ], t);
        }
        return pick([
          // 얼굴만 아는 사이 — 단정하지 않고 거리를 둔다
          `${about}, 이름은 아는데 얘기는 잘 안 해봤어`,
          `${ga(about)} 어떤 사람이야?`,
          `${about} 요즘 자주 보이던데`,
          `${eun(about)} 인사만 하는 사이야`,
          `${about} 어디 사는지는 나도 몰라`,
          `${ga(about)} 조용한 편인 것 같더라`,
          `${rang(about)} 아직 서먹해`,
          `${eul(about)} 어디서 봤더라?`,
        ], t);
      }
      return pick([
        `${about} 때문에 요즘 좀 스트레스야…`,
        `${rang(about)} 지난번에 좀 틀어졌거든… 어색해`,
        `${about} 걔는 왜 그러는지 모르겠어`,
        `${ga(about)} 요즘 인사도 안 받더라`,
        `${about} 얘기는… 별로 하고 싶지 않아`,
        `${rang(about)} 마주치면 그냥 딴 데 봐`,
        `${ga(about)} 나쁜 사람은 아닌데 나랑은 영 안 맞아`,
      ], t);
    }
    // §22.28 자기 공개 — 가장 자주 쓰이면서 변형이 하나뿐이던 자리.
    // 13개 하위 종류 중 11개가 고정 문장 1개였다(라이브 800건 중 memory_share 122건).
    // 자기 공개는 되받아야 관계가 되므로 replyLine에도 상호 공개 분기를 뒀다.
    case 'memory_share': {
      const place = placeKo(d.placeId);
      switch (d.kind) {
        case 'argument': return about
          ? pick([`오늘 ${place}에서 ${rang(about)} 말다툼했어… 아직도 속상해`,
            `${rang(about)} 오늘 좀 부딪혔어. 마음이 안 풀리네`,
            `아까 ${about} 얼굴 보고 말이 세게 나갔어. 후회돼`,
            `${wa(about)} 말이 안 통해서 답답했어`], t)
          : pick([`오늘 ${place}에서 크게 싸웠어…`, `아까 언성이 높아졌어. 좀 창피하다`,
            `싸우고 나니 기운이 하나도 없다`], t);
        case 'fishing': return pick([`오늘 낚시터에서 손맛 좀 봤지~`, `아까 낚시하는데 월척인 줄 알았다니까`,
          `물가에 앉아 있으면 시간 가는 줄 몰라`, `오늘은 입질이 영 없더라`,
          `낚싯대만 담가놔도 마음이 조용해져`], t);
        case 'drank': return pick([`어제 술집에서 좀 달렸더니 아직도 어질어질해`,
          `어제 한잔이 두잔 되고… 오늘 하루 다 갔다`, `술기운에 별 얘길 다 했나 봐`,
          `해장이 급하다 진짜`, `어제 그렇게 웃어본 거 오랜만이야`], t);
        case 'workout': return pick([`오늘 공원에서 운동했는데 개운하다!`, `땀 빼고 나니까 머리가 맑아`,
          `며칠 쉬었더니 몸이 무겁더라`, `오늘은 좀 무리했나 봐. 다리가 후들거려`,
          `운동하고 나면 밥이 두 배로 맛있어`], t);
        case 'work_done': return pick([`오늘 일 진짜 많았어…`, `드디어 오늘치 일 끝냈다`,
          `퇴근길 공기가 제일 달아`, `오늘은 손이 착착 맞더라`,
          `일 끝내고 앉으니 이제야 숨 쉬는 것 같아`], t);
        case 'meal': return pick([`아까 ${place}에서 먹은 거 괜찮더라`, `${place} 밥이 오늘따라 잘 넘어가더라`,
          `혼자 먹었는데도 맛있더라`, `${place}에서 한 그릇 비우고 나니 살 것 같다`], t);
        case 'home_meal': return pick([`요즘 집밥 해먹는데 생각보다 할 만해`, `장 봐다 해먹으니 돈이 덜 들더라`,
          `오늘은 대충 차렸는데 그게 더 맛있네`, `집에서 먹으면 마음이 편해`], t);
        // 굶주림·외로움은 진지한 자리다 — 농담으로 만들지 않는다.
        case 'starving': return pick([`오늘 하루종일 아무것도 못 먹었어`,
          `배가 고픈 걸 넘어서 이제 기운이 없다`, `먹을 걸 살 돈이 모자랐어`,
          `하루 굶으니까 아무 생각도 안 나더라`], t);
        case 'lonely': return pick([`아까 ${place}에서 혼자 앉아만 있었어`,
          `${place}에 사람은 많은데 말 붙일 데가 없더라`, `요즘 하루에 한마디도 안 할 때가 있어`,
          `혼자 있는 게 익숙해지는 게 좀 그래`], t);
        case 'party_info': return pick([`요즘 ${place} 모임 얘기가 돌던데?`,
          `${place}에서 뭐 한다는 것 같던데 들었어?`, `모임 얘기가 여기저기서 나오더라`], t);
        case 'found_item': return pick([`오늘 길에서 돈 주웠다? 완전 럭키`,
          `길에 떨어진 걸 주웠는데 기분이 묘하네`, `오늘은 운이 좀 따라주는 날인가 봐`], t);
        case 'built_bed': return pick([`집에 침대 하나 새로 만들었어. 뿌듯해`,
          `손수 만들어 놓으니 이제 집 같아졌어`, `밤새 뚝딱거렸는데 그래도 쓸 만해`], t);
        case 'relationship_changed': return about
          ? pick([`${rang(about)} 요즘 사이가 달라진 것 같아`, `${wa(about)} 예전 같지가 않네`,
            `${about} 생각하면 마음이 좀 복잡해`], t)
          : pick([`요즘 인간관계가 좀 변했어`, `사람 사이라는 게 참 알 수가 없어`], t);
        // ── 여기부터는 세계가 기록하는데 클라가 할 말이 없던 25종이다.
        // 라이브 4000건 중 memory_share 635건이었고 그 **59%가 아래 종류라
        // "별일이 다 있었어"로 뭉개지고 있었다**. sick 138·unmet 85·was_helped 32처럼
        // 가장 많이 기억되는 일일수록 할 말이 없었다 — 배선 없는 키는 조용히
        // 죽는다는 §22.10의 교훈이 대사 테이블에서 반복된 자리다.
        case 'sick': return pick([`요 며칠 몸이 안 좋아. 자꾸 처지네`,
          `아침부터 몸살 기운이 있어`, `병원에 가봐야 하나 싶어`,
          `쉬어도 낫질 않아서 걱정이야`], t);
        case 'healed': return pick([`이제 좀 살 것 같아. 다 나았어`,
          `병원 다녀오고 나니 훨씬 낫다`, `아프고 나니 건강이 최고인 걸 알겠어`,
          `며칠 앓았는데 이제 괜찮아`], t);
        case 'unmet': return pick([`${actKo(d.placeId)} 했는데 갈 데가 없더라`,
          `${actKo(d.placeId)} 했다가 그냥 돌아왔어`,
          `${actKo(d.placeId)} 해도 이 동네엔 마땅한 데가 없나 봐`,
          `${actKo(d.placeId)} 하는 게 왜 이렇게 어렵냐`], t);
        case 'was_helped': return about
          ? pick([`아까 ${ga(about)} 나 도와줬어. 고맙더라`, `${about} 아니었으면 큰일 날 뻔했어`,
            `${ga(about)} 아무 말 없이 챙겨주더라`], t)
          : pick([`오늘 누가 나 도와줬어. 고맙더라`, `모르는 사람한테 도움을 받았어`], t);
        case 'helped': return about
          ? pick([`아까 ${eul(about)} 좀 도왔어`, `${ga(about)} 힘들어 보여서 거들었어`,
            `${about} 표정이 안 좋길래 말 걸어봤어`], t)
          : pick([`오늘 누구 좀 도와줬어`, `거들고 나니 기분이 괜찮더라`], t);
        case 'new_neighbor': return about
          ? pick([`${about} 새로 이사 왔대. 인사했어?`, `${ga(about)} 이 동네 처음이라던데`,
            `${about} 봤어? 새 얼굴이야`], t)
          : pick([`동네에 새로 온 사람이 있더라`, `못 보던 얼굴이 늘었어`], t);
        case 'welfare': return pick([`이번에 지원금 나왔더라. 숨통이 좀 트여`,
          `시청에서 나온 돈으로 겨우 장 봤어`, `없는 것보단 낫지만 빠듯해`,
          `지원이 없었으면 이번 달 못 넘겼어`], t);
        case 'governed': return pick([`요즘 시청이 일을 좀 하는 것 같지 않아?`,
          `동네가 조금씩 바뀌는 게 보여`, `정책이 바뀌었다던데 체감은 아직이야`], t);
        case 'elected': return pick([`나 이번에 뽑혔어. 잘해야 할 텐데`,
          `표를 받고 나니 어깨가 무겁다`, `맡겨준 만큼은 해야지`], t);
        case 'voted': return pick([`오늘 투표하고 왔어`, `한 표라도 보태야지`,
          `누굴 찍을지 끝까지 고민했어`], t);
        case 'construct_work': return pick([`오늘 공사장에서 일 좀 거들었어`,
          `동네 공사에 손 보태고 왔어`, `짓는 걸 보고 있으면 뿌듯하더라`,
          `몸은 힘든데 뭔가 남는 일이야`], t);
        case 'shopping': return pick([`시장에서 장 좀 봐 왔어`, `살 게 많아서 한참 돌았네`,
          `요즘 물가가 만만치 않더라`, `필요한 것만 사려고 했는데 또 이만큼이야`], t);
        case 'play_time': return pick([`오늘 ${place}에서 좀 놀았어. 오랜만이야`,
          `아무 생각 없이 노는 것도 필요하더라`, `${place} 갔다 왔는데 기분 전환 됐어`], t);
        case 'read_time': return pick([`요즘 읽는 게 있는데 꽤 재밌어`,
          `도서관에 앉아 있으면 시간이 잘 가`, `한 권 끝냈어. 뿌듯하네`], t);
        case 'club_joined': return pick([`나 모임 하나 들었어`, `사람들이랑 뭘 같이 하니 좋더라`,
          `처음엔 어색했는데 이제 갈 만해`], t);
        case 'celebration': return pick([`오늘 동네에 잔치가 있었어`, `다들 모여서 웃고 떠들었지`,
          `이런 날이 자주 있으면 좋겠다`], t);
        case 'milestone': return pick([`오늘 좀 특별한 날이야`, `한 고비 넘긴 것 같아`,
          `돌아보니 여기까지 왔네`], t);
        case 'wedding': return about
          ? pick([`${about} 결혼식 다녀왔어`, `${ne(about)} 결혼식, 참 좋더라`], t)
          : pick([`결혼식 다녀왔어. 보기 좋더라`, `남의 경사에도 기분이 좋아지네`], t);
        case 'love': return about
          ? pick([`요즘 ${about} 생각이 자꾸 나`, `${ga(about)} 좋아졌나 봐`], t)
          : pick([`요즘 마음이 자꾸 한쪽으로 기울어`, `좋아하는 사람이 생겼어`], t);
        // 이별·폭식·칩거는 진지한 자리다 — 농담이나 이모티콘 없이 담백하게.
        case 'heartbreak': return about
          ? pick([`${wa(about)} 헤어졌어`, `${about} 얘기는 아직 못 하겠어`,
            `${rang(about)} 끝났어. 아직 실감이 안 나`], t)
          : pick([`헤어졌어`, `혼자가 되고 나니 하루가 길다`, `아직 정리가 안 됐어`], t);
        case 'binge': return pick([`어젯밤에 정신없이 먹었어`,
          `허기가 아니라 다른 게 고팠던 것 같아`, `먹고 나서 오히려 마음이 안 좋더라`], t);
        case 'hole_up': return pick([`며칠 집에만 있었어`, `나가기가 싫어서 계속 누워 있었어`,
          `사람 만나는 게 버거운 날이 있더라`], t);
        case 'heroic': return pick([`오늘 좀 위험한 일이 있었는데 그냥 몸이 먼저 움직였어`,
          `무섭긴 했는데 가만있을 수가 없더라`, `다들 무사해서 다행이야`], t);
        case 'child': return about
          ? pick([`우리 ${about} 얘기 좀 들어볼래?`, `${ga(about)} 오늘 또 한 건 했지`,
            `${about} 크는 걸 보면 하루가 아깝지 않아`], t)
          : pick([`애 키우는 얘기 하자면 끝이 없지`, `애가 있으니 하루가 정신없어`], t);
        // §22.71 잡담은 이 마을에서 가장 자주 나오는 말인데 네 줄뿐이었다. 배열 **끝에만**
        // 덧붙인다(§22.12: pick은 결정적 선택이라 기존 순서를 흔들면 과거 대화가 바뀐다).
        case 'small_talk': return pick([`별일은 없었는데, 그냥 얘기하고 싶어서`,
          `오늘 뭐 했어? 난 별거 없었어`, `이런 날은 그냥 사람 얼굴 보는 게 좋더라`,
          `할 말이 있어서라기보단 그냥 반가워서`,
          `요 며칠 뭐 하고 지냈어?`, `지나가다 보여서 그냥 왔어`,
          `이 시간에 여기서 다 보네`, `밥은 먹고 다녀?`,
          `요즘 뭐가 제일 재밌어?`, `그냥 앉아 있기 좀 그래서`], t);
        default: return pick([`오늘 ${place}에서 별일이 다 있었어`, `오늘 ${place} 얘기 하나 해줄까?`], t);
      }
    }
    case 'work_gripe': {
      const occ = d.occupation;
      return pick({
        office_worker: ['회사 일이 끝이 없다 끝이 없어…', '오늘도 야근각이야', '월급날만 기다린다',
          '회의가 회의를 부르더라', '자리에 앉자마자 퇴근하고 싶어', '이번 달만 버티면 좀 나아지려나',
          // §22.84 사무직·학생도 문장을 넓힌다.
          '메일함이 줄지를 않아', '점심시간이 제일 짧게 느껴져'],
        barista: ['오늘 카페 손님 미쳤었어…', '원두 냄새가 꿈에 나올 지경이야',
          '주문 밀릴 때는 손이 네 개였으면 좋겠어', '단골 얼굴은 이제 다 외웠지', '서서 일하니 다리가 남아나질 않네',
          // §22.85 바리스타·간호사 문장 확장.
          '라떼 아트가 오늘은 잘 나왔어', '기계가 자꾸 말썽이야',
          '단골이 오늘 안 왔어', '신메뉴 반응이 궁금해'],
        freelancer: ['일감이 들쭉날쭉해서 불안해', '마감이 코앞인데 잠이 온다',
          '출퇴근이 없는 대신 퇴근도 없어', '이번 건 끝나면 좀 쉬려고', '혼자 일하니 말할 사람이 없다',
          '이번 달은 좀 들어왔어', '혼자 하니까 쉬는 날도 내가 정해',
          // §22.94 프리랜서·바리스타 문장 확장.
          '오늘은 카페에서 일했어', '견적 메일 쓰는 게 제일 어려워'],
        student: ['과제가 산더미야…', '시험 기간 진짜 싫다', '어제 밤새웠어. 지금 정신이 없어',
          '학교 급식이 그래도 낫더라', '졸업하면 뭐 하지',
          '노트를 잃어버렸어', '오늘 수업은 좀 재밌었어',
          '도서관 자리가 없어', '조별 과제가 제일 싫어'],
        doctor: ['오늘 환자가 끊이질 않았어', '밥 먹을 틈도 없었다니까', '한 명이라도 나아서 가면 그걸로 됐지',
          // §22.81 의사·교사는 세 줄뿐이라 같은 말이 자주 돌았다. 끝에만 덧붙인다.
          '요즘 같은 증상이 자꾸 들어와', '설명하는 게 치료의 절반이더라',
          '차트 정리가 진료보다 오래 걸려', '오늘은 큰 일 없이 지나갔어'],
        teacher: ['애들이 오늘따라 말을 안 듣더라', '수업 준비가 수업보다 오래 걸려', '가르치다 보면 내가 배워',
          '한 명이 알아들으면 그날은 성공이야', '목이 남아나질 않네',
          // §22.92 교사·학생 문장 확장.
          '급식 시간이 제일 시끄러워', '학부모 상담이 오늘 셋이야'],
        police: ['오늘 순찰 돌다 다리 아파 죽는 줄', '별일 없는 게 제일 좋은 거야', '동네가 조용해서 다행이야',
          // §22.79 경찰·소방은 세 줄뿐이라 같은 말이 자주 돌았다. 끝에만 덧붙인다.
          '사람들이 인사해줄 때가 제일 좋더라', '순찰 코스를 바꿔볼까 싶어', '별일 없어도 눈은 늘 굴러가',
          '길 물어보는 분이 오늘만 셋이야', '자전거 도난 신고가 늘었어',
          // §22.93 경찰·소방 문장 확장.
          '인도에 자전거 세워두는 분이 많아', '야간 순찰은 손전등이 반이야'],
        firefighter: ['출동 없는 날이 제일 좋은 날이지', '장비 점검만 해도 하루가 가', '연기 냄새는 익숙해지질 않아',
          '사이렌 소리에 아직도 심장이 뛴다', '훈련은 몸이 기억할 때까지 하는 거야',
          '소화기 위치는 눈 감고도 안다', '사다리차 점검이 오늘 일이었어'],
        clerk: ['재고 정리하다 하루 다 갔어', '손님이 물어보는 게 다 달라', '계산 실수 안 하려고 늘 긴장해',
          '진열만 바꿔도 잘 나가는 게 달라져', '단골이 찾는 물건은 외워두게 되더라',
          // §22.90 점원·경찰 문장 확장.
          '오늘 문 닫고 나오는데 비가 오더라', '포장 상자가 모자라'],
        chef: ['불 앞에 있으면 여름이 두 배야', '오늘 재료가 좋더라고', '맛있게 먹었다는 말 들으면 힘나',
          // §22.82 요리사·점원도 세 줄뿐이었다. 끝에만 덧붙인다.
          '칼 가는 날이 제일 마음이 편해', '남은 재료로 뭘 할지가 진짜 실력이지'],
        // §22.33 여기부터는 세계에 있는데 할 말이 없던 직업들이다.
        // 라이브 358건 중 106건(30%)이 아래 다섯 직업인데 분기가 없어 전부
        // "일이 너무 많아…" 세 줄로 나오고 있었다.
        //
        // 무엇을 힘들다고 말하는지는 직업마다 다르다. 문장은 O*NET 31.0의
        // Work Context 실측값에 맞췄다 — 내 짐작이 아니라 그 직업이 실제로 겪는
        // 것에서 뽑는다.
        //
        // 간호사(29-1141.00): 타인의 건강·안전에 대한 책임 '매우 높음' 66%,
        // 감염 노출 매일 61%, 오류의 결과 '매우 심각' 57%, 화난 사람 상대 매일 42%,
        // 보호장구 착용 매일 51%. → 책임의 무게와 접촉이 핵심이지 '일이 많다'가 아니다.
        nurse: ['오늘 한 사람이라도 놓쳤으면 어쩔 뻔했나 싶어',
          '손 씻다가 하루가 다 가는 것 같아', '화내는 분들 상대하는 게 제일 지쳐',
          '내 실수 하나가 어떻게 되는지 아니까 늘 긴장이야',
          '퇴근하고도 아까 그 환자 생각이 나',
          '교대 시간만 기다렸어', '보호자 설득이 더 어려울 때가 있어'],
        // 조립·생산직(51-2092.00): 손으로 다루는 시간 85%, 반복 동작 48%,
        // 서 있기 41%, 보호장구 매일 91%, 소음 노출 매일 52%, 정확성 '매우 중요' 77%.
        worker: ['하루 종일 같은 동작만 하니까 팔이 내 것 같지가 않아',
          '기계 소리가 퇴근하고도 귀에 남아', '장갑을 벗으면 손이 얼얼해',
          '하나 틀리면 처음부터라 눈을 못 떼겠어', '서서 하는 일은 다리가 먼저 안다니까',
          // §22.86 공장 노동자·정치인 문장 확장.
          '오늘은 라인이 안 멈췄어', '교대 전에 커피 한 잔이 살려',
          // §22.95 공장·공무원 문장 확장.
          '작업화가 벌써 닳았어', '안전화 새로 받았어'],
        // 입법·선출직(11-1031.00): 리더십 100, 청렴 98, 사회적 지향·스트레스 내성 85+.
        // 주 업무가 '서로 다른 이해를 조정하는 것'이라 갈등이 일 그 자체다.
        politician: ['모두를 만족시키는 답은 애초에 없더라',
          '오늘도 양쪽 얘기를 다 듣고 왔어', '결정하고 나면 꼭 누군가는 서운해해',
          '말 한마디가 어디까지 가는지 이제 알아', '약속한 건 지켜야지, 그게 제일 어렵고',
          '숫자보다 사람 얼굴이 먼저 떠올라', '설명할 자리가 늘 모자라'],
        // 행정직: 절차와 서류가 일의 실체다.
        civil_servant: ['서류 한 장 넘기는 데 도장이 몇 개인지 몰라',
          '민원 앞에서는 규정이 방패이자 벽이야', '내가 만든 규칙도 아닌데 내가 설명해야 해',
          '오늘은 창구에 사람이 끊이질 않았어', '천천히라도 되게 만드는 게 내 일이지',
          // §22.83 공무원·프리랜서도 문장이 얇았다. 끝에만 덧붙인다.
          '규정집이 매년 두꺼워져', '창구에서 웃는 것도 일이더라',
          '민원 대기표가 오늘 백 번을 넘었어', '점심시간에도 창구를 못 비워'],
        // child는 직업이 아니다 — 아이의 '일'은 학교와 숙제다. student와도 다르게,
        // 아이는 앞날을 계산하지 않고 오늘 하루를 말한다.
        artisan: ['오늘 만든 물건은 손에 딱 맞게 나왔어', '공방 주문이 밀려서 손을 못 놓겠네'],
        researcher: ['실험 결과가 예상과 달라서 다시 보고 있어', '오늘은 가설 하나를 제대로 확인했어'],
        logistician: ['물건이 제때 도착해야 마을이 돌아가', '오늘 동선은 어제보다 훨씬 나았어'],
        child: ['숙제 다 하면 놀아도 된댔어', '오늘 학교에서 재밌는 일 있었다?',
          '받아쓰기 또 틀렸어…', '빨리 커서 어른 되고 싶어', '학교 끝나고 뭐 할지 벌써 정했어'],
        // 은퇴한 사람에게 '일 얘기'는 **일이 없는 것에 대한 얘기**다. 라이브 표본에는
        // 아직 안 나왔지만 OCCUPATIONS에 있으므로 미리 목소리를 준다 (QA-14가 강제한다).
        retired: ['일 안 하니 하루가 길어. 그것도 적응이 필요하더라',
          '평생 하던 걸 안 하니까 손이 심심해', '이제야 아침 해를 제대로 봐',
          '가끔은 불려 나가서 뭐라도 하고 싶어', '바쁠 땐 몰랐는데 사람이 그립더라',
          // §22.88 은퇴·의사 문장 확장.
          '손주 얘기만 나오면 말이 길어져', '병원 다니는 게 일과가 됐어'],
        jobless: ['일을 구하는 중이야', '오늘도 이력서만 고쳤어', '언젠가는 다시 일할 수 있겠지'],
      }[occ] ?? ['일이 너무 많아…', '오늘은 좀 고된 날이었어', '일이 손에 안 잡히는 날도 있지'], t);
    }
    case 'food': {
      // §22.75 식사 화제는 자주 나오는데 배고플 때 5줄·아닐 때 7줄뿐이었다. 끝에만 덧붙인다.
      return d.hungry
        ? pick(['배고파 죽겠어… 뭐라도 먹자', '아 오늘 제대로 못 먹었더니 어지러워',
          '뱃속에서 소리 나는 거 들었지…', '지금은 뭘 줘도 맛있을 것 같아', '점심을 걸렀더니 손이 떨려'], t)
        : pick(['여기 커피 진짜 맛있지 않아?', '요즘 뭐 맛있는 거 먹었어?', '시장에서 장 봐다 해먹는 것도 좋더라',
          '다음엔 같이 밥 먹자', '집밥이 제일이더라', '식당 새로 생긴 거 가봤어?', '먹고 나니까 살 것 같다',
          '여기 뭐가 제일 맛있어?', '한 그릇 더 시킬까 고민 중이야',
          '아까부터 냄새가 계속 나더라', '너 밥은 뭐로 때웠어?'], t);
    }
    case 'sweet_talk': {
      return d.stage === 'married'
        ? pick(['오늘 저녁 같이 먹을까, 여보?', '요즘 당신 덕에 매일이 좋아', '주말에 공원 데이트 어때?',
          '오늘 하루 어땠어?', '같이 늙어가는 거 나쁘지 않네', '들어갈 때 장 좀 봐 갈까?',
          '당신이랑 있으면 하루가 짧아'], t)
        : pick(['보고 싶었어!', '오늘따라 더 좋아 보인다?', '이따 낚시터에서 볼래?',
          '이따 시간 돼? 잠깐이라도 보자', '네 얘기 듣는 게 제일 재밌어', '오늘 무슨 좋은 일 있었어?',
          '이러다 나 큰일 나겠다'], t);
    }
    case 'club_talk': {
      const cn = { book_club: '이번 책', fishing_club: '요즘 입질', fitness_club: '운동 루틴', drinking_pals: '오늘 한잔' }[d.clubId] ?? '모임';
      return pick([`${cn} 얘기 좀 하자`, `다음 모임 언제더라?`, `${cn} 어땠어?`], t);
    }
    // §22.34 정치 얘기는 의견을 말하는 자리가 아니라 **의견을 감추는 자리**다.
    // Schmitt-Beck & Schnaudt (2023) PVS 64(3) 499-523 (CC BY 4.0):
    // "participants of such talks tend to avoid clear opinion statements if they
    //  entail the prospect of open disagreement" — 그리고 그 결과 낯선 사이의 정치
    // 대화는 이론의 예상과 달리 **오히려 화기애애하게** 흘러간다.
    //
    // 라이브 3000건 중 politics가 293건(10%, 5위)인데 유세 분기 문장이 6개뿐이었고
    // replyLine 분기는 아예 없어서 "완전 공감해"·"ㅋㅋㅋ 맞아"로 받고 있었다.
    // 정치 얘기를 그렇게 시원하게 받는 사람은 드물다.
    //
    // 그래서 네 갈래로 넓힌다: ① 판단을 유보하는 말, ② 내 패를 안 보이고 상대를
    // 먼저 떠보는 말, ③ 이념 대신 **눈에 보이는 동네 일**로 내려앉는 말,
    // ④ 그래도 의견을 내는 소수.
    case 'politics': {
      if (d.phase === 'campaign') {
        return pick([
          // ① 유보 — 명확한 의견을 피한다
          `이번 선거, ${about} 어때? 나쁘지 않던데`,
          '나는 아직 마음을 못 정했어',
          '글쎄… 누가 되든 크게 다를까 싶기도 하고',
          '좋은 말이야 다들 하니까',
          '뽑아놓고 봐야 아는 거지 뭐',
          // ② 떠보기 — 내 의견 대신 상대 의견을 먼저 묻는다
          '너는 누구 생각하고 있어?',
          '다들 뭐라고들 해?',
          `${about} 어떻게 봐? 나는 듣고 정하려고`,
          // ③ 이념 대신 동네 일
          `${about} 공약은 봤어?`,
          '동네 일은 동네 사람이 제일 잘 알지',
          '누가 되든 세금 얘기는 하겠지',
          '공약보다 길이 언제 포장되는지가 궁금해',
          '우리 동네까지 신경 써줄 사람이면 좋겠어',
          // §22.77 선거철 대화가 라이브 3위 주제(325건)인데 문장이 얇았다. 끝에만 덧붙인다.
          '요즘 시청 앞이 시끌시끌하더라',
          '나는 사람보다 하는 걸 봐',
          '지난번엔 뽑고 나서 후회했잖아',
          '투표소 어디로 가야 해?',
          // ④ 그래도 말하는 사람
          `${ga(about)} 요즘 인사를 그렇게 하고 다닌대`,
          '이번엔 투표 꼭 하자',
          `${eun(about)} 말이라도 시원하게 하더라`,
        ], t);
      }
      return pick([`${simName(d.mayorId)} 시장, 일 잘할까?`, '새 시장 됐다며? 공사가 빨라진대', '시장님 공약 기억하지?',
        '요즘 길이 좀 나아진 것 같지 않아?', '세금 얘기 나오면 다들 조용해지더라',
        '나라 일은 몰라도 동네 일은 눈에 보이잖아',
        '바뀌고 나서 좀 나아졌나? 나는 잘 모르겠던데',
        '기대는 안 했는데 그래도 뭔가는 하네',
        '평가는 임기 끝나고 하는 거지',
        '나쁘다는 소리는 아직 못 들었어'], t);
    }
    case 'couple_news': {
      const other = simName(d.otherId);
      return d.kind === 'married'
        ? pick([`${rang(about)} ${other} 결혼했대!! 대박`, `${ne(about)} 결혼식 얘기 들었어?`,
          `${rang(about)} ${other}, 잘 어울리더라`, `둘이 언제부터 그랬대?`,
          `${about} 결혼한다는 소식 들었어?`, `${ga(about)} 결혼했다니 아직도 안 믿겨`,
          `${wa(about)} ${other}, 식장에서 둘 다 울더라`,
          `${rang(about)} ${other} 얘기 들었지? 나만 늦게 안 거야?`,
          `요즘 경사가 있네. ${about} 소식 말이야`], t)
        : pick([`${rang(about)} ${other} 사귄대!`, `${ga(about)} 요즘 ${other}만 만난다?`,
          `${rang(about)} ${other} 같이 있는 거 봤어`, `어쩐지 요즘 표정이 좋더라니`,
          `${about} 소식 들었어? ${rang(other)} 잘 되나 봐`,
          `${ga(about)} 요즘 부쩍 꾸미고 다니더라`, `${wa(about)} ${other} 어제 같이 걷더라`,
          `${eun(about)} 아직 아무 말 없던데, 티가 나`, `둘이 사귄다는 게 사실이야?`], t);
    }
    case 'family_talk': {
      // §22.35 발화·응답 짝 표에서 뽑는다. 같은 tick → 같은 인덱스 → 짝이 맞는다.
      return pick(FAMILY_TALK[d.relation === 'child' ? 'child' : 'parent'], t)[0](about);
    }
    case 'weather': return weatherPair(d.kind ?? 'sunny', t)[0]; // §22.38 짝 표
    default: return pick(['요즘 어떻게 지내?', '별일 없지?', '오랜만이다, 잘 지냈어?', '오늘 하루 어땠어?'], t);
  }
}

// 청자 반응 — 화자에 대한 호감(listenerWarmth)과 주제로 온도를 정한다
function replyLine(e) {
  const t = e.tick;
  const warm = e.payload.listenerWarmth ?? 0;

  // §22.39 **한 말을 키로** 응답을 먼저 찾는다. 특정 문장에 붙여 둔 답이 있으면
  // 그게 가장 정확한 대답이기 때문이다. 호감이 없을 때는 쓰지 않는다 —
  // 사슬은 대화를 이어가는 말들이고, 냉담한 청자는 잇지 않는다.
  if (warm >= 0) {
    const chain = QA_CHAINS[conversationLine(e)];
    // §22.62 답하는 쪽은 청자다 — 그 사람의 성격으로 무게를 곱한다.
    if (chain !== undefined) return pickWP(chain, t, simMbti(e.payload.withSimId), `${e.simId}>${e.payload.withSimId}|reply`)[1];
  }

  if (e.payload.topic === 'party_invite') {
    return warm >= 0 ? pick(['갈래갈래!', '오 좋아, 시간 비워둘게', '누구누구 와?', '그때 보자!',
      '뭐 가져갈까?', '몇 시까지 가면 돼?'], t)
      : pick(['음… 생각해볼게', '가면 보고', '그날 좀 애매한데', '나는 다음에'], t);
  }
  // §22.29 후속 질문 (Huang, Yeomans, Brooks, Minson & Gino 2017, JPSP 113(3) 430-452).
  // 세 건의 실제 대화 실험에서 **질문을, 특히 앞말을 받아 묻는 후속 질문을** 많이 한
  // 사람이 상대에게 더 호감을 샀다. 기제는 반응성(responsiveness) — 듣고 있고,
  // 이해했고, 관심이 있다는 신호다. 스피드데이팅에서는 후속 질문을 많이 한 쪽이
  // 두 번째 만남 승낙을 더 받아냈다.
  //
  // 소식 전달(couple_news)은 대화의 21%인데 응답 분기가 아예 없어서 "응응"·"ㅋㅋㅋ 맞아"
  // 같은 맞장구로만 받고 있었다. 소식은 원래 **되묻는** 자리다.
  // 되묻는 말은 앞말의 실제 내용(누가·어떤 관계)을 가리켜야 반응성이 된다 — 그래서
  // 이름과 kind를 문장에 넣는다. 호감이 없으면 되묻지 않고 화제를 닫는다.
  if (e.payload.topic === 'couple_news') {
    const cd = e.payload.detail ?? {};
    const who = e.payload.aboutSimId !== null && e.payload.aboutSimId !== undefined
      ? simName(e.payload.aboutSimId) : null;
    const partner = cd.otherId !== null && cd.otherId !== undefined ? simName(cd.otherId) : null;
    if (warm >= 0) {
      return cd.kind === 'married'
        ? pick([`언제부터 만난 거래?`, who ? `${who} 표정 어땠어?` : `분위기 어땠어?`,
          `식은 어디서 했대?`, `너도 갔었어?`, `누가 먼저 마음이 있었대?`,
          `둘이 어떻게 만난 거래?`], t)
        : pick([`언제부터래?`, `누가 먼저 좋아했대?`,
          who ? `${who} 본인이 얘기한 거야?` : `본인들이 얘기한 거야?`,
          partner ? `${partner} 어떤 사람이야?` : `상대는 어떤 사람이야?`,
          `둘이 어디서 만났대?`, `너는 어떻게 알았어?`], t);
    }
    return pick([`그런가 보네`, `본인들 일이지 뭐`, `나는 잘 모르겠어`, `그렇구나`], t);
  }
  // 연인끼리의 말은 되묻는 방향이 다르다 — 소식을 캐는 게 아니라 상대 쪽으로 돌린다.
  if (e.payload.topic === 'sweet_talk') {
    const st = (e.payload.detail ?? {}).stage;
    if (warm >= 0) {
      return st === 'married'
        ? pick([`당신은 오늘 어땠는데?`, `좋지. 몇 시에 볼까?`, `장은 내가 볼게. 뭐 필요해?`,
          `그 얘기 좀 더 해줘`, `저녁은 뭐 먹고 싶어?`], t)
        : pick([`나도 보고 싶었어. 언제 시간 돼?`, `어디서 볼까?`, `무슨 좋은 일 있었길래?`,
          `그래서? 더 얘기해줘`, `오늘은 어떻게 지냈어?`], t);
    }
    return pick([`응…`, `나중에 얘기하자`, `그래`], t);
  }
  if (e.payload.topic === 'gossip') {
    // §22.31 남 얘기의 대부분은 평가가 아니라 정보다. 그래서 받는 말도
    // 동의("그니까 말이야")만이 아니라 **정보를 주고받는 말**이 섞여야 한다.
    return warm >= 0 ? pick(['헐 진짜?', '그니까 말이야', '더 얘기해봐', '어쩐지…', '나도 그런 느낌 받았어',
      '어쩌다 그렇게 됐대?', '너는 어떻게 알았어?', '그래서 지금은 어때?',
      '아 그 사람?', '나도 몇 번 봤어', '그 얘긴 처음 듣네', '나도 어제 봤는데',
      '어디서 봤는데?', '그랬구나, 몰랐네'], t)
      : pick(['글쎄…', '남 얘긴 그만하자', '직접 물어보지 그래', '뭐 사정이 있겠지'], t);
  }
  // §22.33 일 얘기를 받는 말도 직업을 타야 한다. 예전에는 전부 "그래도 오늘
  // 끝났잖아"였는데, 아이에게도 은퇴한 사람에게도 그건 말이 안 된다 — 둘 다
  // 끝낼 근무가 없다. 남의 생명을 쥔 직업에 "한잔 하러 갈까?"도 어긋난다.
  if (e.payload.topic === 'work_gripe') {
    const occ = (e.payload.detail ?? {}).occupation;
    if (warm >= 0) {
      // 아이의 하루는 근무가 아니다.
      if (occ === 'child') {
        return pick(['오 뭐 하고 놀 건데?', '숙제부터 하고!', '재밌었겠다',
          '천천히 커도 돼', '그래서 오늘 제일 재밌었던 게 뭐야?'], t);
      }
      // 은퇴한 사람에게 '퇴근'은 없다.
      if (occ === 'retired') {
        return pick(['이제 좀 쉬셔도 되죠', '심심하면 저희랑 나와서 걸어요',
          '그 얘기 더 듣고 싶은데', '요즘은 뭐 하고 지내세요?'], t);
      }
      // O*NET 기준으로 타인의 건강·안전에 대한 책임이 크거나 갈등이 일 자체인 직업.
      // 이런 얘기는 농담으로 받지 않는다.
      if (['nurse', 'doctor', 'firefighter', 'police', 'politician'].includes(occ)) {
        return pick(['그 무게를 지고 있구나', '고생 많았어. 진심으로',
          '아무나 못 하는 일이야', '오늘은 좀 쉬어', '그래도 네가 있어서 다행이야',
          '제일 힘든 게 뭐야?'], t);
      }
      return pick(['고생 많았다…', '그래도 오늘 끝났잖아', '한잔 하러 갈까?', '내일은 좀 낫겠지',
        '오늘은 몇 시에 끝났어?', '제일 힘든 게 뭐야?', '내일도 그래?'], t);
    }
    return pick(['다들 그렇지 뭐', '그래도 일이 있는 게 어디야'], t);
  }
  // §22.38 날씨는 짝 표에서 받는다. 교감적 대화의 응답은 동의가 기본이고,
  // 무엇보다 맑은 날 얘기에 "우산은 챙겼어?"가 돌아가면 안 된다(§22.29에서
  // 공용 풀에 넣는 바람에 실제로 그러고 있었다).
  if (e.payload.topic === 'weather') {
    if (warm >= 0) return weatherPair((e.payload.detail ?? {}).kind ?? 'sunny', t)[1];
    return pick(['그런가…', '난 잘 모르겠던데', '음, 그렇네'], t);
  }
  if (e.payload.topic === 'food') {
    return warm >= 0 ? pick(['오 어디 거?', '나도 배고파졌어', '다음엔 같이 가자',
      '맛이 어땠는데?', '거긴 뭐가 제일 나아?'], t)
      : pick(['난 방금 먹었어', '입맛이 없네'], t);
  }
  // §22.28 상호 자기 공개 (Brummelman et al. 2024, Dev Sci; CC BY).
  // 자기 공개는 **되받는 공개**로 받을 때 관계가 된다 — 실험에서 서로 번갈아 털어놓은
  // 쪽이 그냥 듣기만 한 쪽보다 상대에게 사랑받는다고 느꼈다. 그래서 호감이 있는 청자는
  // "응응"이 아니라 **자기 얘기로 되받는다**. 호감이 없으면 되받지 않고 인정만 한다 —
  // 비상호(non-reciprocal) 조건이 대조군인 그대로다.
  if (e.payload.topic === 'memory_share') {
    const k = (e.payload.detail ?? {}).kind;
    const back = {
      argument: ['나도 지난주에 비슷한 일 있었어', '나도 그런 날엔 잠이 안 오더라',
        '말이 세게 나가는 날이 있더라. 나도 그래'],
      starving: ['나도 며칠 전에 그랬어', '나도 돈 떨어졌을 때 하루 굶어봤어', '그 기분 알아. 나도 겪었어'],
      lonely: ['나도 요즘 그래', '나도 혼자 앉아 있던 날이 있었어', '그럴 땐 나한테 말 걸어도 돼'],
      fishing: ['나도 어릴 때 자주 갔었는데', '나도 한번 같이 가볼까', '나는 앉아만 있다 온 적도 많아'],
      drank: ['나도 어제 좀 마셨어', '나도 그런 날 있었지', '나는 요즘 줄이는 중이야'],
      workout: ['나도 몸이 무거워서 요즘 시작했어', '나도 아침에 좀 걸어', '나는 며칠째 미루고만 있네'],
      work_done: ['나도 오늘 겨우 끝냈어', '나도 요즘 일이 몰려', '나는 아직 남았어…'],
      meal: ['나도 거기 가봤어', '나도 오늘 밖에서 먹었어', '나는 요즘 집에서 해먹어'],
      home_meal: ['나도 요즘 해먹어', '나도 장 봐다 하는 게 낫더라', '나는 아직 서툴러'],
      party_info: ['나도 그 얘기 들었어', '나도 가볼까 생각 중이야'],
      found_item: ['나도 예전에 그런 적 있어', '나는 그런 운이 없더라'],
      built_bed: ['나도 집에 하나 만들어볼까', '나도 손으로 뭐 만드는 거 좋아해'],
      relationship_changed: ['나도 요즘 그런 생각 해', '사람 사이가 변하는 건 나도 겪어봤어'],
      // 라이브 상위 종류 — 여기가 실제로 가장 많이 오가는 자리다.
      sick: ['나도 요즘 컨디션이 별로야', '나도 지난주에 앓았어', '무리하지 말고 좀 쉬어'],
      healed: ['다행이다', '나도 아프고 나서 조심하게 되더라', '이제 좀 다니겠네'],
      unmet: ['나도 그것 때문에 헛걸음한 적 있어', '나도 갈 데가 없어서 그냥 돌아왔어',
        '그거 나도 아쉬웠어'],
      was_helped: ['나도 그런 도움 받은 적 있어', '나도 그때 누가 챙겨줘서 넘겼어',
        '그런 사람 만나면 오래 기억에 남더라'],
      helped: ['나도 그럴 때 그냥 지나쳐지지가 않더라', '나도 거들어 본 적 있어'],
      new_neighbor: ['나도 처음 왔을 때 막막했어', '나도 아직 인사는 못 했어'],
      welfare: ['나도 그거로 이번 달 넘겼어', '나도 없었으면 힘들었을 거야',
        '나도 빠듯한 건 마찬가지야'],
      small_talk: ['나도 그냥 얘기하고 싶었어', '나도 오늘 별일 없었어', '잘 왔어, 마침 심심했거든'],
      construct_work: ['나도 저번에 나갔었어', '나도 몸 쓰는 일이 차라리 낫더라'],
      shopping: ['나도 오늘 장 봤어', '나도 요즘 값 보고 놀라'],
      play_time: ['나도 좀 놀아야 하는데', '나도 오랜만에 나가볼까'],
      read_time: ['나도 요즘 읽는 게 있어', '나도 한 권 붙잡고 있어'],
      // 무거운 얘기일수록 되받는 공개가 힘이 된다 — 다만 담백하게.
      heartbreak: ['나도 그런 적 있어', '나도 그때 한참 걸렸어', '천천히 해도 돼'],
      binge: ['나도 그런 밤이 있어', '나도 마음이 허할 때 그러더라'],
      hole_up: ['나도 그런 날이 있어', '나도 며칠 안 나간 적 있어'],
      love: ['나도 그런 때가 있었지', '표정에 다 보여'],
      child: ['나도 애 키우면서 그 생각 해', '나도 그맘때가 제일 기억나'],
    }[k];
    if (warm >= 0 && back) return pick(back, t);
    // 무거운 얘기는 호감이 없어도 가볍게 넘기지 않는다.
    return ['starving', 'lonely', 'argument', 'heartbreak', 'sick', 'binge', 'hole_up'].includes(k)
      ? pick(['그랬구나…', '힘들었겠다', '음…'], t)
      : pick(['아 그랬어?', '그렇구나', '그럴 수도 있지', '음…'], t);
  }
  // §22.34 정치 얘기를 받는 말. 논문의 핵심은 **양쪽 다 명확한 의견을 피한다**는 것이고,
  // 그래서 낯선 사이의 정치 대화가 역설적으로 화기애애하게 끝난다. 받는 쪽도 유보하거나,
  // 되묻거나, 눈에 보이는 동네 일로 화제를 내린다. 호감이 없으면 아예 화제를 닫는다 —
  // 정치는 이 세계에서 유일하게 **닫는 것이 자연스러운** 주제다.
  if (e.payload.topic === 'politics') {
    if (warm >= 0) {
      return pick([
        '나도 아직 잘 모르겠어',
        '그러게, 두고 봐야지',
        '너는 마음 정했어?',
        '누가 되든 일만 잘하면 되지',
        '나는 공약보다 사람을 봐',
        '그 얘기 나오면 다들 조심하더라',
        '길이랑 세금만 좀 어떻게 해줬으면',
        '음… 나는 좀 더 지켜보려고',
        '어디서 그런 얘기 들었어?',
        '동네가 조용한 게 제일이야',
      ], t);
    }
    return pick(['정치 얘기는 좀…', '그 얘긴 그만하자', '나는 관심 없어', '글쎄'], t);
  }
  // §22.35 가족 얘기는 짝 표에서 받는다 — 불화·양가 발화에 "가족이 최고지"가
  // 돌아가지 않게 하려면 발화와 응답이 같은 줄에서 나와야 한다.
  if (e.payload.topic === 'family_talk') {
    const rel = (e.payload.detail ?? {}).relation === 'child' ? 'child' : 'parent';
    if (warm >= 0) return pick(FAMILY_TALK[rel], t)[1];
    return pick(['그렇구나', '집집마다 사정이 있지', '남 일 같지 않네'], t);
  }
  // §22.39 어느 분기에도 안 걸린 자리 — 가장 많이 쓰이므로 무게를 준다.
  // 맞장구는 흔하고("응응", "ㅋㅋ") 감탄·되묻기는 그보다 드물다.
  if (warm > 0) {
    return pickW([[5, '응응!'], [4, 'ㅋㅋㅋ 맞아'], [3, '오 진짜?'], [3, '완전 공감해'],
      [2, '나도 나도'], [2, '그니까'], [1, '역시 너다'], [1, '헐']], t)[1];
  }
  if (warm < 0) {
    return pickW([[5, '아 그래…'], [3, '흠…'], [3, '그렇구나'], [2, '음…'], [1, '그래서?']], t)[1];
  }
  return pickW([[5, '응응'], [4, 'ㅋㅋ'], [3, '오 그래?'], [2, '그렇구나~'],
    [1, '아 맞다'], [1, '음']], t)[1];
}

function handleVisualEvent(e) {
  if (e.type === 'city_promoted') {
    if (world && (!e.payload.villageId || e.payload.villageId === 'village:0')) world.cityTier = e.payload.to;
    updateBadge(); fireworksBurst();
  }
  const sp = (id) => simSprites.get(id);
  switch (e.type) {
    case 'conversation': {
      // §22.68 대화는 순식간에 끝나지 않는다 (사용자 지시). 예전에는 발화가 즉시 뜨고 1.6초 뒤
      // 답이 붙어, 배속을 올리면 말풍선이 한꺼번에 터졌다 — 읽을 수도 없고 렌더도 출렁였다.
      //
      // 셋을 바꾼다:
      //  ① 말을 꺼내는 데도 뜸을 들인다 (0.3~1.1초) — 문장 길이에 비례. 긴 말은 늦게 나온다.
      //  ② 답은 발화가 **뜬 뒤** 생각 시간을 두고 붙는다 (1.4~2.6초). 시간은 tick 해시라
      //     같은 대화면 늘 같은 간격이다.
      //  ③ 화면 밖 심의 말풍선은 만들지 않는다 — 안 보이는 글자에 Text 객체를 쓰지 않는다.
      const line = conversationLine(e);
      const think = (base, span, salt) => base + (hash32(`${e.tick}|${e.simId}|${salt}`) % span);
      const openMs = think(300, 800, 'open') + Math.min(600, line.length * 12);
      setTimeout(() => showBubble(e.simId, line, 4500), openMs);
      if (sp(e.payload.withSimId)) {
        const replyMs = openMs + think(1400, 1200, 'reply');
        setTimeout(() => showBubble(e.payload.withSimId, replyLine(e), 2800), replyMs);
      }
      break;
    }
    case 'helped':
      showBubble(e.simId, '🤝', 2500);
      showBubble(e.payload.toSimId, '😊', 2500);
      break;
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

// 목업 황혼 톤: 시각별 씬 위 틴트 (§UI). CSS transition이 부드럽게 보간.
let lastNightFlag = null;
function applyDaylight(tick) {
  const el = document.getElementById('daynight');
  if (!el) return;
  const h = Math.floor((tick % 1440) / 60);
  const night = h >= 19 || h < 6;
  if (lastNightFlag !== null && night !== lastNightFlag && scene) {
    destroySimSprites();
    scene.drawWorld(); // 점등 변형 스왑
  }
  lastNightFlag = night;
  let bg = 'transparent';
  if (h >= 21 || h < 5) bg = 'rgba(20, 26, 60, 0.38)';        // 밤
  else if (h >= 19) bg = 'rgba(50, 30, 70, 0.26)';             // 황혼
  else if (h >= 17) bg = 'rgba(255, 140, 60, 0.12)';           // 노을
  else if (h < 7) bg = 'rgba(90, 110, 170, 0.18)';             // 새벽
  el.style.background = bg;
}

function fmtClock(tick) {
  const day = Math.floor(tick / 1440);
  const tod = tick % 1440;
  const hh = String(Math.floor(tod / 60)).padStart(2, '0');
  const mm = String(tod % 60).padStart(2, '0');
  return `Day ${day} ${hh}:${mm}`;
}

// #110 행동 라벨(UI 명사형). sim/constants.js의 ACTIONS **전 원소**가 여기 있어야 한다 —
// respond_fire가 빠져 있어 소방관이 출동할 때마다 피드가 'undefined 시작'으로 떴다.
// 행동을 늘리면 test/qa.test.js QA-20이 먼저 깨진다.
const ACTION_KO = {
  eat: '식사', sleep: '수면', work: '근무', socialize: '수다', play: '놀이', idle: '멍때리기',
  drink: '술 한잔', binge_eat: '폭식', hole_up: '은둔', exercise: '운동', build: '침대 만들기',
  read: '독서', shop: '장보기', fish: '낚시', cook_eat: '집밥', construct: '공사 돕기', see_doctor: '병원 진료',
  respond_fire: '화재 진압', study: '학교 수업', seek_food_aid: '공공 식사 요청',
  escort_child_doctor: '아이 병원 동행',
  supply_groceries: '식료품 공급',
  grow_groceries: '주문 식료품 재배',
  stock_food: '식료품 비축',
  visit_culture: '문화 생활',
  settle_village: '가족과 이주',
  // §23.8 여가 확대
  stroll: '산책', garden: '텃밭 가꾸기', music: '악기 연주', volunteer: '봉사 활동', board_game: '보드게임',
};
// 직업 라벨과 같은 규칙 — 표를 직접 인덱싱하지 않는다. 미등록 행동이 와도
// 피드에 'undefined 시작'이 아니라 '활동 시작'이 뜬다.
function actionKo(id, fallback = '활동') { return ACTION_KO[id] ?? fallback; }
const BLOCK_KO = {
  no_money: '돈 부족', off_hours: '시간 아님', full: '자리 없음', sated: '필요 없음',
  not_coping: '멀쩡함', not_needed: '불필요', no_funds: '국고 부족',
  no_stock: '시장 재고 부족', no_market_funds: '시장 구매 자금 부족',
};
// #107 직업 라벨. sim/traits.js의 OCCUPATIONS **전 원소**가 여기 있어야 한다 —
// 5종만 있던 동안 라이브 주민 173명 중 137명(79%)의 직업 칸이 'undefined'였다(child만 71명).
// 직업을 늘리면 test/qa.test.js QA-19가 먼저 깨진다.
const OCC_KO = {
  office_worker: '회사원', barista: '바리스타', freelancer: '프리랜서', student: '학생', retired: '은퇴',
  doctor: '의사', civil_servant: '공무원', teacher: '교사',
  police: '경찰', firefighter: '소방관', nurse: '간호사', politician: '정치인',
  worker: '공장 노동자',
  chef: '요리사', clerk: '점원',
  child: '아이',
  jobless: '구직 중',
  artisan:'장인', researcher:'연구원', logistician:'물류 담당자',
};
// 라벨은 **한 곳에서만** 푼다. 표를 직접 인덱싱하면 미등록 키가 화면에
// 'undefined'로(폴백 없는 자리) 또는 원시 영문 키로(폴백이 키인 자리) 새어 나간다.
function occKo(id, fallback = '주민') { return OCC_KO[id] ?? fallback; }
const NEED_KO = { hunger: '배고픔', energy: '수면 욕구', social: '외로움', fun: '심심함', money: '돈 걱정', mood: '울적함', space: '집이 좁음' };
// §22.16 표시 이름은 성+이름. 성이 없는 오래된 세이브도 이름만으로 그대로 나온다.
function simName(id) {
  const s = world?.sims.find((x) => x.id === id);
  if (!s) return `심${id}`;
  return `${s.surname ?? ''}${s.name ?? ''}` || `심${id}`;
}
// 말풍선·라벨처럼 좁은 자리에서는 이름만 쓴다 (성까지 넣으면 겹친다)
function simGivenName(id) { return world?.sims.find((x) => x.id === id)?.name ?? `심${id}`; }
// §22.62 대화 응답 선택에 쓰는 성격. 스냅샷의 traits.mbti는 §22.8 투영에 이미 들어 있다.
function simMbti(id) { return world?.sims.find((x) => x.id === id)?.traits?.mbti ?? null; }

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
    out += ` [${blocked.slice(0, 2).map((c) => `${actionKo(c.a)}✗${BLOCK_KO[c.b]}`).join(', ')}]`;
  }
  return out;
}

// §17.20 화재 오버레이: 불타는 시설 위 🔥
const fireSprites = new Map();
function syncFires() {
  if (!scene || !world?.incidents) return;
  const alive = new Set(world.incidents.map((i) => i.facilityId));
  for (const [id, sp] of fireSprites) {
    // §22.10 repeat:-1 트윈은 destroy로 죽지 않는다 — 먼저 끊고 파괴한다
    if (!alive.has(id)) { scene.tweens.killTweensOf(sp); sp.destroy(); fireSprites.delete(id); }
  }
  for (const inc of world.incidents) {
    if (fireSprites.has(inc.facilityId)) continue;
    const fac = world.map.facilities.find((f) => f.id === inc.facilityId);
    if (!fac) continue;
    const tx = isoX(fac.x + fac.w / 2, fac.y + fac.h / 2);
    const ty = isoY(fac.x + fac.w / 2, fac.y + fac.h / 2) - 40;
    const em = scene.add.text(tx, ty, '🔥', { fontSize: '28px' }).setOrigin(0.5);
    em.setDepth(6000);
    scene.tweens.add({ targets: em, y: ty - 8, scale: 1.2, duration: 400, yoyo: true, repeat: -1 });
    fireSprites.set(inc.facilityId, em);
  }
}

// §18.T4 등급 배지 + 승급 폭죽
const TIER_BADGE = ['badge_village', 'badge_town', 'badge_city', 'badge_metropolis'];
function updateBadge() {
  const img = document.getElementById('tier-badge');
  if (!img || !world) return;
  img.src = `./ui/${TIER_BADGE[world.cityTier ?? 0]}.png`;
  img.title = ['마을', '읍', '시', '대도시'][world.cityTier ?? 0];
}
function fireworksBurst() {
  if (!scene) return;
  const cam = scene.cameras.main;
  for (let i = 0; i < 6; i++) {
    const x = cam.scrollX + cam.width / 2 + (i - 3) * 60;
    const y = cam.scrollY + cam.height / 2 - 80 + (i % 2) * 60;
    const fx = scene.add.image(x, y, 'firework').setDepth(9000).setScale(0.6 + (i % 3) * 0.3);
    scene.tweens.add({ targets: fx, alpha: 0, scale: '+=0.5', duration: 1200 + i * 150, onComplete: () => fx.destroy() });
  }
}

function facTypeOf(facId) {
  return world?.map?.facilities?.find((f) => f.id === facId)?.type;
}

function eventText(e) {
  const n = simName(e.simId);
  switch (e.type) {
    case 'action_started': return e.payload.action === 'idle' ? null : `${n}: ${actionKo(e.payload.action)} 시작${reasonText(e.payload.reason)}`;
    case 'action_completed': return `${n}: ${actionKo(e.payload.action)} 완료`;
    case 'action_failed': return `${n}: 행동 실패 (${e.payload.reason})`;
    case 'money_changed': return `${n}: ${e.payload.delta > 0 ? '+' : ''}${e.payload.delta}원${e.payload.tax ? ` (세금 ${e.payload.tax}원)` : ''} (잔액 ${e.payload.balance})`;
    case 'welfare_paid': return `🏛️ 정부가 ${n}에게 생계 지원 +${e.payload.amount}원 (국고 ${e.payload.treasury}원)`;
    case 'fire_started': return `🔥 ${placeKo(e.payload.facilityId)}에 불이 났다!`; // house8이 새던 자리
    // QA #C: fire_started는 시설 종류를 한국어로 보여주는데 fire_out만 원시 id가 새고 있었다
    case 'fire_out': {
      const fp = placeKo(e.payload.facilityId);
      return e.payload.by === 'self'
        ? `💨 ${fp}의 불이 겨우 잦아들었다… (아무도 안 왔다)`
        : `🚒 ${ga(simName(e.payload.by))} ${fp} 화재를 진압했다!`;
    }
    case 'heroic_save': return `🎖️ ${n}: 영웅이 됐다`;
    case 'petition': {
      const ko = { lonely: '외롭다', hungry: '배고프다', road_detour: '길이 너무 돌아간다' };
      return `📢 주민 청원: "${ko[e.payload.kind] ?? e.payload.kind}" (${e.payload.total}건, 문턱 ${e.payload.threshold})`;
    }
    case 'car_bought': return `🚗 ${ga(n)} 차를 샀다 (장거리 ${e.payload.longTrips}회 · ${e.payload.price}원, 잔액 ${e.payload.balance})`;
    case 'station_unlocked': return `🚉 장거리 이동 수요가 문턱을 넘었다 — 기차역 언락! (수요 ${e.payload.demand}/${e.payload.threshold} · 충족도 ${e.payload.fulfillmentPct}% · 장거리 ${e.payload.totalLongTrips}회 · 차 ${e.payload.carsOwned}대)`;
    case 'rail_opened': return `🚆 두 역을 잇는 무료 공공 셔틀이 개통됐습니다 (${e.payload.tiles}칸 · 정원 ${e.payload.capacity}명)`;
    case 'rail_boarded': return `🚆 ${ga(n)} 열차에 탔습니다 (대기 ${e.payload.waitTicks}틱)`;
    case 'rail_alighted': return `🚉 ${ga(n)} 열차에서 내려 목적지로 갑니다`;
    case 'rail_suspended': return '⏸ 선로 또는 역을 사용할 수 없어 셔틀 운행을 멈췄습니다';
    case 'rail_resumed': return '🚆 셔틀 운행을 재개했습니다';
    case 'rail_cancelled': return `${ga(n)} 철도 여정을 중단하고 목적지까지의 경로를 다시 찾습니다`;
    case 'industry_unlocked': return `🏭 ${PLACE_KO[e.payload.facility]} 산업이 실제 수요로 열렸습니다 (${e.payload.evidence}/${e.payload.threshold})`;
    case 'city_promoted': return `🏙️ ${ro((world?.villages?.find(v => v.id === e.payload.villageId)?.name ?? '해솔') + e.payload.nameKo)} 승격했습니다! (인구 ${e.payload.pop}명) 🎆`;
    case 'zoned': return `📐 시장이 공터 ${e.payload.plotId}에 ${PLACE_KO[e.payload.type] ?? e.payload.type} 건설을 지시했다 (−${e.payload.cost}원${e.payload.demolished ? ` + 도로 ${e.payload.demolished}칸 철거 ${e.payload.demolitionCost}원` : ''}, 국고 ${e.payload.treasury}원)`;
    case 'policy_changed': {
      const ko = { taxPct: '세율', welfareAmount: '복지 지급액', welfareThreshold: '복지 기준', healthCopayPct: '진료 자기부담', childAllowance: '아이당 일일 지원' };
      // §22.37 before가 없어도 피드가 죽으면 안 된다. 시장 경로가 before를 안 싣던
      // 동안 쌓인 과거 이벤트가 그대로 남아 있고, 여기서 예외가 나면 **그 이벤트만이
      // 아니라 피드 렌더 전체가** 멈춘다.
      const bf = e.payload.before ?? {};
      const parts = Object.entries(e.payload.changes).map(([k, v2]) => (bf[k] !== undefined
        ? `${ko[k] ?? k} ${bf[k]}→${v2}${k.endsWith('Pct') ? '%' : '원'}`
        : `${ko[k] ?? k} ${v2}${k.endsWith('Pct') ? '%' : '원'}로`));
      const town=e.payload.villageId?(world?.villages?.find(v=>v.id===e.payload.villageId)?.name??e.payload.villageId):'';
      return `🏛️ ${town?town+' ':''}시정 발표: ${parts.join(', ')}`;
    }
    case 'starving': return `⚠️ ${ga(n)} 굶고 있습니다!`;
    case 'medical_visit_paid': return `🏥 ${n} 진료 완료: 환자 측 ${e.payload.patientCost}원 · 공공 부담 ${e.payload.subsidy}원`;
    case 'child_allowance_paid': return `🧒 ${n} 가구에 아이 #${e.payload.childId} 지원 ${e.payload.amount}원`;
    case 'child_escorted': return `🏥 ${n} 아이 #${e.payload.childId}와 병원으로 동행합니다`;
    case 'rent_paid': return `🏠 ${n} 가구가 임대료 ${e.payload.paid}원을 냈습니다${e.payload.shortfall ? ` (부족 ${e.payload.shortfall}원)` : ''}`;
    case 'rent_shortfall': return `⚠️ ${n} 가구의 임대료가 ${e.payload.shortfall}원 부족합니다`;
    case 'lonely': return `${ga(n)} 혼자 시간을 보냈습니다…`;
    case 'argument': return `💢 ${wa(n)} ${ga(simName(e.payload.withSimId))} 말다툼했습니다`;
    case 'center_planned': return `📍 (${e.payload.x}, ${e.payload.y})에 계획 중심지가 지정되었다 (−${e.payload.cost}원, 국고 ${e.payload.treasury}원)`;
    case 'input_rejected': return `지시 거부됨 (${e.payload.reason})`;
    case 'player_created': return `🏠 ${ga(e.payload.name)} 마을에 이사 왔습니다! (${occKo(e.payload.occupation)})`;
    case 'logic_changed': return `🔧 심들의 판단 로직이 갱신되었습니다 (${e.payload.hash})`;
    case 'token_created': {
      const place = e.payload.placeId === 'cafe' ? '카페' : '공원';
      return e.payload.announced
        ? `📣 ${ga(n)} ${place} 모임을 공지했습니다! (${fmtClock(e.payload.scheduledTick)})`
        : `📅 ${place}에서 모임 소문이 돌기 시작했습니다 (${fmtClock(e.payload.scheduledTick)})`;
    }
    case 'gathering': {
      const place = e.payload.placeId === 'cafe' ? '카페' : '공원';
      return `🎉 ${place} 모임에 ${e.payload.count}명이 모였습니다!`;
    }
    case 'conversation': return `💬 ${n} → ${simName(e.payload.withSimId)}: "${conversationLine(e)}"`;
    case 'hangover': return `🥴 ${ga(n)} 과음했습니다… 내일이 걱정입니다`;
    case 'weather_changed': return { sunny: '☀️ 화창한 아침입니다', cloudy: '☁️ 날이 흐립니다', rain: '🌧️ 비가 내리기 시작했습니다' }[e.payload.kind];
    case 'item_spawned': return null; // 어디 떨어졌는지는 비밀 — 발견의 재미
    case 'season_changed': return `🍂 ${ {spring:'봄',summer:'여름',autumn:'가을',winter:'겨울'}[e.payload.to] }이 시작됐습니다`;
    case 'needs_tier_changed': return `${simName(e.simId)}의 생활 단계가 ${e.payload.to === 1 ? '시민' : '정착민'}으로 바뀌었습니다`;
    case 'founding_petition_created': return `🏘️ ${ga(simName(e.simId))} 주거와 지역 공터 부족으로 개척 청원을 올렸습니다`;
    case 'founding_petition_withdrawn': return `🏘️ 개척 청원 조건이 달라져 청원이 철회됐습니다`;
    case 'founding_approved': return `🏘️ 개척 청원이 승인됐습니다. 파견 준비가 필요합니다`;
    case 'founding_rejected': return `🏘️ 개척 청원이 거부됐습니다`;
    case 'founding_funded': return `🏘️ 개척 주택의 건설비가 지급되고 부지가 예약됐습니다`;
    case 'founding_cancelled': return `🏘️ 개척 계획의 조건이 달라져 취소됐습니다`;
    case 'founding_homes_built': return `🏘️ 개척 주택이 완공되어 정착을 기다립니다`;
    case 'founding_gathering': return `🏘️ 가족들이 이주를 준비합니다`;
    case 'household_migration_gathering': return `📦 가족들이 다른 마을로 이사할 준비를 합니다`;
    case 'household_migration_departed': return `📦 가족들이 새 집을 향해 출발했습니다`;
    case 'founding_departed': return `🏘️ 가족들이 새 정착지로 출발했습니다`;
    case 'village_founded': return `🏘️ 주민들이 도착해 새 마을을 세웠습니다`;
    case 'supply_delivered': return `🚚 ${ga(n)} 식료품 ${e.payload.quantity}개를 공급하고 ${e.payload.payment}원을 받았습니다`;
    // §23.31 '살림' 필터가 보여주겠다고 약속했는데 문장이 없어 화면이 비던 여섯 가지.
    // money_shared는 60일에 159건 — 이 게임에서 가장 다정한 사건이 통째로 침묵했다.
    case 'money_shared': return `💝 ${ga(n)} 곤경에 처한 ${simName(e.payload.toSimId)}에게 ${e.payload.amount}원을 건넸습니다`;
    case 'wage_shortfall': return `💸 ${ga(n)} 임금을 다 못 받았습니다 (${e.payload.paid}/${e.payload.asked}원)`;
    case 'insolvent': return `🏛️ 국고가 비어 ${ga(n)} 임금을 다 못 받았습니다 (${e.payload.paid}/${e.payload.asked}원)`;
    case 'treasury_debt': return `📉 국고가 빚으로 내려갔습니다 (${e.payload.treasury.toLocaleString()}원)`;
    case 'mayor_stipend': return `🏛️ 시장 수당이 지급됐습니다`;
    case 'public_revenue_remitted': return `🏛️ ${placeKo(e.payload.facilityId)}의 수입 ${e.payload.amount.toLocaleString()}원이 국고로 들어왔습니다`;
    // 초대와 거절 — 60일에 1,100건. 누가 누구를 불렀고 거절당했다는 드라마가 무성이었다.
    case 'invited': return `🙋 ${ga(n)} ${simName(e.payload.toSimId)}에게 같이 가자고 했습니다`;
    case 'invite_declined': return `🙅 ${simName(e.payload.toSimId)}${hasJong(simName(e.payload.toSimId)) ? '이' : '가'} ${ne(n)} 청을 거절했습니다`;
    case 'invite_fulfilled': return `🤝 ${ga(n)} ${simName(e.payload.toSimId)}와 약속한 자리에 함께 왔습니다`;
    case 'item_found': return `✨ ${ga(n)} 길에서 ${e.payload.amount}원을 주웠습니다!`;
    case 'fish_caught': return `🎣 ${ga(n)} ${e.payload.amount}원짜리 물고기를 낚았습니다!`;
    // 인라인 맵에 세 종류만 있어서 lab·warehouse·apartment·학교가 전부 undefined였다.
    // 시설 이름의 권위는 PLACE_FALLBACK 하나다 (§23.7에서 이미 만들어 뒀다).
    case 'project_started': {
      const tp = PLACE_FALLBACK[e.payload.type] ?? '새 건물';
      return `🏗️ 마을에 새 ${tp} 공사가 시작됐습니다! 심들이 힘을 보탭니다`;
    }
    case 'facility_built': {
      const tp = PLACE_FALLBACK[e.payload.type] ?? '새 건물';
      return `🎊 ${ga(tp)} 완공됐습니다! 마을이 넓어졌어요`;
    }
    case 'moved_home': return `📦 ${ga(n)} 새 집으로 이사했습니다`;
    case 'child_settled': return `👶 ${simName(e.payload.parentA)}·${simName(e.payload.parentB)} 부부의 자녀 ${ga(e.payload.name)} 마을에서 자립을 시작했습니다!`;
    case 'immigrated': return `🚌 ${ga(e.payload.name)} 해솔마을로 이사 왔습니다! (${occKo(e.payload.occupation)})`;
    case 'fell_sick': return `🤒 ${ga(n)} 감기에 걸렸습니다`;
    case 'recovered': return e.payload.how === 'doctor' ? `💊 ${ga(n)} 진료를 받고 나았습니다` : `🌤️ ${ga(n)} 감기에서 회복했습니다`;
    case 'election': return `🗳️ 선거 결과 — ${ga(n)} 해솔마을 시장이 되었습니다! (득표 ${e.payload.votes.join(':')})`;
    case 'started_dating': return `💕 ${wa(n)} ${ga(simName(e.payload.withSimId))} 사귀기 시작했습니다!`;
    // §23.19 '이야기' 필터를 켰더니 화면이 비었다. 이 여섯 가지는 마을에서 실제로
    // 일어나는데 **피드에 문장이 없어서** 한 번도 보인 적이 없었다. 사건이 있는데
    // 말이 없으면 없는 일이다.
    case 'relationship_changed': {
      const who = simName(e.payload.withSimId);
      const TIER = { friend: `🤝 ${wa(n)} ${ga(who)} 친구가 되었습니다`,
        rival: `💢 ${wa(n)} ${ga(who)} 사이가 틀어졌습니다`,
        acquaintance: `🙂 ${wa(n)} ${ga(who)} 아는 사이가 되었습니다`,
        stranger: `🍃 ${wa(n)} ${ga(who)} 멀어졌습니다` };
      return TIER[e.payload.tier] ?? null;
    }
    case 'job_changed': {
      const to = occKo(e.payload.to, null);
      if (!to) return null;
      if (e.payload.to === 'jobless') return `📄 ${ga(n)} 일자리를 잃었습니다`;
      const why = { public_post: ' (공공 자리를 채웠습니다)', over_quota: ' (정원이 줄었습니다)',
        immigration_quota: '', player_quota: '' }[e.payload.reason] ?? '';
      return `💼 ${ga(n)} ${ga(to)} 되었습니다${why}`; // 조사는 헬퍼로 — '회사원가'가 찍혔다
    }
    case 'grew_up': return `🌱 ${ga(n)} ${e.payload.age}살이 되어 학교에 갑니다`;
    case 'bereaved': return `🕯️ ${ga(n)} 가까운 사람을 떠나보냈습니다`;
    case 'died': return `🕯️ ${ga(n)} 세상을 떠났습니다`;
    case 'emigrated': return `🧳 ${ga(n)} 마을을 떠났습니다`;
    case 'married': return `💒 ${wa(n)} ${ga(simName(e.payload.withSimId))} 결혼했습니다! 🎉`;
    case 'broke_up': return `💔 ${wa(n)} ${ga(simName(e.payload.withSimId))} 헤어졌습니다…`;
    case 'new_year': return `🎆 해솔마을의 새해가 밝았습니다! (${e.payload.year}년차)`;
    case 'festival': return `🏮 해솔마을 축제가 오늘 저녁 공원에서 열립니다! 모두 오세요!`;
    case 'graduated': return `🎓 ${ga(n)} 학교를 졸업하고 취직했습니다`;
    case 'retired_now': return `🌅 ${ga(n)} 은퇴했습니다. 수고하셨습니다`;
    case 'joined_club': {
      const cn = { book_club: '독서회', fishing_club: '낚시회', fitness_club: '운동모임', drinking_pals: '술벗' }[e.payload.clubId];
      return `🎪 ${ga(n)} ${cn}에 가입했습니다`;
    }
    case 'road_formed': return `🛤️ 많이 다니던 길이 도로가 되었습니다 (${e.payload.x}, ${e.payload.y})`;
    case 'sidewalk_formed': return `🚶 많이 걷던 자리에 인도가 생겼습니다 (${e.payload.x}, ${e.payload.y})`;
    case 'bed_built': return `🛏️ ${ga(n)} 집에 침대를 새로 만들었습니다!`;
    case 'public_works': {
      const n2 = e.payload.tiles?.length ?? 0;
      if (e.payload.kind === 'route') return `🏗️ 우회 민원 연결로 ${n2}칸 완공: ${e.payload.before} → ${e.payload.after}칸 이동 (-${e.payload.cost}원)`;
      return `🏗️ 시장이 사람들이 다니는 길 ${n2}칸을 포장했습니다 (-${e.payload.cost}원, 국고 ${e.payload.treasury}원)`;
    }
    case 'road_requested': return `🚶 ${ga(n)} 반복 우회로 개선을 요청했습니다 (${e.payload.walked}칸, 직선 ${e.payload.direct}칸)`;
    case 'road_work_planned': return `🏗️ 시장이 우회 연결로 ${e.payload.tiles}칸 공사를 계획했습니다 (예상 ${e.payload.cost}원)`;
    case 'ability_changed': return `📚 ${ga(n)} ${{stamina:'체력',dexterity:'손재주',intellect:'지능',charisma:'사교성'}[e.payload.ability]} ${e.payload.value}/${e.payload.potential} (${{study:'배움',career:'근무',exercise:'운동',age:'나이'}[e.payload.source]})`;
    case 'public_posts_filled': {
      const parts = [];
      if (e.payload.hired > 0) parts.push(`${e.payload.hired}곳을 채웠고`);
      if (e.payload.trimmed > 0) parts.push(`${e.payload.trimmed}곳을 줄였습니다`);
      return `🏛️ 인구 ${e.payload.population}명에 맞춰 공공 자리 ${parts.join(' ') || '을 정리했습니다'}`;
    }
    case 'genius_born': return `⭐ ${ga(n)} 특별한 재능을 갖고 태어났습니다 (잠재치 ${e.payload.cap}, 성장에는 배움과 환경이 필요합니다)`;
    case 'school_enrolled': return `🎒 ${ga(n)} ${PLACE_KO[e.payload.stage]}에 다닙니다 (${e.payload.age}세)`;
    case 'school_planned': return `🏫 학생 수요에 따라 ${PLACE_KO[e.payload.type]} 공사를 시작했습니다 (국고 −${e.payload.cost}원)`;
    case 'public_meal_taken': return `🍲 ${ga(n)} 공공 식사를 받았습니다 (국고 −${e.payload.cost}원)`;
    case 'education_decided': return e.payload.choice === 'degree' ? `🎓 ${ga(n)} ${{university:'학부',masters:'석사',doctorate:'박사'}[e.payload.course]} 과정을 졸업했습니다`
      : e.payload.choice === 'postgraduate' ? `🎓 ${ga(n)} ${{masters:'석사',doctorate:'박사'}[e.payload.course]} 과정에 진학합니다`
      : e.payload.choice === 'university' ? `🎓 ${ga(n)} ${{university:'학부',masters:'석사',doctorate:'박사'}[e.payload.course]??'대학'} 과정에 등록했습니다 (학비 ${e.payload.tuition}원)`
      : e.payload.choice === 'employment' ? `💼 ${ga(n)} 대학 대신 취업을 선택했습니다`
      : `🎒 ${ga(n)} 대학 진학을 보류했습니다 (${{tuition:'학비 부족',unreachable:'통학로 없음',no_university:'대학 없음'}[e.payload.reason]})`;
    case 'side_talk': return `💬 ${ga(n)} 옆자리 ${wa(simName(e.payload.withSimId))} 말을 텄습니다`;
    case 'helped': {
      const why = { sick: '아픈', hungry: '배곯는', broke: '주머니가 빈' }[e.payload.why] ?? '';
      return `🤝 ${ga(n)} ${why} ${eul(simName(e.payload.toSimId))} 챙겼습니다`;
    }
    case 'greeting': return `👋 ${wa(n)} ${ga(simName(e.payload.withSimId))} 지나가며 인사했습니다`;
    default: return null;
  }
}

// §23.19 피드 필터. 이백 명이 사는 마을은 초당 수십 건을 쏟아내므로, 정작 "누가
// 결혼했다"가 "누가 밥을 먹었다" 사이에 묻힌다. 무엇을 볼지는 보는 사람이 정한다.
//   이야기 — 관계·생애·마을의 큰일
//   살림   — 돈이 오간 일
//   이 사람 — 지금 고른 사람의 일만
const FEED_STORY = new Set([
  'married', 'started_dating', 'broke_up', 'relationship_changed', 'child_settled', 'graduated',
  'grew_up', 'died', 'emigrated', 'immigrated', 'bereaved', 'retired_now', 'moved_home',
  'joined_club', 'genius_born', 'heroic_save', 'festival', 'new_year', 'election',
  'city_promoted', 'station_unlocked', 'facility_built', 'argument', 'petition',
  'rail_opened','rail_suspended','rail_resumed',
  'public_posts_filled', 'job_changed',
  'founding_petition_created', 'founding_petition_withdrawn',
  'founding_approved', 'founding_rejected',
  'founding_funded', 'founding_cancelled', 'founding_homes_built',
  'founding_gathering', 'founding_departed', 'village_founded',
  'household_migration_gathering', 'household_migration_departed',
]);
// conversation·greeting·gathering·invited는 뺐다. 실측에서 '이야기' 80줄이 전부 잡담(💬)이라
// 결혼도 출생도 그 사이에 묻혔다 — 수다는 이 마을의 **바탕음**이지 사건이 아니다.
// 잡담까지 보려면 '전부'가 있다.
const FEED_MONEY = new Set([
  'money_changed', 'welfare_paid', 'wage_shortfall', 'money_shared', 'treasury_debt',
  'insolvent', 'public_revenue_remitted', 'car_bought', 'mayor_stipend', 'public_works',
  'policy_changed', 'fish_caught', 'medical_visit_paid', 'child_allowance_paid',
]);
let feedFilter = 'all';
function feedPasses(e) {
  if (feedFilter === 'all') return true;
  if (feedFilter === 'mine') return selectedSimId !== null && e.simId === selectedSimId;
  if (feedFilter === 'story') return FEED_STORY.has(e.type);
  if (feedFilter === 'money') return FEED_MONEY.has(e.type);
  return true;
}

// ---- §22.24 부재중 연대기 (이슈 #90, DF 레전드 방식) ----
// 서버(server/chronicle.js)가 우선순위·상한으로 고른 사건을 시간순 이야기로 그린다.
// 이벤트 로그에 있는 사실만 문장 틀에 끼운다 — 지어내지 않는다.
const CHRON_KO = {
  died: '사망', bereaved: '사별', child_settled: '자립', married: '결혼', election: '선거',
  heroic_save: '구조', fire_started: '화재', fire_out: '진화', city_promoted: '승격',
  job_changed: '전직', policy_changed: '정책 변경', started_dating: '연애', broke_up: '이별',
  helped: '챙김', money_shared: '나눔', immigrated: '이민', grew_up: '성장', graduated: '졸업',
  retired_now: '은퇴', facility_built: '완공', festival: '축제', petition: '청원',
  education_decided: '진학·졸업',
  car_bought: '차 구입', fell_sick: '병치레',
};

function chronicleText(e, nameOf) {
  const n = nameOf(e.simId);
  const p = e.payload;
  const placeOfFac = (fid) => PLACE_KO[facTypeOf(fid)] ?? placeKo(fid);
  // 살아 있으면 성+이름(§22.16), 죽었거나 못 찾으면 payload의 이름으로
  const nOr = (fallback) => (fallback && n === `심${e.simId}` ? fallback : n);
  switch (e.type) {
    case 'died': {
      const cause = { illness: '병으로', starvation: '굶주림 끝에', age: '노환으로' }[p.cause] ?? '';
      return `🕯️ ${ga(nOr(p.name))} ${cause} 세상을 떠났습니다 (${p.age}세)`;
    }
    case 'bereaved': return `🖤 ${ga(n)} 배우자 ${eul(nameOf(p.lostSimId))} 잃었습니다`;
    case 'child_settled': return `👶 ${wa(nameOf(p.parentA))} ${nameOf(p.parentB)} 부부의 자녀 ${ga(nOr(p.name))} 자립을 시작했습니다`;
    case 'married': return `💒 ${wa(n)} ${ga(nameOf(p.withSimId))} 결혼했습니다`;
    case 'election': {
      const how = p.incumbent === e.simId ? '재선에 성공했습니다' : '새 시장이 되었습니다';
      return `🗳️ 선거에서 ${ga(n)} ${how} (득표 ${(p.votes ?? []).join(':')})`;
    }
    case 'heroic_save': return `🎖️ ${ga(n)} ${placeOfFac(p.facilityId)} 화재에서 사람들을 구해 영웅이 되었습니다`;
    case 'fire_started': return `🔥 ${placeOfFac(p.facilityId)}에 불이 났습니다`;
    case 'fire_out': return p.by === 'self'
      ? `💨 ${placeOfFac(p.facilityId)}의 불이 저절로 잦아들었습니다 (아무도 오지 않았습니다)`
      : `🚒 ${ga(nameOf(p.by))} ${placeOfFac(p.facilityId)} 화재를 진압했습니다`;
    case 'city_promoted': return `🏙️ ${ga(world?.villages?.find(v => v.id === p.villageId)?.name ?? '해솔')} ${ro(p.nameKo)} 승격했습니다 (인구 ${p.pop}명)`;
    case 'job_changed': return `💼 ${ga(n)} ${occKo(p.from)} 일을 접고 ${ro(occKo(p.to))} 전직했습니다`;
    case 'policy_changed': {
      const ko = { taxPct: '세율', welfareAmount: '복지 지급액', welfareThreshold: '복지 기준' };
      const parts = Object.entries(p.changes ?? {}).map(([k, v]) =>
        `${ko[k] ?? k} ${p.before?.[k] !== undefined ? `${p.before[k]}→` : ''}${v}${k === 'taxPct' ? '%' : '원'}`);
      const who = p.source === 'mayor' ? `시장 ${ga(n)} ` : '';
      const town=p.villageId?(world?.villages?.find(v=>v.id===p.villageId)?.name??p.villageId):'';
      return `🏛️ ${town?town+' · ':''}${who}정책을 바꿨습니다: ${parts.join(', ')}`;
    }
    case 'started_dating': return `💕 ${wa(n)} ${ga(nameOf(p.withSimId))} 사귀기 시작했습니다`;
    case 'broke_up': return `💔 ${wa(n)} ${ga(nameOf(p.withSimId))} 헤어졌습니다`;
    case 'helped': {
      const why = { sick: '앓아누운', hungry: '굶주린', broke: '주머니가 빈' }[p.why] ?? '어려운';
      return `🤝 ${ga(n)} ${why} ${eul(nameOf(p.toSimId))} 챙겼습니다`;
    }
    case 'money_shared': return `💝 ${ga(n)} 곤경에 처한 ${nameOf(p.toSimId)}에게 ${p.amount}원을 건넸습니다`;
    case 'immigrated': return `🚌 ${ga(nOr(p.name))} 마을로 이사 왔습니다 (${occKo(p.occupation)})`;
    case 'grew_up': return `🎒 ${ga(n)} 자라서 학교에 다니기 시작했습니다 (${p.age}세)`;
    case 'graduated': return `🎓 ${ga(n)} 학교를 졸업하고 ${ga(occKo(p.to))} 되었습니다`;
    case 'education_decided': {
      const course = { university: '학부', masters: '석사', doctorate: '박사' }[p.course] ?? '학위';
      if (p.choice === 'degree') return `🎓 ${ga(n)} ${course} 과정을 졸업했습니다`;
      if (p.choice === 'postgraduate') return `🎓 ${ga(n)} ${course} 과정에 진학하기로 했습니다`;
      if (p.choice === 'university') return `🎓 ${ga(n)} ${course} 과정에 등록했습니다`;
      if (p.choice === 'deferred') return `🎓 ${ga(n)} 학업 등록을 보류했습니다`;
      return `🎓 ${ga(n)} 대학 진학 대신 취업을 선택했습니다`;
    }
    case 'retired_now': return `🌅 ${ga(n)} 일을 내려놓고 은퇴했습니다`;
    case 'facility_built': {
      const tp = p.type === 'house' ? '새 집' : (PLACE_KO[p.type] ?? p.type);
      return `🎊 ${ga(tp)} 완공되어 마을이 넓어졌습니다`;
    }
    case 'festival': return `🏮 마을 축제가 공원에서 열렸습니다`;
    case 'petition': {
      const ko = { lonely: '외롭다', hungry: '배고프다' };
      return `📢 주민들이 "${ko[p.kind] ?? p.kind}" 청원을 올렸습니다 (${p.total}건)`;
    }
    case 'car_bought': return `🚗 ${ga(n)} 차를 샀습니다`;
    case 'fell_sick': return `🤒 ${ga(n)} 감기로 앓아누웠습니다`;
    default: return eventText(e); // 테이블 밖 종류가 와도 피드 문장으로는 보여준다
  }
}

function pushFeed(e) {
  const text = eventText(e); // 필터는 호출부에서 이미 걸렀다 (§23.19)
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

// §23.1 일대기. 같은 사건이라도 피드에서는 "방금 무슨 일이 있었나"이고, 여기서는
// "이 사람이 어떻게 살아왔나"다. 그래서 문장을 따로 쓴다 — 시제도, 고르는 사건도 다르다.
// 나이는 지금 나이에서 지난 햇수를 빼서 되짚는다 (한 해 = 1440틱 × 365).
const TICKS_PER_YEAR = 1440 * 365;
// 일대기는 **떠난 사람**을 자주 부른다 (사별·이별·옛 동료). 그 사람은 이미 world.sims에
// 없으므로 simName이 'sim{id}'를 만들어 낸다. 없는 이름을 지어내느니 이름 없이 쓴다.
function withName(id, withIt, without) {
  if (id == null) return without;
  const s2 = world?.sims?.find((x) => x.id === id);
  return s2 ? withIt(simName(id)) : without;
}
function lifeLine(r, ctx) {
  const p = r.payload ?? {};
  const occ = (id) => occKo(id, '일');
  switch (r.type) {
    case 'immigrated': return '이 마을에 왔다';
    case 'grew_up': return '학교에 갈 나이가 되었다';
    case 'graduated': return `학교를 마치고 ${ga(occ(p.to ?? p.occupation))} 되었다`;
    case 'job_changed':
      if (p.to === 'jobless') return '일자리를 잃었다';
      if (p.from === 'jobless' && p.to) return `${ro(occ(p.to))} 다시 일을 잡았다`;
      return p.to ? `${ro(occ(p.to))} 일을 옮겼다` : '하던 일을 바꿨다';
    // 짝 이벤트의 payload 키는 withSimId다 (sim/society.js). 예전엔 partner/with를 봐서
    // 화면에 "심undefined와 사귀기 시작했다"가 찍혔다 — 이름을 모르면 이름을 빼고 쓴다.
    case 'started_dating': return withName(p.withSimId, (n) => `${wa(n)} 사귀기 시작했다`, '누군가와 사귀기 시작했다');
    case 'married': return withName(p.withSimId, (n) => `${wa(n)} 결혼했다`, '결혼했다');
    case 'broke_up': return withName(p.withSimId, (n) => `${wa(n)} 헤어졌다`, '헤어졌다');
    case 'child_settled': return '아이가 제 살림을 차렸다';
    case 'moved_home': return '집을 옮겼다';
    case 'retired_now': return '일을 놓고 은퇴했다';
    case 'bereaved': return withName(p.lostSimId, (n) => `${eul(n)} 떠나보냈다`, '가까운 사람을 떠나보냈다');
    case 'car_bought': return '차를 장만했다';
    case 'joined_club': return `${CLUB_KO[p.clubId] ?? '모임'}에 들었다`;
    case 'heroic_save': return '불길에서 사람을 구했다';
    case 'genius_born': return '남다른 재능을 가지고 태어났다';
    case 'ability_changed': {
      // 나이가 들면 깎이기도 한다 — 사실과 반대로 쓰면 안 된다.
      const nm = ABIL_KO[p.ability] ?? p.ability;
      if (p.from != null && p.value < p.from) return `${ga(nm)} ${p.value}로 떨어졌다`;
      return `${ga(nm)} ${p.value}까지 늘었다`;
    }
    case 'died': return '세상을 떠났다';
    case 'emigrated': return '마을을 떠났다';
    default: return null;
  }
}
const CLUB_KO = { book_club: '독서회', fishing_club: '낚시회', fitness_club: '운동회', drinking_pals: '술벗' };
const ABIL_KO = { stamina: '체력', dexterity: '손재주', intellect: '지능', charisma: '사교성' };

// §23.11 마을 연대기 문장. 개인 일대기와 어휘가 다르다 — 여기서는 마을이 주어다.
function cityLine(r) {
  const p = r.payload ?? {};
  switch (r.type) {
    case 'festival': return '마을에 축제가 열렸다';
    case 'new_year': return '새해가 밝았다';
    case 'city_promoted': return `마을이 ${p.tier ?? ''}단계로 올라섰다`;
    case 'station_unlocked': return '역이 들어섰다';
    case 'election': {
      // 당선자는 표가 가장 많은 후보다 — payload에 winner가 따로 없다.
      const c = p.candidates ?? [], v = p.votes ?? [];
      if (c.length === 0 || c.length !== v.length) return '시장 선거가 있었다';
      let bi = 0; for (let i = 1; i < v.length; i++) if (v[i] > v[bi]) bi = i;
      const kept = p.incumbent === c[bi] ? '시장 자리를 지켰다' : '새 시장이 되었다';
      return `${ga(simName(c[bi]))} ${kept} (${v[bi]}표)`;
    }
    case 'policy_changed': return '시정이 바뀌었다';
    case 'center_planned': return '새 중심지가 계획됐다';
    case 'insolvent': return '국고가 바닥났다';
    case 'facility_built': return `${ga(PLACE_FALLBACK[p.type] ?? p.type ?? '새 건물')} 새로 문을 열었다`;
    case 'fire_started': return '불이 났다';
    default: return null;
  }
}
async function renderCityChronicle() {
  const box = $('dash-chron');
  if (!box) return;
  box.textContent = '불러오는 중…';
  try {
    const d = await fetch('/api/chronicle?sim=-1').then((r) => r.json());
    const rows = (d.rows ?? []).map((r) => ({ r, text: cityLine(r) })).filter((x) => x.text).slice(-60);
    if (rows.length === 0) { box.innerHTML = '<div class="ln">아직 기록된 일이 없다.</div>'; return; }
    let html = ''; let lastDay = null;
    for (const { r, text } of rows) {
      const day = Math.floor(r.tick / 1440);
      if (day !== lastDay) { html += `<div style="color:#ffcf6a;margin-top:5px">${day}일</div>`; lastDay = day; }
      html += `<div style="margin:2px 0;line-height:1.45">${text}</div>`;
    }
    box.innerHTML = html;
  } catch { box.innerHTML = '<div>연대기를 못 읽었다.</div>'; }
}

// §23.15 관계. 패널의 #relations는 처음부터 있었지만 아무도 쓰지 않았다.
// 이 마을에서 사람들이 하는 일의 대부분이 관계인데 화면에는 그게 없었다.
// §23.22 "어제 하루". 사람을 따라다닐 수 있게 됐지만(§23.18) **잠깐 눈을 떼면 그 사이에
// 무슨 일이 있었는지 알 수 없다.** 고배속에서는 30초에 하루가 지나간다.
// 그래서 고른 사람의 하루가 끝나면 저절로 한 문단으로 접힌다 — 사건 목록이 아니라 하루로.
let dayLog = { simId: null, day: -1, acts: {}, money: 0, notes: [] };
function noteForDay(e) {
  if (selectedSimId === null || e.simId !== selectedSimId) return;
  const day = Math.floor(e.tick / 1440);
  if (dayLog.simId !== selectedSimId || dayLog.day !== day) {
    if (dayLog.simId === selectedSimId && dayLog.day >= 0) renderDayCard();
    dayLog = { simId: selectedSimId, day, acts: {}, money: 0, notes: [] };
  }
  if (e.type === 'action_completed') {
    const a = e.payload.action;
    if (a !== 'idle') dayLog.acts[a] = (dayLog.acts[a] ?? 0) + 1;
  } else if (e.type === 'money_changed') {
    dayLog.money += e.payload.delta ?? 0;
  } else if (FEED_STORY.has(e.type)) {
    const t = eventText(e);
    if (t && dayLog.notes.length < 4) dayLog.notes.push(t.replace(/^[^\s]+\s/, '')); // 이모지 앞머리 제거
  }
}
function renderDayCard() {
  const box = $('daycard');
  if (!box) return;
  const acts = Object.entries(dayLog.acts).sort((a, b) => b[1] - a[1]);
  if (acts.length === 0 && dayLog.notes.length === 0) { box.style.display = 'none'; return; }
  const top = acts.slice(0, 4).map(([a, n]) => `${actionKo(a)}${n > 1 ? ` ${n}번` : ''}`).join(' · ');
  const money = dayLog.money === 0 ? '' :
    ` · 살림 ${dayLog.money > 0 ? '+' : ''}${dayLog.money.toLocaleString()}원`;
  box.replaceChildren();
  const head = document.createElement('b');
  head.textContent = `${dayLog.day}일의 하루`;
  box.append(head, document.createTextNode(` — ${top || '별일 없었다'}${money}`));
  for (const n of dayLog.notes) {
    const d = document.createElement('div');
    d.textContent = `· ${n}`;
    box.append(d);
  }
  box.style.display = 'block';
}

// §23.23 마을의 목표. 이 게임에는 **방향이 없었다** — 잘 굴러가는지, 무엇을 더 해야
// 하는지 화면이 말해 주지 않으니 오래 볼 이유가 생기지 않는다. 목표는 규칙이 아니라
// **읽는 방법**이다: 세계에 아무것도 강제하지 않고, 이미 일어난 일을 척도로 접는다.
// 그래서 전부 world 하나에서 계산된다 — 서버도, 저장도, 시뮬레이션 변경도 없다.
const GOALS = [
  { g: '사람', k: 'pop50', t: '마을이 되다', d: '주민 50명', max: 50, v: (w) => w.sims.length },
  { g: '사람', k: 'pop100', t: '읍이 되다', d: '주민 100명', max: 100, v: (w) => w.sims.length },
  { g: '사람', k: 'pop200', t: '도시가 되다', d: '주민 200명', max: 200, v: (w) => w.sims.length },
  { g: '사람', k: 'couples', t: '짝을 찾다', d: '커플 20쌍', max: 20,
    v: (w) => Object.keys(w.partners ?? {}).length / 2 },
  { g: '사람', k: 'genius', t: '남다른 아이', d: '천재가 태어난다', max: 1,
    v: (w) => w.sims.some((s) => s.isGenius) ? 1 : 0 },
  { g: '사람', k: 'elder', t: '오래 살다', d: '여든을 넘긴 주민', max: 1,
    v: (w) => w.sims.some((s) => (s.traits?.age ?? 0) >= 80) ? 1 : 0 },

  { g: '살림', k: 'treasury', t: '곳간을 채우다', d: '국고 100만 원', max: 1000000, v: (w) => w.treasury },
  { g: '살림', k: 'solvent', t: '빚 없는 마을', d: '국고가 흑자다', max: 1, v: (w) => w.treasury > 0 ? 1 : 0 },
  { g: '살림', k: 'rich', t: '넉넉한 살림', d: '평균 소지금 3,000원', max: 3000,
    v: (w) => w.sims.length ? Math.round(w.sims.reduce((a, s) => a + (s.money ?? 0), 0) / w.sims.length) : 0 },
  { g: '살림', k: 'employed', t: '일자리가 있다', d: '고용률 70%', max: 70,
    v: (w) => { const adults = w.sims.filter((s) => !['child', 'student', 'retired'].includes(s.traits?.occupation)); 
      return adults.length ? Math.round(100 * adults.filter((s) => s.traits.occupation !== 'jobless').length / adults.length) : 0; } },

  { g: '도시', k: 'facTypes', t: '없는 게 없다', d: '시설 종류 12가지', max: 12,
    v: (w) => new Set(w.map.facilities.map((f) => f.type)).size },
  { g: '도시', k: 'beds', t: '누울 자리', d: '침대가 인구보다 많다', max: 1,
    v: (w) => { const beds = w.map.facilities.filter((f) => f.type === 'house' || f.type === 'apartment')
      .reduce((n, f) => n + f.resources.length, 0); return beds > w.sims.length ? 1 : 0; } },
  { g: '도시', k: 'rep', t: '소문난 마을', d: '평판 500', max: 500, v: (w) => w.reputation ?? 0 },
  { g: '도시', k: 'tier', t: '승격', d: '도시 등급 3', max: 3, v: (w) => w.cityTier ?? 0 },
  { g: '도시', k: 'industry', t: '산업이 서다', d: '산업 3종 해금', max: 3,
    v: (w) => (w.unlockedIndustries ?? []).length },

  { g: '삶', k: 'healthy', t: '건강한 마을', d: '아픈 사람이 열 명 미만', max: 1,
    v: (w) => w.sims.filter((s) => s.sick).length < 10 ? 1 : 0 },
  // 기분은 매 틱 0으로 끌려가도록 설계돼 있다(mood.decayPerTick). 그래서 "양수인 주민 수"는
  // 0 근처의 동전 던지기를 세는 것이지 마을이 살 만한지를 재는 것이 아니다 — 실측 18%가
  // 나쁜 상태를 뜻하지 않았다. **평균 기분**을 본다. 대시보드의 행복도와 같은 척도다.
  { g: '삶', k: 'happy', t: '살 만하다', d: '평균 기분 +1,500 (행복도 57%)', max: 1500,
    v: (w) => w.sims.length ? Math.round(w.sims.reduce((a, s) => a + (s.mood ?? 0), 0) / w.sims.length) : 0 },
  { g: '삶', k: 'cars', t: '길이 붐빈다', d: '자가용 20대', max: 20, v: (w) => w.sims.filter((s) => s.hasCar).length },
];

// §23.27 목표는 열어 봐야 보였다. **달성하는 순간**이 화면에 없으면 목표가 아니라 표다.
// 배치마다 값을 다시 재기엔 열여덟 개가 무겁지 않다 — 전부 world 한 번 훑기다.
// 처음 켤 때 이미 달성한 것들은 알리지 않는다 (2,000일 된 마을에서 열한 줄이 쏟아진다).
const goalHit = new Set();
let goalPrimed = false;
function checkGoals() {
  if (!world) return;
  for (const g of GOALS) {
    let v = 0;
    try { v = g.v(world) ?? 0; } catch { v = 0; }
    if (v < g.max || goalHit.has(g.k)) continue;
    goalHit.add(g.k);
    if (!goalPrimed) continue; // 첫 통과는 현재 상태를 담는 것뿐이다
    pushGoalLine(g);
  }
  goalPrimed = true;
}
function pushGoalLine(g) {
  if (feedFilter === 'money' || feedFilter === 'mine') return; // 그 화면의 주제가 아니다
  const div = document.createElement('div');
  div.className = 'ev';
  div.style.color = '#ffcf6a';
  const ts = document.createElement('span');
  ts.className = 't';
  ts.textContent = fmtClock(world.worldTick);
  div.append(ts, document.createTextNode(`🏆 ${g.t} — ${g.d}`));
  const feed = $('feed');
  feed.prepend(div);
  while (feed.children.length > 80) feed.lastChild.remove();
}

function renderGoals() {
  const box = $('goals-list');
  if (!box || !world) return;
  box.replaceChildren();
  let done = 0;
  let lastGroup = null;
  for (const g of GOALS) {
    let v = 0;
    try { v = g.v(world) ?? 0; } catch { v = 0; }
    const pct = Math.max(0, Math.min(100, Math.round(100 * v / g.max)));
    if (pct >= 100) done++;
    if (g.g !== lastGroup) {
      const h = document.createElement('h3');
      h.textContent = g.g;
      box.append(h); lastGroup = g.g;
    }
    const row = document.createElement('div');
    row.className = 'g' + (pct >= 100 ? ' done' : '');
    const head = document.createElement('div');
    head.className = 'gh';
    const nm = document.createElement('span');
    nm.textContent = (pct >= 100 ? '✅ ' : '') + g.t;
    const val = document.createElement('span');
    val.className = 'v';
    val.textContent = g.max === 1 ? (pct >= 100 ? '달성' : '아직')
      : `${Math.round(v).toLocaleString()} / ${g.max.toLocaleString()}`;
    head.append(nm, val);
    const desc = document.createElement('div');
    desc.className = 'gd';
    desc.textContent = g.d;
    const track = document.createElement('div');
    track.className = 'gt';
    const fill = document.createElement('div');
    fill.className = 'gf';
    fill.style.width = `${pct}%`;
    track.append(fill);
    row.append(head, desc, track);
    box.append(row);
  }
  $('goals-count').textContent = `— ${done} / ${GOALS.length} 달성`;
}

// §23.21 미니맵. 맵은 512×512이고 화면에는 그중 30칸 남짓이 보인다 — 카메라를 끌다 보면
// **내가 어디 있는지, 마을이 어디였는지** 알 방법이 없었다. 따라가기를 넣고 나니 더 그랬다.
//
// 지형을 매 프레임 다시 그리면 26만 칸이라 감당이 안 된다. 지형은 **바뀔 때만** 오프스크린
// 캔버스에 굽고(§22.104 컬링과 같은 발상), 매 프레임에는 구운 그림 위에 사람·시야만 얹는다.
let miniBaked = null, miniKey = '';
const MINI_SIZE = 168;
function bakeMinimap() {
  const map = world.map;
  const key = `${map.facilities.length}:${world.terrainVersion ?? 0}`;
  if (miniKey === key && miniBaked) return miniBaked;
  const c = document.createElement('canvas');
  c.width = MINI_SIZE; c.height = MINI_SIZE;
  const g = c.getContext('2d');
  g.fillStyle = '#20301c'; g.fillRect(0, 0, MINI_SIZE, MINI_SIZE); // 들판
  const sc = MINI_SIZE / map.w;
  // 도로·물만 굵게 — 미니맵에서 알아볼 수 있는 것은 길과 물과 건물뿐이다.
  const img = g.createImageData(MINI_SIZE, MINI_SIZE);
  const px = img.data;
  const COL = { 1: [86, 80, 72], 2: [110, 104, 96], 12: [110, 104, 96], 5: [40, 62, 96], 6: [52, 82, 120],
    7: [92, 104, 84], 8: [140, 128, 96], 9: [96, 92, 88], 10: [80, 88, 70], 11: [120, 104, 76], 4: [44, 74, 44] };
  for (let y = 0; y < MINI_SIZE; y++) {
    const my = Math.floor(y / sc);
    for (let x = 0; x < MINI_SIZE; x++) {
      const t = map.tiles[my * map.w + Math.floor(x / sc)];
      const c3 = COL[t] ?? [32, 48, 28];
      const o = (y * MINI_SIZE + x) * 4;
      px[o] = c3[0]; px[o + 1] = c3[1]; px[o + 2] = c3[2]; px[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // 시설은 그 위에 점으로 — 집은 흐리게, 그 밖은 또렷하게. 마을의 모양이 한눈에 든다.
  for (const f of map.facilities) {
    g.fillStyle = f.type === 'house' || f.type === 'apartment' ? '#8a6f4a' : '#ffcf6a';
    g.fillRect(f.x * sc, f.y * sc, Math.max(2, f.w * sc), Math.max(2, f.h * sc));
  }
  miniKey = key; miniBaked = c;
  return c;
}

function drawMinimap() {
  const cv = $('minimap');
  if (!cv || !world) return;
  const g = cv.getContext('2d');
  const map = world.map;
  const sc = MINI_SIZE / map.w;
  g.drawImage(bakeMinimap(), 0, 0);
  // 사람 — 고른 사람만 눈에 띄게. 나머지는 옅은 점.
  g.fillStyle = '#cfe8ff88';
  for (const s of world.sims) g.fillRect(s.x * sc, s.y * sc, 1.5, 1.5);
  const sel = selectedSimId !== null ? world.sims.find((s) => s.id === selectedSimId) : null;
  if (sel) {
    g.fillStyle = '#ff5f5f';
    g.beginPath(); g.arc(sel.x * sc, sel.y * sc, 3, 0, Math.PI * 2); g.fill();
  }
  // 지금 보고 있는 곳 — 아이소 화면을 타일로 되돌리면 마름모다. 사각형으로 근사하지 않는다.
  const cam = scene?.cameras?.main;
  if (cam) {
    const zoom = cam.zoom > 0 ? cam.zoom : 1;
    const hw = cam.width / (2 * zoom), hh = cam.height / (2 * zoom);
    const cx = cam.scrollX + cam.width / 2, cy = cam.scrollY + cam.height / 2;
    const corners = [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]]
      .map(([wx, wy]) => [(wx / (TW / 2) + wy / (TH / 2)) / 2 * sc, (wy / (TH / 2) - wx / (TW / 2)) / 2 * sc]);
    g.strokeStyle = '#ffcf6a'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < 4; i++) g.lineTo(corners[i][0], corners[i][1]);
    g.closePath(); g.stroke();
  }
}

// §23.18 따라가기 상태. 씬은 매 프레임 이 값을 읽는다.
let followSimId = null;
function setFollow(id) {
  followSimId = id;
  const b = $('followbtn');
  if (b) { b.classList.toggle('on', id !== null); b.textContent = id !== null ? '👁️ 따라가는 중' : '👁️ 따라가기'; }
}

// §23.18 사람 목록. 마을에 이백 명이 살면 화면에서 특정한 사람을 다시 찾기가 어렵다.
// 이야기를 따라가려면 **그 사람을 다시 찾을 수 있어야 한다.**
function renderPeople() {
  const q = ($('people-q').value ?? '').trim();
  const list = $('people-list');
  const sims = [...(world?.sims ?? [])];
  const match = (s) => {
    if (!q) return true;
    return `${s.surname ?? ''}${s.name}`.includes(q) || occKo(s.traits?.occupation, '').includes(q);
  };
  // 나이 많은 순이 아니라 **지금 무언가 하고 있는 사람**부터. 멍하니 선 사람은 뒤로.
  const rows = sims.filter(match).sort((a, b) => (a.id - b.id)).slice(0, 200);
  list.replaceChildren(...rows.map((s) => {
    const row = document.createElement('div');
    row.className = 'row';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = simName(s.id);
    const sub = document.createElement('span');
    sub.className = 'sub';
    const act = s.state?.kind === 'walking' ? `${actionKo(s.state.action)} 가는 중`
      : s.state?.kind === 'performing' ? `${actionKo(s.state.action)} 중` : '멍때리는 중';
    sub.textContent = `${s.traits?.age ?? '?'}세 · ${occKo(s.traits?.occupation)} · ${act}`;
    row.append(nm, sub);
    row.addEventListener('click', () => {
      selectSim(s.id);
      setFollow(s.id);
      $('people-modal').style.display = 'none';
    });
    return row;
  }));
  if (rows.length === 0) list.textContent = '찾는 사람이 없다';
}

let relFor = null;
let simTitle = null;
function applyTitle() {
  const el = $('simname');
  if (!el || !simTitle) return;
  const sim = world?.sims?.find((s) => s.id === selectedSimId);
  if (sim) el.textContent = `${sim.name} · ${simTitle}`;
}
async function renderRelations(simId) {
  const box = $('relations');
  if (!box) return;
  if (relFor === simId && box.dataset.done === '1') return; // 배치마다 서버를 찌르지 않는다
  relFor = simId; box.dataset.done = '0';
  box.textContent = '…';
  try {
    const d = await fetch(`/api/relations?sim=${simId}`).then((r) => r.json());
    if (relFor !== simId) return; // 그새 다른 사람을 골랐다
    const parts = [];
    if (d.partner) parts.push(`${d.partner.stage === 'married' ? '💍' : '💕'} ${d.partner.name}`);
    if (d.parents.length) parts.push(`👪 ${d.parents.map((x) => x.name).join('·')}`);
    if (d.children.length) parts.push(`🧒 ${d.children.map((x) => x.name).join('·')}`);
    if (d.friends.length) parts.push(`🤝 ${d.friends.map((x) => x.name).join('·')}`);
    if (d.rivals.length) parts.push(`💢 ${d.rivals.map((x) => x.name).join('·')}`);
    if (d.acquaintances) parts.push(`🙂 아는 사이 ${d.acquaintances}명`);
    box.textContent = parts.length ? parts.join(' · ') : '아직 가까운 사람이 없다';
    // §23.16 칭호는 이름 옆에 — 이 사람이 가장 자주 한 일이 곧 이 사람이다.
    // 이름표는 배치마다 다시 그려지므로(renderPanel) 여기서 DOM을 건드리면 한 번 쓰고
    // 지워진다. 값만 남겨 두고 붙이는 일은 renderPanel이 한다.
    simTitle = d.title ?? null;
    if (relFor === simId) applyTitle();
    // 최근 기억 — "요즘 무엇을 겪었나". 있으면 관계 아래 한 줄.
    if (d.memories?.length) {
      box.textContent += `\n📌 ${d.memories.map((m) => m.who ? `${m.text} (${m.who})` : m.text).join(' · ')}`;
    }
    box.dataset.done = '1';
  } catch { box.textContent = ''; }
}

let lifeOpenFor = null;
async function renderLifeLog(simId) {
  const box = $('lifelog');
  box.style.display = 'block';
  box.textContent = '불러오는 중…';
  try {
    const d = await fetch(`/api/chronicle?sim=${simId}`).then((r) => r.json());
    const rows = (d.rows ?? []).map((r) => ({ r, text: lifeLine(r, d) })).filter((x) => x.text);
    if (rows.length === 0) {
      box.innerHTML = '<div class="ln">아직 남길 만한 일이 없었다.</div>';
      return;
    }
    // 나이로 묶는다. 지금 나이에서 지난 햇수를 빼면 그때 몇 살이었는지가 나온다.
    let html = ''; let lastAge = null;
    for (const { r, text } of rows) {
      const yearsAgo = Math.floor((d.nowTick - r.tick) / TICKS_PER_YEAR);
      const age = d.age != null ? Math.max(0, d.age - yearsAgo) : null;
      const head = age != null ? `${age}살` : `${Math.floor(r.tick / 1440)}일`;
      if (head !== lastAge) { html += `<div class="yr">${head}</div>`; lastAge = head; }
      html += `<div class="ln">${text}</div>`;
    }
    box.innerHTML = html;
  } catch (e) {
    box.innerHTML = '<div class="ln">일대기를 못 읽었다.</div>';
  }
}

function selectSim(id) {
  selectedSimId = id;
  lifeOpenFor = null;
  relFor = null;
  simTitle = null;
  dayLog = { simId: id, day: -1, acts: {}, money: 0, notes: [] };
  const dc = $('daycard'); if (dc) dc.style.display = 'none';
  const fb = $('followbtn');
  if (fb) fb.classList.toggle('on', followSimId === id);
  const box = $('lifelog'); if (box) box.style.display = 'none';
  renderPanel();
}

function renderPanel() {
  const panel = $('simpanel');
  if (selectedSimId === null || !world) { panel.style.display = 'none'; return; }
  const sim = world.sims.find((s) => s.id === selectedSimId);
  // §23.6 선택한 사람이 죽거나 이주하면 여기서 TypeError가 나면서 **그 배치의 나머지 처리가
  // 통째로 죽었다** (renderPanel은 매 배치 호출된다). 사람은 사라질 수 있다 — 화면이 먼저 안다.
  if (!sim) { $('simname').textContent = '(마을을 떠났습니다)'; return; }
  panel.style.display = 'block';
  $('simname').textContent = sim.name;
  applyTitle(); // §23.16 칭호는 이름과 함께 다시 붙는다
  $('portrait').src = `./sprites/walk${archOf(sim)}_0.png`; // 도트 초상화 — 직업 제복 반영 (§17.14)
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
    if (sim.education?.stage) extra += ` · ${PLACE_KO[sim.education.stage]}`;
    if (sim.needsTier) extra += ` · ${sim.needsTier.level === 1 ? '시민' : '정착민'}`;
    if (sim.education?.universityGraduated) extra += ' · 🎓대졸';
    if (sim.education?.course) extra += ` · ${{university:'학부',masters:'석사',doctorate:'박사'}[sim.education.course]} ${sim.education.universityEnrolled?'재학':'등록 보류'}`;
    if (sim.education?.highestDegree && sim.education.highestDegree !== 'bachelor') extra += ` · 🎓${{masters:'석사',doctorate:'박사'}[sim.education.highestDegree]}`;
    $('traits').textContent = `${mbti} · ${tr.age}세 · ${g} · ${occKo(tr.occupation)}${sim.isPlayer ? ' · ◆나' : ''}${sim.isGenius ? ' · ⭐천재' : ''}${extra}`;
  }
  renderRelations(sim.id); // §23.15 관계 (열려 있는 동안 사람이 바뀔 때만 다시 읽는다)
  $('money').textContent = `💰 ${sim.money}원`;
  $('abilities').replaceChildren(...Object.entries({stamina:'체력',dexterity:'손재주',intellect:'지능',charisma:'사교성'})
    .map(([key, label]) => {
      const entry = document.createElement('span');
      entry.textContent = `${label} ${sim.abilities?.[key] ?? '—'} / ${sim.potential?.[key] ?? '—'}`;
      return entry;
    }));
  $('action').textContent = `현재: ${actionKo(sim.state.action, '대기')} ${sim.state.kind === 'walking' ? '(이동 중)' : ''}`;
}

// §23.19 피드 필터 배선. 필터를 바꾸면 쌓인 줄을 지운다 — 섞여 있으면 무엇을 보고
// 있는지 알 수 없다. 다음 배치부터 새 기준으로 채워진다.
for (const b of document.querySelectorAll('#feed-filter button')) {
  b.addEventListener('click', () => {
    feedFilter = b.dataset.f;
    for (const o of document.querySelectorAll('#feed-filter button')) o.classList.toggle('on', o === b);
    $('feed').replaceChildren();
  });
}

// §23.23 목표 배선
$('goals-btn').addEventListener('click', () => { $('goals-modal').style.display = 'flex'; renderGoals(); });
$('goals-close').addEventListener('click', () => { $('goals-modal').style.display = 'none'; });

// §23.21 미니맵 클릭 = 그 자리로 간다. 따라가는 중이었다면 손이 이겼으니 따라가기는 끈다.
$('minimap').addEventListener('click', (ev) => {
  if (!world || !scene) return;
  const r = ev.currentTarget.getBoundingClientRect();
  const sc = MINI_SIZE / world.map.w;
  const tx = (ev.clientX - r.left) * (MINI_SIZE / r.width) / sc;
  const ty = (ev.clientY - r.top) * (MINI_SIZE / r.height) / sc;
  setFollow(null);
  scene.cameras.main.centerOn(isoX(tx, ty), isoY(tx, ty));
  drawMinimap();
});

// §23.18 사람 목록·따라가기 배선
$('people-btn').addEventListener('click', () => { $('people-modal').style.display = 'flex'; renderPeople(); });
$('people-close').addEventListener('click', () => { $('people-modal').style.display = 'none'; });
$('people-q').addEventListener('input', renderPeople);
$('followbtn').addEventListener('click', () => {
  if (selectedSimId === null) return;
  setFollow(followSimId === selectedSimId ? null : selectedSimId);
});

// §23.1 일대기 토글. 열려 있을 때만 다시 읽는다 — 배치마다 서버를 찌르지 않는다.
$('lifebtn').addEventListener('click', () => {
  if (selectedSimId === null) return;
  const box = $('lifelog');
  if (lifeOpenFor === selectedSimId) { box.style.display = 'none'; lifeOpenFor = null; return; }
  lifeOpenFor = selectedSimId;
  renderLifeLog(selectedSimId);
});

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
  // §22.17 고르는 것은 이름·성별·MBTI **셋뿐**이다. 나이와 직업은 세계가 정한다 —
  // 나이는 시드에서, 직업은 능력치 적성에서. 서버가 결정하므로 여기서 보내지 않는다.
  const name = $('ob-name').value.trim();
  const type = $('ob-mbti').value;
  const axisVal = (letter, first) => (letter === first ? 25 : 75); // 글자 → 축 값 (완만한 극단)
  const payload = {
    name,
    nameMode: 'full',
    gender: $('ob-gender').value,
    mbti: { EI: axisVal(type[0], 'E'), SN: axisVal(type[1], 'S'), TF: axisVal(type[2], 'T'), JP: axisVal(type[3], 'J') },
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

// §22.102 요약은 **세션에 한 번**만 띄운다 (사용자 지적: "48배속으로 돌리다보면 게임이
// 잠깐 멈췄다가 요약으로 보여주는데 문제가 있는 것 같다"). 고배속에서는 리싱크 스냅샷이
// 주기적으로 오는데, 스냅샷 처리에서 showReport를 부르고 있었다 — 그래서 플레이 도중
// "부재중 리포트"가 반복해서 튀어나왔다. 부재중 요약은 **돌아왔을 때 한 번** 보는 것이다.
let reportShown = false;
let lastWorldKey = null; // §22.102 전면 재빌드가 필요한지 판단하는 지도 서명
async function showReport() {
  if (reportShown) return;
  reportShown = true;
  const cursor = Number(lsGet('deepsims.lastSeenTick') || 0);
  const rep = await fetch(`/api/report?cursor=${cursor}`).then((r) => r.json());
  lsSet('deepsims.lastSeenTick', String(rep.nextCursor));
  if (rep.toTick - rep.fromTick < 60) return; // 1게임시간 미만 공백은 생략
  // §22.24: 죽은 사람은 world.sims에 없다 — 서버가 died payload에서 모아준 이름으로 푼다
  const nameOf = (id) => (id === null || id === undefined) ? '누군가'
    : (world?.sims.some((x) => x.id === id) ? simName(id) : (rep.deadNames?.[id] ?? `심${id}`));
  const lines = []; // 문자열은 전부 textContent로 렌더 (이름 유래 XSS 방지)
  const hours = Math.floor((rep.toTick - rep.fromTick) / 60);
  lines.push(`당신이 없는 동안 게임 시간 ${Math.floor(hours / 24)}일 ${hours % 24}시간이 흘렀습니다.`);
  const count = (t) => rep.counts.find((c) => c.type === t)?.n ?? 0;
  // ◆ 연대기 — 굵직한 사건을 시간순 이야기로 (이슈 #90, DF 레전드 방식).
  // 예전 리포트는 74줄 중 61줄이 심별 식사 횟수였고 highlights 50칸 중 48칸을
  // lonely가 먹었다 (§22.11 지적 5) — 이제 고빈도 지표는 아래 ◇ 집계 한 줄로 접힌다.
  if (rep.chronicle?.length) {
    lines.push('◆ 그동안 마을에서는');
    const shown = {};
    for (const h of rep.chronicle) {
      shown[h.type] = (shown[h.type] ?? 0) + 1;
      const t = chronicleText({ ...h, simId: h.sim_id }, nameOf);
      if (t) lines.push(`· ${fmtClock(h.tick)} ${t}`);
    }
    // 종류별 상한으로 접힌 것 — 수치는 숨기지 않는다 (§0.1)
    const folded = rep.counts
      .filter((c) => CHRON_KO[c.type] && c.n > (shown[c.type] ?? 0))
      .map((c) => `${CHRON_KO[c.type]} +${c.n - (shown[c.type] ?? 0)}`);
    if (folded.length) lines.push(`(지면상 접힌 사건: ${folded.join(' · ')})`);
  } else {
    lines.push('큰 사건 없이 잔잔하게 흘러간 시간이었습니다.');
  }
  // 인물 한 줄 — 이 공백 기간의 살림 승자와 곤경
  const te = rep.totals?.topEarner, ts = rep.totals?.topSpender;
  if (te && te.delta > 0) lines.push(`💰 벌이가 가장 좋았던 사람: ${nameOf(te.simId)} (+${te.delta}원)`);
  if (ts && ts.delta < 0 && ts.simId !== te?.simId) lines.push(`🕳️ 주머니가 가장 가벼워진 사람: ${nameOf(ts.simId)} (${ts.delta}원)`);
  // ◇ 요약 통계 — 하단 한 줄. 식사·근무는 심별 나열 대신 총계다.
  const md = rep.totals?.moneyDelta ?? 0;
  // §22.102 사용자가 요청한 식사 횟수 미표시를 연대기 통합에서도 유지한다.
  lines.push(`◇ 집계: 행동 ${count('action_completed')} · 근무 ${rep.totals?.works ?? 0}`
    + ` · 말다툼 ${count('argument')} · 외로움 ${count('lonely')} · 굶주림 ${count('starving')}`
    + ` · 주민 잔액 ${md > 0 ? '+' : ''}${md}원`);
  if (rep.prunedAggregates?.length) {
    // 30일 넘게 비우면 원본 이벤트는 일 집계로 접혀 있다 — 날짜별 나열 대신 종류별로 뭉친다
    const byCat = new Map(); let total = 0; let dmin = Infinity, dmax = -Infinity;
    for (const a of rep.prunedAggregates) {
      const day = Math.floor(a.day_start_tick / 1440);
      dmin = Math.min(dmin, day); dmax = Math.max(dmax, day);
      total += a.count;
      if (CHRON_KO[a.category]) byCat.set(a.category, (byCat.get(a.category) ?? 0) + a.count);
    }
    const cats = [...byCat.entries()].sort((x, y) => (y[1] - x[1]) || (x[0] < y[0] ? -1 : 1))
      .map(([c, cnt]) => `${CHRON_KO[c]} ${cnt}`).join(' · ');
    lines.push(`◆ 더 오래된 나날 (Day ${dmin}~${dmax}, 일 집계)`);
    lines.push(`· ${cats || '굵직한 사건 없음'} — 그 밖의 것까지 사건 ${total}건`);
  }
  const rc = $('report');
  rc.replaceChildren(...lines.map((l) => {
    const div = document.createElement('div');
    div.textContent = l;
    if (l.startsWith('◆') || l.startsWith('◇')) div.style.fontWeight = 'bold';
    return div;
  }));
  $('modal').style.display = 'flex';
}

// ---- WebSocket ----
let wsRef = null;
const forcePausedStream = new URLSearchParams(location.search).get('stream') === 'paused'; // #143 진단 전용
// #143의 짝 — 창이 숨어 있어도 스트림을 받게 한다. 임베디드 브라우저처럼 패널 자체가
// 숨어 document.hidden이 늘 true인 환경에서 피드·필터를 실제로 검증하려면 필요하다.
// ?stream=forced 로만 켜진다 (진단 전용).
const forceLiveStream = new URLSearchParams(location.search).get('stream') === 'forced';
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  wsRef = ws;
  lastSeq = -1;

  // #143 숨은 탭에서는 서버 배치를 받지 않는다. 브라우저가 보이지 않는 동안 전체
  // sims JSON을 계속 파싱해 버리던 할당 폭주를 막고, 복귀 시 서버의 최신 snapshot
  // 하나로 회복한다. 시뮬레이션 자체와 다른 뷰어의 스트림은 계속 진행한다.
  ws.onopen = () => ws.send(JSON.stringify({ type: 'visibility', simStatics:true, hidden: !forceLiveStream && (document.hidden || forcePausedStream) }));

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
      case 'speed': // §20
        if (window.__paintSpeed) window.__paintSpeed(msg.speed);
        break;
      case 'snapshot':
        world = msg.world;
        updatePolicySummary();
        // §23.39 스냅샷은 전체를 주므로 정적 지도를 여기서 새로 채운다.
        resetSimCache(simStatic,world.sims);
        if (msg.world?.speed && window.__paintSpeed) window.__paintSpeed(msg.world.speed);
        $('status').textContent = '● 라이브';
        $('clock').textContent = fmtClock(world.worldTick);
        applyDaylight(world.worldTick);
        {
          // §22.102 **스냅샷마다 지도를 통째로 다시 그려서 화면이 멈췄다.** 리싱크는 고배속에서
          // 주기적으로 오는데 그때마다 스프라이트 수천 개를 부수고 다시 만들었다.
          // 시설 수·타일 버전이 그대로면 다시 그릴 이유가 없다 — 심 위치는 tickBatch가 옮긴다.
          const key = `${world.map.facilities.length}:${world.map.tiles.length}:${world.terrainVersion ?? 0}`;
          if (scene && key !== lastWorldKey) {
            lastWorldKey = key;
            destroySimSprites();
            scene.drawWorld();
          }
        }
        showReport();
        maybeShowOnboarding();
        renderPanel();
        syncItems();
        syncFires(); // §17.20: 스냅샷·리싱크 시 진행 중 화재 복원/정리 (Codex 43차)
        updateBadge();
        sparkHist.length = 0; // 재접속 시 이전 세션 잔존 제거 (Codex 48차 P3)
        applyWeather();
        updateStats();
        window.__publishDiag?.(); // #143 ?diag=1 초기 snapshot 직후의 안정된 기준값
        break;
      case 'tickBatch': {
        if (!world) return;
        world.worldTick = msg.toTick;
        // §23.39 배치에는 변하는 것만 온다. 이름·특성·능력치·학력은 **달라진 사람 것만**
        // statics로 따라오므로, 기억해 둔 정적 부분과 합쳐 예전과 같은 모양을 만든다.
        // (스냅샷은 언제나 전체를 보내므로 이 지도는 접속 직후부터 채워져 있다.)
        world.sims = mergeSimBatch(simStatic,msg.sims,msg.statics);
        if (msg.treasury !== undefined) world.treasury = msg.treasury;
        if (msg.publicTreasury !== undefined) world.publicTreasury = msg.publicTreasury;
        if (msg.incidents !== undefined) { world.incidents = msg.incidents; syncFires(); }
        if (msg.projects !== undefined) world.projects = msg.projects; // §19.3
        if (msg.speed && window.__paintSpeed) window.__paintSpeed(msg.speed); // §20
        if (msg.cityTier !== undefined && world.cityTier !== msg.cityTier) { world.cityTier = msg.cityTier; updateBadge(); }
        if (msg.transit) world.transit = msg.transit; // §19.12 역 수요 관측·언락 (zone 모달 게이트)
        if(msg.rail){
          const old=new Map((world.rail?.links??[]).map(l=>[l.id,l]));
          world.rail={...world.rail,...msg.rail,links:msg.rail.links.map(l=>({...old.get(l.id),...l}))};
        }
        if (msg.unlockedIndustries) world.unlockedIndustries = msg.unlockedIndustries;
        if (msg.housingMarket) world.housingMarket = msg.housingMarket;
        if (msg.householdDaily) world.householdDaily = msg.householdDaily;
        if (msg.villages) world.villages = msg.villages;
        if (msg.policyDefaults) world.policyDefaults=msg.policyDefaults;
        updatePolicySummary();
        if (msg.plannedCenterCost !== undefined) world.plannedCenterCost = msg.plannedCenterCost;
        if (msg.zoneCosts !== undefined) world.zoneCosts = msg.zoneCosts;
        for (const e of msg.events ?? []) {
          if(e.type==='household_migration_gathering'){
            const home=world.map.facilities.find(f=>f.id===e.payload.targetHomeId);
            if(home)home.migrationIntentId=e.payload.intentId;
          }
          if(['household_intent_applied','household_intent_failed'].includes(e.type)){
            for(const home of world.map.facilities)if(home.migrationIntentId===e.payload.intentId)delete home.migrationIntentId;
          }
          if (e.type === 'plot_relocated') {
            const p = world.plots?.find(p => p.plotId === e.payload.plotId);
            if (p) { p.x=e.payload.x; p.y=e.payload.y; }
          }
          if (e.type === 'village_land_assigned') {
            const ids = new Set(e.payload.plotIds);
            for (const p of world.plots ?? []) if (ids.has(p.plotId)) p.villageId=e.payload.villageId;
          }
          if(e.type==='village_founded'){
            for(const f of world.map.facilities)if(e.payload.homeIds.includes(f.id)){
              f.villageId=e.payload.id;delete f.foundingPetitionId;
            }
          }
          if (e.type === 'center_planned') {
            world.centers ??= [];
            if (!world.centers.some((c) => c.centerId === e.payload.centerId)) world.centers.push(e.payload);
          }
        }
        if (msg.statsToday) { // §18.T5 증분 upsert (54차: 동일 day는 교체)
          world.statsHistory ??= [];
          const last = world.statsHistory[world.statsHistory.length - 1];
          if (last && last.day === msg.statsToday.day) world.statsHistory[world.statsHistory.length - 1] = msg.statsToday;
          else { world.statsHistory.push(msg.statsToday); while (world.statsHistory.length > 180) world.statsHistory.shift(); }
        }
        // §18.T1: 정책 변경 이벤트로 클라 상태 동기화 — 슬라이더가 낡은 값을 재전송하지 않도록 (Codex 46차)
        for (const e of msg.events) {
          if (e.type === 'policy_changed') {
            const villageId=e.payload.villageId;
            if(!villageId||villageId==='village:0')world.policy = { ...(world.policy ?? {}), ...e.payload.changes };
          }
        }
        $('clock').textContent = fmtClock(world.worldTick);
        applyDaylight(world.worldTick);
        {
          // §22.101 **고배속에서 할당이 GC를 앞지른다.** ×1에서는 힙이 평평한데(0.2MB/분)
          // ×48에서는 분당 60MB 넘게 오른다 — 배치당 이벤트가 수백 개라 피드 DOM과
          // 말풍선 객체가 쏟아진다. 탭이 숨으면 GC가 뒤로 밀려 그대로 쌓인다.
          //
          // 화면은 어차피 80줄만 보여준다. **한 배치에서 피드에 그리는 줄을 뒤에서 80개로
          // 자르고**, 숨은 탭에서는 연출(말풍선·이모트)을 건너뛴다 — 안 보이는 것에
          // 메모리를 쓰지 않는다. 상태 갱신은 그대로다.
          //
          // §23.19 **자르기는 거르기 다음에 온다.** 예전에는 배치의 마지막 80개만 피드에
          // 넘겼는데, ×48에서는 한 배치가 수백 건이고 그중 생애 사건은 1%뿐이라
          // (실측 4,305건 중 relationship_changed 42건) 필터를 켜면 화면이 **텅 비었다**.
          // 먼저 거르고 나서 마지막 80개를 그린다 — DOM 상한은 그대로고, 희귀한 사건은
          // 더 이상 흔한 사건에 밀려 잘리지 않는다.
          const evs = msg.events;
          const shown = [];
          for (let i = 0; i < evs.length; i++) {
            if (feedPasses(evs[i])) shown.push(evs[i]);
            noteForDay(evs[i]); // §23.22 고른 사람의 하루를 모은다 (필터와 무관하게)
            if (!document.hidden) handleVisualEvent(evs[i]);
          }
          for (let i = Math.max(0, shown.length - 80); i < shown.length; i++) pushFeed(shown[i]);
          checkGoals(); // §23.27 목표 달성은 배치 끝에서 한 번만 본다
        }
        // §15.1.B: 세계 변형 이벤트를 클라이언트 맵에 반영
        let mapDirty = false;
        for (const e of msg.events) {
          if ((e.type === 'road_formed' || e.type === 'sidewalk_formed') && world) {
            world.map.tiles[e.payload.y * world.map.w + e.payload.x] = e.type === 'sidewalk_formed' ? 12 : 1;
            mapDirty = true;
          } else if ((e.type === 'public_works' || e.type === 'zoned') && world) {
            // §22.26 정부 포장 — road_formed와 같은 증분 갱신. 이 분기가 없으면 클라는
            // 다음 전체 resync(15초+)까지 포장을 모른 채 잔디를 그린다.
            if (e.payload.tileChanges) {
              for (const c of e.payload.tileChanges) world.map.tiles[c.index] = c.tile;
            } else for (const idx of (e.payload.tiles ?? [])) world.map.tiles[idx] = 1;
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
          } else if (e.type === 'facility_built' || e.type === 'project_started' || e.type === 'rail_opened') {
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
        updateStats(); // #104: 인구·국고는 매 배치 바뀐다 — 스냅샷만 기다리면 화면이 멈춘 듯 보인다
        lsSet('deepsims.lastSeenTick', String(world.worldTick));
        break;
      }
    }
  };
  ws.onclose = () => {
    $('status').textContent = '연결 끊김 — 재접속 중…';
    setTimeout(connect, 2000);
  };
}
connect();

document.addEventListener('visibilitychange', () => {
  if (wsRef?.readyState === WebSocket.OPEN) {
    wsRef.send(JSON.stringify({ type: 'visibility', hidden: !forceLiveStream && (document.hidden || forcePausedStream) }));
  }
});

// ---- §18.T1 시정 운영 패널 ----
(() => {
  const modal = document.getElementById('policy-modal');
  const btn = document.getElementById('policy-btn');
  if (!btn) return;
  const villageSelect=document.getElementById('pol-village');
  const applyButton=document.getElementById('pol-apply');
  const info=document.getElementById('pol-village-info');
  let submitting=false;
  const els = {
    taxPct: [document.getElementById('pol-tax'), document.getElementById('pol-tax-v'), '%'],
    welfareAmount: [document.getElementById('pol-amt'), document.getElementById('pol-amt-v'), '원'],
    welfareThreshold: [document.getElementById('pol-thr'), document.getElementById('pol-thr-v'), '원'],
    healthCopayPct: [document.getElementById('pol-health'), document.getElementById('pol-health-v'), '%'],
    childAllowance: [document.getElementById('pol-child'), document.getElementById('pol-child-v'), '원'],
  };
  const DEFAULTS = { taxPct: 15, welfareAmount: 200, welfareThreshold: 300, healthCopayPct: 100, childAllowance: 0 };
  const context=()=>{
    const village=world?.villages?.find(v=>v.id===villageSelect.value);
    return village?{village,government:village.id==='village:0'?world:village.government}:null;
  };
  updatePolicySummary=()=>{
    if(modal.style.display!=='flex')return;
    const selected=context();
    applyButton.disabled=submitting||!selected?.government;
    info.textContent=selected?.government?`${selected.village.name} · 국고 ${selected.government.treasury}원`:'대상 마을을 확인할 수 없습니다.';
  };
  const fillInputs=()=>{
    const selected=context();
    applyButton.disabled=submitting||!selected?.government;
    for (const [k, [input, label, unit]] of Object.entries(els)) {
      input.value=selected?.government?.policy?.[k]??world?.policyDefaults?.[k]??DEFAULTS[k];
      label.textContent=input.value+unit;
    }
    document.getElementById('pol-msg').textContent='';
    updatePolicySummary();
  };
  for (const [k, [input, label, unit]] of Object.entries(els)) {
    input.addEventListener('input', () => { label.textContent = input.value + unit; });
  }
  btn.addEventListener('click', () => {
    if(!world)return;
    const previous=villageSelect.value;
    villageSelect.replaceChildren();
    for(const village of world.villages??[]){
      const option=document.createElement('option');option.value=village.id;option.textContent=village.name;
      villageSelect.append(option);
    }
    villageSelect.value=world.villages.some(v=>v.id===previous)?previous:'village:0';
    modal.style.display = 'flex';
    fillInputs();
  });
  villageSelect.addEventListener('change',fillInputs);
  document.getElementById('pol-close').addEventListener('click', () => { modal.style.display = 'none'; });
  applyButton.addEventListener('click', async () => {
    const selected=context();if(submitting||!selected?.government)return;
    const payload = {villageId:selected.village.id};
    for (const [k, [input]] of Object.entries(els)) payload[k] = parseInt(input.value, 10);
    submitting=true;applyButton.disabled=true;villageSelect.disabled=true;
    try{
      const res = await fetch('/api/input', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientInputId: `policy:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, command: 'policy', payload }),
      });
      const j = await res.json();
      document.getElementById('pol-msg').textContent = res.ok ? `${selected.village.name} 정책 입력이 저장됐습니다. 다음 틱부터 적용됩니다.` : `거부: ${j.error}`;
      if (res.ok) setTimeout(() => { modal.style.display = 'none'; }, 900);
    }catch{
      document.getElementById('pol-msg').textContent='응답을 받지 못했습니다. 연결 후 적용 여부를 확인해 주세요.';
    }finally{submitting=false;applyButton.disabled=!context()?.government;villageSelect.disabled=false;}
  });
})();

// ---- 상단 미니 추이 그래프: 인구(초록)·국고(금색) — 클라 로컬 링버퍼 (§18.T5 예고편) ----
const sparkHist = [];
function pushSpark() {
  if (!world) return;
  sparkHist.push({ pop: world.sims.length, tre: world.treasury ?? 0 });
  if (sparkHist.length > 120) sparkHist.shift();
  const cv = document.getElementById('spark');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const draw = (key, color) => {
    const values = sparkHist.map((p) => p[key]);
    const min = Math.min(0, ...values);
    const max = Math.max(1, ...values);
    const span = Math.max(1, max - min);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
    sparkHist.forEach((p, i) => {
      const x = (i / Math.max(1, sparkHist.length - 1)) * (cv.width - 4) + 2;
      const y = cv.height - 3 - ((p[key] - min) / span) * (cv.height - 8);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (min < 0 && max > 0) {
      const zeroY = cv.height - 3 - ((0 - min) / span) * (cv.height - 8);
      ctx.strokeStyle = '#6b5638'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(0, zeroY); ctx.lineTo(cv.width, zeroY); ctx.stroke();
    }
  };
  draw('tre', '#c9a86a');
  draw('pop', '#8fd48a');
}
setInterval(pushSpark, 5000);
// ---- §18.T2 건설 지정 모달 ----
(() => {
  const modal = document.getElementById('zone-modal');
  if (!modal) return;
  let cur = null; let dir = 0; let type = 'house';
  const COST = { house: 2000, cafe: 3000, office: 3000, park: 1000, apartment: 6000, factory: 8000, mall: 8000, university: 10000, primary_school:4000,middle_school:5000,high_school:6000, workshop:6000,lab:9000,warehouse:8000,train_station:8000 };
  const TIER_NEED = { apartment: 1, factory: 2, mall: 2, university: 3 };
  // §19.12 기차역은 인구 등급이 아니라 **이동 수요**가 언락한다 (world.transit, 이슈 #52).
  // A reachable pair of completed stations enables the fare-free public shuttle.
  const stationLocked = () => !(world?.transit?.stationUnlocked);
  const jurisdiction = () => {
    const id=cur?.villageId??'village:0';
    const village=world?.villages?.find(v=>v.id===id);
    return {id,name:village?.name??id,government:id==='village:0'?world:village?.government};
  };
  const render = () => {
    const local=jurisdiction();
    const isStation = type === 'train_station';
    const need = TIER_NEED[type] ?? 0;
    const industryLocked = ['workshop','lab','warehouse'].includes(type) && !world?.unlockedIndustries?.includes(type);
    const locked = !local.government || (local.government.cityTier ?? 0) < need || industryLocked || (isStation && stationLocked());
    const cost = world?.zoneCosts?.[type] ?? COST[type];
    const pct = world?.transit?.fulfillmentPct ?? 0;
    const info = isStation
      ? `공터 ${cur.plotId} · ${type} · ` + (stationLocked()
        ? `🔒 이동 수요 ${pct}% — 100%에 언락`
        : `🚉 언락됨 (수요 ${pct}%) · 방향 ${['↙','↘','↗','↖'][dir]} · 비용 ${cost}원 · 연결 가능한 역 2곳부터 무료 셔틀 운행`)
      : `공터 ${cur.plotId} · ${type} · 방향 ${['↙','↘','↗','↖'][dir]} · 비용 ${cost}원` + (locked ? ` · 🔒${industryLocked?'산업 수요 필요':`${['','읍','시','대도시'][need]} 필요`}` : '');
    document.getElementById('zone-info').textContent = `${local.name} · 국고 ${local.government?.treasury??'?'}원 · ${info}`;
    for (const b of modal.querySelectorAll('[data-zt]')) {
      const zt = b.dataset.zt;
      const dim = !local.government || (zt === 'train_station' ? stationLocked() : (local.government.cityTier ?? 0) < (TIER_NEED[zt] ?? 0) || (['workshop','lab','warehouse'].includes(zt)&&!world?.unlockedIndustries?.includes(zt)));
      b.style.opacity = dim ? 0.4 : 1;
      b.style.borderColor = zt === type ? '#ffcf6a' : '#6b5638';
    }
    const go = document.getElementById('zone-go');
    const center = document.getElementById('zone-center');
    const planned = world?.centers?.some((c) => c.x === cur.x && c.y === cur.y && (c.villageId??'village:0')===local.id);
    center.textContent = planned ? '이미 지정된 계획 중심지' : `이 공터를 계획 중심지로 지정 (−${world?.plannedCenterCost ?? 5000}원)`;
    center.disabled = !!planned || !local.government;
    go.disabled = locked;
    go.style.opacity = go.disabled ? 0.4 : 1;
  };
  const plotsAvailable = () => (world?.plots ?? []).filter((p) => !p.used && p.foundingPetitionId==null
    && !world.projects?.some((pr) => pr.plotId === p.plotId)
    && !world.zoneOrders?.some((pr) => pr.plotId === p.plotId));
  window.openZoneModal = (plot) => {
    cur = plot; dir = 0; type = 'house';
    const select = document.getElementById('zone-plot');
    select.replaceChildren();
    for (const p of plotsAvailable()) {
      const option = document.createElement('option');
      const name=world.villages?.find(v=>v.id===(p.villageId??'village:0'))?.name??(p.villageId??'village:0');
      option.value = String(p.plotId); option.textContent = `${name} · 공터 ${p.plotId} (${p.x}, ${p.y})`;
      select.appendChild(option);
    }
    select.value = String(plot.plotId);
    document.getElementById('zone-msg').textContent = '';
    modal.style.display = 'flex'; render();
  };
  document.getElementById('zone-plot').addEventListener('change', (e) => {
    const plot = world?.plots.find((p) => p.plotId === Number(e.target.value));
    if (plot) { cur = plot; document.getElementById('zone-msg').textContent = ''; render(); }
  });
  document.getElementById('planning-btn').addEventListener('click', () => {
    const plot = plotsAvailable()[0];
    if (plot) window.openZoneModal(plot);
  });
  for (const b of modal.querySelectorAll('[data-zt]')) b.addEventListener('click', () => { type = b.dataset.zt; render(); });
  document.getElementById('zone-rot').addEventListener('click', () => { dir = (dir + 1) % 4; render(); });
  document.getElementById('zone-close').addEventListener('click', () => { modal.style.display = 'none'; });
  document.getElementById('zone-center').addEventListener('click', async () => {
    if(document.getElementById('zone-center').disabled)return;
    const msg = document.getElementById('zone-msg');
    try {
      const res = await fetch('/api/input', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientInputId: `center:${crypto.randomUUID()}`, command: 'plan_center', payload: { x: cur.x, y: cur.y, villageId:jurisdiction().id } }),
      });
      const j = await res.json();
      msg.textContent = res.ok ? '지정 요청을 보냈습니다. 적용 결과는 사건 기록에 표시됩니다.' : `거부: ${j.error}`;
    } catch { msg.textContent = '요청을 보내지 못했습니다. 연결을 확인하세요.'; }
  });
  document.getElementById('zone-go').addEventListener('click', async () => {
    if(document.getElementById('zone-go').disabled)return;
    const res = await fetch('/api/input', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientInputId: `zone:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        command: 'zone', payload: { plotId: cur.plotId, type, dir } }),
    });
    const j = await res.json();
    document.getElementById('zone-msg').textContent = res.ok ? '지시했습니다. 심들이 착공합니다.' : `거부: ${j.error}`;
    if (res.ok) setTimeout(() => { modal.style.display = 'none'; }, 900);
  });
})();

// ---- §18.T5 시정 대시보드 ----
(() => {
  const modal = document.getElementById('dash-modal');
  const btn = document.getElementById('dash-btn');
  if (!btn) return;
  const SERIES = [
    ['pop', '#8fd48a', (v) => v + '명'],
    ['treasury', '#c9a86a', (v) => v.toLocaleString() + '원'],
    ['reputation', '#7ab5e8', (v) => v],
  ];
  function drawDash() {
    const hist = world?.statsHistory ?? [];
    const cv = document.getElementById('dash-canvas');
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (hist.length < 2) { ctx.fillStyle = '#9c8a6a'; ctx.font = '12px sans-serif'; ctx.fillText('데이터를 모으는 중… (하루 1점)', 20, 60); return; }
    ctx.strokeStyle = '#3a2e1d'; ctx.strokeRect(0.5, 0.5, cv.width - 1, cv.height - 1);
    for (const [key, color] of SERIES) {
      const values = hist.map((p) => p[key]);
      const min = Math.min(0, ...values);
      const max = Math.max(1, ...values);
      const span = Math.max(1, max - min);
      ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
      hist.forEach((p, i) => {
        const x = 6 + (i / (hist.length - 1)) * (cv.width - 12);
        const y = cv.height - 8 - ((p[key] - min) / span) * (cv.height - 20);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      if (key === 'treasury' && min < 0 && max > 0) {
        const zeroY = cv.height - 8 - ((0 - min) / span) * (cv.height - 20);
        ctx.strokeStyle = '#6b5638'; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(6, zeroY); ctx.lineTo(cv.width - 6, zeroY); ctx.stroke();
      }
    }
    const last = hist[hist.length - 1];
    const happiness = Math.round(((last.avgMood + 10000) / 200)); // mood -10000..10000 → 0..100%
    const emp = last.pop > 0 ? Math.round(last.employed * 100 / last.pop) : 0;
    // §22.103 **세계 상태를 한 화면에서 본다** (사용자 요청). 한 줄 카드로는 무엇이 막혀
    // 있는지 안 보인다. 화면이 이미 들고 있는 world에서 계산한다 — 서버 왕복 없음.
    // 고르는 기준: **막힌 곳이 보이는 수치**만 넣는다. 침대 여유는 인구 상한(#122),
    // 공공직 비율은 재정 적자의 원인(#113), 배고픔·외로움은 G5(고통이 보인다)다.
    const simsAll = world?.sims ?? [];
    // 스냅샷에는 logic이 오지 않는다(§22.8 투영은 화면이 쓰는 필드만 보낸다). 임금 재원
    // 구분은 sim/logic.js의 화이트리스트와 같은 값을 여기 둔다 — 바뀌면 QA-19가 직업
    // 커버리지에서 먼저 잡는다.
    const pubSet = new Set(['doctor', 'nurse', 'teacher', 'civil_servant', 'politician', 'police', 'firefighter']);
    const privSet = new Set(['barista', 'chef', 'clerk']);
    const beds = (world?.map?.facilities ?? [])
      .filter((f) => f.type === 'house' || f.type === 'apartment')
      .reduce((n, f) => n + (f.resources?.length ?? 0), 0);
    const workers = simsAll.filter((x) => !['child', 'retired', 'student', 'jobless'].includes(x.traits?.occupation));
    const pubN = workers.filter((x) => pubSet.has(x.traits?.occupation)).length;
    const privN = workers.filter((x) => privSet.has(x.traits?.occupation)).length;
    const low = (x, k) => (x.needs?.[k] ?? 9999) < 2000;
    const hungry = simsAll.filter((x) => low(x, 'hunger')).length;
    const lonely = simsAll.filter((x) => low(x, 'social')).length;
    const tired = simsAll.filter((x) => low(x, 'energy')).length;
    const sickN = simsAll.filter((x) => x.sick).length;
    const broke = simsAll.filter((x) => (x.money ?? 0) < 300).length;
    const avgMoney = simsAll.length ? Math.round(simsAll.reduce((n, x) => n + (x.money ?? 0), 0) / simsAll.length) : 0;
    const facByType = {};
    for (const f of world?.map?.facilities ?? []) facByType[f.type] = (facByType[f.type] ?? 0) + 1;
    let road = 0; let side = 0;
    for (const t of world?.map?.tiles ?? []) { if (t === 1) road++; else if (t === 12) side++; }
    const h7 = hist.slice(-8);
    const slope = h7.length >= 2 ? Math.round((h7[h7.length - 1].treasury - h7[0].treasury) / (h7.length - 1)) : 0;
    const pct = (n) => (simsAll.length ? Math.round(n * 100 / simsAll.length) : 0);
    const couples = Math.floor(Object.keys(world?.partners ?? {}).length / 2);

    const rows = [
      ['사람', `👥 ${last.pop}명 · 😊 행복 ${happiness}% · 💼 고용 ${emp}% · 💑 커플 ${couples}쌍`],
      ['주거', `🛏️ 침대 ${beds}개 · 여유 ${beds - last.pop}개${beds - last.pop <= 0 ? '  ⚠️ 이민이 막힌다' : ''}`],
      ['일자리', `🏛️ 공공 ${pubN} · 🏪 민간서비스 ${privN} · 그 밖 ${workers.length - pubN - privN}` + (workers.length ? ` (공공 ${Math.round(pubN * 100 / workers.length)}%)` : '')],
      ['살림', `🏛️ ${last.treasury.toLocaleString()}원 · 하루 ${slope >= 0 ? '+' : ''}${slope.toLocaleString()}원 · 평균 소지금 ${avgMoney.toLocaleString()}원`],
      ['고통', `🍚 배고픔 ${hungry}(${pct(hungry)}%) · 😔 외로움 ${lonely} · 😴 피로 ${tired} · 🤒 아픔 ${sickN} · 💸 빈곤 ${broke}`],
      ['도시', `🏗️ 시설 ${(world?.map?.facilities ?? []).length}곳 · 🛣️ 도로 ${road} · 🚶 인도 ${side} · ⭐ 평판 ${last.reputation}`],
      ['구성', Object.entries(facByType).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k === 'house' ? '집' : k === 'apartment' ? '아파트' : (PLACE_KO[k] ?? k)} ${v}`).join(' · ')],
    ];
    const box = document.getElementById('dash-cards');
    box.replaceChildren(...rows.map(([label, text]) => {
      const d = document.createElement('div');
      d.style.cssText = 'display:flex;gap:8px;margin:3px 0;line-height:1.5';
      const lb = document.createElement('span');
      lb.textContent = label;
      lb.style.cssText = 'color:#8f88a0;min-width:52px;flex:0 0 auto';
      const vv = document.createElement('span');
      vv.textContent = text;
      d.append(lb, vv);
      return d;
    }));
  }
  btn.addEventListener('click', () => { modal.style.display = 'flex'; drawDash(); renderCityChronicle(); });
  document.getElementById('dash-close').addEventListener('click', () => { modal.style.display = 'none'; });
})();

// ---- §20 시뮬레이션 배속 (x1/x2/x3) ----
// 틱 내용은 바뀌지 않는다 — 같은 시뮬레이션이 더 빨리 흐를 뿐이다(결정성 무관).
(() => {
  const btns = [...document.querySelectorAll('.spd')];
  if (btns.length === 0) return;
  function paint(speed) {
    for (const b of btns) {
      const on = Number(b.dataset.s) === speed;
      b.style.background = on ? '#ffcf6a' : '#3a2e1d';
      b.style.color = on ? '#171310' : '#ead9b0';
      b.style.borderColor = on ? '#ffcf6a' : '#6b5638';
      b.style.fontWeight = on ? 'bold' : 'normal';
    }
  }
  window.__paintSpeed = paint;
  paint(1);
  for (const b of btns) {
    b.addEventListener('click', async () => {
      const s = Number(b.dataset.s);
      paint(s); // 낙관적 반영 — 서버 확인은 WS 'speed'로 온다
      try {
        const res = await fetch('/api/speed', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ speed: s }),
        });
        const j = await res.json();
        if (j.speed) paint(j.speed);
      } catch { /* 네트워크 실패 시 다음 스냅샷이 바로잡는다 */ }
    });
  }
})();
