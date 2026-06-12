// =============================================================
// Quiet Shore — a calm, minimalist beach scene
// =============================================================
// This file sets up a full-screen canvas, a basic game loop, and
// draws a pastel background as a side view looking down the
// coast: sand on the left, sea on the right, a big headland rising
// from the beach, and a low mountain range across the water. The
// sea's wave lines drift slowly toward the shore and back out again.
// Lines are drawn with a hand-drawn "wobble" so the scene feels
// soft and imperfect rather than mechanically precise.
//
// The scene lives in a fixed design space that is uniformly scaled
// onto the screen, and the player can pan (drag) and zoom (wheel /
// pinch) a little to adjust the view to taste.
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
    outline: '#2e3a56',
    texture: 'rgba(46, 58, 86, 0.55)'
  };

  const STROKE = {
    thick: 5,    // shoreline, mountain ridges
    wave: 4,     // bold sweeping wave lines on the sea
    texture: 2.5 // subtle contour marks on the mountain faces
  };

  // Slow, rhythmic motion for the ripple lines: each one drifts a
  // little toward the shore and back out to sea, with the lines
  // behind it following after a short delay so the waves appear to
  // lap in sequence. `dir` points from open water toward the sand,
  // matching the ripples' diagonal layout.
  const WAVE = {
    period: 6,         // seconds for one full lap-and-recede cycle
    amplitude: 14,     // how far a ripple drifts along `dir`, in design px
    phaseStep: 0.55,   // phase delay between successive ripple lines
    dir: [-0.997, -0.078]
  };

  // The scene is laid out once in a fixed "design space" and then
  // uniformly scaled to COVER the real canvas (cropping whatever
  // overflows). This keeps every shape's proportions intact on any
  // screen — portrait phones included — instead of squashing them.
  // The margins are extra painted area around the design rectangle
  // so panning/zooming out never reveals blank canvas.
  const DESIGN = {
    w: 1600,
    h: 900,
    anchorX: 0.36,    // initial view centred near the shoreline...
    anchorY: 0.55,    // ...and slightly toward the water
    marginX: 360,
    marginTop: 360,
    marginBottom: 200
  };

  // How far the player can zoom relative to the base "cover" scale.
  const ZOOM = { min: 0.75, max: 1.6 };

  // -----------------------------------------------------------
  // Canvas setup
  // -----------------------------------------------------------
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');

  // Pixel geometry in design space — built once, never stretched.
  let scene = null;

  // Camera: a zoom factor (relative to the cover scale) and a centre
  // point in design coordinates. baseScale is recomputed on resize.
  let baseScale = 1;
  const cam = {
    zoom: 1,
    cx: DESIGN.anchorX * DESIGN.w,
    cy: DESIGN.anchorY * DESIGN.h
  };

  // Animation clock, advanced each frame by the real elapsed time so
  // the wave motion stays consistent regardless of frame rate.
  let elapsed = 0;
  let lastTimestamp = null;

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

  // Inserts a midpoint between every pair of points. Wobbling the
  // densified line afterwards gives a higher-frequency, more
  // naturally hand-drawn jitter than wobbling sparse points alone.
  function subdivide(points) {
    const out = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      out.push([(x0 + x1) / 2, (y0 + y1) / 2], [x1, y1]);
    }
    return out;
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
  // Scene layout (defined as fractions of the design space; values
  // outside 0..1 extend into the pan/zoom margins)
  // -----------------------------------------------------------

  // Big headland rising from the beach on the left, like the large
  // mountain in the reference. Drawn in FRONT of the sea; its
  // lower-left base disappears behind the sand, with low foothills
  // rolling off into the margin so zooming out still looks natural.
  const MOUNTAIN_FAR_RIDGE = [
    [-0.24, 0.55], [-0.14, 0.47], [-0.05, 0.50], [0.06, 0.44],
    [0.16, 0.465], [0.25, 0.27], [0.33, 0.23], [0.42, 0.31],
    [0.52, 0.43], [0.60, 0.48], [0.64, 0.56]
  ];

  // Smaller, lower range on the right horizon, drawn BEHIND the sea
  // so it reads as land across the water.
  const MOUNTAIN_NEAR_RIDGE = [
    [0.62, 0.54], [0.70, 0.46], [0.77, 0.49], [0.85, 0.42],
    [0.93, 0.47], [1.02, 0.45], [1.12, 0.49], [1.24, 0.46]
  ];

  // Short contour marks scattered on the mountain faces — the small
  // hand-drawn dashes that hint at ridges and texture.
  const FAR_TEXTURE = [
    [[0.21, 0.40], [0.25, 0.38], [0.28, 0.40]],
    [[0.30, 0.33], [0.34, 0.31]],
    [[0.36, 0.34], [0.41, 0.37]],
    [[0.27, 0.46], [0.33, 0.44], [0.37, 0.46]],
    [[0.45, 0.42], [0.50, 0.455]],
    [[0.11, 0.50], [0.16, 0.485]]
  ];

  const NEAR_TEXTURE = [
    [[0.83, 0.46], [0.87, 0.455]],
    [[0.91, 0.475], [0.945, 0.468]]
  ];

  // Waterline at the headland's foot — where the mountain meets the
  // sea. It continues into SHORE_LINE as one bold coast.
  const MOUNTAIN_FOOT = [
    [0.64, 0.56], [0.54, 0.545]
  ];

  // Wavy shoreline separating the sand (left) from the sea (right),
  // sweeping diagonally down past the bottom edge into the margin.
  const SHORE_LINE = [
    [0.44, 0.50], [0.32, 0.60], [0.38, 0.70], [0.24, 0.82],
    [0.30, 0.92], [0.14, 1.02], [0.20, 1.12], [0.08, 1.22]
  ];

  // The boundary where the headland's base meets the sand — a
  // meandering, outlined edge rather than a straight cutoff.
  const SAND_TOP = [
    [0.44, 0.50], [0.36, 0.515], [0.28, 0.492], [0.19, 0.503],
    [0.10, 0.477], [0.02, 0.49], [-0.10, 0.468], [-0.24, 0.475]
  ];

  // The sea's top edge, running from the right margin to just behind
  // the headland, whose silhouette covers its left end.
  const HORIZON = [
    [1.26, 0.502], [1.10, 0.506], [0.94, 0.503], [0.78, 0.508], [0.58, 0.515]
  ];

  // Bold wave lines lapping at the beach: each one echoes the
  // shoreline's diagonal sweep, running top-to-bottom progressively
  // further out in the water, like ripples rolling toward the sand.
  const RIPPLES = [
    [[0.52, 0.56], [0.42, 0.64], [0.47, 0.73], [0.34, 0.84], [0.39, 0.93], [0.26, 1.04], [0.32, 1.13], [0.24, 1.20]],
    [[0.62, 0.60], [0.54, 0.68], [0.58, 0.76], [0.47, 0.86], [0.51, 0.94], [0.40, 1.04], [0.46, 1.13], [0.38, 1.20]],
    [[0.74, 0.62], [0.66, 0.70], [0.70, 0.78], [0.60, 0.88], [0.64, 0.96], [0.55, 1.06], [0.60, 1.14], [0.53, 1.20]],
    [[0.88, 0.64], [0.80, 0.72], [0.84, 0.80], [0.76, 0.90], [0.79, 1.00], [0.74, 1.10], [0.78, 1.20]]
  ];

  const OCEAN_TOP = 0.50;          // where the sea begins (fraction of height)
  const MOUNTAIN_NEAR_BASE = 0.55; // right range's hidden baseline (behind the sea)
  const SAND_OVERLAP = 0.025;      // how far the headland tucks under the sand

  // -----------------------------------------------------------
  // Build pixel-space geometry for the design space
  // -----------------------------------------------------------
  function buildScene(w, h) {
    const rng = createRng(42); // fixed seed keeps the wobble consistent

    // The foot + shoreline form one continuous bold waterline.
    const waterline = wobble(
      toPixels(MOUNTAIN_FOOT.concat(SHORE_LINE), w, h), rng, 6
    );

    // Ridges are subdivided before wobbling so the jitter has both
    // large slow undulations and finer hand-drawn roughness.
    const mountainFar = wobble(
      subdivide(toPixels(MOUNTAIN_FAR_RIDGE, w, h)), rng, 10
    );
    const mountainNear = wobble(
      subdivide(toPixels(MOUNTAIN_NEAR_RIDGE, w, h)), rng, 10
    );

    // The waterline starts exactly where the ridge stroke ends, so
    // the two strokes join without a visible blob at the tip.
    waterline[0] = mountainFar[mountainFar.length - 1];

    // The sand's top edge starts exactly at the shoreline's first
    // point, so the three shapes meeting there close without gaps.
    const sandTop = wobble(subdivide(toPixels(SAND_TOP, w, h)), rng, 8);
    sandTop[0] = waterline[MOUNTAIN_FOOT.length];

    return {
      mountainFar: mountainFar,
      mountainNear: mountainNear,
      farTexture: FAR_TEXTURE.map(line => wobble(toPixels(line, w, h), rng, 5)),
      nearTexture: NEAR_TEXTURE.map(line => wobble(toPixels(line, w, h), rng, 5)),
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

  // The sky fills the whole physical canvas (in screen space) so
  // panning above the design rectangle just shows more sky.
  function drawSky(ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function strokeOutline(ctx, width) {
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Subtle contour marks on a mountain face.
  function drawTexture(ctx, lines) {
    ctx.strokeStyle = PALETTE.texture;
    ctx.lineWidth = STROKE.texture;
    ctx.lineCap = 'round';
    lines.forEach(line => {
      ctx.beginPath();
      tracePath(ctx, line);
      ctx.stroke();
    });
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

    drawTexture(ctx, scene.nearTexture);
  }

  // Sea fill plus its top-edge line and bold sweeping wave lines. The
  // ripple lines drift slowly toward the shore and back out again,
  // each lagging a little behind the one before it, so they read as
  // overlapping waves lapping at the beach in a slow, steady rhythm.
  // The line nearest the shore (index 0) slides under the sand at the
  // peak of its cycle — that moment is a readable "beat" a future
  // timing mechanic can key off.
  function drawOcean(ctx, scene, w, h) {
    ctx.fillStyle = PALETTE.ocean;
    ctx.fillRect(
      -DESIGN.marginX, scene.oceanTopY,
      w + 2 * DESIGN.marginX, h + DESIGN.marginBottom - scene.oceanTopY
    );

    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = STROKE.wave;
    ctx.lineCap = 'round';

    ctx.beginPath();
    tracePath(ctx, scene.horizon);
    ctx.stroke();

    scene.ripples.forEach((line, i) => {
      const phase = elapsed * (2 * Math.PI / WAVE.period) - i * WAVE.phaseStep;
      const reach = Math.sin(phase) * WAVE.amplitude;
      ctx.save();
      ctx.translate(WAVE.dir[0] * reach, WAVE.dir[1] * reach);
      ctx.beginPath();
      tracePath(ctx, line);
      ctx.stroke();
      ctx.restore();
    });
  }

  // The big headland: its closed silhouette runs over the ridge,
  // down the waterline at its foot, then back along the sand's top
  // edge (pushed down slightly so the sand fill overlaps it and no
  // seam shows). Only the ridge is stroked here.
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

    drawTexture(ctx, scene.farTexture);
  }

  // Sand fill on the left: bounded by the shoreline on the right and
  // by its meandering top edge against the headland's base, which is
  // stroked so the mountain visibly sits ON the beach.
  function drawSand(ctx, scene, h) {
    const shore = scene.shore;
    const sandTop = scene.sandTop;
    const lastShore = shore[shore.length - 1];
    const topLeft = sandTop[sandTop.length - 1];

    ctx.beginPath();
    tracePath(ctx, shore);
    ctx.lineTo(lastShore[0], h + DESIGN.marginBottom);
    ctx.lineTo(topLeft[0], h + DESIGN.marginBottom);
    ctx.lineTo(topLeft[0], topLeft[1]);
    // Sand top, left to right, back up to the shoreline start
    for (let i = sandTop.length - 2; i >= 0; i--) {
      ctx.lineTo(sandTop[i][0], sandTop[i][1]);
    }
    ctx.closePath();
    ctx.fillStyle = PALETTE.sand;
    ctx.fill();

    // Outline along the mountain/sand boundary
    ctx.beginPath();
    tracePath(ctx, sandTop);
    strokeOutline(ctx, STROKE.thick);
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
  // Camera: pan & zoom
  // -----------------------------------------------------------

  function currentScale() {
    return baseScale * cam.zoom;
  }

  // Keep the visible window inside the painted area (design rect
  // plus margins). If the window is larger than the allowed range,
  // fall back to centring on the design rectangle.
  function clampCam() {
    const scale = currentScale();
    const vw = canvas.width / scale;
    const vh = canvas.height / scale;

    const minX = -DESIGN.marginX + vw / 2;
    const maxX = DESIGN.w + DESIGN.marginX - vw / 2;
    cam.cx = minX > maxX ? DESIGN.w / 2 : clamp(cam.cx, minX, maxX);

    const minY = -DESIGN.marginTop + vh / 2;
    const maxY = DESIGN.h + DESIGN.marginBottom - vh / 2;
    cam.cy = minY > maxY ? DESIGN.h / 2 : clamp(cam.cy, minY, maxY);
  }

  function panBy(dxScreen, dyScreen) {
    const scale = currentScale();
    cam.cx -= dxScreen / scale;
    cam.cy -= dyScreen / scale;
    clampCam();
  }

  // Zoom by `factor`, keeping the design point under the given
  // screen position fixed so the view zooms "into" the cursor.
  function zoomAt(screenX, screenY, factor) {
    const oldScale = currentScale();
    cam.zoom = clamp(cam.zoom * factor, ZOOM.min, ZOOM.max);
    const newScale = currentScale();

    const dx = screenX - canvas.width / 2;
    const dy = screenY - canvas.height / 2;
    cam.cx += dx / oldScale - dx / newScale;
    cam.cy += dy / oldScale - dy / newScale;
    clampCam();
  }

  // --- Input: drag to pan, wheel to zoom, two-finger pinch ---
  const pointers = new Map();

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });

  canvas.addEventListener('pointermove', e => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;

    if (pointers.size === 1) {
      panBy(e.clientX - prev.x, e.clientY - prev.y);
    } else if (pointers.size === 2) {
      // The other finger of the pinch
      let other = null;
      for (const [id, p] of pointers) {
        if (id !== e.pointerId) other = p;
      }
      const prevDist = Math.hypot(prev.x - other.x, prev.y - other.y);
      const prevMidX = (prev.x + other.x) / 2;
      const prevMidY = (prev.y + other.y) / 2;
      const newDist = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      const newMidX = (e.clientX + other.x) / 2;
      const newMidY = (e.clientY + other.y) / 2;

      panBy(newMidX - prevMidX, newMidY - prevMidY);
      if (prevDist > 0) {
        zoomAt(newMidX, newMidY, newDist / prevDist);
      }
    }

    prev.x = e.clientX;
    prev.y = e.clientY;
  });

  function releasePointer(e) {
    pointers.delete(e.pointerId);
  }
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0012));
  }, { passive: false });

  // -----------------------------------------------------------
  // Render & game loop
  // -----------------------------------------------------------

  // Layer order matters: the distant range sits behind the sea, the
  // headland sits in front of it, the sand covers the headland's
  // lower-left base, and the waterline stroke goes on top of it all.
  function render() {
    const w = DESIGN.w;
    const h = DESIGN.h;
    const scale = currentScale();
    const ox = canvas.width / 2 - cam.cx * scale;
    const oy = canvas.height / 2 - cam.cy * scale;

    drawSky(ctx);

    // Map design space onto the canvas: uniform scale, no stretching.
    ctx.setTransform(scale, 0, 0, scale, ox, oy);

    drawMountainNear(ctx, scene);
    drawOcean(ctx, scene, w, h);
    drawMountainFar(ctx, scene);
    drawSand(ctx, scene, h);
    drawWaterline(ctx, scene);
  }

  function update(timestamp) {
    if (lastTimestamp !== null) {
      elapsed += (timestamp - lastTimestamp) / 1000;
    }
    lastTimestamp = timestamp;
  }

  function loop(timestamp) {
    update(timestamp);
    render();
    requestAnimationFrame(loop);
  }

  // -----------------------------------------------------------
  // Resize handling
  // -----------------------------------------------------------
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    baseScale = Math.max(canvas.width / DESIGN.w, canvas.height / DESIGN.h);
    clampCam();
  }

  window.addEventListener('resize', resize);

  // Kick everything off
  scene = buildScene(DESIGN.w, DESIGN.h);
  resize();
  requestAnimationFrame(loop);
})();
