import { createWorld, advance } from './sim/index.js';
const SEEDS = Array.from({length:8},(_,i)=>1000+i*37);
const DAYS = 90;
const st=(a)=>{const m=a.reduce((x,y)=>x+y,0)/a.length; const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length); return `${Math.round(m*10)/10}±${Math.round(sd*10)/10}`;};
console.log('| 1년 | 인구 | 평균나이 | 생애사건/100일 | 졸업 | 결혼 | 출생 | 은퇴 | 사망 |');
console.log('|---:|---|---|---|---|---|---|---|---|');
for (const yd of [120, 90, 60, 40, 30, 20]) {
  const pop=[], age=[], life=[], grad=[], mar=[], birth=[], ret=[], died=[];
  for (const seed of SEEDS) {
    const w = createWorld(seed);
    w.logic.society.yearDays = yd;
    const ev = advance(w, {}, DAYS*1440);
    const c=(t)=>ev.filter(e=>e.type===t).length;
    pop.push(w.sims.length);
    age.push(w.sims.reduce((a,s)=>a+s.traits.age,0)/Math.max(1,w.sims.length));
    life.push((c('graduated')+c('married')+c('child_settled')+c('retired_now')+c('died')+c('grew_up'))/DAYS*100);
    grad.push(c('graduated')); mar.push(c('married')); birth.push(c('child_settled'));
    ret.push(c('retired_now')); died.push(c('died'));
  }
  console.log(`| ${yd}일 | ${st(pop)} | ${st(age)} | ${st(life)} | ${st(grad)} | ${st(mar)} | ${st(birth)} | ${st(ret)} | ${st(died)} |`);
}
