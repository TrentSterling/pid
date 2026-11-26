# VR grabbing lab: locomotion, physical props, live controller A/B

Build a small Unity VR playground, pick up a real Rigidbody, and switch its controller **while the object is still in your hand**. Compare a native ConfigurableJoint, relative-velocity PD, and backward PD. Press the same cube against the same wall, rotate it, release it, and decide which feels better in a headset.

That is the useful experiment behind FireBlast’s setup: responsive hand locomotion and physical grabbed objects can coexist. A graph helps explain a problem; the in-headset A/B decides whether the solution feels good.

**Start here:** [Unity starter kit](../downloads/TrontPhysicsGym-Unity.zip) · [WebXR companion](../vr/) · [Physics Gym comparison](../) · [Source repository](https://github.com/TrentSterling/pid)

This is a teaching implementation for **Unity 6 with OpenXR**, including the Unity 6.3 workflow. The C# kit has not been executed in Unity or tested on a headset during its creation. Run the checks below before treating it as a foundation for a shipped game. The browser companion is an independently implemented experiment, not a Unity or PhysX emulator.

## 1. From an empty project to the teaching scene

### Install the project dependencies

1. Create a Unity 6 **3D Built-In** or **Universal 3D** project. Use a blank scene. Install Android Build Support, including its SDK/NDK and OpenJDK modules, through Unity Hub if you intend to build for Quest.
2. Open Package Manager and install **Input System**, **XR Plug-in Management**, and **OpenXR Plugin**, using versions compatible with your editor. Keep `Packages/manifest.json` and `packages-lock.json` in your repository so your friends get the same dependency versions.
3. In **Project Settings → Player → Active Input Handling**, enable the Input System and restart if Unity requests it.
4. Under **Project Settings → XR Plug-in Management**, enable **OpenXR** for the platform you are testing. Desktop and Android have separate settings. Merely installing the package does not enable the provider.
5. In OpenXR settings, add **Oculus Touch Controller Profile** for the kit’s supplied controller bindings. Run **Project Validation** and resolve the required issues for the active platform. For other controllers, add their interaction profile and corresponding bindings to the action asset.

These steps follow Unity’s [OpenXR project configuration](https://docs.unity3d.com/Packages/com.unity.xr.openxr@1.14/manual/project-configuration.html). The linked package documentation explains the workflow; it is not a claim that version 1.14 is the latest version you should install.

### Import and generate

Copy the kit’s `Assets/TrontPhysicsGym` folder into your project’s `Assets` folder, wait for compilation, then select:

**Tools → Tront Physics Gym → Create Teaching Scene**

The builder creates the playground, player, tracked references, hands, grabbable props, and serialized Input Actions. It also assigns the component references and saves `Assets/TrontPhysicsGym/Generated/PhysicsGym.unity` (with a unique filename if generated again). Put that scene in your active Build Profile’s scene list. Run **Tools → Tront Physics Gym → Run Math Checks** and inspect the Console before entering Play Mode. Those checks exercise controller math; they do not test an XR runtime or physical contacts.

The kit owns its camera and tracking transforms. Start with the generated rig; adding another tracked-pose driver or a second locomotion system to the same transforms creates competing writers. XR Interaction Toolkit is not needed for this implementation. If you later integrate it, choose which system owns grabbing, camera poses, and locomotion.

The generated actions use `<XRHMD>/centerEyePosition` and `centerEyeRotation`, plus the left/right `<OculusTouchController>` layouts for poses, tracking validity, grip, and buttons. These are Input System actions, not legacy `Input.GetAxis` controls. Unity documents the [OpenXR input workflow](https://docs.unity3d.com/Packages/com.unity.xr.openxr@1.14/manual/input.html) and the [Touch control names](https://docs.unity3d.com/Packages/com.unity.xr.openxr@1.14/manual/features/oculustouchcontrollerprofile.html).

`GymRigInput` requests a **Floor** tracking origin. Leave `deviceOriginHeightOffset` at zero when floor-relative poses are available. If your runtime supplies a Device origin instead, configure the corresponding height offset; adding eye height to an already floor-relative pose raises the whole rig twice. Verify the virtual floor and real controller height before testing locomotion. [Unity: tracking origin modes](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/XR.TrackingOriginModeFlags.html).

### First run

Run the desktop controls first. Use WASD to approach a cube, select the right virtual hand with **2**, and move it close with **I/K**, **J/L**, and **U/O**. Press and hold **E** once the hand is within reach; release and press again if you missed. Keep holding E and press **C** to switch controllers. Release E to drop the cube. Check that the body falls onto the floor and both hands work before running the OpenXR headset version.

| Action | Unity desktop | Unity headset |
| --- | --- | --- |
| Move / look | WASD / hold right mouse button | Move and push with tracked hands; no stick locomotion in this teaching rig. |
| Hold left / right object | Hold Q / E | Hold the corresponding grip. |
| Choose hand to reposition | 1 left, 2 right, 3 both | Move the real controller. |
| Reposition virtual hand | I/K forward/back; J/L sideways; U/O up/down | Tracked pose. |
| Restore virtual hand positions | H | Not applicable. |
| Cycle controller while holding | C | A, right primary button. |
| Toggle acceleration feedforward | F | X, left primary button; custom modes only. |
| Toggle custom reaction forces | B or desktop UI | Set in Inspector before the headset test. Native CJ always reacts. |
| FireBlast angular/mass preset | P or desktop UI | Set in Inspector before the headset test. |
| Toggle locomotion motor | M or desktop UI | Set in Inspector before the headset test. |
| Reset scene | R | Y, left secondary button. |

The in-world status board identifies the active controller and feedforward state. For an initial headset check, leave the motor enabled, start with the teaching preset, and perform A/B switches with A while keeping grip held.

The teaching baseline is a **75 kg player**, **1 kg prop**, **6 Hz** frequency, **1** damping ratio, **1600 N** linear force cap, **30 N·m** torque cap, and **90 Hz** fixed physics step. Generated bodies use 12 solver iterations and 6 velocity iterations. These are our chosen starting values. They are not FireBlast’s complete settings. A 75 kg body weighs about 736 N under ordinary gravity, so a very small grip-force limit can prevent a held object from supporting the player regardless of gains.

## 2. Keep three different things separate

**Tracked pose:** where the real controller says the hand is. It is a reference, and can pass through virtual geometry.

**Physical object:** the dynamic Rigidbody that collides, has inertia, and can be blocked by a wall. A grab controller applies forces or constraints to bring it toward the reference.

**Player body:** the Rigidbody that receives the grab reaction and the locomotion motor’s contribution. The tracked hand’s desired world pose moves with this body’s reference frame.

Do not parent a held dynamic object to the tracked hand and also drive it with physics. That gives its pose two owners. Preserve the point and orientation at which the object was grabbed, then drive that attachment toward the hand. The user’s camera follows measured head tracking; it should not be a spring-driven prop. Keep the player, tracking space, and physics-body scales at `(1,1,1)`; use one Unity unit as one metre.

### Direct connection versus a proxy hand

| Arrangement | Force path | Consequence |
| --- | --- | --- |
| Object joint connected directly to dynamic player | Object ↔ player | Native joint solving reacts on both bodies; this is the kit’s CJ arrangement. |
| Object connected to a dynamic hand Rigidbody, hand connected to player | Object ↔ hand ↔ player | The hand has its own mass, contacts, and controller. Both connections need tuning. |
| Object connected to a kinematic hand Rigidbody | Object ↔ prescribed hand motion | The solver can push the object, but the kinematic hand does not accelerate from that reaction. A separate mechanism must transmit load to the player. |
| Custom forces on object only | Tracking target → object | Following works, but holding a cube against a wall does not automatically push the player. |

This explains why “use a hand proxy” is incomplete advice. **Is the proxy dynamic, and how is it connected to the body?** That determines the reaction path. Unity describes the behavior of [kinematic rigidbodies](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Rigidbody-isKinematic.html).

With custom control, the kit applies the grab force to the object and an opposite force to the player. With a native joint, PhysX supplies the reaction. Do not add the custom reaction on top of the native joint’s reaction.

## 3. What comes from GorillaLocomotion

The original source is included under `upstream/GorillaLocomotion`, pinned to commit `bc42e959cf3e69178f9147d89bd3ffeab1c432c4`, with its MIT license. Read [Another Axiom’s Player.cs](https://github.com/Another-Axiom/GorillaLocomotion/blob/bc42e959cf3e69178f9147d89bd3ffeab1c432c4/Player.cs) alongside the teaching motor.

In that source, `Update()` sweeps hand positions, computes player displacement from constrained hands, checks head movement, moves the player transform, and maintains a velocity history for launch behavior. It also explicitly zeroes Rigidbody velocity when a hand collides, then can assign a launch velocity. That is deliberate arcade movement code; it is not merely a pair of physical spring hands.

Dropping another force controller onto that player does not guarantee its impulses survive those velocity writes. Decide who owns the velocity at each phase of movement.

Our `GymMotor` is an **adaptation**, not an exact port of Gorilla Tag’s feel. It uses fixed-step hand-contact logic and a bounded acceleration motor toward planted-hand motion. It adds forces instead of routinely replacing the player’s entire velocity. Grab reactions therefore have a route into the body’s motion, although the active motor can still oppose them. The original launch history and collision behavior remain a useful source to study, not a claim of parity with this kit.

Do not attach the original `GorillaLocomotion.Player` to the generated teaching player at the same time. Experiment with one movement owner at a time, then explicitly design the handoff if you combine them.

## 4. Where the C# lives

The runtime files are in `Assets/TrontPhysicsGym/Runtime`; the builder and checks are in `Assets/TrontPhysicsGym/Editor`. [Browse the complete C# source](https://github.com/TrentSterling/pid/tree/main/unity/Assets/TrontPhysicsGym).

| File | Read it to understand |
| --- | --- |
| `GymRigInput.cs` | Input Actions, XR and desktop poses, tracking-space samples. |
| `GymMotor.cs` | Player body, contact locomotion, and reference-frame movement. |
| `GymHand.cs` | Grip acquisition/release, attachment data, runtime mode switching, joint or force application. |
| `GymGrabbable.cs` | Which bodies can be held and ownership of a grab. |
| `GymControllerMath.cs` | PD gains, backward gains, quaternion error, mass/inertia conversion. |
| `GymLabControls.cs` | Runtime controls, presets, and the experiment’s UI. |
| `Editor/GymSceneBuilder.cs` | Reproducible scene construction and Input Actions. |
| `Editor/GymMathChecks.cs` | Small numerical checks for the controller calculations. |

Begin with `GymHand`, then follow the math helpers. The important lifecycle is **acquire → capture attachment → drive → release**. Switching modes retains the current held object and attachment, tears down the previous drive, and starts the selected one. Two active controllers on one grab make the comparison meaningless.

## 5. The three controllers

### ConfigurableJoint: let the solver enforce a driven relationship

A ConfigurableJoint includes drives, limits, frames, collision interactions, and solver behavior. Its spring and damper drive is PD-like, but a whole joint is more than one `AddForce` formula. PhysX handles coupled constraints within its solver; see the [PhysX joint documentation](https://nvidia-omniverse.github.io/PhysX/physx/5.4.0/docs/Joints.html).

The kit puts the joint on the prop and connects it to the player. Its linear drives move the prop’s grab point toward an updated connected anchor, and its Slerp drive handles orientation. The native baseline uses `targetPosition = Vector3.zero` with a moving `connectedAnchor`; `targetVelocity` and `targetAngularVelocity` are both zero. Thus it does **not** supply the tracked anchor’s linear/angular motion as native velocity feedforward. Remember this when comparing its moving-target lag with the custom modes.

This A/B compares these implemented configurations. It cannot establish that every ConfigurableJoint is slower than every custom controller. The joint’s per-axis drive limits also differ from a custom controller’s total vector-force clamp.

### Relative PD: damp the error in motion

At the prop’s grab point, define:

```csharp
Vector3 error = desiredPoint - actualPoint;
Vector3 velocityError = desiredVelocity - actualPointVelocity;
Vector3 acceleration = kp * error + kd * velocityError;
```

Position error pulls toward the target; velocity error brakes motion that is wrong relative to that target. The actual point velocity must include rotation. `Rigidbody.GetPointVelocity(worldPoint)` does that; using only `linearVelocity` treats a spinning object’s handle as stationary relative to its center. [Unity: GetPointVelocity](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Rigidbody.GetPointVelocity.html).

The kit converts this desired relative acceleration into force using the pair’s reduced mass:

```csharp
float inverseMassSum = inverseObjectMass + inversePlayerMass;
float effectiveMass = 1f / inverseMassSum;
Vector3 force = effectiveMass * acceleration;
```

Then it limits the force and applies opposing forces. A kinematic body contributes zero inverse mass. Disabling custom reaction with B excludes the player from this mass calculation and applies force only to the prop. This scalar calculation is a useful translation approximation; it does not solve the full rotational effective mass at two off-center attachment points. It is therefore not an exact replacement for the joint solver.

For the custom modes, frequency and damping ratio set:

```csharp
float omega = 2f * Mathf.PI * frequencyHz;
float kp = omega * omega;
float kd = 2f * dampingRatio * omega;
```

Here `kp` has units of inverse seconds squared and `kd` inverse seconds. They produce acceleration before mass conversion. Do not paste them into a force-based joint drive without accounting for mass and that drive’s convention. Frequency means natural-frequency parameter in this kit; it is not a guaranteed reciprocal settling time.

### Backward PD: account for the discrete step

The backward mode uses the gain adjustment popularized by David Wu and explained by Digital Opus:

```csharp
float g = 1f / (1f + kd * dt + kp * dt * dt);
Vector3 acceleration = (kp * g) * error
                     + ((kd + kp * dt) * g) * velocityError;
```

This softens the effective gains according to the simulation interval. It makes the ideal linear tracking problem more tolerant of high gains and coarse steps. Force caps, delayed input, changing contacts, off-center torque, and a second motor create a different system; they do not inherit a blanket stability guarantee. [Digital Opus, Part I](https://digitalopus.ca/site/pd-controllers/).

Digital Opus’s Part II and the [Tan, Liu, and Turk SPD paper](https://www.jie-tan.net/project/spd.html) discuss related next-step methods. The names are not interchangeable. The kit’s `BackwardPD` mode implements the formula above; the Physics Gym’s other SPD experiments are separately labeled. Increasing a gain cannot make a finite force budget unlimited.

## 6. Feedforward, damping, and the One Euro question

Suppose the hand travels right at a steady speed. A damper written as `-kd * objectVelocity` pushes left even when the object is perfectly matching the hand. The spring needs a trailing position error to overcome that damping. Raising the damper can therefore make tracking feel soupy.

With `kd * (targetVelocity - objectVelocity)`, an object moving alongside its target has zero velocity error. Expanding the expression gives `+kd * targetVelocity - kd * objectVelocity`. That target term is what people often mean by **velocity feedforward** in this discussion. It is already present in relative-velocity PD; adding it again would double it.

**Acceleration feedforward** is different: it adds an estimate of the target’s acceleration so the controller can begin matching a change in motion before a large tracking error develops. The kit’s optional feedforward is bounded tracking-space hand acceleration, rotated into world space. It excludes acceleration caused by the simulated player body; feeding the reaction-induced body acceleration straight back into the grip can create a feedback loop. Start with it off, then compare reversals and curved hand paths.

**A One Euro filter** is an adaptive low-pass filter for noisy input. Its cutoff increases with motion speed to trade less lag for less smoothing. It does not change the grab spring’s damping ratio. Nor does it invent a missing target velocity or repair a coordinate-space mistake. Use filtering when measured tracking noise is the problem, after the force law and timing are correct. The kit does not claim to implement One Euro. [Original authors’ filter explanation and implementation](https://gery.casiez.net/1euro/).

An integral term is also not the first repair. It can accumulate error while a wall prevents the prop reaching its target, then release that stored demand when contact ends. Start with PD, a sensible force cap, and known gravity behavior before introducing integral state and anti-windup.

## 7. Joint frames: fix these before tuning

A joint has an object attachment, a connected-body attachment, and axes defining a joint frame. World rotation, local rotation, and joint-space target rotation are different quantities. Unity’s [ConfigurableJoint manual](https://docs.unity3d.com/6000.0/Documentation/Manual/class-ConfigurableJoint.html) defines the anchor, axes, motion modes, and drives.

For the direct connection:

1. On pickup, store the selected point in the object’s local space. That is the prop-side `anchor`.
2. Disable automatic connected-anchor configuration because the controller updates that anchor itself.
3. Express the desired hand point in the player body’s local space for `connectedAnchor`.
4. Preserve the grabbed object’s orientation offset from the tracked hand. Reconstruct the desired object orientation as the hand rotates.
5. Convert that desired orientation into the captured joint/rest frame. Do not assign the hand’s world quaternion blindly to `targetRotation`.

Use the kit’s frame helper consistently. If you change `axis`, `secondaryAxis`, `configuredInWorldSpace`, or which body owns the joint, review the conversion as a whole.

A useful verification: rotate the prop 45 degrees before grabbing, then rotate the player’s yaw, and repeat small hand rotations around all three axes. Pickup should not snap the prop to an unrelated orientation. A wrong sign or frame is not fixed by more damping.

For custom torque, use a shortest-arc quaternion error converted to a rotation vector in **radians**, compare angular velocities in radians per second, and convert angular acceleration through the body’s inertia tensor frame. Inertia is not just mass: a long tool and a compact cube of the same mass resist rotation differently. [Unity: inertiaTensor](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Rigidbody-inertiaTensor.html).

The teaching player’s rotation is locked. It does not reproduce the full angular response of a freely tumbling player connected to a prop. Evaluate handheld object rotation here; use a separate unconstrained rig to study full-body torque balance.

## 8. What FireBlast’s numbers actually tell us

| Reported setting | Value | What it controls or leaves open |
| --- | ---: | --- |
| Player Rigidbody mass | 1 kg | Actual body mass, not the teaching baseline. |
| Object Rigidbody mass | 1 kg | Still does not specify rotational inertia. |
| Object-side mass scale | 1 | Joint solver’s object inverse-mass/inertia multiplier. |
| Connected mass scale | 8 | Connected body’s inverse-mass/inertia multiplier. |
| Angular spring | 1800 | Reported rotational drive stiffness. |
| Angular damper | 120 | Reported rotational drive damping. |
| Angular maximum force | 12000 | Rotational drive cap; not the unknown linear drive cap. |
| Projection | Position and rotation | Constraint error correction mode. |
| Projection tolerances | 0.02 m, 5° | Thresholds, not spring gains. |
| Linear drives | **Unknown** | Spring, damper, maximum force, and motion modes were not supplied. |

The FireBlast preset preserves the reported portion, with our chosen values filling missing implementation details. It is an **incomplete reproduction**. We also lack his exact collider geometry, joint frames, input timing, solver settings, and proxy-hand arrangement.

`connectedMassScale = 8` does not make a 1 kg connected player act like an 8 kg mass to that joint. Unity applies the multiplier to **inverse mass and inverse inertia**, so it makes that connected body easier for the joint to accelerate. For an isolated translational constraint with equal actual masses and scales 1 and 8, the ideal response split is in the ratio 1:8. Contacts, locked axes, inertia, and the locomotion motor prevent treating that as a measured 89% gameplay result. [Unity: connectedMassScale](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Joint-connectedMassScale.html).

Projection is a separate mechanism: it corrects violated constraints geometrically and does not preserve momentum or respect collision geometry. Its distance/angle thresholds primarily concern constrained degrees of freedom; setting 0.02 m does not turn freely driven axes into a universal 2 cm leash. Leave projection off while evaluating a spring drive, then introduce it only for a demonstrated constraint-separation problem. [Unity: projectionMode](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/ConfigurableJoint-projectionMode.html) and [projectionDistance](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/ConfigurableJoint-projectionDistance.html).

## 9. Timing, gravity, and release behavior

Sample controller poses with their tracking context. Perform force calculations and joint updates on the physics schedule. Unity recommends `FixedUpdate` for Rigidbody force changes because rendering and simulation need not run at the same rate. A 90 Hz physics step is about 11.11 ms; a 120 Hz display does not automatically change it. [Unity: Rigidbody](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Rigidbody.html).

The kit samples hand targets and estimates bounded velocities in `Update`; `FixedUpdate` consumes the latest sample. The camera gets an additional pose refresh before rendering. Acceleration feedforward is a filtered estimate from those hand-velocity samples, not perfect hardware acceleration. Under a render stall, several physics steps may reuse a sample; inspect this timing before blaming the gains.

In the custom modes, desired point velocity combines the player body’s velocity at the desired point with hand motion measured relative to the player’s tracking space. Differentiating raw world-space hand position and then adding player velocity again would double-count the body’s motion.

Reset derivative history at discontinuities: pickup, recenter, teleport, tracking loss/recovery, and a large unexpected pose jump. Otherwise a one-frame displacement becomes an enormous estimated velocity or acceleration. Force limits are a final bound, not a replacement for validating those samples.

Keep gravity enabled while learning how weight transfers. A held object can settle below its target because the spring must produce its weight-supporting force. If you add gravity compensation, label it as a design decision and decide where the corresponding load goes. Disabling prop gravity while held changes the experiment. [MIT’s manipulation notes explain PD’s steady-state gravity error](https://manipulation.csail.mit.edu/force.html).

On release, remove the grab controller and retain the prop’s physically accumulated velocity. Do not add a second full controller throw velocity on top unless you deliberately designed that blend. A wall-blocked prop should not inherit a throw that only the invisible target performed.

The sample immediately restores player–prop collisions on release. Releasing a prop inside the player capsule can therefore cause a depenetration kick. A production refinement is to keep that collision pair ignored until the bodies separate; include overlapping release in your acceptance tests.

Interpolation can make rendered rigidbodies look smoother between physics steps; it does not increase simulation frequency. Keep the physics state and rendered pose distinct when diagnosing lag. [Unity: Rigidbody interpolation](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Rigidbody-interpolation.html).

## 10. Run these experiments in order

1. **Free-air follow.** Hold the small cube, make a slow straight sweep, stop, then reverse sharply. Switch modes while holding. Look for lag, overshoot, and grip offset. Test acceleration feedforward off before turning it on in a custom mode.
2. **Wall pressure.** Push the held cube into a wall. The physical cube should stop while the tracked target continues. Observe player reaction and force saturation. Pull away gently; stored controller demand should not launch the cube violently.
3. **Floor support and fixed grips.** Press the cube into the floor and move the hand downward. Then grab a fixed climbing rung. Is the reaction sufficient to lift the player? Try custom reaction off to see why one-way object tracking cannot lift a player from a fixed grip. If force is capped below the required load, changing damping cannot fix it.
4. **Rotating tool.** Grab away from a prop’s center, rotate through all three axes, and press an end against the wall. This exposes incorrect point velocity, inertia conversion, and anchor definitions.
5. **External impact.** While holding a prop still, collide another body with it. Does the system yield, recover, or erase the impact? Compare with the locomotion motor active and inactive when investigating ownership of motion.
6. **Release and reacquire.** Release at rest, during a sweep, and while blocked. Regrab a rotated object. Repeat the live mode switch several times. Check the Inspector for orphaned or stacked joints.

Use the same object, grip point, posture, and wall for the A/B. Get Duck or FireBlast to switch modes without announcing the selection, then ask which feels better and why. Record controller mode, mass, gains, cap, fixed step, and headset refresh rate with each conclusion. One nice-looking graph is not enough to choose locomotion feel.

### A sensible tuning order

First fix scale, collision layers, attachment frames, tracking validity, and velocity spaces. Then choose a force/torque budget. Start around damping ratio 1 and increase frequency until recovery is useful. Repeat under contact, not only in free air. If response saturates, decide whether the force budget should change before raising frequency again.

Increase solver iterations locally on the player and held prop only when you can reproduce a joint/contact convergence problem. More iterations cost CPU and do not correct a bad target frame. Profile on the headset; desktop success is not a Quest performance result. [Unity: solverIterations](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Rigidbody-solverIterations.html).

## 11. Troubleshooting

| Symptom | First thing to inspect |
| --- | --- |
| Object trails more as damping rises | Absolute velocity damping, missing target velocity, or the native baseline’s moving-anchor velocity assumption. |
| Immediate spin or snap at pickup | Captured grip offset, joint/rest frame, quaternion order, and radians versus degrees. |
| Player never reacts to a blocked object | Kinematic player/proxy, object-only force application, or another script overwriting velocity. |
| Player reacts twice as strongly in CJ mode | Manual reaction force left active alongside native joint solving. |
| Cube follows through a wall | Kinematic/transform ownership, collider/layer setup, force budget, and collision detection. |
| Mode switch creates a kick | Previous drive still active, attachment recaptured incorrectly, or stale derivative history. |
| More frequency barely helps | Force saturation, insufficient solver convergence, delayed target samples, or unrealistic gain expectations. |
| Long tool jitters while cube is fine | Anchor leverage, rotational effective mass, inertia, torque cap, and angular speed limits. |
| XR hands stay at the origin | OpenXR profile, enabled serialized actions, device bindings, and valid tracking state. |
| Head or hands move twice | Two scripts writing the same tracked transforms or duplicate tracking origins. |
| Discontinuity after recenter | World/reference frame reset and derivative histories. |
| Works on PC, misses frames on Quest | Actual CPU/GPU timing, physics work per frame, solver counts, collider complexity, and rendering load. |

## 12. Quest build and the WebXR companion

For a native Quest build, install the Android modules, open **File → Build Profiles**, and select **Meta Quest** where available. Earlier Unity 6 workflows can use **Android**. Enable OpenXR for that target, select the required Quest support feature offered by your installed provider, and run platform validation. Follow the provider’s current validation for graphics/API requirements rather than copying an old screenshot. [Meta’s manual project setup](https://developers.meta.com/vr/documentation/unity/unity-tutorial-hello-world-manual-steps/).

Use **IL2CPP** and **ARM64** for the device build, assign a unique application identifier, and include the generated scene. Put the headset in developer mode, connect USB, accept its debugging prompt, and use Build and Run. Make the first run a development build so errors and timing can be inspected. [Meta’s Unity player-setting guidance](https://developers.meta.com/vr/documentation/unity/unity-prepare-for-publish/).

For the [WebXR companion](../vr/), open the HTTPS page in a browser that supports immersive VR on your headset and use its Enter VR control. Desktop controls provide a way to explore the scene without a headset. The companion uses Three.js rendering and Cannon physics, and preserves the held object when switching modes.

| Browser experiment | What to compare in Unity |
| --- | --- |
| One-way PD | Relative PD with custom reaction disabled. |
| Reaction PD | Relative PD with custom reaction enabled. |
| Backward PD | Backward PD with the reaction path enabled. |
| Cannon point joint | Native solver connection concept; not a ConfigurableJoint reproduction. |

The browser’s point joint uses a shared custom angular PD controller. It does **not** implement Unity’s Slerp drive or the complete PhysX ConfigurableJoint. Explore force paths and controller behavior in the browser, then validate the Unity implementation separately.

### Acceptance checklist before sharing a build

- [ ] Fresh Unity import compiles without errors; generated scene and action references are present.
- [ ] Desktop grab, release, restart, and all three live mode selections work.
- [ ] Headset floor height, scale, left/right poses, grip input, and turning are correct.
- [ ] Tracking interruption and recentering do not generate a large impulse.
- [ ] The same held object survives repeated CJ → relative PD → backward PD switches.
- [ ] Wall and floor contacts transfer load through the intended body/proxy path.
- [ ] Rotated pickup and all-axis tool rotations preserve the captured grip.
- [ ] Releases preserve sensible physical momentum without a duplicate throw boost.
- [ ] No growing number of joints, orphaned holds, or persistent collision-ignore pairs.
- [ ] Native headset frame timing has been measured at the chosen refresh rate.
- [ ] Another person has performed the in-headset A/B and described the difference.

Each prop has one owning hand; a two-handed rifle grip needs additional logic. This kit stops at local interaction. Multiplayer ownership, authoritative physics, reconciliation, avatar presentation, and networked throws require a separate design. First establish a grip that feels good and behaves predictably on one headset.

## Credits and foundations

**Trent Sterling / Tront and ChatGPT** built the teaching lab, with the discussion and experiments from **Ducky / Duck (SCUG)** and **FireBlast**.

**Digital Opus is the primary technical inspiration:** [Controlling Objects With Forces and Torques I](https://digitalopus.ca/site/pd-controllers/), [Part II](https://digitalopus.ca/site/controlling-objects-with-forces-and-torques-part-2/), and [UsefulUtils](https://github.com/Phong13/UsefulUtils). David Wu’s backward PD presentation and the work of Jie Tan, C. Karen Liu, and Greg Turk provide related controller foundations.

**Another Axiom** provided the original [GorillaLocomotion source](https://github.com/Another-Axiom/GorillaLocomotion), included with its MIT license and pinned commit. The teaching motor is an adaptation and is not affiliated with or endorsed by Gorilla Tag or Another Axiom.

Unity/OpenXR, PhysX, Three.js, and Cannon supply the underlying engine/runtime concepts or demo libraries. Their documentation and licenses remain attributed in the repository.
