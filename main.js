import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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

const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 50);
const HOME_ZOOM = 5.6;
camera.position.set(0, 0.35, HOME_ZOOM);
camera.lookAt(0, -0.05, 0);

// Image-based lighting for realistic metal reflections
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

// Fine-grain noise canvas used as bump + roughness variation on the metal
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

// ---------------------------------------------------------------------------
// Pebble body — sculpted from a high-res sphere:
// organic outline, flattened depth, recessed crater for the dial
// ---------------------------------------------------------------------------
const DIAL_CENTER = new THREE.Vector2(0.05, 0.09);
const CRATER_FLOOR_Z = 0.21;

function buildPebbleGeometry() {
  const geo = new THREE.SphereGeometry(1, 256, 256);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let { x, y, z } = v;

    // Organic, slightly asymmetric outline (rounded-pebble silhouette)
    const theta = Math.atan2(y, x);
    const rXY =
      1 +
      0.09 * Math.sin(theta + 2.0) +
      0.055 * Math.sin(2 * theta + 0.8) +
      0.04 * Math.sin(3 * theta + 2.6);
    x *= rXY;
    y *= rXY;

    // Flatten depth; tanh keeps the front/back faces flatter while the
    // silhouette edge stays plump like a river stone
    z = (Math.tanh(z * 1.4) / Math.tanh(1.4)) * 0.55;

    // Overall proportions
    x *= 1.24;
    y *= 1.22;

    // Recessed crater on the front where the dial sits
    const d = Math.hypot(x - DIAL_CENTER.x, y - DIAL_CENTER.y);
    const crater = smoothstep(1.02, 0.72, d);
    const frontWeight = smoothstep(0.05, 0.3, z);
    z -= 0.36 * crater * frontWeight;

    // Subtle low-frequency surface irregularity (suppressed inside the
    // crater so the floor stays safely below the dial plane)
    const n =
      0.012 *
      (1 - crater * frontWeight) *
      Math.sin(7 * x + 1.3) *
      Math.sin(6 * y + 2.1) *
      Math.sin(5 * z + 0.7);
    const len = Math.hypot(x, y, z) || 1;
    x += (x / len) * n;
    y += (y / len) * n;
    z += (z / len) * n;

    pos.setXYZ(i, x, y, z);
  }

  geo.computeVertexNormals();
  return geo;
}

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

const pebble = new THREE.Mesh(buildPebbleGeometry(), pebbleMaterial);

// ---------------------------------------------------------------------------
// Dial assembly — orange face, tick marks, hands, hub, glass
// ---------------------------------------------------------------------------
const CREAM = 0xe8dcc0;
const ORANGE_DIAL = 0xbd5504;
const ORANGE_HAND = 0xd93a05;

const dial = new THREE.Group();
dial.position.set(DIAL_CENTER.x, DIAL_CENTER.y, CRATER_FLOOR_Z + 0.005);

// Dark seam ring behind the dial edge (fakes ambient occlusion in the recess)
const seam = new THREE.Mesh(
  new THREE.CircleGeometry(0.72, 96),
  new THREE.MeshStandardMaterial({ color: 0x584a38, roughness: 1, metalness: 0 })
);
seam.position.z = -0.008;
dial.add(seam);

// Orange face
const face = new THREE.Mesh(
  new THREE.CircleGeometry(0.7, 96),
  new THREE.MeshStandardMaterial({ color: ORANGE_DIAL, roughness: 0.9, metalness: 0 })
);
dial.add(face);

// Inner-shadow overlay — fakes the crater wall's ambient occlusion on the dial
function makeInnerShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(256, 256, 150, 256, 256, 256);
  g.addColorStop(0, 'rgba(30, 15, 0, 0)');
  g.addColorStop(0.8, 'rgba(30, 15, 0, 0.08)');
  g.addColorStop(1, 'rgba(30, 15, 0, 0.4)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  return new THREE.CanvasTexture(c);
}

const innerShadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.7, 96),
  new THREE.MeshBasicMaterial({
    map: makeInnerShadowTexture(),
    transparent: true,
    depthWrite: false,
  })
);
innerShadow.position.z = 0.002;
dial.add(innerShadow);

// Thin polished bezel ring seating the dial into the crater
const bezel = new THREE.Mesh(
  new THREE.TorusGeometry(0.715, 0.016, 24, 128),
  new THREE.MeshPhysicalMaterial({
    color: 0xb0a28c,
    metalness: 0.85,
    roughness: 0.32,
    envMapIntensity: 1.0,
  })
);
bezel.position.z = 0.002;
dial.add(bezel);

// Tick marks: 12 hour marks + minute marks
const tickMat = new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.6, metalness: 0 });
const hourTickGeo = new THREE.BoxGeometry(0.012, 0.13, 0.008);
const minTickGeo = new THREE.BoxGeometry(0.006, 0.035, 0.006);

for (let i = 0; i < 60; i++) {
  const isHour = i % 5 === 0;
  const tick = new THREE.Mesh(isHour ? hourTickGeo : minTickGeo, tickMat);
  const angle = (i / 60) * Math.PI * 2;
  const radius = isHour ? 0.58 : 0.63;
  tick.position.set(Math.sin(angle) * radius, Math.cos(angle) * radius, 0.006);
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

// ---------------------------------------------------------------------------
// Settings button on the back — raised disc outlined by a darker ring
// ---------------------------------------------------------------------------
const backButton = new THREE.Group();
backButton.userData.isSettingsButton = true;

const btnDisc = new THREE.Mesh(
  new THREE.CylinderGeometry(0.095, 0.095, 0.03, 48),
  pebbleMaterial
);
btnDisc.rotation.x = Math.PI / 2;
backButton.add(btnDisc);

const btnRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.115, 0.007, 16, 96),
  new THREE.MeshPhysicalMaterial({
    color: 0x8f8271,
    metalness: 0.8,
    roughness: 0.55,
    envMapIntensity: 0.8,
  })
);
btnRing.position.z = -0.008;
backButton.add(btnRing);

backButton.position.set(0, 0, -0.56);

// ---------------------------------------------------------------------------
// Assembly: floatGroup (idle bob) inside spinGroup (user rotation)
// ---------------------------------------------------------------------------
const clockBody = new THREE.Group();
clockBody.add(pebble, dial, backButton);

const floatGroup = new THREE.Group();
floatGroup.add(clockBody);

const spinGroup = new THREE.Group();
spinGroup.add(floatGroup);
spinGroup.rotation.set(0, 0, 0);
scene.add(spinGroup);

// Soft floating shadow beneath
function makeShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 120);
  g.addColorStop(0, 'rgba(60, 50, 40, 0.55)');
  g.addColorStop(0.5, 'rgba(60, 50, 40, 0.22)');
  g.addColorStop(1, 'rgba(60, 50, 40, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(3.4, 3),
  new THREE.MeshBasicMaterial({
    map: makeShadowTexture(),
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  })
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = -1.65;
scene.add(shadow);

// ---------------------------------------------------------------------------
// Interaction: drag to spin the pebble (with inertia), scroll/pinch to zoom
// ---------------------------------------------------------------------------
let dragging = false;
let lastX = 0;
let lastY = 0;
let velX = 0;
let velY = 0;
const pointers = new Map();
let pinchDist = 0;

// Click-to-reset state
const raycaster = new THREE.Raycaster();
let downX = 0;
let downY = 0;
let resetting = false;

canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    dragging = true;
    resetting = false;
    lastX = e.clientX;
    lastY = e.clientY;
    downX = e.clientX;
    downY = e.clientY;
    velX = 0;
    velY = 0;
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

  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  velX = dx * 0.005;
  velY = dy * 0.005;
  spinGroup.rotation.y += velX;
  spinGroup.rotation.x += velY;
});

// A clean click (no real movement) on the clock snaps it home, facing center
function startReset() {
  const wrap = (a) => THREE.MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI;
  spinGroup.rotation.x = wrap(spinGroup.rotation.x);
  spinGroup.rotation.y = wrap(spinGroup.rotation.y);
  spinGroup.rotation.z = wrap(spinGroup.rotation.z);
  velX = 0;
  velY = 0;
  resetting = true;
}

function endPointer(e) {
  const wasSingleDrag = dragging && pointers.size === 1;
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    dragging = false;
    canvas.classList.remove('dragging');
  }

  if (wasSingleDrag && Math.hypot(e.clientX - downX, e.clientY - downY) < 6) {
    const ndc = new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(spinGroup, true);
    if (hits.length > 0) {
      let obj = hits[0].object;
      let isButton = false;
      while (obj) {
        if (obj.userData.isSettingsButton) {
          isButton = true;
          break;
        }
        obj = obj.parent;
      }
      if (isButton) openSettings();
      else startReset();
    }
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function zoomBy(delta) {
  camera.position.z = THREE.MathUtils.clamp(camera.position.z + delta, 2.6, 8);
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

  settingsPanel.classList.add('hidden');
});

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
const TWO_PI = Math.PI * 2;

function updateHands() {
  const now = new Date(Date.now() + clockSettings.offsetMs);
  const p = tzParts(now);
  const s = p.second + now.getMilliseconds() / 1000;
  const m = p.minute + s / 60;
  const h = (p.hour % 12) + m / 60;

  hourHand.rotation.z = -(h / 12) * TWO_PI;
  minuteHand.rotation.z = -(m / 60) * TWO_PI;
  secondHand.rotation.z = -(s / 60) * TWO_PI;
}

renderer.setAnimationLoop((time) => {
  const t = time * 0.001;

  // Gentle floating sway (rotation only — no vertical bob)
  floatGroup.rotation.z = Math.sin(t * 0.7) * 0.015;
  floatGroup.rotation.x = Math.sin(t * 0.9 + 1.0) * 0.01;

  if (resetting) {
    // Ease home: face the camera dead-on, zoom back to default
    const r = spinGroup.rotation;
    r.x += -r.x * 0.08;
    r.y += -r.y * 0.08;
    r.z += -r.z * 0.08;
    camera.position.z += (HOME_ZOOM - camera.position.z) * 0.08;
    if (
      Math.abs(r.x) < 0.001 &&
      Math.abs(r.y) < 0.001 &&
      Math.abs(r.z) < 0.001 &&
      Math.abs(camera.position.z - HOME_ZOOM) < 0.005
    ) {
      r.set(0, 0, 0);
      camera.position.z = HOME_ZOOM;
      resetting = false;
    }
  } else if (!dragging) {
    // Spin inertia after release
    spinGroup.rotation.y += velX;
    spinGroup.rotation.x += velY;
    velX *= 0.95;
    velY *= 0.95;
  }

  updateHands();
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
