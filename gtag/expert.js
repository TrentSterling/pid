/*
 * A scripted climber/runner. It only reads the observation vector and writes the
 * 8-number action, the same interface a human adapter or a learned policy would use.
 * It keeps its own small state (gait phase, command points) and labels what it is doing,
 * so a failed attempt can be diagnosed ("waiting for plant", "pulling", "pushing up").
 */
import { OBSERVATION_SCHEMA } from './env.js';

const I = Object.fromEntries(OBSERVATION_SCHEMA.map((k, i) => [k, i]));
const ARM = 1.5;
const JUMP = { down: 0.35, back: 0.1, speed: 6 };
const GROUND = -1.0;      // standing ground, head-relative (hull bottom is 1.0 below the head)
const PLANT = GROUND - 0.06;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const toward = (cur, target, step) => Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step;

export class ScriptedExpert {
  constructor(options = {}) {
    this.dt = options.dt ?? 1 / 90;
    this.reset();
  }

  reset() {
    this.cmd = [{ x: -0.25, y: -0.5, z: -0.45 }, { x: 0.25, y: -0.5, z: -0.45 }];
    this.grip = [false, false];
    this.hand = 0;            // active hand in the gait
    this.phase = 'reach';
    this.label = 'ready';
    this.pushPhase = 'plant';
    this.jumpPhase = 'approach';
    this.jumpTimer = 0;
    this.holdTimer = 0;
    this.engaged = false;
    this.walkClear = 4;
  }

  _move(h, tx, ty, tz, speed) {
    const c = this.cmd[h], s = speed * this.dt;
    c.x = toward(c.x, tx, s); c.y = toward(c.y, ty, s); c.z = toward(c.z, tz, s);
  }
  _at(h, tx, ty, tz, tol = 0.06) {
    const c = this.cmd[h];
    return Math.abs(c.x - tx) < tol && Math.abs(c.y - ty) < tol && Math.abs(c.z - tz) < tol;
  }

  act(o) {
    const aheadDist = o[I['ahead.dist']], aheadTop = o[I['ahead.top']];
    const touching = [o[I.leftTouching] > 0.5, o[I.rightTouching] > 0.5];
    const holding = [o[I.leftHolding] > 0.5, o[I.rightHolding] > 0.5];
    const cubeDist = Math.hypot(o[I['cube.x']], o[I['cube.y']], o[I['cube.z']]);
    const haveCube = cubeDist > 1e-6;
    const gapDist = o[I['gap.dist']];
    const goalFar = Math.hypot(o[I['goal.x']], o[I['goal.z']]);
    const tall = aheadTop > GROUND + 0.1;
    // Hysteresis: start a climb only once the body is against the obstacle, keep it until the obstacle is gone.
    if (this.engaged && !(aheadDist < 1.2 && tall)) { this.engaged = false; this.pushPhase = 'plant'; this.climbPhase = 'reach'; }
    if (!this.engaged && aheadDist < 0.3 && tall) this.engaged = true;
    const obstacle = this.engaged;
    this.walkClear = tall ? aheadDist : 4;
    const needsCube = haveCube && !(holding[0] && holding[1]);

    const atGoal = goalFar < 1.6 && !obstacle && !(this.cubesLeft && needsCube);
    if (atGoal && !needsCube) this._idle(o, holding);
    else if (needsCube) this._cubes(o, holding);
    else if (obstacle && aheadTop > -0.3) this._wallClimb();
    else if (obstacle) this._pushUp(o, aheadDist, aheadTop);
    else if (gapDist < 2.6 && o[I.grounded] > 0.5 && goalFar > 3 && Math.abs(o[I['goal.y']] - (-1.0)) < 0.5 && this.jumpPhase !== 'done') this._jump(o, gapDist);
    else this._walk(o, touching, holding);

    const out = [];
    for (const h of [0, 1]) {
      const c = this.cmd[h];
      const len = Math.hypot(c.x, c.y, c.z), k = len > ARM ? ARM / len : 1;
      out.push(c.x * k / ARM, c.y * k / ARM, c.z * k / ARM, this.grip[h] ? 1 : -1);
    }
    return out;
  }

  // Stand still: hands held clear of every surface, grips released over the pad.
  _idle(o, holding) {
    this.label = 'idle: at goal';
    this.grip = [false, false];
    for (const h of [0, 1]) this._move(h, h ? 0.25 : -0.25, GROUND + 0.5, -0.3, 3);
    this.phase = 'reach';
  }

  // Slap and slide: reach forward over the floor, plant, pull back, swap hands.
  _walk(o, touching, holding) {
    const h = this.hand, side = h ? 0.25 : -0.25, other = 1 - h;
    const hold = holding[0] || holding[1];
    // Plant short of any tall obstacle ahead so the hand lands on the floor, not the wall.
    const reachZ = -clamp(this.walkClear + 0.15, 0.3, 0.78);
    // A held cube stays gripped while walking.
    this.grip = [holding[0] || this.grip[0] && hold, holding[1] || this.grip[1] && hold];
    this.label = `walk: ${h ? 'right' : 'left'} hand ${this.phase}`;
    if (this.phase === 'reach') {
      this._move(h, side, GROUND + 0.45, reachZ, 5);
      if (this._at(h, side, GROUND + 0.45, reachZ)) this.phase = 'plant';
    } else if (this.phase === 'plant') {
      this._move(h, side, PLANT - 0.12, reachZ, 4);
      if (touching[h]) { this.phase = 'pull'; }
    } else {
      this._move(h, side, PLANT - 0.12, 0.05, 2.4);
      if (this.cmd[h].z >= 0.04) { this.phase = 'reach'; this.hand = other; }
    }
    // The resting hand tracks just above the floor ahead of the body.
    this._move(other, other ? 0.25 : -0.25, GROUND + 0.45, -0.5, 3);
  }

  // Both hands on the top surface of a ledge, then push down.
  _pushUp(o, dist, top) {
    this.grip = [false, false];
    const z = -(dist + 0.2 + 0.3), y = top + 0.07;
    this.label = `push-up: ${this.pushPhase}`;
    if (this.pushPhase === 'plant') {
      this._move(0, -0.25, y, z, 5); this._move(1, 0.25, y, z, 5);
      if (this._at(0, -0.25, y, z, 0.08) && this._at(1, 0.25, y, z, 0.08)) this.pushPhase = 'press';
    } else {
      this._move(0, -0.25, y - 0.9, z, 1.4); this._move(1, 0.25, y - 0.9, z, 1.4);
      if (o[I.leftTouching] < 0.5 && o[I.rightTouching] < 0.5) this.pushPhase = 'plant';
    }
  }

  // Wall climbing is not scripted yet. A stuck hand sticks where it touched, so a reliable routine
  // has to reach up in the air, press in by a controlled amount and swap hands. Two attempts
  // drifted away from the wall (pressing deeper each frame pushes the player back, one frame at a time).
  _wallClimb() {
    this.grip = [false, false];
    this.label = 'wall climb: no scripted routine yet (climb by hand)';
    for (const h of [0, 1]) this._move(h, h ? 0.25 : -0.25, GROUND + 0.5, -0.3, 3);
  }

  // Cube pickup: reach the nearest hand to the cube and grip.
  _cubes(o, holding) {
    const cx = o[I['cube.x']], cy = o[I['cube.y']], cz = o[I['cube.z']];
    const h = holding[0] ? 1 : 0;
    this.label = `cube: ${h ? 'right' : 'left'} hand ${Math.hypot(cx, cy, cz) < ARM ? 'gripping' : 'approaching'}`;
    this.grip[1 - h] = holding[1 - h];
    if (Math.hypot(cx, cy, cz) > 1.3) {
      this.grip[h] = false;
      // Walk toward the cube with the gait.
      this._walk(o, [o[I.leftTouching] > 0.5, o[I.rightTouching] > 0.5], holding);
      return;
    }
    this._move(h, cx, cy, cz, 3);
    this.grip[h] = Math.hypot(this.cmd[h].x - cx, this.cmd[h].y - cy, this.cmd[h].z - cz) < 0.12;
  }

  // Two-handed jump: plant ahead, press down and back, release.
  _jump(o, gap) {
    this.grip = [false, false];
    this.label = `jump: ${this.jumpPhase}`;
    const edge = gap;
    if (this.jumpPhase === 'approach') {
      if (edge > 1.1) { this._walkApproach(o); return; }
      this.jumpPhase = 'plant';
    }
    if (this.jumpPhase === 'plant') {
      for (const h of [0, 1]) this._move(h, h ? 0.25 : -0.25, PLANT, -0.55, 5);
      if (this._at(0, -0.25, PLANT, -0.55, 0.08) && this._at(1, 0.25, PLANT, -0.55, 0.08)) this.jumpPhase = 'press';
    } else if (this.jumpPhase === 'press') {
      for (const h of [0, 1]) this._move(h, h ? 0.25 : -0.25, PLANT - JUMP.down, JUMP.back, JUMP.speed);
      if (this._at(0, -0.25, PLANT - JUMP.down, JUMP.back, 0.08)) { this.jumpPhase = 'fly'; this.jumpTimer = 0; }
    } else if (this.jumpPhase === 'fly') {
      for (const h of [0, 1]) this._move(h, h ? 0.25 : -0.25, GROUND + 0.5, -0.4, 6);
      this.jumpTimer += this.dt;
      if (o[I.grounded] > 0.5 && this.jumpTimer > 0.4) this.jumpPhase = 'done';
    }
  }
  _walkApproach(o) {
    this._walk(o, [o[I.leftTouching] > 0.5, o[I.rightTouching] > 0.5], [false, false]);
  }
}
