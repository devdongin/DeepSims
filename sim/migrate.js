// 세이브 마이그레이션 (PLAN §12.1): 입력 처리 전 로드 시점에 완료.
// 결정적 — 임시 RNG만 사용, world의 rngSim/rngWorldgen 상태를 소비하지 않는다.
import { migrationTraits } from './traits.js';
import { makeAbilities } from './abilities.js'; // §21.1
import { growIdMatrices as growIdMatricesRef } from './society.js'; // §22.2
import { DEFAULT_LOGIC, mergeLogicDefaults } from './logic.js';
import { addBarTo, addVenuesTo, addSocietyVenuesTo, addLeisureVenuesTo, addCivicVenuesTo, expandMapTo64, expandMapTo128, expandMapTo512, defaultPlots, extraPlots128, extraPlots512, generateTerrain } from './map.js';
import { makeRng } from './prng.js'; // §19 R-A 지형 전용 스트림
import { SCHEMA_VERSION } from './constants.js';
import { surnameFor } from './surnames.js';

export function migrateWorld(world) {
  const from = world.schemaVersion ?? 1;
  if (from < 2) {
    for (const sim of world.sims) {
      if (!sim.traits) sim.traits = migrationTraits(world.seed, sim.id);
      if (sim.mood === undefined) sim.mood = 0;
      if (sim.isPlayer === undefined) sim.isPlayer = false;
    }
    if (!world.logic) world.logic = DEFAULT_LOGIC;
  }
  if (from < 3) {
    // Phase 3 인지 상태 — 결정적 기본값
    for (const sim of world.sims) {
      sim.memories ??= [];
      sim.memorySeq ??= 0;
      sim.habit ??= {};
      sim.relTiers ??= {};
      sim.lastReflectedDay ??= -1;
      sim.reflectionMemoryCursor ??= 0;
      if (sim.pendingMood === undefined) sim.pendingMood = null;
    }
    world.interactions ??= world.sims.map(() => new Array(world.sims.length).fill(0));
  }
  if (from < 4) {
    // Phase 4: 토큰·계획 상태
    for (const sim of world.sims) {
      sim.knownTokens ??= [];
      if (sim.plan === undefined) sim.plan = null;
      sim.lastPlannedDay ??= -1;
    }
    world.tokens ??= [];
    world.tokenCounter ??= 0;
  }
  if (from < 5) {
    // D9: 인사 가드 매트릭스
    world.lastGreetDay ??= world.sims.map(() => new Array(world.sims.length).fill(-1));
  }
  if (from < 6) {
    // §15.1: 술집 주입(buildMap과 동일 헬퍼 = 신규 월드와 바이트 동일), 마모·숙취 상태
    addBarTo(world.map.tiles, world.map.facilities);
    for (const f of world.map.facilities) {
      if (f.type === 'house' && !f.extraBedSlots) {
        f.extraBedSlots = [{ x: f.x + 2, y: f.y + 2 }, { x: f.x + 3, y: f.y + 2 }];
      }
    }
    world.wear ??= new Array(world.map.w * world.map.h).fill(0);
    for (const sim of world.sims) sim.hangoverUntil ??= -1;
  }
  if (from < 7) {
    // §16: 신규 시설 주입 — footprint 타일은 무조건 덮어씀 (v6에서 형성된 도로도 건물이 우선,
    // 결정적. wear 값은 남지만 GRASS가 아니게 되어 무해). WATER는 영구 비보행 (Codex 22차 항목 3).
    addVenuesTo(world.map.tiles, world.map.facilities);
    world.weather ??= { day: 0, kind: 'sunny' }; // 신규 월드와 동일 초기값 — 첫 드로우는 day 경계에서
    world.lostItems ??= [];
    world.itemCounter ??= 0;
    for (const sim of world.sims) sim.groceries ??= 0;
  }
  if (from < 8) {
    // §16.5: 맵 64 확장(좌표 보존·경계 개방·도로 연장 — 신규 월드와 단일 헬퍼) + 공터
    const r = expandMapTo64(world.map, world.wear);
    world.wear = r.wear;
    world.plots ??= defaultPlots();
    if (world.project === undefined) world.project = null;
    if (world.project && world.project.required === undefined) world.project.required = 600;
    world.lastPlanDay ??= -1;
  }
  if (from < 9) {
    // §16.6: 128 확장 (v8 체인 뒤에 적용 — 신규 월드와 같은 헬퍼·순서) + 추가 공터 append
    const r = expandMapTo128(world.map, world.wear);
    world.wear = r.wear;
    if (world.plots.length <= 8) world.plots = [...world.plots, ...extraPlots128()];
  }
  if (from < 10) {
    // §17.0: 512 확장 → wear 희소화(>0만 이관, 새 좌표 재매핑은 expandMapTo가 밀집 기준으로 수행)
    if (Array.isArray(world.wear)) {
      const r = expandMapTo512(world.map, world.wear);
      const sparse = {};
      for (let i = 0; i < r.wear.length; i++) if (r.wear[i] > 0) sparse[i] = r.wear[i];
      world.wear = sparse;
    } else {
      expandMapTo512(world.map, null);
    }
    addSocietyVenuesTo(world.map.tiles, world.map.facilities, world.map.w);
    if (world.plots.length <= 32) world.plots = [...world.plots, ...extraPlots512()];
    for (const sim of world.sims) sim.sick ??= null;
    world.partners ??= {};
    world.partnerStage ??= {};
    world.clubs ??= { book_club: [], fishing_club: [], fitness_club: [], drinking_pals: [] };
    if (world.mayorId === undefined) world.mayorId = null;
    world.lastElectionDay ??= -1;
    world.immigrantCounter ??= 0;
    world.lastDailyDay ??= -1;
  }
  if (from < 11) {
    world.campaigners ??= [];
    world.recentCouples ??= [];
  }
  if (from < 12) {
    addLeisureVenuesTo(world.map.tiles, world.map.facilities, world.map.w); // §17.10
  }
  if (from < 13) {
    world.parents ??= {}; // §17.11
  }
  if (from < 14) {
    // 구 빌드가 required 스냅샷 없이 만든 진행 중 프로젝트 백필 — 완공 판정(progress ≥ required)이
    // 영원히 false가 되어 프로젝트 슬롯을 영구 점유하는 교착 수리. 값은 §16.5 기본 노동량.
    if (world.project && !Number.isSafeInteger(world.project.required)) world.project.required = 600;
  }
  if (from < 15) {
    // §17.13: 치안·소방 시설 주입 (신규 월드는 buildMap 체인과 동일 헬퍼)
    addCivicVenuesTo(world.map.tiles, world.map.facilities, world.map.w);
  }
  if (from < 16) {
    world.treasury ??= 0; // §17.15 국고
  }
  if (from < 17) {
    world.reputation ??= 0; // §17.21 평판
  }
  if (from < 18) {
    world.incidents ??= []; // §17.20 사건
  }
  if (from < 19) {
    for (const sim of world.sims) sim.noPathCool ??= {}; // §17.23
    repairOverlaps(world); // §17.23: 공터-권위 시설 겹침 외과수술 (이슈 #21 라이브 세이브)
  }
  if (from < 20) {
    world.policy ??= {}; // §18.T1
  }
  if (from < 21) {
    world.zoneOrders ??= []; // §18.T2
  }
  if (from < 22) {
    world.cityTier ??= 0; // §18.T4 — 기존 세이브는 다음 일일 평가에서 자연 승급 (축하 이벤트 라이브)
  }
  if (from < 23) {
    world.statsHistory ??= []; // §18.T5
  }
  if (from < 24) {
    world.lostAndFound ??= []; // §17.24
    for (const sim of world.sims) sim.patrolIdx ??= 0;
  }
  if (from < 29) {
    for (const sim of world.sims) sim.complaintDays ??= {}; // §19.7
  }
  if (from < 30) {
    // §19.10 (73차 ②): 원인 분화 시행일 — 이전 no_facility 항목은 외부 노출에서 legacy 표시
    world.complaintReasonDay = Math.floor(world.worldTick / 1440);
  }
  if (from < 40) {
    // §22.7 (97차 ④): 이름 섞기가 **새 세계의 생성 결과**를 바꾼다. 기존 세계 데이터는
    // 그대로 두되(이름은 스냅샷에 이미 박혀 있다), 구 로그 재생이 어긋났을 때
    // '버그'가 아니라 '생성 버전 차이'로 식별되도록 표식만 남긴다.
  }
  if (from < 39) {
    // §22.6 먼저 말 걸기 — 하루 1회 제한 상태의 결정적 기본값.
    for (const sim of world.sims) { sim.approachedDay ??= -1; sim.approachedTo ??= []; }
  }
  if (from < 38) {
    // §22.4 경계 유입 누계 — 기반 부문(마을 밖) 소득을 명시적으로 센다 (G1 폐쇄 회계).
    world.externalInflow ??= 0;
    world.externalOutflow ??= 0;
  }
  if (from < 37) {
    // §22.2 생애 주기: id 전용 카운터와 굶은 시간 누적기. 사망으로 심이 사라져도
    // 새 id가 기존 id와 충돌하지 않게 하고, 행렬을 id 공간 크기로 맞춘다.
    world.nextSimId ??= world.sims.reduce((mx, s) => Math.max(mx, s.id), -1) + 1;
    for (const sim of world.sims) { sim.hungerZeroTicks ??= 0; sim.sharedTo ??= []; sim.sharedDay ??= -1; }
    growIdMatricesRef(world);
  }
  if (from < 36) {
    // §21.3 전직: 새 파라미터는 mergeLogicDefaults가 설치한다. 세계 데이터 이관은 없다 —
    // 거동이 바뀌므로 구 로그 재생 불일치를 '버전 차이'로 식별하기 위한 표식이다 (75차 ①).
  }
  if (from < 35) {
    // §21.2 나눔: 쌍당 하루 1회를 위한 결정적 기본값 (83차 ③).
    for (const sim of world.sims) { sim.sharedDay ??= -1; sim.sharedTo ??= []; }
  }
  if (from < 34) {
    // §21.1 능력치 (이슈 #62): seed·simId에서 결정적으로 유도하므로 rngSim을 소비하지 않는다.
    // 기존 심도 즉시 같은 값을 갖고, 리플레이 스트림이 어긋나지 않는다.
    for (const sim of world.sims) sim.abilities ??= makeAbilities(world.seed, sim.id);
  }
  if (from < 33) {
    // §20.3 사회적 중력: 새 파라미터는 mergeLogicDefaults가 설치한다. 세계 데이터 이관은 없다 —
    // 거동이 바뀌므로 구 로그 재생 불일치를 '버전 차이'로 식별하기 위한 표식이다 (75차 ①).
  }
  if (from < 32) {
    // §20.2: 시설 매출 원장 도입 (이슈 #43 — 소비금이 소멸하던 문제).
    // 기존 시설은 매출 0에서 시작한다. 과거 소비는 이미 사라졌으므로 소급하지 않는다.
    for (const f of world.map.facilities) f.revenue ??= 0;
  }
  if (from < 31) {
    // §20.1 (75차 ①): 복지 수급 순서가 id asc → 필요도 순(잔고 asc)으로 바뀌었다.
    // 세이브 구조는 그대로지만 **같은 스냅샷에서 다른 궤적**이 나오므로, 구 로그 재생이
    // 어긋났을 때 "버그"가 아니라 "행동 버전 차이"로 식별되도록 버전을 올린다.
    // 데이터 이관은 필요 없다 — 표식만으로 충분하다.
  }
  if (from < 43) {
    // §22.16 invitedTo를 모든 심에게 명시적으로 심는다 (없으면 키가 갈린다)
    for (const sim of world.sims) if (sim.invitedTo === undefined) sim.invitedTo = null;
    // §22.16 성씨 백필. (seed, simId) 해시라 같은 심은 언제나 같은 성을 받고,
    // rng를 소비하지 않으므로 리플레이 스트림이 어긋나지 않는다.
    // 자녀는 원래 부모 성을 따라야 하지만, 기존 세이브에는 그 정보가 없다 —
    // world.parents로 부모를 찾을 수 있으면 그쪽 성을 물려주고, 아니면 분포에서 뽑는다.
    const surnameOf = (sim) => surnameFor(world.seed, sim.id);
    for (const sim of world.sims) if (typeof sim.surname !== 'string') sim.surname = surnameOf(sim);
    // 부모가 있는 심은 성을 부모에게 맞춘다 (id 오름차순 — 세대가 순서대로 정리된다)
    const byId = new Map(world.sims.map((s) => [s.id, s]));
    for (const sim of [...world.sims].sort((a, b) => a.id - b.id)) {
      const pr = world.parents?.[sim.id];
      if (!Array.isArray(pr) || pr.length < 2) continue;
      const pa = byId.get(pr[0]); const pb = byId.get(pr[1]);
      if (!pa || !pb) continue;
      const dads = [pa, pb].filter((x) => x.traits?.gender === 'M');
      const np = dads.length === 1 ? dads[0] : (pa.id <= pb.id ? pa : pb);
      if (typeof np.surname === 'string') sim.surname = np.surname;
    }
  }
  if (from < 42) {
    // §22.14 동석 대화 카운터. undefined면 직렬화 왕복이 고정점이 아니게 되므로 0으로 심는다.
    for (const sim of world.sims) if (sim.state && sim.state.sideTalkTicks === undefined) sim.state.sideTalkTicks = 0;
  }
  if (from < 41) {
    // §22.13 플레이어 심의 groceries·sick 미초기화 복구 (플레이테스트 S2-1).
    // 살아 있는 세계에는 이미 NaN이 저장돼 null로 굳어 있거나 키가 아예 없다.
    // `??=`는 null·undefined는 잡아도 NaN은 못 잡으므로 유한수 검사로 되살린다.
    for (const sim of world.sims) {
      if (!Number.isSafeInteger(sim.groceries)) sim.groceries = 0;
      if (sim.sick === undefined) sim.sick = null;
    }
  }
  if (from < 28) {
    world.complaints ??= []; // §19.5
    world.petitions ??= {};
    for (const sim of world.sims) { sim.complaintCursor ??= 0; sim.complaintDays ??= {}; }
  }
  if (from < 27) {
    // §19.3 (66차 ④): 단수 project → 배열 이관, plotId asc 정규화, required 백필, legacy 제거
    const legacy = world.project;
    if (!Array.isArray(world.projects)) world.projects = [];
    if (legacy && world.projects.length === 0) world.projects.push(legacy); // 단수 → 배열 이관
    for (const p of world.projects) if (!Number.isSafeInteger(p.required)) p.required = 600;
    world.projects.sort((a, b) => a.plotId - b.plotId);
    delete world.project;
  }
  if (from < 26) {
    for (const sim of world.sims) { sim.hasCar ??= false; sim.longTrips ??= 0; } // §19 R-B
  }
  if (from < 25) {
    // §19 R-A: 기존 세이브에 지형 1회 주입 (구시가 0..140 보존 — generateTerrain 내부 가드)
    generateTerrain(world.map, makeRng((world.seed ^ 0x7e44a1) >>> 0), world.plots); // 공터 보호 (63차 ①)
    world.terrainVersion = 1; // 생성 버전 고정 (61차 합의)
  }
  // 구버전 logic에 새 섹션 기본값 병합 (D2 — pending 정합 이전, 로드 시점)
  if ((world.logic.logicSchemaVersion ?? 1) < DEFAULT_LOGIC.logicSchemaVersion) {
    world.logic = mergeLogicDefaults(world.logic);
  }
  // §22.13 상수를 쓴다. 예전에는 리터럴이라 SCHEMA_VERSION을 올릴 때 같이 안 고치면
  // 로드된 세계가 구버전으로 되돌아가고, 라이브 세계와 상태가 갈렸다.
  world.schemaVersion = SCHEMA_VERSION;
  return world;
}

// §17.23: 공터에 지어진 건물이 권위(authored) 시설을 덮은 세이브 수리 — 결정적.
// 침입자(정규식 ^(house|cafe|office|park)\d+$)를 제거하고 권위 시설을 재축조한다.
function repairOverlaps(world) {
  const map = world.map;
  const W = map.w;
  const isPlotBuilt = (f) => /^(house|cafe|office|park)\d+$/.test(f.id);
  for (let i = map.facilities.length - 1; i >= 0; i--) {
    const b = map.facilities[i];
    if (!b.w || !isPlotBuilt(b)) continue;
    const victim = map.facilities.find((a) => a !== b && a.w
      && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
    if (!victim) continue;
    // 1) 침입자 발자국 초지화
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) map.tiles[y * W + x] = 0;
    map.facilities.splice(i, 1);
    // 2) 주민 재배치 (침입자가 집이면): 빈 침대 있는 집 배열 순, 없으면 첫 집
    for (const sim of world.sims) {
      if (sim.homeId !== b.id) continue;
      const home = map.facilities.find((f) => f.type === 'house'
        && f.resources.length > world.sims.filter((s2) => s2.homeId === f.id).length)
        ?? map.facilities.find((f) => f.type === 'house');
      sim.homeId = home.id;
    }
    // 3) 피해 시설 재축조 (벽 있는 유형 일반 규칙: 둘레 WALL·내부 FLOOR·문 FLOOR)
    if (victim.type !== 'park' && victim.type !== 'pond') {
      for (let y = victim.y; y < victim.y + victim.h; y++) {
        for (let x = victim.x; x < victim.x + victim.w; x++) {
          const edge = y === victim.y || y === victim.y + victim.h - 1 || x === victim.x || x === victim.x + victim.w - 1;
          map.tiles[y * W + x] = edge ? 3 : 2; // WALL : FLOOR
        }
      }
      map.tiles[victim.door.y * W + victim.door.x] = 2;
    }
  }
}
