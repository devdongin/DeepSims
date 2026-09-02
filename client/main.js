// DeepSims 클라이언트 — Phaser 아이소메트릭 렌더 + WS 동기화 (PLAN §6).
// 이벤트 문장화는 클라이언트 몫 (구조화 payload → 한국어).
import Phaser from 'phaser';

const TW = 32, TH = 16; // 아이소 타일 (2:1)
const TILE_COLORS = { 0: 0x4a6b3a, 1: 0x6b6154, 2: 0x8a7a5c, 3: 0x5c4a3a, 4: 0x2f4a28, 5: 0x2a3d5c,
  6: 0x3a6b9a, 7: 0x7a6b4a, 8: 0xd4c48a, 9: 0x6b6b72, 10: 0x5a7a4a, 11: 0x8a6a4a }; // §19 R-A
const FACILITY_COLORS = { house: 0xc4694a, office: 0x7a8ba8, cafe: 0x4aa87a, park: 0x3a8a4a, bar: 0x8a5aa8, library: 0x5a7aa8, market: 0xa89a4a, pond: 0x4a8aa8, hospital: 0xd47a7a, city_hall: 0x8aa8d4, school: 0xd4b45a, restaurant: 0xd4885a, gym: 0x5ad4a8, cinema: 0x6a5ad4, police_station: 0x4a5ad4, fire_station: 0xd44a3a, apartment: 0xb08a5a, factory: 0x8a8a92, mall: 0xd49ad4, university: 0x5ab0d4 };
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
// §17.14 걷기 시트 (Codex imagegen → tools/slice-sheet.js): 원형 N종 × 4프레임.
// 존재하는 것만 로드 — 아직 생성 안 된 원형은 정적 sim 이미지로 폴백.
const WALK_ARCHETYPES = 14; // §22.5: 10 child · 11 chef · 12 clerk · 13 worker 추가
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
const SIT_ACTIONS = ['eat', 'read', 'work', 'drink', 'cook_eat', 'see_doctor', 'binge_eat'];
// 직업 → 스프라이트 원형 (제복 정합): 경찰은 경찰복, 의사·간호사는 가운, 소방관은 소방복
const ARCH_OF_OCCUPATION = {
  police: 7, firefighter: 8, doctor: 5, nurse: 5, teacher: 6, student: 3,
  retired: 4, barista: 2, office_worker: 1, civil_servant: 1, politician: 1, fisher: 9,
  // §22.5 새 직군 — 매핑이 없으면 id%10으로 떨어져 **아이가 어른 모습으로** 보였다.
  child: 10, chef: 11, clerk: 12, worker: 13,
};
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

function archOf(sim) {
  if (sim.isPlayer) return 'p';
  const m = ARCH_OF_OCCUPATION[sim.traits?.occupation];
  return m !== undefined ? m : sim.id % 10;
}
// §17.14 건물 스프라이트 (Codex imagegen — 존재하는 것만 로드, 없으면 타일 폴백)
const BLD_TYPES = ['apartment', 'factory', 'mall', 'university', 'house_a', 'house_b', 'house_c', 'cafe', 'office', 'hospital', 'city_hall', 'school',
  'restaurant', 'gym', 'cinema', 'bar', 'library', 'market', 'police', 'fire'];
const BLD_KEYS = BLD_TYPES.map((t) => [`bld_${t}`, `./props/bld_${t}.png`]);
BLD_KEYS.push(['firework', './ui/fx_firework.png']); // §18.T4 승급 연출
for (const t of ['grass', 'pavement', 'road', 'river', 'river_bank', 'sand', 'mountain', 'hill', 'bridge', 'water_deep']) {
  BLD_KEYS.push([`tile_${t}`, `./props/tile_${t}.png`]); // 지형 (§UI, §19 R-A)
}
// §19 R-A: 타일 코드 → 텍스처 키 (스탬프 레이어가 사용)
const TILE_TEX = { 1: 'tile_road', 2: 'tile_pavement', 5: 'tile_water_deep', 6: 'tile_river',
  7: 'tile_river_bank', 8: 'tile_sand', 9: 'tile_mountain', 10: 'tile_hill', 11: 'tile_bridge' };
for (const t of ['house_a', 'cafe']) BLD_KEYS.push([`bld_${t}_night`, `./props/bld_${t}_night.png`]); // 야간 점등 변형
for (const t of ['house_a', 'cafe', 'office']) for (const d of [1, 2, 3]) {
  BLD_KEYS.push([`bld_${t}_d${d}`, `./props/bld_${t}_d${d}.png`]); // §18.T2 회전 외형
}
for (const t of ['apartment', 'factory', 'mall', 'university', 'house', 'cafe', 'office', 'hospital', 'city_hall', 'school', 'restaurant', 'gym',
  'cinema', 'bar', 'library', 'market', 'police', 'fire']) {
  BLD_KEYS.push([`bld_${t}_int`, `./props/bld_${t}_int.png`]); // §17.19 내부 컷어웨이
}
const BLD_OF_FACILITY = { apartment: 'bld_apartment', factory: 'bld_factory', mall: 'bld_mall', university: 'bld_university',
  cafe: 'bld_cafe', office: 'bld_office', hospital: 'bld_hospital',
  city_hall: 'bld_city_hall', school: 'bld_school', restaurant: 'bld_restaurant', gym: 'bld_gym',
  cinema: 'bld_cinema', bar: 'bld_bar', library: 'bld_library', market: 'bld_market',
  police_station: 'bld_police', fire_station: 'bld_fire' };
const PROP_KEYS = ['tree', 'bed', 'cafe_table', 'desk', 'bench', 'streetlamp', 'flowerbed', 'slide', 'fountain', 'bush', 'mailbox', 'cat', 'bar_counter', 'beer', 'dumbbell', 'bookshelf', 'market_stall', 'fishing_sign', 'coin', 'umbrella_stand', 'construction', 'plot_sign', 'hospital_cross', 'pill_bottle', 'ballot_box', 'flag_pole', 'wedding_arch', 'dog', 'school_desk', 'noticeboard', 'bus_stop', 'campaign_banner', 'restaurant_table', 'gym_rack', 'cinema_screen', 'popcorn', 'festival_lantern', 'police_car', 'fire_truck', 'ambulance', 'well', 'jangdok', 'laundry', 'bicycle', 'cart', 'flower_bed2', 'fence_wood', 'lamp_stone', 'street_tree_lit', 'bench2',
  // §22.10: 'car'·'smoke'는 렌더 코드(main.js 차량 아이콘·굴뚝 연기)와 에셋이 둘 다 있는데
  // 이 목록에만 빠져 있었다 — 텍스처 주입점이 여기뿐이라 exists()가 영원히 false였고,
  // 두 기능이 조용히 죽어 있었다. 차 구매(society.js)·이동속도 2배(tick.js)는 계속 돌고 있었다.
  'car', 'smoke']
  .map((p) => [p, `./props/${p}.png`]);

function loadImagesNative() {
  const entries = [...SPRITE_KEYS, ...WALK_KEYS, ...BLD_KEYS, ...PROP_KEYS];
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
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (map.tiles[y * map.w + x] === 4) put('tree', x, y, 42, 4);
    }
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
        const fenceRow = (fy) => {
          for (let fx = fac.x; fx + 1 < fac.x + fac.w; fx += 2) put('fence_wood', fx, fy, 24, -2);
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
      this.ensureTerrain();
      if (world) { simSprites.forEach((s) => s.destroy()); simSprites.clear(); this.drawWorld(); }
    });
    this.cameras.main.setBackgroundColor('#14121a');
    this.ensureTerrain();
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

  // §UI 지형(멱등): 잔디 합성 셀 + 월드 TileSprite — 네이티브 로드 완료 후에도 안전 (Codex 59차)
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
  }

  // §UI 도로·바닥 레이어(59차 ③ 재검토): 구시가 한정(0..132) 개별 스탬프 — 실측 1,419개.
  // RenderTexture·캔버스 베이크가 본 임베디드 CANVAS 환경에서 무출력이라(2회 검증) 실측상
  // 원활한 스탬프 방식을 채택, 영역 캡으로 오브젝트 수를 고정한다. 밖은 그래픽 폴백.
  bakeGround() {
    this.stamped = new Set(); // 타일 루프와 공유 — 셋에 없으면 그래픽 폴백 (60차)
    if (!world || !this.textures.exists('tile_road')) return;
    if (this.roadSprites) for (const r of this.roadSprites) r.destroy();
    this.roadSprites = [];
    const N = 132;
    const STAMP_MAX = 2500; // 명시적 오브젝트 상한 (60차) — 초과분은 그래픽 폴백
    const map = world.map;
    const lim = Math.min(N, map.w);
    const hasPave = this.textures.exists('tile_pavement');
    for (let y = 0; y < lim && this.roadSprites.length < STAMP_MAX; y++) {
      for (let x = 0; x < lim && this.roadSprites.length < STAMP_MAX; x++) {
        const t2 = map.tiles[y * map.w + x];
        const key = TILE_TEX[t2];
        if (!key || !this.textures.exists(key)) continue;
        const im = this.add.image(isoX(x, y), isoY(x, y), key).setDisplaySize(TW, TH).setDepth(-5);
        this.roadSprites.push(im);
        this.stamped.add(y * map.w + x);
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
    this.bakeGround(); // 스탬프 셋을 타일 루프 전에 확정 (60차)
    // 비-GRASS 타일만 개별 렌더
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y * map.w + x];
      if (t === 0) continue;
      if (t === 4 && hasTreeSprite) continue; // 나무는 스프라이트로
      if (this.stamped && this.stamped.has(y * map.w + x)) continue; // §UI 스탬프 레이어 담당 (60차: 셋 기반 — 캡·pavement 부재 자동 폴백)
      const lift = (t === 3 || t === 4) ? 10 : 0; // 벽·나무는 살짝 올림
      this.drawTile(g, x, y, TILE_COLORS[t], lift);
    }
    this.computeFacModes();
    this.drawProps();
    let houseIdx = 0;
    for (const fac of map.facilities) {
      const label = { house: '집', office: '직장', cafe: '카페', park: '공원', bar: '술집', library: '도서관', market: '시장', pond: '낚시터', hospital: '병원', city_hall: '시청', school: '학교', restaurant: '식당', gym: '헬스장', cinema: '영화관', police_station: '경찰서', fire_station: '소방서', apartment: '아파트', factory: '공장', mall: '상가', university: '대학' }[fac.type];
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

  syncSims() {
    for (const sim of world.sims) {
      let sp = simSprites.get(sim.id);
      const tx = isoX(sim.x, sim.y), ty = isoY(sim.x, sim.y) - 8;
      if (!sp) {
        const arch = archOf(sim); // 직업 제복 우선, 미지정 직업은 id%10
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
        const label = this.add.text(0, -30, sim.name, { fontSize: '10px', color: '#e8e2d8', stroke: '#14121a', strokeThickness: 3 }).setOrigin(0.5);
        const c = this.add.container(tx, ty, [shadow, body, label]);
        c.bodyRef = body; c.animKey = animKey;
        sp = c; simSprites.set(sim.id, sp);
      }
      const arch = archOf(sim);
      // 타일 델타로 4방향: 정/후면 = sign(ddx+ddy), 좌/우 = 화면 dx 부호(flipX)
      const prev = sp.lastTile ?? { x: sim.x, y: sim.y };
      const ddx = sim.x - prev.x, ddy = sim.y - prev.y;
      sp.lastTile = { x: sim.x, y: sim.y };
      // §19 R-B: 자가용 보유자는 이동 중 차량 아이콘을 단다
      if (sim.hasCar && !sp.carIcon && this.textures.exists('car')) {
        sp.carIcon = this.add.image(10, -4, 'car').setScale(16 / this.textures.get('car').getSourceImage().height);
        sp.add(sp.carIcon);
      }
      if (sp.carIcon) sp.carIcon.setVisible(sim.state?.kind === 'walking');
      const dx = tx - sp.x;
      const moving = Math.abs(dx) + Math.abs(ty - sp.y) > 1;
      const body = sp.bodyRef;
      if (body && sp.animKey) {
        if (moving) {
          const back = (ddx + ddy) < 0; // 북쪽(카메라 반대)으로 이동 → 후면
          const animKey = (back && this.ensureWalkAnim(arch, 'up')) || this.ensureWalkAnim(arch);
          if (dx !== 0) body.setFlipX(dx > 0); // 원본 ↙/↖ — 오른쪽 이동 시 반전
          body.anims.play(animKey, true);
          sp.lastBack = back && this.ensureWalkAnim(arch, 'up') !== null;
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
function updateStats() {
  const el = document.getElementById('stats');
  if (!el || !world) return;
  const couples = Object.keys(world.partners ?? {}).length / 2;
  const married = Object.values(world.partnerStage ?? {}).filter((s) => s === 'married').length / 2;
  const mayor = world.mayorId !== null && world.mayorId !== undefined ? simName(world.mayorId) : '없음';
  const tre = world.treasury ?? 0;
  el.textContent = `👥${world.sims.length} 💑${Math.floor(couples)} 💍${Math.floor(married)} 👑${mayor} 🏛️${tre.toLocaleString()}원`;
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

const PLACE_KO = { cafe: '카페', park: '공원', bar: '술집', office: '직장', library: '도서관', market: '시장', pond: '낚시터', hospital: '병원', city_hall: '시청', school: '학교', restaurant: '식당', gym: '헬스장', cinema: '영화관', police_station: '경찰서', fire_station: '소방서', apartment: '아파트', factory: '공장', mall: '상가', university: '대학', site: '공사장' };
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

// §22.28 unmet 기억의 placeId는 **장소가 아니라 행동 이름**이다(라이브 확인: 'eat').
// placeKo에 넣으면 "eat 하려는데"가 그대로 찍힌다 — 장소 이름과 행동 이름은 다른 어휘다.
// 아래쪽 ACTION_KO와 별개로 둔다: 저건 UI 라벨용 명사형('식사'), 이건 대사용 동사형이라
// 문장에서 서로 바꿔 쓸 수 없다("식사 하려는데 갈 데가 없더라"는 어색하다).
const ACTION_TRY_KO = {
  eat: '밥 먹으려', sleep: '자려', work: '일하려', socialize: '사람 만나려',
  play: '놀려', drink: '한잔하려', binge_eat: '뭐 좀 먹으려', hole_up: '좀 쉬려',
  exercise: '운동하려', build: '뭘 좀 만들려', read: '책 좀 읽으려', shop: '장 보려',
  fish: '낚시하려', cook_eat: '밥 해 먹으려', construct: '공사 거들려',
  see_doctor: '병원 가려', idle: '좀 쉬려',
};
function actKo(id) { return ACTION_TRY_KO[id] ?? '뭘 좀 하려'; }

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
          `${rang(about)} 요즘 진짜 친해졌어. 좋은 사람이야`,
          `${about} 알지? 어제도 같이 놀았는데 완전 잘 맞아`,
          d.tier === 'friend' ? `${eun(about)} 진짜 베프야` : `${rang(about)} 요즘 자주 봐`,
          `${ga(about)} 생각보다 정 많더라`,
          `${about} 얘기 나온 김에 — 나한테 진짜 잘해줬어`,
          `${rang(about)} 얘기하면 시간 가는 줄 몰라`,
          `${ga(about)} 요즘 표정이 밝아졌더라. 보기 좋아`,
          `${about} 덕분에 요즘 동네 다닐 맛 나`,
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
        case 'small_talk': return pick([`별일은 없었는데, 그냥 얘기하고 싶어서`,
          `오늘 뭐 했어? 난 별거 없었어`, `이런 날은 그냥 사람 얼굴 보는 게 좋더라`,
          `할 말이 있어서라기보단 그냥 반가워서`], t);
        default: return pick([`오늘 ${place}에서 별일이 다 있었어`, `오늘 ${place} 얘기 하나 해줄까?`], t);
      }
    }
    case 'work_gripe': {
      const occ = d.occupation;
      return pick({
        office_worker: ['회사 일이 끝이 없다 끝이 없어…', '오늘도 야근각이야', '월급날만 기다린다',
          '회의가 회의를 부르더라', '자리에 앉자마자 퇴근하고 싶어', '이번 달만 버티면 좀 나아지려나'],
        barista: ['오늘 카페 손님 미쳤었어…', '원두 냄새가 꿈에 나올 지경이야',
          '주문 밀릴 때는 손이 네 개였으면 좋겠어', '단골 얼굴은 이제 다 외웠지', '서서 일하니 다리가 남아나질 않네'],
        freelancer: ['일감이 들쭉날쭉해서 불안해', '마감이 코앞인데 잠이 온다',
          '출퇴근이 없는 대신 퇴근도 없어', '이번 건 끝나면 좀 쉬려고', '혼자 일하니 말할 사람이 없다'],
        student: ['과제가 산더미야…', '시험 기간 진짜 싫다', '어제 밤새웠어. 지금 정신이 없어',
          '학교 급식이 그래도 낫더라', '졸업하면 뭐 하지'],
        doctor: ['오늘 환자가 끊이질 않았어', '밥 먹을 틈도 없었다니까', '한 명이라도 나아서 가면 그걸로 됐지'],
        teacher: ['애들이 오늘따라 말을 안 듣더라', '수업 준비가 수업보다 오래 걸려', '가르치다 보면 내가 배워'],
        police: ['오늘 순찰 돌다 다리 아파 죽는 줄', '별일 없는 게 제일 좋은 거야', '동네가 조용해서 다행이야'],
        firefighter: ['출동 없는 날이 제일 좋은 날이지', '장비 점검만 해도 하루가 가', '연기 냄새는 익숙해지질 않아'],
        clerk: ['재고 정리하다 하루 다 갔어', '손님이 물어보는 게 다 달라', '계산 실수 안 하려고 늘 긴장해'],
        chef: ['불 앞에 있으면 여름이 두 배야', '오늘 재료가 좋더라고', '맛있게 먹었다는 말 들으면 힘나'],
      }[occ] ?? ['일이 너무 많아…', '오늘은 좀 고된 날이었어', '일이 손에 안 잡히는 날도 있지'], t);
    }
    case 'food': {
      return d.hungry
        ? pick(['배고파 죽겠어… 뭐라도 먹자', '아 오늘 제대로 못 먹었더니 어지러워',
          '뱃속에서 소리 나는 거 들었지…', '지금은 뭘 줘도 맛있을 것 같아', '점심을 걸렀더니 손이 떨려'], t)
        : pick(['여기 커피 진짜 맛있지 않아?', '요즘 뭐 맛있는 거 먹었어?', '시장에서 장 봐다 해먹는 것도 좋더라',
          '다음엔 같이 밥 먹자', '집밥이 제일이더라', '식당 새로 생긴 거 가봤어?', '먹고 나니까 살 것 같다'], t);
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
    case 'politics': {
      if (d.phase === 'campaign') {
        return pick([`이번 선거, ${about} 어때? 나쁘지 않던데`, `${ga(about)} 요즘 인사를 그렇게 하고 다닌대`,
          '이번엔 투표 꼭 하자', `${about} 공약은 봤어?`, '누가 되든 세금 얘기는 하겠지',
          '동네 일은 동네 사람이 제일 잘 알지'], t);
      }
      return pick([`${simName(d.mayorId)} 시장, 일 잘할까?`, '새 시장 됐다며? 공사가 빨라진대', '시장님 공약 기억하지?',
        '요즘 길이 좀 나아진 것 같지 않아?', '세금 얘기 나오면 다들 조용해지더라',
        '나라 일은 몰라도 동네 일은 눈에 보이잖아'], t);
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
      return d.relation === 'child'
        ? pick([`우리 ${about} 벌써 학교에 다녀. 시간 참 빠르지`, `${ga(about)} 요즘 낚시에 빠졌다니까`,
          `애 키우는 게 보통이 아니야`, `${ga(about)} 요즘 부쩍 컸어`, `${about} 밥 먹는 것만 봐도 배부르다`,
          `애가 크니까 내가 늙는 게 보이더라`], t)
        : pick([`부모님이 어제 집밥 해주셨어`, `${ga(about)} 잔소리는 해도 고마운 분이지`,
          `요즘 자주 못 찾아뵀네`, `${about} 목소리 들으면 마음이 놓여`, `가족은 있을 때 잘해야 하는데`], t);
    }
    case 'weather': {
      return pick({
        sunny: ['날씨 진짜 좋다~', '이런 날엔 공원이지', '햇살 봐, 나가길 잘했어',
          '이런 날 집에 있으면 손해야', '빨래 널기 딱 좋은 날인데', '바람이 선선해서 살 것 같다',
          '해 있을 때 좀 걷자', '하늘색 봐라. 사진 찍고 싶네'],
        cloudy: ['날이 꾸물꾸물하네', '흐린 날엔 괜히 기분도 가라앉아', '비 올 것 같은데 우산 챙겼어?',
          '이런 날은 딱 낮잠인데', '해가 안 보이니 시간 감각이 없다', '구름이 낮게 깔렸어'],
        rain: ['비 오는 소리 좋다…', '우산 챙겨왔어? 밖에 비 많이 와', '이런 날엔 실내가 최고야',
          '신발 다 젖었어…', '빗소리 들으면서 커피 마시는 거 좋아해', '오늘은 일찍 들어가야겠다',
          '비 그치면 공기가 좋아지겠지'],
      }[d.kind ?? 'sunny'] ?? ['날씨가 애매하네', '오늘 날씨 뭐라 말하기 애매하다'], t);
    }
    default: return pick(['요즘 어떻게 지내?', '별일 없지?', '오랜만이다, 잘 지냈어?', '오늘 하루 어땠어?'], t);
  }
}

// 청자 반응 — 화자에 대한 호감(listenerWarmth)과 주제로 온도를 정한다
function replyLine(e) {
  const t = e.tick;
  const warm = e.payload.listenerWarmth ?? 0;
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
    return warm >= 0 ? pick(['헐 진짜?', '그니까 말이야', '더 얘기해봐', '어쩐지…', '나도 그런 느낌 받았어',
      '어쩌다 그렇게 됐대?', '너는 어떻게 알았어?', '그래서 지금은 어때?'], t)
      : pick(['글쎄…', '남 얘긴 그만하자', '직접 물어보지 그래', '뭐 사정이 있겠지'], t);
  }
  if (e.payload.topic === 'work_gripe') {
    return warm >= 0 ? pick(['고생 많았다…', '그래도 오늘 끝났잖아', '한잔 하러 갈까?', '내일은 좀 낫겠지',
      '오늘은 몇 시에 끝났어?', '제일 힘든 게 뭐야?', '내일도 그래?'], t)
      : pick(['다들 그렇지 뭐', '그래도 일이 있는 게 어디야'], t);
  }
  if (e.payload.topic === 'weather') {
    return warm >= 0 ? pick(['그러게, 딱 좋다', '나도 방금 그 생각 했어', '이따 좀 걸을까?',
      '이따 뭐 할 거야?', '우산은 챙겼어?'], t)
      : pick(['그런가…', '난 잘 모르겠던데'], t);
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
  if (e.payload.topic === 'family_talk') {
    return warm >= 0 ? pick(['좋겠다…', '가족이 최고지', '나도 오랜만에 연락해봐야겠다',
      '요즘 어떻게 지내신대?', '자주 보러 가?', '이제 몇 살이야?'], t)
      : pick(['그렇구나', '집집마다 사정이 있지'], t);
  }
  if (warm > 0) return pick(['응응!', '완전 공감해', 'ㅋㅋㅋ 맞아', '오 진짜?', '역시 너다', '나도 나도'], t);
  if (warm < 0) return pick(['아 그래…', '흠…', '그렇구나', '음…', '그래서?'], t);
  return pick(['응응', '오 그래?', 'ㅋㅋ', '그렇구나~', '아 맞다'], t);
}

function handleVisualEvent(e) {
  if (e.type === 'city_promoted') { if (world) world.cityTier = e.payload.to; updateBadge(); fireworksBurst(); }
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
// §22.16 표시 이름은 성+이름. 성이 없는 오래된 세이브도 이름만으로 그대로 나온다.
function simName(id) {
  const s = world?.sims.find((x) => x.id === id);
  if (!s) return `심${id}`;
  return `${s.surname ?? ''}${s.name ?? ''}` || `심${id}`;
}
// 말풍선·라벨처럼 좁은 자리에서는 이름만 쓴다 (성까지 넣으면 겹친다)
function simGivenName(id) { return world?.sims.find((x) => x.id === id)?.name ?? `심${id}`; }

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
    case 'action_started': return e.payload.action === 'idle' ? null : `${n}: ${ACTION_KO[e.payload.action]} 시작${reasonText(e.payload.reason)}`;
    case 'action_completed': return `${n}: ${ACTION_KO[e.payload.action]} 완료`;
    case 'action_failed': return `${n}: 행동 실패 (${e.payload.reason})`;
    case 'money_changed': return `${n}: ${e.payload.delta > 0 ? '+' : ''}${e.payload.delta}원${e.payload.tax ? ` (세금 ${e.payload.tax}원)` : ''} (잔액 ${e.payload.balance})`;
    case 'welfare_paid': return `🏛️ 정부가 ${n}에게 생계 지원 +${e.payload.amount}원 (국고 ${e.payload.treasury}원)`;
    case 'fire_started': return `🔥 ${PLACE_KO[facTypeOf(e.payload.facilityId)] ?? e.payload.facilityId}에 불이 났다!`;
    // QA #C: fire_started는 시설 종류를 한국어로 보여주는데 fire_out만 원시 id가 새고 있었다
    case 'fire_out': {
      const fp = PLACE_KO[facTypeOf(e.payload.facilityId)] ?? e.payload.facilityId;
      return e.payload.by === 'self'
        ? `💨 ${fp}의 불이 겨우 잦아들었다… (아무도 안 왔다)`
        : `🚒 ${ga(simName(e.payload.by))} ${fp} 화재를 진압했다!`;
    }
    case 'heroic_save': return `🎖️ ${n}: 영웅이 됐다`;
    case 'petition': {
      const ko = { lonely: '외롭다', hungry: '배고프다' };
      return `📢 주민 청원: "${ko[e.payload.kind] ?? e.payload.kind}" (${e.payload.total}건, 문턱 ${e.payload.threshold})`;
    }
    case 'car_bought': return `🚗 ${ga(n)} 차를 샀다 (장거리 ${e.payload.longTrips}회 · ${e.payload.price}원, 잔액 ${e.payload.balance})`;
    case 'station_unlocked': return `🚉 장거리 이동 수요가 문턱을 넘었다 — 기차역 언락! (수요 ${e.payload.demand}/${e.payload.threshold} · 충족도 ${e.payload.fulfillmentPct}% · 장거리 ${e.payload.totalLongTrips}회 · 차 ${e.payload.carsOwned}대)`;
    case 'city_promoted': return `🏙️ 해솔${e.payload.nameKo}(으)로 승격! (인구 ${e.payload.pop}명) 🎆`;
    case 'zoned': return `📐 시장이 공터 ${e.payload.plotId}에 ${PLACE_KO[e.payload.type] ?? e.payload.type} 건설을 지시했다 (−${e.payload.cost}원, 국고 ${e.payload.treasury}원)`;
    case 'policy_changed': {
      const ko = { taxPct: '세율', welfareAmount: '복지 지급액', welfareThreshold: '복지 기준' };
      const parts = Object.entries(e.payload.changes).map(([k, v2]) => `${ko[k] ?? k} ${e.payload.before[k]}→${v2}${k === 'taxPct' ? '%' : '원'}`);
      return `🏛️ 시정 발표: ${parts.join(', ')}`;
    }
    case 'starving': return `⚠️ ${ga(n)} 굶고 있습니다!`;
    case 'lonely': return `${ga(n)} 혼자 시간을 보냈습니다…`;
    case 'argument': return `💢 ${wa(n)} ${ga(simName(e.payload.withSimId))} 말다툼했습니다`;
    case 'input_rejected': return `지시 거부됨 (${e.payload.reason})`;
    case 'player_created': return `🏠 ${ga(e.payload.name)} 마을에 이사 왔습니다! (${OCC_KO[e.payload.occupation]})`;
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
    case 'item_found': return `✨ ${ga(n)} 길에서 ${e.payload.amount}원을 주웠습니다!`;
    case 'fish_caught': return `🎣 ${ga(n)} ${e.payload.amount}원짜리 물고기를 낚았습니다!`;
    case 'project_started': {
      const tp = { house: '새 집', cafe: '새 카페', park: '새 공원' }[e.payload.type];
      return `🏗️ 마을에 ${tp} 공사가 시작됐습니다! 심들이 힘을 보탭니다`;
    }
    case 'facility_built': {
      const tp = { house: '집', cafe: '카페', park: '공원' }[e.payload.type];
      return `🎊 ${ga(tp)} 완공됐습니다! 마을이 넓어졌어요`;
    }
    case 'moved_home': return `📦 ${ga(n)} 새 집으로 이사했습니다`;
    case 'child_settled': return `👶 ${simName(e.payload.parentA)}·${simName(e.payload.parentB)} 부부의 자녀 ${ga(e.payload.name)} 마을에서 자립을 시작했습니다!`;
    case 'immigrated': return `🚌 ${ga(e.payload.name)} 해솔마을로 이사 왔습니다! (${OCC_KO[e.payload.occupation] ?? e.payload.occupation})`;
    case 'fell_sick': return `🤒 ${ga(n)} 감기에 걸렸습니다`;
    case 'recovered': return e.payload.how === 'doctor' ? `💊 ${ga(n)} 진료를 받고 나았습니다` : `🌤️ ${ga(n)} 감기에서 회복했습니다`;
    case 'election': return `🗳️ 선거 결과 — ${ga(n)} 해솔마을 시장이 되었습니다! (득표 ${e.payload.votes.join(':')})`;
    case 'started_dating': return `💕 ${wa(n)} ${ga(simName(e.payload.withSimId))} 사귀기 시작했습니다!`;
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
    case 'bed_built': return `🛏️ ${ga(n)} 집에 침대를 새로 만들었습니다!`;
    case 'public_works': {
      const n2 = e.payload.tiles?.length ?? 0;
      return `🏗️ 시장이 사람들이 다니는 길 ${n2}칸을 포장했습니다 (-${e.payload.cost}원, 국고 ${e.payload.treasury}원)`;
    }
    case 'side_talk': return `💬 ${ga(n)} 옆자리 ${wa(simName(e.payload.withSimId))} 말을 텄습니다`;
    case 'helped': {
      const why = { sick: '아픈', hungry: '배곯는', broke: '주머니가 빈' }[e.payload.why] ?? '';
      return `🤝 ${ga(n)} ${why} ${eul(simName(e.payload.toSimId))} 챙겼습니다`;
    }
    case 'greeting': return `👋 ${wa(n)} ${ga(simName(e.payload.withSimId))} 지나가며 인사했습니다`;
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
  // §22.17 고르는 것은 이름·성별·MBTI **셋뿐**이다. 나이와 직업은 세계가 정한다 —
  // 나이는 시드에서, 직업은 능력치 적성에서. 서버가 결정하므로 여기서 보내지 않는다.
  const name = $('ob-name').value.trim();
  const type = $('ob-mbti').value;
  const axisVal = (letter, first) => (letter === first ? 25 : 75); // 글자 → 축 값 (완만한 극단)
  const payload = {
    name,
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
      case 'speed': // §20
        if (window.__paintSpeed) window.__paintSpeed(msg.speed);
        break;
      case 'snapshot':
        world = msg.world;
        if (msg.world?.speed && window.__paintSpeed) window.__paintSpeed(msg.world.speed);
        $('status').textContent = '● 라이브';
        $('clock').textContent = fmtClock(world.worldTick);
        applyDaylight(world.worldTick);
        if (scene) { destroySimSprites(); scene.drawWorld(); }
        showReport();
        maybeShowOnboarding();
        renderPanel();
        syncItems();
        syncFires(); // §17.20: 스냅샷·리싱크 시 진행 중 화재 복원/정리 (Codex 43차)
        updateBadge();
        sparkHist.length = 0; // 재접속 시 이전 세션 잔존 제거 (Codex 48차 P3)
        applyWeather();
        updateStats();
        break;
      case 'tickBatch':
        if (!world) return;
        world.worldTick = msg.toTick;
        world.sims = msg.sims;
        if (msg.treasury !== undefined) world.treasury = msg.treasury;
        if (msg.incidents !== undefined) { world.incidents = msg.incidents; syncFires(); }
        if (msg.projects !== undefined) world.projects = msg.projects; // §19.3
        if (msg.speed && window.__paintSpeed) window.__paintSpeed(msg.speed); // §20
        if (msg.cityTier !== undefined && world.cityTier !== msg.cityTier) { world.cityTier = msg.cityTier; updateBadge(); }
        if (msg.transit) world.transit = msg.transit; // §19.12 역 수요 관측·언락 (zone 모달 게이트)
        if (msg.statsToday) { // §18.T5 증분 upsert (54차: 동일 day는 교체)
          world.statsHistory ??= [];
          const last = world.statsHistory[world.statsHistory.length - 1];
          if (last && last.day === msg.statsToday.day) world.statsHistory[world.statsHistory.length - 1] = msg.statsToday;
          else { world.statsHistory.push(msg.statsToday); while (world.statsHistory.length > 180) world.statsHistory.shift(); }
        }
        // §18.T1: 정책 변경 이벤트로 클라 상태 동기화 — 슬라이더가 낡은 값을 재전송하지 않도록 (Codex 46차)
        for (const e of msg.events) {
          if (e.type === 'policy_changed') world.policy = { ...(world.policy ?? {}), ...e.payload.changes };
        }
        $('clock').textContent = fmtClock(world.worldTick);
        applyDaylight(world.worldTick);
        for (const e of msg.events) { pushFeed(e); handleVisualEvent(e); }
        // §15.1.B: 세계 변형 이벤트를 클라이언트 맵에 반영
        let mapDirty = false;
        for (const e of msg.events) {
          if (e.type === 'road_formed' && world) {
            world.map.tiles[e.payload.y * world.map.w + e.payload.x] = 1;
            mapDirty = true;
          } else if (e.type === 'public_works' && world) {
            // §22.26 정부 포장 — road_formed와 같은 증분 갱신. 이 분기가 없으면 클라는
            // 다음 전체 resync(15초+)까지 포장을 모른 채 잔디를 그린다.
            for (const idx of (e.payload.tiles ?? [])) world.map.tiles[idx] = 1;
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

// ---- §18.T1 시정 운영 패널 ----
(() => {
  const modal = document.getElementById('policy-modal');
  const btn = document.getElementById('policy-btn');
  if (!btn) return;
  const els = {
    taxPct: [document.getElementById('pol-tax'), document.getElementById('pol-tax-v'), '%'],
    welfareAmount: [document.getElementById('pol-amt'), document.getElementById('pol-amt-v'), '원'],
    welfareThreshold: [document.getElementById('pol-thr'), document.getElementById('pol-thr-v'), '원'],
  };
  const DEFAULTS = { taxPct: 15, welfareAmount: 200, welfareThreshold: 300 };
  for (const [k, [input, label, unit]] of Object.entries(els)) {
    input.addEventListener('input', () => { label.textContent = input.value + unit; });
  }
  btn.addEventListener('click', () => {
    for (const [k, [input, label, unit]] of Object.entries(els)) {
      input.value = world?.policy?.[k] ?? DEFAULTS[k];
      label.textContent = input.value + unit;
    }
    document.getElementById('pol-msg').textContent = '';
    modal.style.display = 'flex';
  });
  document.getElementById('pol-close').addEventListener('click', () => { modal.style.display = 'none'; });
  document.getElementById('pol-apply').addEventListener('click', async () => {
    const payload = {};
    for (const [k, [input]] of Object.entries(els)) payload[k] = parseInt(input.value, 10);
    const res = await fetch('/api/input', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientInputId: `policy:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, command: 'policy', payload }),
    });
    const j = await res.json();
    document.getElementById('pol-msg').textContent = res.ok ? '시행되었습니다. 다음 틱부터 적용됩니다.' : `거부: ${j.error}`;
    if (res.ok) setTimeout(() => { modal.style.display = 'none'; }, 900);
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
    const max = Math.max(1, ...sparkHist.map((p) => p[key]));
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
    sparkHist.forEach((p, i) => {
      const x = (i / Math.max(1, sparkHist.length - 1)) * (cv.width - 4) + 2;
      const y = cv.height - 3 - (p[key] / max) * (cv.height - 8);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
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
  const COST = { house: 2000, cafe: 3000, office: 3000, park: 1000, apartment: 6000, factory: 8000, mall: 8000, university: 10000 };
  const TIER_NEED = { apartment: 1, factory: 2, mall: 2, university: 3 };
  // §19.12 기차역은 인구 등급이 아니라 **이동 수요**가 언락한다 (world.transit, 이슈 #52).
  // 착공 레시피(ZONEABLE·비용)는 후속 라운드 — 언락 전에는 충족도 %를, 언락 후에는
  // 언락 사실을 보여주고 '지시'는 잠근다 (서버가 bad_type으로 거부할 주문을 보내지 않는다).
  const stationLocked = () => !(world?.transit?.stationUnlocked);
  const render = () => {
    const isStation = type === 'train_station';
    const need = TIER_NEED[type] ?? 0;
    const locked = (world?.cityTier ?? 0) < need;
    const pct = world?.transit?.fulfillmentPct ?? 0;
    const info = isStation
      ? `공터 ${cur.plotId} · ${type} · ` + (stationLocked()
        ? `🔒 이동 수요 ${pct}% — 100%에 언락`
        : `🚉 언락됨 (수요 ${pct}%) · 착공 레시피는 후속 라운드`)
      : `공터 ${cur.plotId} · ${type} · 방향 ${['↙','↘','↗','↖'][dir]} · 비용 ${COST[type]}원` + (locked ? ` · 🔒${['','읍','시','대도시'][need]} 필요` : '');
    document.getElementById('zone-info').textContent = info;
    for (const b of modal.querySelectorAll('[data-zt]')) {
      const zt = b.dataset.zt;
      const dim = zt === 'train_station' ? stationLocked() : (world?.cityTier ?? 0) < (TIER_NEED[zt] ?? 0);
      b.style.opacity = dim ? 0.4 : 1;
      b.style.borderColor = zt === type ? '#ffcf6a' : '#6b5638';
    }
    const go = document.getElementById('zone-go');
    go.disabled = isStation;
    go.style.opacity = isStation ? 0.4 : 1;
  };
  window.openZoneModal = (plot) => { cur = plot; dir = 0; type = 'house'; modal.style.display = 'flex'; render(); };
  for (const b of modal.querySelectorAll('[data-zt]')) b.addEventListener('click', () => { type = b.dataset.zt; render(); });
  document.getElementById('zone-rot').addEventListener('click', () => { dir = (dir + 1) % 4; render(); });
  document.getElementById('zone-close').addEventListener('click', () => { modal.style.display = 'none'; });
  document.getElementById('zone-go').addEventListener('click', async () => {
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
      const max = Math.max(1, ...hist.map((p) => p[key]));
      ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
      hist.forEach((p, i) => {
        const x = 6 + (i / (hist.length - 1)) * (cv.width - 12);
        const y = cv.height - 8 - (p[key] / max) * (cv.height - 20);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    const last = hist[hist.length - 1];
    const happiness = Math.round(((last.avgMood + 10000) / 200)); // mood -10000..10000 → 0..100%
    const emp = last.pop > 0 ? Math.round(last.employed * 100 / last.pop) : 0;
    document.getElementById('dash-cards').textContent =
      `😊 행복도 ${happiness}% · 💼 고용률 ${emp}% · 👥 ${last.pop}명 · 🏛️ ${last.treasury.toLocaleString()}원 · ⭐ 평판 ${last.reputation} · ${['🏡 마을','🏘️ 읍','🏙️ 시','🌆 대도시'][last.tier]}`;
  }
  btn.addEventListener('click', () => { modal.style.display = 'flex'; drawDash(); });
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
