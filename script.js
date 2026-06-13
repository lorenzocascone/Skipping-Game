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
    stone: '#cdc3b8',
    outline: '#2e3a56',
    texture: 'rgba(46, 58, 86, 0.55)'
  };

  const STROKE = {
    thick: 5,    // shoreline, mountain ridges
    wave: 4,     // bold sweeping wave lines on the sea
    texture: 2.5, // subtle contour marks on the mountain faces
    pebble: 4    // bold outline on stones, to match the rest of the line art
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

  // Whether this device supports touch — used to show the on-screen
  // movement joystick only where it's actually needed.
  const TOUCH_ENABLED = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Stylized stick-figure proportions, in design px, plus the walk
  // animation's swing/bob amounts and speeds.
  const PLAYER_SHAPE = {
    headR: 11,
    torsoLen: 26,
    legLen: 24,
    armLen: 20,
    limbSwing: 12,  // max sideways swing of hands/feet while walking
    bobAmount: 3,   // vertical bob amplitude while walking
    walkSpeed: 6,   // radians/sec the walk cycle advances while moving
    speed: 220      // movement speed, design px/sec
  };

  // Direction pointing from the shore out toward open sea — the
  // opposite of the ripples' shoreward drift — and the limits for
  // the stone-throwing aim/power interaction.
  const SEA_DIR = [-WAVE.dir[0], -WAVE.dir[1]];
  const AIM = {
    maxAngle: Math.PI * 0.4, // how far the aim can swing from straight out to sea
    lineLength: 110,
    barWidth: 70,
    barHeight: 10,
    power: { period: 1.6 } // seconds for one empty-full-empty loop
  };
  const STONE_COUNT_RANGE = [3, 4];

  // Throwing & skipping: a thrown stone arcs under gravity, and each
  // time it meets the water its remaining speed/height are reduced by
  // a forgiving blend of the throw's power, how flat its angle of
  // approach was, and how the lapping wave happened to be timed —
  // catching a wave at its peak (surging toward shore) kills the
  // bounce, while catching the trough between waves gives the
  // cleanest skip.
  const GRAVITY = 1100; // pulls the stone's height back down, design px/sec^2
  const THROW = {
    speedMin: 260, speedMax: 560, // forward speed at release, design px/sec
    liftMin: 90, liftMax: 230,    // initial upward speed at release, design px/sec
    waveSpatialFreq: 0.0026,      // how quickly the lapping phase shifts with distance out to sea
    popupHold: 0.5,               // seconds a skip count stays fully visible
    popupFade: 0.9,               // seconds it then takes to fade away
    sinkTime: 0.9,                // seconds a settled stone takes to fade out
    trailLength: 16               // how many recent positions the fading trail keeps
  };

  // A brief radiating-lines splash where a thrown stone meets the water.
  const SPLASH = {
    life: 0.45,   // seconds the splash takes to grow and fade
    lines: 5,     // number of radiating lines
    length: 14    // how far the lines reach at full growth, design px
  };

  // How long a freshly washed-up stone takes to fade fully into view,
  // and how long after a thrown stone settles before a replacement
  // washes up so the player never runs out.
  const STONE_FADE_TIME = 1.2;
  const RESPAWN_DELAY = [3, 6];

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
  // Player & input state
  // -----------------------------------------------------------

  // Player position in design-space pixels (same space as the scene
  // geometry), facing direction, and walk-cycle phase driving the
  // limb-swing/bob animation.
  const player = {
    x: 160,
    y: 585,
    facing: 1,
    moving: false,
    walkCycle: 0,
    swingIntensity: 0,
    heldStones: []
  };

  // Aiming/throwing state: while the player holds a stone and holds
  // down the pointer, an aiming line and power bar appear. `dirX/dirY`
  // is a unit vector clamped to a cone around SEA_DIR, and `power`
  // loops smoothly between 0 and 1 for as long as the pointer is held.
  const aiming = {
    pointerId: null,
    active: false,
    dirX: SEA_DIR[0],
    dirY: SEA_DIR[1],
    holdTime: 0,
    power: 0
  };

  // Keyboard movement: WASD and arrow keys.
  const keys = new Set();
  window.addEventListener('keydown', e => {
    const key = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      e.preventDefault();
    }
    keys.add(key);
  });
  window.addEventListener('keyup', e => {
    keys.delete(e.key.toLowerCase());
  });

  // On-screen joystick for touch movement: a translucent circle in
  // the bottom-left corner. `dx`/`dy` stay in [-1, 1] and scale the
  // player's speed by how far the knob is dragged from centre.
  const joystick = {
    pointerId: null,
    active: false,
    radius: 60,
    baseX: 0,
    baseY: 0,
    knobX: 0,
    knobY: 0,
    dx: 0,
    dy: 0
  };

  function updateJoystickBase() {
    joystick.baseX = joystick.radius + 30;
    joystick.baseY = canvas.height - joystick.radius - 30;
  }

  function updateJoystickVector(clientX, clientY) {
    let dx = clientX - joystick.baseX;
    let dy = clientY - joystick.baseY;
    const dist = Math.hypot(dx, dy);
    if (dist > joystick.radius) {
      dx = (dx / dist) * joystick.radius;
      dy = (dy / dist) * joystick.radius;
    }
    joystick.knobX = dx;
    joystick.knobY = dy;
    if (dist < 8) {
      joystick.dx = 0;
      joystick.dy = 0;
    } else {
      joystick.dx = dx / joystick.radius;
      joystick.dy = dy / joystick.radius;
    }
  }

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

  // Axis-aligned bounding box of a polygon, used to pick random
  // points that are likely to land inside it.
  function polygonBounds(poly) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    poly.forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    return { minX, minY, maxX, maxY };
  }

  // Ray-casting point-in-polygon test, used to keep the player on
  // the sand.
  function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) &&
          x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
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

    // The walkable sand area, as a polygon: the shoreline down one
    // side, across the bottom margin, up the left margin, then back
    // along the headland's base — the same boundary drawSand fills.
    const shore = waterline.slice(MOUNTAIN_FOOT.length);
    const lastShore = shore[shore.length - 1];
    const topLeft = sandTop[sandTop.length - 1];
    const sandPolygon = shore.concat([
      [lastShore[0], h + DESIGN.marginBottom],
      [topLeft[0], h + DESIGN.marginBottom],
      [topLeft[0], topLeft[1]]
    ]);
    for (let i = sandTop.length - 2; i >= 0; i--) {
      sandPolygon.push(sandTop[i]);
    }

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
      sandPolygon: sandPolygon,
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

    // A wave line that hugs the shore itself, one step ahead of the
    // nearest ripple in the lapping cycle, so the wave pattern reads
    // as continuing right up to the sand rather than stopping short.
    const shorePhase = elapsed * (2 * Math.PI / WAVE.period) + WAVE.phaseStep;
    const shoreReach = Math.sin(shorePhase) * WAVE.amplitude;

    ctx.save();
    ctx.translate(WAVE.dir[0] * shoreReach, WAVE.dir[1] * shoreReach);
    ctx.beginPath();
    tracePath(ctx, scene.shore);
    ctx.stroke();
    ctx.restore();
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

  // As the shore-hugging wave pulls back from its high-water mark, a
  // scalloped white foam line lingers on the wet sand it just covered —
  // visible only while the wave is receded, fading back out as it
  // returns. Drawn after the sand fill so it reads as sitting on top
  // of the beach rather than getting painted over.
  function drawFoam(ctx, scene) {
    const shorePhase = elapsed * (2 * Math.PI / WAVE.period) + WAVE.phaseStep;
    const shoreReach = Math.sin(shorePhase) * WAVE.amplitude;
    const foamAlpha = clamp(-shoreReach / WAVE.amplitude, 0, 1);
    if (foamAlpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = foamAlpha * 0.8;
    ctx.translate(WAVE.dir[0] * WAVE.amplitude, WAVE.dir[1] * WAVE.amplitude);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = STROKE.texture;
    ctx.lineCap = 'round';
    ctx.setLineDash([3, 9]);
    ctx.beginPath();
    tracePath(ctx, scene.shore);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // -----------------------------------------------------------
  // Player: a simple stick figure, confined to the sand
  // -----------------------------------------------------------

  function pointInSand(x, y) {
    return pointInPolygon(x, y, scene.sandPolygon);
  }

  function movePlayer(dx, dy) {
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (pointInSand(nx, ny)) {
      player.x = nx;
      player.y = ny;
      return;
    }
    // Slide along whichever axis still lands on sand, so walking
    // into the waterline or the headland glides along the edge
    // instead of stopping dead.
    if (pointInSand(nx, player.y)) {
      player.x = nx;
    } else if (pointInSand(player.x, ny)) {
      player.y = ny;
    }
  }

  function updatePlayer(dt) {
    let dx = 0;
    let dy = 0;
    if (keys.has('w') || keys.has('arrowup')) dy -= 1;
    if (keys.has('s') || keys.has('arrowdown')) dy += 1;
    if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
    if (keys.has('d') || keys.has('arrowright')) dx += 1;

    if (dx === 0 && dy === 0 && joystick.active) {
      dx = joystick.dx;
      dy = joystick.dy;
    }

    const mag = Math.hypot(dx, dy);
    player.moving = mag > 0.05;

    if (player.moving) {
      const speedScale = Math.min(mag, 1);
      const step = PLAYER_SHAPE.speed * speedScale * dt;
      movePlayer((dx / mag) * step, (dy / mag) * step);
      if (Math.abs(dx) > 0.1) player.facing = dx > 0 ? 1 : -1;
      player.walkCycle += dt * PLAYER_SHAPE.walkSpeed;
    }

    // Ease the limb-swing/bob in and out smoothly rather than
    // snapping to a stop when the player releases the controls.
    const target = player.moving ? 1 : 0;
    player.swingIntensity += (target - player.swingIntensity) * Math.min(1, dt * 6);
  }

  // A small, stylized stick figure: round head, straight torso, and
  // swinging arms/legs, drawn in the same dark outline colour as the
  // rest of the scene so it reads as part of the same hand-drawn world.
  function drawPlayer(ctx, p) {
    const s = PLAYER_SHAPE;
    const swing = Math.sin(p.walkCycle) * s.limbSwing * p.swingIntensity;
    const bob = Math.sin(p.walkCycle * 2) * s.bobAmount * p.swingIntensity;

    const hipY = -s.legLen;
    const shoulderY = hipY - s.torsoLen;
    const headY = shoulderY - s.headR - 3;

    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = STROKE.thick;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Legs
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(swing, 0);
    ctx.moveTo(0, hipY);
    ctx.lineTo(-swing, 0);
    ctx.stroke();

    // Torso
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(0, shoulderY);
    ctx.stroke();

    // Arms — each swings opposite the same-side leg, like a natural walk
    ctx.beginPath();
    ctx.moveTo(0, shoulderY);
    ctx.lineTo(-swing, shoulderY + s.armLen);
    ctx.moveTo(0, shoulderY);
    ctx.lineTo(swing, shoulderY + s.armLen);
    ctx.stroke();

    // Head, with a short "nose" mark showing which way it's facing
    ctx.beginPath();
    ctx.arc(0, headY, s.headR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p.facing * s.headR * 0.3, headY);
    ctx.lineTo(p.facing * s.headR * 1.2, headY);
    ctx.lineWidth = STROKE.texture;
    ctx.stroke();

    drawHeldStones(ctx, p);

    ctx.restore();
  }

  // Draws the on-screen movement joystick in screen space (unaffected
  // by the camera transform), only on touch devices.
  function drawJoystick(ctx) {
    if (!TOUCH_ENABLED) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.beginPath();
    ctx.arc(joystick.baseX, joystick.baseY, joystick.radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(46, 58, 86, 0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(46, 58, 86, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(joystick.baseX + joystick.knobX, joystick.baseY + joystick.knobY, joystick.radius * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = joystick.active ? 'rgba(46, 58, 86, 0.35)' : 'rgba(46, 58, 86, 0.2)';
    ctx.fill();
  }

  // -----------------------------------------------------------
  // Stones: scattered on the sand, picked up automatically on
  // contact, then thrown with the aiming/power interaction below.
  // -----------------------------------------------------------

  let stones = [];

  // Builds a slightly irregular closed outline for a pebble: points
  // scattered around an ellipse with randomized radii, later smoothed
  // by tracePath into a rounded, hand-drawn blob rather than a plain
  // oval.
  function pebbleShape(rx, ry) {
    const n = 7 + Math.floor(Math.random() * 2);
    const points = [];
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      const r = 0.7 + Math.random() * 0.5;
      points.push([Math.cos(angle) * rx * r, Math.sin(angle) * ry * r]);
    }
    return points;
  }

  // Fills and strokes a closed pebble outline (already positioned via
  // the current transform) with a bold line matching the rest of the
  // scene's hand-drawn style.
  function drawPebble(ctx, points) {
    ctx.beginPath();
    tracePath(ctx, points.concat([points[0], points[1]]));
    ctx.closePath();
    ctx.fillStyle = PALETTE.stone;
    ctx.fill();
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = STROKE.pebble;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // Scatters a handful of small stones at random points on the sand,
  // away from the player's starting position.
  function spawnStones() {
    const bounds = polygonBounds(scene.sandPolygon);
    const count = STONE_COUNT_RANGE[0] +
      Math.floor(Math.random() * (STONE_COUNT_RANGE[1] - STONE_COUNT_RANGE[0] + 1));
    const list = [];
    let attempts = 0;
    while (list.length < count && attempts < 500) {
      attempts++;
      const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
      const y = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
      if (!pointInSand(x, y)) continue;
      if (Math.hypot(x - player.x, y - player.y) < 60) continue;
      const rx = 7 + Math.random() * 5;
      const ry = 5 + Math.random() * 3;
      list.push({
        x, y,
        rot: Math.random() * Math.PI,
        shape: pebbleShape(rx, ry),
        collected: false,
        spawnAge: STONE_FADE_TIME // already fully visible at the start
      });
    }
    return list;
  }

  // A random point along the shoreline, nudged inland onto the sand —
  // used to wash up replacement stones near the water's edge.
  function randomShorePoint() {
    const shore = scene.shore;
    const i = Math.floor(Math.random() * (shore.length - 1));
    const t = Math.random();
    let x = shore[i][0] + (shore[i + 1][0] - shore[i][0]) * t;
    let y = shore[i][1] + (shore[i + 1][1] - shore[i][1]) * t;
    for (let d = 0; d <= 200; d += 4) {
      const px = x - SEA_DIR[0] * d;
      const py = y - SEA_DIR[1] * d;
      if (pointInSand(px, py)) return [px, py];
    }
    return [x, y];
  }

  // Picks up any stone the player is standing on, and eases newly
  // washed-up stones into full visibility.
  function updateStones(dt) {
    const pickupRadius = 26;
    stones.forEach(stone => {
      if (stone.collected) return;
      stone.spawnAge = Math.min(STONE_FADE_TIME, stone.spawnAge + dt);
      const d = Math.hypot(stone.x - player.x, stone.y - player.y);
      if (d < pickupRadius) {
        stone.collected = true;
        player.heldStones.push({ shape: stone.shape });
      }
    });
  }

  // Draws the stones still lying on the sand as small wobble-stroked
  // pebbles, filled with a soft neutral tone. Freshly washed-up stones
  // fade gently into view.
  function drawStones(ctx, stones) {
    stones.forEach(stone => {
      if (stone.collected) return;
      ctx.save();
      ctx.globalAlpha = clamp(stone.spawnAge / STONE_FADE_TIME, 0, 1);
      ctx.translate(stone.x, stone.y);
      ctx.rotate(stone.rot);
      drawPebble(ctx, stone.shape);
      ctx.restore();
    });
  }

  // Draws a small stack of held stones tucked against the player's
  // hand, on the side they're facing. Called from drawPlayer, inside
  // its translated/local coordinate space.
  function drawHeldStones(ctx, p) {
    if (p.heldStones.length === 0) return;
    const s = PLAYER_SHAPE;
    const handX = p.facing * (s.headR + 8);
    const handY = -s.legLen - s.torsoLen + s.armLen - 6;
    p.heldStones.forEach((stone, i) => {
      ctx.save();
      ctx.translate(handX, handY - i * 7);
      drawPebble(ctx, stone.shape);
      ctx.restore();
    });
  }

  // -----------------------------------------------------------
  // Aiming & throwing: hold the pointer down while carrying a stone
  // to show an aiming line (clamped toward the sea) and a power bar
  // that loops smoothly between empty and full.
  // -----------------------------------------------------------

  // Points the aim toward the given screen position, clamped to a
  // cone around the seaward direction so the throw always heads
  // roughly out to sea.
  function updateAimDirection(clientX, clientY) {
    const [tx, ty] = screenToDesign(clientX, clientY);
    let dx = tx - player.x;
    let dy = ty - player.y;
    const mag = Math.hypot(dx, dy) || 1;
    dx /= mag;
    dy /= mag;

    const seaAngle = Math.atan2(SEA_DIR[1], SEA_DIR[0]);
    let angle = Math.atan2(dy, dx);
    let diff = angle - seaAngle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // normalize to [-PI, PI]
    diff = clamp(diff, -AIM.maxAngle, AIM.maxAngle);
    angle = seaAngle + diff;

    aiming.dirX = Math.cos(angle);
    aiming.dirY = Math.sin(angle);
  }

  // Advances the power bar's smooth empty-full-empty loop while the
  // pointer is held down.
  function updateAiming(dt) {
    if (!aiming.active) return;
    aiming.holdTime += dt;
    const phase = (aiming.holdTime / AIM.power.period) * Math.PI * 2;
    aiming.power = (1 - Math.cos(phase)) / 2;
  }

  // A rounded-rectangle path, used for the minimalist power bar.
  function roundedRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, h / 2, Math.abs(w) / 2 || 0);
    ctx.beginPath();
    if (w <= 0) {
      ctx.rect(x, y, 0, h);
      return;
    }
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  // Draws the aiming line and power bar while the player is aiming a
  // throw. Kept light and sketchy — a dashed line and a thin outlined
  // bar — to match the rest of the line-art style.
  function drawAiming(ctx, p, aim) {
    if (!aim.active) return;

    const startX = p.x;
    const startY = p.y - PLAYER_SHAPE.legLen - PLAYER_SHAPE.torsoLen * 0.5;
    const endX = startX + aim.dirX * AIM.lineLength;
    const endY = startY + aim.dirY * AIM.lineLength;

    // Aiming line: a soft dashed stroke with a small dot at the tip.
    ctx.save();
    ctx.strokeStyle = 'rgba(46, 58, 86, 0.45)';
    ctx.lineWidth = STROKE.texture;
    ctx.setLineDash([6, 8]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(endX, endY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(46, 58, 86, 0.45)';
    ctx.fill();
    ctx.restore();

    // Power bar: a small outlined capsule above the player's head that
    // fills according to the current power level.
    const barW = AIM.barWidth;
    const barH = AIM.barHeight;
    const barX = p.x - barW / 2;
    const barY = startY - PLAYER_SHAPE.headR * 2 - 26;

    ctx.save();
    roundedRectPath(ctx, barX, barY, barW, barH, barH / 2);
    ctx.strokeStyle = 'rgba(46, 58, 86, 0.5)';
    ctx.lineWidth = STROKE.texture;
    ctx.stroke();

    const fillW = barW * aim.power;
    if (fillW > 0) {
      roundedRectPath(ctx, barX, barY, fillW, barH, barH / 2);
      ctx.fillStyle = 'rgba(46, 58, 86, 0.3)';
      ctx.fill();
    }
    ctx.restore();
  }

  // -----------------------------------------------------------
  // Throwing & skipping: a released stone follows a simple gravity
  // arc — forward motion plus a rising and falling "height" drawn as
  // extra lift above its shadow. Each time it meets the water,
  // `handleImpact` decides whether it skips again, losing some speed
  // and height, or settles and sinks for good.
  // -----------------------------------------------------------

  let throws = [];

  // A few short white lines that radiate outward and fade where a
  // thrown stone meets the water.
  let splashes = [];

  // The best skip count reached so far this session, shown in the HUD.
  let bestSkips = 0;

  // Seconds remaining until each pending replacement stone washes up
  // on the beach, so the player never runs out.
  let pendingRespawns = [];

  function scheduleRespawn() {
    pendingRespawns.push(
      RESPAWN_DELAY[0] + Math.random() * (RESPAWN_DELAY[1] - RESPAWN_DELAY[0])
    );
  }

  // The lapping wave's phase at a point in design space, matching the
  // ripple lines' rhythm: +1 is a wave at its peak (surging toward the
  // shore), -1 is the trough between waves.
  function waveSurfaceAt(x, y, t) {
    const dist = x * SEA_DIR[0] + y * SEA_DIR[1];
    const phase = t * (2 * Math.PI / WAVE.period) - dist * THROW.waveSpatialFreq;
    return Math.sin(phase);
  }

  // Launches a held stone out to sea along the current aim direction,
  // with a speed and lift drawn from the release power.
  function throwStone(stone, power, dirX, dirY) {
    const s = PLAYER_SHAPE;
    throws.push({
      shape: stone.shape,
      x: player.x + dirX * (s.headR + 10),
      y: player.y - s.legLen - s.torsoLen + s.armLen - 6,
      dirX, dirY,
      speed: THROW.speedMin + power * (THROW.speedMax - THROW.speedMin),
      height: 0,
      vHeight: THROW.liftMin + power * (THROW.liftMax - THROW.liftMin),
      power,
      rot: 0,
      skips: 0,
      state: 'flying',
      sinkAge: 0,
      trail: [],
      popupText: '',
      popupX: 0,
      popupY: 0,
      popupAge: null
    });
  }

  // Spawns a brief radiating-lines splash at a water impact point.
  function spawnSplash(x, y) {
    const n = SPLASH.lines;
    const angles = [];
    for (let i = 0; i < n; i++) {
      angles.push(-Math.PI / 2 + (i - (n - 1) / 2) * 0.35 + (Math.random() - 0.5) * 0.15);
    }
    splashes.push({ x, y, age: 0, angles });
  }

  // Decides what happens when the stone reaches the water (or sand)
  // level: a forgiving blend of how flat the approach angle was, how
  // the wave happened to be timed, and the throw's power decides
  // whether it skips again or settles in for good.
  function handleImpact(t) {
    if (pointInSand(t.x, t.y)) {
      t.state = 'sinking';
      return;
    }

    spawnSplash(t.x, t.y);

    const angleFactor = t.speed / Math.hypot(t.speed, Math.abs(t.vHeight));
    const waveVal = waveSurfaceAt(t.x, t.y, elapsed);
    const waveFactor = (1 - waveVal) / 2;
    const bounceFactor = clamp(
      angleFactor * 0.45 + waveFactor * 0.35 + t.power * 0.2, 0, 1
    );

    if (bounceFactor < 0.18 || t.speed < 50) {
      t.state = 'sinking';
      return;
    }

    t.skips += 1;
    if (t.skips > bestSkips) bestSkips = t.skips;
    t.speed *= 0.45 + bounceFactor * 0.3;
    t.vHeight = Math.max(60, t.speed * (0.35 + bounceFactor * 0.25));
    t.popupText += (t.popupText ? ' ' : '') + t.skips + '...';
    t.popupX = t.x;
    t.popupY = t.y;
    t.popupAge = 0;
  }

  // Advances every in-flight or settling stone, plus the splashes and
  // pending replacement stones they leave behind.
  function updateThrows(dt) {
    for (let i = throws.length - 1; i >= 0; i--) {
      const t = throws[i];

      if (t.popupAge !== null) t.popupAge += dt;

      if (t.state === 'sinking') {
        t.sinkAge += dt;
        const popupDone = t.popupAge === null ||
          t.popupAge > THROW.popupHold + THROW.popupFade;
        if (t.sinkAge > THROW.sinkTime && popupDone) {
          throws.splice(i, 1);
          scheduleRespawn();
        }
        continue;
      }

      const prevHeight = t.height;
      t.vHeight -= GRAVITY * dt;
      t.height += t.vHeight * dt;
      t.x += t.dirX * t.speed * dt;
      t.y += t.dirY * t.speed * dt;
      t.rot += dt * (1.5 + t.speed * 0.004);

      t.trail.push([t.x, t.y - t.height]);
      if (t.trail.length > THROW.trailLength) t.trail.shift();

      if (prevHeight >= 0 && t.height < 0) {
        t.height = 0;
        handleImpact(t);
      }
    }
  }

  // Advances each splash's brief grow-and-fade animation.
  function updateSplashes(dt) {
    for (let i = splashes.length - 1; i >= 0; i--) {
      splashes[i].age += dt;
      if (splashes[i].age > SPLASH.life) splashes.splice(i, 1);
    }
  }

  // Counts down to each pending replacement stone washing ashore.
  function updateRespawns(dt) {
    for (let i = pendingRespawns.length - 1; i >= 0; i--) {
      pendingRespawns[i] -= dt;
      if (pendingRespawns[i] <= 0) {
        pendingRespawns.splice(i, 1);
        const [x, y] = randomShorePoint();
        const rx = 7 + Math.random() * 5;
        const ry = 5 + Math.random() * 3;
        stones.push({
          x, y,
          rot: Math.random() * Math.PI,
          shape: pebbleShape(rx, ry),
          collected: false,
          spawnAge: 0
        });
      }
    }
  }

  // Draws every in-flight or settling stone: a fading trail behind it,
  // a soft shadow on the ground/water, the pebble itself (lifted,
  // fading and shrinking as it settles), and a gently fading
  // skip-count popup.
  function drawThrows(ctx) {
    throws.forEach(t => {
      const sinkFrac = t.state === 'sinking'
        ? clamp(t.sinkAge / THROW.sinkTime, 0, 1) : 0;

      // A gentle, fading trail of the stone's recent positions.
      const trailLen = t.trail.length;
      t.trail.forEach(([tx, ty], idx) => {
        const f = (idx + 1) / trailLen;
        ctx.save();
        ctx.globalAlpha = f * 0.25 * (1 - sinkFrac);
        ctx.beginPath();
        ctx.arc(tx, ty, 2 + 3 * f, 0, Math.PI * 2);
        ctx.fillStyle = PALETTE.outline;
        ctx.fill();
        ctx.restore();
      });

      // Shadow on the sand or water surface.
      ctx.save();
      ctx.globalAlpha = 0.25 * (1 - sinkFrac);
      ctx.beginPath();
      ctx.ellipse(t.x, t.y, 11, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.outline;
      ctx.fill();
      ctx.restore();

      // The pebble itself, lifted by its height, fading and settling
      // slightly below the surface as it sinks.
      ctx.save();
      ctx.globalAlpha = 1 - sinkFrac;
      ctx.translate(t.x, t.y - t.height + sinkFrac * 6);
      ctx.rotate(t.rot);
      ctx.scale(1 - sinkFrac * 0.4, 1 - sinkFrac * 0.4);
      drawPebble(ctx, t.shape);
      ctx.restore();

      // Skip-count popup: holds steady, then fades and drifts gently
      // upward.
      if (t.popupAge !== null) {
        let alpha = 1;
        if (t.popupAge > THROW.popupHold) {
          alpha = clamp(1 - (t.popupAge - THROW.popupHold) / THROW.popupFade, 0, 1);
        }
        if (alpha > 0) {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.font = '600 26px "Segoe UI", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = PALETTE.outline;
          ctx.fillText(t.popupText, t.popupX, t.popupY - 24 - t.popupAge * 14);
          ctx.restore();
        }
      }
    });
  }

  // Draws each splash as a few short white lines growing outward from
  // the impact point and fading away.
  function drawSplashes(ctx) {
    splashes.forEach(s => {
      const f = s.age / SPLASH.life;
      const alpha = clamp(1 - f, 0, 1) * 0.8;
      const len = SPLASH.length * (0.4 + 0.6 * f);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = STROKE.texture;
      ctx.lineCap = 'round';
      s.angles.forEach(a => {
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(s.x + dx * len * 0.3, s.y + dy * len * 0.3);
        ctx.lineTo(s.x + dx * len, s.y + dy * len);
        ctx.stroke();
      });
      ctx.restore();
    });
  }

  // -----------------------------------------------------------
  // HUD: a small "Best Skips" counter in the corner, drawn in screen
  // space so it stays put regardless of camera pan/zoom.
  // -----------------------------------------------------------
  function drawHUD(ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = '600 20px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(46, 58, 86, 0.55)';
    ctx.fillText(`Best Skips: ${bestSkips}`, 20, 20);
  }

  // -----------------------------------------------------------
  // Camera: pan & zoom
  // -----------------------------------------------------------

  function currentScale() {
    return baseScale * cam.zoom;
  }

  // Converts screen (client) coordinates into design-space coordinates,
  // inverting the scale/pan applied when rendering.
  function screenToDesign(sx, sy) {
    const scale = currentScale();
    const ox = canvas.width / 2 - cam.cx * scale;
    const oy = canvas.height / 2 - cam.cy * scale;
    return [(sx - ox) / scale, (sy - oy) / scale];
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
    if (TOUCH_ENABLED && joystick.pointerId === null) {
      const dist = Math.hypot(e.clientX - joystick.baseX, e.clientY - joystick.baseY);
      if (dist <= joystick.radius * 1.5) {
        canvas.setPointerCapture(e.pointerId);
        joystick.pointerId = e.pointerId;
        joystick.active = true;
        updateJoystickVector(e.clientX, e.clientY);
        return;
      }
    }

    // Holding a stone and pressing elsewhere starts an aim/throw,
    // rather than panning the camera.
    if (player.heldStones.length > 0 && aiming.pointerId === null && pointers.size === 0) {
      canvas.setPointerCapture(e.pointerId);
      aiming.pointerId = e.pointerId;
      aiming.active = true;
      aiming.holdTime = 0;
      aiming.power = 0;
      updateAimDirection(e.clientX, e.clientY);
      return;
    }

    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });

  canvas.addEventListener('pointermove', e => {
    if (e.pointerId === joystick.pointerId) {
      updateJoystickVector(e.clientX, e.clientY);
      return;
    }

    if (e.pointerId === aiming.pointerId) {
      updateAimDirection(e.clientX, e.clientY);
      return;
    }

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
    if (e.pointerId === joystick.pointerId) {
      joystick.pointerId = null;
      joystick.active = false;
      joystick.dx = 0;
      joystick.dy = 0;
      joystick.knobX = 0;
      joystick.knobY = 0;
      return;
    }
    if (e.pointerId === aiming.pointerId) {
      if (player.heldStones.length > 0) {
        const stone = player.heldStones.pop();
        throwStone(stone, aiming.power, aiming.dirX, aiming.dirY);
      }
      aiming.pointerId = null;
      aiming.active = false;
      aiming.holdTime = 0;
      aiming.power = 0;
      return;
    }
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
    drawFoam(ctx, scene);
    drawStones(ctx, stones);
    drawPlayer(ctx, player);
    drawAiming(ctx, player, aiming);
    drawThrows(ctx);
    drawSplashes(ctx);

    drawJoystick(ctx);
    drawHUD(ctx);
  }

  function update(timestamp) {
    let dt = 0;
    if (lastTimestamp !== null) {
      dt = (timestamp - lastTimestamp) / 1000;
      elapsed += dt;
    }
    lastTimestamp = timestamp;
    updatePlayer(dt);
    updateStones(dt);
    updateAiming(dt);
    updateThrows(dt);
    updateSplashes(dt);
    updateRespawns(dt);
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
    updateJoystickBase();
  }

  window.addEventListener('resize', resize);

  // Kick everything off
  scene = buildScene(DESIGN.w, DESIGN.h);
  stones = spawnStones();
  resize();
  requestAnimationFrame(loop);
})();
