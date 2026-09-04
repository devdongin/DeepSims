import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createWorld} from '../sim/index.js';
import {bfsPath} from '../sim/pathfind.js';
import {TILE} from '../sim/map.js';
import {distanceFieldPath} from '../bench/distance-field-proof.js';

test('#182 reverse distances preserve all 41472 bounded 3x3 cases including blocked starts',()=>{
  for(let mask=0;mask<512;mask++){
    const map={w:3,h:3,tiles:Array.from({length:9},(_,i)=>mask&(1<<i)?TILE.WALL:TILE.GRASS)};
    for(let start=0;start<9;start++)for(let goal=0;goal<9;goal++){
      const points=[start%3,Math.floor(start/3),goal%3,Math.floor(goal/3)];
      assert.deepEqual(distanceFieldPath(map,...points),bfsPath(map,...points),`mask${mask}: ${start}->${goal}`);
    }
  }
});

test('#182 reverse distances match the actual frozen original coordinate SHA fixtures',()=>{
  // Parse literal fixture data only; never evaluate source text.
  const source=readFileSync(new URL('./pathfind-regression.test.js',import.meta.url),'utf8');
  const entries=[...source.matchAll(/\[\[([\d,]+)\], '([a-f0-9]{64})'\]/g)];
  assert.equal(entries.length,7,'frozen fixture parser must not silently skip cases');
  const {map}=createWorld(20260831);
  for(const [,coords,sha] of entries){
    const points=coords.split(',').map(Number),path=distanceFieldPath(map,...points);
    assert.equal(createHash('sha256').update(JSON.stringify(path)).digest('hex'),sha);
    assert.deepEqual(path,bfsPath(map,...points));
  }
});

test('#182 rebuilding after wall edits preserves tie order without cached stale paths',()=>{
  const map={w:5,h:5,tiles:Array(25).fill(TILE.GRASS)};
  for(const tile of [12,7,17,11,13]){
    map.tiles[tile]=TILE.WALL;
    assert.deepEqual(distanceFieldPath(map,0,2,4,2),bfsPath(map,0,2,4,2));
  }
  map.tiles.fill(TILE.GRASS);
  assert.deepEqual(distanceFieldPath(map,0,2,4,2),bfsPath(map,0,2,4,2));
  assert.throws(()=>distanceFieldPath(map,-1,0,4,2),/proof domain/);
});

test('#182 every tile kind and unknown values retain the actual walkability predicate',()=>{
  for(const value of [...Object.values(TILE),-1,999]){
    const map={w:3,h:3,tiles:Array(9).fill(TILE.GRASS)};map.tiles[4]=value;
    for(let start=0;start<9;start++)for(let goal=0;goal<9;goal++){
      const points=[start%3,Math.floor(start/3),goal%3,Math.floor(goal/3)];
      assert.deepEqual(distanceFieldPath(map,...points),bfsPath(map,...points),`tile${value}: ${start}->${goal}`);
    }
  }
});

test('#182 revision-only cache key is insufficient for supported direct tile edits',()=>{
  const map={w:3,h:3,tiles:Array(9).fill(TILE.GRASS),reachVersion:7};
  const identity=map.tiles,oldVersion=map.reachVersion,oldPath=distanceFieldPath(map,0,1,2,1);
  map.tiles[4]=TILE.WALL;
  assert.equal(map.tiles,identity);assert.equal(map.reachVersion,oldVersion);
  const fresh=distanceFieldPath(map,0,1,2,1);
  assert.notDeepEqual(fresh,oldPath,'same array and revision can have a different exact path');
  assert.deepEqual(fresh,bfsPath(map,0,1,2,1));
});

test('#182 dimensions and copied corridor tile identity belong to the cache domain',()=>{
  const tiles=Array(9).fill(TILE.GRASS);tiles[1]=TILE.WALL;
  const square={w:3,h:3,tiles,reachVersion:0},line={w:9,h:1,tiles,reachVersion:0};
  assert.ok(distanceFieldPath(square,0,0,2,0));
  assert.equal(distanceFieldPath(line,0,0,2,0),null,'same tiles/revision with another stride is a different graph');
  const ground={w:5,h:3,tiles:Array(15).fill(TILE.GRASS),reachVersion:8};
  const corridor={...ground,tiles:ground.tiles.slice()};
  for(let y=0;y<3;y++)corridor.tiles[y*5+2]=TILE.WALL;
  assert.ok(distanceFieldPath(ground,0,1,4,1));
  assert.equal(distanceFieldPath(corridor,0,1,4,1),null,'rail corridor copies must not use the original map field');
});
