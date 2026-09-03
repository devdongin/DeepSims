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
// genesis = 세계를 만드는 중인가. 창세 때는 **누구를 뽑아도 된다** — 아직 아무의 생계도
// 시작되지 않았고, 우리는 이 열 사람이 누구인지를 고르는 중이다. 반면 굴러가는 마을에서
// 남의 직업을 바꾸는 것은 그 사람의 삶을 바꾸는 일이라 무직자만 뽑는다.
export function fillPublicPosts(world, emit = null, genesis = false) {
  let hired = 0;
  for (const occ of Object.keys(world.logic.economy.publicPosts ?? {})) {
    const quota = publicQuota(world, occ);
    let have = publicHeadcount(world, occ);
    if (have >= quota) continue;
    // §23.14 **무직자만 뽑는다** (Codex 지적, 재현됨: 인구 30명 전원이 office_worker인
    // 세계에서 무직자가 0명인데도 7명을 공공직으로 데려갔다). "무직 우선 정렬"은 민간
    // 인력을 보호하지 않는다 — 무직자가 모자라면 그냥 일하던 사람을 빼 온다.
    // 자리가 비는 편이 낫다. 채울 사람이 없다는 것 자체가 마을의 상태다.
    const cands = world.sims.filter((s) => {
      if (!occupationAllowed(occ, s.traits.age)) return false;
      if (s.traits.occupation === 'jobless') return true;
      if (!genesis) return false; // 굴러가는 마을에서는 일하는 사람을 빼 오지 않는다
      const o = s.traits.occupation;
      return o !== occ && o !== 'child' && o !== 'student' && o !== 'retired'
        && !world.logic.economy.publicPosts[o];
    });
    cands.sort((a, b) => (aptitudeFor(b, occ, world.logic) - aptitudeFor(a, occ, world.logic)) || (a.id - b.id));
    for (const s of cands) {
      if (have >= quota) break;
      const from = s.traits.occupation;
      s.traits.occupation = occ;
      s.unpaidDays = 0; // 새 자리에서 밀린 임금을 물려받지 않는다
      have++; hired++;
      if (emit) emit('job_changed', s.id, { from, to: occ, reason: 'public_post' });
    }
  }
  return hired;
}

// §23.14 정원을 넘긴 공공직을 **조금씩** 줄인다. 기존 세이브에는 정원제 이전에 뽑힌
// 공공직이 그대로 남아 국고를 계속 갉아먹는데(실측 49~51명), 한 해에 전부 자르면
// 마을이 하루아침에 뒤집힌다. 해마다 자리당 한 명씩, 적성이 가장 낮은 사람부터 내보낸다.
export function trimOverQuotaPosts(world, emit = null) {
  let trimmed = 0;
  for (const occ of Object.keys(world.logic.economy.publicPosts ?? {})) {
    const over = publicHeadcount(world, occ) - publicQuota(world, occ);
    if (over <= 0) continue;
    const holders = world.sims.filter((s) => s.traits.occupation === occ);
    holders.sort((a, b) => (aptitudeFor(a, occ, world.logic) - aptitudeFor(b, occ, world.logic)) || (a.id - b.id));
    const s = holders[0];
    if (!s) continue;
    const from = s.traits.occupation;
    demotePublicIfOverQuota(world, s);
    if (s.traits.occupation !== from) {
      s.unpaidDays = 0;
      trimmed++;
      if (emit) emit('job_changed', s.id, { from, to: s.traits.occupation, reason: 'over_quota' });
    }
  }
  return trimmed;
}
