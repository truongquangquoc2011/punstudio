import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ViewMesh } from '../lib/protocol';

export type Angle = 'iso' | 'outer' | 'inner';

const DIRECTIONS: Record<Angle, [number, number, number]> = {
  iso: [0.55, -0.7, 0.45],
  outer: [0, -0.0001, 1], // nhìn vào mặt ngoài (z lớn)
  inner: [0, -0.0001, -1], // nhìn vào mặt trong (z = 0)
};

interface Props {
  mesh: ViewMesh | null;
  section: boolean;
  /** Tô màu phần thêm vào (chỉ có nghĩa với kết quả). */
  highlight: boolean;
  angle: Angle;
  /** Tăng lên để đặt lại camera theo `angle` dù góc không đổi. */
  angleNonce: number;
}

function cssColor(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

/**
 * Khung xem 3D. Mâm đặt trục quay theo Z, mặt trong ở z = 0. Chế độ cắt đôi dùng mặt phẳng cắt x = 0;
 * mặt sau của lưới tô màu mực để vết cắt trông như mặt cắt đặc.
 */
export function Viewer({ mesh, section, highlight, angle, angleNonce }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    group: THREE.Group;
    plane: THREE.Plane;
    grid: THREE.GridHelper;
    frame: number;
    sphere: THREE.Sphere | null;
  } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
    camera.up.set(0, 0, 1);
    camera.position.set(14, -18, 12);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(10, -14, 20);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(-12, 10, -6);
    scene.add(rim);

    // Lưới 1 mm trên mặt phẳng z = 0 – thước đo trực quan cho mâm 8,5 mm.
    const grid = new THREE.GridHelper(24, 24, cssColor('--grid-strong', '#b9b3a7'), cssColor('--grid', '#d9d4ca'));
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.001;
    scene.add(grid);

    const group = new THREE.Group();
    scene.add(group);
    const plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w === 0 || h === 0) return; // cửa sổ thu nhỏ/bị ẩn: tỉ lệ 0 sẽ đẩy camera ra vô cực
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const s = { renderer, scene, camera, controls, group, plane, grid, frame: 0, sphere: null as THREE.Sphere | null };
    state.current = s;
    const tick = () => {
      controls.update();
      // Nhìn từ dưới lên (mặt trong) thì lưới nằm giữa camera và mâm – ẩn đi.
      grid.visible = camera.position.z > controls.target.z - 0.5 && camera.position.z > 0;
      renderer.render(scene, camera);
      s.frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(s.frame);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      state.current = null;
    };
  }, []);

  useEffect(() => {
    const s = state.current;
    if (!s) return;
    for (const child of [...s.group.children]) {
      s.group.remove(child);
      const m = child as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    if (!mesh) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geo.computeVertexNormals();
    const base = cssColor('--model', '#a8a296');
    const accent = cssColor('--accent', '#d9541e');
    const colors = new Float32Array(mesh.positions.length);
    for (let t = 0; t < mesh.added.length; t++) {
      const c = highlight && mesh.added[t] ? accent : base;
      for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (t * 3 + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const planes = section ? [s.plane] : [];
    const front = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05, clippingPlanes: planes, side: THREE.FrontSide }),
    );
    const back = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: cssColor('--section', '#2a2925'), clippingPlanes: planes, side: THREE.BackSide }),
    );
    s.group.add(back, front);

    if (!s.sphere) {
      geo.computeBoundingSphere();
      s.sphere = geo.boundingSphere!.clone();
      place(s, angle);
    }
  }, [mesh, section, highlight]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.current?.sphere) place(state.current, angle);
  }, [angle, angleNonce]);

  return <div className="viewer" ref={host} />;
}

function place(s: { camera: THREE.PerspectiveCamera; controls: OrbitControls; sphere: THREE.Sphere | null }, angle: Angle) {
  if (!s.sphere) return;
  const { center, radius } = s.sphere;
  const dir = new THREE.Vector3(...DIRECTIONS[angle]).normalize();
  s.controls.target.copy(center);
  // Màn hình dọc: góc nhìn ngang hẹp hơn góc dọc, lùi camera theo tỉ lệ để mâm không bị cắt hai bên.
  const fit = (radius / Math.sin((s.camera.fov * Math.PI) / 360)) * 1.12;
  s.camera.position.copy(center).addScaledVector(dir, fit / Math.min(1, s.camera.aspect));
  s.controls.update();
}
