// =============================================================
// Quiet Shore — a calm, minimalist beach scene
// =============================================================
// This file sets up a full-screen canvas, a basic game loop, and
// draws a static pastel background as a side view looking down the
// coast: sand on the left, sea on the right, a big headland rising
// from the beach, and a low mountain range across the water.
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
    sand: '#f8dcc8',
    outline: '#2e3a56'
  };

  const STROKE = {
    thick: 5,   // shoreline, mountain ridges
    wave: 4     // bold sweeping wave lines on the sea
  };

  // The scene is laid out once in a fixed "design space" and then
  // uniformly scaled to COVER the real canvas (cropping whatever
  // overflows). This keeps every shape's proportions intact on any
  // screen — portrait phones included — instead of squashing them.
  const DESIGN = {
    w: 1600,
    h: 900,
    anchorX: 0.36, // keep the crop centred near the shoreline...
    anchorY: 0.55  // ...and slightly toward the water
  };

  // -----------------------------------------------------------
  // Canvas setup
  // -----------------------------------------------------------
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');

  // Pixel geometry in design space — built once, never stretched.
  let scene = null;

  // How design space maps onto the real canvas (uniform scale plus
  // an offset). Recomputed whenever the window is resized.
  let view = { scale: 1, ox: 0, oy: 0 };

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

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
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
  // Pass `connect: true` to continue from the current path position
  // instead of starting a new subpath.
  function tracePath(ctx, points, connect) {
    if (connect) {
      ctx.lineTo(points[0][0], points[0][1]);
    } else {
      ctx.moveTo(points[0][0], points[0][1]);
    }
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

  // Big headland rising from the beach on the left, like the large
  // mountain in the reference. Drawn in FRONT of the sea; its
  // lower-left base disappears behind the sand.
  const MOUNTAIN_FAR_RIDGE = [
    [-0.02, 0.60], [0.08, 0.45], [0.16, 0.47], [0.25, 0.27],
    [0.33, 0.23], [0.42, 0.31], [0.52, 0.43], [0.60, 0.48], [0.64, 0.56]
  ];

  // Smaller, lower range on the right horizon, drawn BEHIND the sea
  // so it reads as land across the water.
  const MOUNTAIN_NEAR_RIDGE = [
    [0.62, 0.54], [0.70, 0.46], [0.77, 0.49], [0.85, 0.42],
    [0.93, 0.47], [1.00, 0.49]
  ];

  // Waterline at the headland's foot — where the mountain meets the
  // sea. It continues into SHORE_LINE as one bold stroke.
  const MOUNTAIN_FOOT = [
    [0.64, 0.56], [0.54, 0.545]
  ];

  // Wavy shoreline separating the sand (left) from the sea (right),
  // sweeping diagonally down toward the bottom-left so the view
  // reads as looking along the coast, not straight out to sea.
  const SHORE_LINE = [
    [0.44, 0.50], [0.32, 0.60], [0.38, 0.70], [0.24, 0.82],
    [0.30, 0.92], [0.14, 1.00]
  ];

  // The sea's top edge, running from the right edge of the canvas to
  // just behind the headland, whose silhouette covers its left end.
  const HORIZON = [
    [1.02, 0.503], [0.86, 0.508], [0.72, 0.504], [0.58, 0.515]
  ];

  // Soft upper boundary of the sand where it meets the headland's
  // base (right to left). Unstroked — just a gentle colour edge. It
  // rises gently toward the left edge, staying above the sea's top
  // so no strip of water peeks out behind the beach.
  const SAND_TOP = [
    [0.44, 0.50], [0.28, 0.488], [0.12, 0.476], [-0.02, 0.468]
  ];

  // Bold wave lines lapping at the beach: each one echoes the
  // shoreline's diagonal sweep, running top-to-bottom progressively
  // further out in the water, like ripples rolling toward the sand.
  const RIPPLES = [
    [[0.52, 0.56], [0.42, 0.64], [0.47, 0.73], [0.34, 0.84], [0.39, 0.93], [0.26, 1.00]],
    [[0.62, 0.60], [0.54, 0.68], [0.58, 0.76], [0.47, 0.86], [0.51, 0.94], [0.40, 1.00]],
    [[0.74, 0.62], [0.66, 0.70], [0.70, 0.78], [0.60, 0.88], [0.64, 0.96], [0.55, 1.00]],
    [[0.88, 0.64], [0.80, 0.72], [0.84, 0.80], [0.76, 0.90], [0.79, 1.00]]
  ];

  const OCEAN_TOP = 0.50;          // where the sea begins (fraction of height)
  const MOUNTAIN_NEAR_BASE = 0.55; // right range's hidden baseline (behind the sea)
  const SAND_OVERLAP = 0.025;      // how far the headland tucks under the sand

  // -----------------------------------------------------------
  // Build pixel-space geometry for the current canvas size
  // -----------------------------------------------------------
  function buildScene(w, h) {
    const rng = createRng(42); // fixed seed keeps the wobble consistent

    // The foot + shoreline form one continuous bold waterline stroke.
    const waterline = wobble(
      toPixels(MOUNTAIN_FOOT.concat(SHORE_LINE), w, h), rng, 6
    );
    const mountainFar = wobble(toPixels(MOUNTAIN_FAR_RIDGE, w, h), rng, 6);

    // The waterline starts exactly where the ridge stroke ends, so
    // the two strokes join without a visible blob at the tip.
    waterline[0] = mountainFar[mountainFar.length - 1];

    // The sand's top edge starts exactly at the shoreline's first
    // point, so the three shapes meeting there close without gaps.
    const sandTop = wobble(toPixels(SAND_TOP, w, h), rng, 5);
    sandTop[0] = waterline[MOUNTAIN_FOOT.length];

    return {
      mountainFar: mountainFar,
      mountainNear: wobble(toPixels(MOUNTAIN_NEAR_RIDGE, w, h), rng, 6),
      waterline: waterline,
      horizon: wobble(toPixels(HORIZON, w, h), rng, 4),
      // The shoreline reuses the waterline's wobbled coordinates so
      // the sand fill and the stroke share an identical boundary.
      shore: waterline.slice(MOUNTAIN_FOOT.length),
      sandTop: sandTop,
      ripples: RIPPLES.map(line => wobble(toPixels(line, w, h), rng, 5)),
      oceanTopY: OCEAN_TOP * h,
      mountainNearBaseY: MOUNTAIN_NEAR_BASE * h,
      sandOverlap: SAND_OVERLAP * h
    };
  }

  // -----------------------------------------------------------
  // Drawing layers
  // -----------------------------------------------------------

  function drawSky(ctx, w, h) {
    ctx.fillStyle = PALETTE.sky;
    ctx.fillRect(0, 0, w, h);
  }

  function strokeOutline(ctx, width) {
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // The distant range: a filled silhouette dropping to a baseline
  // hidden behind the sea, with a stroked ridge line on top.
  function drawMountainNear(ctx, scene) {
    const ridge = scene.mountainNear;
    const first = ridge[0];
    const last = ridge[ridge.length - 1];

    ctx.beginPath();
    tracePath(ctx, ridge);
    ctx.lineTo(last[0], scene.mountainNearBaseY);
    ctx.lineTo(first[0], scene.mountainNearBaseY);
    ctx.closePath();
    ctx.fillStyle = PALETTE.mountainNear;
    ctx.fill();

    ctx.beginPath();
    tracePath(ctx, ridge);
    strokeOutline(ctx, STROKE.thick);
  }

  // Sea fill plus its top-edge line and bold sweeping wave lines.
  function drawOcean(ctx, scene, w, h) {
    ctx.fillStyle = PALETTE.ocean;
    ctx.fillRect(0, scene.oceanTopY, w, h - scene.oceanTopY);

    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = STROKE.wave;
    ctx.lineCap = 'round';

    ctx.beginPath();
    tracePath(ctx, scene.horizon);
    ctx.stroke();

    scene.ripples.forEach(line => {
      ctx.beginPath();
      tracePath(ctx, line);
      ctx.stroke();
    });
  }

  // The big headland: its closed silhouette runs over the ridge,
  // down the waterline at its foot, then back along the sand's top
  // edge (pushed down slightly so the sand fill overlaps it and no
  // seam shows). Only the ridge is stroked.
  function drawMountainFar(ctx, scene) {
    const ridge = scene.mountainFar;
    const foot = scene.waterline.slice(0, MOUNTAIN_FOOT.length + 1);

    ctx.beginPath();
    tracePath(ctx, ridge);
    tracePath(ctx, foot, true);
    // Sand top, right to left, tucked under the future sand fill.
    // The first point stays exactly on the shoreline corner so no
    // sliver of the silhouette pokes out into the water there.
    scene.sandTop.forEach(([x, y], i) => {
      ctx.lineTo(x, i === 0 ? y : y + scene.sandOverlap);
    });
    ctx.closePath();
    ctx.fillStyle = PALETTE.mountainFar;
    ctx.fill();

    ctx.beginPath();
    tracePath(ctx, ridge);
    strokeOutline(ctx, STROKE.thick);
  }

  // Sand fill on the left: bounded by the shoreline on the right and
  // its soft top edge against the headland. Unstroked here — the
  // waterline stroke is drawn on top afterwards.
  function drawSand(ctx, scene, h) {
    const shore = scene.shore;
    const sandTop = scene.sandTop;
    const topLeft = sandTop[sandTop.length - 1];

    ctx.beginPath();
    tracePath(ctx, shore);
    ctx.lineTo(0, h);
    ctx.lineTo(topLeft[0], topLeft[1]);
    // Sand top, left to right, back up to the shoreline start
    for (let i = sandTop.length - 2; i >= 0; i--) {
      ctx.lineTo(sandTop[i][0], sandTop[i][1]);
    }
    ctx.closePath();
    ctx.fillStyle = PALETTE.sand;
    ctx.fill();
  }

  // The bold line from the headland's foot down along the shoreline.
  // Stroked in two segments that share the shore's first point: the
  // smoothing in tracePath cuts intermediate corners, and a single
  // stroke would drift off the sand fill's edge right there.
  function drawWaterline(ctx, scene) {
    const split = MOUNTAIN_FOOT.length;

    ctx.beginPath();
    tracePath(ctx, scene.waterline.slice(0, split + 1));
    strokeOutline(ctx, STROKE.thick);

    ctx.beginPath();
    tracePath(ctx, scene.waterline.slice(split));
    strokeOutline(ctx, STROKE.thick);
  }

  // -----------------------------------------------------------
  // Render & game loop
  // -----------------------------------------------------------

  // Layer order matters: the distant range sits behind the sea, the
  // headland sits in front of it, the sand covers the headland's
  // lower-left base, and the waterline stroke goes on top of it all.
  function render() {
    const w = DESIGN.w;
    const h = DESIGN.h;

    // Map design space onto the canvas: uniform scale, no stretching.
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);

    drawSky(ctx, w, h);
    drawMountainNear(ctx, scene);
    drawOcean(ctx, scene, w, h);
    drawMountainFar(ctx, scene);
    drawSand(ctx, scene, h);
    drawWaterline(ctx, scene);
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

  // Scale design space up until it covers the whole canvas, then
  // crop the overflow, keeping the view anchored near the shoreline
  // so the interesting part of the scene stays on screen.
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const scale = Math.max(canvas.width / DESIGN.w, canvas.height / DESIGN.h);
    const visibleW = canvas.width / scale;
    const visibleH = canvas.height / scale;
    const left = clamp(DESIGN.anchorX * DESIGN.w - visibleW / 2, 0, DESIGN.w - visibleW);
    const top = clamp(DESIGN.anchorY * DESIGN.h - visibleH / 2, 0, DESIGN.h - visibleH);

    view = { scale: scale, ox: -left * scale, oy: -top * scale };
  }

  window.addEventListener('resize', resize);

  // Kick everything off
  scene = buildScene(DESIGN.w, DESIGN.h);
  resize();
  requestAnimationFrame(loop);
})();
