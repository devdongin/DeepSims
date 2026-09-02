// 구조적 상수 — 수치 튜너블은 전부 world.logic (sim/logic.js, PLAN §14.1).

export const SCHEMA_VERSION = 44; // §22.16 성씨 한글 단위 합산 재계산
export const PROTOCOL_VERSION = 1;

export const TICKS_PER_DAY = 1440;          // 1틱 = 게임 1분
export const TICK_DURATION_MS = 1000;       // 실시간 1초 = 게임 1분
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
  'read', 'shop', 'fish', 'cook_eat', 'construct', 'see_doctor', 'respond_fire'];
export const COPING_ACTIONS = ['drink', 'binge_eat', 'hole_up', 'exercise'];
export const HOME_ONLY_ACTIONS = ['hole_up', 'build', 'cook_eat']; // 자기 집 시설만 후보

// 행동 → 시설 타입 (구조), 행동 → 회복 욕구 (구조)
export const ACTION_FACILITY = {
  eat: ['cafe', 'restaurant'], sleep: ['house', 'apartment'], work: ['office'],
  socialize: ['cafe', 'park'], idle: [],
  drink: ['bar'], binge_eat: ['cafe', 'restaurant'], hole_up: ['house', 'apartment'], exercise: ['park', 'gym'], build: ['house'],
  read: ['library'], shop: ['market', 'mall'], fish: ['pond'], cook_eat: ['house', 'apartment'],
  play: ['park', 'cinema', 'mall'],
  construct: [], // 가상 현장(site) — collectCandidates 특수 경로 (§16.5.B)
  see_doctor: ['hospital'],
};
export const NEED_OF_ACTION = { eat: 'hunger', sleep: 'energy', socialize: 'social', play: 'fun', read: 'fun', fish: 'fun', cook_eat: 'hunger' };

// 점수 산식 (PLAN §2.5.G): 전 중간값 < 2^53 증명은 PLAN 참조
export const SCORE_SCALE = 100000; // 1e5

export const AFFINITY_MIN = -10000;
export const AFFINITY_MAX = 10000;

export const EVENT_TYPES = [
  'action_started', 'action_completed', 'action_failed', 'input_rejected',
  'starving', 'lonely', 'argument', 'money_changed', 'welfare_paid', 'wage_shortfall', 'money_shared', 'job_changed', 'died', 'bereaved', 'grew_up', 'public_revenue_remitted', 'invited', 'invite_declined', 'invite_fulfilled', 'invite_expired', 'side_talk', 'fire_started', 'fire_out', 'heroic_save', 'policy_changed', 'zoned', 'city_promoted', 'item_reported', 'item_returned', 'car_bought', 'petition',
  'player_created', 'logic_changed', 'relationship_changed',
  'token_created', 'gathering', 'conversation', 'greeting',
  'road_formed', 'bed_built', 'hangover',
  'item_spawned', 'item_found', 'weather_changed', 'fish_caught',
  'project_started', 'facility_built', 'moved_home',
  'immigrated', 'fell_sick', 'recovered', 'election', 'started_dating', 'married', 'broke_up',
  'joined_club', 'mayor_stipend', 'new_year', 'graduated', 'retired_now', 'festival', 'child_settled',
];

export const COMMANDS = ['assign', 'create_player', 'logic_update', 'announce'];

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
