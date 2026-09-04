// 세이브 마이그레이션 (PLAN §12.1): 입력 처리 전 로드 시점에 완료.
// 결정적 — 임시 RNG만 사용, world의 rngSim/rngWorldgen 상태를 소비하지 않는다.
import { migrationTraits } from './traits.js';
import { makeAbilities, initializeDevelopment } from './abilities.js'; // §21.1 / #96
import { growIdMatrices as growIdMatricesRef } from './society.js'; // §22.2
import { DEFAULT_LOGIC, mergeLogicDefaults } from './logic.js';
import { addBarTo, addVenuesTo, addSocietyVenuesTo, addLeisureVenuesTo, addCivicVenuesTo, expandMapTo64, expandMapTo128, expandMapTo512, defaultPlots, extraPlots128, extraPlots512, generateTerrain } from './map.js';
import { makeRng } from './prng.js'; // §19 R-A 지형 전용 스트림
import { SCHEMA_VERSION } from './constants.js';
import { makeTransportStats } from './transport-stats.js';
import { makeStoryteller } from './storyteller.js';
import { initializeFoodSupply } from './food-supply.js';
import { seasonAt } from './seasons.js';
import { initializeVillages } from './villages.js';
import { initializeGovernments, initializeMunicipalHistory, initializeMunicipalWorks, initializeMunicipalGrowth } from './government.js';
import { newFoundingState } from './founding.js';
import { newNeedsTier } from './needs-tiers.js';
import { newEducation } from './education.js';
import { surnameFor } from './surnames.js';
import { makeTransitState } from './world.js'; // §19.12 신규 월드와 단일 정의 공유
import { isWalkable, isResidence } from './map.js';
import { emptyState } from './simfactory.js';
import { refreshMoodCounts } from './mood-counts.js';
import { initializeRail } from './rail.js';

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
  if (from < 51) {
    world.centers ??= []; // §18.T6
  }
  if (from < 52) {
    world.roadReports ??= [];
    for (const sim of world.sims) sim.state.journey ??= null;
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
  if (from < 53) {
    for (const sim of world.sims) initializeDevelopment(sim, world.seed, DEFAULT_LOGIC, true);
  }
  if (from < 54) {
    for (const sim of world.sims) { sim.isGenius ??= false; sim.geniusBirth ??= null; }
  }
  if (from < 57) world.unlockedIndustries ??= [];
  // #71: no retroactive payments/healing. In-flight visits revalidate at completion;
  // the logic defaults below install 100% copay without replacing existing policy.
  if (from < 58) { world.policy ??= {}; world.childAllowanceDay ??= -1;
    for(const sim of world.sims){sim.state.escortId??=null;sim.state.escortPhase??=null;} }
  if (from < 55) {
    for (const sim of world.sims) {
      sim.education ??= newEducation();
      // Legacy adult students must not silently become workers. Their historical
      // credits/start date are unknown: begin tracking now, never invent a degree.
      if (sim.traits.occupation === 'student' && sim.traits.age >= 19 && !sim.education.course) {
        sim.education.course='university';sim.education.courseStartAge=sim.traits.age;
        sim.education.wantsUniversity=true;
      }
    }
    world.map.facilities = world.map.facilities.map(f => f.type === 'school' ? {...f,type:'primary_school'} : f);
    // Old eight-wide factory/campus slot formulas put the last column on a wall.
    // Preserve valid resources and IDs; move only invalid slots into free interior cells.
    for (const f of world.map.facilities) {
      if (!['factory','university','primary_school','middle_school','high_school'].includes(f.type)) continue;
      const occupied=new Set(f.resources.filter(r=>isWalkable(world.map,r.x,r.y)).map(r=>`${r.x},${r.y}`));
      for (const r of f.resources) {
        if(isWalkable(world.map,r.x,r.y))continue;
        let best=null,distance=Infinity;
        for(let y=f.y+1;y<f.y+f.h-1;y++)for(let x=f.x+1;x<f.x+f.w-1;x++) {
          if(!isWalkable(world.map,x,y)||occupied.has(`${x},${y}`))continue;
          const d=Math.abs(x-r.x)+Math.abs(y-r.y);
          if(d<distance){best={x,y};distance=d;}
        }
        if(!best)continue;
        r.x=best.x;r.y=best.y;occupied.add(`${r.x},${r.y}`);
        const key=`${f.id}:${r.id}`;
        delete world.reservations[key];
        for(const s of world.sims) {
          if(s.state.facilityId===f.id&&s.state.resourceId===r.id)s.state=emptyState();
          if(s.noPathCool)delete s.noPathCool[key];
        }
      }
    }
  }
  if (from < 56) {
    // #57 appends an action; existing sim states remain valid. New action defaults
    // are installed by mergeLogicDefaults, with no retroactive meals or spending.
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
  if (from < 50) {
    // §19.12 (이슈 #52) 역 수요 관측·언락 상태 + 장거리 칸수 누적.
    // 기존 세계는 다음 일일 평가에서 첫 판정을 받는다 — 관측값은 0에서 시작한다.
    // longTripTiles는 소급하지 않는다: 과거 이동의 경로 길이는 기록돼 있지 않고,
    // 지어내면 거리 가중이 허구 위에 선다. avgTripTiles는 마이그레이션 직후 0이라
    // 거리 가중 없이(계수 100) 판정이 시작되고, 이후 실제 이동이 채운다.
    //
    // `??=`만으로는 부분 객체·손상 값을 못 고친다 (§22.18 v45와 같은 이유, Codex 교차
    // 리뷰 조건) — 기본 모양과 **필드 단위로 병합**하고, 유한 safe integer가 아닌 값은
    // 기본값으로 되돌린다. 언락 판정의 입력(longTrips·longTripTiles)도 여기서 정규화한다.
    const base = makeTransitState();
    const raw = world.transit;
    const src = (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const tr = {};
    for (const [k, dv] of Object.entries(base)) {
      const v = src[k];
      if (typeof dv === 'boolean') tr[k] = v === true;
      else tr[k] = (Number.isSafeInteger(v) && v >= (k === 'unlockedDay' ? -1 : 0)) ? v : dv; // 카운터는 ≥0, 언락일만 -1 허용
    }
    if (!tr.stationUnlocked) tr.unlockedDay = -1; // 잠긴 세계에 언락일이 남지 않게
    world.transit = tr;
    for (const sim of world.sims) {
      if (!Number.isSafeInteger(sim.longTrips) || sim.longTrips < 0) sim.longTrips = 0;
      if (!Number.isSafeInteger(sim.longTripTiles) || sim.longTripTiles < 0) sim.longTripTiles = 0;
    }
  }
  if (from < 49) {
    world.lastPublicWorksDay ??= -1; // §22.26
  }
  if (from < 48) {
    // §22.22 시장 재정 리뷰 가드 + 플레이어 정책 존중 창
    world.lastFiscalDay ??= -1;
    world.playerPolicyDay ??= -1;
  }
  if (from < 47) {
    // §22.20 임기 시작 정책 스냅샷. 진행 중 세계는 기준선이 없으므로 null로 시작한다 —
    // 다음 선거에서 스냅샷이 잡히고 그 다음 임기부터 '조정 안 함' 판정이 선다.
    world.termStartPolicy ??= null;
  }
  if (from < 46) {
    // §22.19 일상 수요 원장 + 하루 1회 가드
    world.industryWant ??= {};
    for (const sim of world.sims) { sim.wantDay ??= -1; sim.wantedActions ??= []; }
  }
  if (from < 45) {
    // §22.18 산업 수요 원장. `??=`만으로는 배열·문자열 같은 손상 값을 못 고친다
    // (109차 ⑤) — 순수 객체가 아니면 버리고 새로 만든다. 각 항목의 카운터도 검사한다.
    world.capacityShortfall ??= {};
    const d = world.industryDemand;
    if (d === null || typeof d !== 'object' || Array.isArray(d)) world.industryDemand = {};
    else {
      for (const [k, v] of Object.entries(d)) {
        if (v === null || typeof v !== 'object' || Array.isArray(v)
          || !Number.isSafeInteger(v.unmet) || v.unmet < 0) delete d[k];
      }
    }
  }
  if (from < 44) {
    // §22.16 성씨 백필/재계산.
    //
    // **살아 있는 인구에 기대면 안 된다** (설계 검증 ②). 사망한 심은 world.sims에서
    // 제거되므로, 부모가 죽은 뒤에 마이그레이션을 돌리면 상속 분기가 통째로 건너뛰어져
    // 같은 심이 다른 성을 받는다 — 실측으로 형제끼리 성이 갈렸다.
    // world.parents는 사망 뒤에도 남으므로 **계보만 보고** 뿌리를 찾는다. 생사와 무관하다.
    //
    // 44에서 다시 도는 이유: 43의 표는 한자별 인구를 썼는데 심 이름은 한글로만 보이므로
    // 한글 단위로 합산해야 맞다(유 = 柳+劉+兪 → 1.1%가 아니라 1.9%). 표가 바뀌면
    // 저장된 세계와 같은 시드의 새 세계가 갈리므로 **강제로 다시 계산한다**.
    const rootOf = (startId) => {
      let cur = startId;
      const seen = new Set();
      while (!seen.has(cur)) {
        seen.add(cur);
        const pr = world.parents?.[cur];
        if (!Array.isArray(pr) || pr.length < 2) break;
        // 명명 부모: id가 작은 쪽. 성별로 고르면 죽은 부모의 성별을 알 수 없어
        // 마이그레이션이 생사에 다시 의존하게 된다. 뿌리 추적은 완전 순서라야 한다.
        const next = Math.min(pr[0], pr[1]);
        if (next === cur) break;
        cur = next;
      }
      return cur;
    };
    for (const sim of world.sims) sim.surname = surnameFor(world.seed, rootOf(sim.id));
    // invitedTo를 모든 심에게 명시적으로 심는다 (없으면 심마다 키가 갈린다)
    for (const sim of world.sims) if (sim.invitedTo === undefined) sim.invitedTo = null;
  }
  if (from < 42) {
    // §22.14 동석 대화 카운터. undefined면 직렬화 왕복이 고정점이 아니게 되므로 0으로 심는다.
    for (const sim of world.sims) if (sim.state && sim.state.sideTalkTicks === undefined) sim.state.sideTalkTicks = 0;
  }
  // §22.90 상대별 최근 대화 주제. 구세이브는 빈 기록에서 시작한다.
  for (const sim of world.sims) sim.conversationTopics ??= {};
  for (const sim of world.sims) sim.unpaidDays ??= 0;
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
  if (from < 59) {
    for (const sim of world.sims) {
      sim.householdId ??= `household:${sim.homeId}`;
      sim.independenceDays ??= 0;
    }
    for (const [aRaw,b] of Object.entries(world.partners ?? {})) {
      const a=Number(aRaw); if(a>=b||world.partnerStage?.[a]!=='married')continue;
      const pa=world.sims.find(s=>s.id===a),pb=world.sims.find(s=>s.id===b);
      if(pa&&pb)pa.householdId=pb.householdId=`household:marriage:${a}:${b}`;
    }
    world.householdIntents ??= [];
    world.nextHouseholdIntentId ??= 0;
    world.householdDaily ??= { day:-1, households:[], failures:{} };
  }
  if(from<60){
    for(const f of world.map.facilities)if(isResidence(f))f.ownerSimId??=null;
    world.facilityUseToday??={};world.housingMarket??={day:-1,homes:[],facilityUse:{},totals:{charged:0,paid:0,shortfall:0}};
    world.rentPressure??={};
  }
  if (from < 61) world.transportStats ??= makeTransportStats(Math.floor(world.worldTick / 1440));
  if (from < 62) world.storyteller ??= makeStoryteller();
  // 구버전 logic에 새 섹션 기본값 병합 (D2 — pending 정합 이전, 로드 시점)
  if ((world.logic.logicSchemaVersion ?? 1) < DEFAULT_LOGIC.logicSchemaVersion) {
    world.logic = mergeLogicDefaults(world.logic);
  }
  // §22.13 상수를 쓴다. 예전에는 리터럴이라 SCHEMA_VERSION을 올릴 때 같이 안 고치면
  // 로드된 세계가 구버전으로 되돌아가고, 라이브 세계와 상태가 갈렸다.
  if (from < 63) initializeFoodSupply(world);
  if (from < 64) world.season = seasonAt(world, world.worldTick);
  if (from < 65) for (const sim of world.sims) sim.needsTier ??= newNeedsTier();
  if (from < 66) initializeVillages(world);
  // §23.24 면역은 세이브에 없던 필드다. 0이면 '면역 없음'이라 옛 세계의 행동이 그대로 이어진다.
  if (from < 67) for (const sim of world.sims) sim.immuneUntil ??= 0;
  // Main also used schema68, but for counters rather than founding. Its saves
  // need the missing branch field even when their numeric version is already68.
  world.founding ??= newFoundingState();
  if (from < 69) initializeGovernments(world);
  if (from < 70) initializeMunicipalHistory(world);
  if (from < 71) initializeMunicipalWorks(world);
  if (from < 72) initializeMunicipalGrowth(world);
  // Both main68 and branch68..72 can arrive here; rebuild once from their actual
  // dictionaries. Never require a per-tick scan in moodBaseline.
  if (from < 73) for (const sim of world.sims) refreshMoodCounts(sim,world.logic);
  if (from < 74) initializeRail(world);
  world.worldEvents ??= []; // Also repair absent/null optional state in current-version saves.
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
