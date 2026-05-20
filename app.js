pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
// ── STATE ──────────────────────────────────────────────────────────────────
let mode='select',scale=1,drawingLoaded=false,origPdfBytes=null,comparePdfBytes=null,origFilename='drawing',cmpRendered=false;
let balloons=[],nextAutoNum=1,bColor='#c8f050',bSize=12;
let step=0,pending=null,mx=0,my=0,selId=null,selIds=new Set(),marquee=null;
let dragState=null,dragMoved=false,wasDragging=false,teTargetId=null,ieTargetId=null;
let shapes=[],selShapeId=null,activeShapeType=null,shDrawState=null,shDragState=null,shDragMoved=false,shWasDragging=false,shTeTargetId=null;
let pdiRows=[],ocrDims=[],pointRows=[];
let pcMode='MAN',pcUnits='MM';
let undoStack=[],redoStack=[];
let eventsbound=false;

// ── HISTORY ────────────────────────────────────────────────────────────────
function saveHistory(){undoStack.push({b:JSON.stringify(balloons),s:JSON.stringify(shapes)});if(undoStack.length>60)undoStack.shift();redoStack=[];updUndoBtns();}
function undo(){if(!undoStack.length)return;redoStack.push({b:JSON.stringify(balloons),s:JSON.stringify(shapes)});applySnap(undoStack.pop());toast('Undo','info');updUndoBtns();}
function redo(){if(!redoStack.length)return;undoStack.push({b:JSON.stringify(balloons),s:JSON.stringify(shapes)});applySnap(redoStack.pop());toast('Redo','info');updUndoBtns();}
function applySnap(sn){balloons=JSON.parse(sn.b);shapes=JSON.parse(sn.s);const fn=balloons.filter(b=>b.pdiRow==null).map(b=>typeof b.num==='number'?b.num:0);nextAutoNum=(fn.length?Math.max(...fn):0)+1;selId=null;selShapeId=null;selIds=new Set();renderBalloons();renderShapeList();redraw();syncStrip();}
function updUndoBtns(){const bu=document.getElementById('btnUndo'),br=document.getElementById('btnRedo');if(bu)bu.disabled=!undoStack.length;if(br)br.disabled=!redoStack.length;}
function saveShHistory(){saveHistory();}

// ── TOAST ──────────────────────────────────────────────────────────────────
let _tt=null;
function toast(msg,type='ok'){const el=document.getElementById('toast');el.textContent=msg;el.className=`toast ${type} show`;clearTimeout(_tt);_tt=setTimeout(()=>el.classList.remove('show'),2400);}

// ── PROGRESS ──────────────────────────────────────────────────────────────
function showProg(v){document.getElementById('prog').classList.add('on');document.getElementById('progFill').style.width=v+'%';}
function hideProg(){setTimeout(()=>{document.getElementById('progFill').style.width='100%';setTimeout(()=>{document.getElementById('prog').classList.remove('on');document.getElementById('progFill').style.width='0%';},300);},200);}

// ── PDF LOAD ──────────────────────────────────────────────────────────────
async function loadDrawing(inp){
  const f=inp.files[0];if(!f)return;
  origFilename=f.name.replace(/\.pdf$/i,'');showProg(10);
  origPdfBytes=await f.arrayBuffer();
  await renderPDF(origPdfBytes,'drawingCanvas',true);
  drawingLoaded=true;
  document.getElementById('dropZone').style.display='none';
  document.getElementById('canvasWrapper').style.display='inline-block';
  ['btnPDF','btnXLSX','btnPCDMIS','btnOCR','ocrBtn','autoBtn','aiScanBtn'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=false;});
  hideProg();bindEvents();toast('Loaded: '+f.name,'ok');inp.value='';
}
async function renderPDF(bytes,canvasId,setAnnot){
  const pdf=await pdfjsLib.getDocument({data:bytes}).promise;
  const page=await pdf.getPage(1);
  const vp=page.getViewport({scale});
  const canvas=document.getElementById(canvasId);
  canvas.width=vp.width;canvas.height=vp.height;
  await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
  if(setAnnot){const ac=document.getElementById('annotationCanvas');ac.width=vp.width;ac.height=vp.height;}
  showProg(75);
}
async function loadCompare(inp){
  const f=inp.files[0];if(!f)return;
  if(!drawingLoaded){toast('Load a drawing first','err');inp.value='';return;}
  showProg(10);comparePdfBytes=await f.arrayBuffer();
  const cc=document.getElementById('compareCanvas');cc.style.display='block';
  await renderPDF(comparePdfBytes,'compareCanvas',false);
  cc.style.opacity=.5;cmpRendered=true;
  document.getElementById('cmpBar').classList.add('on');
  setMode('compare');hideProg();toast('Comparison drawing loaded','ok');inp.value='';
}
function setCmpOpacity(v){document.getElementById('compareCanvas').style.opacity=v;}
function closeCompare(){document.getElementById('compareCanvas').style.display='none';document.getElementById('cmpBar').classList.remove('on');cmpRendered=false;setMode('select');toast('Comparison closed','info');}

// ── ZOOM ──────────────────────────────────────────────────────────────────
function zoom(d){if(!drawingLoaded)return;scale=Math.max(.2,Math.min(4,scale+d));document.getElementById('zoomLbl').textContent=Math.round(scale*100)+'%';reRender();}
function zoomFit(){if(!drawingLoaded)return;const a=document.getElementById('canvasArea'),dc=document.getElementById('drawingCanvas');scale=Math.min((a.clientWidth-48)/(dc.width/scale),1.5);scale=Math.round(scale*4)/4;document.getElementById('zoomLbl').textContent=Math.round(scale*100)+'%';reRender();}
async function reRender(){showProg(20);await renderPDF(origPdfBytes,'drawingCanvas',true);if(cmpRendered&&comparePdfBytes)await renderPDF(comparePdfBytes,'compareCanvas',false);redraw();hideProg();}

// ── MODE ──────────────────────────────────────────────────────────────────
function setMode(m){
  mode=m;document.getElementById('modeInd').textContent=m.toUpperCase();
  const pill=document.getElementById('modePill');
  pill.className='mode-pill '+(m==='shape'?'shape':m==='compare'?'compare':m==='balloon'?'balloon':'select');
  document.getElementById('btnBalloon').classList.toggle('active',m==='balloon');
  document.getElementById('btnSelect').classList.toggle('active',m==='select');
  document.getElementById('btnShape').classList.toggle('active',m==='shape');
  const c=document.getElementById('annotationCanvas');
  if(c)c.style.cursor=(m==='balloon'||m==='shape')?'crosshair':'default';
  if(m!=='balloon'){step=0;pending=null;hideHint();}
  else showHint('Click to place balloon center · Right-click cancel');
}
function swTab(t){
  document.querySelectorAll('.ptab').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.psec').forEach(el=>el.classList.remove('active'));
  document.getElementById('tab-'+t).classList.add('active');
  document.getElementById('sec-'+t).classList.add('active');
  if(t==='pcdmis')updatePCPreview();
}
function showHint(msg){const h=document.getElementById('hint');h.textContent=msg;h.classList.add('on');}
function hideHint(){document.getElementById('hint').classList.remove('on');}

// ── CANVAS EVENTS ─────────────────────────────────────────────────────────
function bindEvents(){
  if(eventsbound)return;eventsbound=true;
  const c=document.getElementById('annotationCanvas');
  c.addEventListener('mousedown',onMD);
  c.addEventListener('mousemove',onMM);
  c.addEventListener('mouseup',onMU);
  c.addEventListener('click',onCk);
  c.addEventListener('dblclick',onDbl);
  c.addEventListener('contextmenu',e=>{e.preventDefault();handleRC();});
  bindShapeEvents(c);
  // keyboard shortcuts
  document.addEventListener('keydown',e=>{
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT')return;
    if(e.key==='p'||e.key==='P')setMode('balloon');
    if(e.key==='s'||e.key==='S')setMode('select');
    if((e.key==='Delete'||e.key==='Backspace')&&mode==='select')delSelected();
    if(e.ctrlKey&&e.key==='z'){e.preventDefault();undo();}
    if(e.ctrlKey&&e.key==='y'){e.preventDefault();redo();}
  });
  // panel resize
  const handle=document.getElementById('resizeHandle'),panel=document.getElementById('sidePanel');
  let resizing=false,startX=0,startW=0;
  handle.addEventListener('mousedown',e=>{resizing=true;startX=e.clientX;startW=panel.offsetWidth;handle.classList.add('dragging');e.preventDefault();});
  document.addEventListener('mousemove',e=>{if(!resizing)return;const newW=Math.max(250,Math.min(600,startW-(e.clientX-startX)));panel.style.width=newW+'px';});
  document.addEventListener('mouseup',()=>{resizing=false;handle.classList.remove('dragging');});
}
function cpos(e){const c=document.getElementById('annotationCanvas'),r=c.getBoundingClientRect();return{x:(e.clientX-r.left)/scale,y:(e.clientY-r.top)/scale};}
function onMD(e){
  if(mode==='shape')return;
  if(mode!=='select'&&mode!=='balloon')return;
  const{x,y}=cpos(e);wasDragging=false;
  for(const b of balloons){if(Math.hypot(b.tx-x,b.ty-y)<10&&b.id===selId){dragState={id:b.id,part:'tip',ox:x,oy:y};dragMoved=false;return;}}
  for(const b of [...balloons].reverse()){if(Math.hypot(b.x-x,b.y-y)<bR(b)+6){dragState={id:b.id,part:'body',ox:x,oy:y,bx:b.x,by:b.y,tx:b.tx,ty:b.ty};dragMoved=false;return;}}
  if(mode==='select')marquee={x1:x,y1:y,x2:x,y2:y};
}
function onMM(e){
  const{x,y}=cpos(e);mx=x;my=y;
  if(dragState){dragMoved=true;wasDragging=true;const b=balloons.find(b=>b.id===dragState.id);if(!b)return;if(dragState.part==='tip'){b.tx=x;b.ty=y;}else{const dx=x-dragState.ox,dy=y-dragState.oy;b.x=dragState.bx+dx;b.y=dragState.by+dy;b.tx=dragState.tx+dx;b.ty=dragState.ty+dy;}redraw();return;}
  if(marquee){marquee.x2=x;marquee.y2=y;redraw();return;}
  if(mode==='balloon')redraw();
}
function onMU(e){
  if(dragState){if(dragMoved)saveHistory();dragState=null;dragMoved=false;redraw();return;}
  if(marquee){
    const{x1,y1,x2,y2}=marquee;const rx=Math.min(x1,x2),ry=Math.min(y1,y2),rw=Math.abs(x2-x1),rh=Math.abs(y2-y1);
    if(rw>5||rh>5){selIds=new Set(balloons.filter(b=>b.x>=rx&&b.x<=rx+rw&&b.y>=ry&&b.y<=ry+rh).map(b=>b.id));selId=selIds.size===1?[...selIds][0]:null;syncStrip();renderBalloons();}
    marquee=null;redraw();return;
  }
}
function onCk(e){if(wasDragging){wasDragging=false;return;}const{x,y}=cpos(e);if(mode==='balloon')handleBalloonClick(x,y);else if(mode==='select')selAt(x,y,e.shiftKey);}
function onDbl(e){const{x,y}=cpos(e);for(const b of [...balloons].reverse()){if(Math.hypot(b.x-x,b.y-y)<bR(b)+8){openIE(b.id,e.clientX,e.clientY);return;}}}
function handleRC(){if(mode==='balloon'){if(step>0){step=0;pending=null;showHint('Click to place balloon center · Right-click cancel');redraw();}}else{selId=null;selIds=new Set();syncStrip();renderBalloons();redraw();}}

// ── BALLOON PLACEMENT ─────────────────────────────────────────────────────
function handleBalloonClick(x,y){
  if(step===0){pending={x,y};step=1;showHint('Click leader tip · Right-click cancel');redraw();}
  else{pending.tx=x;pending.ty=y;if(pdiRows.length>0)showLDD(mx*scale+document.getElementById('annotationCanvas').getBoundingClientRect().left,my*scale+document.getElementById('annotationCanvas').getBoundingClientRect().top);else commit(null);}
}
function getNum(idx){if(idx!=null)return idx+1;const used=new Set(balloons.map(b=>b.num));let n=1;while(used.has(n))n++;return n;}
function commit(idx){
  document.getElementById('ldd').classList.remove('on');saveHistory();
  balloons.push({id:Date.now()+Math.random(),x:pending.x,y:pending.y,tx:pending.tx,ty:pending.ty,num:getNum(idx),pdiRow:idx,color:bColor,numSize:bSize,label:'',labelSize:bSize,labelColor:bColor,labelBold:false,labelItalic:false,labelUnderline:false});
  step=0;pending=null;renderBalloons();redraw();showHint('Click to place balloon center · Right-click cancel');swTab('balloons');
}
function bR(b){return Math.max((b.numSize||bSize)*1.15,14);}

// ── SELECTION ─────────────────────────────────────────────────────────────
function selAt(x,y,shift=false){
  if(!shift){selId=null;selIds=new Set();}
  for(const b of [...balloons].reverse()){if(Math.hypot(b.x-x,b.y-y)<bR(b)+6||Math.hypot(b.tx-x,b.ty-y)<12){if(shift){selIds.has(b.id)?selIds.delete(b.id):selIds.add(b.id);}else selIds=new Set([b.id]);selId=selIds.size===1?[...selIds][0]:null;break;}}
  if(!shift&&selId===null)selIds=new Set();
  syncStrip();renderBalloons();redraw();
}
function syncStrip(){
  const lbl=document.getElementById('stripBadge');if(!lbl)return;
  if(selIds.size>1){const b=balloons.find(b=>selIds.has(b.id));if(b){document.getElementById('balloonColor').value=b.color||bColor;document.getElementById('colorWrap').style.background=b.color||bColor;document.getElementById('balloonSize').value=b.numSize||bSize;}lbl.textContent=selIds.size+' SEL';lbl.className='strip-badge multi';return;}
  if(selId){const b=balloons.find(b=>b.id===selId);if(b){document.getElementById('balloonColor').value=b.color||bColor;document.getElementById('colorWrap').style.background=b.color||bColor;document.getElementById('balloonSize').value=b.numSize||bSize;bColor=b.color||bColor;bSize=b.numSize||bSize;lbl.textContent='SELECTED';lbl.className='strip-badge sel';return;}}
  lbl.textContent='NEW';lbl.className='strip-badge';
}
function updateStyle(){bColor=document.getElementById('balloonColor').value;bSize=parseInt(document.getElementById('balloonSize').value)||12;document.getElementById('colorWrap').style.background=bColor;const tgts=selIds.size>0?balloons.filter(b=>selIds.has(b.id)):selId?[balloons.find(b=>b.id===selId)].filter(Boolean):[];tgts.forEach(b=>{b.color=bColor;b.numSize=bSize;b.labelSize=bSize;b.labelColor=bColor;});redraw();}
function delBalloon(id){saveHistory();balloons=balloons.filter(b=>b.id!==id);if(selId===id)selId=null;renderBalloons();redraw();}
function delSelected(){if(selIds.size>1){saveHistory();const ids=new Set(selIds);balloons=balloons.filter(b=>!ids.has(b.id));selId=null;selIds=new Set();renderBalloons();redraw();return;}if(selId)delBalloon(selId);}
function clearAll(){if(!balloons.length)return;if(!confirm('Clear all balloons?'))return;saveHistory();balloons=[];nextAutoNum=1;selId=null;selIds=new Set();renderBalloons();redraw();}
function renumberAll(){const free=balloons.filter(b=>b.pdiRow==null).sort((a,b)=>Math.abs(a.y-b.y)>20?a.y-b.y:a.x-b.x);if(!free.length){toast('No free balloons','info');return;}saveHistory();free.forEach((b,i)=>b.num=i+1);nextAutoNum=free.length+1;renderBalloons();redraw();toast('Renumbered '+free.length+' balloons','ok');}

// ── DRAW BALLOONS ─────────────────────────────────────────────────────────
function redraw(){
  const c=document.getElementById('annotationCanvas');if(!c)return;
  const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);
  balloons.forEach(b=>drawB(ctx,b));
  if(step===1&&pending)drawPreview(ctx,pending.x,pending.y,mx,my);
  shapes.forEach(s=>drawShape(ctx,s));
  if(shDrawState)drawShapePreview(ctx,shDrawState);
  if(marquee){const rx=Math.min(marquee.x1,marquee.x2),ry=Math.min(marquee.y1,marquee.y2),rw=Math.abs(marquee.x2-marquee.x1),rh=Math.abs(marquee.y2-marquee.y1);ctx.save();ctx.strokeStyle='rgba(200,240,80,.75)';ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.fillStyle='rgba(200,240,80,.04)';ctx.fillRect(rx,ry,rw,rh);ctx.strokeRect(rx,ry,rw,rh);ctx.setLineDash([]);ctx.restore();}
}
function redrawAll(){redraw();}
function drawB(ctx,b){
  const sel=b.id===selId||(selIds.size>1&&selIds.has(b.id));
  const ns=b.numSize||bSize,col=b.color||bColor,R=bR(b),hasLbl=!!(b.label&&b.label.trim());
  ctx.save();
  const ang=Math.atan2(b.ty-b.y,b.tx-b.x),ex=b.x+R*Math.cos(ang),ey=b.y+R*Math.sin(ang);
  ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(b.tx,b.ty);ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.stroke();
  ctx.beginPath();ctx.moveTo(b.tx,b.ty);ctx.lineTo(b.tx-9*Math.cos(ang-.38),b.ty-9*Math.sin(ang-.38));ctx.lineTo(b.tx-9*Math.cos(ang+.38),b.ty-9*Math.sin(ang+.38));ctx.closePath();ctx.fillStyle=col;ctx.fill();
  if(hasLbl){
    const lfs=b.labelSize||ns;const lfStr=(b.labelItalic?'italic ':'')+(b.labelBold?'bold ':'')+lfs+'px IBM Plex Sans,sans-serif';
    ctx.font=lfStr;const lw=ctx.measureText(b.label).width;ctx.font='bold '+ns+'px IBM Plex Sans,sans-serif';const nw=ctx.measureText(String(b.num)).width;
    const bw=Math.max(nw+16,lw+20,R*2),pad=lfs+8,bh=R*2+pad,bx=b.x-bw/2,by=b.y-R;
    rrect(ctx,bx,by,bw,bh,R);ctx.fillStyle=sel?col:'#fff';ctx.fill();ctx.strokeStyle=col;ctx.lineWidth=sel?2.5:2;ctx.stroke();
    ctx.fillStyle=sel?'#000':col;ctx.font='bold '+ns+'px IBM Plex Sans,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(b.num),b.x,b.y);
    ctx.fillStyle=sel?'#000':(b.labelColor||col);ctx.font=lfStr;ctx.fillText(b.label,b.x,b.y+R+pad/2-1);
    if(b.labelUnderline){const tw=ctx.measureText(b.label).width,uly=b.y+R+pad/2+lfs/2;ctx.beginPath();ctx.moveTo(b.x-tw/2,uly);ctx.lineTo(b.x+tw/2,uly);ctx.strokeStyle=sel?'#000':col;ctx.lineWidth=1;ctx.stroke();}
  }else{
    ctx.beginPath();ctx.arc(b.x,b.y,R,0,Math.PI*2);ctx.fillStyle=sel?col:'#fff';ctx.fill();ctx.strokeStyle=col;ctx.lineWidth=sel?2.5:2;ctx.stroke();
    ctx.fillStyle=sel?'#000':col;ctx.font='bold '+ns+'px IBM Plex Sans,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(b.num),b.x,b.y);
  }
  if(b.pdiRow!=null&&pdiRows[b.pdiRow]){const row=pdiRows[b.pdiRow];const lbl=`${row.nom||row.spec||''}${row.upperTol?' +'+row.upperTol:''}`;const pfs=Math.max(ns-3,8);ctx.font=pfs+'px IBM Plex Mono,monospace';const tw=ctx.measureText(lbl).width+10,lh=pfs+7,lx=b.x-tw/2,ly=b.y-R-lh-3;ctx.fillStyle='rgba(255,255,255,.94)';rrect(ctx,lx,ly,tw,lh,4);ctx.fill();ctx.strokeStyle=col;ctx.lineWidth=.7;rrect(ctx,lx,ly,tw,lh,4);ctx.stroke();ctx.fillStyle='#111';ctx.fillText(lbl,b.x,ly+lh/2);}
  if(sel){ctx.beginPath();ctx.arc(b.tx,b.ty,5,0,Math.PI*2);ctx.fillStyle=col;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();ctx.beginPath();ctx.arc(b.x,b.y,R+3,0,Math.PI*2);ctx.strokeStyle=col+'44';ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.stroke();ctx.setLineDash([]);}
  ctx.restore();
}
function drawPreview(ctx,bx,by,tx,ty){const R=Math.max(bSize*1.15,14),col=bColor;ctx.save();ctx.globalAlpha=.5;const ang=Math.atan2(ty-by,tx-bx),ex=bx+R*Math.cos(ang),ey=by+R*Math.sin(ang);ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(tx,ty);ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.setLineDash([5,3]);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(bx,by,R,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle=col;ctx.lineWidth=2;ctx.stroke();ctx.fillStyle=col;ctx.font='bold '+bSize+'px IBM Plex Sans,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('?',bx,by);ctx.restore();}
function rrect(ctx,x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();}

// ── BALLOON LIST ──────────────────────────────────────────────────────────
function renderBalloons(){
  const list=document.getElementById('blist'),badge=document.getElementById('bCount');
  badge.style.display=balloons.length?'inline':'none';badge.textContent=balloons.length;
  const rnbar=document.getElementById('rnbar');rnbar.className=(balloons.length&&balloons.some(b=>b.pdiRow==null))?'rnbar on':'rnbar';
  if(!balloons.length){list.innerHTML='<div class="empty-st"><div class="ei">◎</div>No balloons yet.<br>Switch to <b>Balloon</b> mode and click.</div>';return;}
  const sorted=[...balloons].sort((a,b)=>{const na=typeof a.num==='number'?a.num:parseInt(a.num)||999,nb=typeof b.num==='number'?b.num:parseInt(b.num)||999;return na-nb;});
  list.innerHTML=sorted.map(b=>{
    const isSel=b.id===selId||(selIds.size>1&&selIds.has(b.id));
    const row=b.pdiRow!=null?pdiRows[b.pdiRow]:null;
    const desc=row?(row.param||'Row '+(b.pdiRow+1)):(b.label||'—');
    const vals=row?`nom: ${row.nom||row.spec||'—'} ${row.upperTol?'+'+row.upperTol:''}`:'free balloon';
    return`<div class="bitem${isSel?' sel':''}" onclick="selBById(${b.id})">
      <div class="bnum">${b.num}</div>
      <div class="binfo"><div class="bparam">${esc(desc)}</div><div class="bvals">${esc(vals)}</div></div>
      <div class="bactions">
        <button class="bact link" onclick="event.stopPropagation();openLinkForBalloon(${b.id},event)" title="Link to PPAP row">
          <svg viewBox="0 0 16 16"><path d="M7 9a3 3 0 0 0 4.24.06L13 7.24A3 3 0 0 0 8.76 3L7.5 4.26"/><path d="M9 7a3 3 0 0 0-4.24-.06L3 8.76a3 3 0 0 0 4.24 4.24L8.5 11.74"/></svg>
        </button>
        <button class="bact edit" onclick="event.stopPropagation();openTE(${b.id},event.clientX,event.clientY)" title="Edit">
          <svg viewBox="0 0 16 16"><path d="M11 2l3 3L5 14H2v-3z"/></svg>
        </button>
        <button class="bact del" onclick="event.stopPropagation();delBalloon(${b.id})" title="Delete">
          <svg viewBox="0 0 16 16"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}
function selBById(id){selId=id;selIds=new Set([id]);syncStrip();renderBalloons();redraw();}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}

// ── LINK DROPDOWN ─────────────────────────────────────────────────────────
function showLDD(cx,cy,forceId){
  const dd=document.getElementById('ldd'),opts=document.getElementById('lddOpts');
  opts.innerHTML='';
  const none=document.createElement('div');none.className='lopt';none.innerHTML='<span style="font-style:italic;color:var(--tdim)">No link — free balloon</span>';
  none.onclick=()=>{if(forceId){saveHistory();const b=balloons.find(b=>b.id===forceId);if(b){b.pdiRow=null;b.num=getNum(null);}renderBalloons();redraw();dd.classList.remove('on');}else commit(null);};
  opts.appendChild(none);
  const linked=new Set(balloons.filter(b=>b.pdiRow!=null&&(!forceId||b.id!==forceId)).map(b=>b.pdiRow));
  pdiRows.forEach((row,i)=>{
    const el=document.createElement('div');const used=linked.has(i);el.className='lopt'+(used?' lopt-used':'');
    el.innerHTML=`<div class="lopt-num"${used?' style="opacity:.3"':''}>${i+1}</div><div style="flex:1;font-size:11px;line-height:1.4${used?';opacity:.4':''}"><div style="font-weight:500;color:var(--text)">${esc(row.param||'Row '+(i+1))}</div><div style="color:var(--tdim);font-family:var(--fm);font-size:9px">${row.nom||row.spec||'—'} | ${row.featType||''}</div></div>${used?'<span style="font-size:9px;color:var(--tdim)">linked</span>':''}`;
    if(!used)el.onclick=()=>{if(forceId){saveHistory();const b=balloons.find(b=>b.id===forceId);if(b){b.pdiRow=i;b.num=i+1;}renderBalloons();redraw();dd.classList.remove('on');}else commit(i);};
    opts.appendChild(el);
  });
  dd.style.left=Math.min(cx,window.innerWidth-260)+'px';dd.style.top=Math.min(cy,window.innerHeight-300)+'px';dd.classList.add('on');
  setTimeout(()=>document.addEventListener('click',()=>dd.classList.remove('on'),{once:true}),10);
}
function openLinkForBalloon(id,e){selId=id;selIds=new Set([id]);pending=balloons.find(b=>b.id===id);if(pending)showLDD(e.clientX,e.clientY,id);}

// ── BALLOON EDITORS ───────────────────────────────────────────────────────
function openIE(id,cx,cy){
  ieTargetId=id;const b=balloons.find(b=>b.id===id);if(!b)return;
  document.getElementById('ieNum').value=b.num;const linked=b.pdiRow!=null;document.getElementById('ieNum').readOnly=linked;document.getElementById('ieNum').style.opacity=linked?'.45':'1';document.getElementById('ieLabel').value=b.label||'';
  const ed=document.getElementById('ie'),ac=document.getElementById('annotationCanvas'),rect=ac.getBoundingClientRect();
  const sx=rect.left+b.x*scale,sy=rect.top+b.y*scale;let ex=sx+20,ey=sy-90;
  if(ex+270>window.innerWidth-10)ex=sx-280;if(ex<10)ex=10;if(ey<10)ey=sy+10;
  ed.style.left=ex+'px';ed.style.top=ey+'px';ed.classList.add('on');setTimeout(()=>document.getElementById('ieNum').focus(),30);
}
function closeIE(){document.getElementById('ie').classList.remove('on');ieTargetId=null;}
function applyIE(){if(!ieTargetId)return;const b=balloons.find(b=>b.id===ieTargetId);if(!b)return;saveHistory();if(b.pdiRow==null){const rn=document.getElementById('ieNum').value.trim();b.num=rn!==''?(isNaN(rn)?rn:Number(rn)):b.num;}b.label=document.getElementById('ieLabel').value.trim();closeIE();renderBalloons();redraw();}
function openTE(id,cx,cy){
  teTargetId=id;const b=balloons.find(b=>b.id===id);if(!b)return;
  const linked=b.pdiRow!=null;document.getElementById('teNum').value=b.num;document.getElementById('teNum').readOnly=linked;document.getElementById('teNum').style.opacity=linked?'.45':'1';
  document.getElementById('teLabel').value=b.label||'';document.getElementById('teSize').value=b.numSize||bSize;
  const col=b.color||bColor;document.getElementById('teColor').value=col;document.getElementById('teColorW').style.background=col;
  setFmt('teBold',!!b.labelBold);setFmt('teItalic',!!b.labelItalic);setFmt('teUnder',!!b.labelUnderline);
  posTE('teB',cx,cy);document.getElementById('teB').classList.add('on');setTimeout(()=>document.getElementById('teNum').focus(),40);
}
function closeTE(){document.getElementById('teB').classList.remove('on');teTargetId=null;}
function applyTE(){if(!teTargetId)return;const b=balloons.find(b=>b.id===teTargetId);if(!b)return;saveHistory();const rn=document.getElementById('teNum').value.trim();if(b.pdiRow==null)b.num=rn!==''?(isNaN(rn)?rn:Number(rn)):b.num;b.label=document.getElementById('teLabel').value.trim();b.labelSize=b.numSize=Math.max(6,parseInt(document.getElementById('teSize').value)||bSize);b.labelColor=b.color=document.getElementById('teColor').value;b.labelBold=document.getElementById('teBold').classList.contains('on');b.labelItalic=document.getElementById('teItalic').classList.contains('on');b.labelUnderline=document.getElementById('teUnder').classList.contains('on');closeTE();syncStrip();renderBalloons();redraw();}
function tfmt(f){document.getElementById('te'+f).classList.toggle('on');}
function setFmt(id,v){document.getElementById(id).classList.toggle('on',v);}
function posTE(id,cx,cy){const el=document.getElementById(id);let ex=cx,ey=cy;if(ex+310>window.innerWidth-12)ex=window.innerWidth-322;if(ex<12)ex=12;if(ey+280>window.innerHeight-12)ey=cy-290;if(ey<12)ey=12;el.style.left=ex+'px';el.style.top=ey+'px';}

// ── SHAPES ────────────────────────────────────────────────────────────────
let shStyle={stroke:'#c8f050',fill:'#c8f050',fillOn:false,weight:2,dash:'solid'};

function shStyleCh(){
  shStyle.stroke=document.getElementById('shStroke').value;
  shStyle.fill=document.getElementById('shFill').value;
  shStyle.fillOn=document.getElementById('shFillOn').checked;
  shStyle.weight=parseFloat(document.getElementById('shW').value)||2;
  shStyle.dash=document.getElementById('shDash').value;
  document.getElementById('shStrokeWrap').style.background=shStyle.stroke;
  document.getElementById('shFillWrap').style.background=shStyle.fill;
  if(selShapeId){const s=shapes.find(s=>s.id===selShapeId);if(s){s.style={...shStyle};redraw();}}
}

function pickShape(type){
  activeShapeType=type;setMode('shape');
  document.querySelectorAll('.sh-pick').forEach(el=>el.classList.toggle('active',el.dataset.shape===type));
  const hints={rect:'Click and drag to draw rectangle',circle:'Click and drag to draw ellipse',line:'Click to set start · click to set end',arrow:'Click to set start · click to set end',freehand:'Click and drag to draw freehand',cloud:'Click and drag to draw revision cloud',revtri:'Click to place revision triangle',datum:'Click to place datum symbol',weld:'Click to place weld symbol',dim:'Click and drag for dimension line',gdt:'Click and drag for GD&T box',cpl:'Click and drag for cutting plane'};
  const hint=document.getElementById('shHint');hint.textContent=hints[type]||'Click to place';hint.style.display='block';
}

function bindShapeEvents(c){
  c.addEventListener('mousedown',shMD);
  c.addEventListener('mousemove',shMM);
  c.addEventListener('mouseup',shMU);
  c.addEventListener('click',shCk);
}

function shMD(e){
  if(mode!=='shape')return;
  const{x,y}=cpos(e);shWasDragging=false;
  // check select existing shape
  if(!activeShapeType){
    for(const s of [...shapes].reverse()){
      if(shHitTest(s,x,y)){selShapeId=s.id;shDragState={id:s.id,ox:x,oy:y,x1:s.x1,y1:s.y1,x2:s.x2,y2:s.y2};shDragMoved=false;renderShapeList();redraw();return;}
    }
    selShapeId=null;renderShapeList();redraw();return;
  }
  const type=activeShapeType;
  if(['line','arrow','dim'].includes(type)){shDrawState={type,x1:x,y1:y,x2:x,y2:y,style:{...shStyle}};return;}
  if(type==='freehand'){shDrawState={type,points:[[x,y]],x1:x,y1:y,x2:x,y2:y,style:{...shStyle}};return;}
  shDrawState={type,x1:x,y1:y,x2:x,y2:y,style:{...shStyle}};
}

function shMM(e){
  if(mode!=='shape')return;
  const{x,y}=cpos(e);
  if(shDragState){
    shDragMoved=true;shWasDragging=true;
    const s=shapes.find(s=>s.id===shDragState.id);if(!s)return;
    const dx=x-shDragState.ox,dy=y-shDragState.oy;
    s.x1=shDragState.x1+dx;s.y1=shDragState.y1+dy;s.x2=shDragState.x2+dx;s.y2=shDragState.y2+dy;
    redraw();return;
  }
  if(!shDrawState)return;
  if(shDrawState.type==='freehand'){shDrawState.points.push([x,y]);shDrawState.x2=x;shDrawState.y2=y;}
  else{shDrawState.x2=x;shDrawState.y2=y;}
  redraw();
}

function shMU(e){
  if(mode!=='shape')return;
  if(shDragState){if(shDragMoved)saveHistory();shDragState=null;shDragMoved=false;redraw();return;}
  if(!shDrawState)return;
  const{x,y}=cpos(e);
  shDrawState.x2=x;shDrawState.y2=y;
  const dx=Math.abs(shDrawState.x2-shDrawState.x1),dy=Math.abs(shDrawState.y2-shDrawState.y1);
  // single-click shapes (no drag needed)
  const singleClick=['revtri','datum','weld'];
  if(!singleClick.includes(shDrawState.type)&&dx<4&&dy<4){shDrawState=null;return;}
  commitShape(shDrawState);
  shDrawState=null;
}

function shCk(e){
  if(mode!=='shape')return;
  const{x,y}=cpos(e);
  const singleClick=['revtri','datum','weld'];
  if(activeShapeType&&singleClick.includes(activeShapeType)){
    commitShape({type:activeShapeType,x1:x-20,y1:y-20,x2:x+20,y2:y+20,style:{...shStyle}});
  }
}

function commitShape(sd){
  saveHistory();
  const s={id:Date.now()+Math.random(),type:sd.type,x1:sd.x1,y1:sd.y1,x2:sd.x2,y2:sd.y2,style:{...sd.style},label:'',points:sd.points||null};
  shapes.push(s);selShapeId=s.id;
  renderShapeList();redraw();
  // open label editor for types that typically have text
  if(['gdt','dim'].includes(sd.type)){
    const mid=[(sd.x1+sd.x2)/2,(sd.y1+sd.y2)/2];
    const ac=document.getElementById('annotationCanvas'),rect=ac.getBoundingClientRect();
    openSTE(s.id,rect.left+mid[0]*scale,rect.top+mid[1]*scale);
  }
}

function shHitTest(s,x,y){
  const px=Math.min(s.x1,s.x2),py=Math.min(s.y1,s.y2),pw=Math.abs(s.x2-s.x1),ph=Math.abs(s.y2-s.y1);
  return x>=px-8&&x<=px+pw+8&&y>=py-8&&y<=py+ph+8;
}

function drawShape(ctx,s){
  const sel=s.id===selShapeId;
  ctx.save();
  applyShStyle(ctx,s.style,sel);
  _drawShapeGeom(ctx,s,false);
  if(sel){ctx.strokeStyle='rgba(240,160,80,.5)';ctx.lineWidth=1;ctx.setLineDash([4,3]);const px=Math.min(s.x1,s.x2)-6,py=Math.min(s.y1,s.y2)-6,pw=Math.abs(s.x2-s.x1)+12,ph=Math.abs(s.y2-s.y1)+12;ctx.strokeRect(px,py,pw,ph);ctx.setLineDash([]);}
  if(s.label){
    ctx.fillStyle=s.style.stroke||'#c8f050';ctx.font='bold 11px IBM Plex Sans,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(s.label,(s.x1+s.x2)/2,(s.y1+s.y2)/2);
  }
  ctx.restore();
}

function drawShapePreview(ctx,sd){
  ctx.save();ctx.globalAlpha=.65;
  applyShStyle(ctx,sd.style,false);
  _drawShapeGeom(ctx,sd,true);
  ctx.restore();
}

function applyShStyle(ctx,st,sel){
  ctx.strokeStyle=st.stroke||'#c8f050';
  ctx.lineWidth=(st.weight||2)*(sel?1.4:1);
  if(st.dash==='dashed')ctx.setLineDash([8,4]);
  else if(st.dash==='dotted')ctx.setLineDash([2,3]);
  else ctx.setLineDash([]);
  ctx.fillStyle=st.fillOn?(st.fill+'55'):'transparent';
}

function _drawShapeGeom(ctx,s,preview){
  const x1=s.x1,y1=s.y1,x2=s.x2,y2=s.y2;
  const cx=(x1+x2)/2,cy=(y1+y2)/2,w=x2-x1,h=y2-y1,rw=Math.abs(w)/2,rh=Math.abs(h)/2;
  switch(s.type){
    case'rect':
      ctx.beginPath();ctx.rect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(w),Math.abs(h));
      if(s.style.fillOn)ctx.fill();ctx.stroke();break;
    case'circle':
      ctx.beginPath();ctx.ellipse(cx,cy,rw||10,rh||10,0,0,Math.PI*2);
      if(s.style.fillOn)ctx.fill();ctx.stroke();break;
    case'line':
      ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();break;
    case'arrow':{
      ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
      const ang=Math.atan2(y2-y1,x2-x1),al=12;
      ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-al*Math.cos(ang-.4),y2-al*Math.sin(ang-.4));ctx.lineTo(x2-al*Math.cos(ang+.4),y2-al*Math.sin(ang+.4));ctx.closePath();ctx.fillStyle=s.style.stroke||'#c8f050';ctx.fill();break;}
    case'freehand':
      if(s.points&&s.points.length>1){ctx.beginPath();ctx.moveTo(s.points[0][0],s.points[0][1]);s.points.forEach(p=>ctx.lineTo(p[0],p[1]));ctx.stroke();}break;
    case'cloud':{
      ctx.beginPath();
      const steps=Math.max(8,Math.round((Math.abs(w)+Math.abs(h))/30)),bumpR=16;
      const perim=2*(Math.abs(w)+Math.abs(h)),bumpCount=Math.max(6,Math.round(perim/(bumpR*2)));
      // simplified cloud: ellipse with bumpy outline via arc segments
      ctx.ellipse(cx,cy,rw+8,rh+8,0,0,Math.PI*2);ctx.stroke();
      // inner bumps
      for(let i=0;i<bumpCount;i++){const a=i/bumpCount*Math.PI*2,r1=Math.max(rw,rh)+6;ctx.beginPath();ctx.arc(cx+r1*.85*Math.cos(a),cy+r1*.65*Math.sin(a),bumpR*.7,0,Math.PI*2);ctx.stroke();}
      break;}
    case'revtri':{
      ctx.beginPath();ctx.moveTo(cx,y1);ctx.lineTo(x2,y2);ctx.lineTo(x1,y2);ctx.closePath();
      if(s.style.fillOn)ctx.fill();ctx.stroke();break;}
    case'datum':{
      ctx.beginPath();ctx.arc(cx,cy,Math.min(rw,rh)||16,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(x1,cy);ctx.lineTo(x2,cy);ctx.stroke();break;}
    case'weld':{
      const wr=Math.min(rw,rh)||12;
      ctx.beginPath();ctx.moveTo(cx,cy-wr);ctx.lineTo(cx+wr,cy+wr);ctx.lineTo(cx-wr,cy+wr);ctx.closePath();ctx.stroke();
      ctx.beginPath();ctx.moveTo(cx,cy+wr);ctx.lineTo(cx,cy+wr*2.2);ctx.stroke();break;}
    case'dim':{
      ctx.beginPath();ctx.moveTo(x1,y2);ctx.lineTo(x2,y2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x1,y2+6);ctx.stroke();
      ctx.beginPath();ctx.moveTo(x2,y1);ctx.lineTo(x2,y2+6);ctx.stroke();
      // arrows
      const aw=8;
      ctx.beginPath();ctx.moveTo(x1,y2);ctx.lineTo(x1+aw,y2-4);ctx.lineTo(x1+aw,y2+4);ctx.closePath();ctx.fillStyle=s.style.stroke;ctx.fill();
      ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-aw,y2-4);ctx.lineTo(x2-aw,y2+4);ctx.closePath();ctx.fill();
      break;}
    case'gdt':{
      const cols=[Math.min(x1,x2),Math.min(x1,x2)+Math.abs(w)*0.3,Math.min(x1,x2)+Math.abs(w)*0.6,Math.max(x1,x2)];
      const ty=Math.min(y1,y2),bh2=Math.abs(h)||24;
      ctx.beginPath();ctx.rect(cols[0],ty,Math.abs(w),bh2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(cols[1],ty);ctx.lineTo(cols[1],ty+bh2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(cols[2],ty);ctx.lineTo(cols[2],ty+bh2);ctx.stroke();
      break;}
    case'cpl':{
      ctx.setLineDash([12,4,4,4]);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.setLineDash([]);
      // end arrows
      const ang2=Math.atan2(y2-y1,x2-x1),al2=10;
      [[x1,y1,ang2+Math.PI],[x2,y2,ang2]].forEach(([px,py,a])=>{
        ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px-al2*Math.cos(a-.4),py-al2*Math.sin(a-.4));ctx.lineTo(px-al2*Math.cos(a+.4),py-al2*Math.sin(a+.4));ctx.closePath();ctx.fillStyle=s.style.stroke;ctx.fill();
      });break;}
  }
}

function renderShapeList(){
  const list=document.getElementById('slist');
  if(!shapes.length){list.innerHTML='<div class="empty-st"><div class="ei">▱</div>No shapes yet.</div>';return;}
  const typeLabel={rect:'Rectangle',circle:'Ellipse',line:'Line',arrow:'Arrow',freehand:'Freehand',cloud:'Revision Cloud',revtri:'Rev Triangle',datum:'Datum',weld:'Weld Symbol',dim:'Dimension',gdt:'GD&T Box',cpl:'Cutting Plane'};
  list.innerHTML=[...shapes].reverse().map(s=>`<div class="sitem${s.id===selShapeId?' sel':''}" onclick="selShape(${s.id})">
    <div style="width:10px;height:10px;border-radius:2px;background:${s.style.stroke};flex-shrink:0"></div>
    <span class="slbl">${typeLabel[s.type]||s.type}${s.label?' — '+s.label:''}</span>
    <button class="sdel" onclick="event.stopPropagation();delShape(${s.id})">✕</button>
  </div>`).join('');
}

function selShape(id){selShapeId=id;renderShapeList();redraw();}
function delShape(id){saveHistory();shapes=shapes.filter(s=>s.id!==id);if(selShapeId===id)selShapeId=null;renderShapeList();redraw();}

// ── SHAPE TEXT EDITOR ─────────────────────────────────────────────────────
function openSTE(id,cx,cy){
  shTeTargetId=id;const s=shapes.find(s=>s.id===id);if(!s)return;
  document.getElementById('stText').value=s.label||'';
  document.getElementById('stSize').value=s.labelSize||11;
  setFmt('stBold',!!s.labelBold);setFmt('stItalic',!!s.labelItalic);
  posTE('teS',cx,cy);document.getElementById('teS').classList.add('on');
  setTimeout(()=>document.getElementById('stText').focus(),40);
}
function closeSTE(){document.getElementById('teS').classList.remove('on');shTeTargetId=null;}
function applySTE(){
  if(!shTeTargetId)return;const s=shapes.find(s=>s.id===shTeTargetId);if(!s)return;
  saveHistory();
  s.label=document.getElementById('stText').value.trim();
  s.labelSize=parseInt(document.getElementById('stSize').value)||11;
  s.labelBold=document.getElementById('stBold').classList.contains('on');
  s.labelItalic=document.getElementById('stItalic').classList.contains('on');
  closeSTE();renderShapeList();redraw();
}
function stfmt(f){document.getElementById('st'+f).classList.toggle('on');}

// ── PPAP TABLE ────────────────────────────────────────────────────────────
const FT=['length','diameter','radius','angle','position','flatness','roundness','perpendicularity','parallelism','runout','profile','cylindricity','thread','surface','attribute'];
const GT=['CMM','Caliper','Micrometer','Gauge Pin','Thread Gauge','Surface Plate','Height Gauge','CMM DCC','Manual Gauge','Attribute'];
const FR=['100%','Every Part','Sample 5','Sample 10','Setup','First-off'];
function addPPAPRow(param,ft,nom,uTol,lTol,gauge,freq,result){
  pdiRows.push({id:Date.now()+Math.random(),param:param||'',featType:ft||'length',nom:nom!=null?nom:'',spec:nom!=null?String(nom):'',upperTol:uTol!=null?uTol:'',lowerTol:lTol!=null?lTol:'',s1:uTol!=null?String(uTol):'',s2:lTol!=null?String(lTol):'',gaugeType:gauge||'CMM',freq:freq||'100%',result:result||'TBD'});
  renderPPAP();updPCount();
}
function delPPAPRow(i){pdiRows.splice(i,1);renderPPAP();updPCount();}
function updPCount(){const b=document.getElementById('pCount');b.style.display=pdiRows.length?'inline':'none';b.textContent=pdiRows.length;}
function upPPAP(i,k,v){pdiRows[i][k]=v;if(k==='nom')pdiRows[i].spec=v;if(k==='upperTol')pdiRows[i].s1=v;if(k==='lowerTol')pdiRows[i].s2=v;renderBalloons();redraw();updatePCPreview();}
function renderPPAP(){
  const tb=document.getElementById('ppapBody'),hint=document.getElementById('ppapHint');hint.style.display=pdiRows.length?'none':'block';tb.innerHTML='';
  pdiRows.forEach((row,i)=>{
    const tr=document.createElement('tr');
    const ftO=FT.map(f=>`<option value="${f}"${row.featType===f?' selected':''}>${f.slice(0,9)}</option>`).join('');
    const gO=GT.map(g=>`<option value="${g}"${row.gaugeType===g?' selected':''}>${g}</option>`).join('');
    const fO=FR.map(f=>`<option value="${f}"${row.freq===f?' selected':''}>${f}</option>`).join('');
    tr.innerHTML=`<td style="color:var(--tdim);font-family:var(--fm);font-size:9px;text-align:center;width:16px">${i+1}</td>
      <td><input value="${esc(row.param)}" onchange="upPPAP(${i},'param',this.value)" placeholder="Feature" style="min-width:80px"></td>
      <td><select onchange="upPPAP(${i},'featType',this.value)">${ftO}</select></td>
      <td><input value="${esc(row.nom||row.spec)}" onchange="upPPAP(${i},'nom',this.value)" placeholder="0.00" style="min-width:40px"></td>
      <td><input value="${esc(row.upperTol||row.s1)}" onchange="upPPAP(${i},'upperTol',this.value)" placeholder="+0.1" style="min-width:36px"></td>
      <td><input value="${esc(row.lowerTol||row.s2)}" onchange="upPPAP(${i},'lowerTol',this.value)" placeholder="-0.1" style="min-width:36px"></td>
      <td><select onchange="upPPAP(${i},'gaugeType',this.value)">${gO}</select></td>
      <td><select onchange="upPPAP(${i},'freq',this.value)">${fO}</select></td>
      <td><select onchange="upPPAP(${i},'result',this.value)" style="min-width:50px"><option value="PASS"${row.result==='PASS'?' selected':''}>PASS</option><option value="FAIL"${row.result==='FAIL'?' selected':''}>FAIL</option><option value="TBD"${row.result==='TBD'?' selected':''}>TBD</option></select></td>
      <td><button class="pdi-del" onclick="delPPAPRow(${i})">✕</button></td>`;
    tb.appendChild(tr);
  });
}
function importPPAP(inp){
  const f=inp.files[0];if(!f)return;const reader=new FileReader();
  reader.onload=e=>{try{const wb=XLSX.read(e.target.result,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];const data=XLSX.utils.sheet_to_json(ws,{defval:''});data.forEach(row=>addPPAPRow(row['Description']||row['Param']||row['Feature']||'',row['Type']||'length',row['Nominal']||row['Nom']||'',row['+Tol']||row['UpperTol']||'',row['-Tol']||row['LowerTol']||'',row['Gauge']||'CMM',row['Freq']||'100%',row['Result']||'TBD'));toast('Imported '+data.length+' rows','ok');}catch(err){toast('Import failed: '+err.message,'err');}};
  reader.readAsArrayBuffer(f);inp.value='';
}

// ── AI SCAN ───────────────────────────────────────────────────────────────
async function runAIScan(){
  if(!drawingLoaded){toast('Load a drawing first','err');return;}
  const apiKey=document.getElementById('aiApiKey').value.trim();
  if(!apiKey){toast('Enter your Claude API key first','err');document.getElementById('aiApiKey').focus();return;}
  const st=document.getElementById('ocrSt');
  st.className='ocr-st run';st.textContent='⏳ AI scanning drawing…';
  const canvas=document.getElementById('drawingCanvas');
  const imgData=canvas.toDataURL('image/jpeg',0.92).split(',')[1];
  const cw=canvas.width,ch=canvas.height;
  try{
    const resp=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({
        model:'claude-opus-4-5',
        max_tokens:2000,
        messages:[{role:'user',content:[
          {type:'image',source:{type:'base64',media_type:'image/jpeg',data:imgData}},
          {type:'text',text:`You are an expert at reading 2D engineering drawings. Analyze this drawing and extract every dimension, tolerance, note and GD&T callout you can find.

For each item return a JSON array. Each element must have:
- "label": short description of what this dimension/feature is (e.g. "Hole diameter", "Overall length", "Thread spec")
- "type": one of: length, diameter, radius, angle, position, flatness, roundness, perpendicularity, parallelism, runout, profile, cylindricity, thread, surface, note
- "nom": nominal value as a number (0 if not applicable)
- "upperTol": upper tolerance as positive number (null if none)
- "lowerTol": lower tolerance as negative number (null if none)  
- "raw": the exact text as it appears on the drawing
- "xPct": estimated X position of this callout as a percentage of total image width (0-100)
- "yPct": estimated Y position of this callout as a percentage of total image height (0-100)

Return ONLY valid JSON array, no other text. Example:
[{"label":"Bore diameter","type":"diameter","nom":25.4,"upperTol":0.05,"lowerTol":-0.05,"raw":"Ø25.4 ±0.05","xPct":42,"yPct":31}]`}
        ]}]
      })
    });
    const data=await resp.json();
    if(data.error){throw new Error(data.error.message);}
    const text=data.content[0].text.trim();
    const cleaned=text.replace(/^```json\n?/,'').replace(/\n?```$/,'').trim();
    const items=JSON.parse(cleaned);
    ocrDims=items.map((item,i)=>({
      id:i+1,
      raw:item.raw||item.label||'',
      type:item.type||'length',
      nom:item.nom||0,
      tol:item.upperTol||null,
      prefix:'',
      assigned:false,
      cx:item.xPct!=null?(item.xPct/100)*cw/scale:null,
      cy:item.yPct!=null?(item.yPct/100)*ch/scale:null,
      label:item.label||'',
      upperTol:item.upperTol,
      lowerTol:item.lowerTol
    }));
    st.className='ocr-st ok';st.textContent=`✓ AI found ${ocrDims.length} dimension(s) — click Auto-Place Balloons`;
    renderOCRDims();toast('AI scan complete: '+ocrDims.length+' items found','ok');
  }catch(err){
    st.className='ocr-st err';st.textContent='✗ AI scan failed: '+err.message;
    toast('AI scan failed: '+err.message,'err');
  }
}

// Keep basic OCR as fallback
async function runOCR(){
  if(!drawingLoaded){toast('Load a drawing first','err');return;}
  const st=document.getElementById('ocrSt');st.className='ocr-st run';st.textContent='⏳ Running OCR…';
  try{
    const canvas=document.getElementById('drawingCanvas');
    const result=await Tesseract.recognize(canvas.toDataURL('image/png'),'eng',{logger:m=>{if(m.status==='recognizing text')st.textContent=`⏳ OCR: ${Math.round(m.progress*100)}%`;}});
    const wordBoxes=[];
    (result.data.words||[]).forEach(w=>{
      if(w.bbox)wordBoxes.push({text:w.text,x:(w.bbox.x0+w.bbox.x1)/2/scale,y:(w.bbox.y0+w.bbox.y1)/2/scale});
    });
    ocrDims=parseDims(result.data.text);
    ocrDims.forEach(d=>{
      const numStr=String(d.nom);
      const match=wordBoxes.find(w=>w.text.replace(/[^0-9.]/g,'').includes(numStr.replace(/[^0-9.]/g,'').slice(0,4)));
      d.cx=match?match.x:null; d.cy=match?match.y:null;
    });
    st.className='ocr-st ok';st.textContent=`✓ Basic OCR done — ${ocrDims.length} found. For better results use AI Scan above.`;
    renderOCRDims();toast('OCR: '+ocrDims.length+' dimensions found','ok');
  }catch(err){st.className='ocr-st err';st.textContent='✗ OCR failed: '+err.message;toast('OCR failed','err');}
}

function autoPlaceBalloons(){
  if(!ocrDims.length){toast('Run AI Scan or OCR first','err');return;}
  const placeable=ocrDims.filter(d=>!d.assigned&&d.cx!=null);
  if(!placeable.length){toast('No positionable dims found — try AI Scan for better results','info');return;}
  saveHistory();
  placeable.forEach(d=>{
    const idx=pdiRows.length;
    const uTol=d.upperTol!=null?d.upperTol:(d.tol||null);
    const lTol=d.lowerTol!=null?d.lowerTol:(d.tol?-d.tol:null);
    addPPAPRow(d.label||d.raw,d.type,d.nom,uTol,lTol,'CMM','100%','TBD');
    balloons.push({id:Date.now()+Math.random(),x:d.cx+45,y:d.cy-45,tx:d.cx,ty:d.cy,num:idx+1,pdiRow:idx,color:bColor,numSize:bSize,label:'',labelSize:bSize,labelColor:bColor,labelBold:false,labelItalic:false,labelUnderline:false});
    d.assigned=true;
  });
  renderBalloons();renderOCRDims();redraw();swTab('balloons');
  toast('Auto-placed '+placeable.length+' balloons','ok');
}
function parseDims(text){
  const dims=[],seen=new Set();
  const push=(raw,type,nom,tol,prefix)=>{const key=type+'-'+nom;if(seen.has(key))return;seen.add(key);dims.push({id:dims.length+1,raw:raw.trim(),type,nom,tol:tol||null,prefix:prefix||'',assigned:false});};
  let m;
  const re1=/[⌀ØΦ]\s*(\d+\.?\d*)\s*[±]\s*(\d+\.?\d*)/g;while((m=re1.exec(text))!==null)push(m[0],'diameter',parseFloat(m[1]),parseFloat(m[2]),'⌀');
  const re2=/[⌀ØΦ]\s*(\d+\.?\d*)/g;while((m=re2.exec(text))!==null)push(m[0],'diameter',parseFloat(m[1]),null,'⌀');
  const re3=/(\d+\.?\d{1,4})\s*±\s*(\d+\.?\d{1,4})/g;while((m=re3.exec(text))!==null)push(m[0],'length',parseFloat(m[1]),parseFloat(m[2]),'');
  const re4=/(\d+\.?\d{1,4})\s*\+(\d+\.?\d{1,4})\s*[\/\-](\d+\.?\d{1,4})/g;while((m=re4.exec(text))!==null)push(m[0],'length',parseFloat(m[1]),parseFloat(m[2]),'');
  const re5=/(\d+\.?\d*)\s*°/g;while((m=re5.exec(text))!==null)push(m[0],'angle',parseFloat(m[1]),null,'∠');
  const re6=/R\s*(\d+\.?\d*)/gi;while((m=re6.exec(text))!==null)push(m[0],'radius',parseFloat(m[1]),null,'R');
  const re7=/M(\d+(?:\.\d+)?)\s*x\s*(\d+\.?\d*)/gi;while((m=re7.exec(text))!==null)push(m[0],'thread',parseFloat(m[1]),null,'M');
  const re8=/(?<![.\d])(\d{1,3}\.\d{2,4})(?![.\d])/g;while((m=re8.exec(text))!==null){const v=parseFloat(m[1]);if(v>0.01&&v<10000)push(m[0],'length',v,null,'');}
  const re9=/[⊕⊘○□⊥∥△▽]\s*(\d+\.?\d*)/g;const gdt={'⊕':'position','⊘':'diameter','○':'roundness','□':'squareness','⊥':'perpendicularity','∥':'parallelism','△':'angularity','▽':'surface'};while((m=re9.exec(text))!==null)push(m[0],gdt[m[0][0]]||'gdt',parseFloat(m[1]),null,m[0][0]);
  return dims.slice(0,60);
}
function renderOCRDims(){
  const list=document.getElementById('dimList');
  if(!ocrDims.length){list.innerHTML='<div class="empty-st"><div class="ei">🔍</div>No dimensions detected.<br>Try better zoom or a cleaner drawing.</div>';return;}
  list.innerHTML=ocrDims.map((d,i)=>`<div class="dim-item${d.assigned?' done':''}" onclick="ocrAdd(${i})">
    <div class="dim-n">${d.id}</div>
    <div style="flex:1"><div class="dim-text">${esc(d.raw)}</div>
    <div class="dim-tags"><span class="tag n">${d.prefix}${d.nom}</span>${d.tol!=null?`<span class="tag t">±${d.tol}</span>`:''}<span class="tag k">${d.type}</span>${d.assigned?'<span class="tag s">✓ added</span>':''}</div></div></div>`).join('');
}
function ocrAdd(idx){const d=ocrDims[idx];if(d.assigned){toast('Already added','info');return;}addPPAPRow(d.raw,d.type,d.nom,d.tol,d.tol?-d.tol:null,'CMM','100%','TBD');d.assigned=true;renderOCRDims();toast('Added to PPAP: '+d.raw,'ok');swTab('ppap');}

// ── POINT TABLE ───────────────────────────────────────────────────────────
function addPoint(id,label,x,y,z,ii,j,k,tol){
  const n=pointRows.length+1;
  pointRows.push({id:Date.now()+Math.random(),ptId:id||'P'+n,label:label||'',x:x!=null?x:'',y:y!=null?y:'',z:z!=null?z:'',i:ii!=null?ii:'0',j:j!=null?j:'0',k:k!=null?k:'1',tol:tol!=null?tol:'0.1'});
  renderPT();
}
function delPoint(i){pointRows.splice(i,1);renderPT();}
function upPt(i,k,v){pointRows[i][k]=v;}
function clearPoints(){if(!pointRows.length)return;if(confirm('Clear all points?')){pointRows=[];renderPT();}}
function renderPT(){
  const tb=document.getElementById('ptBody'),hint=document.getElementById('ptHint');hint.style.display=pointRows.length?'none':'block';
  tb.innerHTML=pointRows.map((r,i)=>`<tr>
    <td><input value="${esc(r.ptId)}" onchange="upPt(${i},'ptId',this.value)" style="width:32px"></td>
    <td><input value="${esc(r.label)}" onchange="upPt(${i},'label',this.value)" style="min-width:55px"></td>
    <td><input value="${esc(r.x)}" onchange="upPt(${i},'x',this.value)"></td>
    <td><input value="${esc(r.y)}" onchange="upPt(${i},'y',this.value)"></td>
    <td><input value="${esc(r.z)}" onchange="upPt(${i},'z',this.value)"></td>
    <td><input value="${esc(r.i)}" onchange="upPt(${i},'i',this.value)" style="min-width:32px"></td>
    <td><input value="${esc(r.j)}" onchange="upPt(${i},'j',this.value)" style="min-width:32px"></td>
    <td><input value="${esc(r.k)}" onchange="upPt(${i},'k',this.value)" style="min-width:32px"></td>
    <td><input value="${esc(r.tol)}" onchange="upPt(${i},'tol',this.value)" style="min-width:34px"></td>
    <td><button class="pdi-del" onclick="delPoint(${i})">✕</button></td></tr>`).join('');
}

// ── PC-DMIS ───────────────────────────────────────────────────────────────
function setPCMode(m){pcMode=m;document.getElementById('pcMAN').classList.toggle('on',m==='MAN');document.getElementById('pcDCC').classList.toggle('on',m==='DCC');updatePCPreview();}
function setPCUnits(u){pcUnits=u;document.getElementById('pcMM').classList.toggle('on',u==='MM');document.getElementById('pcIN').classList.toggle('on',u==='INCH');updatePCPreview();}
function getPCCfg(){return{pn:document.getElementById('pc-pn').value.trim()||origFilename,rev:document.getElementById('pc-rev').value.trim()||'A',op:document.getElementById('pc-op').value.trim(),mach:document.getElementById('pc-mach').value.trim(),mode:pcMode,units:pcUnits,cx:parseFloat(document.getElementById('pc-cx').value)||100,cy:parseFloat(document.getElementById('pc-cy').value)||100,cz:parseFloat(document.getElementById('pc-cz').value)||100,probe:parseFloat(document.getElementById('pc-probe').value)||1.0};}
const FMAP={length:{ft:'POINT',dt:'DISTANCE',px:'PNT',cnt:2},diameter:{ft:'CIRCLE',dt:'DIAMETER',px:'CIR',cnt:4},radius:{ft:'CIRCLE',dt:'RADIUS',px:'CIR',cnt:4},angle:{ft:'LINE',dt:'ANGLE',px:'LIN',cnt:4},position:{ft:'CIRCLE',dt:'TRUE_POSITION',px:'CIR',cnt:4},flatness:{ft:'PLANE',dt:'FLATNESS',px:'PLN',cnt:9},roundness:{ft:'CIRCLE',dt:'ROUNDNESS',px:'CIR',cnt:4},perpendicularity:{ft:'PLANE',dt:'PERPENDICULARITY',px:'PLN',cnt:9},parallelism:{ft:'PLANE',dt:'PARALLELISM',px:'PLN',cnt:9},runout:{ft:'CIRCLE',dt:'CIRCULAR_RUN_OUT',px:'CIR',cnt:4},profile:{ft:'PLANE',dt:'PROFILE',px:'PLN',cnt:9},cylindricity:{ft:'CYLINDER',dt:'CYLINDRICITY',px:'CYL',cnt:8},thread:{ft:'CIRCLE',dt:'DIAMETER',px:'THD',cnt:4},surface:{ft:'PLANE',dt:'PROFILE',px:'PLN',cnt:9},attribute:{ft:'POINT',dt:'DISTANCE',px:'ATT',cnt:1}};

function buildPRG(){
  const p=getPCCfg();
  const L=[];
  L.push(`$$ ============================================`);
  L.push(`$$ PC-DMIS Part Program`);
  L.push(`$$ Generated by TRAC Automotive Engineering Suite`);
  L.push(`$$ Part Number : ${p.pn}`);
  L.push(`$$ Revision    : ${p.rev}`);
  L.push(`$$ Date        : ${new Date().toLocaleDateString()}`);
  L.push(`$$ Operator    : ${p.op||'(enter operator)'}`);
  L.push(`$$ Machine     : ${p.mach||'(enter machine)'}`);
  L.push(`$$ Probe Dia   : ⌀${p.probe} mm`);
  L.push(`$$ ============================================`);L.push(``);
  L.push(`FILNAM/'${p.pn}',REVISION,${p.rev}`);
  L.push(`PART/'${p.pn}'`);
  L.push(`MODE/PROG,${p.mode}`);
  L.push(`CLEARPT/${p.cx},${p.cy},${p.cz}`);
  L.push(`UNITS/${p.units},ANGULAR,DEG`);
  L.push(`SNSET/SSVEC`);
  L.push(`PROBDEF/'T1A0B0','BALL',${p.probe},0,0,0`);L.push(``);
  L.push(`$$ ---- DATUMS (define before running) ----`);
  L.push(`$$ DATUM_A=FEAT/PLANE,CARTESIAN`);L.push(`$$ THEO/<0,0,0>,<0,0,1>`);L.push(`$$ MEAS/PLANE,4`);L.push(`$$ ENDMEAS/`);L.push(`$$`);
  L.push(`$$ ---- ALIGNMENT ----`);
  L.push(`$$ ALIGN/START,RECALL`);L.push(`$$ ALIGN/ROTXYZ,DATUM_A,ZPLUS,ZMINUS,XPLUS,XMINUS`);L.push(`$$ ALIGN/TRANS,DATUM_A,Z`);L.push(`$$ ALIGN/END`);L.push(``);
  L.push(`$$ ---- MEASURED FEATURES ----`);L.push(``);
  const allB=[...balloons].sort((a,b)=>{const na=typeof a.num==='number'?a.num:parseInt(a.num)||999,nb=typeof b.num==='number'?b.num:parseInt(b.num)||999;return na-nb;});
  if(!allB.length)L.push(`$$ No balloons yet. Add balloons and PPAP rows first.`);
  allB.forEach(b=>{
    const row=b.pdiRow!=null?pdiRows[b.pdiRow]:null;
    const num=b.num,desc=row?(row.param||'Feature_'+num):(b.label||'Feature_'+num);
    const nom=row?parseFloat(row.nom||row.spec)||0:0,plusT=row?parseFloat(row.upperTol||row.s1)||0:0,minusT=row?Math.abs(parseFloat(row.lowerTol||row.s2)||0):0;
    const ftype=row?(row.featType||'length'):'length',fm=FMAP[ftype]||FMAP['length'],fid=fm.px+num,r=nom/2;
    L.push(`$$ ---- Balloon ${num}: ${desc} ----`);
    if(fm.ft==='CIRCLE'){L.push(`${fid}=FEAT/CIRCLE,INNER,BF`);L.push(`THEO/<0,0,0>,<0,0,1>,${nom.toFixed(4)}`);L.push(`ACTL/<0,0,0>,<0,0,1>,${nom.toFixed(4)}`);L.push(`MEAS/CIRCLE,${fm.cnt}`);L.push(`ENDMEAS/`);L.push(`<${r.toFixed(4)},0,0>`);L.push(`<0,${r.toFixed(4)},0>`);L.push(`<${(-r).toFixed(4)},0,0>`);if(fm.cnt>=4)L.push(`<0,${(-r).toFixed(4)},0>`);}
    else if(fm.ft==='PLANE'){L.push(`${fid}=FEAT/PLANE,CARTESIAN`);L.push(`THEO/<0,0,0>,<0,0,1>`);L.push(`MEAS/PLANE,${fm.cnt}`);L.push(`ENDMEAS/`);[[0,0,0],[10,0,0],[0,10,0],[-10,0,0],[0,-10,0],[10,10,0],[-10,10,0],[10,-10,0],[-10,-10,0]].slice(0,fm.cnt).forEach(pt=>L.push(`<${pt[0]},${pt[1]},${pt[2]}>`));}
    else if(fm.ft==='CYLINDER'){L.push(`${fid}=FEAT/CYLINDER,OUTER,BF`);L.push(`THEO/<0,0,0>,<0,0,1>,${nom.toFixed(4)},20`);L.push(`MEAS/CYLINDER,${fm.cnt}`);L.push(`ENDMEAS/`);[0,5,10,15].forEach(z=>{L.push(`<${r.toFixed(4)},0,${z}>`);L.push(`<0,${r.toFixed(4)},${z}>`);});}
    else{L.push(`${fid}=FEAT/POINT,CARTESIAN`);L.push(`THEO/<0,0,0>,<0,0,1>`);L.push(`MEAS/POINT,1`);L.push(`ENDMEAS/`);L.push(`<0,0,0>`);}
    L.push(``);L.push(`DIM D${num}=${fm.dt} FEAT/${fid}`);
    if(['FLATNESS','ROUNDNESS','CYLINDRICITY','TRUE_POSITION','CIRCULAR_RUN_OUT','PROFILE','PERPENDICULARITY','PARALLELISM'].includes(fm.dt)){L.push(`NOMINAL/0,TOL/+${plusT.toFixed(4)}`);if(fm.dt==='TRUE_POSITION')L.push(`REF_DATUMS/A,B,C`);}
    else L.push(`NOMINAL/${nom.toFixed(4)},TOL/+${plusT.toFixed(4)}/-${minusT.toFixed(4)}`);
    L.push(`OUTPUT/D${num}`);L.push(`ENDOUTPUT/`);L.push(``);
  });
  if(pointRows.length){L.push(`$$ ---- POINT TABLE ----`);L.push(``);pointRows.forEach(r=>{L.push(`${r.ptId}=FEAT/POINT,CARTESIAN`);L.push(`THEO/<${r.x||0},${r.y||0},${r.z||0}>,<${r.i||0},${r.j||0},${r.k||1}>`);L.push(`MEAS/POINT,1`);L.push(`ENDMEAS/`);L.push(`<${r.x||0},${r.y||0},${r.z||0}>`);L.push(``);L.push(`DIM D_${r.ptId}=DISTANCE FEAT/${r.ptId}`);L.push(`NOMINAL/0,TOL/+${r.tol||0.1}/-${r.tol||0.1}`);L.push(`OUTPUT/D_${r.ptId}`);L.push(`ENDOUTPUT/`);L.push(``);});}
  L.push(`$$ ============================================`);L.push(`END/`);
  return L.join('\n');
}

function updatePCPreview(){
  const box=document.getElementById('pcPreview');if(!box)return;
  const src=buildPRG();
  box.innerHTML=src.split('\n').map(line=>{if(line.startsWith('$$'))return`<span class="cm">${line}</span>`;let hl=line;['FILNAM','PART','MODE','CLEARPT','UNITS','SNSET','PROBDEF','ALIGN','MEAS','ENDMEAS','DIM','NOMINAL','TOL','OUTPUT','ENDOUTPUT','END','THEO','ACTL','FEAT','DATUM','MEAS'].forEach(kw=>{hl=hl.replace(new RegExp('\\b'+kw+'\\b','g'),`<span class="kw">${kw}</span>`);});hl=hl.replace(/(<\s*[-\d.]+\s*,\s*[-\d.]+\s*,\s*[-\d.]+\s*>)/g,'<span class="vl">$1</span>');return hl;}).join('\n');
}

function exportPCDMIS(){const p=getPCCfg();if(!balloons.length&&!pointRows.length){toast('Add balloons or points first','err');return;}dlText(buildPRG(),`${p.pn||origFilename}_PCDMIS_${new Date().toISOString().slice(0,10)}.prg`);toast('PC-DMIS .prg exported','ok');}
function copyPC(){navigator.clipboard.writeText(buildPRG()).then(()=>toast('Copied to clipboard','ok')).catch(()=>toast('Copy failed','err'));}
function exportPointsPRG(){if(!pointRows.length){toast('No points to export','err');return;}const p=getPCCfg();const pn=p.pn||'PART';const L=[];L.push(`$$ PC-DMIS Point Measurement Program\n$$ Part: ${p.pn}\n$$ Rev: ${p.rev}\n$$ Date: ${new Date().toLocaleDateString()}\n$$ Generated by TRAC Automotive Suite\n`);L.push(`FILNAM/'${pn}',REVISION,${p.rev}`);L.push(`MODE/PROG,${pcMode}`);L.push(`UNITS/${pcUnits},ANGULAR,DEG`);L.push(`CLEARPT/${p.cx},${p.cy},${p.cz}\n`);pointRows.forEach(r=>{L.push(`$$ ${r.label||r.ptId}`);L.push(`${r.ptId}=FEAT/POINT,CARTESIAN`);L.push(`THEO/<${r.x||0},${r.y||0},${r.z||0}>,<${r.i||0},${r.j||0},${r.k||1}>`);L.push(`MEAS/POINT,1`);L.push(`ENDMEAS/`);L.push(`<${r.x||0},${r.y||0},${r.z||0}>\n`);L.push(`DIM D_${r.ptId}=DISTANCE FEAT/${r.ptId}`);L.push(`NOMINAL/0,TOL/+${r.tol||0.1}/-${r.tol||0.1}`);L.push(`OUTPUT/D_${r.ptId}`);L.push(`ENDOUTPUT/\n`);});L.push(`END/`);dlText(L.join('\n'),`${p.pn||origFilename}_Points_${new Date().toISOString().slice(0,10)}.prg`);toast('Points .prg exported','ok');}
function dlText(text,filename){const blob=new Blob([text],{type:'text/plain'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.download=filename;a.href=url;a.click();URL.revokeObjectURL(url);}

// ── EXPORT PPAP EXCEL ─────────────────────────────────────────────────────
function exportPPAP(){
  if(!balloons.length&&!pdiRows.length){toast('Add balloons or PPAP rows first','err');return;}
  const p=getPCCfg();const wb=XLSX.utils.book_new();
  const hdr=['Balloon #','Description','Feature Type','Nominal','+Tol','-Tol','Gauge','Frequency','Result'];
  const allB=[...balloons].sort((a,b)=>{const na=typeof a.num==='number'?a.num:parseInt(a.num)||999,nb=typeof b.num==='number'?b.num:parseInt(b.num)||999;return na-nb;});
  const rows=allB.map(b=>{const row=b.pdiRow!=null?pdiRows[b.pdiRow]:null;return[b.num,row?(row.param||''):(b.label||''),row?(row.featType||''):'',row?(row.nom||row.spec||''):'',row?(row.upperTol||row.s1||''):'',row?(row.lowerTol||row.s2||''):'',row?(row.gaugeType||''):'',row?(row.freq||''):'',row?(row.result||''):''];});
  const linked=new Set(balloons.filter(b=>b.pdiRow!=null).map(b=>b.pdiRow));
  pdiRows.forEach((row,i)=>{if(!linked.has(i))rows.push(['—',row.param||'',row.featType||'',row.nom||row.spec||'',row.upperTol||row.s1||'',row.lowerTol||row.s2||'',row.gaugeType||'',row.freq||'',row.result||'']);});
  const ws1=XLSX.utils.aoa_to_sheet([hdr,...rows]);ws1['!cols']=[{wch:9},{wch:28},{wch:14},{wch:10},{wch:8},{wch:8},{wch:14},{wch:10},{wch:8}];XLSX.utils.book_append_sheet(wb,ws1,'Inspection Log');
  const meta=[['TRAC Automotive Engineering Suite'],['PPAP / AIAG Inspection Report'],[''],['Part Number:',p.pn||origFilename],['Revision:',p.rev],['Date:',new Date().toLocaleString()],['Operator:',p.op],['Machine:',p.mach],[''],['Total Balloons:',balloons.length],['Total PPAP Rows:',pdiRows.length],['PASS:',rows.filter(r=>r[8]==='PASS').length],['FAIL:',rows.filter(r=>r[8]==='FAIL').length],['TBD:',rows.filter(r=>r[8]==='TBD').length]];
  const ws2=XLSX.utils.aoa_to_sheet(meta);ws2['!cols']=[{wch:20},{wch:30}];XLSX.utils.book_append_sheet(wb,ws2,'Summary');
  if(pointRows.length){const phdr=['Point ID','Label','X','Y','Z','I','J','K','Tolerance'];const pdata=pointRows.map(r=>[r.ptId,r.label,r.x,r.y,r.z,r.i,r.j,r.k,r.tol]);const ws3=XLSX.utils.aoa_to_sheet([phdr,...pdata]);XLSX.utils.book_append_sheet(wb,ws3,'Point Table');}
  XLSX.writeFile(wb,`${origFilename}_PPAP_${new Date().toISOString().slice(0,10)}.xlsx`);toast('PPAP report exported','ok');
}

// ── EXPORT ANNOTATED PDF ──────────────────────────────────────────────────
async function exportAnnotatedPDF(){
  if(!origPdfBytes){toast('Load a drawing first','err');return;}showProg(20);
  try{
    const{PDFDocument,rgb,StandardFonts}=PDFLib;
    const doc=await PDFDocument.load(origPdfBytes);const pg=doc.getPages()[0];const{width:pw,height:ph}=pg.getSize();
    const dc=document.getElementById('drawingCanvas');const sx=pw/dc.width,sy=ph/dc.height;
    const font=await doc.embedFont(StandardFonts.HelveticaBold),fontR=await doc.embedFont(StandardFonts.Helvetica);
    const h2r=h=>rgb(parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255);
    for(const b of balloons){
      const bxP=b.x*sx,byP=ph-b.y*sy,txP=b.tx*sx,tyP=ph-b.ty*sy;
      const ns=b.numSize||bSize,col=h2r(b.color||bColor);const pfs=Math.max(ns*sx*.65,5),R=Math.max(pfs*1.2,7);
      pg.drawLine({start:{x:bxP,y:byP},end:{x:txP,y:tyP},thickness:.9,color:col});
      pg.drawCircle({x:txP,y:tyP,size:2.5,color:col});
      pg.drawCircle({x:bxP,y:byP,size:R,borderColor:col,borderWidth:1.4,color:rgb(1,1,1)});
      const ns_=String(b.num),ntw=font.widthOfTextAtSize(ns_,pfs);pg.drawText(ns_,{x:bxP-ntw/2,y:byP-pfs/2+.5,size:pfs,font,color:col});
      if(b.label&&b.label.trim()){const lfs=Math.max((b.labelSize||ns)*sx*.65,4),lf=b.labelBold?font:fontR,ltw=lf.widthOfTextAtSize(b.label,lfs);pg.drawText(b.label,{x:bxP-ltw/2,y:byP-R-lfs-3,size:lfs,font:lf,color:col});}
      if(b.pdiRow!=null&&pdiRows[b.pdiRow]){const row=pdiRows[b.pdiRow];const lbl=`${row.nom||row.spec||''}${row.upperTol?' +'+row.upperTol:''}`;const ls=Math.max(pfs-1,4);pg.drawText(lbl,{x:bxP+R+3,y:byP-ls/2,size:ls,font,color:col});}
    }
    for(const s of shapes){
      const col2=h2r(s.style.stroke||'#c8f050'),sx1=s.x1*sx,sy1=ph-s.y1*sy,sx2=s.x2*sx,sy2=ph-s.y2*sy,w=s.style.weight*sx*.7;
      if(s.type==='rect'){const rx=Math.min(sx1,sx2),ry=Math.min(sy1,sy2);pg.drawRectangle({x:rx,y:ry,width:Math.abs(sx2-sx1),height:Math.abs(sy2-sy1),borderColor:col2,borderWidth:w,opacity:0});}
      else if(s.type==='line'||s.type==='arrow')pg.drawLine({start:{x:sx1,y:sy1},end:{x:sx2,y:sy2},thickness:w,color:col2});
      else if(s.type==='circle'){const cx_=(sx1+sx2)/2,cy_=(sy1+sy2)/2;pg.drawEllipse({x:cx_,y:cy_,xScale:Math.abs(sx2-sx1)/2,yScale:Math.abs(sy2-sy1)/2,borderColor:col2,borderWidth:w,opacity:0});}
    }
    showProg(80);const bytes=await doc.save();const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const a=document.createElement('a');a.download=`${origFilename}_Annotated_${new Date().toISOString().slice(0,10)}.pdf`;a.href=url;a.click();URL.revokeObjectURL(url);toast('Annotated PDF exported','ok');
  }catch(err){toast('PDF export failed: '+err.message,'err');}hideProg();
}
