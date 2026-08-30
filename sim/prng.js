// mulberry32 — 상태는 world 안의 {state: uint32}. 정수 출력만 사용 (PLAN §2).

export function makeRng(seed) {
  return { state: seed >>> 0 };
}

// uint32 반환, s.state를 전진시킨다
export function rngNext(s) {
  s.state = (s.state + 0x6d2b79f5) >>> 0;
  let t = s.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
  return (t ^ (t >>> 14)) >>> 0;
}

// [0, n) 정수
export function rngInt(s, n) {
  return rngNext(s) % n;
}
