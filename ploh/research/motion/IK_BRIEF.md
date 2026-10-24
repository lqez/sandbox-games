# Foot placement / leg IK brief (from primary sources)

Scope: mocap locomotion clips (idle, run, guarded fwd/back, strafe L/R) driven by game code at arbitrary speed and direction; Godot 4. Goal: no foot slide, no 20 m/s foot whips, no crossed legs on strafe, no stretched knees.

## 1. Offline stance/swing detection per foot (Johansen ch. 4)

- Sample heel and toe positions over the cycle (clip treated as walking on the spot). Do not use plain height-gradient sign changes (Meredith & Maddock's "gradient flip within 10% of min height"): Johansen found it fragile on flat stance segments; use curvature plus speed deviation, on both heel and toe.
- Movement axis: project mean(heel,toe) to ground; c = centroid, a = point farthest from c, b = point farthest from a; axis = b - a.
- Stance time = sample minimizing `cost = max(heelH, toeH)/A + |swing offset from mid-swing|/B` (A = max heel/toe height observed, B scaled to swing amplitude). This is the "most firmly and neutrally planted" frame and is the reference pose for footprints.
- Keytimes, tracking forward from stance time: heel-off / toe-off = time of max curvature of the heel / toe height curve before it crosses a height threshold; linear-speed-end = last sample where the footbase still moves at the constant stance speed. Then `foot-lift = min(heel-off, toe-off, linear-speed-end)`, `foot-off = max(heel-off, toe-off)`, `post-foot-lift = max(foot-lift + 0.2, foot-off)` (0.2 of a cycle = minimum foot-roll). Mirror backward from stance for foot-land / foot-strike / pre-foot-land.
- Footbase: a foot-length segment parallel to the ground; pivot end chosen by `balance = atan(((heelH - toeH)/footLen) * 20)/pi + 0.5` (0 = heel down, 1 = toe down).
- Stride = footbase(foot-off) - footbase(foot-strike); clip speed = mean stride length / cycle duration; direction = negative of that vector. Prerequisite: planted feet move at constant velocity = -body velocity in the source clip (clean footskate before analysis).
- Store each foot's trajectory normalized: subtract a reference moving at clip velocity, rotate stride to +Z, scale so it runs (0,0,0) -> (0,0,1). Per leg define `legCycleTime = cyclic(motionCycleTime - stanceTime)`, `strideTime` (0 at foot-lift, 1 at foot-land), `flightTime` (0 at foot-off, 1 at foot-strike). Typical foot-off is at legCycleTime ~0.25.
- UE equivalent at runtime (Foot Placement node): planted when the foot's FK speed < `SpeedThreshold` (speed from a per-foot animation curve or from root-motion attribute), fully aligned within `DistanceToGround` of the plane, fully unplanted above `UnalignmentSpeedThreshold`; that gives a continuous 0..1 plant alpha between two speed thresholds. Numeric defaults live in `AnimNode_FootPlacement.h` (not publicly readable; the docs expose names only).

## 2. Lock during stance; release without snapping

- Johansen: each foot owns two footprints. `prev` is frozen once assigned; `next` is a prediction updated every frame until foot-strike. In stance the foot is constrained to `prev` via IK; its alignment is ground-based (flat on the hit surface) in the stance phase, ankle-local-rotation-based in flight, linearly blended during the foot-roll phases (hence the enforced >= 0.2-cycle roll). Never a snap because the foot leaves `prev` along the warped trajectory, not toward "the animation foot".
- Forsyth (How To Walk, 2004; the thesis's stated inspiration): compute the delta (heel position + orientation, character space) between the animated foot and (a) the last footprint, (b) the predicted next footprint. Apply with a strength 0..1 known a priori from the cycle: planted = 1 to last footprint; first half of swing fades last-footprint delta 1 -> 0; second half fades next-footprint delta 0 -> 1. "Cannot make legs longer! (hyperextension)" - only shorten by bending.
- UE Foot Placement: the lock is released when deviation exceeds `UnplantRadius` (linear) or `UnplantAngle` (degrees) and may re-plant below `ReplantRadiusRatio * UnplantRadius` / `ReplantAngleRatio * UnplantAngle` (hysteresis). `MaxOffsetHorizontal` caps how far planted feet may be pulled before "the planted feet roll first, then slide" rather than yanking the hips. All offsets go through a spring (`LinearStiffness`, `LinearDamping`).
- No source gives a max foot velocity; they avoid the problem structurally: the only thing that moves fast is the *prediction* of `next`, and Johansen smooths that with a filter whose strength increases as footfall approaches. Your 20 m/s whip is a re-plant on release; replace it with the fade above.

## 3. Landing prediction and swing warping (Johansen 7.2-7.3, Forsyth)

- `nextFootprintTime = t + cycleDuration * (1 - legCycleTime)`; predicted body pose = pos + v*dt (later versions add rotational velocity along a circular arc); `nextFootprint = predictedBodyPose * stancePosition` (stance pose, not strike pose, is the reference so balance is truest when the leg bears weight). Ground it with two downward raycasts (heel, toe) with slope/validity checks. Forsyth does the same by sampling the clip at the future foot-down time, using current strafe and turn input.
- Position is warped, not time: `footbase = Lerp(prev, next, normalizedTrajectory(legCycleTime).z)`, so the original acceleration profile of the foot is kept at any stride length.
- Anti-crossing term: `offset = stancePosInWorld - Lerp(prev, next, legCycleTime)` added with weight `sin(normalizedZ * pi)`. It is zero at constant velocity and forces the swing through its natural mid-flight position when turning or strafing; "as long as the blended motion prior to adjustments is intersection free, the motion after adjustments is also very likely to be free of intersections" (fig. 7.2 shows the outer leg clearing the inner one). Letting the raw clip drive mid-swing instead produces artifacts on sideways motion (fig. 7.4a) - do not do that.
- Lift: sine arc of magnitude `2*hmax/pi` over the higher of the two footprint tangent planes; also lift a swing foot to the supporting-ground height (weighted by `(cos(2*pi*legCycleTime)+1)/2 + eps`) so it never drags the pelvis down. Finally add the clip's own sideways (x) and vertical (y) normalized components.
- Over-stride limits: Johansen parks a leg at its stance time when the next step length drops below a threshold and unparks when it exceeds another, so idle/stop never produces micro-steps. UE clamps via `MaxExtensionRatio`/`MinExtensionRatio` and stride-warping `Stride Scale` min/max, and enforces `SeparatingDistance` (minimum distance of each foot from the midline plane) against crossing.

## 4. Body speed != clip speed; directional blending

- Forsyth: measure each cycle's m/s offline; for the target speed pick the two nearest clips, compute for each the frequency (cycles/s) that yields the target speed, lerp the frequencies into one global rate, lerp weights, and keep every clip in phase ("won't blend correctly unless all anims in phase"). Blend space is sparse 4D (linear speed, turn, accel/decel, gait); turn/accel leans are heavily damped, actual rotation is not.
- Johansen: weights come from the 2D velocity vector (fwd/back, side) via gradient-band interpolation inside an animation group; clips are cycle-aligned by their stance times offline; trajectory lookups are time-warped per leg (keytimes stance, foot-off, foot-strike, stance). Residual slide is removed by the footprints, which come from actual body velocity, so playback rate need not match exactly.
- Rosen (GDC 2014): a "surveyor wheel" converts distance travelled into cycle phase, so "no matter how fast or slow he's moving he never floats"; walk and run have different wheel sizes (stride) and a synchronized blend interpolates both pose and stride size. Only pass and reach poses per gait (13 keyframes total), cubic interpolation for velocity continuity, spring-damper (stiffness, damping) for pose transitions and landing squash.
- Epic/Lyra: Distance Matching (play-rate) during starts/stops, blended into Stride Warping (`Stride Scale = locomotion speed / root-motion speed`, with min/max clamps and separate increasing/decreasing interp speeds) once in steady gait; Orientation Warping rotates the leg IK bones toward the velocity direction and counter-twists the spine so 4 cardinal strafe clips cover 360 degrees (`Location Angle Delta Threshold` default 90 degrees).
- Strafe without crossing: blend real strafe clips by 2D velocity (never a rotated forward clip), keep stance-time alignment across clips, route swings through the mid-flight offset above, and add a separating-plane minimum.

## 5. Pelvis rule that never over-extends (Johansen 7.4.2)

Per leg, intersect a vertical line through the original hip with two spheres centered on the new ankle: radius = original hip-ankle distance gives `hDesired`; radius = full leg length gives `hMax` (both as offsets from the animated hip). Then
`hipOffset = hDesiredMin + (mintoavg * mintomax) / (mintoavg + mintomax)` with `mintoavg = hDesiredAvg - hDesiredMin`, `mintomax = hMaxMin - hDesiredMin`.
It is always below `hMaxMin` (no hyperextension), has no discontinuity when terms cross, and prefers extra bend over extra stretch. Kovar's "pelvis just reachable at full extension" is explicitly rejected as stiff. No horizontal pelvis motion. Forsyth: hips at least as low as the lowest foot; in swing use a virtual foot height lerped from last to next footprint. UE: `PelvisHeightMode` AllLegs / AllPlantedFeet / front-planted-on-slopes, `MaxOffset` (vertical cap), `HeelLiftRatio` 0..1 (lift heel before dropping hips), `HorizontalRebalancingWeight` 0..1, spring interpolation recommended when the planted leg swaps.

## 6. IK and knee pole

Johansen: IK is a black box that must (a) solve from the unadjusted blended pose every frame with no history, (b) stay as close as possible to that pose, (c) map similar inputs to similar outputs. Analytic two-bone for humans, run twice per frame (second pass after re-applying the clip's ankle local rotation in flight). Knee plane therefore comes from the original pose's knee direction, not a fixed pole. FABRIK (Aristidou & Lasenby 2011) wins on long or multi-effector chains (about 0.86 ms/iteration vs CCD 4.69 in their Matlab table; ~15 iterations to a reachable target), but a two-bone leg has an exact closed form in one step; FABRIK is not needed here. UE adds "Compensate IK using FK thigh rotation" and "Clamp IK using FK limits".

## 7. Constants the sources actually give

Min foot-roll 0.2 cycle; balance sensitivity 20; two raycasts per foot; footprint smoothing increasing toward footfall; mid-flight weight `sin(z*pi)`; lift arc `2*hmax/pi`; Forsyth 3 gaits (slow/med/fast) each one cycle starting mid-stride left foot down; Rosen 2 locomotion poses per gait, bounce amplitude scaling with 1/f^2; UE orientation threshold 90 degrees, stride scale base 1. UE Foot Placement defaults and the Unity Locomotion System tuning values are not in any readable public document.

## Rules to implement (by impact)

1. Drive step phase from body motion (distance-based phase or speed-matched frequency with all clips in phase); blend stride length between clips; never let clip time run free.
2. Per foot keep `prev` (frozen) and `next` (predicted at stance time from body velocity + turn rate, raycast heel+toe, smoothed harder as footfall nears).
3. Swing = `Lerp(prev, next, normalizedZ)` + `sin(z*pi)`-weighted offset to the natural stance position + lift arc + the clip's own x/y. This is what removes both crossing and whipping.
4. Release by strength fade (planted 1; first half of swing fade old footprint out; second half fade new one in). Never re-plant or teleport a locked foot; use unplant/replant hysteresis only as a safety valve.
5. Pelvis height from the hDesired/hMax sphere formula; always below hMaxMin; lift swing feet to supporting-ground height.
6. Foot alignment: ground-flat in stance, ankle-local in flight, blend over >= 0.2 cycle.
7. Analytic two-bone IK from the unadjusted pose each frame, knee plane from that pose, bones never scaled; if still unreachable the pelvis rule was violated, not the IK.
8. Strafe from real strafe clips in a 2D velocity blend with stance-time alignment, plus a separating-plane minimum distance.
9. Park/unpark leg cycles at stance time on step-length thresholds for stop/start.
10. Smooth only inputs (footprints, pelvis via spring); keep the solver stateless.

## Sources read

- Johansen, thesis PDF (ch. 4, 5, 7): https://runevision.com/thesis/rune_skovbo_johansen_thesis.pdf
- Rosen, GDC 2014 talk (full captions): https://www.youtube.com/watch?v=LNidsMesxSE
- Forsyth, How To Walk (GameTech 2004) slides: https://tomforsyth1000.github.io/papers/how_to_walk.ppt.zip
- Aristidou & Lasenby, FABRIK: https://www.andreasaristidou.com/publications/papers/FABRIK.pdf
- Epic API: https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/AnimationWarpingRuntime/FFootPlacementPlantSettings , .../FFootPlacementPelvisSettings , .../FAnimNode_FootPlacement
- Epic Pose Warping: https://dev.epicgames.com/documentation/en-us/unreal-engine/pose-warping-in-unreal-engine ; Lyra animation: https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-in-lyra-sample-game-in-unreal-engine
- Bereznyak, IK Rig: only the 80.lv interview https://80.lv/articles/how-ubisoft-revolutionises-animation-in-games and the GDC session text were readable (runtime per-frame "IK Rig rules" feed effector targets to full-body IK; no foot-lock detail published). GDC Vault was in maintenance; the 1.2 GB slide deck was not fetched.
- Naughty Dog / Guerrilla: no public foot-IK slides found. Closest is Ubisoft's GDC 2016 "Fitting the World: A Biomechanical Approach to Foot IK" (Roche, Torres-Cros; predictive rather than reactive foot IK for Assassin's Creed), Vault-only.
