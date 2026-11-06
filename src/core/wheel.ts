import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import {
  eigenSymmetric,
  fitCircle,
  mat4,
  maxVertexRadius,
  minEdgeDistance,
  polygonArea,
  regionTester,
  rotationToZ,
  type M3,
  type Poly,
  type V3,
} from './geometry';
import { DEFAULT_REPAIR, loadWheel, type LoadStage, type LoadedWheel, type RepairInfo, type RepairOptions } from './load';

/** Thông số mâm chuẩn (mm). */
export interface WheelSpec {
  diameter: number; // đường kính ngoài
  width: number; // bề rộng mâm theo trục
  hole: number; // lỗ trục – đúng kích thước, không cộng dung sai
  boss: number; // khối trụ ở tâm mặt trong
  wall: number; // độ dày tối thiểu của viền vành
  bossHeight: number | null; // chiều cao khối trụ tính từ mặt trong; null = tự động (tới mặt nan)
  wallHeight: number | null; // chiều cao vòng đắp viền tính từ mặt trong; null = tự động (tới chỗ nan nối vào vành)
}

export const DEFAULT_SPEC: WheelSpec = { diameter: 8.5, width: 5, hole: 1, boss: 3, wall: 1, bossHeight: null, wallHeight: null };

export interface ProcessOptions {
  /** Đảo mặt trong/mặt ngoài nếu tự nhận sai. */
  flip?: boolean;
  segments?: number;
  repair?: RepairOptions;
  /** Kết quả đọc/sửa có sẵn (đổi thông số trên cùng một file thì khỏi đúc lại). Không bị xóa sau khi dùng. */
  preloaded?: LoadedWheel;
  /** Báo tiến trình để giao diện hiển thị. */
  onStage?: (stage: LoadStage | 'wheel') => void;
}

export interface Measurement {
  diameter: number;
  width: number;
  holeDiameter: number | null;
  bossDiameter: number | null;
  minWall: number | null;
  bossHeight: number | null;
  wallHeight: number | null; // null = không có vòng đắp
  triangles: number;
  pieces: number;
  volume: number;
}

export interface WheelReport {
  source: { triangles: number; diameter: number; width: number; axis: V3; repairs: string[]; repair: RepairInfo };
  steps: string[];
  warnings: string[];
  faceStart: number; // z bắt đầu mặt nan ở bán kính giữa (tính từ mặt trong), sau khi chỉnh
  wallTop: number; // viền vành tính tới z này (chỗ nan bắt đầu nối vào vành)
  bossTop: number; // đỉnh khối trụ mới
  autoFlipped: boolean;
  result: Measurement;
  checks: { label: string; target: string; actual: string; ok: boolean }[];
}

export interface WheelResult {
  /** Mâm đã xử lý. Tam giác giữ nguyên từ file gốc mang originalID = sourceId; phần thêm vào mang ID khác. */
  manifold: Manifold;
  /** Mâm gốc sau khi xoay/đổi kích thước, chưa thêm gì – để so sánh trên giao diện. */
  prepared: Manifold;
  sourceId: number;
  report: WheelReport;
}

const fmt = (v: number | null, d = 2) => (v === null ? '—' : v.toFixed(d).replace('.', ','));

// ------------------------------------------------------------------ đọc lưới

interface MeshArrays {
  vert: Float32Array;
  tri: Uint32Array;
  stride: number;
}

function arrays(m: Manifold): MeshArrays {
  const mesh = m.getMesh();
  return { vert: mesh.vertProperties, tri: mesh.triVerts, stride: mesh.numProp };
}

function slicePolys(m: Manifold, z: number): Poly[] {
  const cs: CrossSection = m.slice(z);
  const polys = cs.toPolygons() as Poly[];
  cs.delete();
  return polys;
}

/** Trục quay: vectơ riêng có trị riêng khác hẳn hai trị còn lại (mâm là vật tròn xoay). */
function findAxis(mesh: MeshArrays): V3 {
  const { vert, tri, stride } = mesh;
  let total = 0;
  const mean = [0, 0, 0];
  const cent: number[] = [];
  const area: number[] = [];
  for (let f = 0; f < tri.length / 3; f++) {
    const p = [0, 1, 2].map((k) => tri[f * 3 + k] * stride);
    const a = [vert[p[0]], vert[p[0] + 1], vert[p[0] + 2]];
    const b = [vert[p[1]], vert[p[1] + 1], vert[p[1] + 2]];
    const c = [vert[p[2]], vert[p[2] + 1], vert[p[2] + 2]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const ar = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    const g = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    cent.push(...g);
    area.push(ar);
    total += ar;
    for (let k = 0; k < 3; k++) mean[k] += g[k] * ar;
  }
  for (let k = 0; k < 3; k++) mean[k] /= total || 1;
  const cov: M3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < area.length; i++) {
    const d = [cent[i * 3] - mean[0], cent[i * 3 + 1] - mean[1], cent[i * 3 + 2] - mean[2]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[r][c] += area[i] * d[r] * d[c];
  }
  const { values, vectors } = eigenSymmetric(cov);
  const order = [0, 1, 2].sort((i, j) => values[i] - values[j]);
  const [l1, l2, l3] = order.map((i) => values[i]);
  let axis = l2 - l1 > l3 - l2 ? vectors[order[0]] : vectors[order[2]];
  // File thường đã đặt thẳng trục; nan lệch tâm làm trục tính ra nghiêng vài độ. Dưới 5° thì coi như thẳng trục.
  const k = [0, 1, 2].reduce((best, i) => (Math.abs(axis[i]) > Math.abs(axis[best]) ? i : best), 0);
  if (Math.abs(axis[k]) > Math.cos((5 * Math.PI) / 180)) {
    const snapped: V3 = [0, 0, 0];
    snapped[k] = Math.sign(axis[k]);
    axis = snapped;
  }
  return axis;
}

function bounds(mesh: MeshArrays) {
  const { vert, stride } = mesh;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vert.length; i += stride) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], vert[i + k]);
      max[k] = Math.max(max[k], vert[i + k]);
    }
  }
  return { min, max };
}

/**
 * Tâm trục trên mặt XY: tâm vòng bao nhỏ nhất của mép ngoài vành. Bắt đầu từ tâm hộp bao rồi thử khớp đường tròn
 * qua các đỉnh ngoài cùng; chỉ nhận tâm mới khi nó làm vòng bao nhỏ đi (khớp lệch bởi chi tiết lồi thì bỏ).
 */
function findCenter(mesh: MeshArrays): { cx: number; cy: number; radius: number } {
  const { min, max } = bounds(mesh);
  const { vert, stride } = mesh;
  const reach = (x: number, y: number) => {
    let r = 0;
    for (let i = 0; i < vert.length; i += stride) r = Math.max(r, Math.hypot(vert[i] - x, vert[i + 1] - y));
    return r;
  };
  let cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
  let radius = reach(cx, cy);
  for (let iter = 0; iter < 3; iter++) {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < vert.length; i += stride) {
      if (Math.hypot(vert[i] - cx, vert[i + 1] - cy) >= 0.985 * radius) {
        xs.push(vert[i]);
        ys.push(vert[i + 1]);
      }
    }
    if (xs.length < 6) break;
    const fit = fitCircle(xs, ys);
    if (!(fit.r > 0) || Math.hypot(fit.cx - cx, fit.cy - cy) > 0.1 * radius) break;
    const r = reach(fit.cx, fit.cy);
    if (r >= radius) break;
    cx = fit.cx;
    cy = fit.cy;
    radius = r;
  }
  return { cx, cy, radius };
}

/** Tỉ lệ điểm nằm trong vật liệu trên vòng tròn bán kính r ở độ cao z. */
function ringFill(inside: (x: number, y: number) => boolean, r: number, samples = 180): number {
  let hit = 0;
  for (let i = 0; i < samples; i++) {
    const a = (2 * Math.PI * i) / samples;
    if (inside(r * Math.cos(a), r * Math.sin(a))) hit++;
  }
  return hit / samples;
}

/** Bỏ đường bao rất nhỏ so với lát cắt (đốm nhiễu trên mép vành của lưới đúc lại) – chỉ dùng khi đo viền. */
function majorPolys(polys: Poly[]): Poly[] {
  const areas = polys.map((p) => Math.abs(polygonArea(p)));
  const biggest = Math.max(0, ...areas);
  return polys.filter((_, i) => areas[i] >= biggest * 0.005);
}

/** Bán kính mép ngoài của lát cắt: chỗ thấp nhất trong các hướng, đi từ ngoài vào tới khi gặp vật liệu. */
function ringOuter(inside: (x: number, y: number) => boolean, rStart: number): number | null {
  let lowest: number | null = null;
  for (let j = 0; j < 72; j++) {
    const a = (2 * Math.PI * j) / 72;
    const c = Math.cos(a), d = Math.sin(a);
    let r = rStart;
    while (r > 0 && !inside(r * c, r * d)) r -= 0.005;
    if (r > 0) lowest = lowest === null ? r : Math.min(lowest, r);
  }
  return lowest;
}

/**
 * Bề dày viền mỏng nhất ở một lát cắt: từ mép ngoài cùng đi dần vào tâm theo nhiều hướng, đếm đoạn vật liệu liền đầu
 * tiên. Đo trực tiếp nên không bị đánh lừa bởi khe hở bằng 0 hay đường bao lạ trên lưới đúc lại.
 */
function ringWall(inside: (x: number, y: number) => boolean, rStart: number, cap: number): number | null {
  const step = 0.01;
  let thinnest: number | null = null;
  for (let j = 0; j < 72; j++) {
    const a = (2 * Math.PI * j) / 72;
    const c = Math.cos(a), d = Math.sin(a);
    let r = rStart;
    while (r > 0 && !inside(r * c, r * d)) r -= step;
    if (r <= 0) continue;
    const outer = r;
    while (r > 0 && outer - r < cap && inside(r * c, r * d)) r -= step;
    const t = outer - r;
    thinnest = thinnest === null ? t : Math.min(thinnest, t);
  }
  return thinnest;
}

/**
 * Viền mỏng nhất trên các lát cắt thân vành. Lát có mép ngoài nhô hẳn ra so với thân (trung vị các lát) là gờ mép vành,
 * thường có rãnh hở theo thiết kế nên không tính là viền.
 */
function barrelWall(testers: ((x: number, y: number) => boolean)[], rStart: number, cap: number): number | null {
  const rows: { outer: number; wall: number }[] = [];
  for (const inside of testers) {
    const outer = ringOuter(inside, rStart);
    const wall = ringWall(inside, rStart, cap);
    if (outer !== null && wall !== null) rows.push({ outer, wall });
  }
  if (!rows.length) return null;
  const median = rows.map((r) => r.outer).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  const barrel = rows.filter((r) => r.outer <= median + 0.1);
  return Math.min(...barrel.map((r) => r.wall));
}

/** Lát cắt theo lưới z cố định, tính một lần rồi dùng lại (lưới hàng trăm nghìn tam giác cắt rất tốn). */
class Slices {
  readonly zs: number[];
  private cache = new Map<number, Poly[]>();
  private testers = new Map<number, (x: number, y: number) => boolean>();
  constructor(private m: Manifold, W: number, n = 120) {
    this.zs = Array.from({ length: n }, (_, i) => ((i + 0.5) * W) / n);
  }
  at(i: number): Poly[] {
    let p = this.cache.get(i);
    if (!p) {
      p = slicePolys(this.m, this.zs[i]);
      this.cache.set(i, p);
    }
    return p;
  }
  /** Kiểm điểm trong vật liệu ở lát i (có chỉ mục, nhanh). */
  inside(i: number): (x: number, y: number) => boolean {
    let t = this.testers.get(i);
    if (!t) {
      t = regionTester(this.at(i));
      this.testers.set(i, t);
    }
    return t;
  }
}

/**
 * Khoảng z của mặt nan trên vòng bán kính r, tính từ mặt trong: từ chỗ vòng bắt đầu chạm vật liệu tới chỗ hết.
 * `skipBarrel`: bỏ qua đoạn đầu vòng kín gần như trọn (đó là thân vành dày, không phải nan).
 * Nan chạm ngay mặt trong → start = 0. Không chạm vật liệu nào → start = W.
 */
function faceRange(slices: Slices, r: number, W: number, skipBarrel = false): { start: number; end: number } {
  const step = W / slices.zs.length;
  let start = -1, end = W, inBarrel = skipBarrel;
  for (let i = 0; i < slices.zs.length; i++) {
    const f = ringFill(slices.inside(i), r);
    if (inBarrel && f > 0.9) continue;
    inBarrel = false;
    if (start < 0 && f >= 0.04) start = i === 0 ? 0 : slices.zs[i] - step / 2;
    else if (start >= 0 && f < 0.04) {
      end = slices.zs[i] - step / 2;
      break;
    }
  }
  return start < 0 ? { start: W, end: W } : { start, end };
}

/**
 * Phía mặt ngoài: nhìn dọc trục từ hai đầu, mặt ngoài là phía gặp vật liệu (mặt nan) sớm hơn;
 * mặt trong là phía rỗng sâu. Chỉ xét vùng nan (0,5R–0,8R), tránh khối trụ ở tâm và thân vành.
 */
function faceIsAtMaxZ(slices: Slices, R: number): boolean {
  const n = slices.zs.length;
  let fromBottom = 0, fromTop = 0, count = 0;
  for (const k of [0.5, 0.6, 0.7, 0.8]) {
    for (let j = 0; j < 36; j++) {
      const a = (2 * Math.PI * j) / 36;
      const x = k * R * Math.cos(a), y = k * R * Math.sin(a);
      let lo = -1, hi = -1;
      for (let i = 0; i < n && lo < 0; i++) if (slices.inside(i)(x, y)) lo = i;
      if (lo < 0) continue; // tia xuyên qua khe giữa các nan
      for (let i = n - 1; i >= 0 && hi < 0; i--) if (slices.inside(i)(x, y)) hi = i;
      fromBottom += lo;
      fromTop += n - 1 - hi;
      count++;
    }
  }
  return count === 0 ? true : fromTop <= fromBottom;
}

// ------------------------------------------------------------------ đo

/** Đo lại kết quả cuối – mọi con số báo cho người dùng đều lấy từ lưới thật, không lấy từ thông số mong muốn. */
export function measure(m: Manifold, spec: WheelSpec, faceStart: number, wallTop = faceStart, bossTop = faceStart, wallFrom = 0.02): Measurement {
  const mesh = arrays(m);
  const { min, max } = bounds(mesh);
  let rmax = 0;
  for (let i = 0; i < mesh.vert.length; i += mesh.stride) rmax = Math.max(rmax, Math.hypot(mesh.vert[i], mesh.vert[i + 1]));

  // Lỗ trục + khối trụ: lát cắt giữa chiều cao khối trụ.
  const zBoss = Math.max(0.05, Math.min(faceStart * 0.5, faceStart - 0.05, bossTop * 0.5));
  const polys = slicePolys(m, zBoss);
  let holeDiameter: number | null = null, bossDiameter: number | null = null;
  const holes = polys.filter((p) => polygonArea(p) < 0 && maxVertexRadius(p) < spec.boss / 2 + 0.5);
  if (holes.length) holeDiameter = 2 * Math.min(...holes.map(minEdgeDistance));
  const bossOuter = polys.filter((p) => polygonArea(p) > 0 && maxVertexRadius(p) < spec.diameter / 4);
  if (bossOuter.length) bossDiameter = 2 * Math.max(...bossOuter.map(maxVertexRadius));

  // Viền vành: mỏng nhất trong vùng từ mặt trong tới chỗ nan bắt đầu nối vào vành.
  const steps = 40;
  const testers: ((x: number, y: number) => boolean)[] = [];
  for (let i = 0; i < steps; i++) {
    const z = wallFrom + ((wallTop - wallFrom - 0.02) * i) / (steps - 1);
    if (z > 0 && z < wallTop) testers.push(regionTester(majorPolys(slicePolys(m, z))));
  }
  const minWall = barrelWall(testers, rmax + 0.02, spec.wall * 3);

  const count = countPieces(m);
  return {
    diameter: 2 * rmax,
    width: max[2] - min[2],
    holeDiameter,
    bossDiameter,
    minWall,
    bossHeight: null,
    wallHeight: null,
    triangles: m.numTri(),
    pieces: count,
    volume: m.volume(),
  };
}

// ------------------------------------------------------------------ xử lý

export function processWheel(
  wasm: ManifoldToplevel,
  soup: Float32Array,
  spec: WheelSpec = DEFAULT_SPEC,
  options: ProcessOptions = {},
): WheelResult {
  validateSpec(spec);
  const { Manifold } = wasm;
  const seg = options.segments ?? 128;
  const steps: string[] = [];
  const warnings: string[] = [];
  const trash: Manifold[] = [];
  const keep = (m: Manifold) => {
    trash.push(m);
    if (m.status() !== 'NoError') throw new Error(`Phép dựng hình thất bại (${m.status()}).`);
    return m;
  };

  try {
    const { manifold: loaded, repairs, info: repair } = options.preloaded
      ? { ...options.preloaded, manifold: options.preloaded.manifold.translate([0, 0, 0]), repairs: [...options.preloaded.repairs] }
      : loadWheel(wasm, soup, options.repair ?? DEFAULT_REPAIR, options.onStage);
    keep(loaded);
    options.onStage?.('wheel');
    // Bỏ mảnh rác thể tích ~0 (tam giác thừa) và gộp các khối chồng lên nhau thành một khối.
    const parts = loaded.decompose();
    const total = parts.reduce((s, p) => s + Math.abs(p.volume()), 0);
    const solidParts = parts.filter((p) => Math.abs(p.volume()) > total * 1e-6);
    const junk = parts.length - solidParts.length;
    const input = keep(keep(Manifold.union(solidParts)).asOriginal());
    let sourceId = input.originalID();
    for (const p of parts) p.delete();
    if (junk) repairs.push(`Bỏ ${junk} mảnh rác không có thể tích`);
    const inputPieces = countPieces(input);
    if (solidParts.length > 1) repairs.push(`Gộp ${solidParts.length} khối chồng nhau thành ${inputPieces} khối`);
    if (inputPieces > 1) warnings.push(`Mâm gốc gồm ${inputPieces} khối rời nhau (không chạm nhau).`);
    const srcMesh = arrays(input);

    // 1. Đặt trục quay về Z, tâm về gốc, mặt trong ở z = 0.
    const axis = findAxis(srcMesh);
    let m = keep(input.transform(mat4(rotationToZ(axis))));
    const mesh = arrays(m);
    const c = findCenter(mesh);
    const b = bounds(mesh);
    m = keep(m.translate([-c.cx, -c.cy, -b.min[2]]));
    const sourceWidth = b.max[2] - b.min[2];
    const sourceDiameter = 2 * c.radius;
    if (sourceWidth <= 0 || sourceDiameter <= 0) throw new Error('File không có kích thước (mâm dẹt hoặc rỗng).');
    if (axis[2] !== 1) steps.push('Xoay mâm cho trục quay trùng trục Z');

    // 2. Chỉ đổi kích thước: đường kính và bề rộng chỉnh riêng.
    const sr = spec.diameter / sourceDiameter;
    const sz = spec.width / sourceWidth;
    m = keep(m.scale([sr, sr, sz]));

    if (repair.rebuild) {
      // Đổi các con số của bước đúc lại sang mm sau chuẩn hóa để người dùng so được với kích thước mâm.
      const toMm = (v: number) => fmt(v * sr);
      steps.push(`Đúc lại mâm: ô lưới ${toMm(repair.rebuild.cell)} mm, 95% bề mặt gốc lệch ≤ ${toMm(repair.rebuild.p95)} mm`);
      warnings.push(
        `Mâm được đúc lại từ file lỗi: chi tiết nhỏ hơn khoảng ${toMm(repair.rebuild.cell * 3)} mm (lỗ ốc nhỏ, khe mảnh) có thể bị bít, lớp mặt không có độ dày được làm dày tối thiểu ${toMm(repair.rebuild.cell * 4)} mm. Kiểm tra lại hình trước khi in.`,
      );
    }

    const R = spec.diameter / 2;
    const W = spec.width;
    let slices = new Slices(m, W);
    // Mặt ngoài phải ở phía z lớn (mặt trong nằm trên z = 0 như mâm mẫu).
    const autoAtMax = faceIsAtMaxZ(slices, R);
    const faceAtMax = options.flip ? !autoAtMax : autoAtMax;
    if (!faceAtMax) {
      m = keep(m.transform(mat4([[1, 0, 0], [0, -1, 0], [0, 0, -1]], [0, 0, W])));
      slices = new Slices(m, W);
    }
    if (repair.rebuild) {
      // Lưới đúc lại từ file hỏng thường méo quanh vòng: làm tròn thân vành. File lành không qua bước này.
      m = keep(roundBarrel(wasm, m, R, W, faceRange(slices, 0.5 * R, W).end));
      sourceId = m.originalID();
      slices = new Slices(m, W);
      steps.push('Làm tròn lại thân vành theo biên dạng trung bình ở từng độ cao');
    }
    const prepared = m.translate([0, 0, 0]); // bản sao không nằm trong danh sách dọn
    // Mặt ngoài phải là trụ thẳng đúng đường kính từ đầu tới cuối, để in ra không gồ ghề; mâm đã thẳng thì không đổi.
    const fill = fillOuter(wasm, slices, R, W, seg);
    if (fill) {
      const rim = topRim(wasm, slices, R, W, spec.wall, seg);
      m = keep(m.add(keep(keep(fill).asOriginal())));
      m = keep(m.add(keep(keep(rim.ring).asOriginal())));
      // Đắp ngoài có thể bịt rãnh cuốn ở mép vành thành khoang kín bên trong (mảnh thể tích âm): lấp luôn.
      const shells = m.decompose();
      const solid = shells.filter((p) => p.volume() > 0);
      if (solid.length < shells.length) m = keep(Manifold.compose(solid));
      for (const p of shells) p.delete();
      slices = new Slices(m, W);
      steps.push(`Đắp đầy mặt ngoài thành trụ thẳng Ø${fmt(spec.diameter)} mm`);
      steps.push(`Làm vành phẳng đều ở mặt ngoài, rộng ${fmt(R - rim.inner)} mm, phủ kín mép gốc`);
    }
    steps.push(
      `Đổi kích thước: Ø${fmt(sourceDiameter)} → Ø${fmt(spec.diameter)} mm (×${fmt(sr, 3)}), ` +
        `rộng ${fmt(sourceWidth)} → ${fmt(spec.width)} mm (×${fmt(sz, 3)})`,
    );
    if (Math.abs(sr - sz) / Math.max(sr, sz) > 0.15) {
      warnings.push(
        `Tỉ lệ mâm gốc khác mâm chuẩn: chiều ngang ×${fmt(sr, 3)} nhưng bề rộng ×${fmt(sz, 3)} – mặt nan sẽ dày/mỏng đi theo bề rộng.`,
      );
    }

    const face = faceRange(slices, 0.5 * R, W);
    // Gần mép vành nan thường bắt đầu sớm hơn ở giữa: lớp đắp viền dừng ở chỗ sớm nhất để không lấn lên mặt nan.
    const faceNearRim = faceRange(slices, R - spec.wall - 0.15, W, true);
    if (face.start >= W) warnings.push('Không tìm thấy mặt nan ở bán kính giữa – mâm có thể là đĩa kín hoặc dáng lạ; kiểm tra lại mặt cắt.');
    const faceStart = Math.min(face.start, W);

    // 3. Viền vành tối thiểu `wall`: đắp vào phía trong, bám theo biên dạng ngoài, chỉ trong vùng sau mặt nan.
    const wallAuto = Math.min(faceStart, faceNearRim.start);
    // Lưới đúc lại có mép bo tròn cỡ 2 ô ở hai đầu mâm: lát cắt trong lớp đó không phản ánh độ dày viền.
    const wallFrom = repair.rebuild ? Math.max(0.02, repair.rebuild.cell * 2 * sz) : 0.02;
    const wallTop = spec.wallHeight ?? wallAuto;
    if (spec.wallHeight === null && wallAuto < 0.1) {
      warnings.push('Nan chạy sát tới mặt trong nên không có đoạn viền vành trống để đắp – viền vành giữ nguyên, không đo được độ dày.');
    }
    if (spec.wallHeight !== null && wallAuto >= 0.1) {
      if (wallTop > wallAuto + 0.02) {
        warnings.push(`Vòng đắp cao ${fmt(wallTop)} mm vượt chỗ nan nối vào vành (z = ${fmt(wallAuto)} mm) – sẽ lấn lên nan, nhìn từ mặt ngoài có thể thấy.`);
      } else if (wallTop < wallAuto - 0.02 && wallThinnest(slices, wallAuto, R + 0.02, spec.wall * 3, wallFrom) < spec.wall - 1e-3) {
        warnings.push(`Vòng đắp chỉ cao ${fmt(wallTop)} mm – đoạn viền từ đó tới z = ${fmt(wallAuto)} mm vẫn mỏng hơn ${fmt(spec.wall)} mm.`);
      }
    }
    const wallAdded = wallTop < 0.1 ? null : thickenWall(wasm, slices, spec.wall, wallTop, seg, wallThinnest(slices, wallTop, R + 0.02, spec.wall * 3, wallFrom), R + 0.02);
    if (spec.wallHeight !== null && !wallAdded) warnings.push('Chiều cao vòng đắp quá nhỏ – không đắp được.');
    let shellId: number | null = null;
    if (wallAdded?.shell) {
      const shell = keep(keep(wallAdded.shell).asOriginal());
      shellId = shell.originalID();
      m = keep(m.add(shell));
      steps.push(`Đắp viền vành từ z = 0 tới z = ${fmt(wallTop)} mm: chỗ mỏng nhất ${fmt(wallAdded.thinnest)} mm → tối thiểu ${fmt(spec.wall)} mm`);
    } else if (wallAdded) {
      steps.push(`Viền vành đã dày ≥ ${fmt(spec.wall)} mm (mỏng nhất ${fmt(wallAdded.thinnest)} mm) – không đắp thêm`);
    }

    // 4. Khối trụ ở tâm mặt trong + lỗ trục xuyên suốt.
    const rb = spec.boss / 2;
    const oldHub = existingHub(m, faceStart, R);
    if (oldHub && oldHub.radius > rb + 0.02) {
      const ring = keep(
        keep(Manifold.cylinder(faceStart, oldHub.radius + 0.05, oldHub.radius + 0.05, seg)).subtract(
          keep(Manifold.cylinder(faceStart + 0.2, rb, rb, seg).translate([0, 0, -0.1])),
        ),
      );
      m = keep(m.subtract(ring));
      steps.push(`Gọt khối trụ cũ Ø${fmt(2 * oldHub.radius)} → Ø${fmt(spec.boss)} mm`);
    }
    const before = countPieces(m);
    const makeBoss = (h: number) => keep(keep(Manifold.cylinder(h, rb, rb, seg)).asOriginal());
    let top = spec.bossHeight ?? Math.min(faceStart + 0.05, W);
    let boss = makeBoss(top);
    let withBoss = keep(m.add(boss));
    // Tự động: khối trụ phải dính vào thân mâm – nếu chưa chạm, nối dài dần tới hết mặt nan.
    while (spec.bossHeight === null && countPieces(withBoss) > before && top < face.end) {
      top = Math.min(top + 0.1, face.end);
      boss = makeBoss(top);
      withBoss = keep(m.add(boss));
    }
    if (countPieces(withBoss) > before) {
      warnings.push(
        spec.bossHeight === null
          ? `Khối trụ Ø${fmt(spec.boss)} không chạm vào thân mâm – lỗ tâm của mâm gốc rộng hơn khối trụ.`
          : `Khối trụ cao ${fmt(top)} mm chưa chạm mặt nan (bắt đầu ở z = ${fmt(faceStart)} mm) nên bị rời khỏi mâm – tăng chiều cao hoặc để tự động.`,
      );
    }
    if (spec.bossHeight !== null) {
      if (top > face.end) warnings.push(`Khối trụ cao ${fmt(top)} mm vượt qua mặt nan (hết ở z = ${fmt(face.end)} mm) – sẽ nhô ra, nhìn thấy từ mặt ngoài.`);
      else if (top < faceStart - 0.02 && oldHub) warnings.push(`Trụ cũ của mâm vẫn còn từ z = ${fmt(top)} mm lên tới mặt nan – app không xóa phần đó.`);
    }
    m = withBoss;
    const bossId = boss.originalID();
    steps.push(`Thêm khối trụ Ø${fmt(spec.boss)} mm từ mặt trong (z = 0) tới z = ${fmt(top)} mm`);

    // Đa giác ngoại tiếp: mặt phẳng trong lỗ cách tâm đúng hole/2 → lỗ không bao giờ nhỏ hơn thông số.
    const rh = spec.hole / 2 / Math.cos(Math.PI / seg);
    m = keep(m.subtract(keep(Manifold.cylinder(W + 2, rh, rh, seg).translate([0, 0, -1]))));
    steps.push(`Khoan lỗ trục Ø${fmt(spec.hole)} mm xuyên từ mặt trong ra mặt ngoài`);

    const result = dropSlivers(wasm, m); // vẫn giữ originalID để phân biệt phần gốc / phần thêm
    // Viền chỉ đo trong đoạn trước chỗ nan nối vào vành – phía trên đó "viền" không còn là thành vành.
    const measured = measure(result, spec, faceStart, wallAuto >= 0.1 ? Math.min(wallTop, wallAuto) : wallTop, top, wallFrom);
    measured.bossHeight = bossHeight(result, bossId, top, (rb + spec.hole / 2) / 2);
    measured.wallHeight = shellId === null ? null : wallHeight(result, shellId, wallTop, spec.wall, R + 0.02);
    const checks = buildChecks(spec, measured, top, wallTop);
    if (repair.rebuild) {
      const limit = repair.rebuild.cell * 3 * sr;
      checks.push({
        label: 'Bám sát file gốc (95% bề mặt)',
        target: `≤ ${fmt(limit)} mm`,
        actual: `${fmt(repair.rebuild.p95 * sr, 3)} mm`,
        ok: repair.rebuild.p95 * sr <= limit,
      });
    }
    if (measured.pieces > 1) warnings.push(`Kết quả gồm ${measured.pieces} khối rời – kiểm tra mặt cắt trước khi in.`);
    return {
      manifold: result,
      prepared,
      sourceId,
      report: {
        source: { triangles: repair.diagnosis.triangles, diameter: sourceDiameter, width: sourceWidth, axis, repairs, repair },
        steps,
        warnings,
        faceStart,
        wallTop,
        bossTop: top,
        autoFlipped: !autoAtMax,
        result: measured,
        checks,
      },
    };
  } finally {
    for (const t of trash) t.delete();
  }
}

/** Lý do bộ thông số không dùng được, hoặc null nếu hợp lệ. */
export function specError(s: WheelSpec): string | null {
  for (const [k, v] of Object.entries(s)) {
    if (v === null && (k === 'bossHeight' || k === 'wallHeight')) continue;
    if (!(Number.isFinite(v) && (v as number) > 0)) return 'Mọi thông số phải là số dương.';
  }
  if ((s.bossHeight ?? 0) > s.width) return 'Chiều cao khối trụ không được lớn hơn bề rộng mâm.';
  if ((s.wallHeight ?? 0) > s.width) return 'Chiều cao vòng đắp không được lớn hơn bề rộng mâm.';
  if (s.hole >= s.boss) return 'Lỗ trục phải nhỏ hơn khối trụ.';
  if (s.boss >= s.diameter - 2 * s.wall) return 'Khối trụ quá to so với lòng vành.';
  return null;
}

function validateSpec(s: WheelSpec) {
  const error = specError(s);
  if (error) throw new Error(error);
}

/** Số khối thật: mảnh thể tích ~0 (tam giác kẹt lại sau phép ghép) không tính. */
function countPieces(m: Manifold): number {
  const parts = m.decompose();
  const total = parts.reduce((s, p) => s + Math.abs(p.volume()), 0);
  const n = parts.filter((p) => Math.abs(p.volume()) > total * 1e-6).length;
  for (const p of parts) p.delete();
  return n;
}

/**
 * Làm tròn thân vành của lưới đúc lại. Mâm là vật tròn xoay nên mặt ngoài vành ở mỗi độ cao phải cách trục đều nhau;
 * phần lượn sóng quanh vòng là do file gốc hỏng. Đỉnh thuộc mặt ngoài vành (pháp tuyến hướng ra, gần mép ngoài) được đưa
 * về bán kính trung vị của độ cao đó, giữ nguyên gân và mép vành. Mặt trong chỉ xử lý đoạn phía trên mặt nan, gần mép
 * ngoài – ở đó không có nan. Nan, moay-ơ và mặt thiết kế không bị đụng tới.
 */
function roundBarrel(wasm: ManifoldToplevel, m: Manifold, R: number, W: number, faceEnd: number): Manifold {
  const mesh = m.getMesh();
  const { vertProperties, triVerts, numProp } = mesh;
  const vert = Float32Array.from(vertProperties);
  const n = vert.length / numProp;
  const normal = new Float32Array(n * 3);
  for (let f = 0; f < triVerts.length; f += 3) {
    const [a, b, c] = [triVerts[f] * numProp, triVerts[f + 1] * numProp, triVerts[f + 2] * numProp];
    const ux = vert[b] - vert[a], uy = vert[b + 1] - vert[a + 1], uz = vert[b + 2] - vert[a + 2];
    const vx = vert[c] - vert[a], vy = vert[c + 1] - vert[a + 1], vz = vert[c + 2] - vert[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (let k = 0; k < 3; k++) {
      const i = triVerts[f + k] * 3;
      normal[i] += nx;
      normal[i + 1] += ny;
      normal[i + 2] += nz;
    }
  }
  const BINS = 120;
  // Theo tỉ lệ bán kính: độ tản tối đa trong một độ cao, bước bán kính giữa hai độ cao kề, và khoảng dời tối đa của đỉnh.
  const MAX_SPREAD = 0.02, MAX_STEP = 0.006, MAX_MOVE = 0.015;
  const binOf = (z: number) => Math.min(BINS - 1, Math.max(0, Math.floor((z / W) * BINS)));
  // Bán kính lớn nhất của từng độ cao: chỉ đỉnh gần mép ngoài mới thuộc mặt ngoài vành.
  const reach = new Float32Array(BINS);
  const radius = new Float32Array(n);
  const radial = new Float32Array(n); // cos góc giữa pháp tuyến và hướng tỏa từ trục
  for (let i = 0; i < n; i++) {
    const o = i * numProp;
    const r = Math.hypot(vert[o], vert[o + 1]);
    radius[i] = r;
    const len = Math.hypot(normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]) || 1;
    radial[i] = r > 0 ? (normal[i * 3] * vert[o] + normal[i * 3 + 1] * vert[o + 1]) / (r * len) : 0;
    const b = binOf(vert[o + 2]);
    reach[b] = Math.max(reach[b], r);
  }
  const collect = (select: (i: number, b: number) => boolean): { ids: number[]; profile: Float32Array } => {
    const bins: number[][] = Array.from({ length: BINS }, () => []);
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      const b = binOf(vert[i * numProp + 2]);
      if (select(i, b)) {
        bins[b].push(radius[i]);
        ids.push(i);
      }
    }
    // Trung vị từng độ cao; độ cao có đỉnh tản rộng là chỗ hai mặt khác nhau gặp nhau (mép, bậc gấp) – không đụng tới.
    const raw = bins.map((list) => {
      if (list.length < 8) return NaN;
      list.sort((x, y) => x - y);
      const spread = list[Math.floor(list.length * 0.9)] - list[Math.floor(list.length * 0.1)];
      return spread > MAX_SPREAD * R ? NaN : list[Math.floor(list.length / 2)];
    });
    // Chỉ giữ đoạn thẳng: độ cao liền kề hai bên đều hợp lệ và không đổi bán kính đột ngột. Mép vành bị loại ở đây.
    const profile = new Float32Array(BINS).fill(NaN);
    for (let b = 1; b < BINS - 1; b++) {
      const a = raw[b - 1], c = raw[b + 1];
      if (Number.isNaN(a) || Number.isNaN(raw[b]) || Number.isNaN(c)) continue;
      if (Math.abs(a - raw[b]) > MAX_STEP * R || Math.abs(c - raw[b]) > MAX_STEP * R) continue;
      profile[b] = (a + raw[b] + c) / 3;
    }
    return { ids, profile };
  };
  const apply = ({ ids, profile }: { ids: number[]; profile: Float32Array }) => {
    for (const i of ids) {
      const o = i * numProp;
      const target = profile[binOf(vert[o + 2])];
      if (Number.isNaN(target) || radius[i] === 0 || Math.abs(target - radius[i]) > MAX_MOVE * R) continue;
      const k = target / radius[i];
      vert[o] *= k;
      vert[o + 1] *= k;
    }
  };
  const margin = 0.06 * R;
  apply(collect((i, b) => radial[i] > 0.6 && radius[i] >= reach[b] - margin));
  apply(collect((i) => radial[i] < -0.6 && radius[i] >= R - 0.2 * R && vert[i * numProp + 2] > faceEnd));
  const out = new wasm.Mesh({ numProp, vertProperties: vert, triVerts });
  const rounded = wasm.Manifold.ofMesh(out);
  return rounded.asOriginal();
}

/**
 * Vành phẳng ở mặt ngoài mâm: mép gốc rộng hẹp và cao thấp không đều, nên phủ một vòng tròn đều lên trên, mặt trên phẳng
 * ở đúng z = W. Mép trong lấy theo chỗ mép gốc ăn vào sâu nhất để phủ kín, nhưng không rộng quá 1,5 lần độ dày viền để
 * khỏi che nan. Mặt dưới kéo xuống tới chỗ vành gốc đã đặc trọn vòng để dính liền.
 */
function topRim(wasm: ManifoldToplevel, slices: Slices, R: number, W: number, wall: number, seg: number): { ring: Manifold; inner: number } {
  const n = slices.zs.length;
  const band = W * 0.05;
  let inner = R - 0.15;
  for (let i = n - 1; i >= 0 && slices.zs[i] > W - band; i--) {
    const polys = majorPolys(slices.at(i));
    const hole = polys
      .filter((p) => polygonArea(p) < 0)
      .sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))[0];
    if (hole) inner = Math.min(inner, minEdgeDistance(hole));
  }
  inner = Math.max(inner, R - 1.5 * wall);
  const mid = (inner + R) / 2;
  let bottom = W - band;
  for (let i = n - 1; i >= 0; i--) {
    if (ringFill(regionTester(majorPolys(slices.at(i))), mid) >= 0.98) {
      bottom = Math.min(bottom, slices.zs[i] - 0.02);
      break;
    }
  }
  bottom = Math.max(bottom, W * 0.5);
  const h = W - bottom;
  const ring = wasm.Manifold.cylinder(h, R, R, seg).subtract(wasm.Manifold.cylinder(h + 2, inner, inner, seg).translate([0, 0, -1])).translate([0, 0, bottom]);
  if (ring.status() !== 'NoError' || ring.isEmpty()) {
    ring.delete();
    throw new Error('Không dựng được vành mặt ngoài.');
  }
  return { ring, inner };
}

/**
 * Lớp đắp hình tròn xoay lấp từ mặt ngoài hiện tại ra đúng bán kính R trên suốt bề rộng. Lấn vào thành 0,03 mm để dính
 * liền; không lấn quá 0,7R nên một khe hở trên thành không kéo lớp đắp che mất nan. Trả null nếu mặt ngoài đã thẳng.
 */
function fillOuter(wasm: ManifoldToplevel, slices: Slices, R: number, W: number, seg: number): Manifold | null {
  const zs: number[] = [];
  const inner: number[] = [];
  let lowest = Infinity;
  for (let i = 0; i < slices.zs.length; i++) {
    const ro = ringOuter(regionTester(majorPolys(slices.at(i))), R + 0.02);
    if (ro === null) continue;
    lowest = Math.min(lowest, ro);
    zs.push(slices.zs[i]);
    inner.push(Math.max(0.7 * R, ro - 0.03));
  }
  if (zs.length < 2 || lowest >= R - 0.01) return null;
  zs[0] = 0;
  zs[zs.length - 1] = W;
  const profile: [number, number][] = zs.map((z, i) => [inner[i], z]);
  profile.push([R, W], [R, 0]);
  if (polygonArea(profile) < 0) profile.reverse();
  const shell = wasm.Manifold.revolve([profile], seg);
  if (shell.status() !== 'NoError' || shell.isEmpty()) {
    shell.delete();
    throw new Error('Không dựng được lớp đắp mặt ngoài.');
  }
  return shell;
}

/** Bỏ mảnh thể tích ~0 để file xuất ra chỉ gồm khối thật. */
function dropSlivers(wasm: ManifoldToplevel, m: Manifold): Manifold {
  const parts = m.decompose();
  const total = parts.reduce((s, p) => s + Math.abs(p.volume()), 0);
  const real = parts.filter((p) => Math.abs(p.volume()) > total * 1e-6);
  const out = real.length === parts.length ? m.translate([0, 0, 0]) : wasm.Manifold.compose(real);
  for (const p of parts) p.delete();
  return out;
}

/** Khối trụ cũ ở tâm (nếu có): đa giác quanh tâm ở lát cắt sau mặt nan. */
function existingHub(m: Manifold, faceStart: number, R: number): { radius: number } | null {
  const z = faceStart * 0.4;
  if (z <= 0) return null;
  const polys = slicePolys(m, z).filter((p) => polygonArea(p) > 0 && maxVertexRadius(p) < 0.6 * R);
  if (!polys.length) return null;
  return { radius: Math.max(...polys.map(maxVertexRadius)) };
}

/** z cao nhất của các tam giác còn lại từ phần thêm có originalID = id; null nếu không còn tam giác nào. */
function runTop(m: Manifold, id: number): number | null {
  const mesh = m.getMesh();
  const { runIndex, runOriginalID, triVerts, vertProperties, numProp } = mesh;
  if (!runIndex || !runOriginalID) return null;
  let top: number | null = null;
  for (let r = 0; r < runOriginalID.length; r++) {
    if (runOriginalID[r] !== id) continue;
    for (let i = runIndex[r]; i < runIndex[r + 1]; i++) {
      const z = vertProperties[triVerts[i] * numProp + 2];
      top = top === null ? z : Math.max(top, z);
    }
  }
  return top;
}

/**
 * Đo chiều cao thật của phần thêm. Đỉnh có thể chìm trong vật liệu gốc (khi đó tam giác đỉnh bị gộp mất), nên kiểm
 * thêm: ngay dưới chiều cao đặt, vòng tròn bán kính r phải kín vật liệu. Trả về chiều cao đo được.
 */
function reachedHeight(m: Manifold, id: number, top: number, radiusAt: (polys: Poly[]) => number): number | null {
  const highest = runTop(m, id);
  const polys = slicePolys(m, top - 0.005);
  const solid = ringFill(regionTester(polys), radiusAt(polys)) >= 0.98;
  if (highest !== null && highest > top + 0.01) return highest;
  return solid ? top : highest;
}

function bossHeight(m: Manifold, id: number, top: number, r: number): number | null {
  return reachedHeight(m, id, top, () => r);
}

function wallHeight(m: Manifold, id: number, top: number, wall: number, rStart: number): number | null {
  return reachedHeight(m, id, top, (polys) => (ringOuter(regionTester(majorPolys(polys)), rStart) ?? wall) - wall + 0.06);
}

/** Độ dày viền mỏng nhất từ mặt trong tới z = top (đo trên các lát cắt). */
function wallThinnest(slices: Slices, top: number, rStart: number, cap: number, from = 0): number {
  const testers: ((x: number, y: number) => boolean)[] = [];
  for (let i = 0; i < slices.zs.length && slices.zs[i] < top; i += 2) {
    if (slices.zs[i] >= from) testers.push(regionTester(majorPolys(slices.at(i))));
  }
  return barrelWall(testers, rStart, cap) ?? Infinity;
}

/** Lớp đắp hình tròn xoay: từ (r_ngoài − wall) tới sát r_ngoài, z ∈ [0, faceStart]. Trả null nếu không cần. */
function thickenWall(
  wasm: ManifoldToplevel,
  slices: Slices,
  wall: number,
  top: number,
  seg: number,
  thinnest: number,
  rStart: number,
): { shell: Manifold | null; thinnest: number } | null {
  const zs: number[] = [];
  const rOut: number[] = [];
  for (let i = 0; i < slices.zs.length && slices.zs[i] < top; i++) {
    const ro = ringOuter(regionTester(majorPolys(slices.at(i))), rStart);
    if (ro === null) continue;
    zs.push(slices.zs[i]);
    rOut.push(ro);
  }
  if (zs.length < 2) return null;
  // Kéo hai đầu biên dạng ra đúng z = 0 và z = top (lát cắt nằm ở giữa mỗi bước).
  zs[0] = 0;
  zs[zs.length - 1] = top;
  if (thinnest >= wall - 1e-3) return { shell: null, thinnest };
  // Mép ngoài của lớp đắp lùi vào 0,02 mm và lấy min với điểm kề để không bao giờ lồi ra mặt ngoài vành.
  const outerR = rOut.map((r, i) => Math.min(r, rOut[i - 1] ?? r, rOut[i + 1] ?? r) - 0.02);
  // Mặt trong tính từ mép ngoài đã lùi 0,02 mm: dư một chút để viền đo ở mọi hướng vẫn không dưới `wall`.
  const innerR = outerR.map((r) => Math.max(0.01, r - wall));
  const profile: [number, number][] = [];
  for (let i = 0; i < zs.length; i++) profile.push([innerR[i], zs[i]]);
  for (let i = zs.length - 1; i >= 0; i--) profile.push([outerR[i], zs[i]]);
  if (polygonArea(profile) < 0) profile.reverse(); // biên dạng phải ngược chiều kim đồng hồ
  const shell = wasm.Manifold.revolve([profile], seg);
  if (shell.status() !== 'NoError' || shell.isEmpty()) {
    shell.delete();
    throw new Error('Không dựng được lớp đắp viền vành (biên dạng vành bất thường).');
  }
  return { shell, thinnest };
}

function buildChecks(spec: WheelSpec, r: Measurement, bossTop: number, wallTop: number) {
  const near = (a: number | null, b: number, tol: number) => a !== null && Math.abs(a - b) <= tol;
  return [
    { label: 'Đường kính ngoài', target: `${fmt(spec.diameter)} mm`, actual: `${fmt(r.diameter, 3)} mm`, ok: near(r.diameter, spec.diameter, 0.01) },
    { label: 'Bề rộng mâm', target: `${fmt(spec.width)} mm`, actual: `${fmt(r.width, 3)} mm`, ok: near(r.width, spec.width, 0.01) },
    { label: 'Lỗ trục', target: `Ø${fmt(spec.hole)} mm`, actual: `Ø${fmt(r.holeDiameter, 3)} mm`, ok: near(r.holeDiameter, spec.hole, 0.01) },
    { label: 'Khối trụ', target: `Ø${fmt(spec.boss)} mm`, actual: `Ø${fmt(r.bossDiameter, 3)} mm`, ok: near(r.bossDiameter, spec.boss, 0.02) },
    {
      label: 'Chiều cao khối trụ',
      target: spec.bossHeight === null ? 'Tự động' : `${fmt(spec.bossHeight)} mm`,
      actual: `${fmt(r.bossHeight, 3)} mm`,
      ok: near(r.bossHeight, bossTop, 0.01),
    },
    { label: 'Viền vành mỏng nhất', target: `≥ ${fmt(spec.wall)} mm`, actual: `${fmt(r.minWall, 3)} mm`, ok: r.minWall !== null && r.minWall >= spec.wall - 0.03 },
    {
      label: 'Chiều cao vòng đắp',
      target: spec.wallHeight === null ? 'Tự động' : `${fmt(spec.wallHeight)} mm`,
      actual: r.wallHeight === null ? 'Không cần đắp' : `${fmt(r.wallHeight, 3)} mm`,
      ok: r.wallHeight === null || near(r.wallHeight, wallTop, 0.01),
    },
    { label: 'Khối liền, kín nước', target: '1 khối', actual: `${r.pieces} khối`, ok: r.pieces === 1 },
  ];
}
