# Slice Club

A new HTML, CSS, and JavaScript fruit-slicing web game inspired by your team's idea. Your teammate's Python files remain untouched.

## Play locally

Install Node.js if needed, then open this folder in a terminal and run `npm start`. Open **http://localhost:4173** in Chrome or Edge. No package installation is needed. Use a localhost or HTTPS URL for camera access; opening index.html directly will not work.

Choose **Play with your hand**, allow your camera, and raise one hand in good light. The skeleton is mirrored like a mirror; the glowing circle on the index finger is the blade. Swipe to slice. The game waits for a tracked hand before starting. If your hand disappears during a round, the blade is cleared immediately and the game pauses after a short grace period.

Mouse and touch: hold and drag to slice, then release to move past a bomb. Space pauses/resumes, M toggles sound, and Escape pauses. Fullscreen is available when supported by the browser.

## Rules

- Arcade: 60 seconds; fruit +10; bombs −30, with a score floor of zero.
- Slice fruit less than 0.48 seconds apart to chain them. Starting with the third fruit, each fruit awards an extra 5 points per combo step, up to 25 extra points.
- Missed fruit and bombs break the chain. Missed fruit do not deduct points.
- Zen: 90 seconds with no bombs.
- High scores are stored on this device, separately for each mode. Camera video is processed on the device; it is not recorded or uploaded.

## Implementation and checks

The Canvas game engine uses elapsed time and physics substeps. Continuous segment-to-circle collision catches fast swipes. MediaPipe runs in a dedicated worker with one frame in flight; it tries GPU inference and falls back to CPU. The fingertip uses adaptive smoothing, stale-frame rejection, and a fresh trail on reacquisition. Camera setup can be cancelled by choosing pointer mode, with late streams stopped safely. Leaving the page or round stops the camera. Switching tabs or resizing the arena pauses play.

Run `npm test` for game and camera-lifecycle regressions and `npm run check` for JavaScript and local asset validation. Automated checks do not establish real webcam accuracy or replace hands-on testing on the event computer.

MediaPipe Tasks Vision **1.0.1** is bundled locally under `dist/vendor/`; the compatible hand-landmarker model was copied from the supplied reference folder. The interface fonts have system fallbacks, so optional Google Fonts loading does not block play. Original menu art was created with ImageGen. Game fruit use the operating system's color emoji artwork.

Google's official [Hand Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js) documents the detection API and using workers to keep inference separate from rendering. [MediaPipe](https://github.com/google-ai-edge/mediapipe) is licensed under Apache 2.0. See THIRD_PARTY_NOTICES.md.

## Files

- `dist/index.html` and `dist/styles.css`: interface and responsive styling.
- `dist/game.js`: rendering, sound, menus, and controls.
- `dist/core.js`: physics, scoring, collision detection, and filtering.
- `dist/hand.js` and `dist/hand-worker.js`: camera lifecycle and MediaPipe detection.
- `server.mjs`: local static server, bound to this computer only.

Deploy the contents of `dist` on any static HTTPS host. All game and camera assets are included; no API key or backend is required.
