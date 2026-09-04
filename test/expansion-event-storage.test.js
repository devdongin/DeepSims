import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {EVENT_TYPES} from '../sim/constants.js';
import {Storage} from '../db/storage.js';
import {createWorld,tick,serialize} from '../sim/index.js';
import {TILE,addBuilding} from '../sim/map.js';
import {emptyState} from '../sim/simfactory.js';

const expansion=['plot_relocated','construction_relocation_deferred',
  'household_migration_gathering','household_migration_departed',
  'employment_construction_planned','village_land_assigned',
  'rail_opened','rail_cancelled','rail_suspended','rail_resumed','rail_alighted','rail_boarded'];

test('all literal simulation emitters are registered, with no duplicate event names',()=>{
  assert.equal(new Set(EVENT_TYPES).size,EVENT_TYPES.length);
  const directory=new URL('../sim/',import.meta.url);
  for(const file of readdirSync(directory).filter(f=>f.endsWith('.js'))){
    const source=readFileSync(new URL(file,directory),'utf8');
    for(const match of source.matchAll(/\b(?:emit|localEmit)\(\s*['"]([^'"]+)['"]/g))
      assert.ok(EVENT_TYPES.includes(match[1]),`${file} emits unregistered ${match[1]}`);
  }
});

test('expansion event names pass the real atomic storage boundary; unknown names still fail',()=>{
  const st=new Storage(':memory:');
  try{
    const {world}=st.loadOrCreate({seed:32,nowUtcMs:1000});world.worldTick=1;
    const events=expansion.map((type,ordinal)=>({tick:1,ordinal,type,simId:null,payload:{sample:true}}));
    st.commitBatch({world,events,appliedInputIds:[],epochUtcMs:1000});
    assert.deepEqual(st.db.prepare('SELECT type FROM events ORDER BY tick, ordinal').all().map(e=>e.type),expansion);
    assert.throws(()=>st.commitBatch({world,events:[{tick:2,ordinal:0,type:'not_registered',simId:null,payload:{}}],
      appliedInputIds:[],epochUtcMs:1000}),/unregistered event/);
    assert.equal(st.db.prepare('SELECT count(*) AS n FROM events').get().n,expansion.length);
  }finally{st.close();}
});

test('actual rail opening, boarding and alighting commit and reload without losing world state',()=>{
  const w=createWorld(32);w.map={w:128,h:40,tiles:Array(5120).fill(TILE.GRASS),facilities:[],reachVersion:0};
  w.plots=[];w.projects=[];w.zoneOrders=[];w.lastDailyDay=0;w.lastPlanDay=0;
  const a=addBuilding(w.map,'train_station',{x:8,y:12});
  addBuilding(w.map,'train_station',{x:96,y:12});addBuilding(w.map,'cafe',{x:105,y:12});
  const home=addBuilding(w.map,'house',{x:2,y:2});
  const s=w.sims[0];w.sims=[s];s.homeId=home.id;s.x=a.door.x-2;s.y=a.door.y;
  s.money=10000;s.hasCar=false;s.traits.age=25;s.traits.occupation='office_worker';s.education.course=null;
  s.state={...emptyState(),kind:'performing',action:'idle',ticksLeft:1000};
  const events=tick(w);
  events.push(...tick(w,[{sequence:0,command:'assign',payload:{simId:s.id,actionType:'eat'}}]));
  for(let i=0;i<500&&!events.some(e=>e.type==='rail_alighted');i++)events.push(...tick(w));
  for(const type of ['rail_opened','rail_boarded','rail_alighted'])assert.ok(events.some(e=>e.type===type),type);
  const st=new Storage(':memory:');
  try{
    st.loadOrCreate({seed:32,nowUtcMs:1000});
    st.commitBatch({world:w,events,appliedInputIds:[],epochUtcMs:1000});
    const stored=st.db.prepare('SELECT tick,ordinal,type,sim_id,payload FROM events ORDER BY tick,ordinal').all()
      .map(e=>({tick:e.tick,ordinal:e.ordinal,type:e.type,simId:e.sim_id,payload:JSON.parse(e.payload)}));
    assert.deepEqual(stored,events);
    assert.equal(serialize(st.loadOrCreate({seed:32,nowUtcMs:1000}).world),serialize(w));
  }finally{st.close();}
});
