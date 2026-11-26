# Unity implementation notes

The full lesson is [the VR tutorial](../tutorial/tutorial.md). This folder contains the Unity-specific teaching kit. The browser companion is a different physics engine and is not a Unity/PhysX simulator.

## Import and generate

1. Create a Unity 6 project (Unity 6.3 LTS is a suitable baseline). Use Universal 3D or the Built-in renderer. Import Input System, XR Plug-in Management and OpenXR through Package Manager, and enable the Input System in Active Input Handling.
2. Copy `unity/Assets/TrontPhysicsGym` into the project's `Assets` folder. Keep the `Editor` subfolder in place. These scripts use Unity 6 `Rigidbody.linearVelocity`, `linearDamping` and `angularDamping` APIs.
3. Choose **Tools → Tront Physics Gym → Create Teaching Scene**. The builder creates a scene, materials and a serialized `GymControls.inputactions` asset under `Assets/TrontPhysicsGym/Generated`. Re-running it creates unique assets instead of overwriting an edited scene.
4. The builder reserves three available user layers named `GymWorld`, `GymProps` and `GymPlayer`, and sets the project's fixed timestep to **1/90 second**. It asks Unity to save any unsaved scene first. It does not install packages, select OpenXR providers, change platform/build profiles, or configure Android signing.
5. In XR Plug-in Management, select OpenXR for your platform. Enable **Oculus Touch Controller Profile** for the included controller bindings. Run OpenXR Project Validation, add the generated scene to the build profile and configure the headset build as the tutorial describes. Other controller families need their own supported profile bindings in the generated input asset.
6. Choose **Tools → Tront Physics Gym → Run Math Checks**, then enter Play Mode. Desktop controls work without an XR runtime. The headset path requests Floor tracking origin; if the runtime only supports Device origin, set `GymRigInput.deviceOriginHeightOffset` to the required eye-height offset. Do not add another Tracked Pose Driver to this camera: the kit already writes the pose.

**Validation boundary:** These sources were reviewed against Unity's documented API and the backward-PD scalar integration was checked independently. A Unity Editor/runtime and a headset were not available in the authoring environment. The Editor math checks are supplied for running inside actual Unity; they have not been represented as already executed. Build compilation, PhysX joint behavior, device input, comfort and on-device performance still require the acceptance pass in the tutorial.

## Controls

| Action | Desktop | Quest / Touch controllers |
| --- | --- | --- |
| Move | WASD, bounded walking acceleration | Plant hands against static surfaces; grip fixed rungs |
| Look | Hold right mouse and move | Head tracking |
| Grab | Hold Q / E for left / right hand | Hold grip |
| Choose virtual hand to edit | 1 left, 2 right, 3 both | Move that controller |
| Move selected virtual hands | I/K forward/back, J/L left/right, U/O up/down | Move that controller |
| Restore desktop hand positions | H | — |
| Cycle controller while holding | C or GUI button | A, right primary button |
| Toggle acceleration feedforward | F or GUI | X, left primary button |
| Toggle custom equal/opposite reactions | B or GUI | Inspector/desktop setting |
| FireBlast angular/mass preset | P or GUI | Inspector/desktop setting |
| Toggle locomotion motor | M or GUI | Inspector/desktop setting |
| Reset lab | R or GUI | Y, left secondary button |

The virtual hands start in front of the camera. Walk a small distance toward a cube or extend the selected hand using I before holding Q/E. After pickup, keep the grip held while pressing C. Move U/O and I/K to load and unload the joint against the table. Two hands may hold different objects; this starter deliberately allows one owner per object.

## Script responsibilities

| File | Responsibility |
| --- | --- |
| `Runtime/GymRigInput.cs` | Serialized Input System actions; raw local tracked poses; desktop controls; local velocity estimates; late HMD visual pose; Floor origin request and origin-change notification. |
| `Runtime/GymMotor.cs` | Finite-force planted-hand locomotion at the fixed timestep. Casts only against `GymWorld`; excludes a hand while it holds an object. Maintains a capsule around the local head offset. |
| `Runtime/GymGrabbable.cs` | Single-hand ownership, Rigidbody and reset pose. Kinematic marked props act as fixed climbing grips. |
| `Runtime/GymHand.cs` | Nearest eligible pickup; grab anchor and orientation offset; native/custom controller switching; forces and torques; release and collision filtering. |
| `Runtime/GymControllerMath.cs` | Frequency/damping gains, implicit backward update, reduced mass, shortest quaternion error, principal-axis torque and native target rotation helper. |
| `Runtime/GymLabControls.cs` | Runtime comparison settings, XR/desktop controls, world-space status board and reset. |
| `Editor/GymSceneBuilder.cs` | Generates the complete teaching scene and input asset. |
| `Editor/GymMathChecks.cs` | Actual Unity math/API checks for signs, units, scalar integration, quaternion/inertia frames, target offsets and reduced mass. |

## Three force paths

**ConfigurableJoint:** The held object's Rigidbody owns the joint, and its `connectedBody` is the dynamic player. `anchor` is the chosen grab point in object-local metres; `connectedAnchor` is the tracked target in player-local metres. The builder keeps Rigidbody root scale equal to one. Both linear anchors are driven to coincide, so `targetPosition` is zero. All six motions are free and the appropriate drives are enabled. Local target rotation uses the inverse orientation offset from the joint's captured initial relative rotation, converted through the joint basis. `Transform.parent` is not used as a substitute for the connected body.

PhysX supplies both native reactions. **No extra player force is added on this path.** When changing modes, every native drive is zeroed before the deferred `Destroy`, preventing an old joint from applying forces during the custom-controller step.

**Relative PD:** Position and relative point-velocity errors produce an acceleration, using `kp = (2πf)²` and `kd = 2ζ(2πf)`. Target velocity includes the player's velocity at the target plus the tracked hand's local velocity transformed into world space. The driven anchor velocity comes from `Rigidbody.GetPointVelocity`, including rotational motion. The force is applied to the object at its grab point and, if reaction mode is enabled, its opposite is applied to the player's hand target.

**Backward PD:** Uses `g = 1/(1 + kd·dt + kp·dt²)` and `a = g[kp·positionError + (kd + kp·dt)·velocityError] + feedforward`. This is the implicit linear/semi-implicit-Euler controller used here. It is not the explicit lookahead approximation called SPD V2 in Digital Opus Part II. Its linear unconstrained stability result does not automatically extend to saturation, pose discontinuities, nonlinear rotations and collision constraints.

The optional translation acceleration feedforward uses **tracked local hand acceleration**, filtered and limited to 35 m/s². It excludes player acceleration so the player's reaction acceleration is not recursively fed back into the driver. Target position is left unfiltered; velocity is estimated and smoothed at 20 Hz cutoff, and acceleration at 12 Hz. It is an approximation sampled from render-updated input, not a device-certified motion estimator. Controller/preset changes reset acceleration history; loss of tracking releases the hand; tracking-origin events reset derivatives and release grips. Angular acceleration feedforward is not implemented.

The translation force uses the pair's scalar reduced mass when reactions are active, treating kinematic bodies as zero inverse mass. It omits the rotational contribution to effective mass at an off-center point. Custom torque transforms angular acceleration through `body.rotation * body.inertiaTensorRotation`, multiplies each principal inertia component, then transforms back. The player's rotation is frozen in this teaching rig; this is not a general inverse-inertia solve for two freely rotating bodies. Fast spinning asymmetric objects can require gyroscopic treatment beyond this model.

## Comparison boundaries

- Native CJ target velocity and angular target velocity are zero. Changing the connected anchor moves the spring target, but the native drive is not supplied the custom controller's tracked-hand velocity feedforward. This is a deliberate simple baseline, not an assertion of identical equations or feel.
- CJ maximum force is a per-drive limit; the custom path caps the translation force vector's magnitude. Native angular tuning uses average object inertia; the custom torque uses all principal inertia components.
- The reduced-mass model and angular linearization are teaching approximations. Solver iterations, contact friction, masses, anchor offsets and force caps remain part of the result.
- The physical hand spheres are visuals. They are not additional proxy-hand Rigidbodies. Empty-hand surface contact is handled by the motor's casts; grabbed-object contact is handled by the object's Rigidbody. A proxy-hand architecture adds another body/joint and another frequency/mass ratio to tune.
- Native CJ always reacts on the player. The reaction toggle affects only the custom modes. Disabling custom reactions means a fixed grip cannot pull the player.

## Locomotion is an explicit adaptation

The original `Another-Axiom/GorillaLocomotion` source is preserved at the repository's `upstream/GorillaLocomotion`, pinned to commit `bc42e959cf3e69178f9147d89bd3ffeab1c432c4`, with its MIT license. It uses its own Update-time iterative collision routine, direct root displacement, velocity clearing on contact and a velocity-history launch mechanism.

This kit uses a smaller fixed-step spherecast/plant/release motor. When hands are planted, a bounded acceleration servo tries to keep the contact points stationary while tracked hands move. It adds forces to the Rigidbody and preserves its solved velocity when released. It never copies the original's unconditional contact velocity reset. Its locomotion force can still oppose an external force; preserving a physical force path does not mean the motor cannot resist disturbances. The motor does not reproduce upstream sliding, jump multiplier, head sweep or every collision edge case. Its moving capsule is a compact room-scale teaching approximation, not a complete head-penetration/comfort solution.

## Defaults and the FireBlast preset

Teaching defaults: player 75 kg, props 1 kg, fixed 90 Hz, 6 Hz controller frequency, damping ratio 1, 1600 N translation cap, 30 N·m angular cap, acceleration FF off, custom reactions on, projection off. The 1600 N cap permits a single fixed grip to support a 75 kg body. Increasing it also increases contact impulses; tune in the arena.

The optional preset sets player mass to 1 kg, native angular spring 1800, angular damper 120, angular maximum force 12000, object mass scale 1, connected mass scale 8, projection PositionAndRotation, distance 0.02 m and angle 5°. Props already weigh 1 kg. FireBlast did not provide linear-drive settings, anchor frames, full rig, collision matrix, timestep or solver settings, so the linear drive remains the teaching implementation and **this is not a full reproduction**. Connected mass scale multiplies inverse mass/inertia for the joint solve; it does not make the connected body weigh eight times more. Projection does not turn the free spring axes into hard 0.02 m limits.

## Acceptance checks in Unity

Run the supplied menu math checks, then test: pick up without orientation snap; rotate the starting player and cube and repeat; swap all three modes while holding the same body; push a cube against the table; observe reactions with locomotion disabled; grip a fixed rung; turn custom reactions off and confirm the rung no longer lifts the player; vary damping at a fixed frequency; run a rapid reversal with FF off/on; release while moving; repeat at 72/90/120 Hz; lose/recover tracking and recenter. Confirm the actual device's tracking-origin height and action bindings. Profile CPU physics and GPU frame time on the headset.

Release restores the previous held-object/player collision filters immediately. If a user releases an object already intersecting their capsule, depenetration may impart an impulse. A production implementation should defer that collision restoration until separation and track shared ignore-pair ownership. The starter's single-owner rule simplifies other grab-state cleanup but does not replace that production refinement.

## Primary references

- [Digital Opus — Controlling Objects With Forces and Torques I](https://digitalopus.ca/site/pd-controllers/) and [Part II](https://digitalopus.ca/site/controlling-objects-with-forces-and-torques-part-2/): primary technical inspiration.
- [Official GorillaLocomotion source](https://github.com/Another-Axiom/GorillaLocomotion/tree/bc42e959cf3e69178f9147d89bd3ffeab1c432c4).
- [Unity OpenXR input, including serialized assets and profile bindings](https://docs.unity3d.com/Packages/com.unity.xr.openxr@1.14/manual/input.html).
- [Oculus Touch Controller Profile](https://docs.unity3d.com/Packages/com.unity.xr.openxr@1.14/manual/features/oculustouchcontrollerprofile.html).
- [Unity Rigidbody.linearVelocity](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Rigidbody-linearVelocity.html).
- [Unity joint connectedMassScale](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Joint-connectedMassScale.html).
- [Unity tracking-origin updates](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/XR.XRInputSubsystem-trackingOriginUpdated.html).

Created by Trent Sterling and ChatGPT, with the discussion and experiments of Ducky (Duck / SCUG) and FireBlast. Digital Opus receives the primary technical credit; additional foundations include David Wu and the Stable Proportional-Derivative Controllers work by Jie Tan, Karen Liu and Greg Turk.
