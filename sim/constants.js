// 구조적 상수 — 수치 튜너블은 전부 world.logic (sim/logic.js, PLAN §14.1).

export const SCHEMA_VERSION = 5;
export const PROTOCOL_VERSION = 1;

export const TICKS_PER_DAY = 1440;          // 1틱 = 게임 1분
export const TICK_DURATION_MS = 1000;       // 실시간 1초 = 게임 1분
export const MAX_CATCHUP_TICKS = 30 * TICKS_PER_DAY; // 30일 클램프 (PLAN §1)

export const NEED_MAX = 10000;

// 행동 enum — 배열 순서가 타이브레이크 순서 (PLAN §2). 확장은 뒤에 append.
export const ACTIONS = ['eat', 'sleep', 'work', 'socialize', 'play', 'idle'];

// 행동 → 시설 타입 (구조), 행동 → 회복 욕구 (구조)
export const ACTION_FACILITY = {
  eat: ['cafe'], sleep: ['house'], work: ['office'],
  socialize: ['cafe', 'park'], play: ['park'], idle: [],
};
export const NEED_OF_ACTION = { eat: 'hunger', sleep: 'energy', socialize: 'social', play: 'fun' };

// 점수 산식 (PLAN §2.5.G): 전 중간값 < 2^53 증명은 PLAN 참조
export const SCORE_SCALE = 100000; // 1e5

export const AFFINITY_MIN = -10000;
export const AFFINITY_MAX = 10000;

export const EVENT_TYPES = [
  'action_started', 'action_completed', 'action_failed', 'input_rejected',
  'starving', 'lonely', 'argument', 'money_changed',
  'player_created', 'logic_changed', 'relationship_changed',
  'token_created', 'gathering', 'conversation', 'greeting',
];

export const COMMANDS = ['assign', 'create_player', 'logic_update', 'announce'];
