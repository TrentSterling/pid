// Tront Physics Gym. Original teaching implementation, MIT; see repository LICENSE.
using UnityEngine;

namespace Tront.PhysicsGym
{
    public enum GrabController { ConfigurableJoint, RelativePD, BackwardPD }

    /// <summary>Acceleration gains use Hz and a dimensionless damping ratio.</summary>
    public static class GymControllerMath
    {
        public static void Gains(float frequencyHz, float dampingRatio, out float kp, out float kd)
        {
            float omega = 2f * Mathf.PI * Mathf.Max(0f, frequencyHz);
            kp = omega * omega;
            kd = 2f * Mathf.Max(0f, dampingRatio) * omega;
        }

        // This is an implicit/backward linear PD update for semi-implicit Euler,
        // with constant target velocity over the step. It is NOT Digital Opus's
        // explicit "SPD V2" approximation. No unconditional claim after contacts,
        // saturations, changing targets, or rotational linearization.
        public static Vector3 Acceleration(Vector3 positionError, Vector3 velocityError,
            float kp, float kd, float dt, bool backward, Vector3 feedForward)
        {
            if (!backward) return kp * positionError + kd * velocityError + feedForward;
            float g = 1f / (1f + kd * dt + kp * dt * dt);
            return g * (kp * positionError + (kd + kp * dt) * velocityError) + feedForward;
        }

        public static float EffectiveMass(Rigidbody driven, Rigidbody receiver, bool reaction)
        {
            float inverseMass = driven.isKinematic ? 0f : 1f / Mathf.Max(0.001f, driven.mass);
            if (reaction && receiver != null && !receiver.isKinematic)
                inverseMass += 1f / Mathf.Max(0.001f, receiver.mass);
            return inverseMass > 0f ? 1f / inverseMass : 0f;
        }

        public static Vector3 RotationVector(Quaternion desired, Quaternion current)
        {
            Quaternion q = desired * Quaternion.Inverse(current);
            if (q.w < 0f) q = new Quaternion(-q.x, -q.y, -q.z, -q.w);
            q.ToAngleAxis(out float degrees, out Vector3 axis);
            if (degrees < 0.001f || !IsFinite(axis)) return Vector3.zero;
            return axis.normalized * (Mathf.DeltaAngle(0f, degrees) * Mathf.Deg2Rad);
        }

        public static Vector3 InertiaTorque(Quaternion bodyRotation, Quaternion inertiaRotation,
            Vector3 inertia, Vector3 angularAcceleration)
        {
            // inertiaTensorRotation is principal-axis -> body; multiplication order matters.
            Quaternion principalToWorld = bodyRotation * inertiaRotation;
            Vector3 localAcceleration = Quaternion.Inverse(principalToWorld) * angularAcceleration;
            return principalToWorld * Vector3.Scale(inertia, localAcceleration);
        }

        public static Quaternion JointTargetRotation(Quaternion desiredRelative,
            Quaternion initialRelative, Vector3 axis, Vector3 secondaryAxis)
        {
            Vector3 right = axis.normalized;
            Vector3 forward = Vector3.Cross(right, secondaryAxis).normalized;
            Vector3 up = Vector3.Cross(forward, right).normalized;
            Quaternion jointBasis = Quaternion.LookRotation(forward, up);
            // configuredInWorldSpace=false. Rotations are relative to connectedBody,
            // not Transform.parent. Target is the inverse offset from the initial pose.
            return Quaternion.Inverse(jointBasis) * Quaternion.Inverse(desiredRelative)
                * initialRelative * jointBasis;
        }

        public static bool IsFinite(Vector3 v) =>
            !(float.IsNaN(v.x) || float.IsInfinity(v.x) || float.IsNaN(v.y)
              || float.IsInfinity(v.y) || float.IsNaN(v.z) || float.IsInfinity(v.z));
    }
}
