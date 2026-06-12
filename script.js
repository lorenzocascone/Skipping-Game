// =============================================================
// Quiet Shore — a calm, minimalist beach scene
// =============================================================
// This file sets up a full-screen canvas, a basic game loop, and
// draws a static pastel background made of three layers:
//   sky -> mountains -> ocean (with ripples) -> sand
// Lines are drawn with a slight hand-drawn "wobble" so the scene
// feels soft and imperfect rather than mechanically precise.
// =============================================================

(function () {
  'use strict';

  // -----------------------------------------------------------
  // Palette & style constants
  // -----------------------------------------------------------
  const PALETTE = {
    sky: '#fbf5ee',
    mountainFar: '#cfd6ec',
    mountainNear: '#bcccec',
    ocean: '#bfe3ec',
    ripple: 'rgba(46, 58, 86, 0.22)',
    sand: '#f8dcc8',
    outline: '#2e3a56'
  };

  const STROKE = {
    thick: 5,   // shoreline, mountain ridges
    thin: 2     // ocean ripples
  };

  // -----------------------------------------------------------
  // Canvas setup
  // -----------------------------------------------------------
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');

  // Holds the computed pixel geometry for the current canvas size.
  // Rebuilt whenever the window is resized.
  let scene = null;

  // -----------------------------------------------------------
  // Small helpers
  // -----------------------------------------------------------

  // Deterministic pseudo-random generator (mulberry32) so the
  // hand-drawn "wobble" looks the same on every redraw/resize.
  function createRng(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Converts an array of [fractionX, fractionY] points into pixel
  // coordinates for the given canvas size.
  function toPixels(points, w, h) {
    return points.map(([fx, fy]) => [fx * w, fy * h]);
  }

  // Nudges each point by a small random amount so straight-feeling
  // lines read as slightly imperfect, hand-drawn strokes.
  function wobble(points, rng, amount) {
    return points.map(([x, y]) => [
      x + (rng() - 0.5) * amount,
      y + (rng() - 0.5) * amount
    ]);
  }

  // Traces a smooth curve through a list of points (using the
  // classic "quadratic curve through midpoints" technique) onto an
  // already-open path. Does not stroke/fill — caller decides that.
  function tracePath(ctx, points) {
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      const midX = (x0 + x1) / 2;
      const midY = (y0 + y1) / 2;
      ctx.quadraticCurveTo(x0, y0, midX, midY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last[0], last[1]);
  }

  // -----------------------------------------------------------
  // Scene layout (defined as fractions of canvas width/height)
  // -----------------------------------------------------------

  // Far mountain ridge — broad shape sitting behind everything.
  const MOUNTAIN_FAR_RIDGE = [
    [0.00, 0.46], [0.08, 0.32], [0.16, 0.38], [0.26, 0.16],
    [0.36, 0.30], [0.46, 0.20], [0.56, 0.34], [0.66, 0.46]
  ];

  // Nearer, smaller mountain peeking in from the right.
  const MOUNTAIN_NEAR_RIDGE = [
    [0.45, 0.50], [0.55, 0.34], [0.64, 0.42], [0.74, 0.24],
    [0.84, 0.38], [0.95, 0.30], [1.00, 0.40]
  ];

  // Gentle ripple lines drawn across the ocean.
  const RIPPLES = [
    [[0.00, 0.50], [0.20, 0.49], [0.40, 0.51], [0.60, 0.49], [0.80, 0.51], [1.00, 0.50]],
    [[0.00, 0.58], [0.25, 0.57], [0.50, 0.59], [0.75, 0.57], [1.00, 0.58]],
    [[0.00, 0.66], [0.20, 0.655], [0.45, 0.67], [0.70, 0.655], [1.00, 0.665]]
  ];

  // Wavy shoreline separating the ocean from the sand.
  const SHORE_LINE = [
    [0.00, 0.74], [0.15, 0.69], [0.32, 0.76], [0.50, 0.70],
    [0.68, 0.77], [0.85, 0.71], [1.00, 0.75]
  ];

  const OCEAN_TOP = 0.44; // where the ocean rectangle begins (fraction of height)
  const MOUNTAIN_BASE = 0.55; // how far down the mountain fill extends (hidden behind ocean)

  // -----------------------------------------------------------
  // Build pixel-space geometry for the current canvas size
  // -----------------------------------------------------------
  function buildScene(w, h) {
    const rng = createRng(42); // fixed seed keeps the wobble consistent

    return {
      mountainFar: wobble(toPixels(MOUNTAIN_FAR_RIDGE, w, h), rng, 6),
      mountainNear: wobble(toPixels(MOUNTAIN_NEAR_RIDGE, w, h), rng, 6),
      ripples: RIPPLES.map(line => wobble(toPixels(line, w, h), rng, 4)),
      shore: wobble(toPixels(SHORE_LINE, w, h), rng, 6),
      oceanTopY: OCEAN_TOP * h,
      mountainBaseY: MOUNTAIN_BASE * h
    };
  }

  // -----------------------------------------------------------
  // Drawing layers
  // -----------------------------------------------------------

  function drawSky(ctx, w, h) {
    ctx.fillStyle = PALETTE.sky;
    ctx.fillRect(0, 0, w, h);
  }

  // Draws one mountain ridge: a filled silhouette with a stroked
  // ridge line on top (the base is left unstroked since the ocean
  // will cover it).
  function drawMountain(ctx, ridge, fillColor, w, baseY) {
    const first = ridge[0];
    const last = ridge[ridge.length - 1];

    // Filled silhouette (ridge + straight drop to a hidden baseline)
    ctx.beginPath();
    tracePath(ctx, ridge);
    ctx.lineTo(last[0], baseY);
    ctx.lineTo(first[0], baseY);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Hand-drawn outline along just the ridge
    ctx.beginPath();
    tracePath(ctx, ridge);
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = STROKE.thick;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function drawMountains(ctx, scene, w) {
    drawMountain(ctx, scene.mountainFar, PALETTE.mountainFar, w, scene.mountainBaseY);
    drawMountain(ctx, scene.mountainNear, PALETTE.mountainNear, w, scene.mountainBaseY);
  }

  // Ocean fill plus a few soft ripple lines.
  function drawOcean(ctx, scene, w, h) {
    ctx.fillStyle = PALETTE.ocean;
    ctx.fillRect(0, scene.oceanTopY, w, h - scene.oceanTopY);

    ctx.strokeStyle = PALETTE.ripple;
    ctx.lineWidth = STROKE.thin;
    ctx.lineCap = 'round';
    scene.ripples.forEach(line => {
      ctx.beginPath();
      tracePath(ctx, line);
      ctx.stroke();
    });
  }

  // Sand fill bounded above by the wavy shoreline, with a thick
  // outline tracing that shoreline.
  function drawSand(ctx, scene, w, h) {
    const shore = scene.shore;

    ctx.beginPath();
    tracePath(ctx, shore);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = PALETTE.sand;
    ctx.fill();

    ctx.beginPath();
    tracePath(ctx, shore);
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = STROKE.thick;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // -----------------------------------------------------------
  // Render & game loop
  // -----------------------------------------------------------
  function render() {
    const w = canvas.width;
    const h = canvas.height;

    drawSky(ctx, w, h);
    drawMountains(ctx, scene, w);
    drawOcean(ctx, scene, w, h);
    drawSand(ctx, scene, w, h);
  }

  function update() {
    // Currently nothing animates — the scene is static. This is
    // where future gentle motion (drifting clouds, birds, etc.)
    // would be updated each frame.
  }

  function loop() {
    update();
    render();
    requestAnimationFrame(loop);
  }

  // -----------------------------------------------------------
  // Resize handling
  // -----------------------------------------------------------
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    scene = buildScene(canvas.width, canvas.height);
  }

  window.addEventListener('resize', resize);

  // Kick everything off
  resize();
  requestAnimationFrame(loop);
})();
