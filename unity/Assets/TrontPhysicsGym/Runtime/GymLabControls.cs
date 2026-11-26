using UnityEngine;
using UnityEngine.InputSystem;

namespace Tront.PhysicsGym
{
    [DefaultExecutionOrder(-200)]
    public sealed class GymLabControls : MonoBehaviour
    {
        public GymRigInput input;
        public GymMotor motor;
        public GymHand leftHand, rightHand;
        public Rigidbody player;
        public TextMesh statusBoard;
        public GrabController mode = GrabController.BackwardPD;
        [Range(1f, 12f)] public float frequencyHz = 6f;
        [Range(0f, 2f)] public float dampingRatio = 1f;
        public float maximumForce = 1600f;
        public float maximumTorque = 30f;
        public bool accelerationFeedForward;
        public bool reactionForces = true;
        public bool fireBlastAngularPreset;
        Vector3 spawnPosition;
        Quaternion spawnRotation;
        float nextTextTime;
        GUIStyle titleStyle, labelStyle;

        void Awake() { spawnPosition = player.position; spawnRotation = player.rotation; }
        void OnEnable() { if (input != null) input.OriginChanged += OnOriginChanged; }
        void OnDisable() { if (input != null) input.OriginChanged -= OnOriginChanged; }
        void OnOriginChanged() { leftHand.Release(); rightHand.Release(); motor.ResetContacts(); ResetHistories(); }

        void Update()
        {
            if (input.CyclePressed) CycleMode();
            if (input.FeedForwardPressed) ToggleFeedForward();
            if (input.ResetPressed) ResetLab();
            if (!input.IsXR && Keyboard.current != null)
            {
                if (Keyboard.current.bKey.wasPressedThisFrame) reactionForces = !reactionForces;
                if (Keyboard.current.pKey.wasPressedThisFrame) SetFireBlastPreset(!fireBlastAngularPreset);
                if (Keyboard.current.mKey.wasPressedThisFrame) motor.motorEnabled = !motor.motorEnabled;
            }
            if (Time.unscaledTime >= nextTextTime)
            {
                nextTextTime = Time.unscaledTime + 0.1f;
                if (statusBoard != null) statusBoard.text = "PHYSICS GYM / UNITY\n" + mode
                    + "   " + frequencyHz.ToString("0.0") + " Hz   damping " + dampingRatio.ToString("0.00")
                    + "\n" + (accelerationFeedForward ? "Acceleration FF ON" : "Acceleration FF OFF")
                    + (mode == GrabController.ConfigurableJoint ? " (custom modes only)" : "")
                    + "\nL " + leftHand.ErrorMetres.ToString("0.000") + " m   R " + rightHand.ErrorMetres.ToString("0.000") + " m"
                    + "\nGrip: hold   A: controller   X: feedforward   Y: reset\n"
                    + (fireBlastAngularPreset ? "FireBlast angular preset / linear gains are teaching defaults" : "Teaching preset / body 75 kg, props 1 kg");
            }
            if (player.position.y < -10f) ResetLab();
        }

        public void CycleMode() { mode = (GrabController)(((int)mode + 1) % 3); ResetHistories(); }
        public void ToggleFeedForward() { accelerationFeedForward = !accelerationFeedForward; ResetHistories(); }
        void ResetHistories() { leftHand.ResetControllerHistory(); rightHand.ResetControllerHistory(); }

        public void SetFireBlastPreset(bool value)
        {
            fireBlastAngularPreset = value;
            player.mass = value ? 1f : 75f;
            ResetHistories();
        }

        public void ResetLab()
        {
            leftHand.Release(); rightHand.Release();
            foreach (GymGrabbable prop in FindObjectsByType<GymGrabbable>(FindObjectsSortMode.None)) prop.ResetProp();
            player.position = spawnPosition; player.rotation = spawnRotation;
            player.linearVelocity = Vector3.zero; player.angularVelocity = Vector3.zero;
            input.ResetDesktopHands(); input.ResetDerivatives(); motor.ResetContacts();
            Physics.SyncTransforms();
        }

        void OnApplicationFocus(bool focused) { if (!focused) { leftHand.Release(); rightHand.Release(); input.ResetDerivatives(); } }

        void OnGUI()
        {
            if (input == null || input.IsXR) return;
            if (titleStyle == null)
            {
                titleStyle = new GUIStyle(GUI.skin.label) { fontSize = 18, fontStyle = FontStyle.Bold };
                labelStyle = new GUIStyle(GUI.skin.label) { wordWrap = true, fontSize = 13 };
            }
            GUILayout.BeginArea(new Rect(15f, 15f, 420f, 410f), GUI.skin.box);
            GUILayout.Label("TRONT / PHYSICS GYM", titleStyle);
            GUILayout.Label("Hold one cube; change controllers without dropping it.", labelStyle);
            if (GUILayout.Button("C — " + mode + " (cycle)")) CycleMode();
            GUILayout.Label("Frequency " + frequencyHz.ToString("0.0") + " Hz");
            frequencyHz = GUILayout.HorizontalSlider(frequencyHz, 1f, 12f);
            GUILayout.Label("Damping ratio " + dampingRatio.ToString("0.00"));
            dampingRatio = GUILayout.HorizontalSlider(dampingRatio, 0f, 2f);
            bool newFF = GUILayout.Toggle(accelerationFeedForward, "F — tracked acceleration feedforward (custom PD only)");
            if (newFF != accelerationFeedForward) ToggleFeedForward();
            reactionForces = GUILayout.Toggle(reactionForces, "B — equal/opposite reaction (native CJ always reacts)");
            bool preset = GUILayout.Toggle(fireBlastAngularPreset, "P — FireBlast angular/mass preset (incomplete rig)");
            if (preset != fireBlastAngularPreset) SetFireBlastPreset(preset);
            motor.motorEnabled = GUILayout.Toggle(motor.motorEnabled, "M — arm/desktop locomotion motor");
            if (GUILayout.Button("R — reset scene")) ResetLab();
            GUILayout.Label("WASD walk · right mouse look · Q/E hold left/right grip\n1/2/3 edit left/right/both hands · I/K forward/back · J/L sideways · U/O up/down · H restore hands", labelStyle);
            GUILayout.Label("Error L/R: " + leftHand.ErrorMetres.ToString("0.000") + " / " + rightHand.ErrorMetres.ToString("0.000")
                + " m   Force L/R: " + leftHand.AppliedForce.ToString("0") + " / " + rightHand.AppliedForce.ToString("0") + " N", labelStyle);
            GUILayout.EndArea();
        }
    }
}
