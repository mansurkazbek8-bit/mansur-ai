// 3D-агенты Mansur AI: пять «игрушечных» персонажей из глянцевых фигур (библиотека three.js, WebGL).
// Общий файл для сайта и приложения. createStage() рисует живую сцену (можно крутить мышью),
// renderSprite() делает неподвижную PNG-картинку агента для маленьких аватаров.
import * as THREE from '../vendor/three/three.module.min.js';
import { RoundedBoxGeometry } from '../vendor/three/RoundedBoxGeometry.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';

// ------------------------------------------------------------ palette
const LOOK = {
  mansur: { body: '#7c5cff', head: '#a48cff', dark: '#4f33d6', plate: '#c9bbff', eye: '#7cf3ff', visor: '#12142c', cheek: '#ff8fc7', rim: '#9d7bff' },
  barys: { body: '#e9f1ff', head: '#f7faff', dark: '#9db9e3', plate: '#d6e5fb', eye: '#5ef0ff', visor: '#111d33', cheek: '#ffb3cf', rim: '#7fb6ff', spot: '#3f5f94' },
  tulpar: { body: '#ff8226', head: '#ffa449', dark: '#d9561a', plate: '#ffd39a', eye: '#fff0a0', visor: '#24130a', cheek: '#ff4d6d', rim: '#ffb347' },
  berkut: { body: '#8a5527', head: '#e3ad62', dark: '#55320f', plate: '#f3dfbd', eye: '#ffb02e', visor: '#1c1107', cheek: '#ff9d6b', rim: '#ffcf7a' },
  samruk: { body: '#14bfa9', head: '#53e6c6', dark: '#0b86c9', plate: '#b8fff0', eye: '#ffd34d', visor: '#0a2230', cheek: '#ff7ab8', rim: '#7ff5d2' },
};
export const AGENT_SLUGS = Object.keys(LOOK);

// ------------------------------------------------------------ helpers
const plastic = (color, extra = {}) => new THREE.MeshPhysicalMaterial({
  color, roughness: 0.36, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.22, sheen: 0.2, ...extra,
});
const glow = color => new THREE.MeshBasicMaterial({ color, toneMapped: false });
const rbox = (w, h, d, r, seg = 6) => new RoundedBoxGeometry(w, h, d, seg, r);
const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

/** Colour a geometry with a vertical gradient (stops: [[t, '#hex'], ...]). */
function gradient(geo, stops, axis = 'y') {
  geo.computeBoundingBox();
  const min = geo.boundingBox.min[axis], max = geo.boundingBox.max[axis];
  const pos = geo.attributes.position, colors = [], c = new THREE.Color();
  const cols = stops.map(([t, h]) => [t, new THREE.Color(h)]);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getComponent(i, axis === 'x' ? 0 : axis === 'y' ? 1 : 2) - min) / (max - min || 1);
    let k = 0;
    while (k < cols.length - 2 && t > cols[k + 1][0]) k++;
    const [t0, c0] = cols[k], [t1, c1] = cols[k + 1];
    c.copy(c0).lerp(c1, Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1))));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/** Put obj on the surface of target in the given direction (from target's centre), facing outwards. */
const ray = new THREE.Raycaster();
function stick(target, dir, obj, lift = 0) {
  target.updateWorldMatrix(true, false);
  const centre = new THREE.Vector3().setFromMatrixPosition(target.matrixWorld);
  const d = new THREE.Vector3(...dir).normalize();
  ray.set(centre.clone().addScaledVector(d, 5), d.clone().negate());
  const hit = ray.intersectObject(target, false)[0];
  if (!hit) return obj;
  const normal = hit.face.normal.clone().transformDirection(target.matrixWorld);
  const parent = obj.parent || target.parent;
  const p = parent.worldToLocal(hit.point.clone().addScaledVector(normal, lift));
  obj.position.copy(p);
  obj.lookAt(parent.localToWorld(p.clone()).add(normal));
  return obj;
}

/** Feathered wing (flat shape with a scalloped edge), gradient from root to tip. */
function wingGeometry(len, height, stops) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(len * 0.3, height * 0.9, len * 0.75, height * 1.05, len, height * 0.85);
  const tips = 4;
  for (let i = 0; i < tips; i++) {
    const x0 = len * (1 - i / tips), x1 = len * (1 - (i + 1) / tips);
    const y0 = height * (0.85 - i * 0.18), y1 = height * (0.85 - (i + 1) * 0.18);
    s.quadraticCurveTo((x0 + x1) / 2 + len * 0.02, Math.min(y0, y1) - height * 0.32, x1, y1);
  }
  s.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 10 });
  geo.translate(0, -height * 0.25, -0.02);
  return gradient(geo, stops, 'x');
}

// ------------------------------------------------------------ characters
/**
 * Build one agent. Returned group has userData.parts used by animate().
 * Origin is between the feet; the agent is about 2.6 units tall and faces +Z.
 */
export function buildAgent(slug) {
  const L = LOOK[slug] || LOOK.mansur;
  const root = new THREE.Group();
  const rig = new THREE.Group(); // bobbing part
  root.add(rig);
  const parts = { rig, eyes: [], arms: [], wings: [], spin: [], pulse: [], sparkles: [], tail: null };
  root.userData = { slug, parts, seed: Math.random() * 10 };

  const bodyMat = plastic(L.body), headMat = plastic(L.head), darkMat = plastic(L.dark), plateMat = plastic(L.plate);
  const visorMat = new THREE.MeshPhysicalMaterial({ color: L.visor, roughness: 0.08, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 });

  // feet, body, arms
  [-0.27, 0.27].forEach(x => rig.add(mesh(rbox(0.36, 0.17, 0.44, 0.07), darkMat, x, 0.085, 0.06)));
  const body = mesh(rbox(1.12, 0.98, 0.88, 0.38), bodyMat, 0, 0.64, 0);
  rig.add(body);
  const plate = mesh(rbox(0.64, 0.5, 0.08, 0.2), plateMat, 0, 0.62, 0.42);
  rig.add(plate);
  [-1, 1].forEach(side => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.6, 0.98, 0);
    const limb = mesh(new THREE.CapsuleGeometry(0.14, 0.36, 6, 14), darkMat, 0, -0.26, 0);
    arm.add(limb);
    arm.rotation.z = side * 0.28;
    arm.userData.side = side;
    rig.add(arm);
    parts.arms.push(arm);
  });

  // head (its own group so it can look around)
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.1, 0);
  rig.add(headPivot);
  parts.head = headPivot;
  const head = mesh(rbox(1.52, 1.2, 1.16, 0.5, 8), headMat, 0, 0.52, 0);
  headPivot.add(head);
  headPivot.add(mesh(rbox(1.2, 0.76, 0.12, 0.3), visorMat, 0, 0.53, 0.53));
  // eyes with highlights, smile, blush
  [-0.26, 0.26].forEach(x => {
    const eye = mesh(new THREE.SphereGeometry(0.115, 24, 16), glow(L.eye), x, 0.58, 0.6);
    eye.scale.set(1, 1.28, 0.45);
    headPivot.add(eye);
    parts.eyes.push(eye);
    headPivot.add(mesh(new THREE.SphereGeometry(0.035, 12, 8), glow('#ffffff'), x + 0.045, 0.64, 0.65));
  });
  const smile = mesh(new THREE.TorusGeometry(0.1, 0.022, 8, 20, Math.PI), glow(L.eye), 0, 0.4, 0.6);
  smile.rotation.z = Math.PI;
  headPivot.add(smile);
  parts.smile = smile;
  [-0.42, 0.42].forEach(x => {
    const blush = mesh(new THREE.CircleGeometry(0.075, 20), new THREE.MeshBasicMaterial({ color: L.cheek, transparent: true, opacity: 0.55, toneMapped: false }), x, 0.36, 0.596);
    headPivot.add(blush);
  });

  const addTo = (parent, m) => { parent.add(m); return m; };

  // ---------------------------------------------------------- per character
  if (slug === 'mansur') {
    addTo(headPivot, mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 12), darkMat, 0, 1.28, 0));
    const bulb = addTo(headPivot, mesh(new THREE.SphereGeometry(0.1, 20, 14), glow(L.eye), 0, 1.5, 0));
    const halo = addTo(headPivot, mesh(new THREE.SphereGeometry(0.2, 20, 14), new THREE.MeshBasicMaterial({ color: L.eye, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false }), 0, 1.5, 0));
    parts.pulse.push(halo, bulb);
    [-1, 1].forEach(s => {
      const bolt = addTo(headPivot, mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 20), darkMat, s * 0.8, 0.52, 0));
      bolt.rotation.z = Math.PI / 2;
    });
    // emblem: glowing ring
    const ring = mesh(new THREE.TorusGeometry(0.12, 0.03, 10, 28), glow(L.eye), 0, 0.62, 0.47);
    rig.add(ring);
    parts.spin.push(ring);
  }

  if (slug === 'barys') {
    const spotMat = plastic(L.spot, { clearcoat: 0.3 });
    [-1, 1].forEach(s => {
      const ear = addTo(headPivot, mesh(new THREE.ConeGeometry(0.25, 0.46, 24), headMat, s * 0.46, 1.18, -0.08));
      ear.rotation.z = -s * 0.38;
      const inner = addTo(headPivot, mesh(new THREE.ConeGeometry(0.15, 0.3, 24), plastic(L.cheek), s * 0.45, 1.15, 0.0));
      inner.rotation.z = -s * 0.38;
      // whiskers
      [-0.06, 0.06].forEach((dy, i) => {
        const w = addTo(headPivot, mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6), darkMat, s * 0.88, 0.32 + dy, 0.35));
        w.rotation.z = Math.PI / 2 + s * (i ? -0.15 : 0.15);
      });
    });
    // spots on head and body
    const spot = () => { const m = mesh(new THREE.SphereGeometry(0.06, 14, 10), spotMat); m.scale.set(1, 1, 0.35); return m; };
    [[0, 1, 0.1], [-0.5, 1, 0.2], [0.45, 1, -0.2], [-0.3, 0.9, -0.6], [0.7, 0.4, 0.3], [-0.75, 0.3, -0.2]].forEach(d => stick(head, d, addTo(headPivot, spot())));
    [[0.8, 0.3, 0.5], [-0.8, -0.2, 0.5], [0.6, -0.6, 0.6], [-0.3, 0.6, -1], [0.5, 0.1, -1]].forEach(d => stick(body, d, addTo(rig, spot())));
    // paw emblem
    const paw = new THREE.Group();
    paw.position.set(0, 0.6, 0.47);
    const pad = mesh(new THREE.SphereGeometry(0.09, 16, 12), spotMat, 0, -0.03, 0); pad.scale.set(1.1, 0.9, 0.35);
    paw.add(pad);
    [[-0.1, 0.08], [-0.035, 0.13], [0.035, 0.13], [0.1, 0.08]].forEach(([x, y]) => { const t = mesh(new THREE.SphereGeometry(0.038, 12, 8), spotMat, x, y, 0); t.scale.z = 0.4; paw.add(t); });
    rig.add(paw);
    // tail
    const curve = new THREE.CatmullRomCurve3([[0.25, 0.35, -0.38], [0.6, 0.3, -0.6], [0.85, 0.7, -0.55], [0.7, 1.05, -0.4]].map(p => new THREE.Vector3(...p)));
    const tail = new THREE.Group();
    tail.position.set(0, 0, 0);
    tail.add(mesh(new THREE.TubeGeometry(curve, 40, 0.11, 14), plastic(L.body)));
    tail.add(mesh(new THREE.SphereGeometry(0.11, 16, 12), plastic(L.body), 0.7, 1.05, -0.4));
    [0.3, 0.55, 0.8].forEach(t => { const p = curve.getPoint(t); const s = spot(); s.position.copy(p); s.position.z += 0.1; tail.add(s); });
    rig.add(tail);
    parts.tail = tail;
  }

  if (slug === 'tulpar') {
    // flame mane: a crown of fire, hot yellow in the middle, red at the sides
    [[-0.5, '#e8262a', 0.36], [-0.25, '#ff6a1a', 0.5], [0, '#ffd23f', 0.66], [0.25, '#ff6a1a', 0.5], [0.5, '#e8262a', 0.36]].forEach(([x, col, len]) => {
      const flame = addTo(headPivot, mesh(new THREE.ConeGeometry(0.15, len, 20), plastic(col, { emissive: col, emissiveIntensity: 0.6, roughness: 0.55, clearcoat: 0.2, envMapIntensity: 0.4 })));
      stick(head, [x * 1.2, 1, -0.15], flame, len * 0.38);
      flame.rotateX(Math.PI / 2);
      parts.pulse.push(flame);
    });
    // wings
    [-1, 1].forEach(s => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.42, 1.0, -0.36);
      const w = mesh(wingGeometry(1.0, 0.62, [[0, '#fff3d6'], [0.55, '#ffc65c'], [1, '#ff8a2a']]), plastic('#ffffff', { vertexColors: true, side: THREE.DoubleSide, envMapIntensity: 0.45 }));
      w.scale.x = s;
      w.rotation.z = 0.25 * s;
      pivot.add(w);
      pivot.userData.side = s;
      rig.add(pivot);
      parts.wings.push(pivot);
    });
    // horseshoe emblem
    const shoe = mesh(new THREE.TorusGeometry(0.12, 0.035, 10, 28, Math.PI * 1.35), plastic('#ffffff', { metalness: 0.3 }), 0, 0.6, 0.47);
    shoe.rotation.z = -Math.PI * 0.175 + Math.PI;
    rig.add(shoe);
  }

  if (slug === 'berkut') {
    // crest feathers
    [[-0.22, '#6b3d14', 0.35], [0, '#8a5527', 0], [0.22, '#6b3d14', -0.35]].forEach(([x, col, rz]) => {
      const f = addTo(headPivot, mesh(new THREE.SphereGeometry(0.12, 18, 14), plastic(col)));
      f.scale.set(0.8, 3.2, 0.5);
      f.position.set(x, 1.18, -0.28);
      f.rotation.set(-0.7, 0, rz);
    });
    // stern brows
    [-1, 1].forEach(s => {
      const b = addTo(headPivot, mesh(rbox(0.34, 0.08, 0.07, 0.03), darkMat, s * 0.26, 0.82, 0.6));
      b.rotation.z = s * 0.28;
    });
    // beak
    const beak = addTo(headPivot, mesh(new THREE.ConeGeometry(0.15, 0.36, 24), plastic('#ffc933', { metalness: 0.15 }), 0, 0.34, 0.66));
    beak.rotation.x = Math.PI * 0.85;
    // folded wings and cream chest
    [-1, 1].forEach(s => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.6, 1.0, -0.05);
      const w = mesh(new THREE.SphereGeometry(0.3, 24, 18), darkMat, s * 0.06, -0.38, 0);
      w.scale.set(0.55, 1.5, 1.25);
      pivot.add(w);
      [0, 1, 2].forEach(i => {
        const tip = mesh(new THREE.ConeGeometry(0.07, 0.24, 12), plastic('#3c2208'), s * 0.08, -0.85, -0.18 + i * 0.16);
        tip.rotation.x = Math.PI;
        pivot.add(tip);
      });
      pivot.userData.side = s;
      rig.add(pivot);
      parts.wings.push(pivot);
    });
    parts.arms.forEach(a => (a.visible = false)); // wings replace arms
    plate.scale.set(1.15, 1.25, 1);
  }

  if (slug === 'samruk') {
    // crest feathers with golden tips
    const crestStops = [[0, '#ffd34d'], [0.55, '#ff7ab8'], [1, '#b38cff']];
    [[-0.28, 0.35], [0, 0], [0.28, -0.35]].forEach(([x, rz], i) => {
      const f = addTo(headPivot, mesh(gradient(new THREE.SphereGeometry(0.11, 20, 16), crestStops), plastic('#ffffff', { vertexColors: true, emissive: '#ff7ab8', emissiveIntensity: 0.15 })));
      f.scale.set(0.8, i === 1 ? 4.2 : 3.4, 0.45);
      f.position.set(x, i === 1 ? 1.48 : 1.36, -0.05);
      f.rotation.z = rz;
      const orb = addTo(headPivot, mesh(new THREE.SphereGeometry(0.075, 16, 12), glow('#ffe066'), x - Math.sin(rz) * 0.42, (i === 1 ? 1.48 : 1.36) + (i === 1 ? 0.5 : 0.4), -0.05));
      parts.pulse.push(orb);
    });
    const beak = addTo(headPivot, mesh(new THREE.ConeGeometry(0.08, 0.16, 18), plastic('#ffae2e'), 0, 0.36, 0.63));
    beak.rotation.x = Math.PI * 0.8;
    // big rainbow wings
    [-1, 1].forEach(s => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.45, 1.02, -0.32);
      const w = mesh(wingGeometry(1.35, 0.85, [[0, '#2fe0c0'], [0.35, '#4cc3ff'], [0.7, '#ffd34d'], [1, '#ff5fa8']]), plastic('#ffffff', { vertexColors: true, side: THREE.DoubleSide, roughness: 0.5, clearcoat: 0.3, envMapIntensity: 0.35 }));
      w.scale.x = s;
      w.rotation.z = 0.35 * s;
      pivot.add(w);
      pivot.userData.side = s;
      rig.add(pivot);
      parts.wings.push(pivot);
    });
    // sun emblem
    const sun = new THREE.Group();
    sun.position.set(0, 0.62, 0.47);
    sun.add(mesh(new THREE.CircleGeometry(0.075, 24), glow('#ffd34d')));
    for (let i = 0; i < 8; i++) {
      const r = mesh(new THREE.BoxGeometry(0.03, 0.065, 0.02), glow('#ffd34d'));
      const a = (i / 8) * Math.PI * 2;
      r.position.set(Math.sin(a) * 0.13, Math.cos(a) * 0.13, 0);
      r.rotation.z = -a;
      sun.add(r);
    }
    rig.add(sun);
    parts.spin.push(sun);
    // sparkles around
    for (let i = 0; i < 7; i++) {
      const sp = mesh(new THREE.OctahedronGeometry(0.06), glow(i % 2 ? '#ffe066' : '#ffffff'));
      sp.userData = { angle: (i / 7) * Math.PI * 2, height: 0.5 + (i % 3) * 0.7, radius: 1.35 + (i % 2) * 0.2 };
      root.add(sp);
      parts.sparkles.push(sp);
    }
  }

  // soft contact shadow
  root.add(shadowDisc());
  return root;
}

let shadowTexture = null;
function shadowDisc() {
  if (!shadowTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    shadowTexture = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.002;
  return m;
}

// ------------------------------------------------------------ animation
/** Idle life: bobbing, blinking, wings, tail; `working` makes the agent busy (typing, thinking dots). */
export function animate(agent, t, { working = false, look = { x: 0, y: 0 }, hop = 0 } = {}) {
  const { parts, seed } = agent.userData;
  const speed = working ? 2.2 : 1;
  parts.rig.position.y = Math.abs(Math.sin((t + seed) * 1.9 * speed)) * (working ? 0.05 : 0.07) + hop;
  parts.rig.rotation.z = Math.sin((t + seed) * 1.3) * 0.03;

  // head follows the pointer
  parts.head.rotation.y += ((look.x * 0.55) - parts.head.rotation.y) * 0.12;
  parts.head.rotation.x += ((-look.y * 0.3 + (working ? 0.12 : 0)) - parts.head.rotation.x) * 0.12;

  // blink every few seconds; focused eyes while working
  const cycle = (t + seed * 3) % 4.2;
  const blink = cycle > 4.05 ? 0.12 : 1;
  parts.eyes.forEach(e => (e.scale.y = 1.28 * blink * (working ? 0.75 : 1)));

  parts.arms.forEach(a => {
    const s = a.userData.side;
    a.rotation.x = working ? -0.9 + Math.sin(t * 14 + s) * 0.25 : Math.sin(t * 1.5 + s) * 0.12;
    a.rotation.z = s * (working ? 0.15 : 0.28);
  });
  parts.wings.forEach(w => {
    const s = w.userData.side;
    w.rotation.y = s * (Math.sin(t * (working ? 9 : 3.2)) * 0.35 + 0.15);
  });
  if (parts.tail) parts.tail.rotation.y = Math.sin(t * 2.2) * 0.25;
  parts.spin.forEach(m => (m.rotation.z = t * 0.8));
  parts.pulse.forEach((m, i) => {
    if (m.material.transparent) m.material.opacity = 0.15 + (Math.sin(t * 3) + 1) * 0.13; // glowing halo
    else m.scale.setScalar(1 + Math.sin(t * 4 + i) * 0.07); // flickering mane, glowing orbs
  });
  parts.sparkles.forEach(sp => {
    const { angle, height, radius } = sp.userData;
    const a = angle + t * 0.6;
    sp.position.set(Math.sin(a) * radius, height + Math.sin(t * 2 + angle) * 0.12, Math.cos(a) * radius * 0.6);
    sp.rotation.y = t * 3;
    sp.scale.setScalar(0.6 + (Math.sin(t * 4 + angle * 3) + 1) * 0.35);
  });
}

// ------------------------------------------------------------ scene
function makeRenderer(canvas, transparent = true) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: transparent });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

function lightScene(scene, renderer, rimColor = '#9d7bff') {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const key = new THREE.DirectionalLight('#ffffff', 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(rimColor, 1.4);
  rim.position.set(-3, 3, -4);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight('#ffffff', '#3a3550', 0.45));
}

function thinkingDots(color) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.SphereGeometry(0.07, 12, 8), glow(color), (i - 1) * 0.2, 0, 0));
  g.position.y = 2.95;
  g.visible = false;
  return g;
}

/**
 * Live 3D scene in a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts { agents: [{slug, working}], onPick(slug), spin: auto-turn (for a single agent), paused(): skip frames }
 * @returns {{ setWorking(map: {slug: bool}), dispose() }}
 */
export function createStage(canvas, { agents = [], onPick = null, spin = false, paused = null } = {}) {
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  lightScene(scene, renderer, LOOK[agents[0]?.slug]?.rim);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);

  const gap = 2.25;
  const items = agents.map((a, i) => {
    const obj = buildAgent(a.slug);
    obj.position.x = (i - (agents.length - 1) / 2) * gap;
    obj.rotation.y = agents.length > 1 ? -obj.position.x * 0.06 : 0;
    const dots = thinkingDots(LOOK[a.slug]?.eye || '#fff');
    obj.add(dots);
    scene.add(obj);
    return { ...a, obj, dots, hop: 0, baseY: obj.rotation.y };
  });

  const look = { x: 0, y: 0 };
  let drag = null, spinY = 0, spinVel = 0, hovered = null;
  const pointer = new THREE.Vector2(), picker = new THREE.Raycaster();
  const pick = e => {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    picker.setFromCamera(pointer, camera);
    const hit = picker.intersectObjects(items.map(i => i.obj), true)[0];
    if (!hit) return null;
    let o = hit.object;
    while (o && !o.userData.slug) o = o.parent;
    return items.find(i => i.obj === o) || null;
  };
  const onMove = e => {
    const r = canvas.getBoundingClientRect();
    look.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    look.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    if (drag) { spinVel = (e.clientX - drag) * 0.01; spinY += spinVel; drag = e.clientX; }
    hovered = drag ? null : pick(e);
    canvas.style.cursor = drag ? 'grabbing' : hovered && onPick ? 'pointer' : 'grab';
  };
  const onDown = e => { drag = e.clientX; downAt = e.clientX; };
  let downAt = 0;
  const onUp = e => {
    if (drag !== null && Math.abs(e.clientX - downAt) < 4 && onPick) { const it = pick(e); if (it) onPick(it.slug); }
    drag = null;
  };
  const onLeave = () => { look.x = 0; look.y = 0; hovered = null; drag = null; };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', onLeave);

  const fit = () => {
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 200;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const span = Math.max(1, items.length) * gap;
    const distW = (span / 2 + 0.4) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.aspect;
    const distH = 2.1 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(distW, distH);
    camera.position.set(0, 2.0, dist);
    camera.lookAt(0, 1.25, 0);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(fit);
  ro.observe(canvas);
  fit();

  let visible = true;
  const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting));
  io.observe(canvas);

  const clock = new THREE.Clock();
  let raf = 0, disposed = false;
  const frame = () => {
    if (disposed) return;
    if (!canvas.isConnected) { api.dispose(); return; }
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden || paused?.()) return; // e.g. a dialog with its own 3D scene is open
    const t = clock.getElapsedTime();
    if (!drag) { spinVel *= 0.92; spinY += spinVel; spinY *= 0.97; }
    items.forEach(it => {
      it.hop += ((hovered === it ? 0.18 : 0) - it.hop) * 0.15;
      it.obj.rotation.y = it.baseY + spinY + (spin ? Math.sin(t * 0.6) * 0.6 : 0);
      animate(it.obj, t, { working: it.working, look, hop: it.hop });
      it.dots.visible = !!it.working;
      it.dots.children.forEach((d, i) => (d.position.y = Math.abs(Math.sin(t * 5 + i * 0.6)) * 0.15));
    });
    renderer.render(scene, camera);
  };
  frame();

  const api = {
    setWorking(map) { items.forEach(it => (it.working = !!map[it.slug])); },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      window.removeEventListener('pointerup', onUp);
      scene.traverse(o => { o.geometry?.dispose(); [].concat(o.material || []).forEach(m => m.dispose()); });
      renderer.dispose();
    },
  };
  return api;
}

/** Still picture of one agent (3/4 view) as a PNG data URL — used for small avatars. */
export function renderSprite(slug, size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  lightScene(scene, renderer, LOOK[slug].rim);
  const agent = buildAgent(slug);
  agent.rotation.y = -0.35;
  animate(agent, 0.6, {});
  agent.userData.parts.eyes.forEach(e => (e.scale.y = 1.28));
  scene.add(agent);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const tall = slug === 'samruk' ? 3.25 : 2.85;
  camera.position.set(0, 1.85, tall / Math.tan(THREE.MathUtils.degToRad(14)) / 2 + 0.4);
  camera.lookAt(0, slug === 'samruk' ? 1.5 : 1.35, 0);
  renderer.render(scene, camera);
  const url = canvas.toDataURL('image/png');
  renderer.dispose();
  return url;
}
