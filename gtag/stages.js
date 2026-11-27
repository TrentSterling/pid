/*
 * Course stages for the Gorilla locomotion demo. Everything is an axis-aligned box.
 * Forward is -Z. Floor tops are at y = 0. A stage lists static boxes, carryable cubes,
 * a goal, and what "complete" means, so the same stage can be driven by a human, the
 * scripted expert, or a future policy.
 */
import { vec } from './gorilla.js';

const box = (id, x, y, z, w, h, d, color = '#2a3a50', tag = '') =>
  ({ id, center: vec(x, y, z), half: vec(w / 2, h / 2, d / 2), color, tag });
const top = (id, x, topY, z, w, h, d, color, tag) => box(id, x, topY - h / 2, z, w, h, d, color, tag);

export const STAGES = Object.freeze([
  {
    id: 'slap',
    name: '1. Slap and slide',
    lesson: 'Plant a hand on the floor and pull it back. The player moves the opposite way. Alternate hands.',
    spawn: vec(0, 0, 0),
    timeLimit: 40,
    boxes: [top('floor', 0, 0, -20, 12, 1, 60, '#26364d'), top('pad', 0, 0.02, -12, 3, 0.04, 3, '#34d399', 'goal')],
    goal: { center: vec(0, 0, -12), radius: 1.2, requireCubes: false },
    cubes: [],
  },
  {
    id: 'steps',
    name: '2. Push-up steps',
    lesson: 'Plant both hands on a ledge top and push down. The hands stay put, so you rise.',
    spawn: vec(0, 0, 0),
    timeLimit: 60,
    boxes: [
      top('floor', 0, 0, -12, 12, 1, 40, '#26364d'),
      top('step1', 0, 0.4, -4.3, 4, 0.4, 2, '#2e4659'),
      top('step2', 0, 0.8, -6.3, 4, 0.8, 2, '#33506a'),
      top('step3', 0, 1.2, -8.3, 4, 1.2, 2, '#38587a', 'goal'),
    ],
    goal: { center: vec(0, 1.2, -8.3), radius: 0.9, requireCubes: false },
    cubes: [],
  },
  {
    id: 'wall',
    expert: false, // no scripted routine yet; climb it by hand
    name: '3. Wall climb',
    lesson: 'Hands stick to any surface. Plant one on the wall and pull down to climb, then swap hands.',
    spawn: vec(0, 0, 0),
    timeLimit: 70,
    boxes: [
      top('floor', 0, 0, -8, 12, 1, 28, '#26364d'),
      top('wall', 0, 1.6, -5, 6, 1.6, 0.6, '#35445c'),
      top('ledge', 0, 1.6, -8, 6, 1.6, 6, '#3b516d', 'goal'),
    ],
    goal: { center: vec(0, 1.6, -7.2), radius: 1.0, requireCubes: false },
    cubes: [],
  },
  {
    id: 'carry',
    name: '4. Carry run',
    lesson: 'Grip two cubes, run with them, and set them on the pad. Carried mass shares your launch momentum.',
    spawn: vec(0, 0, 0),
    timeLimit: 90,
    boxes: [
      top('floor', 0, 0, -12, 12, 1, 36, '#26364d'),
      top('pad', 0, 0.02, -10, 3, 0.04, 3, '#34d399', 'goal'),
    ],
    goal: { center: vec(0, 0, -10), radius: 1.5, requireCubes: true },
    cubes: [
      { id: 'cube-a', position: vec(-0.3, 0.15, -1.6), size: 0.3, mass: 5 },
      { id: 'cube-b', position: vec(0.3, 0.15, -1.6), size: 0.3, mass: 8 },
    ],
  },
  {
    id: 'gap',
    name: '5. Gap hop',
    lesson: 'Release at speed. Your last few frames of motion become your launch. Cross the gap.',
    spawn: vec(0, 0, 0),
    timeLimit: 60,
    boxes: [
      top('start', 0, 0, -3, 8, 1, 14, '#26364d'),
      top('far', 0, 0, -18.4, 8, 1, 14, '#2b4a60', 'goal'),
    ],
    goal: { center: vec(0, 0, -14.5), radius: 1.2, requireCubes: false },
    cubes: [],
  },
]);

export function stageById(id) {
  const s = STAGES.find(x => x.id === id);
  if (!s) throw new Error(`Unknown stage: ${id}`);
  return s;
}

/** Rig origin that rests the body hull on a surface at height `surfaceY`. */
export const REST_OFFSET = -0.65;
