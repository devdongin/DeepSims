import { validatePolicy } from './logic.js';
import { governmentFor, PRIMARY_GOVERNMENT } from './government.js';

// Optional villageId extends the existing flat command without treating the
// target as an economic parameter. HTTP and durable replay use this validator.
export function validatePolicyCommand(world,payload){
  if(payload===null||typeof payload!=='object'||Array.isArray(payload))return {ok:false,error:'객체 필요'};
  const explicit=Object.hasOwn(payload,'villageId');
  const villageId=explicit?payload.villageId:PRIMARY_GOVERNMENT;
  if(typeof villageId!=='string'||!villageId.length||villageId.length>128)return {ok:false,error:'잘못된 마을 ID'};
  const changes=Object.fromEntries(Object.entries(payload).filter(([key])=>key!=='villageId'));
  const checked=validatePolicy(changes);if(!checked.ok)return checked;
  const village=world.villages.find(v=>v.id===villageId);
  if(!village||(villageId!==PRIMARY_GOVERNMENT&&!village.government))return {ok:false,error:'존재하지 않는 마을'};
  return {ok:true,villageId,explicit,changes};
}

export function applyPolicyCommand(world,payload,t,emit){
  const checked=validatePolicyCommand(world,payload);
  if(!checked.ok){emit('input_rejected',null,{command:'policy',reason:checked.error});return false;}
  const government=governmentFor(world,checked.villageId),before={};
  for(const [key,value] of Object.entries(checked.changes)){
    before[key]=government.policy[key]??world.logic.economy[key];
    government.policy[key]=value;
  }
  government.playerPolicyDay=Math.floor(t/1440);
  emit('policy_changed',null,{changes:checked.changes,before,source:'player',
    ...(checked.explicit?{villageId:checked.villageId}:{})});
  return true;
}
