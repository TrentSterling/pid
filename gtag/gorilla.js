/*
 * Gorilla locomotion in plain JavaScript (no engine), metres / seconds / kilograms.
 *
 * This is a port of the update loop in Another-Axiom/GorillaLocomotion Player.cs
 * (MIT, pinned at commit bc42e959cf3e69178f9147d89bd3ffeab1c432c4, preserved under
 * upstream/GorillaLocomotion). It follows that file's order of operations: sphere-cast
 * each hand, remember where it stuck, move the player by the opposite of the stuck
 * hand's tracked motion, average the two hands when both hold, check the head, then
 * launch from a short velocity history.
 *
 * Differences from the Unity original, on purpose and listed in the tutorial:
 *  - the world is axis-aligned boxes, so a sphere cast is an exact slab test on a box
 *    grown by the radius (Unity casts against arbitrary colliders);
 *  - Unity's extra raycast "anti-clipping" checks are not needed for exact box sweeps;
 *  - the Rigidbody is a small gravity + box-hull integrator with ground friction;
 *  - held cubes are kinematic while held, simple boxes otherwise (see Cube).
 * The numeric defaults are the values commonly used in Gorilla Tag clone tutorials. They are
 * not Gorilla Tag's own tuning, which is not public.
 */

export const DEFAULTS = Object.freeze({
  velocityHistorySize: 6,
  maxArmLength: 1.5,
  unStickDistance: 1,
  velocityLimit: 0.4,
  maxJumpSpeed: 6.5,
  jumpMultiplier: 1.1,
  minimumRaycastDistance: 0.05, // hand sphere radius
  defaultSlideFactor: 0.03,
  defaultPrecision: 0.995,
  headRadius: 0.15,
  headHeight: 1.65,        // head above the rig origin
  hullHalf: [0.2, 0.5, 0.2],
  hullCenterBelowHead: 0.5, // hull spans head-1.0 .. head
  bodyMass: 75,
  gravity: 9.8,
  groundFriction: 5,       // horizontal deceleration while the hull rests on something, m/s^2
});

const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, n) => V(a.x * n, a.y * n, a.z * n);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = a => Math.hypot(a.x, a.y, a.z);
const norm = a => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : V(); };
const copy = a => V(a.x, a.y, a.z);
const AX = ['x', 'y', 'z'];
const finite = v => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

export const vec = V;
export const vadd = add;
export const vsub = sub;
export const vmul = mul;
export const vlen = len;

/** Rotate a rig-local vector by the rig's yaw (radians, about +Y; yaw 0 faces -Z). */
export function yawRotate(v, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return V(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

/**
 * Sweep an axis-aligned extent (half sizes) from `start` along `move` against boxes
 * { center, half }. Returns { t, normal, box } for the earliest entry, or null.
 * A start that is already inside a grown box only hits when moving deeper in.
 */
export function sweepBoxes(start, move, extent, boxes) {
  let best = null;
  for (const box of boxes) {
    const lo = V(), hi = V();
    for (const a of AX) { lo[a] = box.center[a] - box.half[a] - extent[a]; hi[a] = box.center[a] + box.half[a] + extent[a]; }
    const inside = AX.every(a => start[a] > lo[a] + 1e-9 && start[a] < hi[a] - 1e-9);
    if (inside) {
      let dist = Infinity, normal = null;
      for (const a of AX) {
        const d0 = start[a] - lo[a], d1 = hi[a] - start[a];
        if (d0 < dist) { dist = d0; normal = V(); normal[a] = -1; }
        if (d1 < dist) { dist = d1; normal = V(); normal[a] = 1; }
      }
      if (dot(move, normal) < -1e-12 && (!best || best.t > 0)) best = { t: 0, normal, box, inside: true };
      continue;
    }
    let enter = 0, leave = 1, normal = null, miss = false;
    for (const a of AX) {
      const s = start[a], d = move[a];
      if (Math.abs(d) < 1e-12) { if (s <= lo[a] || s >= hi[a]) { miss = true; break; } continue; }
      let near = (lo[a] - s) / d, far = (hi[a] - s) / d;
      const sign = d > 0 ? -1 : 1;
      if (near > far) [near, far] = [far, near];
      if (near > enter) { enter = near; normal = V(); normal[a] = sign; }
      leave = Math.min(leave, far);
      if (enter > leave) { miss = true; break; }
    }
    if (miss || !normal || enter > 1) continue;
    if (!best || enter < best.t) best = { t: enter, normal, box };
  }
  return best;
}

/** Unity's CollisionsSphereCast, simplified for exact box sweeps. */
function collisionsSphereCast(boxes, start, radius, move, precision) {
  const r = radius * precision;
  const hit = sweepBoxes(start, move, V(r, r, r), boxes);
  if (!hit) return { hit: false, final: V() };
  // Land a full `radius` away from the surface, not the shrunken cast radius.
  const center = add(start, mul(move, hit.t));
  return { hit: true, final: add(center, mul(hit.normal, radius - r)), normal: hit.normal, box: hit.box };
}

/** Unity's IterativeCollisionSphereCast: cast, then slide a small fraction along the plane. */
export function iterativeSphereCast(boxes, start, radius, move, precision, singleHand, slideFactor, singleSlip = 0.001) {
  const first = collisionsSphereCast(boxes, start, radius, move, precision);
  if (first.hit) {
    const firstPosition = first.final;
    const slip = !singleHand ? slideFactor : singleSlip;
    const rest = sub(add(start, move), firstPosition);
    const planar = mul(sub(rest, mul(first.normal, dot(rest, first.normal))), slip);
    const slide = collisionsSphereCast(boxes, firstPosition, radius, planar, precision * precision);
    if (slide.hit) return { hit: true, final: slide.final, normal: slide.normal, box: slide.box };
    const from = add(planar, firstPosition);
    const toward = collisionsSphereCast(boxes, from, radius, sub(add(start, move), from), precision ** 3);
    if (toward.hit) return { hit: true, final: toward.final, normal: toward.normal, box: toward.box };
    return { hit: true, final: firstPosition, normal: first.normal, box: first.box };
  }
  // Sanity cast for a sphere that starts already touching a surface.
  const m = len(move);
  if (m > 1e-12) {
    const small = collisionsSphereCast(boxes, start, radius * precision * 0.66, mul(norm(move), m + radius * precision * 0.34), precision * 0.66);
    if (small.hit) return { hit: true, final: copy(start), normal: small.normal, box: small.box };
  }
  return { hit: false, final: V() };
}

/** A small box that can be carried. Kinematic while held, simple falling box otherwise. */
export class Cube {
  constructor(id, position, size = 0.3, mass = 5) {
    this.id = id;
    this.position = copy(position);
    this.velocity = V();
    this.half = V(size / 2, size / 2, size / 2);
    this.mass = mass;
    this.heldBy = -1;
    this.initial = copy(position);
    this.resting = false;
  }
}

export class GorillaPlayer {
  constructor(options = {}) {
    this.p = { ...DEFAULTS, ...options };
    this.boxes = options.boxes || [];
    this.cubes = options.cubes || [];
    this.position = copy(options.position || V(0, 0, 0)); // rig origin
    this.velocity = V();
    this.yaw = options.yaw || 0;
    this.time = 0;
    this.grounded = false;
    this.history = Array.from({ length: this.p.velocityHistorySize }, () => V());
    this.historyIndex = 0;
    this.denormalizedVelocityAverage = V();
    this.lastPosition = copy(this.position);
    // Inputs: tracked, rig-local positions of the hands. The head is fixed over the origin.
    this.handLocal = [V(-0.25, 1.0, -0.45), V(0.25, 1.0, -0.45)];
    this.grip = [false, false];
    this.hands = [0, 1].map(() => ({
      last: V(), wasTouching: false, colliding: false, held: null, previousGrip: false, velocity: V(), previous: V(),
    }));
    this.lastHead = this.head();
    this.stats = { launches: 0, touchSeconds: 0 };
    for (const h of [0, 1]) { this.hands[h].last = this.rawHand(h); this.hands[h].previous = copy(this.hands[h].last); }
  }

  head() { return add(this.position, yawRotate(V(0, this.p.headHeight, 0), this.yaw)); }

  hull() {
    const head = this.head();
    return { center: add(head, V(0, -this.p.hullCenterBelowHead, 0)), half: V(...this.p.hullHalf) };
  }

  /** Unity CurrentLeft/RightHandPosition: tracked hand, clamped to maxArmLength from the head. */
  rawHand(h) {
    const head = this.head();
    const world = add(this.position, yawRotate(this.handLocal[h], this.yaw));
    const d = sub(world, head);
    return len(d) < this.p.maxArmLength ? world : add(head, mul(norm(d), this.p.maxArmLength));
  }

  heldMass() { return this.cubes.filter(c => c.heldBy >= 0).reduce((m, c) => m + c.mass, 0); }

  /** Add a yaw turn about the head, as Player.Turn does, rotating stored velocities too. */
  turn(radians) {
    const head = this.head();
    const offset = sub(this.position, head);
    const turned = yawRotate(offset, radians);
    this.position = add(head, turned);
    this.yaw += radians;
    this.denormalizedVelocityAverage = yawRotate(this.denormalizedVelocityAverage, radians);
    this.history = this.history.map(v => yawRotate(v, radians));
    this.velocity = yawRotate(this.velocity, radians);
    this.lastPosition = copy(this.position);
    this.lastHead = this.head();
    for (const h of this.hands) h.last = add(head, yawRotate(sub(h.last, head), radians));
  }

  setHands(left, right, gripLeft = this.grip[0], gripRight = this.grip[1]) {
    if (left) this.handLocal[0] = copy(left);
    if (right) this.handLocal[1] = copy(right);
    this.grip = [Boolean(gripLeft), Boolean(gripRight)];
  }

  _gripCubes() {
    for (const h of [0, 1]) {
      const hand = this.hands[h];
      const pressed = this.grip[h] && !hand.previousGrip;
      if (!this.grip[h] && hand.held) this._release(h);
      if (pressed && !hand.held) {
        let best = null, bestD = Infinity;
        for (const c of this.cubes) {
          if (c.heldBy >= 0) continue;
          const d = len(sub(c.position, hand.last)) - c.half.x;
          if (d < 0.22 && d < bestD) { best = c; bestD = d; }
        }
        if (best) { hand.held = best; best.heldBy = h; best.velocity = V(); best.resting = false; }
      }
      hand.previousGrip = this.grip[h];
    }
  }

  _release(h) {
    const hand = this.hands[h];
    const c = hand.held;
    if (!c) return;
    c.heldBy = -1;
    c.velocity = add(hand.velocity, this.velocity);
    hand.held = null;
  }

  step(dt = 1 / 90) {
    const p = this.p;
    this._gripCubes();
    const g = V(0, -2 * p.gravity * dt * dt, 0);
    const colliding = [false, false];
    const first = [V(), V()];
    const finalPos = [V(), V()];
    const touchBoth = () => (colliding[0] || this.hands[0].wasTouching) && (colliding[1] || this.hands[1].wasTouching);
    const cur = [this.rawHand(0), this.rawHand(1)];

    for (const h of [0, 1]) {
      const hand = this.hands[h];
      const travel = add(sub(cur[h], hand.last), g);
      const r = iterativeSphereCast(this.boxes, hand.last, p.minimumRaycastDistance, travel, p.defaultPrecision, true, p.defaultSlideFactor);
      if (r.hit) {
        // Stick: while touching, the stuck point is the zero point for this hand.
        first[h] = hand.wasTouching ? sub(hand.last, cur[h]) : sub(r.final, cur[h]);
        this.velocity = V();
        colliding[h] = true;
      }
    }

    let movement = touchBoth() ? mul(add(first[0], first[1]), 0.5) : add(first[0], first[1]);

    // Head check, then a body-hull check: the Unity rigidbody would stop these.
    const head = this.head();
    const headTarget = add(this.lastHead, add(sub(head, this.lastHead), movement));
    const hr = iterativeSphereCast(this.boxes, this.lastHead, p.headRadius, sub(headTarget, this.lastHead), p.defaultPrecision, false, p.defaultSlideFactor);
    if (hr.hit) movement = sub(hr.final, this.lastHead);
    if (len(movement) > 0) {
      const hull = this.hull();
      const hit = sweepBoxes(hull.center, movement, hull.half, this.boxes);
      if (hit) movement = mul(movement, Math.max(0, hit.t - 1e-4));
      this.position = add(this.position, movement);
    }
    this.lastHead = this.head();

    // Final hand positions.
    const next = [this.rawHand(0), this.rawHand(1)];
    for (const h of [0, 1]) {
      const hand = this.hands[h];
      const single = !touchBoth();
      const r = iterativeSphereCast(this.boxes, hand.last, p.minimumRaycastDistance, sub(next[h], hand.last), p.defaultPrecision, single, p.defaultSlideFactor);
      const before = copy(hand.last);
      if (r.hit) { hand.last = r.final; colliding[h] = true; } else hand.last = next[h];
      hand.velocity = mul(sub(hand.last, before), 1 / dt);
    }

    // StoreVelocities
    const n = p.velocityHistorySize;
    this.historyIndex = (this.historyIndex + 1) % n;
    const oldest = this.history[this.historyIndex];
    const current = mul(sub(this.position, this.lastPosition), 1 / dt);
    this.denormalizedVelocityAverage = add(this.denormalizedVelocityAverage, mul(sub(current, oldest), 1 / n));
    this.history[this.historyIndex] = current;
    this.lastPosition = copy(this.position);

    const touching = colliding[0] || colliding[1];
    if (touching) {
      this.stats.touchSeconds += dt;
      const avg = this.denormalizedVelocityAverage;
      if (len(avg) > p.velocityLimit) {
        // Carried mass shares the launch momentum with the player.
        const share = p.bodyMass / (p.bodyMass + this.heldMass());
        if (len(avg) * p.jumpMultiplier * share > p.maxJumpSpeed) this.velocity = mul(norm(avg), p.maxJumpSpeed);
        else this.velocity = mul(avg, p.jumpMultiplier * share);
        this.stats.launches++;
      }
    }

    // Unstick
    for (const h of [0, 1]) {
      const hand = this.hands[h];
      if (colliding[h] && len(sub(next[h], hand.last)) > p.unStickDistance) {
        const head2 = this.head();
        const toHand = sub(next[h], head2);
        const blocked = sweepBoxes(head2, mul(norm(toHand), Math.max(0, len(toHand) - p.minimumRaycastDistance)), V(p.minimumRaycastDistance, p.minimumRaycastDistance, p.minimumRaycastDistance), this.boxes);
        if (!blocked) { hand.last = next[h]; colliding[h] = false; }
      }
    }
    for (const h of [0, 1]) { this.hands[h].wasTouching = colliding[h]; this.hands[h].colliding = colliding[h]; }

    this._rigidbody(dt, touching);
    this._cubes(dt);
    this.time += dt;
    return this;
  }

  /** Gravity + hull collision. Not part of Player.cs: Unity's Rigidbody does this there. */
  _rigidbody(dt, touching) {
    const p = this.p;
    this.velocity.y -= p.gravity * dt;
    let remaining = mul(this.velocity, dt);
    this.grounded = false;
    for (let i = 0; i < 3 && len(remaining) > 1e-9; i++) {
      const hull = this.hull();
      const hit = sweepBoxes(hull.center, remaining, hull.half, this.boxes);
      if (!hit) { this.position = add(this.position, remaining); remaining = V(); break; }
      const adv = Math.max(0, hit.t - 1e-4);
      this.position = add(this.position, mul(remaining, adv));
      remaining = mul(remaining, 1 - adv);
      const into = dot(remaining, hit.normal);
      if (into < 0) remaining = sub(remaining, mul(hit.normal, into));
      const vInto = dot(this.velocity, hit.normal);
      if (vInto < 0) this.velocity = sub(this.velocity, mul(hit.normal, vInto));
      if (hit.normal.y > 0.5) this.grounded = true;
    }
    // Resting contact probe so `grounded` is stable while standing.
    if (!this.grounded) {
      const hull = this.hull();
      if (sweepBoxes(hull.center, V(0, -0.01, 0), hull.half, this.boxes)) this.grounded = true;
    }
    if (this.grounded && !touching) {
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      const drop = Math.min(speed, p.groundFriction * dt);
      if (speed > 1e-9) { this.velocity.x -= this.velocity.x / speed * drop; this.velocity.z -= this.velocity.z / speed * drop; }
    }
  }

  _cubes(dt) {
    for (const c of this.cubes) {
      if (c.heldBy >= 0) {
        // Follow the hand, but never into geometry: the cube is blocked and pushed out.
        const want = this.hands[c.heldBy].last;
        const move = sub(want, c.position);
        const hit = sweepBoxes(c.position, move, c.half, this.boxes);
        c.position = hit ? add(c.position, mul(move, Math.max(0, hit.t - 1e-4))) : copy(want);
        this._depenetrate(c);
        c.velocity = V();
        continue;
      }
      c.velocity.y -= this.p.gravity * dt;
      let remaining = mul(c.velocity, dt);
      let ground = false;
      for (let i = 0; i < 3 && len(remaining) > 1e-9; i++) {
        const hit = sweepBoxes(c.position, remaining, c.half, this.boxes);
        if (!hit) { c.position = add(c.position, remaining); remaining = V(); break; }
        const adv = Math.max(0, hit.t - 1e-4);
        c.position = add(c.position, mul(remaining, adv));
        remaining = mul(remaining, 1 - adv);
        const into = dot(remaining, hit.normal);
        if (into < 0) remaining = sub(remaining, mul(hit.normal, into));
        const vi = dot(c.velocity, hit.normal);
        if (vi < 0) c.velocity = sub(c.velocity, mul(hit.normal, vi));
        if (hit.normal.y > 0.5) ground = true;
      }
      this._depenetrate(c);
      if (ground) { c.velocity.x *= Math.max(0, 1 - 8 * dt); c.velocity.z *= Math.max(0, 1 - 8 * dt); }
      c.resting = ground && len(c.velocity) < 0.05;
    }
  }

  /** Push a cube out of any box it overlaps, along the shallowest axis. */
  _depenetrate(c) {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const b of this.boxes) {
        let depth = Infinity, axis = null, sign = 1;
        let inside = true;
        for (const a of AX) {
          const d0 = c.position[a] + c.half[a] - (b.center[a] - b.half[a]);
          const d1 = b.center[a] + b.half[a] - (c.position[a] - c.half[a]);
          if (d0 <= 1e-6 || d1 <= 1e-6) { inside = false; break; }
          if (d0 < depth) { depth = d0; axis = a; sign = -1; }
          if (d1 < depth) { depth = d1; axis = a; sign = 1; }
        }
        if (inside && axis) { c.position[axis] += sign * (depth + 1e-4); moved = true; }
      }
      if (!moved) break;
    }
  }

  /** Move the whole player (and its stuck-hand bookkeeping) by a horizontal offset, e.g. a randomised spawn. */
  shift(dx, dz) {
    this.position = add(this.position, V(dx, 0, dz));
    this.lastPosition = copy(this.position);
    this.lastHead = this.head();
    for (const h of [0, 1]) { this.hands[h].last = this.rawHand(h); this.hands[h].previous = copy(this.hands[h].last); }
  }

  isHandTouching(h) { return this.hands[h].wasTouching; }
}
