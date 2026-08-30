// Canonical 직렬화: 객체 키를 재귀적으로 사전순 정렬 — 삽입 순서 무관, 런타임 무관 (PLAN §2.5).
// 일반 JSON.stringify 직접 사용 금지.

function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
    return out;
  }
  return v;
}

export function serialize(world) {
  return JSON.stringify(canonicalize(world));
}

export function deserialize(str) {
  return JSON.parse(str);
}

// FNV-1a 32-bit, UTF-8 바이트 단위. Math.imul 필수 — 일반 곱셈은 2^53 초과로 정밀도 손실 (PLAN §2.5).
export function fnv1a(str) {
  const bytes = new TextEncoder().encode(str);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash = Math.imul(hash ^ bytes[i], 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function hashWorld(world) {
  return fnv1a(serialize(world));
}
