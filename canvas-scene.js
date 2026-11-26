import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SPACING = 1.5, LANE = 1.42, WALL = 1.5, TRAIL = 36;
const v = () => ({ x: 0, y: 0, z: 0 });
function lerp(out, previous, current, alpha) {
  const p = previous || current;
  out.x = p.x + (current.x - p.x) * alpha;
  out.y = p.y + (current.y - p.y) * alpha;
  out.z = p.z + (current.z - p.z) * alpha;
}

/**
 * Projection fallback for clients without WebGL.
 * Uses the same Three.js camera/OrbitControls and the same simulation, while
 * drawing a small set of readable primitives instead of rasterizing meshes.
 */
export class CanvasGymScene {
  constructor(container, controllers) {
    this.container = container;
    this.controllers = controllers;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gym-canvas';
    this.canvas.dataset.renderer = 'canvas-fallback';
    this.canvas.setAttribute('aria-label', 'Interactive 3D controller gym, using a Canvas projection because WebGL is unavailable.');
    Object.assign(this.canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
    this.context = this.canvas.getContext('2d', { alpha: false });
    if (!this.context) throw new Error('Canvas rendering is unavailable.');
    this.surfaceCanvas = document.createElement('canvas');
    this.surfaceContext = this.surfaceCanvas.getContext('2d', { alpha: false });
    this.surfaceTransform = new Float64Array(32);
    this.surfaceDirty = true;
    container.prepend(this.canvas);
    this.camera = new THREE.OrthographicCamera(-8, 8, 4, -4, 0.1, 150);
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
    this.lanes = controllers.map((controller, index) => ({
      index, color: controller.color, offset: new THREE.Vector3(), body: v(),
      hands: [0, 1].map(() => ({ position: v(), target: v(), elbow: v(), shoulder: v(), points: new Float32Array(TRAIL * 3), ready: false })),
    }));
    this._projected = new THREE.Vector3();
    this._focus = new THREE.Vector3();
    this._previousFocus = new THREE.Vector3();
    this._delta = new THREE.Vector3();
    this._scratch = new THREE.Vector3();
    this._lineA = { x: 0, y: 0 }, this._lineB = { x: 0, y: 0 };
    this.order = this.lanes.map((_, i) => i);
    this.twoRows = false;
    this.selected = 3;
    this.mode = 'front';
    this.lastTime = -1;
    this.lastTrail = -1;
    this.width = this.height = 1;
    this.initialized = false;
    this.disposed = false;
    this._placeLanes();
    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(container);
    this._resize();
    this.fit('front');
  }

  _resize() {
    if (this.disposed) return;
    const width = Math.max(1, Math.round(this.container.clientWidth));
    const height = Math.max(1, Math.round(this.container.clientHeight));
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    this.ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * this.ratio);
    this.canvas.height = Math.round(height * this.ratio);
    this.surfaceCanvas.width = this.canvas.width;
    this.surfaceCanvas.height = this.canvas.height;
    this.surfaceDirty = true;
    this.fit(this.mode, this.selected);
  }

  _placeLanes() {
    const columns = this.twoRows ? 4 : 8;
    this.lanes.forEach((lane, i) => {
      lane.offset.set(((columns - 1) / 2 - i % columns) * SPACING, 0, this.twoRows && i < 4 ? 6.25 : 0);
    });
    this.surfaceDirty = true;
  }

  _bounds(mode, selected) {
    const lane = this.lanes[selected], b = lane.body, o = lane.offset;
    const half = (this.twoRows ? 4 : 8) * SPACING / 2;
    const min = mode === 'focus' ? new THREE.Vector3(o.x + b.x - 1.3, Math.max(0, b.y - 1.2), o.z + b.z - 1.7) : new THREE.Vector3(-half, -0.1, -4.05);
    const max = mode === 'focus' ? new THREE.Vector3(o.x + b.x + 1.3, b.y + 1.25, o.z + b.z + 1.7) : new THREE.Vector3(half, 3.6, this.twoRows ? 7.85 : 1.65);
    if (this.initialized) for (const item of this.lanes) {
      if (mode === 'focus' && item.index !== selected) continue;
      const body = item.body, offset = item.offset;
      min.x = Math.min(min.x, offset.x + body.x - 0.4); max.x = Math.max(max.x, offset.x + body.x + 0.4);
      min.y = Math.min(min.y, body.y - 0.43); max.y = Math.max(max.y, body.y + 0.8);
      min.z = Math.min(min.z, offset.z + body.z - 0.4); max.z = Math.max(max.z, offset.z + body.z + 0.4);
      for (const hand of item.hands) {
        const p = hand.position;
        min.x = Math.min(min.x, offset.x + p.x - 0.2); max.x = Math.max(max.x, offset.x + p.x + 0.2);
        min.y = Math.min(min.y, p.y - 0.2); max.y = Math.max(max.y, p.y + 0.2);
        min.z = Math.min(min.z, offset.z + p.z - 0.2); max.z = Math.max(max.z, offset.z + p.z + 0.2);
      }
    }
    return { min, max };
  }

  fit(mode = 'front', selected = this.selected) {
    this.mode = mode;
    this.selected = Math.max(0, Math.min(7, selected));
    const bounds = this._bounds(mode, this.selected);
    const center = new THREE.Vector3().addVectors(bounds.min, bounds.max).multiplyScalar(0.5);
    const direction = mode === 'top' ? new THREE.Vector3(0, 1, -0.06)
      : mode === 'angled' ? new THREE.Vector3(0.31, 0.48, -1)
        : mode === 'focus' ? new THREE.Vector3(0.18, 0.38, -1)
          : new THREE.Vector3(0, 0.43, -1);
    this.camera.position.copy(center).addScaledVector(direction.normalize(), 30);
    this.orbit.target.copy(center);
    this.camera.up.set(0, 1, 0);
    this.camera.zoom = 1;
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld(true);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      this._scratch.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
      minX = Math.min(minX, this._scratch.x); maxX = Math.max(maxX, this._scratch.x);
      minY = Math.min(minY, this._scratch.y); maxY = Math.max(maxY, this._scratch.y);
    }
    const aspect = this.width / this.height;
    const half = Math.max((maxY - minY) / 2, (maxX - minX) / (2 * aspect)) * 1.055;
    this.camera.left = -half * aspect; this.camera.right = half * aspect;
    this.camera.top = half; this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
    this.orbit.update();
    this.followFocus = mode === 'focus';
    const lane = this.lanes[this.selected];
    this._previousFocus.set(lane.body.x, lane.body.y, lane.body.z).add(lane.offset);
  }

  setLayout(twoRows) {
    if (this.twoRows === Boolean(twoRows)) return;
    this.twoRows = Boolean(twoRows);
    this._placeLanes();
    this.fit(this.mode, this.selected);
  }
  select(index) {
    this.selected = Math.max(0, Math.min(7, index));
    if (this.mode === 'focus') this.fit('focus', this.selected);
  }

  _project(out, x, y, z, offset) {
    this._projected.set(x + offset.x, y, z + offset.z).project(this.camera);
    out.x = (this._projected.x * 0.5 + 0.5) * this.width;
    out.y = (-this._projected.y * 0.5 + 0.5) * this.height;
  }
  _line(lane, ax, ay, az, bx, by, bz, color, width = 1, dashed = false) {
    this._project(this._lineA, ax, ay, az, lane.offset);
    this._project(this._lineB, bx, by, bz, lane.offset);
    const ctx = this.context;
    ctx.strokeStyle = color; ctx.lineWidth = width;
    if (dashed) ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(this._lineA.x, this._lineA.y); ctx.lineTo(this._lineB.x, this._lineB.y); ctx.stroke();
    if (dashed) ctx.setLineDash([]);
  }
  _poly(lane, points, color) {
    const ctx = this.context;
    ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < points.length; i += 3) {
      this._project(this._lineA, points[i], points[i + 1], points[i + 2], lane.offset);
      if (i === 0) ctx.moveTo(this._lineA.x, this._lineA.y);
      else ctx.lineTo(this._lineA.x, this._lineA.y);
    }
    ctx.closePath(); ctx.fill();
  }
  _ball(lane, x, y, z, radius, color) {
    this._project(this._lineA, x, y, z, lane.offset);
    const ctx = this.context, p = this._lineA, r = Math.max(1.1, radius * this.scale);
    const gradient = ctx.createRadialGradient(p.x - r * 0.32, p.y - r * 0.36, 0, p.x, p.y, r);
    gradient.addColorStop(0, '#e2efff'); gradient.addColorStop(0.3, color); gradient.addColorStop(1, '#172738');
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  }
  _ring(lane, p, radius, color, target = false) {
    this._project(this._lineA, p.x, p.y, p.z, lane.offset);
    const ctx = this.context, center = this._lineA, r = Math.max(2, radius * this.scale);
    ctx.strokeStyle = color; ctx.lineWidth = target ? 1.25 : 1.8;
    ctx.beginPath(); ctx.arc(center.x, center.y, r, 0, Math.PI * 2); ctx.stroke();
    if (target) {
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(center.x, center.y, r, r * 0.32, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(center.x, center.y, r * 0.32, r, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  _drawLane(lane, sim) {
    const ctx = this.context, left = -LANE / 2, right = LANE / 2;
    this._poly(lane, [left, 0, -4, right, 0, -4, right, 0, WALL, left, 0, WALL], lane.index % 2 ? '#26394c' : '#213346');
    if (lane.index === this.selected) {
      ctx.globalAlpha = 0.1;
      this._poly(lane, [left, 0, -4, right, 0, -4, right, 0, WALL, left, 0, WALL], lane.color);
      ctx.globalAlpha = 1;
    }
    if (!this.twoRows || lane.index < 4) this._poly(lane, [left, 0, WALL, right, 0, WALL, right, 3, WALL, left, 3, WALL], '#203244');
    for (let z = -4; z <= WALL; z += 0.5) this._line(lane, left, 0, z, right, 0, z, '#40566d', 0.8);
    for (const x of [left, 0, right]) this._line(lane, x, 0, -4, x, 0, WALL, '#40566d', 0.8);
    if (!this.twoRows || lane.index < 4) {
      for (let y = 0; y <= 3; y += 0.5) this._line(lane, left, y, WALL, right, y, WALL, '#40566d', 0.8);
    }
    this._line(lane, left, 0, WALL, left, 3, WALL, '#5e7488');
    this._line(lane, right, 0, WALL, right, 3, WALL, '#5e7488');
    this._line(lane, left + 0.07, 3.02, WALL, right - 0.07, 3.02, WALL, lane.color, lane.index === this.selected ? 3 : 2);
    this._line(lane, left, 0.01, -4, left, 0.01, WALL, lane.color, 1.05);
    this._line(lane, right, 0.01, -4, right, 0.01, WALL, lane.color, 1.05);
    const start = WALL - sim.params.startDistance;
    this._line(lane, left + 0.07, 0.02, start, right - 0.07, 0.02, start, '#c9dbea', 1.4, true);
    if (sim.exercise === 'ceiling') {
      ctx.globalAlpha = 0.16;
      this._poly(lane, [left, 2.15, -1.5, right, 2.15, -1.5, right, 2.15, WALL, left, 2.15, WALL], '#b5a165');
      ctx.globalAlpha = 1;
      this._line(lane, left, 2.15, -1.5, left, 2.15, WALL, '#b5a165');
      this._line(lane, right, 2.15, -1.5, right, 2.15, WALL, '#b5a165');
    }
  }

  _drawFigure(lane, opts) {
    const ctx = this.context, b = lane.body;
    this._project(this._lineA, b.x, 0.015, b.z, lane.offset);
    ctx.fillStyle = '#07111c'; ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.ellipse(this._lineA.x, this._lineA.y, this.scale * 0.29, this.scale * 0.10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    for (const h of lane.hands) {
      if (opts.trails) {
        ctx.strokeStyle = lane.color; ctx.lineWidth = 1.3; ctx.globalAlpha = 0.45; ctx.beginPath();
        for (let p = 0; p < h.points.length; p += 3) {
          this._project(this._lineA, h.points[p], h.points[p + 1], h.points[p + 2], lane.offset);
          if (p === 0) ctx.moveTo(this._lineA.x, this._lineA.y); else ctx.lineTo(this._lineA.x, this._lineA.y);
        }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      const sh = h.shoulder, el = h.elbow, p = h.position;
      this._line(lane, sh.x, sh.y, sh.z, el.x, el.y, el.z, '#afc3d7', Math.max(2, this.scale * 0.075));
      this._line(lane, el.x, el.y, el.z, p.x, p.y, p.z, '#afc3d7', Math.max(2, this.scale * 0.062));
      this._ball(lane, el.x, el.y, el.z, 0.06, '#4c657e');
      this._ball(lane, sh.x, sh.y, sh.z, 0.088, lane.color);
    }
    this._line(lane, b.x, b.y - 0.21, b.z, b.x, b.y + 0.23, b.z, '#112334', this.scale * 0.39);
    this._line(lane, b.x, b.y - 0.21, b.z, b.x, b.y + 0.23, b.z, lane.color, this.scale * 0.35);
    this._ball(lane, b.x, b.y + 0.12, b.z - 0.04, 0.18, lane.color);
    this._ball(lane, b.x, b.y - 0.28, b.z, 0.13, '#435b71');
    this._line(lane, b.x, b.y + 0.30, b.z, b.x, b.y + 0.45, b.z, '#afc3d7', Math.max(3, this.scale * 0.105));
    this._ball(lane, b.x, b.y + 0.56, b.z, 0.185, lane.color);
    this._line(lane, b.x - 0.13, b.y + 0.575, b.z - 0.14, b.x + 0.13, b.y + 0.575, b.z - 0.14, '#0a1621', Math.max(3, this.scale * 0.105));
    for (const hand of lane.hands) this._ball(lane, hand.position.x, hand.position.y, hand.position.z, 0.105, lane.color);
  }

  _drawSurfaces(sim) {
    const world = this.camera.matrixWorld.elements;
    const projection = this.camera.projectionMatrix.elements;
    let dirty = this.surfaceDirty || this.surfaceSelection !== this.selected
      || this.surfaceExercise !== sim.exercise || this.surfaceStart !== sim.params.startDistance;
    for (let i = 0; i < 16 && !dirty; i += 1) {
      dirty = Math.abs(this.surfaceTransform[i] - world[i]) > 1e-8
        || Math.abs(this.surfaceTransform[i + 16] - projection[i]) > 1e-8;
    }
    if (dirty || !this.surfaceContext) {
      const displayContext = this.context;
      this.context = this.surfaceContext || displayContext;
      const ctx = this.context;
      ctx.setTransform(this.ratio || 1, 0, 0, this.ratio || 1, 0, 0);
      ctx.globalAlpha = 1; ctx.setLineDash([]);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.fillStyle = '#0d1824'; ctx.fillRect(0, 0, this.width, this.height);
      this.order.sort((a, b) => {
        this._scratch.copy(this.lanes[a].offset).project(this.camera);
        const depth = this._scratch.z;
        this._scratch.copy(this.lanes[b].offset).project(this.camera);
        return this._scratch.z - depth;
      });
      for (const index of this.order) this._drawLane(this.lanes[index], sim);
      this.context = displayContext;
      for (let i = 0; i < 16; i += 1) {
        this.surfaceTransform[i] = world[i]; this.surfaceTransform[i + 16] = projection[i];
      }
      this.surfaceSelection = this.selected;
      this.surfaceExercise = sim.exercise;
      this.surfaceStart = sim.params.startDistance;
      this.surfaceDirty = false;
    }
    if (this.surfaceContext) {
      this.context.setTransform(1, 0, 0, 1, 0, 0);
      this.context.drawImage(this.surfaceCanvas, 0, 0);
    }
    this.context.setTransform(this.ratio || 1, 0, 0, this.ratio || 1, 0, 0);
    this.context.lineCap = 'round'; this.context.lineJoin = 'round';
  }

  render(sim, alpha = 1, opts = {}) {
    if (this.disposed) return;
    alpha = Math.max(0, Math.min(1, alpha));
    const reset = sim.time < this.lastTime || this.lastTime < 0;
    const sample = reset || sim.time - this.lastTrail >= 1 / 30;
    for (const lane of this.lanes) {
      const player = sim.players[lane.index];
      lerp(lane.body, player.prevBody, player.body, alpha);
      for (let i = 0; i < 2; i += 1) {
        const h = lane.hands[i], source = player.hands[i], b = lane.body;
        lerp(h.position, source.previous, source.position, alpha);
        lerp(h.target, source.prevTarget, source.target, alpha);
        h.shoulder.x = b.x + (i ? 0.235 : -0.235); h.shoulder.y = b.y + 0.24; h.shoulder.z = b.z;
        h.elbow.x = (h.shoulder.x + h.position.x) / 2 + (i ? 0.13 : -0.13);
        h.elbow.y = (h.shoulder.y + h.position.y) / 2 - 0.13; h.elbow.z = (h.shoulder.z + h.position.z) / 2 - 0.06;
        if (sample) {
          if (reset || !h.ready) {
            for (let p = 0; p < h.points.length; p += 3) { h.points[p] = h.position.x; h.points[p + 1] = h.position.y; h.points[p + 2] = h.position.z; }
            h.ready = true;
          } else {
            h.points.copyWithin(0, 3);
            h.points[h.points.length - 3] = h.position.x; h.points[h.points.length - 2] = h.position.y; h.points[h.points.length - 1] = h.position.z;
          }
        }
      }
    }
    this.initialized = true;
    this.lastTime = sim.time;
    if (sample) this.lastTrail = sim.time;
    if (this.followFocus) {
      const lane = this.lanes[this.selected], b = lane.body;
      this._focus.set(b.x, b.y, b.z).add(lane.offset);
      this._delta.subVectors(this._focus, this._previousFocus);
      this.camera.position.add(this._delta); this.orbit.target.add(this._delta);
      this._previousFocus.copy(this._focus);
    }
    this.orbit.update(); this.camera.updateMatrixWorld(true);
    const ctx = this.context;
    this.scale = this.height / (this.camera.top - this.camera.bottom) * this.camera.zoom;
    // Surfaces first: the wire-only front walls in 2-row mode never hide athletes.
    this._drawSurfaces(sim);
    for (const index of this.order) this._drawFigure(this.lanes[index], opts);
    // Diagnostic overlays remain visible through the tested contact surfaces.
    for (const lane of this.lanes) for (let i = 0; i < 2; i += 1) {
      const h = lane.hands[i], source = sim.players[lane.index].hands[i], p = h.position, target = h.target;
      if (opts.targets !== false) {
        this._line(lane, p.x, p.y, p.z, target.x, target.y, target.z, '#efb56a', 1.25, true);
        this._ring(lane, target, 0.137, '#78eac4', true);
      }
      if (source.contact) this._ring(lane, p, 0.155, '#ff797b');
      if (opts.forces) {
        const a = source.accel, length = Math.hypot(a.x, a.y, a.z);
        if (length > 1) {
          const s = Math.min(0.8, length * 0.0018) / length;
          this._line(lane, p.x, p.y, p.z, p.x + a.x * s, p.y + a.y * s, p.z + a.z * s, '#d9b5ff', 1.8);
          const end = this._lineB, angle = Math.atan2(end.y - this._lineA.y, end.x - this._lineA.x);
          ctx.fillStyle = '#d9b5ff'; ctx.beginPath(); ctx.moveTo(end.x, end.y);
          ctx.lineTo(end.x - Math.cos(angle - 0.45) * 6, end.y - Math.sin(angle - 0.45) * 6);
          ctx.lineTo(end.x - Math.cos(angle + 0.45) * 6, end.y - Math.sin(angle + 0.45) * 6); ctx.closePath(); ctx.fill();
        }
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.orbit.dispose();
    this.canvas.remove();
    this.surfaceCanvas.width = this.surfaceCanvas.height = 1;
  }
}
