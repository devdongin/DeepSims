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

// §22.13 해시 전용 인코딩 — **오라클에 구멍이 있으면 안 된다**.
//
// hashWorld가 serialize(=JSON.stringify) 위에 그대로 얹혀 있어서 NaN과 null,
// undefined와 "키 없음"을 구분하지 못했다. 그래서 플레이어 심의 groceries가 NaN이
// 된 세계와 재시작으로 null이 된 세계의 해시가 **같게 나왔고**, 테스트 177개가 전부
// 초록불인 채로 3000틱 뒤 국고가 115 vs 380으로 갈렸다 (플레이테스트 S2-1).
//
// **센티널 문자열로는 안 된다** (Codex 102차 ①). 값을 ' NaN' 같은 문자열로 바꾸면
// 세계 안의 진짜 문자열이 그걸 사칭해 오라클이 다시 눈이 먼다 — 고치려던 바로 그
// 부류의 버그를 다시 만드는 셈이다. 대신 **타입 태그 + 길이 접두** 인코딩을 쓴다:
// 모든 값이 자기 타입을 앞에 달고, 문자열과 키는 길이를 앞세워 구분자 모호성이 없다.
// 어떤 문자열도 다른 타입을 사칭할 수 없다.
//
// 지원 타입도 명시적으로 제한한다 (Codex 102차 ④). 상태에 있으면 안 되는 것
// (Date·Map·Set·함수)은 조용히 `{}`로 뭉개지지 않고 고유 태그를 받아 해시에 드러난다.
//
// serialize 자체는 건드리지 않는다 — 그쪽은 DB 저장 형식이라 바꾸면 스키마가 움직인다.
//
// 알려진 한계 (Codex 103차 ②): fnv1a는 32비트라 인코딩이 단사여도 해시는 결국 충돌한다.
// 이 오라클의 강도는 32비트가 상한이고, 그건 해시 함수의 성질이지 인코딩의 결함이 아니다.
function encodeForHash(v, out, seen) {
  if (v === null) { out.push('z'); return; }
  if (v === undefined) { out.push('u'); return; }      // JSON이 삼키는 값 ①
  const t = typeof v;
  if (t === 'boolean') { out.push(v ? 'T' : 'F'); return; }
  if (t === 'number') {
    if (Number.isNaN(v)) { out.push('N'); return; }      // ② NaN → null
    if (v === Infinity) { out.push('P'); return; }       // ③ Infinity → null
    if (v === -Infinity) { out.push('M'); return; }      // ④ -Infinity → null
    if (Object.is(v, -0)) { out.push('n-0'); return; }   // ⑤ -0 → 0
    out.push(`n${v}`); return;
  }
  // 문자열·키는 JSON.stringify로 이스케이프해 넣는다 (Codex 103차 ①).
  // 길이 접두만으로는 부족했다 — TextEncoder가 고립 서로게이트를 U+FFFD로 치환하므로
  // "\uD800"과 "�"가 같은 바이트열이 된다. JSON.stringify는 고립 서로게이트를
  // \ud800 이스케이프로 남기고(ES2019 well-formed), 따옴표로 자기 구분까지 한다.
  if (t === 'string') { out.push(`s${JSON.stringify(v)}`); return; }
  if (t === 'object') {
    // 순환 참조에서 무한 재귀하지 않는다 (Codex 103차 ④). 현재 세계에는 순환이 없지만,
    // 오라클이 스택 오버플로로 죽으면 그것도 눈이 먼 것이다.
    if (seen.has(v)) { out.push('!cycle'); return; }
    seen.add(v);
    if (Array.isArray(v)) {
      out.push(`a${v.length}[`);
      for (const x of v) encodeForHash(x, out, seen);
      out.push(']');
    } else {
      // 순수 객체만 o 태그를 받는다. Date·Map·Set은 Object.keys가 []라서
      // 예전 인코딩에서는 전부 같은 빈 객체로 보였다.
      const tag = Object.prototype.toString.call(v);
      if (tag !== '[object Object]') { out.push(`!${tag}`); seen.delete(v); return; }
      const keys = Object.keys(v).sort();
      out.push(`o${keys.length}{`);
      for (const k of keys) { out.push(`k${JSON.stringify(k)}`); encodeForHash(v[k], out, seen); }
      out.push('}');
    }
    seen.delete(v); // 형제 노드가 같은 객체를 참조해도 순환으로 오인하지 않는다
    return;
  }
  out.push(`!${t}`); // function·symbol·bigint — 상태에 있으면 안 된다
}

export function hashWorld(world) {
  const out = [];
  encodeForHash(world, out, new Set());
  return fnv1a(out.join(''));
}

// 직렬화가 삼키거나 뭉개는 값을 전부 찾아 경로와 함께 돌려준다.
// 해시가 갈린 뒤에 "어디가 문제냐"를 묻게 되므로, 그 답을 낼 도구를 같이 둔다.
export function findNonFinite(world, limit = 20) {
  const found = [];
  const seen = new Set(); // 순환 참조에서 죽지 않는다 (Codex 103차 ④)
  const odd = (v) => typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint';
  const walk = (v, p) => {
    if (found.length >= limit) return;
    if (v !== null && typeof v === 'object') {
      if (seen.has(v)) { found.push({ path: p, value: 'circular' }); return; }
      seen.add(v);
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
      else {
        const tag = Object.prototype.toString.call(v);
        if (tag !== '[object Object]') found.push({ path: p, value: tag });
        else for (const k of Object.keys(v)) walk(v[k], `${p}.${k}`);
      }
      seen.delete(v);
      return;
    }
    if (v === undefined) found.push({ path: p, value: 'undefined' });
    else if (typeof v === 'number' && !Number.isFinite(v)) found.push({ path: p, value: String(v) });
    else if (Object.is(v, -0)) found.push({ path: p, value: '-0' });
    else if (odd(v)) found.push({ path: p, value: typeof v });
  };
  walk(world, 'world');
  return found;
}
