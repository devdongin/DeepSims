// Code-native airport geometry follows the exact rotated facility footprint.
// No decorative aircraft: every airborne marker comes from the real service.
export function airportPoint(fac,x,y){
  const d=fac.dir??0;
  const [u,v]=d===1?[11-y,x]:d===2?[19-x,11-y]:d===3?[y,19-x]:[x,y];
  return {x:fac.x+u,y:fac.y+v};
}

export function airportGeometry(fac){
  const shapes=[];
  const quad=(x,y,w,h,z,color,kind)=>{
    shapes.push({kind,color,z,points:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([u,v])=>airportPoint(fac,u,v))});
  };
  quad(0,0,19,11,0,0x81918d,'apron');
  quad(0.6,0.7,17.8,3.6,0,0x39474f,'runway');
  for(let x=2;x<18;x+=2.5)quad(x,2.35,1.25,0.16,0,0xf5edcc,'runway-stripe');
  for(const x of [1.1,17.4])for(let y=1.2;y<3.7;y+=0.5)quad(x,y,0.4,0.25,0,0xf5edcc,'threshold');
  quad(1,5.1,17,0.14,0,0xe8c66c,'taxiway');
  for(const x of [6,14]){
    quad(x-0.08,5.1,0.16,2.9,0,0xe8c66c,'gate-line');
    quad(x-1,6.1,2,0.12,0,0xe8c66c,'gate-line');
  }
  const box=(x,y,w,h,z,color,kind)=>quad(x,y,w,h,z,color,kind);
  box(4,8.2,11,1.8,19,0xb0c9ce,'terminal');
  box(1.2,7.2,1.3,1.3,38,0xc3d5d8,'tower');
  box(0.8,6.8,2.1,2.1,49,0x78b6c7,'tower-cabin');
  shapes.at(-1).baseZ=38;
  return shapes;
}

export function drawAirportExterior(scene,fac,isoX,isoY){
  const objects=[];
  for(const shape of airportGeometry(fac)){
    const g=scene.add.graphics();objects.push(g);
    const points=shape.points.map(p=>({x:isoX(p.x,p.y),y:isoY(p.x,p.y)}));
    const polygon=(points,color)=>{
      g.fillStyle(color,1);g.beginPath();g.moveTo(points[0].x,points[0].y);
      for(const p of points.slice(1))g.lineTo(p.x,p.y);
      g.closePath();g.fillPath();
    };
    if(shape.z){
      // Sort side faces back-to-front; roof covers the back sides. Individual
      // structure depth lets residents remain visible on the apron and gates.
      const sides=points.map((p,i)=>[p,points[(i+1)%4]])
        .sort((a,b)=>(a[0].y+a[1].y)-(b[0].y+b[1].y));
      for(const [a,b] of sides){
        const lower=shape.baseZ??0;
        polygon([{x:a.x,y:a.y-lower},{x:b.x,y:b.y-lower},{x:b.x,y:b.y-shape.z},{x:a.x,y:a.y-shape.z}],
          a.x<b.x?0x4a6a7e:0x658a9b);
        if(shape.kind==='terminal'||shape.kind==='tower-cabin'){
          const low=lower+4,high=shape.z-3;
          polygon([{x:a.x,y:a.y-low},{x:b.x,y:b.y-low},{x:b.x,y:b.y-high},{x:a.x,y:a.y-high}],0x254958);
          // Window mullions follow the wall, including all rotated orientations.
          const count=shape.kind==='terminal'?8:3;
          for(let i=1;i<count;i++){
            const u=i/count,v=u+0.015;
            const p={x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u};
            const q={x:a.x+(b.x-a.x)*v,y:a.y+(b.y-a.y)*v};
            polygon([{x:p.x,y:p.y-low},{x:q.x,y:q.y-low},{x:q.x,y:q.y-high},{x:p.x,y:p.y-high}],0xc4dce0);
          }
        }
      }
      g.setDepth(1000+Math.max(...shape.points.map(p=>p.x+p.y))-0.5);
    }else g.setDepth(1);
    polygon(points.map(p=>({x:p.x,y:p.y-shape.z})),shape.color);
    g.setData('airportId',fac.id);g.setData('airportPart',shape.kind);
  }
  return objects;
}
