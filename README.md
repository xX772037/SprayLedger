# Aurora Field Lab

A real-time aurora simulator in a single HTML file: no build step, no dependencies. Open `index.html` in any browser with WebGL.

## What it does

- **Ray-traced curtains.** Each auroral curtain is a vertical sheet whose footprint is a folding noise curve. For every pixel, the fragment shader solves where the view ray crosses each sheet (damped fixed-point iteration). It then shades the hit by its true altitude, with Earth's curvature included.
- **Physically motivated color.** Emission is split by altitude into the three main auroral lines: 557.7 nm oxygen green (100–200 km), 630.0 nm oxygen red (200–400 km), and the 427.8 nm N₂⁺ violet lower border.
- **Optical path brightening.** Curtains get brighter when seen edge-on (path ∝ 1/|n·d|), so rays converge into a corona at zenith during strong storms.
- **Driven by space weather.** The planetary K-index (Kp, shown in thirds: 5−, 5o, 5+) moves the auroral oval toward the observer, adds and folds curtains, and switches on red emission. The panel shows the NOAA G-scale storm level. Solar wind speed sets the pace of the motion.
- **Scene.** Procedural mountains, a twinkling starfield, the Milky Way, and a lake with Fresnel reflection and ripples.
- **Adaptive resolution** keeps the frame rate up on slow GPUs. Respects `prefers-reduced-motion`.

## Controls

Drag (or use the arrow keys) to look around. Scroll to zoom. Space pauses.
