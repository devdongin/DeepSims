// §23.13 공공 정원. 사용자 지적: "그럼 공무원이 너무 많은거지 / 인구수에 맞게 공무원수도
// 설계되어야지."
//
// 문제는 직업이 **인구와 무관하게** 뽑힌다는 것이었다. 실측: 인구 10명으로 시작한 마을의
// 직업 구성이 경찰 2·정치인 1·소방관 1·의사 1·공무원 1 — 열 명 중 여섯이 공공직이다.
// 공공 임금은 국고가 전액 보장하므로(§22.23) 국고는 1일차에 −10,766, 14일차에 −76,248로
// 곤두박질친다. 마을이 스스로를 감당할 수 없는 상태로 태어나는 셈이다.
//
// 그래서 자리마다 **인구 문턱과 1인당 인구 비율**을 둔다. 파출소는 스무 명 마을에 없고,
// 소방서는 서른 명은 되어야 생긴다. 도시가 자라면 자리도 따라 는다.
import { aptitudeFor } from './abilities.js';
import { OCCUPATIONS, occupationAllowed } from './traits.js';

function floorDiv(a, b) { return Math.floor(a / b); }

// 이 인구에서 그 자리가 몇 개인가. 문턱 미만이면 0 — "아직 그런 자리가 없는 마을"이다.
export function publicQuota(world, occ) {
  const spec = world.logic.economy.publicPosts?.[occ];
  if (!spec) return Infinity; // 표에 없는 자리는 정원 없음 (규칙을 모르면 막지 않는다)
  const pop = world.sims.length;
  if (pop < spec.minPop) return 0;
  return Math.max(1, floorDiv(pop, spec.per));
}

// 지금 그 자리에 몇 명이 있나 (self는 세지 않는다 — 자기 자리를 자기가 막지 않게)
export function publicHeadcount(world, occ, selfId = null) {
  let n = 0;
  for (const s of world.sims) {
    if (selfId !== null && s.id === selfId) continue;
    if (s.traits.occupation === occ) n++;
  }
  return n;
}

export function publicPostAvailable(world, occ, selfId = null) {
  return publicHeadcount(world, occ, selfId) < publicQuota(world, occ);
}

// 정원을 넘은 공공직을 민간직으로 돌린다. **rng를 쓰지 않는다** — 적성이 가장 높은
// 자리로 보내고, 같으면 OCCUPATIONS 순서로 끊는다. 그래야 세이브를 다시 읽어도 같다.
export function demotePublicIfOverQuota(world, sim) {
  const occ = sim.traits.occupation;
  if (!world.logic.economy.publicPosts?.[occ]) return false;
  if (publicPostAvailable(world, occ, sim.id)) return false;
  let best = null, bestApt = -1;
  for (const o of OCCUPATIONS) {
    if (world.logic.economy.publicPosts?.[o]) continue;      // 다른 공공직으로 도망가지 않는다
    if (o === 'child' || o === 'student' || o === 'retired' || o === 'jobless') continue;
    if (!occupationAllowed(o, sim.traits.age)) continue;
    if (!world.logic.workplace[o]) continue;
    const apt = aptitudeFor(sim, o, world.logic);
    if (apt > bestApt) { bestApt = apt; best = o; }
  }
  sim.traits.occupation = best ?? 'jobless';
  return true;
}

// 정원은 **상한이자 필요 인원**이다. 상한만 두면 아무도 안 뽑힌 마을이 생긴다 —
// 실제로 정원제를 넣자마자 공공직이 0명인 세계가 나왔고(S-60), 그건 경찰도 의사도
// 없는 마을이다. 그래서 빈 자리는 채운다. 적성이 가장 높은 사람을 쓰고, 같으면 id로
// 끊는다. rng를 쓰지 않는다.
export function fillPublicPosts(world) {
  let hired = 0;
  for (const occ of Object.keys(world.logic.economy.publicPosts ?? {})) {
    const quota = publicQuota(world, occ);
    let have = publicHeadcount(world, occ);
    if (have >= quota) continue;
    const cands = world.sims.filter((s) => {
      const o = s.traits.occupation;
      if (o === occ) return false;
      if (o === 'child' || o === 'student' || o === 'retired') return false;
      if (world.logic.economy.publicPosts[o]) return false; // 다른 공공직을 빼내 오지 않는다
      if (!occupationAllowed(occ, s.traits.age)) return false;
      return true;
    });
    // 무직 우선 — 놀고 있는 사람이 있는데 일하는 사람을 빼 오는 것은 마을에 손해다.
    cands.sort((a, b) => {
      const ja = a.traits.occupation === 'jobless' ? 0 : 1;
      const jb = b.traits.occupation === 'jobless' ? 0 : 1;
      if (ja !== jb) return ja - jb;
      const d = aptitudeFor(b, occ, world.logic) - aptitudeFor(a, occ, world.logic);
      return d || (a.id - b.id);
    });
    for (const s of cands) {
      if (have >= quota) break;
      s.traits.occupation = occ;
      have++; hired++;
    }
  }
  return hired;
}
