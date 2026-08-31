// 특성 (PLAN §12/12.1): 성별·나이·MBTI·직업. 생성 순서 고정 — gender → age → mbti 4축 → occupation.
import { makeRng, rngInt } from './prng.js';

export const GENDERS = ['F', 'M', 'X'];
export const OCCUPATIONS = [
  'office_worker', 'barista', 'freelancer', 'student', 'retired',
  'doctor', 'civil_servant', 'teacher',            // §17.2 (풀 누락 버그 수리 — §17.13)
  'police', 'firefighter', 'nurse', 'politician',  // §17.13 신규
];
export const MBTI_AXES = ['EI', 'SN', 'TF', 'JP'];

// rng를 소비하며 특성 생성 (worldgen 또는 마이그레이션 임시 rng)
export function generateTraits(rng) {
  const gender = GENDERS[rngInt(rng, 3)];
  // §17.13 현실적 연령 피라미드 (드로우 2회 고정: 구간 → 오프셋): 15-25 15% / 26-45 45% /
  // 46-64 25% / 65-90 15% — 균등 15~90(구버전)은 40%가 60세+로 은퇴 쏠림.
  const band = rngInt(rng, 100);
  const off = rngInt(rng, 26);
  let age;
  if (band < 15) age = 15 + (off % 11);
  else if (band < 60) age = 26 + (off % 20);
  else if (band < 85) age = 46 + (off % 19);
  else age = 65 + off;
  const mbti = {};
  for (const axis of MBTI_AXES) mbti[axis] = rngInt(rng, 101); // 0~100
  const eligible = OCCUPATIONS.filter((o) => occupationAllowed(o, age));
  const occupation = eligible[rngInt(rng, eligible.length)];
  return { gender, age, mbti, occupation };
}

export function occupationAllowed(occupation, age) {
  if (occupation === 'retired') return age >= 60;
  if (occupation === 'student') return age <= 25;
  if (occupation === 'doctor' || occupation === 'politician') return age >= 26 && age < 60;
  if (['police', 'firefighter', 'nurse'].includes(occupation)) return age >= 20 && age < 60;
  return true;
}

// 마이그레이션용 결정적 특성 (PLAN §12.1: 임시 rng, 월드 rng 비소비)
export function migrationTraits(seed, simId) {
  return generateTraits(makeRng((seed ^ simId) >>> 0));
}

export function validateTraits(t) {
  if (t === null || typeof t !== 'object' || Array.isArray(t)) return '특성이 객체가 아님';
  if (!GENDERS.includes(t.gender)) return '성별 오류';
  if (!Number.isSafeInteger(t.age) || t.age < 15 || t.age > 90) return '나이 범위(15~90) 오류';
  if (t.mbti === null || typeof t.mbti !== 'object' || Array.isArray(t.mbti)) return 'MBTI 오류';
  for (const axis of MBTI_AXES) {
    const v = t.mbti[axis];
    if (!Number.isSafeInteger(v) || v < 0 || v > 100) return `MBTI ${axis} 범위(0~100) 오류`;
  }
  if (Object.keys(t.mbti).length !== 4) return 'MBTI 축 수 오류';
  if (!OCCUPATIONS.includes(t.occupation)) return '직업 오류';
  if (!occupationAllowed(t.occupation, t.age)) return '나이-직업 제약 위반';
  return null;
}

export function mbtiString(mbti) {
  return (mbti.EI < 50 ? 'E' : 'I') + (mbti.SN < 50 ? 'S' : 'N')
    + (mbti.TF < 50 ? 'T' : 'F') + (mbti.JP < 50 ? 'J' : 'P');
}
