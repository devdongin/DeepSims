const PHASE={docked:'정차',flying:'비행 중',holding:'기내 대기',diverting:'회항 중',landed:'착륙 대기',repositioning:'빈 기체 복귀'};
const REASON={no_municipality:'거주 마을 필요',tier_locked:'대도시 등급 필요',no_other_municipality:'다른 마을 필요',
  airport_exists:'이미 공항 또는 공항 공사 있음',airport_demand_short:'실제 장거리 마을 방문 수요 부족'};
export function aircraftLabel(link){
  return `✈ ${PHASE[link.aircraft.phase]??'운항 상태 확인 중'}${link.blocked?' · 운항 중단':''} · ${link.aircraft.passengers}/${link.capacity}명 · 게이트 대기 ${link.waiting}명`;
}
export function airportConstructionLabel(evidence){
  if(!evidence)return '공항 건설 조건 확인 중';
  return `${evidence.eligible?'건설 가능':REASON[evidence.reason]??'건설 불가'} · 최근14일 완료 방문 ${evidence.completedTrips}/${evidence.threshold}회`;
}
export function travelStateLabel(state){
  if(state?.kind==='flying')return '(항공기 탑승 중)';
  if(state?.kind==='waiting_flight')return '(공항 게이트 대기)';
  if(state?.kind==='riding_train')return '(열차 탑승 중)';
  if(state?.kind==='waiting_train')return '(역 대기)';
  return state?.kind==='walking'?(state.air?'(공항 접근·이탈 보행)':'(이동 중)'):'';
}
