import { bfsPath } from './pathfind.js';
import { emptyState } from './simfactory.js';
import { medicalQuote } from './health-policy.js';
export const ESCORT_ACTION='escort_child_doctor';
function waitingAtHome(world,c){const home=world.map.facilities.find(f=>f.id===c.homeId);if(!home)return false;
 return c.state.kind==='idle'||(c.state.kind==='performing'&&c.state.action==='sleep'&&c.state.facilityId===home.id);}
export function escortableChildren(world,g){const ids=[];for(const [id,ps]of Object.entries(world.parents))if((ps??[]).includes(g.id))ids.push(Number(id));
 if(ids.length===0)return[];
 return world.sims.filter(c=>ids.includes(c.id)&&c.traits.age<19&&c.homeId===g.homeId&&c.sick&&waitingAtHome(world,c)&&medicalQuote(world,c).ok).sort((a,b)=>a.id-b.id);}
export function escortBlockReason(world,g){if(g.traits.age<19)return'too_young';if(!world.map.facilities.some(f=>f.type==='hospital'))return'no_facility';return escortableChildren(world,g).length?null:'not_needed';}
export function claimEscortPickup(world,g,id){const c=escortableChildren(world,g).find(x=>x.id===id);if(!c)return false;const key=`${c.state.facilityId}:${c.state.resourceId}`;if(world.reservations[key]===c.id)delete world.reservations[key];c.state={...emptyState(),kind:'awaiting_escort',action:ESCORT_ACTION,escortId:g.id};return true;}
function releasePickup(world,g,c){const k=`childcare:child:${c?.id}`;if(world.reservations[k]===g.id)delete world.reservations[k];}
export function beginHospitalEscort(world,g){const id=Number(g.state.resourceId?.slice(6)),c=world.sims.find(x=>x.id===id);
 if(!c||c.state.kind!=='awaiting_escort'||c.state.escortId!==g.id||c.homeId!==g.homeId||!c.sick){if(c?.state.escortId===g.id)c.state=emptyState();return false;}
 for(const f of world.map.facilities.filter(x=>x.type==='hospital'))for(const r of f.resources){const k=`${f.id}:${r.id}`,h=world.reservations[k];if(h!==undefined&&h!==c.id)continue;const path=bfsPath(world.map,g.x,g.y,r.x,r.y);if(path===null)continue;
  releasePickup(world,g,c);world.reservations[k]=c.id;g.state={...emptyState(),kind:path.length?'walking':'performing',action:ESCORT_ACTION,facilityId:f.id,resourceId:r.id,path,journey:path.length?{x:g.x,y:g.y,walked:0}:null,ticksLeft:world.logic.actions.see_doctor.duration,escortId:c.id,escortPhase:'travel'};
  c.state={...emptyState(),kind:path.length?'being_escorted':'performing',action:path.length?ESCORT_ACTION:'see_doctor',facilityId:f.id,resourceId:r.id,ticksLeft:world.logic.actions.see_doctor.duration,escortId:g.id,escortPhase:'travel'};c.x=g.x;c.y=g.y;return true;}
 releasePickup(world,g,c);c.state=emptyState();return false;}
export function syncEscortStep(world,g){if(g.state.action!==ESCORT_ACTION||g.state.escortPhase!=='travel')return true;const c=world.sims.find(x=>x.id===g.state.escortId);if(!c||c.state.kind!=='being_escorted'||c.state.escortId!==g.id)return false;c.x=g.x;c.y=g.y;if(g.state.path.length===0){c.state.kind='performing';c.state.action='see_doctor';c.state.ticksLeft=world.logic.actions.see_doctor.duration;}return true;}
export function cancelEscort(world,g){const c=world.sims.find(x=>x.id===g.state.escortId)??world.sims.find(x=>x.state.escortId===g.id&&['awaiting_escort','being_escorted'].includes(x.state.kind));if(c){const k=`${c.state.facilityId}:${c.state.resourceId}`;if(world.reservations[k]===c.id)delete world.reservations[k];c.state=emptyState();}releasePickup(world,g,c);g.state=emptyState();}
