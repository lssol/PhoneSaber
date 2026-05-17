# Motion-matching plan for PhoneSaber jedi

## Why this exists

We tried two approaches to make the Mixamo jedi wield the saber, both failed:

1. **Pure arm-IK (closed-form 2-bone)** — only the arms move, the spine/shoulders stay frozen. Looks wrong because real saber wielding involves the whole body leaning, twisting, weight-shifting. Also: no off-the-shelf full-body IK exists for three.js, so we can't easily extend the chain.
2. **Mixamo idle animation + arm IK on top** — the animation either fights the IK (combat stances bake a fight pose into the spine), or is too fidgety. Filtering the animation down to "just hips breathing" leaves nothing interesting.

The right approach is what real melee games do: **motion matching**. Build a library of natural full-body poses, then at runtime look up the pose that best matches what the user is currently doing.

The plan also exploits a fact the user identified: **the human pose manifold is low-dimensional** (~30-50 effective dims out of ~260 quaternion components). This makes both KNN lookup and a learned MLP viable.

## Pipeline overview

```
┌──────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌──────────┐
│ webcam       │───▶│ MediaPipe Pose  │───▶│ Kalidokit       │───▶│ mixamorig│
│ (MacBook cam)│    │ (33 landmarks)  │    │ (landmarks →    │    │ pose     │
└──────────────┘    └─────────────────┘    │  bone rotations)│    └──────────┘
                                            └─────────────────┘
                                                                        │
                            ┌───────────────────────────────────────────┘
                            ▼
                    ┌───────────────┐
                    │ Record mode   │     RECORDING: writes (saber pose, body pose)
                    │ (offline)     │     tuples to JSON. 5-10min of varied moves.
                    └───────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │ pose library  │
                    │ (JSON on disk)│
                    └───────────────┘
                            │
┌────────────┐              │
│ phone IMU  │     ┌────────┴────────┐    ┌───────────┐
│ + accel    │────▶│ Motion matching │───▶│ jedi pose │
│ → saber    │     │ (KNN on saber   │    │ (every    │
│   pose     │     │  pose features) │    │  bone)    │
└────────────┘     └─────────────────┘    └───────────┘
                                                │
                                                ▼
                                        ┌───────────────┐
                                        │ Refinement IK │   2-bone IK pins hands
                                        │ (arms only)   │   to exact saber position.
                                        └───────────────┘
                                                │
                                                ▼
                                        ┌───────────────┐
                                        │ Render        │   Saber re-anchored to
                                        │ (jedi + saber)│   midpoint of hands.
                                        └───────────────┘
```

**Optional phase 5**: replace KNN with a small MLP trained on the recordings. Same I/O, smoother + extrapolates to unrecorded saber positions.

## Current state of the repo (post-cleanup)

`App.tsx` has been stripped back to ~313 lines. The relevant parts:

- `JediModel` — loads `client/public/jedi.glb` (Mixamo "Knight D Pelegrini", 66 bones), clones via `SkeletonUtils.clone`, auto-scales to 1.8m, plants at `JEDI_FEET`. **Pure render, no IK, no animation.**
- `ControlledSaber` — reads `fusion.orientation` and `fusion.positionAt()`, places the saber at `(0, 1.15, 0) + fusion.position`. The original simple direct-drive setup. **Will need to switch to hand-anchored once Phase 4 lands.**
- `fusion.ts` — unchanged from `master`. Same IMU + vision fusion as before.

`client/public/`:
- `jedi.glb` (7.4MB) — the Mixamo character
- `lightsaber.glb` (1.4MB) — the saber model
- `sounds/` — hum + swing audio

All custom IK code, animation playback, animation GLB files, and the Mixamo "Sword and Shield Pack" zip have been deleted.

## Code organization: game vs dataset

Strict separation between **game runtime** (ships to users) and **dataset
tooling** (only run during development to build the pose library). They live
in different folders and the game never imports the dataset code.

```
client/src/
  App.tsx, main.tsx, scene.ts, saberModel.ts,
  saberTrail.ts, audio.ts, sensors.ts, fusion.ts,
  filter.ts, vision.ts          # ← GAME RUNTIME
  skeleton.ts                    # ← SHARED (used by both, see below)
  motionMatch.ts                 # ← GAME RUNTIME (Phase 3+)

  dataset/                       # ← DATASET TOOLING (dev-only)
    Recorder.tsx                 #     Phase 1: in-browser capture UI
    recording.ts                 #     Phase 1: data types + Recorder class
    GuidedSession.tsx            #     Phase 1: step prompts + countdown
    ReplayViewer.tsx             #     Phase 2: load a pose library, play it

scripts/
  dataset/                       # ← DATASET TOOLING (Node CLI)
    process-recording.ts         #     Phase 2: recording → pose library
    inspect-library.ts           #     Phase 2: stats/sanity on a library
```

**Rules**
- Nothing in `client/src/` (outside `dataset/`) may import from `dataset/`.
- `client/src/main.tsx` never imports `dataset/` — production bundle stays clean.
- The recorder is mounted only when a URL param (`?record=1`) or env flag is set, so a stray import doesn't accidentally ship.
- `client/src/skeleton.ts` is **shared on purpose**: the same landmark→bone
  math runs both live (game) and offline (recording → pose library). It
  has no React, no DOM, no browser-only APIs — runs fine in Node too.

`vision.ts` is game runtime, but the recorder consumes its `BodyFrame`
output via the existing callback. No import flows the other direction.

## Mixamo bone naming gotcha

Three.js's `GLTFLoader` strips colons from node names. The GLB has `mixamorig:LeftArm`, runtime has `mixamorigLeftArm` (no colon). Any code that looks up bones by name MUST use the no-colon form. This bit us once already.

## Phases

Each phase ends with something visible/runnable so we can sanity-check before continuing.

---

### Phase 0 — Bootstrap (~1 hour)

**Goal**: get Kalidokit running on the existing MediaPipe stream and confirm it produces sensible mixamorig poses.

1. `npm install kalidokit` in the `client/` workspace.
2. New file `client/src/skeleton.ts` exporting:
   ```ts
   import * as Kalidokit from 'kalidokit';
   export type MixamoPose = Map<string, THREE.Quaternion>;
   export function landmarksToMixamoPose(
     poseLandmarks: NormalizedLandmark[],
     poseWorldLandmarks: NormalizedLandmark[],
   ): MixamoPose;
   ```
3. Hook it into `JediModel`: every vision frame, call `landmarksToMixamoPose` and apply the resulting quaternions to the matching bones on the cloned skeleton (`clone.getObjectByName('mixamorigLeftArm').quaternion.copy(...)`).
4. **Verify**: Jedi mirrors your body in real time. Wave your arms, he waves. This is **just** to confirm the Kalidokit mapping works — we're not yet recording or matching.

**Watch for**:
- Mixamorig bone names with NO colon (see gotcha above).
- Kalidokit's coordinate frame vs three.js's — may need a Y-flip or mirror on input landmarks.
- The X-mirror we already apply in `fusion.ts` for the saber position may need to match here so user mirror feel is consistent.

---

### Phase 1 — Record mode (~half day)

**Goal**: capture timestamped (MediaPipe + IMU) tuples to a JSON file we can replay/process offline.

1. New file `client/src/dataset/recording.ts`:
   ```ts
   export type RecordedFrame = {
     t: number;              // ms since recording start
     pose: number[];         // 33 × (x, y, z, visibility) flat
     poseWorld: number[];    // 33 × (x, y, z) flat (world coords)
     imuQuat: [number, number, number, number];
     imuAccel: [number, number, number];  // most recent linAcc sample
   };
   export type Recording = {
     startedAt: number;       // unix ms
     fps: number;             // nominal
     frames: RecordedFrame[];
   };
   export class Recorder {
     start(): void;
     stop(): Recording;
     appendVision(landmarks, worldLandmarks): void;  // call from vision callback
     appendImu(quat, accel): void;                   // call from imu callback
     downloadAsJson(filename: string): void;
   }
   ```
2. UI lives in `client/src/dataset/Recorder.tsx` + `GuidedSession.tsx` (REC dot, step prompts, countdown). Mounted only when `?record=1` is in the URL — game build never imports it.
3. The recorder taps into the existing vision (`vision.ts`) and IMU (`sensors.ts`) streams via a small adapter set up by the recorder mount (not by `main.tsx`).
4. Sampling: don't store every frame at every rate. Store ONE recording frame per vision frame (~30Hz), grabbing the latest IMU quat/accel at that moment. Saves space.

**Output**: a `recording-YYYYMMDD-HHMMSS.json` file you download. ~10 min of recording at 30Hz × ~250 bytes/frame ≈ 4.5MB. Acceptable.

**Verify**: record a short session (30s), open the JSON, eyeball it. Frames look right? Timestamps monotonic?

---

### Phase 2 — Skeleton mapping offline (~half day)

**Goal**: process a raw recording into a "pose library" with mixamorig bone rotations already computed (so runtime doesn't re-run Kalidokit per frame).

1. New file `scripts/dataset/process-recording.ts` — node CLI that:
   - Reads a `recording-*.json`
   - For each frame, runs the **same** landmark-to-bone solver from `client/src/skeleton.ts` (shared module, no DOM deps)
   - Computes a **saber-pose-in-body-local feature vector** (see below)
   - Writes `pose-library-*.json` with:
     ```ts
     type PoseLibraryEntry = {
       feature: number[];                       // saber pose features
       bones: Record<string, [number, number, number, number]>;  // bone name → quaternion
       saberPosInBody: [number, number, number];                // for the IK refinement step
       saberQuat: [number, number, number, number];
     };
     ```
2. Run `npx tsx scripts/dataset/process-recording.ts recordings/recording-XYZ.json` → produces `pose-libraries/library-XYZ.json`.

**Feature vector for saber pose** (proposed):
- Saber position relative to shoulder midpoint, normalized by shoulder width (3 dims)
- Saber orientation as 6D rotation representation (first two columns of rot matrix, more stable than quaternions for nearest-neighbor) (6 dims)
- = 9 dims total

We can iterate on the feature — maybe add saber velocity later for smoother matching.

**Verify**: `client/src/dataset/ReplayViewer.tsx` loads a `pose-library-*.json`, applies poses to the jedi in order, plays them like a movie. Mounted via `?replay=library-XYZ.json`. Confirms our extraction pipeline produces sensible motion.

---

### Phase 3 — Motion matching at runtime (~1 day)

**Goal**: replace the static T-pose with continuously-matched recorded poses.

1. New file `client/src/motionMatch.ts`:
   ```ts
   export class MotionMatcher {
     constructor(library: PoseLibraryEntry[]);
     // Given current saber feature vector, returns blended pose.
     query(feature: number[], k: number = 4): MixamoPose;
   }
   ```
2. Implementation:
   - Brute force KNN (library is small, <30k entries — Euclidean distance over the feature vector is fast enough).
   - Weight inverse-distance, slerp the K nearest quaternions per bone.
   - Cache the last result and slerp toward the new one with a time constant (~50ms) for temporal smoothing.
3. `JediModel` consumes this:
   - Bundle a chosen `library-XYZ.json` as a static asset.
   - Each frame: compute feature from `fusion.position` + `fusion.orientation`, query matcher, apply pose to bones.
4. **Important**: when the pose is applied, the jedi's hands will be APPROXIMATELY where the saber is, but not exactly. That's what Phase 4 fixes.

**Verify**: jedi moves naturally as you wave the phone, body twists/leans, hands follow approximately. Looks like a person wielding a saber, not a T-pose with bent arms.

---

### Phase 4 — IK refinement + saber anchoring (~half day)

**Goal**: take the matched pose's "approximately correct" hand positions and snap them to the exact saber location, then anchor the rendered saber to the actual hand midpoint.

1. Bring back a stripped-down version of `solveTwoBoneIK` from `git log` (the closed-form 2-bone solver we wrote). It was working — the surrounding system was the problem.
2. After applying the matched pose:
   - Compute desired hand world positions (saber position ± hilt offset along blade axis).
   - Run 2-bone IK on left arm: shoulder → upper arm → forearm → hand → target.
   - Same for right arm.
   - Pole vectors derived from the matched pose's elbow positions (so elbows stay where the recorded pose put them).
3. Re-anchor the saber:
   - Compute midpoint of post-IK wrist positions.
   - Set saber world position = midpoint.
   - Saber rotation still from `fusion.orientation`.
4. Shared `JediAnchor` object between `JediModel` and `ControlledSaber` to communicate the midpoint per frame. (We had this before; reintroduce it.)

**Watch for**: the hand orientation accumulation bug from before. If we add hand-bone lookAt to make palms face the hilt, MUST reset hand local quat to its matched-pose value each frame BEFORE computing the world-space delta. Otherwise rotation compounds frame-over-frame.

**Verify**: as you wave the phone, the saber stays glued between the jedi's hands no matter how much his body has to twist. Body looks natural; hand placement is precise.

---

### Phase 5 — Optional: learn a small MLP (~2-3 days)

**Goal**: replace KNN with a tiny neural network that extrapolates to saber positions you didn't record and gives smoother output.

1. Use the same recordings as training data: `(feature, bones)` pairs.
2. Train in PyTorch on your laptop (CPU is fine for this size):
   - Architecture: MLP, 2 hidden layers × 256 units, ReLU.
   - Input: 9-dim feature.
   - Output: ~50 bones × 4 quaternion = 200 dims (we predict deltas from a neutral pose, then re-normalize each quaternion).
   - Loss: per-bone angular error.
   - ~10-30 min of training.
3. Export to ONNX, `npm install onnxruntime-web`, run inference in the browser.
4. Drop into `MotionMatcher.query` as an alternate backend.

**Why phase 5 is optional**: KNN with good recordings is often enough. Only do this if you see jumpy transitions, missing coverage of saber positions, or want to ship a smaller asset than the JSON library.

---

## Open questions for the next session

These don't block Phase 0/1, but are worth pinning down by Phase 3:

1. **Body-local frame for the feature**: shoulder midpoint or hips? Shoulder midpoint moves with the body more directly (probably better for matching). Hips is more stable. Try shoulder first.
2. **Calibration of jedi vs user proportions**: if the recorded user has different arm length than the rendered jedi, the matched pose's hand positions will be off. Phase 4's IK absorbs the difference. Should be OK without explicit scaling.
3. **Recording protocol**: see "Recording setup & protocol" section below.
4. **Smoothing time constant for Phase 3**: too low = jittery, too high = laggy. ~50ms is a starting point; tune by feel.
5. **Multiple libraries / personas**: could record different "styles" (defensive, aggressive, two-handed greatsword vs one-hand-saber) and let the user pick. Out of scope for v1.
6. **Phone IMU drift**: the current `fusion.ts` re-calibrates yaw via two-pose calibration. Recordings should be done AFTER calibration. Maybe save the calibration state with each recording.

## Recording setup & protocol

### Capture conditions (maximize MediaPipe quality)

**Lighting**
- Bright, diffuse, front-lit. Window light from in front is ideal. No backlight (silhouettes wreck landmarks).
- No harsh single point source — torso shadows confuse shoulder/hip landmarks.
- Consistent brightness head-to-feet. Dark legs against a lit torso = noisy lower body.

**Clothing**
- Tight-ish, contrasting with the background. Baggy clothes hide joints.
- Solid colors, not busy patterns. Short sleeves help wrist/elbow tracking.
- Avoid skin-tone clothing on skin-tone background.

**Framing & distance**
- Full body in frame, head to feet, ~10-20% margin. `worldLandmarks` is only metric when the whole skeleton is visible.
- ~2-2.5m from the MacBook webcam at 720p. Closer drops feet, further degrades wrist precision.
- Camera at chest height, not laptop-on-desk angled up. Tilted views distort hip/shoulder depth.
- Plain background. One person in frame. No mirror behind you (MediaPipe latches onto reflections).

**Procedure**
- Calibrate first (volume-down or spacebar three-press flow), THEN start recording. Don't move the laptop after.
- Save the calibration state with the recording so we can replay deterministically.

### Guided recording session

Variety in saber-pose space matters more than total time. The recorder runs as a guided session with on-screen prompts that auto-advance. Each step has a 3-2-1 countdown and an audio "ding" so you don't need to watch the screen.

| Step | Duration | Prompt | Purpose |
|---|---|---|---|
| 1 | 20s | "Ready stance — hold saber centered, breathe normally" | Idle baseline |
| 2 | 30s | "Slow horizontal swings — left to right, right to left" | Lateral coverage |
| 3 | 30s | "Slow vertical swings — overhead down, hip up" | Vertical coverage |
| 4 | 30s | "Diagonal swings — shoulder to opposite hip, both sides" | Diagonal coverage |
| 5 | 30s | "Guards — high, low, left, right (5s each)" | Static corners |
| 6 | 30s | "Reach forward, then pull back (vary depth)" | Z-axis coverage |
| 7 | 60s | "Freeform — fight an imaginary opponent, vary speed and angle" | Naturalness + transitions |

**Total: ~3.5 min** of usable library. Do all of it *slowly* on the first pass — clean landmarks beat fast ones, and the matcher will interpolate to faster speeds at runtime.

### Recording UI (Phase 1 spec)

```
┌──────────────────────────────────┐
│  REC ● 00:23 / 00:30             │
│                                  │
│  Step 3 of 7                     │
│  ▶ Slow vertical swings          │
│    overhead → hip, then back     │
│                                  │
│  [skip] [restart step] [pause]   │
└──────────────────────────────────┘
```

Each `RecordedFrame` includes a `step: number` label so we can later weight pose regions or filter the transition frames between steps. The whole script writes to one JSON; the user does one continuous take.

## Dependencies summary

- **kalidokit** (~150KB) — MediaPipe → mixamorig. Phase 0.
- **onnxruntime-web** (~10MB, only loaded if used) — neural inference. Phase 5 only.

Nothing else. Three.js / MediaPipe / Expo / fusion all stay as they are.

## What NOT to do (lessons from the previous attempts)

- Don't chase the saber with arm-only IK. The body needs to be part of the answer.
- Don't fight the animation with IK — pick one source of truth per body part (matched pose = whole body, IK = hand fine-tuning only).
- Don't accumulate rotations across frames. Always reset to a known base before applying deltas.
- Don't trust scratch-vector reuse — IK code and useFrame code stomping the same `_v1` was a real bug. Allocate per-function scratch.
- Don't blindly use Mixamo bone names with colons. `GLTFLoader` strips them. Use `mixamorigLeftArm` not `mixamorig:LeftArm`.
