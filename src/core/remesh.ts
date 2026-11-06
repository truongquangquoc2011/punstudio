import type { Manifold, ManifoldToplevel } from 'manifold-3d';

/**
 * Đúc lại mâm lỗi nặng thành một khối đặc kín.
 *
 * Không tin vào cấu trúc lưới (cạnh hở, mặt lật, mảnh chồng nhau đều bỏ qua) – chỉ dùng vị trí bề mặt:
 * 1. Đánh dấu các ô lưới (voxel) có bề mặt đi qua.
 * 2. Bịt khe ≤ 2·seal ô bằng phép đóng hình thái học (nở ra rồi co lại).
 * 3. Loang từ ngoài vào: ô không chạm được từ bên ngoài là ruột.
 * 4. Làm mịn nhẹ trường đặc/rỗng rồi dựng mặt kín bằng tứ diện hóa lưới ô (marching tetrahedra).
 *
 * Độ chính xác ≈ một ô lưới; ô càng nhỏ càng sát hình gốc nhưng càng chậm.
 */

export interface RemeshOptions {
  /** Số ô theo chiều dài nhất của vật. */
  resolution: number;
  /** Bịt lỗ/khe hở rộng tới 2·seal ô. */
  seal: number;
  /** Làm mịn (độ lệch chuẩn Gauss, đơn vị ô). 0 = giữ bậc thang của ô. */
  smooth: number;
}

export const DEFAULT_REMESH: RemeshOptions = { resolution: 220, seal: 1, smooth: 1.2 };

export interface RemeshResult {
  manifold: Manifold;
  cell: number;
  grid: [number, number, number];
  /** Số mảnh vụn đã bỏ. */
  dropped: number;
}

export type RemeshStage = 'voxel' | 'fill' | 'smooth' | 'surface' | 'simplify' | 'clean';

export function remesh(
  wasm: ManifoldToplevel,
  soup: Float32Array,
  opts: RemeshOptions = DEFAULT_REMESH,
  onStage?: (stage: RemeshStage) => void,
): RemeshResult {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < soup.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], soup[i + k]);
      max[k] = Math.max(max[k], soup[i + k]);
    }
  }
  const longest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (!(longest > 0)) throw new Error('File không có kích thước.');
  const h = longest / opts.resolution;
  const seal = Math.max(1, Math.round(opts.seal));
  const pad = seal + 4;
  const n = [0, 1, 2].map((k) => Math.ceil((max[k] - min[k]) / h) + 2 * pad) as [number, number, number];
  const origin = [0, 1, 2].map((k) => min[k] - pad * h);
  const [nx, ny, nz] = n;
  const total = nx * ny * nz;
  if (total > 60_000_000) throw new Error('Độ phân giải quá cao cho bộ nhớ – giảm độ mịn.');
  const idx = (x: number, y: number, z: number) => (z * ny + y) * nx + x;

  onStage?.('voxel');
  // 1. Bề mặt → ô. Lấy mẫu mỗi tam giác với bước ≤ h/2 để không sót ô.
  let mask = new Uint8Array(total);
  for (let t = 0; t < soup.length; t += 9) {
    const a = [soup[t], soup[t + 1], soup[t + 2]];
    const b = [soup[t + 3], soup[t + 4], soup[t + 5]];
    const c = [soup[t + 6], soup[t + 7], soup[t + 8]];
    const e = Math.max(dist(a, b), dist(b, c), dist(c, a));
    const m = Math.max(1, Math.ceil(e / (h * 0.5)));
    for (let i = 0; i <= m; i++) {
      for (let j = 0; j <= m - i; j++) {
        const u = i / m, v = j / m;
        const x = Math.floor((a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v - origin[0]) / h);
        const y = Math.floor((a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v - origin[1]) / h);
        const z = Math.floor((a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v - origin[2]) / h);
        mask[idx(x, y, z)] = 1;
      }
    }
  }

  onStage?.('fill');
  // 2. Nở bề mặt `seal` lần (6 hướng) – bịt khe hở trên lưới.
  for (let s = 0; s < seal; s++) mask = dilate(mask, n);

  // 3. Loang từ biên hộp qua các ô trống: phần không tới được là ruột (cộng lớp bề mặt).
  const outside = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0, tail = 0;
  const push = (i: number) => {
    if (!outside[i] && !mask[i]) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (const x of [0, nx - 1]) push(idx(x, y, z));
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) for (const y of [0, ny - 1]) push(idx(x, y, z));
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) for (const z of [0, nz - 1]) push(idx(x, y, z));
  const sxy = nx * ny;
  while (head < tail) {
    const i = queue[head++];
    const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / sxy);
    if (x > 0) push(i - 1);
    if (x < nx - 1) push(i + 1);
    if (y > 0) push(i - nx);
    if (y < ny - 1) push(i + nx);
    if (z > 0) push(i - sxy);
    if (z < nz - 1) push(i + sxy);
  }
  let solid = new Uint8Array(total);
  for (let i = 0; i < total; i++) solid[i] = outside[i] ? 0 : 1;

  // Co lại đúng số lần đã nở (phép đóng): bề mặt về lại chỗ cũ, khe đã bịt thì vẫn kín.
  for (let s = 0; s < seal; s++) solid = erode(solid, n);

  // Lớp mặt không có độ dày (thân vành, nắp tâm dựng bằng một mặt đơn) lúc này chỉ dày 1–2 ô, bước làm mịn sẽ xóa mất.
  // Dò bằng phép mở (co rồi nở): chỗ biến mất là chỗ mỏng → làm dày lên ~5 ô, đủ để không vỡ khi làm mịn và bù lệch.
  // Phần đã có khối không bị ảnh hưởng.
  const thick = dilate(erode(solid, n), n);
  let thin = new Uint8Array(total);
  for (let i = 0; i < total; i++) thin[i] = solid[i] && !thick[i] ? 1 : 0;
  thin = dilate(dilate(thin, n), n);
  for (let i = 0; i < total; i++) if (thin[i]) solid[i] = 1;

  onStage?.('smooth');
  // 4. Trường mịn: Gauss tách 3 chiều trên đặc/rỗng → giá trị ~ khoảng cách có dấu tới mặt (dương = trong).
  const field = new Float32Array(total);
  for (let i = 0; i < total; i++) field[i] = solid[i];
  if (opts.smooth > 0) blur3(field, n, opts.smooth);

  // Ô bề mặt nằm vắt qua mặt thật nên khối bị to ra khoảng nửa ô. Ngưỡng trên 0,5 kéo mặt dựng lại vào trong để bù:
  // với Gauss độ lệch σ ô, dời vào d ô tương ứng ngưỡng Φ(d/σ).
  onStage?.('surface');
  const surface = marchingTets(field, n, origin, h, opts.smooth > 0 ? normalCdf(0.5 / opts.smooth) : 0.5);
  const raw = wasm.Manifold.ofMesh(new wasm.Mesh({ numProp: 3, vertProperties: surface.vert, triVerts: surface.tri }));
  if (raw.status() !== 'NoError' || raw.isEmpty()) {
    raw.delete();
    throw new Error('Đúc lại không ra khối nào – file có thể chỉ là mặt phẳng hở hoàn toàn.');
  }
  onStage?.('simplify');
  // Giảm tam giác ở vùng phẳng: bề mặt dịch không quá 1/4 ô.
  const simple = raw.simplify(h * 0.25);
  raw.delete();
  onStage?.('clean');
  // Bỏ mảnh vụn nhiễu (nhỏ hơn 0,5% khối lớn nhất).
  const parts = simple.decompose();
  simple.delete();
  const biggest = Math.max(...parts.map((p) => p.volume()));
  const kept = parts.filter((p) => p.volume() >= biggest * 0.005);
  const dropped = parts.length - kept.length;
  const manifold = wasm.Manifold.union(kept);
  for (const p of parts) p.delete();
  return { manifold, cell: h, grid: n, dropped };
}

/** Hàm phân phối chuẩn tích lũy (xấp xỉ Abramowitz–Stegun, đủ cho x > 0). */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * x);
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 1 - (Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI)) * poly;
}

function dist(a: number[], b: number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function dilate(src: Uint8Array, [nx, ny, nz]: [number, number, number]): Uint8Array {
  const out = src.slice();
  const sxy = nx * ny;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = (z * ny + y) * nx + x;
        if (!src[i]) continue;
        if (x > 0) out[i - 1] = 1;
        if (x < nx - 1) out[i + 1] = 1;
        if (y > 0) out[i - nx] = 1;
        if (y < ny - 1) out[i + nx] = 1;
        if (z > 0) out[i - sxy] = 1;
        if (z < nz - 1) out[i + sxy] = 1;
      }
    }
  }
  return out;
}

function erode(src: Uint8Array, n: [number, number, number]): Uint8Array {
  const inv = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) inv[i] = src[i] ? 0 : 1;
  const grown = dilate(inv, n);
  for (let i = 0; i < src.length; i++) grown[i] = grown[i] ? 0 : 1;
  return grown;
}

function blur3(f: Float32Array, [nx, ny, nz]: [number, number, number], sigma: number) {
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const w: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    w.push(v);
    sum += v;
  }
  for (let i = 0; i < w.length; i++) w[i] /= sum;
  const strides = [1, nx, nx * ny];
  const dims = [nx, ny, nz];
  const tmp = new Float32Array(Math.max(nx, ny, nz));
  for (let axis = 0; axis < 3; axis++) {
    const s = strides[axis], len = dims[axis];
    const others = [0, 1, 2].filter((a) => a !== axis);
    for (let b = 0; b < dims[others[1]]; b++) {
      for (let a = 0; a < dims[others[0]]; a++) {
        const base = a * strides[others[0]] + b * strides[others[1]];
        for (let i = 0; i < len; i++) {
          let acc = 0;
          for (let k = -r; k <= r; k++) {
            const j = Math.min(len - 1, Math.max(0, i + k));
            acc += f[base + j * s] * w[k + r];
          }
          tmp[i] = acc;
        }
        for (let i = 0; i < len; i++) f[base + i * s] = tmp[i];
      }
    }
  }
}

/**
 * Dựng mặt đẳng trị bằng marching tetrahedra: mỗi ô lập phương chia 6 tứ diện dọc đường chéo chính (cách chia
 * Kuhn, khớp nhau giữa các ô kề) → mặt luôn kín và đa tạp. Giá trị > iso là bên trong.
 */
function marchingTets(
  field: Float32Array,
  [nx, ny, nz]: [number, number, number],
  origin: number[],
  h: number,
  iso: number,
): { vert: Float32Array; tri: Uint32Array } {
  const sxy = nx * ny;
  const total = nx * ny * nz;
  const verts: number[] = [];
  const tris: number[] = [];
  const edgeVert = new Map<number, number>();
  // 6 tứ diện: góc 0, a, a|b, 7 với (a, b, c) là hoán vị của 3 trục (bit x = 1, y = 2, z = 4).
  const TETS = [
    [0, 1, 3, 7], [0, 1, 5, 7], [0, 2, 3, 7], [0, 2, 6, 7], [0, 4, 5, 7], [0, 4, 6, 7],
  ];
  const id = new Int32Array(8);
  const cv = new Float64Array(8);
  const ins = new Int32Array(4);
  const outs = new Int32Array(4);
  let x = 0, y = 0, z = 0;

  // Đỉnh trên cạnh nối góc p–q của ô hiện tại; cạnh dùng chung giữa các tứ diện chỉ tạo một đỉnh.
  const on = (p: number, q: number): number => {
    const i = id[p], j = id[q];
    const key = i < j ? i * total + j : j * total + i;
    const found = edgeVert.get(key);
    if (found !== undefined) return found;
    const t = cv[p] / (cv[p] - cv[q]);
    const v = verts.length / 3;
    const ax = x + (p & 1), ay = y + ((p >> 1) & 1), az = z + ((p >> 2) & 1);
    const bx = x + (q & 1), by = y + ((q >> 1) & 1), bz = z + ((q >> 2) & 1);
    verts.push(
      origin[0] + (ax + 0.5 + (bx - ax) * t) * h,
      origin[1] + (ay + 0.5 + (by - ay) * t) * h,
      origin[2] + (az + 0.5 + (bz - az) * t) * h,
    );
    edgeVert.set(key, v);
    return v;
  };
  // Hướng ra ngoài ≈ (dx, dy, dz): từ các góc bên trong sang các góc bên ngoài.
  const emit = (a: number, b: number, c: number, dx: number, dy: number, dz: number) => {
    const A = a * 3, B = b * 3, C = c * 3;
    const ux = verts[B] - verts[A], uy = verts[B + 1] - verts[A + 1], uz = verts[B + 2] - verts[A + 2];
    const wx = verts[C] - verts[A], wy = verts[C + 1] - verts[A + 1], wz = verts[C + 2] - verts[A + 2];
    const d = (uy * wz - uz * wy) * dx + (uz * wx - ux * wz) * dy + (ux * wy - uy * wx) * dz;
    if (d >= 0) tris.push(a, b, c);
    else tris.push(a, c, b);
  };

  for (z = 0; z < nz - 1; z++) {
    for (y = 0; y < ny - 1; y++) {
      for (x = 0; x < nx - 1; x++) {
        const base = (z * ny + y) * nx + x;
        let pos = 0;
        for (let c = 0; c < 8; c++) {
          const i = base + (c & 1 ? 1 : 0) + (c & 2 ? nx : 0) + (c & 4 ? sxy : 0);
          id[c] = i;
          const v = field[i] - iso;
          cv[c] = v === 0 ? 1e-7 : v; // không để đỉnh nằm đúng trên mặt – tránh mặt suy biến
          if (cv[c] > 0) pos++;
        }
        if (pos === 0 || pos === 8) continue;
        for (let t = 0; t < 6; t++) {
          const tet = TETS[t];
          let ni = 0, no = 0, ix = 0, iy = 0, iz = 0, ox = 0, oy = 0, oz = 0;
          for (let k = 0; k < 4; k++) {
            const c = tet[k];
            if (cv[c] > 0) {
              ins[ni++] = c;
              ix += c & 1;
              iy += (c >> 1) & 1;
              iz += (c >> 2) & 1;
            } else {
              outs[no++] = c;
              ox += c & 1;
              oy += (c >> 1) & 1;
              oz += (c >> 2) & 1;
            }
          }
          if (ni === 0 || ni === 4) continue;
          const dx = ox / no - ix / ni, dy = oy / no - iy / ni, dz = oz / no - iz / ni;
          if (ni === 1) {
            emit(on(ins[0], outs[0]), on(ins[0], outs[1]), on(ins[0], outs[2]), dx, dy, dz);
          } else if (ni === 3) {
            emit(on(outs[0], ins[0]), on(outs[0], ins[1]), on(outs[0], ins[2]), dx, dy, dz);
          } else {
            const p0 = on(ins[0], outs[0]), p1 = on(ins[0], outs[1]), p2 = on(ins[1], outs[1]), p3 = on(ins[1], outs[0]);
            emit(p0, p1, p2, dx, dy, dz);
            emit(p0, p2, p3, dx, dy, dz);
          }
        }
      }
    }
  }
  return { vert: new Float32Array(verts), tri: new Uint32Array(tris) };
}

/**
 * Bề mặt file gốc lệch bao xa so với khối đúc lại: lấy mẫu đều trên mọi tam giác gốc, tìm khoảng cách tới tam giác gần
 * nhất của khối mới. Trả về phân vị 95 và lớn nhất (đơn vị của file). Mặt thừa nằm kẹt trong ruột khối cũng bị tính,
 * nên "lớn nhất" thường cao hơn hẳn – phân vị 95 phản ánh đúng hơn phần nhìn thấy.
 */
export function surfaceDeviation(soup: Float32Array, m: Manifold, samples = 12_000): { p95: number; max: number } {
  const mesh = m.getMesh();
  const { vertProperties: v, triVerts: t, numProp } = mesh;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += numProp) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], v[i + k]);
      max[k] = Math.max(max[k], v[i + k]);
    }
  }
  const g = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 96 || 1;
  const cellOf = (p: number, k: number) => Math.floor((p - min[k]) / g);
  const buckets = new Map<number, number[]>();
  const keyOf = (a: number, b: number, c: number) => (a + 16) * 1_000_000 + (b + 16) * 1_000 + (c + 16);
  for (let f = 0; f < t.length / 3; f++) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 3; c++) {
      const o = t[f * 3 + c] * numProp;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], v[o + k]);
        hi[k] = Math.max(hi[k], v[o + k]);
      }
    }
    for (let a = cellOf(lo[0], 0); a <= cellOf(hi[0], 0); a++) {
      for (let b = cellOf(lo[1], 1); b <= cellOf(hi[1], 1); b++) {
        for (let c = cellOf(lo[2], 2); c <= cellOf(hi[2], 2); c++) {
          const key = keyOf(a, b, c);
          const list = buckets.get(key);
          if (list) list.push(f);
          else buckets.set(key, [f]);
        }
      }
    }
  }
  let totalArea = 0;
  const areas = new Float64Array(soup.length / 9);
  for (let i = 0; i < areas.length; i++) {
    const o = i * 9;
    const ux = soup[o + 3] - soup[o], uy = soup[o + 4] - soup[o + 1], uz = soup[o + 5] - soup[o + 2];
    const wx = soup[o + 6] - soup[o], wy = soup[o + 7] - soup[o + 1], wz = soup[o + 8] - soup[o + 2];
    areas[i] = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
    totalArea += areas[i];
  }
  const dists: number[] = [];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const RMAX = 6;
  for (let i = 0; i < areas.length; i++) {
    const count = Math.ceil((areas[i] / (totalArea || 1)) * samples);
    if (areas[i] === 0) continue;
    const o = i * 9;
    for (let n = 0; n < count; n++) {
      let a = rnd(), b = rnd();
      if (a + b > 1) (a = 1 - a), (b = 1 - b);
      const px = soup[o] + (soup[o + 3] - soup[o]) * a + (soup[o + 6] - soup[o]) * b;
      const py = soup[o + 1] + (soup[o + 4] - soup[o + 1]) * a + (soup[o + 7] - soup[o + 1]) * b;
      const pz = soup[o + 2] + (soup[o + 5] - soup[o + 2]) * a + (soup[o + 8] - soup[o + 2]) * b;
      const ca = cellOf(px, 0), cb = cellOf(py, 1), cc = cellOf(pz, 2);
      let best = Infinity;
      for (let r = 0; r <= RMAX; r++) {
        if (best <= (r - 1) * g) break; // ô xa hơn không thể gần hơn kết quả đã có
        for (let da = -r; da <= r; da++) {
          for (let db = -r; db <= r; db++) {
            for (let dc = -r; dc <= r; dc++) {
              if (Math.max(Math.abs(da), Math.abs(db), Math.abs(dc)) !== r) continue;
              const list = buckets.get(keyOf(ca + da, cb + db, cc + dc));
              if (!list) continue;
              for (const f of list) best = Math.min(best, pointTriangle(px, py, pz, v, t, f, numProp));
            }
          }
        }
      }
      dists.push(best === Infinity ? RMAX * g : best);
    }
  }
  dists.sort((x, y) => x - y);
  return { p95: dists[Math.floor(dists.length * 0.95)] ?? 0, max: dists[dists.length - 1] ?? 0 };
}

/** Khoảng cách từ điểm tới tam giác f (Ericson, Real-Time Collision Detection). */
function pointTriangle(px: number, py: number, pz: number, v: ArrayLike<number>, t: ArrayLike<number>, f: number, np: number): number {
  const A = t[f * 3] * np, B = t[f * 3 + 1] * np, C = t[f * 3 + 2] * np;
  const ax = v[A], ay = v[A + 1], az = v[A + 2];
  const abx = v[B] - ax, aby = v[B + 1] - ay, abz = v[B + 2] - az;
  const acx = v[C] - ax, acy = v[C + 1] - ay, acz = v[C + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const at = (s: number, w: number) => Math.hypot(px - (ax + abx * s + acx * w), py - (ay + aby * s + acy * w), pz - (az + abz * s + acz * w));
  if (d1 <= 0 && d2 <= 0) return at(0, 0);
  const bpx = px - v[B], bpy = py - v[B + 1], bpz = pz - v[B + 2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return at(1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(d1 / (d1 - d3), 0);
  const cpx = px - v[C], cpy = py - v[C + 1], cpz = pz - v[C + 2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return at(0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return at(1 - w, w);
  }
  const denom = 1 / (va + vb + vc);
  return at(vb * denom, vc * denom);
}
