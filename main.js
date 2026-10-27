import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

// Default zoom scales with aspect so all clocks stay in frame
function homeZoom() {
  const aspect = window.innerWidth / window.innerHeight;
  return THREE.MathUtils.clamp(6.7 / (Math.tan((16 * Math.PI) / 180) * aspect), 8.5, 24);
}

const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 50);
camera.position.set(-0.22, 0.15, homeZoom());
camera.lookAt(-0.22, 0, 0);

// Image-based lighting for realistic materials
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const keyLight = new THREE.DirectionalLight(0xfff4e4, 1.5);
keyLight.position.set(-3, 4.5, 4);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xdfe8ff, 0.45);
fillLight.position.set(4, -1, 2);
scene.add(fillLight);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function smootherstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Fine-grain noise canvas used as bump + roughness variation
function makeNoiseTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 118 + Math.random() * 20;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  return tex;
}

// Sandstone color map: warm beige base scattered with dark and light flecks
function makeSpeckleTexture(size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#93846d';
  ctx.fillRect(0, 0, size, size);
  const speckles = [
    { color: 'rgba(74, 61, 47, 0.6)', count: 3200, rMax: 1.8 },
    { color: 'rgba(115, 100, 82, 0.55)', count: 3200, rMax: 2.2 },
    { color: 'rgba(214, 204, 188, 0.75)', count: 2200, rMax: 1.6 },
    { color: 'rgba(248, 244, 236, 0.85)', count: 900, rMax: 1.2 },
  ];
  for (const s of speckles) {
    ctx.fillStyle = s.color;
    for (let i = 0; i < s.count; i++) {
      const r = 0.4 + Math.random() * s.rMax;
      ctx.beginPath();
      ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roundedRectShape(w, h, r) {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

// ---------------------------------------------------------------------------
// Pebble geometry — sculpted from a high-res sphere: organic outline,
// flattened depth, recessed crater on the front
// ---------------------------------------------------------------------------
function buildPebbleGeometry(p) {
  const seg = p.segments ?? 256;
  let geo = new THREE.SphereGeometry(1, seg, seg);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let { x, y, z } = v;

    // Organic, slightly asymmetric outline
    const theta = Math.atan2(y, x) + (p.shapeRotation ?? 0);
    const rXY =
      1 +
      p.h1 * Math.sin(theta + p.p1) +
      p.h2 * Math.sin(2 * theta + p.p2) +
      p.h3 * Math.sin(3 * theta + p.p3);
    x *= rXY;
    y *= rXY;

    // Flatten depth; tanh keeps faces flatter while the edge stays plump
    const frontFlat = p.frontFlat ?? 1.4;
    const frontDepth = p.frontDepth ?? 0.55;
    z = (Math.tanh(z * frontFlat) / Math.tanh(frontFlat)) * frontDepth;

    // Overall proportions
    x *= p.scaleX;
    y *= p.scaleY;

    // Recessed cutout on the front. Circular crater (analog dial) subtracts
    // depth following curvature; rounded-rect dish (digital screen) clamps to
    // a flat floor and hugs the screen shape.
    let t;
    let dist = Infinity;
    if (p.craterRect) {
      const r = p.craterRect;
      const qx = Math.abs(x - p.craterX) - (r.w / 2 - r.r);
      const qy = Math.abs(y - p.craterY) - (r.h / 2 - r.r);
      dist =
        Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
        Math.min(Math.max(qx, qy), 0) -
        r.r;
      const rim = r.rim;
      // Feather only outside the screen edge; full depth inside keeps a tight fit.
      t = dist <= 0 ? 1 : 1 - smootherstep(0, rim, dist);
      const planar = 1 - smootherstep(0, rim + 0.08, dist);
      const frontWeight = Math.max(smootherstep(-0.08, 0.18, z), planar);
      t *= frontWeight;
      z -= Math.max(0, z - p.craterFloor) * t;
    } else if (p.craterFloor !== undefined) {
      // Flat-floor circular dish — same rim logic as the digital screen recess
      const d = Math.hypot(x - p.craterX, y - p.craterY);
      const craterR = p.craterRadius ?? 0.72;
      const rim = p.craterRim ?? 0.11;
      dist = d - craterR;
      t = dist <= 0 ? 1 : 1 - smootherstep(0, rim, dist);
      const planar = 1 - smootherstep(0, rim + 0.08, dist);
      const frontWeight = Math.max(smootherstep(-0.08, 0.18, z), planar);
      t *= frontWeight;
      z -= Math.max(0, z - p.craterFloor) * t;
    } else {
      const frontWeight = smoothstep(0.05, 0.3, z);
      const d = Math.hypot(x - p.craterX, y - p.craterY);
      t = smoothstep(p.craterOuter, p.craterInner, d) * frontWeight;
      z -= p.craterDepth * t;
    }

    // Subtle surface irregularity (fade out well before the screen edge)
    const noiseFade = p.craterRect || p.craterFloor !== undefined
      ? smootherstep(-0.04, ((p.craterRect?.rim ?? p.craterRim) ?? 0.1) * 2.5, dist)
      : 1 - t;
    const n =
      (p.noiseAmp ?? 0.012) *
      noiseFade *
      Math.sin(7 * x + 1.3) *
      Math.sin(6 * y + 2.1) *
      Math.sin(5 * z + 0.7);
    const len = Math.hypot(x, y, z) || 1;
    x += (x / len) * n;
    y += (y / len) * n;
    z += (z / len) * n;

    pos.setXYZ(i, x, y, z);
  }

  if (p.craterRect || p.craterFloor !== undefined) geo = mergeVertices(geo, 1e-5);
  geo.deleteAttribute('normal');
  geo.computeVertexNormals();
  return geo;
}

// Raised settings button (disc outlined by a ring) on the back of a clock body
function makeBackButton(discMaterial, ringMaterial, backZ = -0.56) {
  const button = new THREE.Group();
  button.userData.isSettingsButton = true;

  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.03, 48), discMaterial);
  disc.rotation.x = Math.PI / 2;
  button.add(disc);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.007, 16, 96), ringMaterial);
  ring.position.z = -0.008;
  button.add(ring);

  button.position.set(0, 0, backZ);
  return button;
}

// Thin disc with a smooth torus-like rim (coin / wall-clock edge profile)
function buildRoundedDiscGeometry(radius, thickness, edgeRadius, radialSegments = 128) {
  const half = thickness / 2;
  const er = Math.min(edgeRadius, half, radius * 0.15);
  const flatR = Math.max(0, radius - er);
  const arcSegs = 24;
  const pts = [];

  pts.push(new THREE.Vector2(0, -half));
  if (flatR > 0) pts.push(new THREE.Vector2(flatR, -half));

  if (half > er && flatR > 0) pts.push(new THREE.Vector2(flatR, -er));

  const a0 = half > er ? -Math.PI / 2 : Math.asin(-half / er);
  const a1 = half > er ? Math.PI / 2 : Math.asin(half / er);
  for (let i = 0; i <= arcSegs; i++) {
    const a = a0 + ((a1 - a0) * i) / arcSegs;
    pts.push(new THREE.Vector2(flatR + er * Math.cos(a), er * Math.sin(a)));
  }

  if (half > er && flatR > 0) pts.push(new THREE.Vector2(flatR, half));
  pts.push(new THREE.Vector2(0, half));

  const geo = new THREE.LatheGeometry(pts, radialSegments);
  geo.computeVertexNormals();
  return geo;
}

// ===========================================================================
// CLOCK 1 — champagne metal pebble with analog orange dial
// ===========================================================================
const noiseTex = makeNoiseTexture();

const pebbleMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xb8a88e,
  metalness: 0.8,
  roughness: 0.46,
  roughnessMap: noiseTex,
  bumpMap: noiseTex,
  bumpScale: 0.8,
  envMapIntensity: 0.9,
});

const DIAL_CENTER = new THREE.Vector2(0.05, 0.09);
const DIAL_RADIUS = 0.7;
const METAL_CRATER_FLOOR = 0.4;

const metalPebble = new THREE.Mesh(
  buildPebbleGeometry({
    h1: 0.09, p1: 2.0,
    h2: 0.055, p2: 0.8,
    h3: 0.04, p3: 2.6,
    scaleX: 1.24, scaleY: 1.22,
    shapeRotation: Math.PI / 2 + (70 * Math.PI) / 180,
    segments: 384,
    craterX: DIAL_CENTER.x, craterY: DIAL_CENTER.y,
    craterRadius: DIAL_RADIUS + 0.012,
    craterRim: 0.11,
    craterFloor: METAL_CRATER_FLOOR,
    noiseAmp: 0,
  }),
  pebbleMaterial
);

const CREAM = 0xe8dcc0;
const ORANGE_DIAL = 0xbd5504;
const ORANGE_HAND = 0xd93a05;

const dial = new THREE.Group();
dial.position.set(DIAL_CENTER.x, DIAL_CENTER.y, METAL_CRATER_FLOOR - 0.03);
dial.renderOrder = 2;

const face = new THREE.Mesh(
  new THREE.CircleGeometry(DIAL_RADIUS, 128),
  new THREE.MeshStandardMaterial({
    color: ORANGE_DIAL,
    roughness: 0.9,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })
);
face.position.z = 0.035;
face.renderOrder = 2;
dial.add(face);

// Tick marks: 12 hour marks + minute marks
const tickMat = new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.6, metalness: 0 });
const hourTickGeo = new THREE.BoxGeometry(0.012, 0.13, 0.008);
const minTickGeo = new THREE.BoxGeometry(0.006, 0.035, 0.006);

for (let i = 0; i < 60; i++) {
  const isHour = i % 5 === 0;
  const tick = new THREE.Mesh(isHour ? hourTickGeo : minTickGeo, tickMat);
  const angle = (i / 60) * Math.PI * 2;
  const radius = isHour ? 0.58 : 0.63;
  tick.position.set(Math.sin(angle) * radius, Math.cos(angle) * radius, 0.041);
  tick.rotation.z = -angle;
  dial.add(tick);
}

// Hands — cream capsules, flattened for a crisp pressed-metal look
const handMat = new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.45, metalness: 0.1 });

function makeHand(radius, length, offset, zPos, material) {
  const group = new THREE.Group();
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 8, 24), material);
  capsule.scale.z = 0.5;
  capsule.position.y = offset;
  group.add(capsule);
  group.position.z = zPos;
  dial.add(group);
  return group;
}

const hourHand = makeHand(0.026, 0.36, 0.16, 0.03, handMat);
const minuteHand = makeHand(0.021, 0.52, 0.24, 0.055, handMat);

// Second hand — thin orange needle with a counterweight tail
const secondMat = new THREE.MeshStandardMaterial({ color: ORANGE_HAND, roughness: 0.5, metalness: 0.1 });
const secondHand = new THREE.Group();
const needle = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.62, 0.007), secondMat);
needle.position.y = 0.21;
secondHand.add(needle);
const tail = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.14, 0.007), secondMat);
tail.position.y = -0.07;
secondHand.add(tail);
secondHand.position.z = 0.075;
dial.add(secondHand);

// Center hub: cream base with orange cap
const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 48), handMat);
hub.rotation.x = Math.PI / 2;
hub.position.z = 0.07;
dial.add(hub);

const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.02, 48), secondMat);
hubCap.rotation.x = Math.PI / 2;
hubCap.position.z = 0.09;
dial.add(hubCap);

const metalButton = makeBackButton(
  pebbleMaterial,
  new THREE.MeshPhysicalMaterial({
    color: 0x8f8271,
    metalness: 0.8,
    roughness: 0.55,
    envMapIntensity: 0.8,
  })
);

const metalBody = new THREE.Group();
metalBody.add(metalPebble, dial, metalButton);

// ===========================================================================
// CLOCK 2 — speckled sandstone pebble with black digital screen
// ===========================================================================
const speckleTex = makeSpeckleTexture();

const stoneMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  map: speckleTex,
  roughness: 0.95,
  metalness: 0,
  bumpMap: noiseTex,
  bumpScale: 0.6,
  envMapIntensity: 0.4,
});

const SCREEN_CENTER = new THREE.Vector2(0.3, -0.02);
const SCREEN_W = 0.55;
const SCREEN_H = 0.77;
const SCREEN_R = 0.22;
const STONE_CRATER_FLOOR = 0.4;

function mapScreenTexture(tex, w, h) {
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  // ShapeGeometry UVs use shape coords (±w/2), not 0–1 — scale into canvas space.
  tex.repeat.set(1 / w, 1 / h);
  tex.offset.set(0.5, 0.5);
}

const stonePebble = new THREE.Mesh(
  buildPebbleGeometry({
    // Smooth river-stone egg: mass upper-left, soft taper to the right
    h1: 0.08, p1: -1.0,
    h2: 0.03, p2: 0.6,
    h3: 0.015, p3: 0.5,
    scaleX: 1.3, scaleY: 1.15,
    segments: 384,
    craterX: SCREEN_CENTER.x, craterY: SCREEN_CENTER.y,
    craterRect: { w: SCREEN_W, h: SCREEN_H, r: SCREEN_R, rim: 0.11 },
    craterFloor: STONE_CRATER_FLOOR,
    noiseAmp: 0,
  }),
  stoneMaterial
);

// Digital display — self-lit screen drawing HH over MM
const screenGroup = new THREE.Group();
screenGroup.position.set(SCREEN_CENTER.x, SCREEN_CENTER.y, STONE_CRATER_FLOOR - 0.03);

const screenCanvas = document.createElement('canvas');
screenCanvas.width = 256;
screenCanvas.height = 360;
const screenCtx = screenCanvas.getContext('2d');
const screenTex = new THREE.CanvasTexture(screenCanvas);
screenTex.colorSpace = THREE.SRGBColorSpace;
mapScreenTexture(screenTex, SCREEN_W, SCREEN_H);

function drawScreen(hoursText, minutesText) {
  const w = screenCanvas.width;
  const h = screenCanvas.height;
  screenCtx.fillStyle = '#060606';
  screenCtx.fillRect(0, 0, w, h);
  // faint sheen so the glass reads glossy
  const sheen = screenCtx.createLinearGradient(0, 0, w, h);
  sheen.addColorStop(0, 'rgba(255,255,255,0.07)');
  sheen.addColorStop(0.35, 'rgba(255,255,255,0)');
  screenCtx.fillStyle = sheen;
  screenCtx.fillRect(0, 0, w, h);

  screenCtx.fillStyle = '#f4f4f2';
  screenCtx.font = 'bold 128px ui-rounded, "Arial Rounded MT Bold", "Helvetica Rounded", Arial, sans-serif';
  screenCtx.textAlign = 'center';
  screenCtx.textBaseline = 'middle';
  screenCtx.fillText(hoursText, w / 2, h * 0.29);
  screenCtx.fillText(minutesText, w / 2, h * 0.68);
  screenTex.needsUpdate = true;
}

const screenFace = new THREE.Mesh(
  new THREE.ShapeGeometry(roundedRectShape(SCREEN_W, SCREEN_H, SCREEN_R), 64),
  new THREE.MeshBasicMaterial({
    map: screenTex,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })
);
screenFace.position.z = 0.035;
screenFace.renderOrder = 1;
screenGroup.add(screenFace);

const stoneButton = makeBackButton(
  stoneMaterial,
  new THREE.MeshStandardMaterial({ color: 0x8a7b66, roughness: 0.9, metalness: 0 })
);

const stoneBody = new THREE.Group();
stoneBody.add(stonePebble, screenGroup, stoneButton);

// ===========================================================================
// CLOCK 3 — thin matte disc with black dot markers
// ===========================================================================
const DISC_RADIUS = 1.0;
const DISC_THICKNESS = 0.065;
const DISC_EDGE_RADIUS = DISC_THICKNESS / 2 - 0.002;

const discMaterial = new THREE.MeshStandardMaterial({
  color: 0xeae8e4,
  roughness: 0.94,
  metalness: 0,
  bumpMap: noiseTex,
  bumpScale: 0.25,
  envMapIntensity: 0.35,
});

const discMesh = new THREE.Mesh(
  buildRoundedDiscGeometry(DISC_RADIUS, DISC_THICKNESS, DISC_EDGE_RADIUS, 128),
  discMaterial
);
discMesh.rotation.x = Math.PI / 2;

const discDial = new THREE.Group();
const discFaceZ = DISC_THICKNESS / 2 + 0.002;

const dotMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55, metalness: 0 });
const dotGeo = new THREE.SphereGeometry(0.026, 16, 16);

for (let i = 0; i < 12; i++) {
  const dot = new THREE.Mesh(dotGeo, dotMat);
  const angle = (i / 12) * Math.PI * 2;
  dot.position.set(Math.sin(angle) * 0.8, Math.cos(angle) * 0.8, discFaceZ);
  discDial.add(dot);
}

const blackHandMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.45, metalness: 0.05 });

function makeDiscHand(radius, length, offset, zPos) {
  const group = new THREE.Group();
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 8, 24), blackHandMat);
  capsule.scale.z = 0.45;
  capsule.position.y = offset;
  group.add(capsule);
  group.position.z = zPos;
  discDial.add(group);
  return group;
}

const discHourHand = makeDiscHand(0.024, 0.34, 0.15, discFaceZ + 0.012);
const discMinuteHand = makeDiscHand(0.019, 0.54, 0.24, discFaceZ + 0.024);

const discHub = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.022, 48), blackHandMat);
discHub.rotation.x = Math.PI / 2;
discHub.position.z = discFaceZ + 0.034;
discDial.add(discHub);

const discButton = makeBackButton(
  discMaterial,
  new THREE.MeshStandardMaterial({ color: 0xb8b4ae, roughness: 0.9, metalness: 0 }),
  -(DISC_THICKNESS / 2 + 0.02)
);

const discBody = new THREE.Group();
discBody.add(discMesh, discDial, discButton);

// ===========================================================================
// CLOCK 4 — walnut flip clock with split-flap digits
// ===========================================================================
function makeWoodTexture(size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, size, 0);
  grad.addColorStop(0, '#362218');
  grad.addColorStop(0.35, '#4a3020');
  grad.addColorStop(0.65, '#3a2418');
  grad.addColorStop(1, '#442a1c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 120; i++) {
    const y = Math.random() * size;
    ctx.strokeStyle = `rgba(${18 + Math.random() * 28}, ${8 + Math.random() * 14}, ${4 + Math.random() * 8}, ${0.12 + Math.random() * 0.22})`;
    ctx.lineWidth = 0.4 + Math.random() * 1.8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 18) {
      ctx.lineTo(x, y + Math.sin(x * 0.015 + i * 0.7) * (2 + Math.random() * 2));
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.6, 0.55);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const FLIP_DURATION = 0.52;
const DIGIT_W = 0.34;
const DIGIT_H = 0.52;
const HALF_TEX = 128;

function drawDigitHalf(canvas, ctx, digit, half) {
  const w = canvas.width;
  const h = canvas.height;
  const fullH = h * 2;

  ctx.fillStyle = '#080808';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#f3f2ef';
  ctx.font = `700 ${Math.floor(fullH * 0.78)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Anchor the glyph on the seam between the two flap halves.
  ctx.fillText(String(digit), w / 2, half === 'top' ? h : 0);

  if (half === 'top') {
    const g = ctx.createLinearGradient(0, h - 6, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, h - 6, w, 6);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, 4);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, 4);
  }
}

function makeHalfCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = HALF_TEX;
  canvas.height = HALF_TEX;
  return canvas;
}

function makeFlipDigit() {
  const group = new THREE.Group();
  const halfH = DIGIT_H / 2;
  const overlap = 0.002;
  const state = {
    current: 0,
    target: 0,
    animating: false,
    progress: 0,
    swapped: false,
  };

  const bottomCanvas = makeHalfCanvas();
  const bottomCtx = bottomCanvas.getContext('2d');
  const bottomTex = new THREE.CanvasTexture(bottomCanvas);
  bottomTex.colorSpace = THREE.SRGBColorSpace;
  bottomTex.minFilter = THREE.LinearFilter;

  const frontCanvas = makeHalfCanvas();
  const frontCtx = frontCanvas.getContext('2d');
  const frontTex = new THREE.CanvasTexture(frontCanvas);
  frontTex.colorSpace = THREE.SRGBColorSpace;
  frontTex.minFilter = THREE.LinearFilter;

  const backCanvas = makeHalfCanvas();
  const backCtx = backCanvas.getContext('2d');
  const backTex = new THREE.CanvasTexture(backCanvas);
  backTex.colorSpace = THREE.SRGBColorSpace;
  backTex.minFilter = THREE.LinearFilter;

  function refreshBottom(d) {
    drawDigitHalf(bottomCanvas, bottomCtx, d, 'bottom');
    bottomTex.needsUpdate = true;
  }
  function refreshFront(d) {
    drawDigitHalf(frontCanvas, frontCtx, d, 'top');
    frontTex.needsUpdate = true;
  }
  function refreshBack(d) {
    drawDigitHalf(backCanvas, backCtx, d, 'top');
    backTex.needsUpdate = true;
  }

  const bottomMat = new THREE.MeshBasicMaterial({ map: bottomTex });
  const frontMat = new THREE.MeshBasicMaterial({ map: frontTex });
  const backMat = new THREE.MeshBasicMaterial({ map: backTex });

  const bottomCard = new THREE.Mesh(new THREE.PlaneGeometry(DIGIT_W, halfH + overlap), bottomMat);
  bottomCard.position.y = -(halfH - overlap) / 2;
  bottomCard.renderOrder = 2;

  const hinge = new THREE.Group();
  const topFlap = new THREE.Mesh(new THREE.PlaneGeometry(DIGIT_W, halfH + overlap), frontMat);
  topFlap.position.y = (halfH - overlap) / 2;
  topFlap.renderOrder = 3;
  hinge.add(topFlap);

  const topFlapBack = new THREE.Mesh(new THREE.PlaneGeometry(DIGIT_W, halfH + overlap), backMat);
  topFlapBack.position.y = (halfH - overlap) / 2;
  topFlapBack.rotation.y = Math.PI;
  topFlapBack.renderOrder = 3;
  hinge.add(topFlapBack);

  group.add(bottomCard, hinge);

  refreshBottom(0);
  refreshFront(0);
  refreshBack(0);

  group.userData.flip = {
    state,
    hinge,
    refreshBottom,
    refreshFront,
    refreshBack,
    setImmediate(d) {
      state.current = d;
      state.target = d;
      state.animating = false;
      state.progress = 0;
      state.swapped = false;
      hinge.rotation.x = 0;
      refreshBottom(d);
      refreshFront(d);
      refreshBack(d);
    },
    flipTo(d) {
      if (state.animating) {
        if (state.target === d) return;
        state.current = state.target;
        state.animating = false;
        state.progress = 0;
        state.swapped = false;
        hinge.rotation.x = 0;
        refreshBottom(state.current);
        refreshFront(state.current);
      }
      if (state.current === d) return;
      state.target = d;
      state.animating = true;
      state.progress = 0;
      state.swapped = false;
      refreshBack(d);
    },
    tick(dt) {
      if (!state.animating) return;
      state.progress += dt / FLIP_DURATION;
      const t = Math.min(1, state.progress);
      const eased = smootherstep(0, 1, t);
      hinge.rotation.x = -Math.PI * eased;
      if (t >= 0.5 && !state.swapped) {
        state.swapped = true;
        refreshBottom(state.target);
      }
      if (t >= 1) {
        state.current = state.target;
        state.animating = false;
        state.progress = 0;
        state.swapped = false;
        hinge.rotation.x = 0;
        refreshFront(state.current);
        refreshBack(state.current);
        refreshBottom(state.current);
      }
    },
  };

  return group;
}

function makeFlipModule(x, digitCount = 2) {
  const mod = new THREE.Group();
  mod.position.x = x;

  const pad = 0.06;
  const innerW = digitCount * DIGIT_W + (digitCount - 1) * 0.018 + pad * 2;
  const innerH = DIGIT_H + pad * 2;

  const housing = new THREE.Mesh(
    new THREE.PlaneGeometry(innerW, innerH),
    new THREE.MeshBasicMaterial({ color: 0x050505 })
  );
  housing.position.z = -0.004;
  mod.add(housing);

  const digits = [];
  const startX = -((digitCount - 1) * (DIGIT_W + 0.018)) / 2;
  for (let i = 0; i < digitCount; i++) {
    const d = makeFlipDigit();
    d.position.set(startX + i * (DIGIT_W + 0.018), 0, 0);
    mod.add(d);
    digits.push(d);
  }

  mod.userData.digits = digits;
  return mod;
}

const woodTex = makeWoodTexture();
const woodMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  map: woodTex,
  roughness: 0.78,
  metalness: 0,
  bumpMap: noiseTex,
  bumpScale: 0.12,
  envMapIntensity: 0.55,
});

const FRAME_W = 1.55;
const FRAME_H = 0.82;
const FRAME_D = 0.38;
const FRAME_WALL = 0.1;
const OPEN_W = FRAME_W - FRAME_WALL * 2;
const OPEN_H = FRAME_H - FRAME_WALL * 2;
const HALF_D = FRAME_D / 2;
const DISPLAY_Z = HALF_D + 0.002;

function woodBar(w, h, d, x, y, z) {
  const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), woodMaterial);
  bar.position.set(x, y, z);
  return bar;
}

const flipFrame = new THREE.Group();
flipFrame.add(woodBar(FRAME_W, FRAME_H, 0.05, 0, 0, -HALF_D + 0.025));
flipFrame.add(woodBar(FRAME_W, FRAME_WALL, FRAME_D, 0, FRAME_H / 2 - FRAME_WALL / 2, 0));
flipFrame.add(woodBar(FRAME_W, FRAME_WALL, FRAME_D, 0, -FRAME_H / 2 + FRAME_WALL / 2, 0));
flipFrame.add(woodBar(FRAME_WALL, OPEN_H, FRAME_D, -FRAME_W / 2 + FRAME_WALL / 2, 0, 0));
flipFrame.add(woodBar(FRAME_WALL, OPEN_H, FRAME_D, FRAME_W / 2 - FRAME_WALL / 2, 0, 0));

const recess = new THREE.Mesh(
  new THREE.PlaneGeometry(OPEN_W, OPEN_H),
  new THREE.MeshBasicMaterial({ color: 0x030303 })
);
recess.position.z = DISPLAY_Z - 0.008;

const hourModule = makeFlipModule(-0.36, 2);
const minuteModule = makeFlipModule(0.36, 2);
hourModule.position.z = DISPLAY_Z;
minuteModule.position.z = DISPLAY_Z;

const divider = new THREE.Mesh(
  new THREE.PlaneGeometry(0.012, OPEN_H - 0.04),
  new THREE.MeshBasicMaterial({ color: 0x080808 })
);
divider.position.set(0, 0, DISPLAY_Z - 0.004);

const ampmCanvas = document.createElement('canvas');
ampmCanvas.width = 64;
ampmCanvas.height = 32;
const ampmCtx = ampmCanvas.getContext('2d');
const ampmTex = new THREE.CanvasTexture(ampmCanvas);
ampmTex.colorSpace = THREE.SRGBColorSpace;

function drawAmpm(isPM) {
  ampmCtx.fillStyle = 'rgba(0,0,0,0)';
  ampmCtx.clearRect(0, 0, ampmCanvas.width, ampmCanvas.height);
  ampmCtx.fillStyle = '#c8c6c2';
  ampmCtx.font = '600 18px "Helvetica Neue", Helvetica, Arial, sans-serif';
  ampmCtx.textAlign = 'left';
  ampmCtx.textBaseline = 'top';
  ampmCtx.fillText(isPM ? 'PM' : 'AM', 4, 6);
  ampmTex.needsUpdate = true;
}

const ampmLabel = new THREE.Mesh(
  new THREE.PlaneGeometry(0.11, 0.055),
  new THREE.MeshBasicMaterial({ map: ampmTex, transparent: true, depthWrite: false })
);
ampmLabel.position.set(-0.58, 0.28, DISPLAY_Z + 0.002);
drawAmpm(false);

const flipButton = makeBackButton(
  woodMaterial,
  new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.85, metalness: 0 }),
  -(HALF_D + 0.02)
);

const flipBody = new THREE.Group();
flipBody.add(flipFrame, recess, divider, hourModule, minuteModule, ampmLabel, flipButton);

const flipDigits = {
  hour: hourModule.userData.digits.map((d) => d.userData.flip),
  minute: minuteModule.userData.digits.map((d) => d.userData.flip),
};

// ===========================================================================
// CLOCK 5 — matte black alarm clock with red dot-matrix LED display
// ===========================================================================
const LED_FRAME_W = 1.32;
const LED_FRAME_H = 0.62;
const LED_FRAME_D = 0.4;
const LED_BEZEL = 0.09;
const LED_OPEN_W = LED_FRAME_W - LED_BEZEL * 2;
const LED_OPEN_H = LED_FRAME_H - LED_BEZEL * 2;
const LED_FACE_Z = LED_FRAME_D / 2;

const alarmMaterial = new THREE.MeshStandardMaterial({
  color: 0x141414,
  roughness: 0.93,
  metalness: 0.04,
  bumpMap: noiseTex,
  bumpScale: 0.18,
  envMapIntensity: 0.3,
});

const ledBodyMesh = new THREE.Mesh(
  new THREE.ExtrudeGeometry(roundedRectShape(LED_FRAME_W, LED_FRAME_H, 0.13), {
    depth: LED_FRAME_D,
    bevelEnabled: true,
    bevelThickness: 0.016,
    bevelSize: 0.016,
    bevelSegments: 2,
    curveSegments: 16,
  }),
  alarmMaterial
);
ledBodyMesh.position.z = -LED_FRAME_D / 2;

const DOT_FONT = {
  '0': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['01110', '10001', '00001', '00110', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};

const ledCanvas = document.createElement('canvas');
ledCanvas.width = 640;
ledCanvas.height = 176;
const ledCtx = ledCanvas.getContext('2d');
const ledTex = new THREE.CanvasTexture(ledCanvas);
ledTex.colorSpace = THREE.SRGBColorSpace;
ledTex.minFilter = THREE.LinearFilter;

function drawLedMatrix(hourText, minText, showColon) {
  const w = ledCanvas.width;
  const h = ledCanvas.height;
  const cols = 5;
  const rows = 7;
  const pitch = 16;
  const dotR = 4.2;
  const digitGap = 10;
  const colonGap = 14;
  const digits = hourText + minText;

  const digitW = cols * pitch;
  const colonW = pitch * 2;
  const totalW = digitW * 4 + digitGap * 2 + colonGap * 2 + colonW;
  const totalH = rows * pitch;
  const ox = (w - totalW) / 2 + pitch * 0.5;
  const oy = (h - totalH) / 2 + pitch * 0.5;

  ledCtx.fillStyle = '#040404';
  ledCtx.fillRect(0, 0, w, h);

  const sheen = ledCtx.createLinearGradient(0, 0, w, h * 0.6);
  sheen.addColorStop(0, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(0.4, 'rgba(255,255,255,0)');
  ledCtx.fillStyle = sheen;
  ledCtx.fillRect(0, 0, w, h);

  function digitOrigin(index) {
    if (index < 2) return ox + index * (digitW + digitGap);
    return ox + 2 * (digitW + digitGap) + colonGap * 2 + colonW + (index - 2) * (digitW + digitGap);
  }

  // Inactive dot grid
  for (let d = 0; d < 4; d++) {
    const dx = digitOrigin(d);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        ledCtx.beginPath();
        ledCtx.arc(dx + col * pitch, oy + row * pitch, dotR, 0, Math.PI * 2);
        ledCtx.fillStyle = '#181818';
        ledCtx.fill();
      }
    }
  }

  // Colon ghost dots
  const colonX = ox + 2 * (digitW + digitGap) + colonGap + pitch * 0.5;
  for (const row of [2, 4]) {
    ledCtx.beginPath();
    ledCtx.arc(colonX, oy + row * pitch, dotR * 1.15, 0, Math.PI * 2);
    ledCtx.fillStyle = '#181818';
    ledCtx.fill();
  }

  // Lit digit dots
  for (let d = 0; d < 4; d++) {
    const pattern = DOT_FONT[digits[d]] ?? DOT_FONT['0'];
    const dx = digitOrigin(d);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (pattern[row][col] !== '1') continue;
        ledCtx.save();
        ledCtx.shadowColor = '#ff3300';
        ledCtx.shadowBlur = 14;
        ledCtx.beginPath();
        ledCtx.arc(dx + col * pitch, oy + row * pitch, dotR, 0, Math.PI * 2);
        ledCtx.fillStyle = '#ff2800';
        ledCtx.fill();
        ledCtx.restore();
      }
    }
  }

  // White colon
  if (showColon) {
    for (const row of [2, 4]) {
      ledCtx.save();
      ledCtx.shadowColor = '#ffffff';
      ledCtx.shadowBlur = 12;
      ledCtx.beginPath();
      ledCtx.arc(colonX, oy + row * pitch, dotR * 1.35, 0, Math.PI * 2);
      ledCtx.fillStyle = '#ffffff';
      ledCtx.fill();
      ledCtx.restore();
    }
  }

  // Inset white bezel line
  const inset = 10;
  const bw = 2;
  ledCtx.strokeStyle = 'rgba(255,255,255,0.92)';
  ledCtx.lineWidth = bw;
  ledCtx.beginPath();
  const rx = inset;
  const ry = inset;
  const rw = w - inset * 2;
  const rh = h - inset * 2;
  const rr = 12;
  ledCtx.moveTo(rx + rr, ry);
  ledCtx.lineTo(rx + rw - rr, ry);
  ledCtx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + rr);
  ledCtx.lineTo(rx + rw, ry + rh - rr);
  ledCtx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - rr, ry + rh);
  ledCtx.lineTo(rx + rr, ry + rh);
  ledCtx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - rr);
  ledCtx.lineTo(rx, ry + rr);
  ledCtx.quadraticCurveTo(rx, ry, rx + rr, ry);
  ledCtx.closePath();
  ledCtx.stroke();

  ledTex.needsUpdate = true;
}

const ledDisplay = new THREE.Mesh(
  new THREE.PlaneGeometry(LED_OPEN_W, LED_OPEN_H),
  new THREE.MeshBasicMaterial({
    map: ledTex,
    toneMapped: false,
  })
);
ledDisplay.position.z = LED_FACE_Z + 0.028;
ledDisplay.renderOrder = 5;

const ledGlass = new THREE.Mesh(
  new THREE.PlaneGeometry(LED_OPEN_W + 0.006, LED_OPEN_H + 0.006),
  new THREE.MeshPhysicalMaterial({
    color: 0x080808,
    transparent: true,
    opacity: 0.18,
    roughness: 0.06,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    depthWrite: false,
  })
);
ledGlass.position.z = LED_FACE_Z + 0.034;
ledGlass.renderOrder = 6;

const ledButton = makeBackButton(
  alarmMaterial,
  new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.85, metalness: 0.1 }),
  -(LED_FRAME_D / 2 + 0.02)
);

const ledBody = new THREE.Group();
ledBody.add(ledBodyMesh, ledDisplay, ledGlass, ledButton);
drawLedMatrix('10', '47', true);

// ===========================================================================
// Assembly — each clock: body inside spinGroup (user rotation), side by side
// ===========================================================================
function makeClock(body, x, scale) {
  const spinGroup = new THREE.Group();
  spinGroup.add(body);
  spinGroup.position.x = x;
  spinGroup.scale.setScalar(scale);
  spinGroup.userData.isClock = true;
  spinGroup.userData.homeX = x;
  spinGroup.userData.homeScale = scale;
  spinGroup.userData.velX = 0;
  spinGroup.userData.velY = 0;
  spinGroup.userData.resetting = false;
  scene.add(spinGroup);
  return spinGroup;
}

const metalClock = makeClock(metalBody, -4.7, 0.78);
const stoneClock = makeClock(stoneBody, -2.35, 0.74);
const flipClock = makeClock(flipBody, 0, 0.90);
const discClock = makeClock(discBody, 2.35, 0.80);
const ledClock = makeClock(ledBody, 4.7, 0.92);
const clocks = [metalClock, stoneClock, flipClock, discClock, ledClock];

let focusedClock = null;
let galleryZoom = homeZoom();

// Natural Selection ProductDetail FLIP (naturalselection.so)
const FOCUS_OPEN_MS = 560;
const FOCUS_CLOSE_MS = 336;
const FOCUS_IMAGE_SCALE = 1;
const FOCUS_TARGET_PX = () => Math.min(560, window.innerWidth * 0.52);

function makeCubicBezier(p1x, p1y, p2x, p2y) {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-5) break;
      t -= err / sampleDX(t);
    }
    return sampleY(t);
  };
}

const easeFocus = makeCubicBezier(0.1, 0, 0, 1);

let focusAnim = { phase: 'idle', startMs: 0, originRect: null, focusScale: 1 };

const _flipBox = new THREE.Box3();
const _flipV = new THREE.Vector3();
const _flipCenter = new THREE.Vector3();
const _flipUnproj = new THREE.Vector3();

function measureScreenRect(object) {
  _flipBox.setFromObject(object);
  const { min, max } = _flipBox;
  const corners = [
    [min.x, min.y, min.z], [max.x, min.y, min.z], [min.x, max.y, min.z], [max.x, max.y, min.z],
    [min.x, min.y, max.z], [max.x, min.y, max.z], [min.x, max.y, max.z], [max.x, max.y, max.z],
  ];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const [x, y, z] of corners) {
    _flipV.set(x, y, z).project(camera);
    const sx = (_flipV.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-_flipV.y * 0.5 + 0.5) * window.innerHeight;
    left = Math.min(left, sx);
    right = Math.max(right, sx);
    top = Math.min(top, sy);
    bottom = Math.max(bottom, sy);
  }
  return { left, top, width: right - left, height: bottom - top };
}

function screenDeltaToWorld(dx, dy, refPoint) {
  refPoint.project(camera);
  const z = refPoint.z;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const unproject = (sx, sy, out) => {
    out.set((sx / w) * 2 - 1, -(sy / h) * 2 + 1, z).unproject(camera);
    return out;
  };
  const cx = w * 0.5;
  const cy = h * 0.5;
  const a = unproject(cx, cy, new THREE.Vector3());
  const b = unproject(cx + dx, cy + dy, _flipUnproj);
  return b.sub(a);
}

// NS ProductDetail: translate(a,l) scale(r) → identity, transform-origin top left
function flipTransform(origin, dest, imageScale = FOCUS_IMAGE_SCALE) {
  const r = dest.width === 0 ? 1 : origin.width / (dest.width * imageScale);
  const ox = dest.width * r * (1 - imageScale) * 0.5;
  const oy = dest.height * r * (1 - imageScale) * 0.5;
  return {
    r,
    tx: origin.left - dest.left - ox,
    ty: origin.top - dest.top - oy,
  };
}

function captureFlipMetrics(clock) {
  const u = clock.userData;
  clock.position.set(u.homeX, 0, 0);
  clock.scale.setScalar(u.homeScale);
  clock.updateMatrixWorld(true);
  const originRect = measureScreenRect(clock);

  const focusScale = u.homeScale * (FOCUS_TARGET_PX() / originRect.width);
  clock.position.set(0, 0, 0);
  clock.scale.setScalar(focusScale);
  clock.updateMatrixWorld(true);
  const destRect = measureScreenRect(clock);

  clock.position.set(u.homeX, 0, 0);
  clock.scale.setScalar(u.homeScale);

  return { originRect, destRect, focusScale };
}

function applyHeroFlip(clock, progress, closing) {
  const u = clock.userData;
  const { originRect, focusScale } = focusAnim;
  const e = closing ? 1 - progress : progress;

  clock.position.set(0, 0, 0);
  clock.scale.setScalar(focusScale);
  clock.updateMatrixWorld(true);
  const destRect = measureScreenRect(clock);
  const { r, tx, ty } = flipTransform(originRect, destRect);

  const flipScale = r + (1 - r) * e;
  const flipTx = tx * (1 - e);
  const flipTy = ty * (1 - e);

  const destCx = destRect.left + destRect.width * 0.5;
  const destCy = destRect.top + destRect.height * 0.5;
  const visualCx = destRect.left + flipTx + (destRect.width * flipScale) * 0.5;
  const visualCy = destRect.top + flipTy + (destRect.height * flipScale) * 0.5;

  clock.getWorldPosition(_flipCenter);
  const worldOffset = screenDeltaToWorld(visualCx - destCx, visualCy - destCy, _flipCenter);
  clock.position.x = worldOffset.x;
  clock.position.y = worldOffset.y;
  clock.scale.setScalar(focusScale * flipScale);
}

const DEFAULT_EPS = 0.02;

function isAtDefault(clock) {
  const u = clock.userData;
  if (u.resetting) return false;
  if (Math.abs(u.velX) > 0.001 || Math.abs(u.velY) > 0.001) return false;
  const r = clock.rotation;
  return (
    Math.abs(r.x) < DEFAULT_EPS &&
    Math.abs(r.y) < DEFAULT_EPS &&
    Math.abs(r.z) < DEFAULT_EPS
  );
}

function layoutFocus(nowMs) {
  const { phase } = focusAnim;

  if (phase === 'idle') {
    for (const clock of clocks) {
      const u = clock.userData;
      clock.position.set(u.homeX, 0, 0);
      clock.scale.setScalar(u.homeScale);
      clock.visible = true;
    }
    camera.position.z = galleryZoom;
    return;
  }

  const elapsed = nowMs - focusAnim.startMs;
  const closing = phase === 'closing';
  const settled = phase === 'open';

  const heroDur = closing ? FOCUS_CLOSE_MS : FOCUS_OPEN_MS;
  const heroT = settled ? 1 : Math.min(1, elapsed / heroDur);
  const heroE = easeFocus(heroT);

  for (const clock of clocks) {
    const u = clock.userData;
    const isFocused = clock === focusedClock;

    if (isFocused) {
      applyHeroFlip(clock, heroE, closing);
      clock.visible = true;
    } else {
      clock.position.set(u.homeX, 0, 0);
      clock.scale.setScalar(u.homeScale);
      clock.visible = closing && heroT >= 1;
    }
  }

  camera.position.z = galleryZoom;

  if (phase === 'opening' && heroT >= 1) {
    focusAnim.phase = 'open';
  }
  if (phase === 'closing' && heroT >= 1) {
    focusedClock = null;
    focusAnim = { phase: 'idle', startMs: 0, originRect: null, focusScale: 1 };
  }
}

function focusClock(clock) {
  if (focusAnim.phase === 'opening' || focusAnim.phase === 'closing') return;
  if (focusedClock === clock && focusAnim.phase === 'open') return;
  const metrics = captureFlipMetrics(clock);
  focusedClock = clock;
  focusAnim = {
    phase: 'opening',
    startMs: performance.now(),
    originRect: metrics.originRect,
    focusScale: metrics.focusScale,
  };
}

function unfocusClock() {
  if (!focusedClock || focusAnim.phase === 'closing') return;
  focusAnim = { ...focusAnim, phase: 'closing', startMs: performance.now() };
}

function handleSelect(clientX, clientY, clockFromDown) {
  const { clock, button } = pickAt(clientX, clientY);
  if (button) openSettings();
  else if (clockFromDown || clock) {
    if (focusAnim.phase === 'opening' || focusAnim.phase === 'closing') return;
    const target = clockFromDown || clock;
    if (isAtDefault(target)) focusClock(target);
    else startReset(target);
  } else if (focusedClock) unfocusClock();
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && focusedClock) unfocusClock();
});

// ---------------------------------------------------------------------------
// Interaction: drag a clock to spin it (with inertia), click to reset or focus,
// click outside to return, click its back button for settings, scroll/pinch to zoom
// ---------------------------------------------------------------------------
let dragging = false;
let activeClock = null;
let lastX = 0;
let lastY = 0;
const pointers = new Map();
let pinchDist = 0;

const raycaster = new THREE.Raycaster();
let downX = 0;
let downY = 0;
let tapClock = null;
let didDrag = false;

function pickAt(clientX, clientY) {
  const ndc = new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(clocks, true);
  for (const hit of hits) {
    let obj = hit.object;
    let button = false;
    let clock = null;
    while (obj) {
      if (obj.userData.isSettingsButton) button = true;
      if (obj.userData.isClock) clock = obj;
      obj = obj.parent;
    }
    if (!clock) continue;
    if (focusedClock && clock !== focusedClock && !button) continue;
    return { clock, button };
  }
  return { clock: null, button: false };
}

canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    const { clock } = pickAt(e.clientX, e.clientY);
    activeClock = clock;
    tapClock = clock;
    dragging = !!clock;
    didDrag = false;
    lastX = e.clientX;
    lastY = e.clientY;
    downX = e.clientX;
    downY = e.clientY;
    if (clock) {
      clock.userData.resetting = false;
      clock.userData.velX = 0;
      clock.userData.velY = 0;
    }
    canvas.classList.add('dragging');
  } else if (pointers.size === 2) {
    dragging = false;
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    zoomBy((pinchDist - dist) * 0.01);
    pinchDist = dist;
    return;
  }

  if (!dragging || !activeClock) return;
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) didDrag = true;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  const u = activeClock.userData;
  u.velX = dx * 0.005;
  u.velY = dy * 0.005;
  activeClock.rotation.y += u.velX;
  activeClock.rotation.x += u.velY;
});

// A clean click on a rotated clock snaps it home; at default it can enter focus
function startReset(clock) {
  const wrap = (a) => THREE.MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI;
  clock.rotation.x = wrap(clock.rotation.x);
  clock.rotation.y = wrap(clock.rotation.y);
  clock.rotation.z = wrap(clock.rotation.z);
  clock.userData.velX = 0;
  clock.userData.velY = 0;
  clock.userData.resetting = true;
}

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    dragging = false;
    activeClock = null;
    canvas.classList.remove('dragging');
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('click', (e) => {
  if (didDrag) {
    tapClock = null;
    return;
  }
  handleSelect(e.clientX, e.clientY, tapClock);
  tapClock = null;
});

function zoomBy(delta) {
  if (focusedClock || focusAnim.phase !== 'idle') return;
  galleryZoom = THREE.MathUtils.clamp(galleryZoom + delta, homeZoom() * 0.55, homeZoom() * 1.15);
}

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    zoomBy(e.deltaY * 0.0025);
  },
  { passive: false }
);

// ---------------------------------------------------------------------------
// Settings: manual time (stored as an offset from real time) + time zone
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const settingsPanel = $('settings');

const clockSettings = {
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  offsetMs: 0,
  format12: true,
};

function makeTzFormatter(tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
}
let tzFormatter = makeTzFormatter(clockSettings.timeZone);

// Wall-clock parts of `date` in the configured time zone
function tzParts(date) {
  const parts = {};
  for (const p of tzFormatter.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = parseInt(p.value, 10);
  }
  if (parts.hour === 24) parts.hour = 0;
  return parts;
}

const tzSelect = $('set-tz');
const zones =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Europe/Zurich', 'Asia/Tokyo', 'UTC'];
for (const z of zones) {
  const opt = document.createElement('option');
  opt.value = z;
  opt.textContent = z;
  tzSelect.appendChild(opt);
}

const pad2 = (n) => String(n).padStart(2, '0');

function openSettings() {
  const p = tzParts(new Date(Date.now() + clockSettings.offsetMs));
  if (clockSettings.format12) {
    $('set-hour').value = pad2(((p.hour + 11) % 12) + 1);
    $('set-ampm').value = p.hour >= 12 ? 'PM' : 'AM';
  } else {
    $('set-hour').value = pad2(p.hour);
  }
  $('set-min').value = pad2(p.minute);
  $('set-month').value = String(p.month);
  $('set-day').value = pad2(p.day);
  $('set-year').value = String(p.year);
  tzSelect.value = clockSettings.timeZone;
  settingsPanel.classList.remove('hidden');
}

function setFormat(is12) {
  const hourInput = $('set-hour');
  const hour = parseInt(hourInput.value, 10) || 0;
  if (is12 && !clockSettings.format12) {
    hourInput.value = pad2(((hour + 11) % 12) + 1);
    $('set-ampm').value = hour >= 12 ? 'PM' : 'AM';
  } else if (!is12 && clockSettings.format12) {
    hourInput.value = pad2((hour % 12) + ($('set-ampm').value === 'PM' ? 12 : 0));
  }
  clockSettings.format12 = is12;
  hourInput.min = is12 ? 1 : 0;
  hourInput.max = is12 ? 12 : 23;
  $('fmt-12').classList.toggle('active', is12);
  $('fmt-24').classList.toggle('active', !is12);
  document.querySelector('.select-wrap.ampm').style.display = is12 ? '' : 'none';
}

$('fmt-12').addEventListener('click', () => setFormat(true));
$('fmt-24').addEventListener('click', () => setFormat(false));
$('settings-close').addEventListener('click', () => settingsPanel.classList.add('hidden'));

$('settings-save').addEventListener('click', () => {
  clockSettings.timeZone = tzSelect.value;
  tzFormatter = makeTzFormatter(clockSettings.timeZone);

  let hour = parseInt($('set-hour').value, 10) || 0;
  if (clockSettings.format12) {
    hour = (hour % 12) + ($('set-ampm').value === 'PM' ? 12 : 0);
  }
  const minute = parseInt($('set-min').value, 10) || 0;
  const month = parseInt($('set-month').value, 10) || 1;
  const day = parseInt($('set-day').value, 10) || 1;
  const year = parseInt($('set-year').value, 10) || 2026;

  // Shift the offset so the wall clock in the chosen zone reads the entered
  // date/time; seconds keep running uninterrupted.
  const cur = tzParts(new Date(Date.now() + clockSettings.offsetMs));
  const currentUTC = Date.UTC(cur.year, cur.month - 1, cur.day, cur.hour, cur.minute, cur.second);
  const desiredUTC = Date.UTC(year, month - 1, day, hour, minute, cur.second);
  clockSettings.offsetMs += desiredUTC - currentUTC;

  flipClockReady = false;
  settingsPanel.classList.add('hidden');
});

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
const TWO_PI = Math.PI * 2;
let lastScreenKey = '';
let lastLedKey = '';
let flipClockReady = false;
let lastFlipMs = performance.now();

function updateFlipClock(p, dt) {
  const hourText = clockSettings.format12 ? pad2(((p.hour + 11) % 12) + 1) : pad2(p.hour);
  const minText = pad2(p.minute);

  if (!flipClockReady) {
    for (let i = 0; i < 2; i++) {
      flipDigits.hour[i].setImmediate(parseInt(hourText[i], 10));
      flipDigits.minute[i].setImmediate(parseInt(minText[i], 10));
    }
    drawAmpm(p.hour >= 12);
    flipClockReady = true;
    return;
  }

  for (let i = 0; i < 2; i++) {
    flipDigits.hour[i].flipTo(parseInt(hourText[i], 10));
    flipDigits.minute[i].flipTo(parseInt(minText[i], 10));
    flipDigits.hour[i].tick(dt);
    flipDigits.minute[i].tick(dt);
  }
  drawAmpm(p.hour >= 12);
}

function updateClocks(dt = 0.016) {
  const now = new Date(Date.now() + clockSettings.offsetMs);
  const p = tzParts(now);

  // Analog hands (smooth sweep)
  const s = p.second + now.getMilliseconds() / 1000;
  const m = p.minute + s / 60;
  const h = (p.hour % 12) + m / 60;
  hourHand.rotation.z = -(h / 12) * TWO_PI;
  minuteHand.rotation.z = -(m / 60) * TWO_PI;
  secondHand.rotation.z = -(s / 60) * TWO_PI;
  discHourHand.rotation.z = -(h / 12) * TWO_PI;
  discMinuteHand.rotation.z = -(m / 60) * TWO_PI;

  // Digital screen (redraw only when the displayed value changes)
  const hourText = clockSettings.format12 ? pad2(((p.hour + 11) % 12) + 1) : pad2(p.hour);
  const minText = pad2(p.minute);
  const key = hourText + ':' + minText;
  if (key !== lastScreenKey) {
    lastScreenKey = key;
    drawScreen(hourText, minText);
  }

  const showColon = p.second % 2 === 0;
  const ledKey = key + (showColon ? ':on' : ':off');
  if (ledKey !== lastLedKey) {
    lastLedKey = ledKey;
    drawLedMatrix(hourText, minText, showColon);
  }

  updateFlipClock(p, dt);
}

renderer.setAnimationLoop(() => {
  const nowMs = performance.now();
  const dt = Math.min(0.05, (nowMs - lastFlipMs) / 1000);
  lastFlipMs = nowMs;

  for (const clock of clocks) {
    const u = clock.userData;

    if (u.resetting) {
      const r = clock.rotation;
      r.x += -r.x * 0.08;
      r.y += -r.y * 0.08;
      r.z += -r.z * 0.08;
      if (Math.abs(r.x) < 0.001 && Math.abs(r.y) < 0.001 && Math.abs(r.z) < 0.001) {
        r.set(0, 0, 0);
        u.resetting = false;
      }
    } else if (!(dragging && activeClock === clock)) {
      clock.rotation.y += u.velX;
      clock.rotation.x += u.velY;
      u.velX *= 0.95;
      u.velY *= 0.95;
    }
  }

  layoutFocus(nowMs);

  updateClocks(dt);
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  galleryZoom = homeZoom();
});
