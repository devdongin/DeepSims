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
export function simView(sim) {
  return {
    id: sim.id,
    name: sim.name,
    surname: sim.surname, // §22.16 표시는 성+이름
    x: sim.x,
    y: sim.y,
    state: sim.state,
    needs: sim.needs,
    mood: sim.mood,
    money: sim.money,
    sick: sim.sick,
    hasCar: sim.hasCar,
    isPlayer: sim.isPlayer,
    isGenius: sim.isGenius,
    homeId: sim.homeId, // #51 가구/거주 관측
    householdId: sim.householdId,
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
