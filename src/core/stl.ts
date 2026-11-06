/** Đọc/ghi STL. Trả về "triangle soup": mỗi tam giác 9 số (3 đỉnh × xyz), chưa gộp đỉnh. */

export class StlError extends Error {}

export function parseStl(buffer: ArrayBuffer): Float32Array {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 84) {
    const view = new DataView(buffer);
    const n = view.getUint32(80, true);
    if (84 + n * 50 === bytes.length) return parseBinary(view, n);
  }
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 1024))).trimStart();
  if (head.startsWith('solid')) return parseAscii(new TextDecoder().decode(bytes));
  throw new StlError('Không đọc được file: không phải STL nhị phân hay STL dạng chữ hợp lệ.');
}

function parseBinary(view: DataView, n: number): Float32Array {
  if (n === 0) throw new StlError('File STL không có tam giác nào.');
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const base = 84 + i * 50 + 12; // bỏ qua pháp tuyến: tự tính lại từ thứ tự đỉnh
    for (let k = 0; k < 9; k++) out[i * 9 + k] = view.getFloat32(base + k * 4, true);
  }
  return out;
}

function parseAscii(text: string): Float32Array {
  const values: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) values.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (values.length === 0 || values.length % 9 !== 0 || values.some((v) => !Number.isFinite(v))) {
    throw new StlError('File STL dạng chữ bị hỏng hoặc thiếu đỉnh.');
  }
  return new Float32Array(values);
}

/** STL nhị phân từ danh sách đỉnh + chỉ số tam giác (pháp tuyến tính theo thứ tự đỉnh ngược chiều kim đồng hồ). */
export function writeStl(vert: Float32Array, tri: Uint32Array, numProp = 3, header = 'wheel-tool'): ArrayBuffer {
  const n = tri.length / 3;
  const buffer = new ArrayBuffer(84 + n * 50);
  const view = new DataView(buffer);
  const head = new TextEncoder().encode(header.slice(0, 79));
  new Uint8Array(buffer, 0, head.length).set(head);
  view.setUint32(80, n, true);
  for (let i = 0; i < n; i++) {
    const p = [0, 1, 2].map((k) => tri[i * 3 + k] * numProp);
    const [a, b, c] = p.map((o) => [vert[o], vert[o + 1], vert[o + 2]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = u[1] * v[2] - u[2] * v[1];
    const ny = u[2] * v[0] - u[0] * v[2];
    const nz = u[0] * v[1] - u[1] * v[0];
    const len = Math.hypot(nx, ny, nz) || 1;
    const base = 84 + i * 50;
    view.setFloat32(base, nx / len, true);
    view.setFloat32(base + 4, ny / len, true);
    view.setFloat32(base + 8, nz / len, true);
    let o = base + 12;
    for (const pt of [a, b, c]) for (const x of pt) (view.setFloat32(o, x, true), (o += 4));
  }
  return buffer;
}
