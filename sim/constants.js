// 시뮬레이션 전역 상수. 전부 정수 — 시뮬레이션 내 부동소수점 금지 (PLAN §2).

export const SCHEMA_VERSION = 1;
export const PROTOCOL_VERSION = 1;

export const TICKS_PER_DAY = 1440;          // 1틱 = 게임 1분
export const TICK_DURATION_MS = 1000;       // 실시간 1초 = 게임 1분
export const MAX_CATCHUP_TICKS = 30 * TICKS_PER_DAY; // 30일 클램프 (PLAN §1)

export const NEED_MAX = 10000;
export const NEED_CRITICAL = 2000;          // 위급 오버라이드 임계 (PLAN §2.5.D)

// 욕구 감쇠량 / 틱
export const DECAY = { hunger: 6, energy: 4, social: 3, fun: 3 };

// 행동 enum — 배열 순서가 타이브레이크 순서 (PLAN §2)
export const ACTIONS = ['eat', 'sleep', 'work', 'socialize', 'play', 'idle'];

export const ACTION_DEFS = {
  eat:       { facility: 'cafe',  duration: 30,  recovers: 'hunger', recoverPerTick: 300, moneyDelta: -200 },
  sleep:     { facility: 'house', duration: 420, recovers: 'energy', recoverPerTick: 25,  moneyDelta: 0 },
  work:      { facility: 'office', duration: 240, recovers: null,    recoverPerTick: 0,   moneyDelta: 1200 },
  socialize: { facility: ['cafe', 'park'], duration: 60, recovers: 'social', recoverPerTick: 150, moneyDelta: 0 },
  play:      { facility: 'park',  duration: 60,  recovers: 'fun',    recoverPerTick: 150, moneyDelta: 0 },
  idle:      { facility: null,    duration: 5,   recovers: null,     recoverPerTick: 0,   moneyDelta: 0 },
};

export const WORK_START = 540;   // 09:00 (틱-of-day)
export const WORK_END = 1080;    // 18:00 — 시작 허용 창. 진행 중 근무는 넘겨도 계속(잔업)

// 점수 산식 (PLAN §2.5.G): 전 중간값 < 2^53 증명은 PLAN 참조
export const SCORE_SCALE = 100000; // 1e5

export const AFFINITY_MIN = -10000;
export const AFFINITY_MAX = 10000;
export const ARGUMENT_THRESHOLD = -3000;

export const EVENT_TYPES = [
  'action_started', 'action_completed', 'action_failed', 'input_rejected',
  'starving', 'lonely', 'argument', 'money_changed',
];
