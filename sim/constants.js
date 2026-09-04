// 구조적 상수 — 수치 튜너블은 전부 world.logic (sim/logic.js, PLAN §14.1).

export const SCHEMA_VERSION = 76; // Persist physical employer and failed-search retry state.
export const PROTOCOL_VERSION = 1;

export const TICKS_PER_DAY = 1440;          // 1틱 = 게임 1분
// §23.42 하루를 실제 10분으로. 사용자 지적: "무언가 하는 14분(스타듀밸리)과 아무것도
// 안 하고 24분은 사용자가 재미를 느끼기엔 차이가 너무 난다."
// 스타듀는 하루(6시~새벽 2시, 20시간)가 실제 14분이고 그 14분 내내 플레이어가 무언가를
// 한다. 이쪽은 보는 게임이라 같은 24분이 훨씬 길게 느껴진다.
//   1440틱 × 417ms = 600,480ms ≈ 10.0분
// 이 값은 **관람 속도만** 정한다 — computeTarget이 벽시계를 목표 틱으로 옮길 때만 쓰고,
// 시뮬레이션에는 들어가지 않는다(결정성 무관, sim/time.js 전수 확인).
export const TICK_DURATION_MS = 417;        // 실시간 417ms = 게임 1분 → 하루 10분
// §22.1 따라잡기 클램프. 예전엔 게임 30일이었는데, 속도 ×48에서는 **실시간 15분**만
// 자리를 비워도 세계가 잘렸다(30일 × 1440틱 ÷ 48틱/초 = 900초). 관람 배속이 오르면
// 클램프가 실질적으로 조여지는 구조였다.
// 게임 2년치(240일)로 올린다 — ×48에서 실시간 2시간 부재까지 버리지 않고 따라잡는다.
// 계산 비용은 벤치 15,665틱/초 기준 345,600틱 ≈ 22초이고, catchUp이 1일 배치마다
// yield하므로 이벤트 루프를 막지 않는다 (89차 ①).
export const MAX_CATCHUP_TICKS = 240 * TICKS_PER_DAY;

export const NEED_MAX = 10000;

// 행동 enum — 배열 순서가 타이브레이크 순서 (PLAN §2). 확장은 뒤에 append.
// 확장은 뒤에 append (기존 타이브레이크 순서 보존). drink~build는 §15.1 로드맵 행동.
export const ACTIONS = ['eat', 'sleep', 'work', 'socialize', 'play', 'idle',
  'drink', 'binge_eat', 'hole_up', 'exercise', 'build',
  'read', 'shop', 'fish', 'cook_eat', 'construct', 'see_doctor', 'respond_fire', 'study', 'seek_food_aid',
  'escort_child_doctor',
  // §23.8 여가 확대. 배열 순서는 pickBest의 동점 처리 순서라 **끝에만 붙인다**.
  // 마을에 할 일이 여덟 가지뿐이면 사람들은 여덟 가지 삶만 산다.
  'stroll', 'garden', 'music', 'volunteer', 'board_game', 'supply_groceries', 'grow_groceries', 'stock_food', 'visit_culture', 'settle_village'];
export const COPING_ACTIONS = ['drink', 'binge_eat', 'hole_up', 'exercise'];
export const HOME_ONLY_ACTIONS = ['hole_up', 'build', 'cook_eat', 'garden', 'music', 'grow_groceries']; // 자기 집 시설만 후보

// 행동 → 시설 타입 (구조), 행동 → 회복 욕구 (구조)
export const ACTION_FACILITY = {
  seek_food_aid: ['city_hall', 'market'],
  study: ['primary_school', 'middle_school', 'high_school', 'university'],
  eat: ['cafe', 'restaurant'], sleep: ['house', 'apartment'], work: ['office'],
  socialize: ['cafe', 'park'], idle: [],
  drink: ['bar'], binge_eat: ['cafe', 'restaurant'], hole_up: ['house', 'apartment'], exercise: ['park', 'gym'], build: ['house'],
  read: ['library'], shop: ['market', 'mall'], fish: ['pond'], cook_eat: ['house', 'apartment'],
  play: ['park', 'cinema', 'mall'],
  construct: [], // 가상 현장(site) — collectCandidates 특수 경로 (§16.5.B)
  see_doctor: ['hospital'],
  escort_child_doctor: [],
  settle_village: [],
  // §23.8 여가 확대
  stroll: ['park', 'pond'],           // 돈이 한 푼도 안 드는 유일한 즐거움
  garden: ['house', 'apartment'],     // 텃밭 — 먹거리가 나온다
  music: ['house', 'apartment'],      // 악기 — 손이 는다
  volunteer: ['hospital', 'library'], // 봉사 — 마을 평판이 오른다
  board_game: ['cafe'],               // 보드게임 — 카페의 두 번째 쓸모
  supply_groceries: ['market', 'mall'],
  grow_groceries: ['house', 'apartment'],
  stock_food: ['market', 'mall'],
  visit_culture: ['library', 'cinema'],
};
export const NEED_OF_ACTION = { eat: 'hunger', sleep: 'energy', socialize: 'social', play: 'fun', read: 'fun', fish: 'fun', cook_eat: 'hunger', seek_food_aid: 'hunger',
  stroll: 'fun', garden: 'fun', music: 'fun', volunteer: 'social', board_game: 'fun' };
// 보드게임을 '사교'로 두면 같은 카페에서 대화와 정면 충돌한다. 점수는 욕구 결핍으로
// 정해지므로 성격 계수만으로 승부가 갈리고, 외향형이 수다 대신 보드게임만 하게 된다.
// 이 마을의 심장은 대화다 — 보드게임은 재미를 채우고, 사교는 그 자리에서 따라온다.

// 점수 산식 (PLAN §2.5.G): 전 중간값 < 2^53 증명은 PLAN 참조
export const SCORE_SCALE = 100000; // 1e5

export const AFFINITY_MIN = -10000;
export const AFFINITY_MAX = 10000;

export const EVENT_TYPES = [
  'world_event_started', 'world_event_expired',
  'action_started', 'action_completed', 'action_failed', 'input_rejected',
  'starving', 'lonely', 'argument', 'money_changed', 'welfare_paid', 'wage_shortfall', 'money_shared', 'job_changed', 'died', 'emigrated', 'bereaved', 'grew_up', 'public_revenue_remitted', 'invited', 'invite_declined', 'invite_fulfilled', 'invite_expired', 'side_talk', 'helped', 'treasury_debt', 'insolvent', 'public_works', 'station_unlocked', 'fire_started', 'fire_out', 'heroic_save', 'policy_changed', 'zoned', 'city_promoted', 'item_reported', 'item_returned', 'car_bought', 'petition',
  'player_created', 'logic_changed', 'relationship_changed',
  'token_created', 'gathering', 'conversation', 'greeting',
  'road_formed', 'bed_built', 'hangover',
  'item_spawned', 'item_found', 'weather_changed', 'fish_caught',
  'project_started', 'facility_built', 'moved_home', 'center_planned',
  'immigrated', 'fell_sick', 'recovered', 'election', 'started_dating', 'married', 'broke_up',
  'joined_club', 'mayor_stipend', 'new_year', 'graduated', 'retired_now', 'festival', 'child_settled',
  // §22.91 인도 형성 — 병합된 §117 인도 기능이 emit하는데 등록이 빠져 저장 계층이
  // 거부했다(테스트 16c: 'unregistered event type'). append-only 규약대로 끝에 붙인다.
  'sidewalk_formed',
  'road_requested', 'road_work_planned',
  'ability_changed',
  'genius_born',
  'education_decided', 'school_enrolled',
  'school_planned',
  'public_meal_taken',
  'industry_unlocked',
  'medical_visit_paid',
  'child_allowance_paid',
  'child_escorted',
  'household_intent_created',
  'household_intent_applied',
  'household_intent_failed',
  'public_posts_filled', // §23.13 인구에 맞춰 공공 자리를 채웠다
  'rent_paid',
  'rent_shortfall',
  'storyteller_decision',
  'supply_ordered', 'supply_delivered', 'supply_capitalized', 'goods_purchased', 'goods_produced',
  'season_changed',
  'needs_tier_changed',
  'founding_petition_created', 'founding_petition_withdrawn',
  'founding_approved', 'founding_rejected',
  'founding_funded', 'founding_cancelled', 'founding_homes_built',
  'founding_gathering', 'founding_departed', 'village_founded',
  'plot_relocated', 'construction_relocation_deferred',
  'household_migration_gathering', 'household_migration_departed',
  'employment_construction_planned', 'village_land_assigned',
  'rail_opened', 'rail_cancelled', 'rail_suspended', 'rail_resumed',
  'rail_alighted', 'rail_boarded',
  'employment_started', 'employment_ended',
];

export const COMMANDS = ['assign', 'create_player', 'logic_update', 'announce', 'plan_center'];

export const OUTDOOR_FACILITIES = ['park', 'pond']; // 비 날씨 페널티 대상 (§16.D)

// §17.6 고정 동아리 (구조 — 코드 단일 권위)
export const CLUBS = [
  { id: 'book_club', habitKey: 'read:library', name: 'book' },
  { id: 'fishing_club', habitKey: 'fish:pond', name: 'fishing' },
  { id: 'fitness_club', habitKey: 'exercise:park', name: 'fitness' },
  { id: 'drinking_pals', habitKey: 'drink:bar', name: 'drink' },
];
// 주간 모임: (dayOfWeek, tod, placeId) — day % 7
export const CLUB_MEETINGS = {
  book_club: { dow: 2, tod: 1200, placeId: 'library' },
  fishing_club: { dow: 6, tod: 600, placeId: 'pond' },
  fitness_club: { dow: 4, tod: 1140, placeId: 'park' },
  drinking_pals: { dow: 5, tod: 1260, placeId: 'bar' },
};
