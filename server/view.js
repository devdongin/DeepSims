// §22.8 클라이언트 전송용 심 투영 (렌더링 성능 — 사용자 지시로 감사).
//
// 문제: tickBatch와 snapshot이 **심 객체 전체**를 보내고 있었다. 라이브 실측(인구 57):
//   전체 전송  1,748KB — 심당 31,401B (그중 memories가 심당 약 35KB)
//   실제 필요     25KB — 심당    445B
// 즉 클라이언트가 그리는 데 쓰지도 않는 데이터를 **71배** 더 받고 있었다.
// 인구 200·배속 ×48에서는 24MB/s가 된다 — 대목표 G2(인구 200)와 G6(성능)이 여기서 먼저 무너진다.
//
// 클라이언트가 실제로 읽는 필드는 아래가 전부다(client/main.js 전수 확인):
//   id · name · x · y · state · needs · mood · money · sick · hasCar · isPlayer · traits
// memories/relTiers/habit/plan/knownTokens/abilities/complaintDays/noPathCool/
// sharedTo/approachedTo/hungerZeroTicks/groceries/patrolIdx/invitedTo 는 한 곳도 쓰지 않는다.
//
// 이건 **전송 계층만의 변화**다 — 시뮬 상태·결정성·리플레이는 그대로다.
// 새 필드가 화면에 필요해지면 여기에 한 줄 추가하면 된다.
// §23.39 **안 바뀌는 것을 250ms마다 다시 보내지 않는다.**
// 배치 payload 185KB 중 이름·성·특성·능력치·잠재치·학력이 약 110KB(59%)인데, 이것들은
// 나이 먹는 날이나 전직할 때만 바뀐다. 클라이언트마다 마지막으로 보낸 정적 부분의 키를
// 기억해 두고 **달라진 사람 것만** 실어 보낸다. 스냅샷은 언제나 전체를 보낸다.
export function simVolatile(sim) {
  return {
    id: sim.id,
    x: sim.x,
    y: sim.y,
    state: { kind: sim.state.kind, action: sim.state.action, facilityId: sim.state.facilityId, rail: !!sim.state.rail },
    needs: sim.needs,
    mood: sim.mood,
    money: sim.money,
    // §23.40 화면은 아픈지 **여부**만 본다 (전수 확인: sim.sick의 참·거짓만 읽는다).
    // {kind, untilTick} 객체를 보낼 이유가 없다.
    sick: sim.sick ? true : null,
    hasCar: sim.hasCar,
    // 화면이 읽는 것은 level 하나다 ("시민"/"정착민" 표시). 나머지 넷(fulfilledTicks·
    // deprivedTicks·culture·visits)은 시뮬 내부 값인데 배치마다 249명분이 나갔다 — 22KB.
    needsTier: sim.needsTier ? { level: sim.needsTier.level } : null,
  };
}

export function simStatic(sim) {
  const v = simView(sim);
  for (const k of Object.keys(simVolatile(sim))) if (k !== 'id') delete v[k];
  return v;
}

// Compare the actual wire projection, not a second incomplete field whitelist.
// This includes degree completion/tuition, MBTI, potential and village changes.
export function staticKey(sim) {
  return JSON.stringify(simStatic(sim));
}

export function simView(sim) {
  return {
    id: sim.id,
    name: sim.name,
    surname: sim.surname, // §22.16 표시는 성+이름
    x: sim.x,
    y: sim.y,
    // §23.37 **state를 통째로 보내면 경로가 따라온다.** 화면은 kind와 action만 읽는데
    // (client/main.js 전수 확인), path 배열은 BFS가 만든 수백 칸짜리다.
    // 실측(인구 249): state 212KB 중 path가 164.5KB — 배치 payload 395KB의 42%가
    // **아무도 안 읽는 경로**였다. 250ms마다 이걸 보내고 파싱했다.
    state: {
      kind: sim.state.kind,
      action: sim.state.action,
      facilityId: sim.state.facilityId,
      rail: !!sim.state.rail,
    },
    needs: sim.needs,
    mood: sim.mood,
    money: sim.money,
    sick: sim.sick ? true : null,   // §23.40 화면은 여부만 본다
    hasCar: sim.hasCar,
    isPlayer: sim.isPlayer,
    isGenius: sim.isGenius,
    villageId: sim.villageId,
    // §23.41 homeId·householdId는 지금 화면이 안 읽지만 **로드맵에 있다** —
    // PLAN §125~126이 가구를 핵심 개념으로 두고 #51(가구)·#32(마을 귀속)이 진행 중이다.
    // 안 쓴다고 빼는 게 아니라, 배치마다 보내지 않고 **정적 쪽에 둔다**: 이사·혼인 때만
    // 바뀌므로 실질 비용이 0에 수렴하고, 화면이 필요해지는 날 그대로 쓸 수 있다.
    homeId: sim.homeId,
    householdId: sim.householdId,
    needsTier: sim.needsTier ? { level: sim.needsTier.level } : null, // §23.40 level만 읽는다
    education: sim.education ? { universityEnrolled: sim.education.universityEnrolled,
      universityGraduated: sim.education.universityGraduated, stage: sim.education.lastStage,
      tuitionPaid: sim.education.tuitionPaid, course: sim.education.course,
      highestDegree: sim.education.highestDegree, completed: sim.education.completed } : null,
    abilities: sim.abilities,
    potential: sim.potential,
    // traits 전체가 아니라 화면이 쓰는 것만 (mbti는 성향 표시에 쓰인다)
    traits: {
      gender: sim.traits.gender,
      age: sim.traits.age,
      occupation: sim.traits.occupation,
      mbti: sim.traits.mbti,
    },
  };
}

export function simsView(sims) {
  const out = new Array(sims.length);
  for (let i = 0; i < sims.length; i++) out[i] = simView(sims[i]);
  return out;
}

// Static corridor paths travel in snapshots, not every live batch.
export function railView(rail){
  return {stats:{...rail.stats},links:rail.links.map(l=>({id:l.id,from:l.from,to:l.to,blocked:l.blocked,
    capacity:l.capacity,speed:l.speed,train:{x:l.train.x,y:l.train.y,passengers:[...l.train.passengers]}}))};
}
