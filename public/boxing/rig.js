/* The boxers' rig: textures, shapes, pose, drawing. Shared by the lab and the shape editor. */
const DW=800, DH=434, GROUND=338;
function rng(a){ return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

/* ---- TEXTURES: small tiles drawn once, used as patterns ---- */
function tile(w,h,fn){ const c=document.createElement('canvas'); c.width=w; c.height=h; fn(c.getContext('2d'),w,h,rng(w*7+h)); return c; }
function grain(g,w,h,R,amt,n){ for(let i=0;i<n;i++){ const v=R()<.5?255:0; g.fillStyle=`rgba(${v},${v},${v},${R()*amt})`; g.fillRect(R()*w,R()*h,1+R()*1.5,1+R()*1.5); } }
const T={
  wool: tile(96,96,(g,w,h,R)=>{ g.fillStyle='#8b8b8b'; g.fillRect(0,0,w,h);
    for(let x=0;x<w;x+=3){ g.fillStyle=`rgba(0,0,0,${.05+R()*.08})`; g.fillRect(x,0,1,h); }                     /* the weave */
    for(let i=-h;i<w;i+=5){ g.strokeStyle='rgba(255,255,255,.06)'; g.beginPath(); g.moveTo(i,0); g.lineTo(i+h,h); g.stroke(); }  /* twill */
    for(let x=0;x<w;x+=24){ g.fillStyle='rgba(255,255,255,.18)'; g.fillRect(x+R()*2,0,1,h); }                   /* chalk stripe */
    grain(g,w,h,R,.18,1600); }),
  tweed: tile(96,96,(g,w,h,R)=>{ g.fillStyle='#474747'; g.fillRect(0,0,w,h);
    for(let y=0;y<h;y+=8) for(let x=0;x<w;x+=8){ const d=((x/8+y/8)%2)?1:-1; g.strokeStyle=`rgba(255,255,255,${.06+R()*.06})`; g.beginPath(); g.moveTo(x,y+(d>0?0:8)); g.lineTo(x+8,y+(d>0?8:0)); g.stroke(); }  /* herringbone */
    grain(g,w,h,R,.22,2200); }),
  knit: tile(48,48,(g,w,h,R)=>{ g.fillStyle='#5e5e5e'; g.fillRect(0,0,w,h);
    for(let y=0;y<h;y+=6){ const band=Math.floor(y/12)%2; for(let x=0;x<w;x+=6){ g.strokeStyle=band?'rgba(220,220,220,.55)':'rgba(30,30,30,.55)'; g.lineWidth=1.6;
      g.beginPath(); g.moveTo(x,y); g.lineTo(x+3,y+5); g.lineTo(x+6,y); g.stroke(); } }
    grain(g,w,h,R,.15,400); }),
  shirt: tile(64,64,(g,w,h,R)=>{ g.fillStyle='#e6e6e4'; g.fillRect(0,0,w,h); for(let y=0;y<h;y+=2){ g.fillStyle=`rgba(0,0,0,${R()*.03})`; g.fillRect(0,y,w,1); } grain(g,w,h,R,.06,300); }),
  skin: tile(64,64,(g,w,h,R)=>{ g.fillStyle='#a2a2a2'; g.fillRect(0,0,w,h); for(let i=0;i<40;i++){ const x=R()*w,y=R()*h,r=4+R()*10, gr=g.createRadialGradient(x,y,0,x,y,r);
    gr.addColorStop(0,`rgba(${R()<.5?255:0},${R()<.5?255:0},${R()<.5?255:0},.05)`); gr.addColorStop(1,'rgba(0,0,0,0)'); g.fillStyle=gr; g.fillRect(x-r,y-r,r*2,r*2); } grain(g,w,h,R,.12,500); }),
  leather: tile(64,64,(g,w,h,R)=>{ g.fillStyle='#272727'; g.fillRect(0,0,w,h); grain(g,w,h,R,.2,900); }),
  white: tile(64,64,(g,w,h,R)=>{ g.fillStyle='#e2e2e0'; g.fillRect(0,0,w,h); grain(g,w,h,R,.1,500); }),
  tie: tile(32,32,(g,w,h,R)=>{ g.fillStyle='#202020'; g.fillRect(0,0,w,h); for(let i=-h;i<w;i+=8){ g.strokeStyle='rgba(255,255,255,.18)'; g.lineWidth=2; g.beginPath(); g.moveTo(i,0); g.lineTo(i+h,h); g.stroke(); } }),
  craft: tile(256,256,(g,w,h,R)=>{ g.fillStyle='#b99a6e'; g.fillRect(0,0,w,h); for(let i=0;i<120;i++){ g.strokeStyle=`rgba(${R()<.5?90:240},${R()<.5?60:220},40,${R()*.12})`; g.beginPath(); const x=R()*w,y=R()*h; g.moveTo(x,y); g.lineTo(x+R()*30-15,y+R()*6-3); g.stroke(); } grain(g,w,h,R,.14,4000); }),
};
const PATS=new WeakMap(); function pat(k,c){ let m=PATS.get(c); if(!m){ m={}; PATS.set(c,m); } return (m[k]??=c.createPattern(T[k],'repeat')); }

/* ---- THE FIGHT, as events: a punch is {who, hand, t0}; it reaches out, holds, comes back; the other one rocks ---- */
let EV=[], nextAuto=0, hits=0;
function punch(who,hand,t0,landed=true){ EV.push({who,hand,t0,landed}); }
const ease=x=>1-Math.pow(1-x,3);
const back=x=>{ const c=1.6; return 1+(c+1)*Math.pow(x-1,3)+c*Math.pow(x-1,2); };     /* out, a hair past, settle */
const inout=x=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
function curve(d){ if(d<0||d>.52) return 0; if(d<.16) return back(d/.16); if(d<.22) return 1; return 1-inout((d-.22)/.3); }
function amt(who,hand,t){ let a=0; for(const e of EV) if(e.who===who&&e.hand===hand) a=Math.max(a,curve(t-e.t0)); return a; }
function rocked(who,t){ let a=0;
  for(const e of EV) if(e.who!==who&&e.landed){ const d=t-e.t0-.13;
    if(d>0&&d<1.1){ a+=(d<.1?ease(d/.1):Math.exp(-(d-.1)*3)*(1+.3*Math.sin((d-.1)*13)*Math.exp(-(d-.1)*2.5)))*.6; } }
  return Math.min(1.7,a); }
/* ---- THE POSE of one fighter at time t, in its own frame: facing right, feet on the ground at y=0 ---- */
function pose(who,t){
  const ph=who*2.1, bob=Math.sin(t*Math.PI*2*1.7+ph)*4, sway=Math.sin(t*Math.PI*2*.47+ph)*10+Math.sin(t*Math.PI*2*1.13+ph)*3;
  const lead=amt(who,0,t), rear=amt(who,1,t), hit=rocked(who,t);
  const hx=sway+(lead+rear)*14-hit*46, hy=-158+bob+hit*7;
  const lean=.06+(lead+rear)*.14-hit*.42+Math.sin(t*Math.PI*2*.8+ph)*.03;
  /* the feet: planted, shuffling in and out with the sway; the front one lifts a little when it steps */
  const step=Math.max(0,Math.sin(t*Math.PI*2*.94+ph));
  const reach=Math.max(lead,rear);
  const fF=[66+sway*.7+reach*12-hit*20,-Math.pow(step,6)*9-hit*4], fB=[-70+sway*.35-hit*40,-Math.pow(Math.max(0,Math.sin(t*Math.PI*2*.94+ph+2.6)),6)*7-Math.sin(Math.min(1,hit)*Math.PI)*12];
  const c=Math.cos(lean), s=Math.sin(lean), sh=[hx+s*62, hy-c*62];       /* the shoulder, along the leaning torso */
  const guard=Math.sin(t*Math.PI*2*2.1+ph)*3;
  const L=[sh[0]+44+lead*150-hit*30, sh[1]+14+guard-lead*16-hit*26], R=[sh[0]+22+rear*166-hit*22, sh[1]+40-guard*.6-rear*30-hit*34];
  return {hx,hy,lean,fF,fB,L,R,lead,rear,hit};
}

/* ---- DRAWING: every piece is a path; it gets its white scissor edge, its texture, then its shading ---- */
let BOIL=.6, EDGE=4.5, EDGECOL='#f2f2f2', JR=rng(1), SHADOWS=false;
function jit(pts){ return pts.map(([x,y])=>[x+(JR()-.5)*BOIL*2,y+(JR()-.5)*BOIL*2]); }
function path(g,pts,smooth){ g.beginPath(); if(!smooth){ g.moveTo(pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++) g.lineTo(pts[i][0],pts[i][1]); g.closePath(); return; }
  const n=pts.length, m=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2]; let s=m(pts[n-1],pts[0]); g.moveTo(s[0],s[1]);
  for(let i=0;i<n;i++){ const p=pts[i], q=m(p,pts[(i+1)%n]); g.quadraticCurveTo(p[0],p[1],q[0],q[1]); } g.closePath(); }
function piece(g,pts,tex,{smooth=false,shade=null}={}){
  pts=jit(pts);
  if(SHADOWS){ g.save(); g.translate(3,5); path(g,pts,smooth); g.fillStyle='rgba(40,25,10,.28)'; g.filter='blur(2px)'; g.fill(); g.restore(); g.filter='none'; }
  if(EDGE>0){ path(g,pts,smooth); g.lineWidth=EDGE; g.lineJoin='round'; g.strokeStyle=EDGECOL; g.stroke(); }
  path(g,pts,smooth); g.fillStyle=pat(tex,g); g.fill();
  if(shade){ g.save(); path(g,pts,smooth); g.clip(); shade(g); g.restore(); }
}
function band(g,a,b,stops){ const gr=g.createLinearGradient(a[0],a[1],b[0],b[1]); stops.forEach(([o,c])=>gr.addColorStop(o,c)); g.fillStyle=gr; g.fillRect(-400,-400,800,800); }
const rot=(p,o,a)=>{ const c=Math.cos(a),s=Math.sin(a),x=p[0]-o[0],y=p[1]-o[1]; return [o[0]+x*c-y*s,o[1]+x*s+y*c]; };

/* ---- THE SHAPES, as data, so the editor can reshape them. Legs are [across, along]: along runs 0 at the hip to
   1 at the ankle, across is px either side of that line. Shoes and fists are around their own centre, before they
   are scaled up; torso pieces are around the hip, before the lean. Edits are kept in localStorage. ---- */
/* traced over the GIF in the editor, 2026-10-25 */
const DEFAULT_SHAPES={"leg":[[[14.811,-0.357],[-43.284,-0.273],[-61.146,0.699],[21.382,0.594]],[[53.822,-0.349],[-6.274,-0.574],[-24.324,0.643],[67.192,0.71]]],"shoe":[{"body":[[14.043,-17.213],[49.465,-19.357],[80.6,-28.284],[59.048,-42.172],[23.89,-51.045],[-0.878,-57.185],[-1.997,-20.506]],"saddle":[[-6,-1],[14,-1],[16,-13],[2,-16],[-8,-15]]},{"body":[[-30.599,-17.37],[30.159,-11.232],[30.49,-31.162],[21.49,-39.162],[3.49,-42.162],[-18.51,-52.162],[-32.121,-49.621],[-35.845,-33.819]]}],"fist":[[[-4.003,-40.897],[6.34,-46.256],[14.927,-35.819],[20.005,-23.135],[10.725,-14.781],[-9.067,-8.643],[-14.42,-31.212]],[[-7.778,-51.633],[14.222,-54.633],[23.222,-45.633],[22.222,-30.633],[10.222,-24.633],[-5.778,-26.633],[-10.778,-38.633]]],"torso":[{"knit":[[-24.919,-48.217],[30.887,-56.652],[14.332,-117.952],[-24.501,-131.708]],"head":[[-6.03,-123.304],[17.046,-125.452],[16.295,-136.369],[14.04,-147.719],[-2.962,-150.562],[-9.954,-141.229]]},{"head":[[24.476,-120.84],[41.555,-122.04],[43.555,-140.04],[35.555,-154.04],[24.555,-152.04],[14.779,-134.604]],"shirt":[[-40.51,-69.618],[18.365,-41.305],[38.111,-119.733],[7.232,-134.196]],"tie":[[22.815,-113.769],[29.815,-113.769],[31.815,-59.769],[26.815,-51.769],[21.815,-59.769]],"collarL":[[-10,-72],[1,-66],[-6,-60]],"collarR":[[12,-72],[5,-66],[11,-60]]}]};
let SHAPES=JSON.parse(JSON.stringify(DEFAULT_SHAPES));
function loadShapes(){ SHAPES=JSON.parse(JSON.stringify(DEFAULT_SHAPES));
  try{ const o=JSON.parse(localStorage.getItem('boxing-shapes')||'null'); if(o) for(const k in o) if(SHAPES[k]) SHAPES[k]=o[k]; }catch(e){} }
function saveShapes(){ try{ localStorage.setItem('boxing-shapes',JSON.stringify(SHAPES)); }catch(e){} }
loadShapes(); addEventListener('storage',e=>{ if(e.key==='boxing-shapes') loadShapes(); });   /* another tab edited them */

function legPts(who,hip,foot){ const ank=[foot[0],foot[1]-15], dx=ank[0]-hip[0], dy=ank[1]-hip[1], L=Math.hypot(dx,dy), px=-dy/L, py=dx/L;
  return {ank,px,py,L,pts:SHAPES.leg[who].map(([a,u])=>[hip[0]+dx*u+px*a, hip[1]+dy*u+py*a+(u>.98?2:0)])}; }
function leg(g,hip,foot,tex,who){
  /* a wide trouser leg from hip to ankle, flaring toward the hem, with a crease down the front */
  const {ank,px,py,pts}=legPts(who,hip,foot);
  piece(g,pts,tex,{shade:g=>{ band(g,[hip[0]+px*30,hip[1]],[hip[0]-px*30,hip[1]],[[0,'rgba(0,0,0,.35)'],[.45,'rgba(255,255,255,.08)'],[.55,'rgba(0,0,0,.05)'],[1,'rgba(0,0,0,.4)']]);
    g.strokeStyle='rgba(0,0,0,.25)'; g.lineWidth=1.2; g.beginPath(); g.moveTo(hip[0],hip[1]); g.lineTo(ank[0]+px*4,ank[1]); g.stroke(); }});
}
function shoe(g,foot,kind,who){
  const [x,y]=foot, Z=1.55, P=k=>k.map(([a,b])=>[x+a*Z,y+b*Z]);
  /* the sole runs along the bottom of the shoe as it is drawn, wherever the shape has been moved to */
  const B=SHAPES.shoe[who].body, x0=Math.min(...B.map(p=>p[0])), x1=Math.max(...B.map(p=>p[0])), yb=Math.max(...B.map(p=>p[1]));
  const sx0=x+x0*Z, sw=(x1-x0)*Z, sy=y+yb*Z;
  if(kind==='saddle'){
    piece(g,P(SHAPES.shoe[who].body),'white',{smooth:true});
  } else {
    piece(g,P(SHAPES.shoe[who].body),'leather',{smooth:true,
      shade:g=>{ g.fillStyle='rgba(255,255,255,.14)'; g.beginPath(); g.ellipse(x+20*Z,y-10*Z,9*Z,3*Z,-.3,0,7); g.fill(); }});
  }
}
function fist(g,c,amt,who){
  /* a fist seen side on: a rounded block of curled fingers, knuckle lines, the thumb across the front */
  const [x,y]=c, s=1.55+amt*.12, P=k=>k.map(([a,b])=>[x+a*s,y+b*s]);
  piece(g,P(SHAPES.fist[who]),'skin',{smooth:true,shade:g=>{
    band(g,[x-16,y],[x+16,y],[[0,'rgba(0,0,0,.25)'],[.6,'rgba(255,255,255,.08)'],[1,'rgba(0,0,0,.18)']]);
    g.strokeStyle='rgba(0,0,0,.35)'; g.lineWidth=1.1;
    for(let i=0;i<3;i++){ g.beginPath(); g.moveTo(x+4*s,y+(-8+i*6)*s); g.quadraticCurveTo(x+14*s,y+(-6+i*6)*s,x+15*s,y+(-3+i*6)*s); g.stroke(); }
    g.beginPath(); g.moveTo(x-10*s,y+2*s); g.quadraticCurveTo(x,y-2*s,x+9*s,y+4*s); g.stroke(); }});
}
function torso(g,who,hip,lean){
  g.save(); g.translate(hip[0],hip[1]); g.rotate(lean);
  if(who===0){ /* a knit band over the trouser top, and the cropped top of a head above it */
    const S=SHAPES.torso[0];
    piece(g,S.knit,'knit',{shade:g=>band(g,[-25,0],[25,0],[[0,'rgba(0,0,0,.3)'],[.5,'rgba(255,255,255,.06)'],[1,'rgba(0,0,0,.35)']])});
    piece(g,S.head,'skin',{smooth:true,shade:g=>{ g.fillStyle='rgba(20,20,20,.75)'; g.fillRect(-16,-80,32,10); }});
  } else {     /* a cropped head above the collar, then the white shirt front, its collar, the tie down the middle */
    const S=SHAPES.torso[1];
    piece(g,S.head,'skin',{smooth:true,shade:g=>{ g.fillStyle='rgba(20,20,20,.8)'; g.fillRect(-16,-104,32,14); g.fillStyle='rgba(0,0,0,.18)'; g.fillRect(-16,-76,32,10); }});
    piece(g,S.shirt,'shirt',{shade:g=>band(g,[-23,0],[23,0],[[0,'rgba(0,0,0,.22)'],[.5,'rgba(0,0,0,0)'],[1,'rgba(0,0,0,.28)']])});
    piece(g,S.tie,'tie');
    piece(g,S.collarL,'shirt'); piece(g,S.collarR,'shirt');
  }
  g.restore();
}
const FS=.74;   /* the fighters' size on the stage */
function fighter(g,who,t,baseX){
  const p=pose(who,t);
  g.save(); g.translate(baseX,GROUND); g.scale(FS,FS); if(who===1) g.scale(-1,1);
  const hip=[p.hx,p.hy], hb=rot([p.hx-10,p.hy],hip,p.lean), hf=rot([p.hx+10,p.hy],hip,p.lean);
  const trousers=who===0?'wool':'tweed', kind=who===0?'saddle':'boot';
  leg(g,hb,p.fB,trousers,who); shoe(g,p.fB,kind,who);
  fist(g,p.R,p.rear,who);
  torso(g,who,hip,p.lean);
  leg(g,hf,p.fF,trousers,who); shoe(g,p.fF,kind,who);
  fist(g,p.L,p.lead,who);
  g.restore();
  return p;
}

/* ---- FRAMES: for each editable piece, how its shape data maps to stage coordinates and back ---- */
function frames(who,t,baseX){
  const p=pose(who,t), sg=who===1?-1:1, hip=[p.hx,p.hy], hf=rot([p.hx+10,p.hy],hip,p.lean);
  const toW=([x,y])=>[baseX+sg*FS*x, GROUND+FS*y], toL=([X,Y])=>[(X-baseX)/(sg*FS),(Y-GROUND)/FS];
  const around=(o,s)=>({to:q=>toW([o[0]+q[0]*s,o[1]+q[1]*s]), from:P=>{ const l=toL(P); return [(l[0]-o[0])/s,(l[1]-o[1])/s]; }});
  const torsoF={to:q=>toW(rot([hip[0]+q[0],hip[1]+q[1]],hip,p.lean)), from:P=>{ const l=rot(toL(P),hip,-p.lean); return [l[0]-hip[0],l[1]-hip[1]]; }};
  const lp=legPts(who,hf,p.fF), dx=lp.ank[0]-hf[0], dy=lp.ank[1]-hf[1];
  const legF={to:([a,u])=>toW([hf[0]+dx*u+lp.px*a, hf[1]+dy*u+lp.py*a]),
              from:P=>{ const l=toL(P), vx=l[0]-hf[0], vy=l[1]-hf[1]; return [vx*lp.px+vy*lp.py, (vx*dx+vy*dy)/(dx*dx+dy*dy)]; }};
  const F={leg:legF, shoe:around(p.fF,1.55), fist:around(p.L,1.55)};
  for(const k of Object.keys(SHAPES.torso[who])) F['torso.'+k]=torsoF;
  return F;
}

