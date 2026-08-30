// 판단 로직 파라미터 (PLAN §14.1) — 공식의 구조는 코드, 수치는 이 파라미터.
// world.logic에 전문이 직렬화되며, logic_update 입력으로만 교체된다.
import { fnv1a } from './serialize.js';

// v1 등가 + Phase 2 기본값. logic/params.json의 초기 내용이기도 하다.
export const DEFAULT_LOGIC = {
  logicSchemaVersion: 2,
  decay: { hunger: 6, energy: 4, social: 3, fun: 3 },
  ageDecay: { youngMax: 29, youngFunAdd: 2, oldMin: 60, oldEnergyAdd: 2 },
  actions: {
    eat: { duration: 30, recoverPerTick: 300, cost: 200 },
    sleep: { duration: 420, recoverPerTick: 25 },
    work: { duration: 240, wageBase: 1200 },
    socialize: { duration: 60, recoverPerTick: 150 },
    play: { duration: 60, recoverPerTick: 150 },
    idle: { duration: 5 },
  },
  occupations: {
    office_worker: { workStart: 540, workEnd: 1080, wagePct: 100, startMoney: 1000 },
    barista: { workStart: 420, workEnd: 960, wagePct: 90, startMoney: 1000 },
    freelancer: { workStart: 0, workEnd: 1440, wagePct: 80, startMoney: 1000 },
    student: { workStart: 840, workEnd: 1200, wagePct: 50, startMoney: 500 },
    retired: { workStart: -1, workEnd: -1, wagePct: 0, startMoney: 3000 },
  },
  persFactor: { socializeBase: 150, playBase: 100, workBase: 150 },
  affinity: {
    tfScaleBase: 50, argumentBase: -3000, argumentTfCoef: 20,
    argClampMin: -5000, argClampMax: -1000, deltaMin: -20, deltaSpan: 61,
  },
  mood: {
    argument: -800, lonely: -400, starving: -1000, actionCompleted: 50, moneyGain: 100,
    decayPerTick: 5, lethargyThreshold: -5000, reliefScale: 25000000, lethargyScale: 50000000,
  },
  needCritical: 2000,
  // Phase 3 (logicSchemaVersion 2): 기억·회고·관계 티어 (PLAN §2.5 B/C/E + D2 델타)
  memory: {
    cap: 256, topK: 8,
    importance: {
      argument: 8, starving: 8, party_info: 7, relationship_changed: 6,
      lonely: 4, work_done: 3, meal: 2, small_talk: 1, play_time: 1,
    },
    recencyLut: [1000, 820, 670, 550, 450, 370, 300, 250, 200, 165, 135, 110, 90, 74, 60, 50],
    wRecency: 2, wImportance: 100, relevancePer: 100, relevanceCap: 4,
    posScale: 2000000000, negScale: 4000000000, // 기여 = ±importance×(1+overlap)×scale, 합계는 §G ±5e11 클램프
  },
  social: {
    friendAffinity: 3000, friendInteractions: 60,
    rivalAffinity: -2000, rivalInteractions: 30,
    acquaintanceInteractions: 15,
    friendStateBonus: 150000000000,   // stateMod: 친구가 그 시설에 있으면 (±2.5e11 클램프)
    rivalStatePenalty: 200000000000,  // 라이벌이 있으면 감점 (양수로 저장, 적용 시 부호)
    reflectionMoodScale: 60,          // pendingMood = clamp(Σ 부호 importance × scale, ±10000)
    habitIncrement: 10000000000,      // 회고당(=하루당) 습관 증가 상한 (PLAN §G: 1e10/일)
    habitCap: 250000000000,           // 행동당 habitMod 상한 (PLAN §G: 2.5e11)
    habitMinRepeats: 3,               // 같은 행동×시설 반복 임계
  },
};

// 부호가 음(불쾌)인 기억 종류 — memoryMod·pendingMood 계산에 사용 (구조, 코드 고정)
export const NEGATIVE_MEMORY_KINDS = ['argument', 'starving', 'lonely'];

// 구버전 world.logic에 새 섹션의 기본값을 결정적으로 병합 (마이그레이션 전용)
export function mergeLogicDefaults(oldLogic) {
  const merged = structuredClone(DEFAULT_LOGIC);
  const copy = (dst, src) => {
    for (const k of Object.keys(dst)) {
      if (!(k in src)) continue;
      if (typeof dst[k] === 'object' && dst[k] !== null && !Array.isArray(dst[k])) copy(dst[k], src[k] ?? {});
      else dst[k] = src[k];
    }
  };
  copy(merged, oldLogic ?? {});
  merged.logicSchemaVersion = DEFAULT_LOGIC.logicSchemaVersion;
  return merged;
}

export function logicHash(params) {
  return fnv1a(JSON.stringify(sortKeys(params)));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

// 검증 (PLAN §14.1): DEFAULT_LOGIC과 키 구조 동일(미지 키 거부·누락 거부),
// 전 수치 safe integer + [-1e12, 1e12], logicSchemaVersion 일치, UTF-8 ≤ 8KB.
export function validateLogic(params) {
  const errors = [];
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return { ok: false, errors: ['params는 객체여야 함'] };
  }
  const json = JSON.stringify(params);
  if (Buffer.byteLength(json, 'utf8') > 8192) errors.push('params 전문 > 8KB');
  if (params.logicSchemaVersion !== DEFAULT_LOGIC.logicSchemaVersion) {
    errors.push(`logicSchemaVersion 불일치 (기대 ${DEFAULT_LOGIC.logicSchemaVersion})`);
  }
  checkShape(DEFAULT_LOGIC, params, '', errors);
  if (errors.length === 0) checkRanges(params, errors);
  return { ok: errors.length === 0, errors };
}

// 공식·상태 불변식에서 유도한 필드별 시맨틱 범위 (PLAN §14.1 검증 계약).
// 상한은 §2.5.G 점수 경계 증명(2^53)과 §G moodMod 슬롯(±2.5e11)이 유지되도록 잡았다.
function checkRanges(p, errors) {
  const inRange = (path, v, lo, hi) => {
    if (v < lo || v > hi) errors.push(`범위 위반: ${path}=${v} (허용 ${lo}~${hi})`);
  };
  for (const [k, v] of Object.entries(p.decay)) inRange(`decay.${k}`, v, 0, 1000);
  inRange('ageDecay.youngMax', p.ageDecay.youngMax, 15, 90);
  inRange('ageDecay.oldMin', p.ageDecay.oldMin, 15, 91);
  inRange('ageDecay.youngFunAdd', p.ageDecay.youngFunAdd, 0, 100);
  inRange('ageDecay.oldEnergyAdd', p.ageDecay.oldEnergyAdd, 0, 100);
  for (const [a, def] of Object.entries(p.actions)) {
    inRange(`actions.${a}.duration`, def.duration, 1, 10000);
    if ('recoverPerTick' in def) inRange(`actions.${a}.recoverPerTick`, def.recoverPerTick, 0, 10000);
    if ('cost' in def) inRange(`actions.${a}.cost`, def.cost, 0, 1000000);
    if ('wageBase' in def) inRange(`actions.${a}.wageBase`, def.wageBase, 0, 1000000);
  }
  for (const [o, occ] of Object.entries(p.occupations)) {
    inRange(`occupations.${o}.wagePct`, occ.wagePct, 0, 1000);
    inRange(`occupations.${o}.startMoney`, occ.startMoney, 0, 1000000);
    inRange(`occupations.${o}.workStart`, occ.workStart, -1, 1440);
    inRange(`occupations.${o}.workEnd`, occ.workEnd, -1, 1440);
    if (occ.wagePct > 0 && occ.workStart >= occ.workEnd) {
      errors.push(`occupations.${o}: workStart >= workEnd인데 근무 가능(wagePct>0)`);
    }
  }
  inRange('persFactor.socializeBase', p.persFactor.socializeBase, 0, 300);
  inRange('persFactor.playBase', p.persFactor.playBase, 0, 300);
  inRange('persFactor.workBase', p.persFactor.workBase, 0, 300);
  inRange('affinity.tfScaleBase', p.affinity.tfScaleBase, 0, 200);
  inRange('affinity.deltaSpan', p.affinity.deltaSpan, 1, 10000);   // rngInt(s, 0) 방지
  inRange('affinity.deltaMin', p.affinity.deltaMin, -10000, 10000);
  inRange('affinity.argumentBase', p.affinity.argumentBase, -10000, 0);
  inRange('affinity.argumentTfCoef', p.affinity.argumentTfCoef, 0, 200);
  inRange('affinity.argClampMin', p.affinity.argClampMin, -10000, 0);
  inRange('affinity.argClampMax', p.affinity.argClampMax, -10000, 0);
  if (p.affinity.argClampMin > p.affinity.argClampMax) errors.push('affinity: argClampMin > argClampMax');
  for (const k of ['argument', 'lonely', 'starving', 'actionCompleted', 'moneyGain']) {
    inRange(`mood.${k}`, p.mood[k], -10000, 10000);
  }
  inRange('mood.decayPerTick', p.mood.decayPerTick, 0, 1000);
  inRange('mood.lethargyThreshold', p.mood.lethargyThreshold, -10000, 0);
  inRange('mood.reliefScale', p.mood.reliefScale, 0, 25000000);     // 10000×scale ≤ 2.5e11 (§G)
  inRange('mood.lethargyScale', p.mood.lethargyScale, 0, 50000000); // 5000×scale ≤ 2.5e11 (§G)
  inRange('needCritical', p.needCritical, 0, 10000);
  // Phase 3 섹션
  inRange('memory.cap', p.memory.cap, 16, 1024);
  inRange('memory.topK', p.memory.topK, 1, 32);
  for (const [k, v] of Object.entries(p.memory.importance)) inRange(`memory.importance.${k}`, v, 1, 10);
  for (let i = 0; i < p.memory.recencyLut.length; i++) inRange(`memory.recencyLut[${i}]`, p.memory.recencyLut[i], 0, 10000);
  inRange('memory.wRecency', p.memory.wRecency, 0, 100);
  inRange('memory.wImportance', p.memory.wImportance, 0, 1000);
  inRange('memory.relevancePer', p.memory.relevancePer, 0, 1000);
  inRange('memory.relevanceCap', p.memory.relevanceCap, 0, 16);
  inRange('memory.posScale', p.memory.posScale, 0, 5000000000);   // 합계가 §G ±5e11 내로 클램프 가능
  inRange('memory.negScale', p.memory.negScale, 0, 5000000000);
  inRange('social.friendAffinity', p.social.friendAffinity, 0, 10000);
  inRange('social.rivalAffinity', p.social.rivalAffinity, -10000, 0);
  inRange('social.friendInteractions', p.social.friendInteractions, 0, 1000000);
  inRange('social.rivalInteractions', p.social.rivalInteractions, 0, 1000000);
  inRange('social.acquaintanceInteractions', p.social.acquaintanceInteractions, 0, 1000000);
  inRange('social.friendStateBonus', p.social.friendStateBonus, 0, 250000000000);
  inRange('social.rivalStatePenalty', p.social.rivalStatePenalty, 0, 250000000000);
  inRange('social.reflectionMoodScale', p.social.reflectionMoodScale, 0, 1000);
  inRange('social.habitIncrement', p.social.habitIncrement, 0, 10000000000);
  inRange('social.habitCap', p.social.habitCap, 0, 250000000000);
  inRange('social.habitMinRepeats', p.social.habitMinRepeats, 1, 100);
}

function checkShape(ref, val, path, errors) {
  const refKeys = Object.keys(ref).sort();
  const valKeys = Object.keys(val ?? {}).sort();
  for (const k of refKeys) {
    if (!(k in (val ?? {}))) { errors.push(`누락 키: ${path}${k}`); continue; }
    const r = ref[k], v = val[k];
    if (typeof r === 'number') {
      if (!Number.isSafeInteger(v)) errors.push(`정수 아님: ${path}${k}=${v}`);
      else if (Math.abs(v) > 1e12) errors.push(`범위 초과: ${path}${k}=${v}`);
    } else if (Array.isArray(r)) {
      if (!Array.isArray(v) || v.length !== r.length) errors.push(`배열 길이 불일치: ${path}${k}`);
      else for (let i = 0; i < v.length; i++) {
        if (!Number.isSafeInteger(v[i])) errors.push(`정수 아님: ${path}${k}[${i}]`);
      }
    } else if (typeof r === 'object' && r !== null) {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) errors.push(`객체 아님: ${path}${k}`);
      else checkShape(r, v, `${path}${k}.`, errors);
    }
  }
  for (const k of valKeys) {
    if (!(k in ref)) errors.push(`미지 키: ${path}${k}`);
  }
}
