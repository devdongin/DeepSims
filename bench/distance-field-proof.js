// Proof prototype only. No cache, no production imports of this module.
import assert from 'node:assert/strict';
import {isWalkable} from '../sim/map.js';
const directions=[[0,-1],[1,0],[0,1],[-1,0]];

export function distanceFieldPath(map,sx,sy,tx,ty){
  for(const [x,y] of [[sx,sy],[tx,ty]])assert.ok(Number.isInteger(x)&&Number.isInteger(y)
    &&x>=0&&y>=0&&x<map.w&&y<map.h,'proof domain: in-bounds integer endpoints');
  // Historical BFS returns [] even when this equal endpoint is blocked.
  if(sx===tx&&sy===ty)return [];
  if(!isWalkable(map,tx,ty))return null;
  const distances=new Int32Array(map.w*map.h).fill(-1),queue=new Int32Array(map.w*map.h);
  const goal=ty*map.w+tx;distances[goal]=0;queue[0]=goal;
  let tail=1;
  for(let head=0;head<tail;head++){
    const index=queue[head],x=index%map.w,y=Math.floor(index/map.w);
    for(const [dx,dy] of directions){
      const nx=x+dx,ny=y+dy;
      if(!isWalkable(map,nx,ny))continue;
      const next=ny*map.w+nx;
      if(distances[next]>=0)continue;
      distances[next]=distances[index]+1;queue[tail++]=next;
    }
  }
  let remaining=distances[sy*map.w+sx];
  if(remaining<0){
    // Existing BFS admits a blocked start but not blocked intermediate cells.
    if(isWalkable(map,sx,sy))return null;
    remaining=Infinity;
    for(const [dx,dy] of directions){
      const x=sx+dx,y=sy+dy;
      if(!isWalkable(map,x,y))continue;
      const d=distances[y*map.w+x];
      if(d>=0)remaining=Math.min(remaining,d+1);
    }
    if(!Number.isFinite(remaining))return null;
  }
  const path=[];let x=sx,y=sy;
  while(remaining>0){
    let found=false;
    for(const [dx,dy] of directions){
      const nx=x+dx,ny=y+dy;
      if(!isWalkable(map,nx,ny)||distances[ny*map.w+nx]!==remaining-1)continue;
      x=nx;y=ny;path.push({x,y});remaining--;found=true;break;
    }
    assert.ok(found,'distance must decrease along a walkable neighbor');
  }
  return path;
}
