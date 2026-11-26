using UnityEngine;

namespace Tront.PhysicsGym
{
    [DefaultExecutionOrder(-100)]
    public sealed class GymHand : MonoBehaviour
    {
        public GymRigInput input;
        public GymLabControls lab;
        public Rigidbody player;
        public Transform target, visual;
        public bool leftHand;
        public LayerMask grabbableLayers;
        public float grabRadius = 0.18f;
        public float releaseDistance = 1.5f;
        public GymGrabbable Held { get; private set; }
        public float ErrorMetres { get; private set; }
        public float AppliedForce { get; private set; }
        public bool HasSurfaceContact { get; set; }
        public Vector3 SurfaceContactPosition { get; set; }
        public bool Valid => leftHand ? input.LeftValid : input.RightValid;
        public Vector3 LocalVelocity => leftHand ? input.LeftLocalVelocity : input.RightLocalVelocity;
        public Vector3 LocalAngularVelocity => leftHand ? input.LeftLocalAngularVelocity : input.RightLocalAngularVelocity;
        public Vector3 TargetPosition => player.position + player.rotation * player.transform.InverseTransformPoint(target.position);
        public Quaternion TargetRotation => player.rotation * Quaternion.Inverse(player.transform.rotation) * target.rotation;

        readonly Collider[] overlaps = new Collider[24];
        Collider[] heldColliders, playerColliders;
        bool[,] previouslyIgnored;
        Vector3 objectAnchor, previousLocalVelocity, filteredAcceleration;
        Quaternion gripRotationOffset, initialRelativeRotation;
        ConfigurableJoint joint;
        GrabController activeMode;
        bool previousGrip, derivativeReady;

        void FixedUpdate()
        {
            bool grip = leftHand ? input.LeftGrip : input.RightGrip;
            if (!Valid) { Release(); previousGrip = grip; return; }
            if (grip && !previousGrip) TryGrab();
            if (!grip && previousGrip) Release();
            previousGrip = grip;
            if (Held == null) return;
            if (activeMode != lab.mode) ConfigureController();
            Rigidbody body = Held.Body;
            Vector3 anchorWorld = body.position + body.rotation * objectAnchor;
            Vector3 targetPosition = TargetPosition;
            ErrorMetres = (targetPosition - anchorWorld).magnitude;
            if (ErrorMetres > releaseDistance) { Release(); return; }

            float dt = Time.fixedDeltaTime;
            Vector3 trackedVelocity = input.trackingSpace.TransformDirection(LocalVelocity);
            Vector3 targetVelocity = player.GetPointVelocity(targetPosition) + trackedVelocity;
            Vector3 localAcceleration = derivativeReady ? (LocalVelocity - previousLocalVelocity) / dt : Vector3.zero;
            previousLocalVelocity = LocalVelocity;
            derivativeReady = true;
            filteredAcceleration = Vector3.Lerp(filteredAcceleration, Vector3.ClampMagnitude(localAcceleration, 35f),
                1f - Mathf.Exp(-2f * Mathf.PI * 12f * dt));
            Vector3 feedForward = lab.accelerationFeedForward
                ? input.trackingSpace.TransformDirection(filteredAcceleration) : Vector3.zero;

            if (activeMode == GrabController.ConfigurableJoint)
            {
                if (joint == null) { Release(); return; }
                // attached object's anchor and player's connectedAnchor meet at the hand.
                // Never put a world position in connectedAnchor (it is player-local).
                joint.connectedAnchor = Quaternion.Inverse(player.rotation) * (targetPosition - player.position);
                Quaternion desiredRelative = Quaternion.Inverse(player.rotation) * (TargetRotation * gripRotationOffset);
                joint.targetRotation = GymControllerMath.JointTargetRotation(desiredRelative,
                    initialRelativeRotation, joint.axis, joint.secondaryAxis);
                ConfigureNativeGains();
                AppliedForce = joint.currentForce.magnitude;
                // PhysX supplies BOTH reactions. Do not also AddForce(-currentForce) to player.
                return;
            }

            GymControllerMath.Gains(lab.frequencyHz, lab.dampingRatio, out float kp, out float kd);
            bool backward = activeMode == GrabController.BackwardPD;
            Vector3 acceleration = GymControllerMath.Acceleration(targetPosition - anchorWorld,
                targetVelocity - body.GetPointVelocity(anchorWorld), kp, kd, dt, backward, feedForward);
            float mass = GymControllerMath.EffectiveMass(body, player, lab.reactionForces);
            Vector3 force = Vector3.ClampMagnitude(acceleration * mass, lab.maximumForce);
            if (!GymControllerMath.IsFinite(force)) { Release(); return; }
            if (!body.isKinematic) body.AddForceAtPosition(force, anchorWorld, ForceMode.Force);
            if (lab.reactionForces) player.AddForceAtPosition(-force, targetPosition, ForceMode.Force);
            AppliedForce = force.magnitude;

            // Player rotation is frozen in this example. Object inertia is therefore the
            // relevant rotational inertia. This is not a general two-free-body inertia solve.
            if (!body.isKinematic)
            {
                Quaternion desired = TargetRotation * gripRotationOffset;
                Vector3 angularError = GymControllerMath.RotationVector(desired, body.rotation);
                Vector3 angularVelocity = player.angularVelocity + input.trackingSpace.TransformDirection(LocalAngularVelocity);
                Vector3 angularAcceleration = GymControllerMath.Acceleration(angularError,
                    angularVelocity - body.angularVelocity, kp, kd, dt, backward, Vector3.zero);
                Vector3 torque = Vector3.ClampMagnitude(GymControllerMath.InertiaTorque(body.rotation,
                    body.inertiaTensorRotation, body.inertiaTensor, angularAcceleration), lab.maximumTorque);
                body.AddTorque(torque, ForceMode.Force);
                if (lab.reactionForces) player.AddTorque(-torque, ForceMode.Force);
            }
        }

        void TryGrab()
        {
            if (Held != null) return;
            Vector3 hand = TargetPosition;
            int count = Physics.OverlapSphereNonAlloc(hand, grabRadius, overlaps, grabbableLayers, QueryTriggerInteraction.Ignore);
            float nearest = float.PositiveInfinity;
            GymGrabbable choice = null;
            Vector3 point = hand;
            for (int i = 0; i < count; i++)
            {
                GymGrabbable candidate = overlaps[i].GetComponentInParent<GymGrabbable>();
                if (candidate == null || candidate.Owner != null) continue;
                Vector3 closest = overlaps[i].ClosestPoint(hand);
                float distance = (closest - hand).sqrMagnitude;
                if (distance < nearest) { nearest = distance; choice = candidate; point = closest; }
            }
            if (choice == null || !choice.TryClaim(this)) return;
            Held = choice;
            objectAnchor = Quaternion.Inverse(choice.Body.rotation) * (point - choice.Body.position);
            // Keep the exact initial object orientation; grabbing never snaps to a canned pose.
            gripRotationOffset = Quaternion.Inverse(TargetRotation) * choice.Body.rotation;
            playerColliders = player.GetComponentsInChildren<Collider>();
            heldColliders = choice.GetComponentsInChildren<Collider>();
            previouslyIgnored = new bool[heldColliders.Length, playerColliders.Length];
            for (int a = 0; a < heldColliders.Length; a++)
                for (int b = 0; b < playerColliders.Length; b++)
                {
                    previouslyIgnored[a, b] = Physics.GetIgnoreCollision(heldColliders[a], playerColliders[b]);
                    Physics.IgnoreCollision(heldColliders[a], playerColliders[b], true);
                }
            ConfigureController();
        }

        void ConfigureController()
        {
            RemoveJoint();
            activeMode = lab.mode;
            derivativeReady = false; filteredAcceleration = Vector3.zero;
            if (Held == null || activeMode != GrabController.ConfigurableJoint) return;
            Rigidbody body = Held.Body;
            joint = body.gameObject.AddComponent<ConfigurableJoint>();
            joint.connectedBody = player;
            joint.autoConfigureConnectedAnchor = false;
            joint.anchor = objectAnchor;
            joint.connectedAnchor = Quaternion.Inverse(player.rotation) * (TargetPosition - player.position);
            joint.axis = Vector3.right; joint.secondaryAxis = Vector3.up;
            joint.configuredInWorldSpace = false;
            joint.xMotion = joint.yMotion = joint.zMotion = ConfigurableJointMotion.Free;
            joint.angularXMotion = joint.angularYMotion = joint.angularZMotion = ConfigurableJointMotion.Free;
            joint.rotationDriveMode = RotationDriveMode.Slerp;
            joint.targetPosition = Vector3.zero;
            joint.targetVelocity = Vector3.zero;
            joint.targetAngularVelocity = Vector3.zero;
            joint.enableCollision = false;
            initialRelativeRotation = Quaternion.Inverse(player.rotation) * body.rotation;
            ConfigureNativeGains();
        }

        void ConfigureNativeGains()
        {
            GymControllerMath.Gains(lab.frequencyHz, lab.dampingRatio, out float kp, out float kd);
            float mass = GymControllerMath.EffectiveMass(Held.Body, player, true);
            JointDrive linear = new JointDrive { positionSpring = mass * kp, positionDamper = mass * kd,
                maximumForce = lab.maximumForce };
            joint.xDrive = joint.yDrive = joint.zDrive = linear;
            Vector3 inertia = Held.Body.inertiaTensor;
            float averageInertia = (inertia.x + inertia.y + inertia.z) / 3f;
            joint.slerpDrive = lab.fireBlastAngularPreset
                ? new JointDrive { positionSpring = 1800f, positionDamper = 120f, maximumForce = 12000f }
                : new JointDrive { positionSpring = averageInertia * kp, positionDamper = averageInertia * kd, maximumForce = lab.maximumTorque };
            joint.massScale = 1f;
            joint.connectedMassScale = lab.fireBlastAngularPreset ? 8f : 1f;
            joint.projectionMode = lab.fireBlastAngularPreset ? JointProjectionMode.PositionAndRotation : JointProjectionMode.None;
            joint.projectionDistance = 0.02f; joint.projectionAngle = 5f;
        }

        void RemoveJoint()
        {
            if (joint == null) return;
            // Destroy is deferred. Neutralize all drives now so switching modes cannot
            // leave a native drive fighting the custom force during this physics step.
            joint.xDrive = joint.yDrive = joint.zDrive = new JointDrive();
            joint.slerpDrive = joint.angularXDrive = joint.angularYZDrive = new JointDrive();
            joint.projectionMode = JointProjectionMode.None;
            joint.xMotion = joint.yMotion = joint.zMotion = ConfigurableJointMotion.Free;
            joint.angularXMotion = joint.angularYMotion = joint.angularZMotion = ConfigurableJointMotion.Free;
            Destroy(joint); joint = null;
        }

        public void Release()
        {
            RemoveJoint();
            if (heldColliders != null && playerColliders != null)
                for (int a = 0; a < heldColliders.Length; a++)
                    for (int b = 0; b < playerColliders.Length; b++)
                        if (heldColliders[a] != null && playerColliders[b] != null)
                            Physics.IgnoreCollision(heldColliders[a], playerColliders[b], previouslyIgnored[a, b]);
            heldColliders = playerColliders = null;
            if (Held != null) Held.Release(this);
            Held = null; ErrorMetres = AppliedForce = 0f; derivativeReady = false;
            // Leave Rigidbody velocities intact: throwing uses the motion already solved.
        }

        public void ResetControllerHistory() { derivativeReady = false; filteredAcceleration = Vector3.zero; }
        void OnDisable() { Release(); }
        void LateUpdate()
        {
            if (visual == null) return;
            Vector3 position = target.position;
            if (Held != null) position = Held.transform.TransformPoint(objectAnchor);
            else if (HasSurfaceContact) position = SurfaceContactPosition;
            visual.SetPositionAndRotation(position, target.rotation);
        }
    }
}
