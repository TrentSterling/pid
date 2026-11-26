import { GrabLab, MODES, DEFAULTS, CANNON } from './physics.js';
import { LabView } from './view.js';

const $=id=>document.getElementById(id);
const text=(id,value)=>{const e=$(id);if(e.textContent!==String(value))e.textContent=String(value);};
const lab=new GrabLab({scripted:true});
let paused=false,slow=false,selectedHand=0,closeView=false;
let lastFrame=0,accumulator=0,lastUI=0,lastFPS=0,frames=0,traceClock=0;
let xrSession=null,xrTracking=true,sessionListeners=null,toastTimer;
const keys=new Set(),grips=new Map(),faceButtons=new Map(),xrPoseHistory=new Map();
const identity=()=>({x:0,y:0,z:0,w:1});
const manual={head:{position:{x:0,y:1.65,z:0},quaternion:identity()},hands:[
 {position:{x:-.45,y:1.03,z:-.85},quaternion:identity(),grip:false},
 {position:{x:.3,y:1.2,z:-.45},quaternion:identity(),grip:false}
]};
const trace=[];
const modeCopy={
 oneway:{name:'One-way PD',sub:'The object follows. The player feels nothing.',formula:'F = m (kp · e + kd · Δv)\nPlayer reaction = 0',tip:'A useful baseline. The prop still collides, but its drive does not transmit an equal opposite force into the player.'},
 relative:{name:'Reaction PD',sub:'Relative velocity, with equal opposite force.',formula:'F = m* (kp · e + kd · Δv)\nPlayer force = −F',tip:'Δv is target velocity minus grab-point velocity. The moving hand is not damped toward a stationary world. m* is the pair’s scalar reduced mass.'},
 backward:{name:'Backward PD',sub:'Timestep-adjusted gains, same reaction.',formula:'g = 1 / (1 + kd·dt + kp·dt²)\nF = m* g [kp·e + (kd+kp·dt)·Δv]',tip:'Backward gains improve the free-space timestep response. Collisions, force caps, and the iterative solver still affect the result. FF adds bounded tracked acceleration.'},
 joint:{name:'Point joint',sub:'Native Cannon constraint. Rotation is free.',formula:'Player grab point ↔ object grab point\nConstraint solver · no rotation motor',tip:'This is not Unity’s ConfigurableJoint. The force limit is per Cartesian constraint axis; the PD modes cap the whole force vector. Gains and acceleration FF do not tune this constraint.'}
};

function toast(message){text('toast',message);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,2800);}
function setMode(id,announce=true){
 lab.setMode(id);const copy=modeCopy[id];
 for(const b of $('modes').querySelectorAll('button')){const active=b.dataset.mode===id;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}
 text('mode-description',MODES.find(m=>m.id===id).description);text('mode-formula',copy.formula);text('mode-tip',copy.tip);
 $('feedforward').disabled=id!=='backward';
 for(const name of ['frequency','damping','angularFrequency','maxTorque']) {const input=$(`param-${name}`);if(input)input.disabled=id==='joint';}
 if(announce)toast(`${copy.name} · ${lab.hands.some(h=>h.heldId)?'same object, grip preserved':'controller changed'}`);
}

for(const [i,mode] of MODES.entries()) {
 const copy=modeCopy[mode.id],b=document.createElement('button');b.className='mode-button';b.dataset.mode=mode.id;b.setAttribute('aria-pressed','false');
 b.innerHTML=`<span class="number">${i+1}</span><span><strong>${copy.name}</strong><small>${copy.sub}</small></span><span class="mode-dot" aria-hidden="true"></span>`;
 b.addEventListener('click',()=>setMode(mode.id));$('modes').append(b);
}

const sliderDefs=[
 ['frequency','Tracking frequency',1,15,.25,'Hz','sliders'],
 ['damping','Damping ratio',0,2.5,.05,'ζ','sliders'],
 ['cubeMass','Small cube mass',.25,12,.25,'kg','sliders'],
 ['maxForce','Maximum drive force',50,5000,50,'N','advanced-sliders'],
 ['maxTorque','Maximum torque',0,100,1,'N·m','advanced-sliders'],
 ['bodyMass','Player mass',1,150,1,'kg','advanced-sliders'],
 ['angularFrequency','Angular frequency',1,12,.25,'Hz','advanced-sliders']
];
function formatParam(value,unit){return `${Number(value).toLocaleString(undefined,{maximumFractionDigits:2})} ${unit}`;}
for(const [key,label,min,max,step,unit,parent] of sliderDefs){
 const l=document.createElement('label');l.className='slider-field';l.htmlFor=`param-${key}`;
 l.innerHTML=`<span>${label}<output id="value-${key}" for="param-${key}"></output></span><input id="param-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${lab.params[key]}"><div class="slider-endpoints"><span>${min} ${unit}</span><span>${max} ${unit}</span></div>`;
 $(parent).append(l);text(`value-${key}`,formatParam(lab.params[key],unit));
 $(`param-${key}`).addEventListener('input',e=>{const value=Number(e.target.value);lab.setParams({[key]:value});text(`value-${key}`,formatParam(value,unit));});
}
$('feedforward').addEventListener('change',()=>lab.setParams({feedforward:$('feedforward').checked?1:0}));
$('external').addEventListener('change',()=>lab.setParams({preserveExternal:$('external').checked}));
$('defaults').addEventListener('click',()=>{lab.setParams(DEFAULTS);for(const [key,,,,,unit]of sliderDefs){$(`param-${key}`).value=lab.params[key];text(`value-${key}`,formatParam(lab.params[key],unit));}$('feedforward').checked=false;$('external').checked=true;toast('Teaching values restored. The held object stays held.');});

function copyInputToManual(){
 for(let i=0;i<2;i++){const from=lab.input.hands[i];manual.hands[i].position={x:from.position.x,y:from.position.y,z:from.position.z};manual.hands[i].quaternion={x:from.quaternion.x,y:from.quaternion.y,z:from.quaternion.z,w:from.quaternion.w};manual.hands[i].grip=Boolean(from.grip);}
}
function updateManualControls(){
 for(const axis of ['x','y','z']){$(`hand-${axis}`).value=manual.hands[selectedHand].position[axis];text(`hand-${axis}-value`,`${manual.hands[selectedHand].position[axis].toFixed(2)} m`);}
 for(const [i,side]of ['left','right'].entries()){const on=manual.hands[i].grip;text(`grip-${side}`,`${i?'Right':'Left'}: ${on?'gripping':'open'}`);$(`grip-${side}`).setAttribute('aria-pressed',String(on));$(`edit-${side}`).classList.toggle('active',selectedHand===i);$(`edit-${side}`).setAttribute('aria-pressed',String(selectedHand===i));}
}
function setGuided(enabled){
 if(xrSession)return;
 if(!enabled&&lab.scripted)copyInputToManual();
 lab.setScripted(enabled);if(enabled)reset();else lab.setInput(manual);
 $('guided').classList.toggle('active',enabled);$('manual').classList.toggle('active',!enabled);$('guided').setAttribute('aria-pressed',String(enabled));$('manual').setAttribute('aria-pressed',String(!enabled));$('manual-panel').hidden=enabled;
 text('stage-title',enabled?'Guided workout':'Manual hands');
 $('scene-hint').querySelector('b').textContent=enabled?'Watch the cube. Then switch the controller.':'Reach for a cube. Grip, then move the hand.';
 $('scene-hint').querySelector('div>span').textContent=enabled?'The guided hand repeats the same pickup, shake, and release.':'WASD moves the player. The sliders move your selected hand.';
 updateManualControls();
}
function reset(){
 lab.reset();accumulator=0;trace.length=0;traceClock=0;
 if(!lab.scripted&&!xrSession){manual.hands[0].position={x:-.45,y:1.03,z:-.85};manual.hands[1].position={x:.3,y:1.2,z:-.45};for(const h of manual.hands){h.grip=false;h.quaternion=identity();}lab.setInput(manual);lab.setScripted(false);updateManualControls();}
 if(xrSession){grips.clear();faceButtons.clear();xrPoseHistory.clear();xrTracking=false;lab.setScripted(false);}
 updateUI();
}
function setPaused(value){if(xrSession)return;paused=value;text('pause',paused?'Resume':'Pause');$('pause').setAttribute('aria-label',paused?'Resume simulation':'Pause simulation');$('live-dot').classList.toggle('paused',paused);accumulator=0;}
function toggleGrip(i){if(lab.scripted)setGuided(false);manual.hands[i].grip=!manual.hands[i].grip;lab.setInput(manual);updateManualControls();}
function runCommand(id){if(id==='reset'){reset();toast('Room reset');}else setMode(id);}
const view=new LabView($('viewport'),lab,runCommand);
text('renderer-label',view.webgl?'WebGL':'Canvas fallback');
setMode(lab.mode,false);

$('guided').addEventListener('click',()=>setGuided(true));$('manual').addEventListener('click',()=>setGuided(false));
$('pause').addEventListener('click',()=>setPaused(!paused));$('reset').addEventListener('click',()=>{reset();toast('Room reset');});
$('kick').addEventListener('click',()=>{lab.impulsePlayer({x:90,y:0,z:0});toast('90 N·s sideways impulse');});
$('slow').addEventListener('click',()=>{slow=!slow;$('slow').setAttribute('aria-pressed',String(slow));});
$('fit').addEventListener('click',()=>{closeView=false;view.fit();text('camera','Close view');});
$('camera').addEventListener('click',()=>{closeView=!closeView;view.fit(closeView);text('camera',closeView?'Room view':'Close view');});
$('expand').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('viewport').requestFullscreen();}catch{toast('Full screen is not available here.');}});
document.addEventListener('fullscreenchange',()=>{text('expand',document.fullscreenElement?'Exit full screen':'Expand');view.resize();});
for(const [i,side]of ['left','right'].entries()){$(`edit-${side}`).addEventListener('click',()=>{selectedHand=i;updateManualControls();});$(`grip-${side}`).addEventListener('click',()=>toggleGrip(i));}
for(const axis of ['x','y','z'])$(`hand-${axis}`).addEventListener('input',e=>{manual.hands[selectedHand].position[axis]=Number(e.target.value);lab.setInput(manual);updateManualControls();});
$('reach-cube').addEventListener('click',()=>{
 const cube=lab.items.find(item=>item.id===(selectedHand?'heavy-cube':'cube'));
 if(!cube)return;
 const target={x:cube.body.position.x-lab.rigPosition.x,y:cube.body.position.y-lab.rigPosition.y+.05,z:cube.body.position.z-lab.rigPosition.z};
 const head=manual.head.position,shoulderX=head.x+(selectedHand?.18:-.18);
 if(Math.hypot(target.x-shoulderX,target.y-(head.y-.25),target.z-head.z)>lab.params.maxArmLength){toast('The cube is out of reach. Use WASD to move closer, or reset.');return;}
 lab.release(selectedHand);manual.hands[selectedHand].grip=false;
 manual.hands[selectedHand].position=target;lab.setInput(manual);lab.setScripted(false);updateManualControls();toast('Hand at the cube. Press Grip, then move it with the sliders.');
});

const inputElement=el=>el instanceof HTMLElement&&Boolean(el.closest('input,select,textarea'));
document.addEventListener('keydown',event=>{
 if(xrSession||inputElement(event.target)||(event.key===' '&&event.target instanceof HTMLElement&&event.target.closest('button,a,summary')))return;
 const key=event.key.toLowerCase();keys.add(key);
 if(event.repeat)return;
 if([' ','q','e','w','a','s','d','1','2','3','4','r'].includes(key))event.preventDefault();
 if(key===' ')setPaused(!paused);if(key==='r')reset();if(key==='q')toggleGrip(0);if(key==='e')toggleGrip(1);
 if(/^[1-4]$/.test(key))setMode(MODES[Number(key)-1].id);
});
document.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));
window.addEventListener('blur',()=>{keys.clear();if(!xrSession&&!lab.scripted){for(const h of manual.hands)h.grip=false;lab.setInput(manual);updateManualControls();}lastFrame=0;accumulator=0;});
document.addEventListener('visibilitychange',()=>{lastFrame=0;accumulator=0;});

function stepDesktop(dt){
 if(lab.scripted)return;
 let x=(keys.has('d')?1:0)-(keys.has('a')?1:0),z=(keys.has('s')?1:0)-(keys.has('w')?1:0);
 const len=Math.hypot(x,z);if(len>0)lab.move({x:x/len*dt*1.5,y:0,z:z/len*dt*1.5});
 lab.setInput(manual);
}

function sampleXR(frame,time){
 const ref=view.renderer.xr.getReferenceSpace();if(!frame||!ref)return false;
 const pose=frame.getViewerPose(ref);
 if(!pose||xrSession.visibilityState==='hidden'){
   if(xrTracking){for(let i=0;i<2;i++)lab.release(i);lab.setInput({hands:lab.input.hands.map(h=>({...h,grip:false,velocity:null,angularVelocity:null}))});lab.setScripted(false);grips.clear();faceButtons.clear();xrPoseHistory.clear();}
   xrTracking=false;return false;
 }
 const hands=lab.input.hands.map(h=>({position:{x:h.position.x,y:h.position.y,z:h.position.z},quaternion:{x:h.quaternion.x,y:h.quaternion.y,z:h.quaternion.z,w:h.quaternion.w},grip:false}));
 for(const source of xrSession.inputSources){
   const i=source.handedness==='left'?0:source.handedness==='right'?1:-1;if(i<0||!source.gripSpace)continue;
   const gripPose=frame.getPose(source.gripSpace,ref);if(!gripPose){grips.delete(source);xrPoseHistory.delete(source);lab.release(i);continue;}
   const p=gripPose.transform.position,q=gripPose.transform.orientation;
   const previous=xrPoseHistory.get(source),poseDt=previous?(time-previous.time)/1000:0;
   let velocity={x:0,y:0,z:0},angularVelocity={x:0,y:0,z:0};
   if(previous&&poseDt>.001&&poseDt<.1){
     velocity={x:(p.x-previous.p.x)/poseDt,y:(p.y-previous.p.y)/poseDt,z:(p.z-previous.p.z)/poseDt};
     const delta=new CANNON.Quaternion(q.x,q.y,q.z,q.w).mult(new CANNON.Quaternion(previous.q.x,previous.q.y,previous.q.z,previous.q.w).conjugate());
     if(delta.w<0){delta.x*=-1;delta.y*=-1;delta.z*=-1;delta.w*=-1;}
     const sine=Math.hypot(delta.x,delta.y,delta.z),scale=sine>1e-7?2*Math.atan2(sine,delta.w)/(sine*poseDt):0;
     angularVelocity={x:delta.x*scale,y:delta.y*scale,z:delta.z*scale};
   }
   xrPoseHistory.set(source,{p:{x:p.x,y:p.y,z:p.z},q:{x:q.x,y:q.y,z:q.z,w:q.w},time});
   hands[i]={position:{x:p.x,y:p.y,z:p.z},quaternion:{x:q.x,y:q.y,z:q.z,w:q.w},velocity,angularVelocity,grip:grips.get(source)===true};
   // Standard face buttons are optional; the triggerable room panel always works.
   const primary=Boolean(source.gamepad?.buttons[4]?.pressed),wasPressed=faceButtons.get(source)||false;
   if(xrTracking&&primary&&!wasPressed){if(i===1)setMode(MODES[(MODES.findIndex(m=>m.id===lab.mode)+1)%MODES.length].id);else reset();}
   faceButtons.set(source,primary);
 }
 const p=pose.transform.position,q=pose.transform.orientation;
 if(!xrTracking)for(const hand of hands)hand.grip=false;
 lab.setInput({head:{position:{x:p.x,y:p.y,z:p.z},quaternion:{x:q.x,y:q.y,z:q.z,w:q.w}},hands});
 if(!xrTracking){grips.clear();lab.setScripted(false);lab.teleport({...lab.rigPosition});}
 xrTracking=true;return true;
}

async function checkXR(){
 if(!view.webgl){text('enter-vr','VR unavailable');text('xr-detail','WebGL is disabled here. The desktop simulation still runs with the same physics.');return;}
 if(!window.isSecureContext){text('enter-vr','HTTPS required');text('xr-detail','WebXR requires HTTPS or localhost. Use the published HTTPS address.');return;}
 if(!navigator.xr){text('enter-vr','Use a headset');return;}
 try{const supported=await navigator.xr.isSessionSupported('immersive-vr');$('enter-vr').disabled=!supported;text('enter-vr',supported?'Enter VR':'Use a headset');if(supported)text('xr-detail','Grip objects. Trigger the room buttons to change controllers while holding.');}
 catch(error){text('enter-vr','VR unavailable');text('xr-detail','Immersive VR is not permitted here. Open the published page directly in your headset browser.');console.warn(error);}
}

$('enter-vr').addEventListener('click',async()=>{
 if(xrSession){try{$('enter-vr').disabled=true;await xrSession.end();}catch(error){$('enter-vr').disabled=false;toast(`VR could not exit: ${error.message}`);}return;}
 $('enter-vr').disabled=true;
 try{
   const session=await navigator.xr.requestSession('immersive-vr',{requiredFeatures:['local-floor'],optionalFeatures:['bounded-floor']});
   xrSession=session;
   const onSqueeze=e=>grips.set(e.inputSource,true),onRelease=e=>grips.set(e.inputSource,false);
   const onSources=e=>{for(const s of e.removed){grips.delete(s);faceButtons.delete(s);xrPoseHistory.delete(s);if(s.handedness==='left')lab.release(0);if(s.handedness==='right')lab.release(1);}};
   const onOriginReset=()=>{lab.teleport({...lab.rigPosition});grips.clear();faceButtons.clear();xrPoseHistory.clear();xrTracking=false;lastFrame=0;accumulator=0;};
   const onEnd=()=>{
     session.removeEventListener('squeezestart',onSqueeze);session.removeEventListener('squeezeend',onRelease);session.removeEventListener('inputsourceschange',onSources);
     sessionListeners?.ref?.removeEventListener('reset',onOriginReset);sessionListeners=null;
     xrSession=null;grips.clear();faceButtons.clear();xrPoseHistory.clear();keys.clear();
     // Our session listener is registered before Three's. Wait until Three has
     // cleared isPresenting and restored its framebuffer before fitting/resizing.
     queueMicrotask(()=>{if(!xrSession){view.setXR(false);view.resize();}});
     for(const id of ['guided','manual','pause','slow','kick'])$(id).disabled=false;
     lab.setScripted(true);setGuided(true);setPaused(false);lastFrame=0;accumulator=0;
     text('enter-vr','Enter VR');$('enter-vr').disabled=false;text('xr-label','Play with your hands');
   };
   session.addEventListener('squeezestart',onSqueeze);session.addEventListener('squeezeend',onRelease);session.addEventListener('inputsourceschange',onSources);session.addEventListener('end',onEnd,{once:true});
   await view.renderer.xr.setSession(session);
   if(xrSession!==session||!view.renderer.xr.isPresenting)return;
   sessionListeners={ref:view.renderer.xr.getReferenceSpace()};sessionListeners.ref?.addEventListener('reset',onOriginReset);
   lab.setScripted(false);reset();view.setXR(true);paused=false;slow=false;xrTracking=false;lastFrame=0;accumulator=0;keys.clear();
   text('pause','Pause');$('live-dot').classList.remove('paused');
   $('slow').setAttribute('aria-pressed','false');$('manual-panel').hidden=true;
   for(const id of ['guided','manual','pause','slow','kick'])$(id).disabled=true;
   text('stage-title','Immersive VR');text('enter-vr','Exit VR');$('enter-vr').disabled=false;text('xr-label','Headset connected');
 }catch(error){console.error(error);if(xrSession){try{await xrSession.end();}catch{}xrSession=null;}view.setXR(false);$('enter-vr').disabled=false;text('enter-vr','Enter VR');toast(`VR could not start: ${error.message}`);}
});

function updateUI(){
 const m=lab.metrics;text('gap',m.gapCm.toFixed(1));text('force',m.forceN.toFixed(0));text('speed',m.speed.toFixed(2));text('held',`${m.heldCount} / 2`);
 text('sim-time',`${m.time.toFixed(1)} s`);text('phase',lab.scripted?m.workoutPhase:(xrSession?'Tracked input':'Live hand input'));
 text('limit-state',m.limited?'Force cap reached':'Within force limit');$('limit-state').classList.toggle('limited',m.limited);
}
const graph=$('trace'),graphContext=graph.getContext('2d');
function drawTrace(){
 const w=graph.clientWidth,h=graph.clientHeight,dpr=Math.min(devicePixelRatio||1,1.75);
 if(graph.width!==Math.round(w*dpr)||graph.height!==Math.round(h*dpr)){graph.width=Math.round(w*dpr);graph.height=Math.round(h*dpr);}const c=graphContext;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
 const top=8,bottom=h-15,left=42,right=w-16;const max=Math.max(10,Math.ceil(Math.max(...trace.map(s=>s.value),0)/10)*10);
 c.font='10px ui-monospace,monospace';c.fillStyle='#7895a9';c.textAlign='right';c.fillText(`${max} cm`,left-6,top+8);c.fillText('0',left-6,bottom);
 c.strokeStyle='#263b4a';c.lineWidth=1;for(const y of [top,(top+bottom)*.5,bottom]){c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();}
 if(trace.length<2)return;
 const end=traceClock,start=Math.max(0,end-10),span=10;
 for(let i=1;i<trace.length;i++){const a=trace[i-1],b=trace[i];const x1=left+(a.t-start)/span*(right-left),x2=left+(b.t-start)/span*(right-left);if(x2<left)continue;c.beginPath();c.moveTo(Math.max(left,x1),bottom-a.value/max*(bottom-top));c.lineTo(x2,bottom-b.value/max*(bottom-top));c.strokeStyle=MODES.find(m=>m.id===b.mode).color;c.lineWidth=1.7;c.stroke();}
}

function frame(time,xrFrame){
 const elapsed=lastFrame?Math.min(.1,(time-lastFrame)/1000):0;lastFrame=time;frames++;
 if(time-lastFPS>1000){text('fps',`${Math.round(frames*1000/(time-lastFPS))} fps`);frames=0;lastFPS=time;}
 let canStep=!paused&&!document.hidden;
 if(xrSession)canStep=sampleXR(xrFrame,time);
 if(canStep){
   accumulator+=elapsed*(slow&&!xrSession ? .25 : 1);
   const fixed=1/90;let count=0;
   while(accumulator>=fixed&&count<9){if(!xrSession)stepDesktop(fixed);lab.step(fixed);accumulator-=fixed;count++;traceClock+=fixed;}
   if(count===9)accumulator=0;
 }else accumulator=0;
 view.update(elapsed,time);
 if(time-lastUI>=50){updateUI();if(canStep&&(trace.at(-1)?.t??-1)<traceClock)trace.push({t:traceClock,value:lab.metrics.gapCm,mode:lab.mode});while(trace.length>220||trace[0]?.t<traceClock-10)trace.shift();drawTrace();lastUI=time;}
 if(!view.renderer)requestAnimationFrame(frame);
}

view.fit();updateManualControls();updateUI();checkXR();
if(view.renderer)view.renderer.setAnimationLoop(frame);else requestAnimationFrame(frame);
