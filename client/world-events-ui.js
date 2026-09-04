import {validateWorldEvent} from '../sim/world-events.js';

export const EVENT_LABELS = {
  disease:'발병·전염 위험', immigration:'이민 신청량', mood:'기분 충격',
  topic_couple_news:'대화: 연애 소식',topic_family_talk:'대화: 가족',topic_food:'대화: 음식',
  topic_gossip:'대화: 소문',topic_memory_share:'대화: 추억',topic_politics:'대화: 정치',
  topic_weather:'대화: 날씨',topic_work_gripe:'대화: 직장',topic_sweet_talk:'대화: 애정',topic_club_talk:'대화: 동아리',
};
export function eventPayload(effect,value,days){
  const n=Number(value),duration=Number(days)*1440;
  const p={effect,durationTicks:duration,...(effect==='mood'?{delta:n}:{percent:n})};
  if(String(value).trim()===''||String(days).trim()===''||!validateWorldEvent(p).ok)
    throw new Error('효과 값과 기간을 확인하세요. 기간은 1~30일 정수입니다.');
  if(!Number.isInteger(Number(days)))throw new Error('기간은 1~30일 정수입니다.');
  return p;
}
export function activeEventLines(world){
  const t=world?.worldTick??0;
  return (world?.worldEvents??[]).filter(e=>e.startsAt<=t&&t<e.expiresAt).map(e=>
    `${EVENT_LABELS[e.effect]??e.effect}: ${e.effect==='mood'?`${e.delta>0?'+':''}${e.delta}`:`${e.percent}%`} · 남은 게임 시간 ${e.expiresAt-t}분`);
}

export function mountWorldEvents(getWorld,isFresh=()=>true){
  const dialog=document.createElement('dialog');
  dialog.className='world-events-dialog';
  dialog.setAttribute('aria-labelledby','world-events-title');
  dialog.style.cssText='margin:auto;max-height:85vh;overflow:auto;line-height:1.8;max-width:440px;width:calc(100% - 48px);background:#241d14;color:#ead9b0;border:2px solid #c9a86a;border-radius:12px;padding:20px';
  dialog.innerHTML=`<h2 id="world-events-title">세계 사건</h2>
    <p>모든 마을에 적용됩니다. 같은 종류의 활성 사건은 교체됩니다.</p>
    <form><label>효과 <select name="effect">${Object.entries(EVENT_LABELS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
    <p><label><span id="event-value-label">기존 대비 비율 (%)</span> <input name="value" type="number" min="0" max="300" step="1" value="100" required></label></p>
    <p><label>게임 내 기간 (일) <input name="days" type="number" min="1" max="30" step="1" value="1" required></label></p>
    <p>비율 100%는 평소와 같고 0%는 억제입니다. 기분 충격은 -3000~3000입니다. 대화는 기존 문맥 조건을 따르며 후보가 없으면 날씨로 돌아갑니다.</p>
    <button type="submit">위 조건으로 사건 입력 저장</button></form>
    <p role="status" aria-live="polite"></p><p data-freshness aria-live="polite"></p><h3>현재 적용 중</h3><pre style="white-space:pre-wrap"></pre><button type="button" data-close>닫기</button>`;
  document.body.append(dialog);
  const form=dialog.querySelector('form'),effect=form.elements.effect,value=form.elements.value;
  const status=dialog.querySelector('[role=status]'),submit=form.querySelector('button');
  let pending=null;
  effect.addEventListener('change',()=>{
    value.min=effect.value==='mood'?'-3000':'0';value.max=effect.value==='mood'?'3000':'300';
    value.value=effect.value==='mood'?'0':'100';
    dialog.querySelector('#event-value-label').textContent=effect.value==='mood'?'기분 변화량':'기존 대비 비율 (%)';
  });
  const refresh=()=>{
    if(!dialog.open)return;
    dialog.querySelector('[data-freshness]').textContent=isFresh()?'서버와 동기화됨':'연결 끊김 또는 동기화 대기 — 아래는 마지막으로 받은 상태입니다.';
    dialog.querySelector('pre').textContent=getWorld()?activeEventLines(getWorld()).join('\n')||'적용 중인 사건 없음':'세계 연결을 기다리는 중';
  };
  document.getElementById('world-events-btn').addEventListener('click',()=>{dialog.showModal();refresh();});
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(submit.disabled)return;
    if(!getWorld()||!isFresh()){status.textContent='세계가 다시 동기화된 후 입력하세요.';return;}
    let payload;
    try{payload=eventPayload(effect.value,value.value,form.elements.days.value);}catch(err){status.textContent=err.message;return;}
    if(pending&&JSON.stringify(pending.payload)!==JSON.stringify(payload)){
      status.textContent='이전 전송 결과가 불확실합니다. 이전 값으로 다시 제출해 저장 여부를 확인하세요.';return;
    }
    pending??={clientInputId:`world-event:${crypto.randomUUID()}`,command:'world_event',payload};
    for(const field of [effect,value,form.elements.days])field.disabled=true;
    submit.disabled=true;
    try{
      const res=await fetch('/api/input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)});
      const result=await res.json();
      if(!res.ok){
        status.textContent=res.status<500?`거부: ${result.error??res.status}`:'서버 오류로 저장 여부가 불확실합니다. 같은 입력의 저장 여부를 다시 확인하세요.';
        if(res.status<500)pending=null;
      }
      else{status.textContent='입력이 저장됐습니다. 실제 적용은 다음 틱부터 아래 목록에 표시됩니다.';pending=null;}
    }catch{status.textContent='저장 여부를 확인하지 못했습니다. 같은 값으로 다시 제출하면 중복 없이 확인합니다.';}
    finally{
      submit.disabled=false;
      for(const field of [effect,value,form.elements.days])field.disabled=pending!==null;
      submit.textContent=pending?'동일 입력 저장 확인':'위 조건으로 사건 입력 저장';
    }
  });
  return refresh;
}
