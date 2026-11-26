import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SPACING = 1.82;
const LANE_WIDTH = 1.72;
const WALL_Z = 1.5;
const HAND_RADIUS = 0.105;
const TRAIL_POINTS = 36;
const UP = new THREE.Vector3(0, 1, 0);

/** Three.js view only. All controller state remains in GymSimulation. */
export class GymScene {
  constructor(container, controllers) {
    this.container = container;
    this.controllers = controllers;
    this.twoRows = false;
    this.selected = 3;
    this.mode = 'front';
    this.lastTime = -1;
    this.lastTrailTime = -1;
    this.width = 1;
    this.height = 1;
    this.disposed = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0d1824');
    this.camera = new THREE.OrthographicCamera(-8, 8, 4, -4, 0.1, 150);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'gym-canvas';
    this.canvas.setAttribute('aria-label', 'Eight synchronized physical players in the controller testing gym. Drag to orbit; scroll to zoom.');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.touchAction = 'none';
    this.container.prepend(this.canvas);

    this.orbit = new OrbitControls(this.camera, this.canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.14;
    this.orbit.rotateSpeed = 0.65;
    this.orbit.zoomSpeed = 0.85;
    this.orbit.minZoom = 0.55;
    this.orbit.maxZoom = 5;
    this.orbit.minPolarAngle = 0.025;
    this.orbit.maxPolarAngle = Math.PI * 0.48;
    this.orbit.screenSpacePanning = true;
    this.orbit.addEventListener('start', () => { this.followFocus = false; });

    this.scene.add(new THREE.HemisphereLight(0xdcecff, 0x42556b, 2.2));
    const key = new THREE.DirectionalLight(0xfff5e7, 2.6);
    key.position.set(-5, 10, -7);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x91b9ff, 1.35);
    rim.position.set(6, 5, 6);
    this.scene.add(rim);

    this.geometry = {
      sphere: new THREE.SphereGeometry(1, 20, 14),
      box: new THREE.BoxGeometry(1, 1, 1),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 10),
      torso: new THREE.CapsuleGeometry(0.195, 0.29, 5, 16),
      plane: new THREE.PlaneGeometry(1, 1),
      ring: new THREE.TorusGeometry(1, 0.055, 5, 28),
      disc: new THREE.CircleGeometry(1, 32),
    };
    this.material = {
      floor: new THREE.MeshStandardMaterial({ color: 0x223244, roughness: 0.9 }),
      alternateFloor: new THREE.MeshStandardMaterial({ color: 0x26384b, roughness: 0.9 }),
      wall: new THREE.MeshStandardMaterial({ color: 0x203447, roughness: 0.92 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x344d64, roughness: 0.65 }),
      limb: new THREE.MeshStandardMaterial({ color: 0xb1c3d3, metalness: 0.22, roughness: 0.37 }),
      joint: new THREE.MeshStandardMaterial({ color: 0x26394a, metalness: 0.1, roughness: 0.5 }),
      visor: new THREE.MeshStandardMaterial({ color: 0x09131c, roughness: 0.14, metalness: 0.4 }),
      contact: new THREE.MeshBasicMaterial({ color: 0xff6f70, transparent: true, opacity: 0.95 }),
      target: new THREE.LineBasicMaterial({ color: 0x70edc5, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }),
      grid: new THREE.LineBasicMaterial({ color: 0x4b6379, transparent: true, opacity: 0.52 }),
      error: new THREE.LineDashedMaterial({ color: 0xf6bb66, dashSize: 0.065, gapSize: 0.035, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }),
      ceiling: new THREE.MeshStandardMaterial({ color: 0x8c7d55, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
      shadow: new THREE.MeshBasicMaterial({ color: 0x040b12, transparent: true, opacity: 0.18, depthWrite: false }),
      start: new THREE.MeshBasicMaterial({ color: 0xd7e6f3, transparent: true, opacity: 0.65, depthWrite: false }),
    };
    this._body = new THREE.Vector3();
    this._hand = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._shoulder = new THREE.Vector3();
    this._elbow = new THREE.Vector3();
    this._delta = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._cameraDelta = new THREE.Vector3();
    this._focusPosition = new THREE.Vector3();
    this._lastFocusPosition = new THREE.Vector3();
    this._boundsPoint = new THREE.Vector3();
    this.lanes = controllers.map((definition, index) => this._makeLane(definition, index));
    this._placeLanes();
    this.select(this.selected);
    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(container);
    this._resize();
    this.fit('front');
  }

  _mesh(geometry, material, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(x, y, z);
    return mesh;
  }

  _segments(vertices, material) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return new THREE.LineSegments(geometry, material);
  }

  _targetRings() {
    const positions = [];
    const count = 32;
    for (let axis = 0; axis < 3; axis += 1) {
      for (let i = 0; i < count; i += 1) {
        for (const angle of [i / count * Math.PI * 2, (i + 1) / count * Math.PI * 2]) {
          const a = Math.cos(angle) * 0.137;
          const b = Math.sin(angle) * 0.137;
          if (axis === 0) positions.push(0, a, b);
          else if (axis === 1) positions.push(a, 0, b);
          else positions.push(a, b, 0);
        }
      }
    }
    return this._segments(positions, this.material.target);
  }

  _makeLane(definition, index) {
    const group = new THREE.Group();
    this.scene.add(group);
    const color = new THREE.Color(definition.color);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.34, metalness: 0.09 });
    const accentMaterial = new THREE.MeshBasicMaterial({ color });
    const floor = this._mesh(this.geometry.box, index % 2 ? this.material.alternateFloor : this.material.floor, LANE_WIDTH, 0.09, 5.5);
    floor.position.set(0, -0.055, -1.25);
    group.add(floor);

    const back = this._mesh(this.geometry.plane, this.material.wall, LANE_WIDTH, 3, 1);
    back.position.set(0, 1.5, WALL_Z + 0.025);
    back.rotation.y = Math.PI;
    group.add(back);
    const gridVertices = [];
    for (let z = -4; z <= WALL_Z; z += 0.5) {
      gridVertices.push(-LANE_WIDTH / 2, 0.003, z, LANE_WIDTH / 2, 0.003, z);
    }
    for (const x of [-LANE_WIDTH / 2, 0, LANE_WIDTH / 2]) {
      gridVertices.push(x, 0.003, -4, x, 0.003, WALL_Z);
    }
    for (let y = 0; y <= 3; y += 0.5) {
      gridVertices.push(-LANE_WIDTH / 2, y, WALL_Z + 0.015, LANE_WIDTH / 2, y, WALL_Z + 0.015);
    }
    group.add(this._segments(gridVertices, this.material.grid));
    for (const x of [-LANE_WIDTH / 2, LANE_WIDTH / 2]) {
      const post = this._mesh(this.geometry.box, this.material.trim, 0.035, 3.03, 0.045);
      post.position.set(x, 1.5, WALL_Z + 0.035);
      group.add(post);
      const rail = this._mesh(this.geometry.box, accentMaterial, 0.018, 0.012, 5.5);
      rail.position.set(x, 0.009, -1.25);
      group.add(rail);
    }
    const headerBar = this._mesh(this.geometry.box, accentMaterial, LANE_WIDTH - 0.15, 0.045, 0.04);
    headerBar.position.set(0, 3.02, WALL_Z);
    group.add(headerBar);

    const selection = this._mesh(this.geometry.plane,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.10, depthWrite: false }),
      LANE_WIDTH - 0.08, 5.35, 1);
    selection.rotation.x = -Math.PI / 2;
    selection.position.set(0, 0.004, -1.25);
    group.add(selection);
    const startLine = this._mesh(this.geometry.plane, this.material.start, LANE_WIDTH - 0.13, 0.028, 1);
    startLine.rotation.x = -Math.PI / 2;
    startLine.position.y = 0.013;
    group.add(startLine);

    const ceiling = this._mesh(this.geometry.plane, this.material.ceiling, LANE_WIDTH, 3.2, 1);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 2.15, -0.1);
    ceiling.visible = false;
    group.add(ceiling);

    const figure = new THREE.Group();
    group.add(figure);
    const torso = new THREE.Mesh(this.geometry.torso, bodyMaterial);
    torso.position.y = 0.02;
    torso.scale.z = 0.8;
    figure.add(torso);
    const pelvis = this._mesh(this.geometry.sphere, this.material.joint, 0.14, 0.13, 0.12);
    pelvis.position.set(0, -0.29, 0);
    figure.add(pelvis);
    const neck = this._mesh(this.geometry.cylinder, this.material.limb, 0.065, 0.11, 0.065);
    neck.position.y = 0.38;
    figure.add(neck);
    const head = this._mesh(this.geometry.sphere, bodyMaterial, 0.19, 0.185, 0.175);
    head.position.y = 0.56;
    figure.add(head);
    const visor = this._mesh(this.geometry.sphere, this.material.visor, 0.175, 0.064, 0.075);
    visor.position.set(0, 0.575, -0.132);
    figure.add(visor);
    const chest = this._mesh(this.geometry.sphere, this.material.joint, 0.088, 0.088, 0.025);
    chest.position.set(0, 0.115, -0.158);
    figure.add(chest);
    const chestLight = this._mesh(this.geometry.sphere, accentMaterial, 0.032, 0.032, 0.012);
    chestLight.position.set(0, 0.115, -0.185);
    figure.add(chestLight);

    const shadow = new THREE.Group();
    for (const radius of [0.31, 0.25, 0.18]) {
      const disc = this._mesh(this.geometry.disc, this.material.shadow, radius, radius * 0.8, 1);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.014 + radius * 0.003;
      shadow.add(disc);
    }
    group.add(shadow);

    const hands = [0, 1].map((handIndex) => {
      const physical = this._mesh(this.geometry.sphere, bodyMaterial, HAND_RADIUS, HAND_RADIUS, HAND_RADIUS);
      const cuff = this._mesh(this.geometry.sphere, this.material.joint, 0.113, 0.065, 0.113);
      const upper = this._mesh(this.geometry.cylinder, this.material.limb, 0.037, 1, 0.037);
      const lower = this._mesh(this.geometry.cylinder, this.material.limb, 0.032, 1, 0.032);
      const elbow = this._mesh(this.geometry.sphere, this.material.joint, 0.063, 0.063, 0.063);
      const shoulder = this._mesh(this.geometry.sphere, bodyMaterial, 0.096, 0.096, 0.096);
      const target = this._targetRings();
      target.renderOrder = 3;
      const contact = new THREE.Group();
      for (const rotationY of [0, Math.PI / 2]) {
        const ring = this._mesh(this.geometry.ring, this.material.contact, 0.151, 0.151, 0.151);
        ring.rotation.y = rotationY;
        contact.add(ring);
      }
      const errorGeometry = new THREE.BufferGeometry();
      errorGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      errorGeometry.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(2), 1));
      const error = new THREE.Line(errorGeometry, this.material.error);
      error.renderOrder = 3;
      error.frustumCulled = false;
      const force = new THREE.ArrowHelper(UP, new THREE.Vector3(), 0.1, 0xd3b0ff, 0.08, 0.06);
      const trailGeometry = new THREE.BufferGeometry();
      trailGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const trail = new THREE.Line(trailGeometry,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false }));
      trail.frustumCulled = false;
      group.add(physical, cuff, upper, lower, elbow, shoulder, target, contact, error, force, trail);
      return { physical, cuff, upper, lower, elbow, shoulder, target, contact, error, force, trail, handIndex, trailReady: false };
    });
    return { group, figure, hands, shadow, ceiling, selection, startLine, headerBar, bodyMaterial, accentMaterial, back };
  }

  _placeLanes() {
    const columns = this.twoRows ? 4 : 8;
    for (let i = 0; i < this.lanes.length; i += 1) {
      const column = i % columns;
      // The camera faces +Z; reversing X keeps lane 01 at screen left.
      this.lanes[i].group.position.set(((columns - 1) / 2 - column) * SPACING, 0, this.twoRows && i >= 4 ? 6.25 : 0);
      // Wire frames retain the contact surface without hiding the second row.
      this.lanes[i].back.visible = !this.twoRows || i >= 4;
    }
  }

  _resize() {
    if (this.disposed) return;
    const width = Math.max(1, Math.round(this.container.clientWidth));
    const height = Math.max(1, Math.round(this.container.clientHeight));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    if (this.lanes) this.fit(this.mode, this.selected);
  }

  _viewBounds(mode, selected) {
    if (mode === 'focus') {
      const lane = this.lanes[selected];
      const x = lane.group.position.x;
      const z = lane.group.position.z + lane.figure.position.z;
      const y = lane.figure.position.y || 0.88;
      return this._includeAthletes({ min: new THREE.Vector3(x - 1.3, Math.max(0, y - 1.2), z - 1.7), max: new THREE.Vector3(x + 1.3, y + 1.25, z + 1.7) }, selected);
    }
    const halfWidth = (this.twoRows ? 4 : 8) * SPACING / 2;
    return this._includeAthletes({
      min: new THREE.Vector3(-halfWidth, -0.1, -4.05),
      max: new THREE.Vector3(halfWidth, 3.6, this.twoRows ? 7.85 : 1.65),
    });
  }

  _includeAthletes(bounds, only = -1) {
    for (let i = 0; i < this.lanes.length; i += 1) {
      if (only >= 0 && i !== only) continue;
      const lane = this.lanes[i], offset = lane.group.position, body = lane.figure.position;
      bounds.min.x = Math.min(bounds.min.x, offset.x + body.x - 0.4);
      bounds.max.x = Math.max(bounds.max.x, offset.x + body.x + 0.4);
      bounds.min.y = Math.min(bounds.min.y, body.y - 0.43);
      bounds.max.y = Math.max(bounds.max.y, body.y + 0.8);
      bounds.min.z = Math.min(bounds.min.z, offset.z + body.z - 0.4);
      bounds.max.z = Math.max(bounds.max.z, offset.z + body.z + 0.4);
      for (const hand of lane.hands) {
        const position = hand.physical.position;
        bounds.min.x = Math.min(bounds.min.x, offset.x + position.x - 0.2);
        bounds.max.x = Math.max(bounds.max.x, offset.x + position.x + 0.2);
        bounds.min.y = Math.min(bounds.min.y, position.y - 0.2);
        bounds.max.y = Math.max(bounds.max.y, position.y + 0.2);
        bounds.min.z = Math.min(bounds.min.z, offset.z + position.z - 0.2);
        bounds.max.z = Math.max(bounds.max.z, offset.z + position.z + 0.2);
      }
    }
    return bounds;
  }

  fit(mode = 'front', selected = this.selected) {
    if (this.disposed) return;
    this.mode = mode;
    this.selected = Math.max(0, Math.min(this.lanes.length - 1, selected));
    const bounds = this._viewBounds(mode, this.selected);
    const center = new THREE.Vector3().addVectors(bounds.min, bounds.max).multiplyScalar(0.5);
    const direction = mode === 'top'
      ? new THREE.Vector3(0, 1, -0.06)
      : mode === 'angled'
        ? new THREE.Vector3(0.31, this.twoRows ? 0.85 : 0.48, -1)
        : mode === 'focus'
          ? new THREE.Vector3(0.18, 0.38, -1)
          : new THREE.Vector3(0, this.twoRows ? 0.95 : 0.43, -1);
    this.camera.position.copy(center).addScaledVector(direction.normalize(), 30);
    this.orbit.target.copy(center);
    this.camera.up.copy(UP);
    this.camera.zoom = 1;
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld(true);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          this._boundsPoint.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
          minX = Math.min(minX, this._boundsPoint.x);
          maxX = Math.max(maxX, this._boundsPoint.x);
          minY = Math.min(minY, this._boundsPoint.y);
          maxY = Math.max(maxY, this._boundsPoint.y);
        }
      }
    }
    const aspect = this.width / this.height;
    const halfHeight = Math.max((maxY - minY) / 2, (maxX - minX) / (2 * aspect)) * 1.055;
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.orbit.update();
    this.followFocus = mode === 'focus';
    this._lastFocusPosition.copy(this.lanes[this.selected].figure.position).add(this.lanes[this.selected].group.position);
  }

  setLayout(twoRows) {
    if (this.twoRows === Boolean(twoRows)) return;
    this.twoRows = Boolean(twoRows);
    this._placeLanes();
    this.fit(this.mode, this.selected);
  }

  select(index) {
    this.selected = Math.max(0, Math.min(this.lanes.length - 1, index));
    for (let i = 0; i < this.lanes.length; i += 1) {
      this.lanes[i].selection.visible = i === this.selected;
      this.lanes[i].headerBar.scale.y = i === this.selected ? 0.07 : 0.035;
    }
    if (this.mode === 'focus') this.fit('focus', this.selected);
  }

  _interpolate(out, before, after, alpha) {
    const previous = before || after;
    out.set(previous.x + (after.x - previous.x) * alpha,
      previous.y + (after.y - previous.y) * alpha,
      previous.z + (after.z - previous.z) * alpha);
  }

  _limb(mesh, start, end, radius) {
    this._delta.subVectors(end, start);
    const length = this._delta.length();
    mesh.position.copy(start).addScaledVector(this._delta, 0.5);
    mesh.scale.set(radius, Math.max(0.001, length), radius);
    if (length > 0.0001) mesh.quaternion.setFromUnitVectors(UP, this._delta.multiplyScalar(1 / length));
  }

  render(sim, alpha = 1, opts = {}) {
    if (this.disposed || !sim.players) return;
    alpha = Math.max(0, Math.min(1, alpha));
    const resetTrails = sim.time < this.lastTime || this.lastTime < 0;
    const sampleTrail = resetTrails || sim.time - this.lastTrailTime >= 1 / 30;
    const startZ = WALL_Z - (sim.params.startDistance || 1);
    for (let i = 0; i < this.lanes.length; i += 1) {
      const lane = this.lanes[i], player = sim.players[i];
      if (!player) continue;
      this._interpolate(this._body, player.prevBody, player.body, alpha);
      lane.figure.position.copy(this._body);
      lane.shadow.position.set(this._body.x, 0, this._body.z);
      const shadowScale = 1 + Math.max(0, this._body.y - 0.85) * 0.2;
      lane.shadow.scale.set(shadowScale, 1, shadowScale);
      lane.ceiling.visible = sim.exercise === 'ceiling';
      lane.startLine.position.z = startZ;
      for (let handIndex = 0; handIndex < 2; handIndex += 1) {
        const h = player.hands[handIndex], visual = lane.hands[handIndex];
        this._interpolate(this._hand, h.previous, h.position, alpha);
        this._interpolate(this._target, h.prevTarget, h.target, alpha);
        visual.physical.position.copy(this._hand);
        visual.cuff.position.copy(this._hand).addScaledVector(UP, 0.055);
        visual.target.position.copy(this._target);
        visual.target.visible = opts.targets !== false;
        visual.contact.position.copy(this._hand);
        visual.contact.visible = Boolean(h.contact);
        this._shoulder.copy(this._body);
        this._shoulder.x += handIndex ? 0.235 : -0.235;
        this._shoulder.y += 0.24;
        this._elbow.addVectors(this._shoulder, this._hand).multiplyScalar(0.5);
        this._elbow.x += handIndex ? 0.13 : -0.13;
        this._elbow.y -= 0.13;
        this._elbow.z -= 0.06;
        visual.shoulder.position.copy(this._shoulder);
        visual.elbow.position.copy(this._elbow);
        this._limb(visual.upper, this._shoulder, this._elbow, 0.039);
        this._limb(visual.lower, this._elbow, this._hand, 0.032);
        const errorPosition = visual.error.geometry.attributes.position;
        errorPosition.setXYZ(0, this._hand.x, this._hand.y, this._hand.z);
        errorPosition.setXYZ(1, this._target.x, this._target.y, this._target.z);
        errorPosition.needsUpdate = true;
        visual.error.geometry.attributes.lineDistance.setX(1, this._hand.distanceTo(this._target));
        visual.error.geometry.attributes.lineDistance.needsUpdate = true;
        visual.error.visible = opts.targets !== false;
        this._direction.set(h.accel.x, h.accel.y, h.accel.z);
        const magnitude = this._direction.length();
        visual.force.visible = Boolean(opts.forces) && magnitude > 1;
        if (visual.force.visible) {
          visual.force.position.copy(this._hand);
          visual.force.setDirection(this._direction.multiplyScalar(1 / magnitude));
          const length = Math.min(0.8, magnitude * 0.0018);
          visual.force.setLength(length, Math.min(0.09, length * 0.3), Math.min(0.06, length * 0.22));
        }
        visual.trail.visible = Boolean(opts.trails);
        if (sampleTrail) {
          const points = visual.trail.geometry.attributes.position.array;
          if (resetTrails || !visual.trailReady) {
            for (let p = 0; p < points.length; p += 3) {
              points[p] = this._hand.x;
              points[p + 1] = this._hand.y;
              points[p + 2] = this._hand.z;
            }
            visual.trailReady = true;
          } else {
            points.copyWithin(0, 3);
            points[points.length - 3] = this._hand.x;
            points[points.length - 2] = this._hand.y;
            points[points.length - 1] = this._hand.z;
          }
          visual.trail.geometry.attributes.position.needsUpdate = true;
        }
      }
    }
    if (sampleTrail) this.lastTrailTime = sim.time;
    this.lastTime = sim.time;
    if (this.followFocus) {
      const lane = this.lanes[this.selected];
      this._focusPosition.copy(lane.figure.position).add(lane.group.position);
      this._cameraDelta.subVectors(this._focusPosition, this._lastFocusPosition);
      this.camera.position.add(this._cameraDelta);
      this.orbit.target.add(this._cameraDelta);
      this._lastFocusPosition.copy(this._focusPosition);
    }
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.orbit.dispose();
    const geometries = new Set(), materials = new Set();
    this.scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
      else if (object.material) materials.add(object.material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.renderer.dispose();
    this.canvas.remove();
  }
}
