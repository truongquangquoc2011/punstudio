import Module, { type Manifold, type ManifoldToplevel } from 'manifold-3d';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { insideRegion } from '../src/core/geometry';
import { loadWheel } from '../src/core/load';
import { diagnose, weld } from '../src/core/repair';
import { parseStl, writeStl } from '../src/core/stl';
import { DEFAULT_SPEC, processWheel } from '../src/core/wheel';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const FAST = { mode: 'auto' as const, resolution: 150 };

/** Phần đặc của mâm giả: gờ vành hai đầu + nan + moay-ơ. Thân vành để riêng. */
function wheelParts(R: number, W: number): Manifold {
  const { Manifold } = wasm;
  const seg = 96;
  const tube = (h: number, ro: number, ri: number) =>
    Manifold.cylinder(h, ro, ro, seg).subtract(Manifold.cylinder(h + 2, ri, ri, seg).translate([0, 0, -1]));
  const parts: Manifold[] = [tube(0.6, R, R - 1.4), tube(0.6, R, R - 1.4).translate([0, 0, W - 0.6])];
  for (let i = 0; i < 5; i++) parts.push(Manifold.cube([R - 2.5, 1.6, 1.2]).translate([2, -0.8, W - 2.5]).rotate([0, 0, i * 72]));
  parts.push(Manifold.cylinder(2, 2.5, 2.5, seg).translate([0, 0, W - 2.8]));
  return Manifold.union(parts);
}

function soupOf(m: Manifold): number[] {
  const mesh = m.getMesh();
  return Array.from(parseStl(writeStl(mesh.vertProperties, mesh.triVerts, mesh.numProp)));
}

/** Thân vành là một lớp mặt không có độ dày, giống file mâm lỗi thật. */
function sheetBarrel(R: number, W: number, n = 96): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n, b = (2 * Math.PI * (i + 1)) / n;
    const p = [R * Math.cos(a), R * Math.sin(a)], q = [R * Math.cos(b), R * Math.sin(b)];
    out.push(p[0], p[1], 0, q[0], q[1], 0, q[0], q[1], W);
    out.push(p[0], p[1], 0, q[0], q[1], W, p[0], p[1], W);
  }
  return out;
}

/** Mâm hỏng nặng: thân vành không dày, thêm thủng lỗ và lật mặt rải rác trên phần còn lại. */
function brokenWheel(): Float32Array {
  const R = 10, W = 9;
  const soup = soupOf(wheelParts(R, W));
  const out: number[] = [];
  for (let t = 0; t < soup.length; t += 9) {
    const i = t / 9;
    if (i % 23 === 0) continue; // thủng
    const tri = soup.slice(t, t + 9);
    if (i % 17 === 0) out.push(...tri.slice(0, 3), ...tri.slice(6, 9), ...tri.slice(3, 6)); // lật mặt
    else out.push(...tri);
  }
  out.push(...sheetBarrel(R - 0.3, W));
  return new Float32Array(out);
}

describe('chẩn đoán lưới', () => {
  it('đếm đúng cạnh hở và mặt lật', () => {
    const soup = soupOf(wasm.Manifold.cube([2, 2, 2]));
    const clean = diagnose(weld(new Float32Array(soup)));
    expect(clean.openEdges + clean.multiEdges + clean.flippedEdges).toBe(0);
    const holed = diagnose(weld(new Float32Array(soup.slice(9)))); // bỏ 1 tam giác → 3 cạnh hở
    expect(holed.openEdges).toBe(3);
    const f = soup.slice();
    [f[3], f[4], f[5], f[6], f[7], f[8]] = [f[6], f[7], f[8], f[3], f[4], f[5]];
    expect(diagnose(weld(new Float32Array(f))).flippedEdges).toBe(3);
  });
});

describe('chọn cách sửa', () => {
  it('lưới kín: dùng nguyên, không đụng bề mặt', () => {
    const src = wheelParts(10, 9);
    const { manifold, info } = loadWheel(wasm, new Float32Array(soupOf(src)), FAST);
    expect(info.method).toBe('none');
    expect(manifold.numTri()).toBe(src.numTri());
  });

  it('lỗi rất ít: vá nhẹ, không đúc lại', () => {
    const soup = soupOf(wasm.Manifold.sphere(5, 128));
    const { info } = loadWheel(wasm, new Float32Array(soup.slice(9)), FAST);
    expect(info.method).toBe('patch');
  });

  it('lỗi nặng: đúc lại, ép đúc lại được cả với lưới kín', () => {
    expect(loadWheel(wasm, brokenWheel(), FAST).info.method).toBe('rebuild');
    const forced = loadWheel(wasm, new Float32Array(soupOf(wheelParts(10, 9))), { mode: 'rebuild', resolution: 150 });
    expect(forced.info.method).toBe('rebuild');
    expect(forced.info.rebuild!.p95).toBeLessThan(forced.info.rebuild!.cell * 3);
  });
});

describe('xử lý mâm hỏng nặng', () => {
  it('giữ được thân vành không dày, ra một khối đúng thông số', () => {
    const { manifold, report } = processWheel(wasm, brokenWheel(), DEFAULT_SPEC, { repair: FAST });
    for (const c of report.checks) expect(c.ok, `${c.label}: ${c.actual}`).toBe(true);
    expect(report.source.repair.method).toBe('rebuild');
    expect(report.warnings.some((w) => w.includes('đúc lại'))).toBe(true);
    // Thân vành còn nguyên quanh cả vòng, kể cả đoạn phía trên vòng đắp: đây là thứ bộ vá cũ làm mất.
    const polys = manifold.slice(report.wallTop + (5 - report.wallTop) * 0.4).toPolygons() as [number, number][][];
    let hit = 0;
    for (let i = 0; i < 90; i++) {
      const a = (2 * Math.PI * i) / 90;
      let found = false;
      for (let r = 3.8; r <= 4.3 && !found; r += 0.02) found = insideRegion(polys, r * Math.cos(a), r * Math.sin(a));
      if (found) hit++;
    }
    expect(hit).toBe(90);
  });

  it('thân vành mâm đúc lại được làm tròn đều quanh vòng', () => {
    const { manifold, report } = processWheel(wasm, brokenWheel(), DEFAULT_SPEC, { repair: FAST });
    expect(report.steps.some((s) => s.startsWith('Làm tròn lại thân vành'))).toBe(true);
    const polys = manifold.slice(report.wallTop * 0.5).toPolygons() as [number, number][][];
    const outer = polys.map((p) => p.map(([x, y]) => Math.hypot(x, y))).sort((a, b) => Math.max(...b) - Math.max(...a))[0];
    // Độ méo quanh vòng không quá 1,5 ô lưới (ở độ mịn "Nhanh" một ô ≈ 0,056 mm sau chuẩn hóa).
    expect(Math.max(...outer) - Math.min(...outer)).toBeLessThan(0.056 * 1.5);
  });

  it('mặt ngoài là trụ thẳng đúng đường kính dù mâm gốc có đoạn lõm', () => {
    const { manifold, report } = processWheel(wasm, brokenWheel(), DEFAULT_SPEC, { repair: FAST });
    expect(report.steps.some((s) => s.startsWith('Đắp đầy mặt ngoài'))).toBe(true);
    for (const z of [0.3, 1.5, 2.5, 3.5, 4.7]) {
      const polys = manifold.slice(z).toPolygons() as [number, number][][];
      const radii = polys.map((p) => p.map(([x, y]) => Math.hypot(x, y))).sort((a, b) => Math.max(...b) - Math.max(...a))[0];
      expect(Math.max(...radii)).toBeCloseTo(4.25, 2);
      expect(Math.min(...radii)).toBeGreaterThan(4.24);
    }
  });

  it('dùng lại được kết quả đã sửa, không làm hỏng khi chạy nhiều lần', () => {
    const loaded = loadWheel(wasm, brokenWheel(), FAST);
    const a = processWheel(wasm, new Float32Array(0), DEFAULT_SPEC, { preloaded: loaded });
    const b = processWheel(wasm, new Float32Array(0), { ...DEFAULT_SPEC, diameter: 10 }, { preloaded: loaded });
    expect(a.report.result.diameter).toBeCloseTo(8.5, 2);
    expect(b.report.result.diameter).toBeCloseTo(10, 2);
    expect(loaded.manifold.status()).toBe('NoError');
  });

  const sample = 'C:/Users/Admin/Downloads/mamanhvu.stl';
  it.skipIf(!existsSync(sample))('mâm lỗi thật mamanhvu.stl: đủ thân vành, đạt thông số', () => {
    const buf = readFileSync(sample);
    const { report } = processWheel(wasm, parseStl(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
    for (const c of report.checks) expect(c.ok, `${c.label}: ${c.actual}`).toBe(true);
    expect(report.source.repair.method).toBe('rebuild');
  });
});
