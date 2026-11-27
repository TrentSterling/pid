using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Rendering;

namespace Tront.PhysicsGym.Editor
{
    public static class GymSceneBuilder
    {
        const string Generated = "Assets/TrontPhysicsGym/Generated";

        [MenuItem("Tools/Tront Physics Gym/Create Teaching Scene")]
        public static void CreateScene()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            Directory.CreateDirectory(Generated);
            AssetDatabase.Refresh();
            int worldLayer = EnsureLayer("GymWorld"), propLayer = EnsureLayer("GymProps"), playerLayer = EnsureLayer("GymPlayer");
            if (worldLayer < 0 || propLayer < 0 || playerLayer < 0) return;
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            Time.fixedDeltaTime = 1f / 90f;
            // Explicitly save this scene-builder choice in Time settings; a headset's
            // actual render refresh remains separate and must be measured on device.
            SerializedObject timeSettings = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/TimeManager.asset")[0]);
            timeSettings.FindProperty("Fixed Timestep").floatValue = 1f / 90f;
            timeSettings.ApplyModifiedProperties();

            Material floor = MaterialAsset("Floor", new Color(0.09f, 0.14f, 0.2f));
            Material wall = MaterialAsset("Wall", new Color(0.15f, 0.22f, 0.29f));
            Material orange = MaterialAsset("Orange", new Color(1f, 0.49f, 0.17f));
            Material blue = MaterialAsset("Blue", new Color(0.21f, 0.68f, 1f));
            Material mint = MaterialAsset("Mint", new Color(0.33f, 0.9f, 0.68f));
            Material white = MaterialAsset("White", new Color(0.85f, 0.91f, 0.96f));

            Box("Floor", new Vector3(0f, -0.15f, 2f), new Vector3(12f, 0.3f, 12f), floor, worldLayer);
            Box("Back wall", new Vector3(0f, 2f, 7.8f), new Vector3(12f, 4f, 0.3f), wall, worldLayer);
            Box("Left wall", new Vector3(-5.8f, 2f, 2f), new Vector3(0.3f, 4f, 12f), wall, worldLayer);
            Box("Right wall", new Vector3(5.8f, 2f, 2f), new Vector3(0.3f, 4f, 12f), wall, worldLayer);
            Box("Start table", new Vector3(0f, 0.85f, 0.8f), new Vector3(2.4f, 0.15f, 0.65f), wall, worldLayer);
            Box("Push wall", new Vector3(-2.5f, 0.8f, 2.2f), new Vector3(1.7f, 1.6f, 0.3f), wall, worldLayer);
            Box("Climbing wall", new Vector3(2.6f, 1.6f, 4f), new Vector3(2f, 3.2f, 0.3f), wall, worldLayer);
            for (int i = 0; i < 5; i++)
            {
                GameObject rung = Prop("Fixed grip " + (i + 1), new Vector3(2.6f, 0.65f + i * 0.48f, 3.72f),
                    new Vector3(1.2f, 0.12f, 0.18f), mint, propLayer);
                rung.GetComponent<Rigidbody>().isKinematic = true;
            }
            Prop("Left cube 1 kg", new Vector3(-0.32f, 1.1f, 0.72f), Vector3.one * 0.3f, orange, propLayer);
            Prop("Right cube 1 kg", new Vector3(0.32f, 1.1f, 0.72f), Vector3.one * 0.3f, blue, propLayer);
            Prop("Long lever 1 kg", new Vector3(-1.6f, 0.18f, 2.8f), new Vector3(1.5f, 0.15f, 0.15f), orange, propLayer);
            Prop("Rotated cube 1 kg", new Vector3(0f, 0.4f, 3f), Vector3.one * 0.5f, blue, propLayer)
                .transform.rotation = Quaternion.Euler(15f, 35f, 10f);

            GameObject player = new GameObject("Player / dynamic Rigidbody");
            player.layer = playerLayer;
            player.transform.position = new Vector3(0f, 0.05f, -0.2f);
            Rigidbody body = player.AddComponent<Rigidbody>();
            body.mass = 75f; body.useGravity = true;
            body.constraints = RigidbodyConstraints.FreezeRotation;
            body.interpolation = RigidbodyInterpolation.Interpolate;
            body.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
            body.linearDamping = 0f; body.angularDamping = 0f;
            body.solverIterations = 12; body.solverVelocityIterations = 6;
            CapsuleCollider capsule = player.AddComponent<CapsuleCollider>();
            capsule.radius = 0.22f; capsule.height = 1.65f;
            capsule.center = new Vector3(0f, 0.845f, 0f);
            GymRigInput input = player.AddComponent<GymRigInput>();
            GymMotor motor = player.AddComponent<GymMotor>();
            GymLabControls lab = player.AddComponent<GymLabControls>();
            Transform space = Child("TrackingSpace / raw local poses", player.transform);
            Transform head = Child("HMD / raw camera pose", space);
            head.localPosition = Vector3.up * 1.65f;
            Camera camera = head.gameObject.AddComponent<Camera>();
            camera.nearClipPlane = 0.04f; camera.farClipPlane = 100f;
            camera.backgroundColor = new Color(0.035f, 0.055f, 0.09f);
            camera.clearFlags = CameraClearFlags.SolidColor;
            head.gameObject.tag = "MainCamera";
            head.gameObject.AddComponent<AudioListener>();
            Transform leftTarget = Child("Left raw target", space);
            Transform rightTarget = Child("Right raw target", space);
            leftTarget.localPosition = new Vector3(-0.28f, 1.15f, 0.5f);
            rightTarget.localPosition = new Vector3(0.28f, 1.15f, 0.5f);
            GymHand left = Hand("Left grip", player.transform, leftTarget, orange, input, lab, body, propLayer, true);
            GymHand right = Hand("Right grip", player.transform, rightTarget, blue, input, lab, body, propLayer, false);
            input.trackingSpace = space; input.head = head; input.leftTarget = leftTarget; input.rightTarget = rightTarget;
            input.actions = CreateInputAsset();
            motor.input = input; motor.leftHand = left; motor.rightHand = right; motor.worldLayers = 1 << worldLayer;
            lab.input = input; lab.motor = motor; lab.leftHand = left; lab.rightHand = right; lab.player = body;
            TextMesh board = Text("Live controller board", new Vector3(0f, 2.5f, 5.9f),
                "PHYSICS GYM / UNITY\nHold a cube, press A to change controller", 0.035f, white);
            board.anchor = TextAnchor.UpperCenter; board.alignment = TextAlignment.Center;
            lab.statusBoard = board;
            Text("Credits", new Vector3(0f, 0.65f, 6.2f),
                "Trent Sterling + ChatGPT / Ducky + FireBlast\nPrimary technical inspiration: DIGITAL OPUS\nLocomotion reference: Another Axiom / GorillaLocomotion (MIT)", 0.022f, white);
            Text("Climbing label", new Vector3(2.6f, 3.5f, 3.78f), "FIXED GRIPS / REACTION TEST", 0.025f, white);
            Text("Push label", new Vector3(-2.5f, 2.05f, 2f), "PLANT HAND / PUSH WALL", 0.025f, white);

            var lightObject = new GameObject("Key light");
            Light light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional; light.intensity = 1.4f;
            light.shadows = LightShadows.None;
            lightObject.transform.rotation = Quaternion.Euler(55f, -30f, 0f);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.55f, 0.62f, 0.75f);

            string path = AssetDatabase.GenerateUniqueAssetPath(Generated + "/PhysicsGym.unity");
            EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), path);
            Selection.activeGameObject = player;
            SceneView.lastActiveSceneView?.FrameSelected();
            Debug.Log("Physics Gym created at " + path + ". Enable Input System and OpenXR with Oculus Touch Controller Profile. "
                + "Use Floor origin. Add this scene to your Build Profile. Fixed timestep is now 1/90 s. "
                + "The motor is an adaptation, not the original GorillaLocomotion runtime.");
        }

        static GymHand Hand(string name, Transform parent, Transform target, Material material,
            GymRigInput input, GymLabControls lab, Rigidbody body, int propLayer, bool isLeft)
        {
            GymHand hand = Child(name, parent).gameObject.AddComponent<GymHand>();
            GameObject visual = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            visual.name = name + " / physical visual";
            visual.transform.localScale = Vector3.one * 0.14f;
            visual.transform.position = target.position;
            Object.DestroyImmediate(visual.GetComponent<Collider>());
            visual.GetComponent<Renderer>().sharedMaterial = material;
            hand.input = input; hand.lab = lab; hand.player = body; hand.target = target;
            hand.visual = visual.transform; hand.leftHand = isLeft; hand.grabbableLayers = 1 << propLayer;
            return hand;
        }

        static Transform Child(string name, Transform parent)
        {
            var go = new GameObject(name); go.transform.SetParent(parent, false); return go.transform;
        }

        static GameObject Box(string name, Vector3 position, Vector3 scale, Material material, int layer)
        {
            GameObject box = GameObject.CreatePrimitive(PrimitiveType.Cube);
            box.name = name; box.layer = layer;
            box.transform.position = position; box.transform.localScale = scale;
            box.GetComponent<Renderer>().sharedMaterial = material;
            return box;
        }

        static GameObject Prop(string name, Vector3 position, Vector3 scale, Material material, int layer)
        {
            // Keep Rigidbody transform scale=1. Collider/mesh dimensions live on a child;
            // anchor math therefore operates in metres with no nonuniform root scaling.
            var root = new GameObject(name); root.layer = layer; root.transform.position = position;
            GameObject mesh = Box(name + " mesh", position, scale, material, layer);
            mesh.transform.SetParent(root.transform, true);
            Rigidbody body = root.AddComponent<Rigidbody>();
            body.mass = 1f; body.interpolation = RigidbodyInterpolation.Interpolate;
            body.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
            body.solverIterations = 12; body.solverVelocityIterations = 6;
            body.maxAngularVelocity = 25f;
            body.linearDamping = 0f; body.angularDamping = 0.05f;
            root.AddComponent<GymGrabbable>();
            return root;
        }

        static Material MaterialAsset(string name, Color colour)
        {
            Shader shader = Shader.Find(GraphicsSettings.currentRenderPipeline != null ? "Universal Render Pipeline/Lit" : "Standard");
            if (shader == null) shader = Shader.Find("Universal Render Pipeline/Unlit");
            if (shader == null) shader = Shader.Find("Unlit/Color");
            Material material = new Material(shader) { name = name, color = colour };
            AssetDatabase.CreateAsset(material, AssetDatabase.GenerateUniqueAssetPath(Generated + "/" + name + ".mat"));
            return material;
        }

        static TextMesh Text(string name, Vector3 position, string text, float size, Material unused)
        {
            var go = new GameObject(name); go.transform.position = position;
            TextMesh mesh = go.AddComponent<TextMesh>();
            mesh.text = text; mesh.characterSize = size; mesh.fontSize = 64;
            mesh.anchor = TextAnchor.MiddleCenter; mesh.alignment = TextAlignment.Center;
            Font font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            mesh.font = font; mesh.GetComponent<MeshRenderer>().sharedMaterial = font.material;
            mesh.color = new Color(0.82f, 0.94f, 1f);
            return mesh;
        }

        static int EnsureLayer(string name)
        {
            int existing = LayerMask.NameToLayer(name); if (existing >= 0) return existing;
            SerializedObject manager = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/TagManager.asset")[0]);
            SerializedProperty layers = manager.FindProperty("layers");
            for (int i = 8; i < 32; i++)
            {
                SerializedProperty layer = layers.GetArrayElementAtIndex(i);
                if (!string.IsNullOrEmpty(layer.stringValue)) continue;
                layer.stringValue = name; manager.ApplyModifiedProperties(); return i;
            }
            Debug.LogError("No free user layer for " + name); return -1;
        }

        static InputActionAsset CreateInputAsset()
        {
            // Serialized assets exist before player startup. No XR binding mutation at runtime.
            InputActionAsset asset = ScriptableObject.CreateInstance<InputActionAsset>();
            InputActionMap map = asset.AddActionMap("Gym");
            Add(map, "HeadPosition", "Vector3", "<XRHMD>/centerEyePosition");
            Add(map, "HeadRotation", "Quaternion", "<XRHMD>/centerEyeRotation");
            Add(map, "HeadTracked", "Button", "<XRHMD>/isTracked");
            foreach (string side in new[] { "Left", "Right" })
            {
                string prefix = "<OculusTouchController>{" + side + "Hand}/";
                Add(map, side + "Position", "Vector3", prefix + "devicePosition");
                Add(map, side + "Rotation", "Quaternion", prefix + "deviceRotation");
                Add(map, side + "Tracked", "Button", prefix + "isTracked");
                Add(map, side + "Grip", "Axis", prefix + "grip");
            }
            AddButton(map, "CycleController", "<OculusTouchController>{RightHand}/primaryButton", "<Keyboard>/c");
            AddButton(map, "ToggleFeedForward", "<OculusTouchController>{LeftHand}/primaryButton", "<Keyboard>/f");
            AddButton(map, "CycleLocomotion", "<OculusTouchController>{RightHand}/secondaryButton", "<Keyboard>/n");
            AddButton(map, "Reset", "<OculusTouchController>{LeftHand}/secondaryButton", "<Keyboard>/r");
            InputAction walk = map.AddAction("Walk", InputActionType.Value, expectedControlLayout: "Vector2");
            walk.AddCompositeBinding("2DVector").With("Up", "<Keyboard>/w").With("Down", "<Keyboard>/s")
                .With("Left", "<Keyboard>/a").With("Right", "<Keyboard>/d");
            string path = AssetDatabase.GenerateUniqueAssetPath(Generated + "/GymControls.inputactions");
            File.WriteAllText(path, asset.ToJson());
            Object.DestroyImmediate(asset);
            AssetDatabase.ImportAsset(path);
            return AssetDatabase.LoadAssetAtPath<InputActionAsset>(path);
        }

        static void Add(InputActionMap map, string name, string type, string binding)
        { map.AddAction(name, InputActionType.Value, expectedControlLayout: type).AddBinding(binding); }

        static void AddButton(InputActionMap map, string name, string xr, string keyboard)
        {
            InputAction action = map.AddAction(name, InputActionType.Button);
            action.AddBinding(xr); action.AddBinding(keyboard);
        }
    }
}
