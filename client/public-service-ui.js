export function publicServiceLines(summary,villages=[]){
  if(!summary)return ['공공 서비스 관측 자료를 기다리는 중입니다.'];
  const lines=[`Day ${summary.fromDay}–${summary.toDay} · 시설 신축 수요/필요 인원과 별개인 관측입니다.`,
    '시도·시작·완료는 실제 횟수, 막힘은 주민·서비스·사유별 하루 1회입니다.'];
  const rows=Object.entries(summary.villages??{});
  if(!rows.length)lines.push('이 기간에 기록된 공공 서비스 관측이 없습니다. 인력 부족이 없다는 뜻은 아닙니다.');
  for(const [id,services] of rows){
    lines.push(villages.find(v=>v.id===id)?.name??id);
    for(const [service,label] of [['patrol','순찰'],['fire','화재 대응']]){
      const {counts:c,shortfalls:s}=services[service];
      lines.push(`${label}: 시도 ${c.attempted} · 시작 ${c.started} · 행동 완료 ${c.completed} · 실제 경로 실패 ${c.no_path}`);
      lines.push(`  막힘(주민·사유일): 대상 없음 ${s.no_target} · 지점 예약 ${s.reserved} · 지점/쿨다운 ${s.unreachable}`);
      if(service==='fire')lines.push(`  실제 진압 ${c.fire_resolved} · 자연 소화 ${c.fire_natural_out} (행동 완료와 다름)`);
    }
  }
  return lines;
}
