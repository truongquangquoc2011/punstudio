import type { Manifold, ManifoldToplevel } from 'manifold-3d';

/**
 * Biến "triangle soup" từ STL thành khối đặc kín (manifold).
 *
 * File sạch: chỉ gộp đỉnh trùng là xong. File lỗi: thử lần lượt các bước vá nhẹ – bỏ tam giác suy biến/trùng,
 * lật lại mặt bị ngược, bịt lỗ hở – không bao giờ làm mịn hay dựng lại bề mặt (giữ nguyên thiết kế).
 * Vá không được thì báo lỗi, không trả về khối sai.
 */

export class MeshError extends Error {}

export interface Indexed {
  vert: Float32Array;
  tri: Uint32Array;
}

export interface Solid {
  manifold: Manifold;
  repairs: string[];
}

/** Gộp đỉnh trùng theo lưới dung sai tương đối với kích thước vật. */
export function weld(soup: Float32Array, relTol = 1e-6): Indexed {
  let span = 0;
  for (let i = 0; i < soup.length; i++) span = Math.max(span, Math.abs(soup[i]));
  const tol = Math.max(span, 1e-9) * relTol;
  const map = new Map<string, number>();
  const verts: number[] = [];
  const tri = new Uint32Array(soup.length / 3);
  for (let i = 0; i < soup.length / 3; i++) {
    const x = soup[i * 3], y = soup[i * 3 + 1], z = soup[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new MeshError('File có tọa độ không hợp lệ (NaN/vô cực).');
    const key = `${Math.round(x / tol)},${Math.round(y / tol)},${Math.round(z / tol)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      map.set(key, id);
      verts.push(x, y, z);
    }
    tri[i] = id;
  }
  return { vert: new Float32Array(verts), tri };
}

/** Đếm các loại lỗi của lưới (sau khi gộp đỉnh). */
export interface Diagnosis {
  triangles: number;
  edges: number;
  openEdges: number; // cạnh chỉ thuộc 1 mặt: lưới có lỗ thủng
  multiEdges: number; // cạnh dính từ 3 mặt trở lên: mảnh lưới đè lên nhau
  flippedEdges: number; // cạnh hai mặt kề đi cùng chiều: có mặt bị lật ngược
  degenerate: number; // tam giác suy biến
}

export function diagnose(mesh: Indexed): Diagnosis {
  const { tri } = mesh;
  const directed = new Map<string, number>();
  let degenerate = 0;
  for (let f = 0; f < tri.length / 3; f++) {
    const a = tri[f * 3], b = tri[f * 3 + 1], c = tri[f * 3 + 2];
    if (a === b || b === c || a === c) {
      degenerate++;
      continue;
    }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) directed.set(`${u}_${v}`, (directed.get(`${u}_${v}`) ?? 0) + 1);
  }
  const seen = new Set<string>();
  let edges = 0, openEdges = 0, multiEdges = 0, flippedEdges = 0;
  for (const [key, n] of directed) {
    const [u, v] = key.split('_').map(Number);
    const k = u < v ? `${u}_${v}` : `${v}_${u}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const back = directed.get(`${v}_${u}`) ?? 0;
    const total = n + back;
    edges++;
    if (total === 1) openEdges++;
    else if (total > 2) multiEdges++;
    else if (back === 0 || n === 0) flippedEdges++;
  }
  return { triangles: tri.length / 3, edges, openEdges, multiEdges, flippedEdges, degenerate };
}

export function tryManifold(wasm: ManifoldToplevel, mesh: Indexed): Manifold | null {
  const m = new wasm.Mesh({ numProp: 3, vertProperties: mesh.vert, triVerts: mesh.tri });
  try {
    const solid = wasm.Manifold.ofMesh(m);
    if (solid.status() !== 'NoError' || solid.isEmpty()) {
      solid.delete();
      return null;
    }
    return solid;
  } catch {
    return null;
  }
}

export function toSolid(wasm: ManifoldToplevel, soup: Float32Array): Solid {
  const mesh = weld(soup);
  const direct = tryManifold(wasm, mesh);
  if (direct) return { manifold: direct, repairs: [] };

  const repairs: string[] = [];
  let tri = dropBadFaces(mesh.tri, repairs);
  tri = orient(mesh.vert, tri, repairs);
  let vert = mesh.vert;
  ({ vert, tri } = fillHoles(vert, tri, repairs));
  const fixed = tryManifold(wasm, { vert, tri });
  if (fixed) return { manifold: fixed, repairs };
  throw new MeshError(
    `Lưới của file bị hỏng nặng (${describe(tri)}) – không vá tự động được mà không làm sai hình. ` +
      'Hãy sửa file bằng phần mềm dựng hình (ví dụ Blender: 3D Print Toolbox → Make Manifold) rồi thử lại.',
  );
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function describe(tri: Uint32Array): string {
  const count = new Map<string, number>();
  for (let f = 0; f < tri.length / 3; f++) {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(tri[f * 3 + k], tri[f * 3 + ((k + 1) % 3)]);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  let open = 0, multi = 0;
  for (const c of count.values()) {
    if (c === 1) open++;
    else if (c > 2) multi++;
  }
  return `${open} cạnh hở, ${multi} cạnh dính quá 2 mặt`;
}

/** Bỏ tam giác suy biến và tam giác trùng nhau (mặt kép bên trong). */
function dropBadFaces(tri: Uint32Array, repairs: string[]): Uint32Array {
  const seen = new Map<string, number>();
  const keep: number[] = [];
  let degenerate = 0;
  for (let f = 0; f < tri.length / 3; f++) {
    const a = tri[f * 3], b = tri[f * 3 + 1], c = tri[f * 3 + 2];
    if (a === b || b === c || a === c) {
      degenerate++;
      continue;
    }
    const key = [a, b, c].sort((x, y) => x - y).join('_');
    seen.set(key, (seen.get(key) ?? 0) + 1);
    keep.push(f);
  }
  const out: number[] = [];
  let dup = 0;
  for (const f of keep) {
    const key = [tri[f * 3], tri[f * 3 + 1], tri[f * 3 + 2]].sort((x, y) => x - y).join('_');
    if ((seen.get(key) ?? 0) > 1) {
      dup++;
      continue;
    }
    out.push(tri[f * 3], tri[f * 3 + 1], tri[f * 3 + 2]);
  }
  if (degenerate) repairs.push(`Bỏ ${degenerate} tam giác suy biến`);
  if (dup) repairs.push(`Bỏ ${dup} tam giác trùng nhau`);
  return new Uint32Array(out);
}

/** Lật các mặt bị ngược cho thống nhất trong từng mảnh, rồi quay mảnh ra ngoài (thể tích dương). */
function orient(vert: Float32Array, tri: Uint32Array, repairs: string[]): Uint32Array {
  const n = tri.length / 3;
  const faces = new Map<string, number[]>();
  for (let f = 0; f < n; f++) {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(tri[f * 3 + k], tri[f * 3 + ((k + 1) % 3)]);
      const list = faces.get(key);
      if (list) list.push(f);
      else faces.set(key, [f]);
    }
  }
  const out = tri.slice();
  const visited = new Uint8Array(n);
  let flipped = 0;
  const hasDirected = (f: number, a: number, b: number) => {
    for (let k = 0; k < 3; k++) if (out[f * 3 + k] === a && out[f * 3 + ((k + 1) % 3)] === b) return true;
    return false;
  };
  const flip = (f: number) => {
    const t = out[f * 3 + 1];
    out[f * 3 + 1] = out[f * 3 + 2];
    out[f * 3 + 2] = t;
  };
  for (let start = 0; start < n; start++) {
    if (visited[start]) continue;
    const component: number[] = [];
    const queue = [start];
    visited[start] = 1;
    while (queue.length) {
      const f = queue.pop()!;
      component.push(f);
      for (let k = 0; k < 3; k++) {
        const a = out[f * 3 + k], b = out[f * 3 + ((k + 1) % 3)];
        const list = faces.get(edgeKey(a, b))!;
        if (list.length !== 2) continue; // chỉ lan qua cạnh đúng 2 mặt
        const g = list[0] === f ? list[1] : list[0];
        if (visited[g]) continue;
        visited[g] = 1;
        if (hasDirected(g, a, b)) {
          flip(g);
          flipped++;
        }
        queue.push(g);
      }
    }
    // Thể tích có dấu của mảnh âm → mảnh đang quay vào trong.
    let vol = 0;
    for (const f of component) {
      const [a, b, c] = [0, 1, 2].map((k) => out[f * 3 + k] * 3);
      vol +=
        vert[a] * (vert[b + 1] * vert[c + 2] - vert[b + 2] * vert[c + 1]) -
        vert[a + 1] * (vert[b] * vert[c + 2] - vert[b + 2] * vert[c]) +
        vert[a + 2] * (vert[b] * vert[c + 1] - vert[b + 1] * vert[c]);
    }
    if (vol < 0) {
      for (const f of component) flip(f);
      flipped += component.length;
    }
  }
  if (flipped) repairs.push(`Lật lại ${flipped} mặt bị ngược`);
  return out;
}

/** Bịt lỗ hở: nối các cạnh biên thành vòng, mỗi vòng đậy bằng một quạt tam giác quanh trọng tâm của vòng. */
function fillHoles(vert: Float32Array, tri: Uint32Array, repairs: string[]): Indexed {
  const directed = new Map<string, number>();
  for (let f = 0; f < tri.length / 3; f++) {
    for (let k = 0; k < 3; k++) {
      const a = tri[f * 3 + k], b = tri[f * 3 + ((k + 1) % 3)];
      directed.set(`${a}_${b}`, (directed.get(`${a}_${b}`) ?? 0) + 1);
    }
  }
  // Cạnh biên a→b: không có mặt nào đi b→a. Vòng bịt đi theo chiều ngược lại (b→a).
  const next = new Map<number, number[]>();
  for (const key of directed.keys()) {
    const [a, b] = key.split('_').map(Number);
    if (!directed.has(`${b}_${a}`)) {
      const list = next.get(b);
      if (list) list.push(a);
      else next.set(b, [a]);
    }
  }
  if (next.size === 0) return { vert, tri };
  const verts = Array.from(vert);
  const tris = Array.from(tri);
  let loops = 0;
  for (const startNode of [...next.keys()]) {
    while ((next.get(startNode)?.length ?? 0) > 0) {
      const loop = [startNode];
      let cur = next.get(startNode)!.pop()!;
      let guard = 0;
      while (cur !== startNode && guard++ < 100000) {
        loop.push(cur);
        const list = next.get(cur);
        if (!list || list.length === 0) break;
        cur = list.pop()!;
      }
      if (cur !== startNode || loop.length < 3) continue;
      const c = [0, 0, 0];
      for (const v of loop) for (let k = 0; k < 3; k++) c[k] += vert[v * 3 + k] / loop.length;
      const ci = verts.length / 3;
      verts.push(c[0], c[1], c[2]);
      for (let i = 0; i < loop.length; i++) tris.push(loop[i], loop[(i + 1) % loop.length], ci);
      loops++;
    }
  }
  if (loops) repairs.push(`Bịt ${loops} lỗ hở trên lưới`);
  return { vert: new Float32Array(verts), tri: new Uint32Array(tris) };
}
