using UnityEngine;

namespace Tront.PhysicsGym
{
    [RequireComponent(typeof(Rigidbody))]
    public sealed class GymGrabbable : MonoBehaviour
    {
        public Rigidbody Body { get; private set; }
        public GymHand Owner { get; private set; }
        public Vector3 SpawnPosition { get; private set; }
        public Quaternion SpawnRotation { get; private set; }

        void Awake()
        {
            Body = GetComponent<Rigidbody>();
            SpawnPosition = Body.position;
            SpawnRotation = Body.rotation;
        }

        public bool TryClaim(GymHand hand)
        {
            if (Owner != null) return false;
            Owner = hand;
            return true;
        }

        public void Release(GymHand hand) { if (Owner == hand) Owner = null; }

        public void ResetProp()
        {
            if (Owner != null) Owner.Release();
            if (!Body.isKinematic) { Body.linearVelocity = Vector3.zero; Body.angularVelocity = Vector3.zero; }
            Body.position = SpawnPosition;
            Body.rotation = SpawnRotation;
        }

        void OnDisable() { if (Owner != null) Owner.Release(); }
    }
}
