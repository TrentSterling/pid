import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const V = (p) => new THREE.Vector3(p.x, p.y, p.z);
const palette = { player: 0x8bb7ff, target: 0x89ead6, grab: 0xffb968 };
const boxCorners = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const boxFaces = [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]];

function shade(hex, amount = 1) {
  if (typeof hex === 'string') hex = Number.parseInt(hex.replace('#',''),16);
  return `rgb(${Math.min(255,(hex>>16&255)*amount)|0},${Math.min(255,(hex>>8&255)*amount)|0},${Math.min(255,(hex&255)*amount)|0})`;
}

export class LabView {
  constructor(container, lab, onCommand) {
    this.container=container; this.lab=lab; this.onCommand=onCommand;
    this.scene=new THREE.Scene(); this.scene.background=new THREE.Color(0x0b1520);
    this.camera=new THREE.PerspectiveCamera(46,1,.025,80);
    this.camera.position.set(4.8,3.3,6.7);
    this.rig=new THREE.Group(); this.rig.add(this.camera); this.scene.add(this.rig);
    this.webgl=false; this.renderer=null;
    const candidate=document.createElement('canvas');
    // WebGL may be disabled by the browser. Keep the same simulation usable in 2D.
    const context=candidate.getContext('webgl2',{antialias:true,alpha:false});
    if(context) {
      try {
        this.renderer=new THREE.WebGLRenderer({canvas:candidate,context,antialias:true});
        this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));
        this.renderer.outputColorSpace=THREE.SRGBColorSpace;
        this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure=1.15;
        this.renderer.xr.enabled=true;
        this.renderer.xr.setReferenceSpaceType('local-floor');
        this.renderer.xr.setFramebufferScaleFactor(1);
        this.canvas=this.renderer.domElement; this.webgl=true;
      } catch(error) { console.warn('Using the canvas view:',error); }
    }
    if(!this.webgl) { this.canvas=document.createElement('canvas'); this.ctx=this.canvas.getContext('2d'); }
    container.prepend(this.canvas);
    this.controls=new OrbitControls(this.camera,this.canvas);
    this.controls.target.set(0,1,.35);
    this.controls.enableDamping=true; this.controls.dampingFactor=.1;
    this.controls.minDistance=1.2; this.controls.maxDistance=14;
    this.controls.maxPolarAngle=Math.PI*.485;
    this.controls.update();
    this.meshes=new Map(); this.lastHud=0; this.xrButtons=[];
    this.raycaster=new THREE.Raycaster(); this.tmpMatrix=new THREE.Matrix4();
    if(this.webgl) this.buildScene();
    this.resizeObserver=new ResizeObserver(()=>this.resize()); this.resizeObserver.observe(container);
    this.resize();
  }

  buildScene() {
    this.scene.add(new THREE.HemisphereLight(0xe7f4ff,0x29403b,2.5));
    const sun=new THREE.DirectionalLight(0xffffff,3.2); sun.position.set(3,7,5); this.scene.add(sun);
    const fill=new THREE.DirectionalLight(0x8adee7,.8); fill.position.set(-4,3,-3); this.scene.add(fill);
    this.boxGeometry=new THREE.BoxGeometry(1,1,1);
    this.sphereGeometry=new THREE.SphereGeometry(1,16,12);
    for(const item of this.lab.items) {
      const material=new THREE.MeshStandardMaterial({color:item.color||0x304454,roughness:.68,metalness:.08});
      const mesh=new THREE.Mesh(this.boxGeometry,material);
      mesh.scale.set(item.size.x,item.size.y,item.size.z);
      const edges=new THREE.LineSegments(new THREE.EdgesGeometry(this.boxGeometry),new THREE.LineBasicMaterial({color:0x9fbad0,transparent:true,opacity:item.grabbable?.45:.12}));
      mesh.add(edges); this.scene.add(mesh); this.meshes.set(item.id,mesh);
    }
    this.grid=new THREE.GridHelper(10,20,0x43605e,0x263e4c); this.grid.position.y=.008; this.scene.add(this.grid);
    const ring=new THREE.Mesh(new THREE.RingGeometry(.27,.3,40),new THREE.MeshBasicMaterial({color:palette.player,side:THREE.DoubleSide,transparent:true,opacity:.45}));
    ring.rotation.x=-Math.PI/2; this.playerRing=ring; this.scene.add(ring);
    const material=new THREE.MeshStandardMaterial({color:palette.player,roughness:.5});
    this.head=new THREE.Mesh(this.sphereGeometry,material); this.head.scale.set(.14,.14,.14); this.scene.add(this.head);
    this.visor=new THREE.Mesh(this.boxGeometry,new THREE.MeshStandardMaterial({color:0x0d263d,roughness:.35})); this.visor.scale.set(.24,.07,.09); this.scene.add(this.visor);
    this.torso=new THREE.Mesh(new THREE.CapsuleGeometry(.15,.38,5,12),material); this.scene.add(this.torso);
    this.armLines=[]; this.handTargets=[]; this.handPhysical=[]; this.gapLines=[];
    for(let i=0;i<2;i++) {
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:0xabc4d8}));
      this.armLines.push(line); this.scene.add(line);
      const target=new THREE.Mesh(this.sphereGeometry,new THREE.MeshBasicMaterial({color:palette.target,wireframe:true,transparent:true,opacity:.8}));
      target.scale.setScalar(.055);this.scene.add(target);this.handTargets.push(target);
      const hand=new THREE.Mesh(this.sphereGeometry,new THREE.MeshStandardMaterial({color:palette.grab,roughness:.5}));
      hand.scale.setScalar(.048);this.scene.add(hand);this.handPhysical.push(hand);
      const gap=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:palette.grab,transparent:true,opacity:.7}));
      this.scene.add(gap);this.gapLines.push(gap);
    }
    this.buildXRPanel();
    this.controllers=[];
    for(let i=0;i<2;i++) {
      const controller=this.renderer.xr.getController(i);
      const beam=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-1)]),new THREE.LineBasicMaterial({color:palette.target,transparent:true,opacity:.65}));
      beam.scale.z=3; controller.add(beam);this.rig.add(controller);this.controllers.push(controller);
      controller.addEventListener('selectstart',()=>this.activateXRButton(controller));
    }
  }

  buildXRPanel() {
    // Mount the panel on the viewer side of the press wall (front face z=.04).
    this.xrPanel=new THREE.Group(); this.xrPanel.position.set(0,2.15,.1); this.xrPanel.visible=false; this.scene.add(this.xrPanel);
    const back=new THREE.Mesh(new THREE.BoxGeometry(1.5,.96,.025),new THREE.MeshBasicMaterial({color:0x102330}));this.xrPanel.add(back);
    const titleCanvas=document.createElement('canvas');titleCanvas.width=768;titleCanvas.height=128;
    const ctx=titleCanvas.getContext('2d');ctx.fillStyle='#89ead6';ctx.font='bold 44px system-ui';ctx.fillText('GRAB LAB',26,56);ctx.fillStyle='#b9ccd9';ctx.font='23px system-ui';ctx.fillText('Grip the cube · trigger a button · keep holding',26,102);
    const title=new THREE.Mesh(new THREE.PlaneGeometry(1.4,.23),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(titleCanvas),transparent:true}));title.position.set(0,.31,.02);this.xrPanel.add(title);
    const labels=['One-way','Reaction','Backward','Point joint','Velocity','Contact mode','Reset'];
    const ids=['oneway','relative','backward','joint','velocity','contact','reset'];
    for(let i=0;i<labels.length;i++) {
      const c=document.createElement('canvas');c.width=256;c.height=100;const cc=c.getContext('2d');
      cc.fillStyle='#d6ece7';cc.font='bold 30px system-ui';cc.textAlign='center';cc.fillText(labels[i],128,60);
      const mat=new THREE.MeshBasicMaterial({color:0x244839});
      const wide=i>=5;
      const button=new THREE.Mesh(new THREE.BoxGeometry(wide?.56:.265,.16,.025),mat);button.position.set(wide?(i===5?-.3:.3):(i-2)*.283,wide?-.18:.025,.04);button.userData.command=ids[i];
      const label=new THREE.Mesh(new THREE.PlaneGeometry(wide?.40:.255,.1),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true}));label.position.z=.014;button.add(label);
      this.xrPanel.add(button);this.xrButtons.push(button);
    }
    this.hudCanvas=document.createElement('canvas');this.hudCanvas.width=768;this.hudCanvas.height=80;this.hudTexture=new THREE.CanvasTexture(this.hudCanvas);
    this.hudTexture.colorSpace=THREE.SRGBColorSpace;
    const hud=new THREE.Mesh(new THREE.PlaneGeometry(1.4,.14),new THREE.MeshBasicMaterial({map:this.hudTexture,transparent:true}));hud.position.set(0,-.365,.025);this.xrPanel.add(hud);
  }

  activateXRButton(controller) {
    if(!this.renderer.xr.isPresenting) return;
    this.rig.position.copy(this.lab.rigPosition);
    controller.updateWorldMatrix(true,false);
    this.xrPanel.updateWorldMatrix(true,true);
    this.tmpMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0,0,-1).applyMatrix4(this.tmpMatrix);
    const hit=this.raycaster.intersectObjects(this.xrButtons,false)[0];
    if(hit&&hit.distance<5) this.onCommand(hit.object.userData.command);
  }

  setXR(active) {
    this.controls.enabled=!active;
    if(this.xrPanel) this.xrPanel.visible=active;
    if(active) { this.camera.position.set(0,0,0);this.camera.quaternion.identity(); }
    else { this.rig.position.set(0,0,0);this.rig.quaternion.identity();this.fit(this.lastFitClose??true); }
  }

  fit(close=false) {
    if(this.renderer?.xr.isPresenting) return;
    this.lastFitClose=close;
    const p=this.lab.rigPosition;
    this.controls.target.set(close?p.x:0,close?p.y+.95:1,close?p.z-.85:.55);
    if(close) this.camera.position.set(p.x+2.2,p.y+2.25,p.z+2.25);
    else this.camera.position.set(4.6,3.15,6.3);
    this.controls.update();
  }

  resize() {
    const w=this.container.clientWidth,h=this.container.clientHeight;
    this.width=Math.max(1,w);this.height=Math.max(1,h);this.camera.aspect=this.width/this.height;this.camera.updateProjectionMatrix();
    if(this.renderer) { if(!this.renderer.xr.isPresenting) this.renderer.setSize(this.width,this.height); }
    else { const ratio=Math.min(devicePixelRatio||1,1.75);this.canvas.width=Math.round(this.width*ratio);this.canvas.height=Math.round(this.height*ratio);this.ctx.setTransform(ratio,0,0,ratio,0,0); }
  }

  setLine(line,points) {
    const a=line.geometry.attributes.position;for(let i=0;i<points.length;i++) a.setXYZ(i,points[i].x,points[i].y,points[i].z);a.needsUpdate=true;line.geometry.computeBoundingSphere();
  }

  update(dt,time=0) {
    if(!this.renderer?.xr.isPresenting) this.controls.update();
    if(!this.webgl) { this.drawCanvas(); return; }
    const lab=this.lab;
    for(const item of lab.items) {
      const mesh=this.meshes.get(item.id);mesh.position.copy(item.body.position);mesh.quaternion.copy(item.body.quaternion);
      if(item.grabbable) mesh.material.emissive.setHex(lab.hands.some(h=>h.heldId===item.id)?0x173f35:0x000000);
    }
    const head=V(lab.input.head.position).add(V(lab.rigPosition));
    const xr=this.renderer.xr.isPresenting;
    if(xr) this.rig.position.copy(lab.rigPosition);
    this.head.visible=!xr;this.visor.visible=!xr;this.torso.visible=!xr;this.playerRing.visible=!xr;
    this.head.position.copy(head);this.head.quaternion.copy(lab.input.head.quaternion||new THREE.Quaternion());
    this.visor.position.copy(head).add(new THREE.Vector3(0,.015,-.115).applyQuaternion(this.head.quaternion));this.visor.quaternion.copy(this.head.quaternion);
    this.torso.position.copy(head).add(new THREE.Vector3(0,-.5,.06));
    this.playerRing.position.set(lab.rigPosition.x,lab.rigPosition.y+.012,lab.rigPosition.z);
    for(let i=0;i<2;i++) {
      const hand=lab.hands[i], shoulder=head.clone().add(new THREE.Vector3(i? .24:-.24,-.25,.035));
      const elbow=shoulder.clone().lerp(V(hand.physical),.53).add(new THREE.Vector3(i?.12:-.12,-.16,.08));
      this.setLine(this.armLines[i],[shoulder,elbow,hand.physical]);this.armLines[i].visible=!xr;
      this.handTargets[i].position.copy(hand.target);this.handPhysical[i].position.copy(hand.physical);
      this.handPhysical[i].material.color.setHex(hand.heldId?palette.grab:palette.player);
      this.setLine(this.gapLines[i],[hand.target,hand.physical]);
    }
    if(xr&&time-this.lastHud>100) {
      this.lastHud=time;const c=this.hudCanvas.getContext('2d');c.clearRect(0,0,768,80);c.font='27px monospace';c.fillStyle='#b5d0db';c.textAlign='center';
      c.fillText(`${lab.locomotion.toUpperCase()} contact   ${lab.metrics.gapCm.toFixed(1)} cm   ${lab.metrics.forceN.toFixed(0)} N   ${lab.metrics.speed.toFixed(2)} m/s`,384,47);this.hudTexture.needsUpdate=true;
      for(const b of this.xrButtons) b.material.color.setHex(b.userData.command===lab.mode?0x397f6c:0x244238);
    }
    this.renderer.render(this.scene,this.camera);
  }

  // Canvas is a presentation fallback, not a different physics model.
  drawCanvas() {
    const ctx=this.ctx,w=this.width,h=this.height;ctx.clearRect(0,0,w,h);
    const grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,'#101d29');grad.addColorStop(1,'#0a131d');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
    this.camera.updateMatrixWorld(); const draw=[];
    const project=(p)=>{const v=V(p).project(this.camera);return {x:(v.x*.5+.5)*w,y:(-v.y*.5+.5)*h,z:v.z};};
    const depth=(p)=>V(p).applyMatrix4(this.camera.matrixWorldInverse).z;
    const line=(a,b,color,width=1)=>{const aa=project(a),bb=project(b);if(aa.z>1||bb.z>1)return;ctx.beginPath();ctx.moveTo(aa.x,aa.y);ctx.lineTo(bb.x,bb.y);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();};
    for(const item of this.lab.items) {
      const {position:p,quaternion:q}=item.body;const quat=new THREE.Quaternion(q.x,q.y,q.z,q.w);
      const corners=boxCorners.map(c=>new THREE.Vector3(c[0]*item.size.x*.5,c[1]*item.size.y*.5,c[2]*item.size.z*.5).applyQuaternion(quat).add(V(p)));
      const pts=corners.map(project),held=this.lab.hands.some(hand=>hand.heldId===item.id);
      for(let i=0;i<6;i++) {
        const ids=boxFaces[i];if(ids.some(k=>pts[k].z>1||pts[k].z< -1))continue;
        const center=ids.reduce((sum,k)=>sum.add(corners[k]),new THREE.Vector3()).multiplyScalar(.25);
        draw.push({z:depth(center),run:()=>{ctx.beginPath();ids.forEach((k,j)=>j?ctx.lineTo(pts[k].x,pts[k].y):ctx.moveTo(pts[k].x,pts[k].y));ctx.closePath();ctx.fillStyle=shade(item.color||0x304454,[.66,.9,.77,.85,1.12,.5][i]);ctx.fill();ctx.strokeStyle=held?'#86d9c48c':'#809bad35';ctx.lineWidth=held?1.5:.7;ctx.stroke();}});
      }
    }
    // Subtle floor lines are depth-sorted with the room and its props.
    for(let a=-4;a<=4;a+=.5) {
      const start={x:a,y:.006,z:-2},end={x:a,y:.006,z:5};
      draw.push({z:depth({x:a,y:.006,z:1.5})+.001,run:()=>line(start,end,'#536e7f30',.65)});
      const s={x:-4,y:.006,z:a+1},e={x:4,y:.006,z:a+1};
      draw.push({z:depth({x:0,y:.006,z:a+1})+.001,run:()=>line(s,e,'#536e7f30',.65)});
    }
    const sphere=(p,r,color,wire=false)=>{
      const s=project(p),edge=project({x:p.x+r,y:p.y,z:p.z});let radius=Math.max(2,Math.abs(s.x-edge.x));
      draw.push({z:depth(p),run:()=>{if(s.z>1||s.z< -1)return;ctx.beginPath();ctx.arc(s.x,s.y,radius,0,Math.PI*2);if(!wire){const g=ctx.createRadialGradient(s.x-radius*.3,s.y-radius*.4,0,s.x,s.y,radius);g.addColorStop(0,shade(color,1.35));g.addColorStop(.6,shade(color));g.addColorStop(1,shade(color,.5));ctx.fillStyle=g;ctx.fill();}ctx.strokeStyle=shade(color);ctx.lineWidth=1.3;ctx.stroke();if(wire){ctx.beginPath();ctx.ellipse(s.x,s.y,radius*.4,radius,0,0,Math.PI*2);ctx.stroke();}}});
    };
    const lab=this.lab,head=V(lab.input.head.position).add(V(lab.rigPosition));
    sphere(head,.14,palette.player);
    const chest=head.clone().add(new THREE.Vector3(0,-.37,.035)),waist=head.clone().add(new THREE.Vector3(0,-.73,.06));
    draw.push({z:depth(chest),run:()=>{line(chest,waist,'#527fb1',Math.max(10,30*w/1100));line(chest,waist,'#8bb7ff',Math.max(7,23*w/1100));}});
    for(let i=0;i<2;i++) {
      const hand=lab.hands[i],shoulder=head.clone().add(new THREE.Vector3(i?.24:-.24,-.26,.035)),elbow=shoulder.clone().lerp(V(hand.physical),.53).add(new THREE.Vector3(i?.12:-.12,-.16,.08));
      draw.push({z:depth(elbow),run:()=>{line(shoulder,elbow,'#90aec5',3);line(elbow,hand.physical,'#adc7d9',3);line(hand.target,hand.physical,'#ffb968',1.3);}});
      sphere(hand.physical,.05,hand.heldId?palette.grab:palette.player);sphere(hand.target,.07,palette.target,true);
    }
    draw.sort((a,b)=>a.z-b.z);for(const item of draw)item.run();
    // Screen-space labels stay crisp at the display resolution.
    const main=lab.items.find(item=>item.grabbable&&!item.isStatic);
    if(main){const p=project({x:main.body.position.x,y:main.body.position.y+main.size.y*.5+.14,z:main.body.position.z});if(p.z<1){ctx.font='600 11px system-ui';ctx.textAlign='center';ctx.fillStyle='#e1eee9';ctx.shadowColor='#071019';ctx.shadowBlur=4;ctx.fillText(`${lab.params?.cubeMass??1} kg`,p.x,p.y);ctx.shadowBlur=0;}}
  }
}
