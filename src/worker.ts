/// <reference lib="webworker" />
import Module, { type Manifold, type ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { rasterize, type Poly } from './core/geometry';
import { parseStl, writeStl } from './core/stl';
import { loadWheel, type LoadedWheel, type RepairOptions } from './core/load';
import { processWheel, type WheelSpec } from './core/wheel';
import type { ViewMesh, WorkerRequest, WorkerResponse } from './lib/protocol';

let wasm: Promise<ManifoldToplevel> | null = null;
function load() {
  wasm ??= Module({ locateFile: () => wasmUrl }).then((m) => (m.setup(), m));
  return wasm;
}

/**
 * Lưới dạng "soup" cho three.js (chỉ để hiển thị); cờ added = 1 với tam giác không có trong file gốc.
 * `baseRegion`: mặt cắt của mâm gốc ngay trên z = 0. Ở mặt phẳng z = 0 phần gốc và phần đắp trùng nhau và bị gộp
 * thành các tam giác dài, nên ở đó tô theo vị trí (trong vùng gốc → màu gốc) thay vì theo nguồn gốc tam giác.
 */
function toView(m: Manifold, sourceId: number | null, baseRegion: Poly[] = []): ViewMesh {
  const mesh = m.getMesh();
  const { vertProperties: v, triVerts: t, numProp } = mesh;
  const n = t.length / 3;
  const addedRun = new Uint8Array(n);
  if (sourceId !== null && mesh.runIndex && mesh.runOriginalID) {
    for (let r = 0; r < mesh.runOriginalID.length; r++) {
      if (mesh.runOriginalID[r] !== sourceId) addedRun.fill(1, mesh.runIndex[r] / 3, mesh.runIndex[r + 1] / 3);
    }
  }
  const pos: number[] = [];
  const flags: number[] = [];
  const corner = (f: number, k: number): [number, number, number] => {
    const o = t[f * 3 + k] * numProp;
    return [v[o], v[o + 1], v[o + 2]];
  };
  const inside = rasterize(baseRegion, 0.005);
  const inBase = (p: [number, number, number]) => inside(p[0], p[1]);
  const mid = (p: number[], q: number[]): [number, number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  // Chia 4 tam giác trên mặt z = 0 tới khi cả 3 đỉnh cùng phía biên vùng gốc (tối đa 6 lần) rồi tô theo tâm.
  const split = (a: [number, number, number], b: [number, number, number], c: [number, number, number], depth: number) => {
    const ia = inBase(a), ib = inBase(b), ic = inBase(c);
    const edge = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
    if (depth >= 6 || edge < 0.03 || (ia === ib && ib === ic && (edge < 0.4 || depth >= 2))) {
      const g: [number, number, number] = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, 0];
      pos.push(...a, ...b, ...c);
      flags.push(inBase(g) ? 0 : 1);
      return;
    }
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    split(a, ab, ca, depth + 1);
    split(ab, b, bc, depth + 1);
    split(ca, bc, c, depth + 1);
    split(ab, bc, ca, depth + 1);
  };
  for (let f = 0; f < n; f++) {
    const a = corner(f, 0), b = corner(f, 1), c = corner(f, 2);
    const onBase = baseRegion.length > 0 && Math.max(Math.abs(a[2]), Math.abs(b[2]), Math.abs(c[2])) < 1e-4;
    if (onBase) {
      split(a, b, c, 0);
    } else {
      pos.push(...a, ...b, ...c);
      flags.push(addedRun[f]);
    }
  }
  return { positions: new Float32Array(pos), added: new Uint8Array(flags) };
}

/** Mâm đã đọc/sửa của file đang mở – đúc lại mất vài chục giây, đổi thông số thì không cần làm lại. */
let cached: { key: string; loaded: LoadedWheel } | null = null;

async function run(id: number, buffer: ArrayBuffer, spec: WheelSpec, flip: boolean, repair: RepairOptions, fileId: number) {
  const lib = await load();
  const soup = parseStl(buffer);
  const t0 = performance.now();
  const onStage = (stage: string) => {
    const msg: WorkerResponse = { type: 'progress', id, stage };
    postMessage(msg);
  };
  const key = `${fileId}:${repair.mode}:${repair.resolution}`;
  if (cached?.key !== key) {
    cached?.loaded.manifold.delete();
    cached = null;
    cached = { key, loaded: loadWheel(lib, soup, repair, onStage) };
  }
  onStage('wheel');
  const { manifold, prepared, sourceId, report } = processWheel(lib, soup, spec, { flip, preloaded: cached.loaded });
  try {
    const base = prepared.slice(1e-3);
    const baseRegion = base.toPolygons() as Poly[];
    base.delete();
    const result = toView(manifold, sourceId, baseRegion);
    const source = toView(prepared, null);
    const out = manifold.getMesh();
    const stl = writeStl(out.vertProperties, out.triVerts, out.numProp, 'wheel-tool');
    const msg: WorkerResponse = { type: 'result', id, report, result, source, stl, ms: performance.now() - t0 };
    postMessage(msg, [result.positions.buffer, result.added.buffer, source.positions.buffer, source.added.buffer, stl]);
  } finally {
    manifold.delete();
    prepared.delete();
  }
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, buffer, spec, flip, repair, fileId } = e.data;
  run(id, buffer, spec, flip, repair, fileId).catch((err: unknown) => {
    const msg: WorkerResponse = { type: 'error', id, message: err instanceof Error ? err.message : String(err) };
    postMessage(msg);
  });
};
