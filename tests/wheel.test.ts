import Module, { type Manifold, type ManifoldToplevel } from 'manifold-3d';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { insideRegion } from '../src/core/geometry';
import { parseStl, writeStl } from '../src/core/stl';
import { toSolid } from '../src/core/repair';
import { DEFAULT_SPEC, processWheel } from '../src/core/wheel';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

/** Mâm giả: mặt trong ở z = 0, mặt nan + gờ vành ở phía z lớn. Kích thước tùy ý (không phải 8,5 × 5). */
function syntheticWheel(opts: { R?: number; W?: number; wall?: number; oldBoss?: number; oldHole?: number } = {}): Manifold {
  const { Manifold } = wasm;
  const R = opts.R ?? 10, W = opts.W ?? 9, wall = opts.wall ?? 0.6;
  const seg = 96;
  const tube = (h: number, ro: number, ri: number) =>
    Manifold.cylinder(h, ro, ro, seg).subtract(Manifold.cylinder(h + 2, ri, ri, seg).translate([0, 0, -1]));
  const barrel = tube(W, R, R - wall);
  const lip = tube(0.6, R, R - 1.4).translate([0, 0, W - 0.6]);
  const parts: Manifold[] = [barrel, lip];
  for (let i = 0; i < 5; i++) {
    // Nan dừng giữa thân vành – không thò ra ngoài làm lệch tâm.
    parts.push(Manifold.cube([R - wall / 2 - 2, 1.6, 1.2]).translate([2, -0.8, W - 2.5]).rotate([0, 0, i * 72]));
  }
  parts.push(Manifold.cylinder(1.6, 2.5, 2.5, seg).translate([0, 0, W - 2.6]));
  let m = Manifold.union(parts);
  const oldBoss = opts.oldBoss ?? 1.8;
  m = m.add(Manifold.cylinder(W - 2.5, oldBoss, oldBoss, seg));
  const oldHole = opts.oldHole ?? 0.6;
  return m.subtract(Manifold.cylinder(W + 2, oldHole, oldHole, seg).translate([0, 0, -1]));
}

function processWheelInput(soup: Float32Array): Manifold {
  return toSolid(wasm, soup).manifold;
}

function soupOf(m: Manifold): Float32Array {
  const mesh = m.getMesh();
  const buf = writeStl(mesh.vertProperties, mesh.triVerts, mesh.numProp);
  return parseStl(buf);
}

/** Thể tích phần mặt ngoài (z > z0), trừ cột lỗ trục – để so mặt nan trước/sau. */
function faceVolume(m: Manifold, z0: number, holeR: number): number {
  const slab = m.trimByPlane([0, 0, 1], z0);
  const cut = slab.subtract(wasm.Manifold.cylinder(20, holeR + 0.05, holeR + 0.05, 96).translate([0, 0, -5]));
  return cut.volume();
}

describe('processWheel', () => {
  it('đưa mâm giả tỉ lệ khác về đúng 5 thông số và giữ nguyên mặt ngoài', () => {
    const src = syntheticWheel();
    const { manifold, report } = processWheel(wasm, soupOf(src), DEFAULT_SPEC);
    for (const c of report.checks) expect(c.ok, `${c.label}: ${c.actual}`).toBe(true);
    expect(report.autoFlipped).toBe(false);
    expect(report.steps.some((s) => s.startsWith('Đắp viền vành'))).toBe(true);

    // Mặt ngoài: so với mâm gốc chỉ co giãn, phần phía trước mặt nan phải giống hệt (trừ lỗ trục).
    const expected = src.scale([8.5 / 20, 8.5 / 20, 5 / 9]);
    const z0 = Math.max(report.wallTop, report.bossTop) + 0.05;
    const holeR = DEFAULT_SPEC.hole / 2;
    const a = faceVolume(expected, z0, holeR);
    const b = faceVolume(manifold, z0, holeR);
    expect(Math.abs(a - b) / a).toBeLessThan(0.002);
  });

  it('tự xoay khi trục nằm ngang và tự lật khi mặt nan quay xuống', () => {
    const src = syntheticWheel()
      .rotate([180, 0, 0]) // mặt nan về phía z âm
      .rotate([0, 90, 0]) // trục quay nằm theo X
      .translate([3, -7, 11]);
    const { report } = processWheel(wasm, soupOf(src), DEFAULT_SPEC);
    for (const c of report.checks) expect(c.ok, `${c.label}: ${c.actual}`).toBe(true);
    expect(report.autoFlipped).toBe(true);
    expect(report.steps).toContain('Xoay mâm cho trục quay trùng trục Z');
  });

  it('gọt khối trụ cũ to hơn 3 mm và lấp lỗ cũ to hơn 1 mm', () => {
    // Sau khi co về Ø8,5: khối trụ cũ r=4,5 → Ø3,8 mm; lỗ cũ r=2 → Ø1,7 mm.
    const src = syntheticWheel({ oldBoss: 4.5, oldHole: 2 });
    const { report } = processWheel(wasm, soupOf(src), DEFAULT_SPEC);
    for (const c of report.checks) expect(c.ok, `${c.label}: ${c.actual}`).toBe(true);
    expect(report.steps.some((s) => s.startsWith('Gọt khối trụ cũ'))).toBe(true);
  });

  it('viền đã dày thì không đắp thêm', () => {
    const src = syntheticWheel({ wall: 3 });
    const { report } = processWheel(wasm, soupOf(src), DEFAULT_SPEC);
    expect(report.steps.some((s) => s.startsWith('Viền vành đã dày'))).toBe(true);
    expect(report.result.minWall!).toBeGreaterThan(1);
  });

  it('cho chọn đảo mặt trong/ngoài bằng tay', () => {
    const { report } = processWheel(wasm, soupOf(syntheticWheel()), DEFAULT_SPEC, { flip: true });
    expect(report.autoFlipped).toBe(false);
  });

  it('file STL xuất ra đọc lại vẫn là một khối kín, đúng kích thước', () => {
    const { manifold } = processWheel(wasm, soupOf(syntheticWheel()), DEFAULT_SPEC);
    const again = processWheelInput(soupOf(manifold));
    expect(again.status()).toBe('NoError');
    const bb = again.boundingBox();
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(5, 3);
    expect(Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1])).toBeCloseTo(8.5, 2);
  });

  it('đặt được chiều cao khối trụ và chiều cao vòng đắp', () => {
    const spec = { ...DEFAULT_SPEC, bossHeight: 3.8, wallHeight: 2 };
    const { manifold, report } = processWheel(wasm, soupOf(syntheticWheel()), spec);
    for (const c of report.checks) expect(c.ok, `${c.label}: ${c.actual}`).toBe(true);
    expect(report.result.bossHeight).toBeCloseTo(3.8, 2);
    expect(report.result.wallHeight).toBeCloseTo(2, 2);
    // Trên z = 2 vành vẫn mỏng như gốc: điểm bán kính 3,6 mm trống; dưới đó đã đắp kín.
    const filled = (z: number) => insideRegion(manifold.slice(z).toPolygons() as [number, number][][], 3.6, 0.3);
    expect(filled(1.5)).toBe(true);
    expect(filled(2.5)).toBe(false);
    expect(report.warnings.some((w) => w.includes('vẫn mỏng hơn'))).toBe(true);
  });

  it('khối trụ quá thấp thì báo rõ phần còn thiếu', () => {
    const { report } = processWheel(wasm, soupOf(syntheticWheel()), { ...DEFAULT_SPEC, bossHeight: 0.5 });
    expect(report.result.bossHeight).toBeCloseTo(0.5, 2);
    expect(report.warnings.some((w) => w.includes('Trụ cũ') || w.includes('chưa chạm'))).toBe(true);
  });

  it('chiều cao vượt bề rộng mâm thì báo lỗi', () => {
    expect(() => processWheel(wasm, soupOf(syntheticWheel()), { ...DEFAULT_SPEC, bossHeight: 6 })).toThrow(/Chiều cao khối trụ/);
  });

  it('báo lỗi thông số vô lý', () => {
    expect(() => processWheel(wasm, soupOf(syntheticWheel()), { ...DEFAULT_SPEC, hole: 3 })).toThrow(/Lỗ trục/);
  });

  const sample = 'C:/Users/Admin/Downloads/rim4.stl';
  it.skipIf(!existsSync(sample))('mâm mẫu rim4.stl đạt đủ thông số', () => {
    const buf = readFileSync(sample);
    const { report } = processWheel(wasm, parseStl(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
    for (const c of report.checks) expect(c.ok, `${c.label}: ${c.actual}`).toBe(true);
  });
});
