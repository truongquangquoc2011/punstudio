/** Toán hình học nhỏ dùng cho mâm: ma trận, trị riêng 3×3, khớp đường tròn, đa giác. */

export type V3 = [number, number, number];
export type M3 = [V3, V3, V3]; // hàng

export function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalize(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Trị riêng/vectơ riêng của ma trận đối xứng 3×3 (Jacobi). Vectơ riêng trả theo cột tương ứng. */
export function eigenSymmetric(a: M3): { values: V3; vectors: V3[] } {
  const m = a.map((r) => [...r]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += m[p][q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(m[p][q]) < 1e-30) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const mkp = m[k][p], mkq = m[k][q];
          m[k][p] = c * mkp - s * mkq;
          m[k][q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < 3; k++) {
          const mpk = m[p][k], mqk = m[q][k];
          m[p][k] = c * mpk - s * mqk;
          m[q][k] = s * mpk + c * mqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return {
    values: [m[0][0], m[1][1], m[2][2]],
    vectors: [0, 1, 2].map((j) => [v[0][j], v[1][j], v[2][j]] as V3),
  };
}

/** Ma trận quay đưa vectơ đơn vị ``from`` về trục +Z. */
export function rotationToZ(from: V3): M3 {
  const z: V3 = [0, 0, 1];
  const f = normalize(from);
  const c = dot(f, z);
  if (c > 1 - 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (c < -1 + 1e-12) return [[1, 0, 0], [0, -1, 0], [0, 0, -1]];
  const axis = normalize(cross(f, z));
  const s = Math.sqrt(1 - c * c);
  const [x, y, w] = axis;
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * w, t * x * w + s * y],
    [t * x * y + s * w, t * y * y + c, t * y * w - s * x],
    [t * x * w - s * y, t * y * w + s * x, t * w * w + c],
  ];
}

/** Ma trận 4×4 cột-trước (định dạng Manifold) từ phép quay hàng R và tịnh tiến t: p' = R·p + t. */
export function mat4(r: M3, t: V3 = [0, 0, 0]) {
  return [
    r[0][0], r[1][0], r[2][0], 0,
    r[0][1], r[1][1], r[2][1], 0,
    r[0][2], r[1][2], r[2][2], 0,
    t[0], t[1], t[2], 1,
  ] as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
}

/** Khớp đường tròn bình phương tối thiểu (Kåsa). Trả về tâm và bán kính. */
export function fitCircle(xs: number[], ys: number[]): { cx: number; cy: number; r: number } {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0;
  const n = xs.length;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i], z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sz += z; sxz += x * z; syz += y * z;
  }
  // [sxx sxy sx; sxy syy sy; sx sy n] · [D E F] = -[sxz syz sz]
  const A = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const b = [-sxz, -syz, -sz];
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det3(A);
  if (Math.abs(d) < 1e-18) return { cx: 0, cy: 0, r: 0 };
  const col = (j: number) => A.map((row, i) => row.map((v, k) => (k === j ? b[i] : v)));
  const D = det3(col(0)) / d, E = det3(col(1)) / d, F = det3(col(2)) / d;
  const cx = -D / 2, cy = -E / 2;
  return { cx, cy, r: Math.sqrt(Math.max(0, cx * cx + cy * cy - F)) };
}

export type Poly = [number, number][];

export function polygonArea(p: Poly): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Khoảng cách nhỏ nhất từ gốc tọa độ tới các cạnh của đa giác. */
export function minEdgeDistance(p: Poly): number {
  let best = Infinity;
  for (let i = 0; i < p.length; i++) {
    const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export function maxVertexRadius(p: Poly): number {
  let best = 0;
  for (const [x, y] of p) best = Math.max(best, Math.hypot(x, y));
  return best;
}

/** Điểm nằm trong vùng (quy tắc chẵn-lẻ trên toàn bộ đường bao, gồm cả lỗ). */
export function insideRegion(polys: Poly[], x: number, y: number): boolean {
  let inside = false;
  for (const p of polys) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i], [xj, yj] = p[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Ảnh nhị phân của vùng (chẵn-lẻ) trên lưới đều – kiểm tra điểm trong vùng O(1) thay vì duyệt mọi cạnh. */
export function rasterize(polys: Poly[], cell: number): (x: number, y: number) => boolean {
  if (!polys.length) return () => false;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const w = Math.max(1, Math.ceil((x1 - x0) / cell)), h = Math.max(1, Math.ceil((y1 - y0) / cell));
  const bits = new Uint8Array(w * h);
  const xs: number[] = [];
  for (let row = 0; row < h; row++) {
    const y = y0 + (row + 0.5) * cell;
    xs.length = 0;
    for (const p of polys) {
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i], [xj, yj] = p[j];
        if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5));
      const c1 = Math.min(w - 1, Math.floor((xs[k + 1] - x0) / cell - 0.5));
      bits.fill(1, row * w + c0, row * w + c1 + 1);
    }
  }
  return (x, y) => {
    const c = Math.floor((x - x0) / cell), r = Math.floor((y - y0) / cell);
    return c >= 0 && r >= 0 && c < w && r < h && bits[r * w + c] === 1;
  };
}

/**
 * Bộ kiểm điểm-trong-vùng có chỉ mục: chia cạnh theo dải y, mỗi lần kiểm chỉ duyệt cạnh của dải chứa điểm.
 * Cùng kết quả với insideRegion nhưng nhanh hơn hàng chục lần trên lát cắt nhiều cạnh.
 */
export function regionTester(polys: Poly[], buckets = 128): (x: number, y: number) => boolean {
  const edges: number[] = []; // x1, y1, x2, y2
  let y0 = Infinity, y1 = -Infinity;
  for (const p of polys) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      edges.push(p[j][0], p[j][1], p[i][0], p[i][1]);
      y0 = Math.min(y0, p[i][1]);
      y1 = Math.max(y1, p[i][1]);
    }
  }
  if (!edges.length) return () => false;
  const h = (y1 - y0) / buckets || 1;
  const index: number[][] = Array.from({ length: buckets }, () => []);
  for (let e = 0; e < edges.length; e += 4) {
    const lo = Math.min(edges[e + 1], edges[e + 3]), hi = Math.max(edges[e + 1], edges[e + 3]);
    const b0 = Math.max(0, Math.floor((lo - y0) / h)), b1 = Math.min(buckets - 1, Math.floor((hi - y0) / h));
    for (let b = b0; b <= b1; b++) index[b].push(e);
  }
  return (x, y) => {
    if (y < y0 || y > y1) return false;
    const list = index[Math.min(buckets - 1, Math.floor((y - y0) / h))];
    let inside = false;
    for (const e of list) {
      const xj = edges[e], yj = edges[e + 1], xi = edges[e + 2], yi = edges[e + 3];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

/**
 * Pháp tuyến cho lưới "soup" (9 số/tam giác): trung bình các mặt quanh đỉnh nếu lệch nhau dưới `creaseDeg`, nên mặt
 * cong hiện mượt mà cạnh sắc vẫn giữ. Chỉ ảnh hưởng hình hiển thị.
 */
export function creasedNormals(pos: Float32Array, creaseDeg = 35): Float32Array {
  const faces = pos.length / 9;
  const fn = new Float32Array(faces * 3); // pháp tuyến có độ dài = 2 × diện tích (mặt lớn nặng hơn)
  const unit = new Float32Array(faces * 3);
  const at = new Map<string, number[]>();
  for (let f = 0; f < faces; f++) {
    const o = f * 9;
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
    const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    fn.set([nx, ny, nz], f * 3);
    unit.set([nx / len, ny / len, nz / len], f * 3);
    for (let k = 0; k < 3; k++) {
      const key = `${pos[o + k * 3]},${pos[o + k * 3 + 1]},${pos[o + k * 3 + 2]}`;
      const list = at.get(key);
      if (list) list.push(f);
      else at.set(key, [f]);
    }
  }
  const cos = Math.cos((creaseDeg * Math.PI) / 180);
  const out = new Float32Array(pos.length);
  for (let f = 0; f < faces; f++) {
    const o = f * 9;
    const ax = unit[f * 3], ay = unit[f * 3 + 1], az = unit[f * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const list = at.get(`${pos[o + k * 3]},${pos[o + k * 3 + 1]},${pos[o + k * 3 + 2]}`)!;
      let x = 0, y = 0, z = 0;
      for (const g of list) {
        if (unit[g * 3] * ax + unit[g * 3 + 1] * ay + unit[g * 3 + 2] * az < cos) continue;
        x += fn[g * 3];
        y += fn[g * 3 + 1];
        z += fn[g * 3 + 2];
      }
      const len = Math.hypot(x, y, z) || 1;
      out[o + k * 3] = x / len;
      out[o + k * 3 + 1] = y / len;
      out[o + k * 3 + 2] = z / len;
    }
  }
  return out;
}
