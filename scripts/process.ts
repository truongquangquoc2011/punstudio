/** Chạy thử không cần giao diện: npm run process -- <vào.stl> [ra.stl] [--flip] */
import Module from 'manifold-3d';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseStl, writeStl } from '../src/core/stl';
import { DEFAULT_SPEC, processWheel } from '../src/core/wheel';

const args = process.argv.slice(2);
const flip = args.includes('--flip');
const [input, output] = args.filter((a) => !a.startsWith('--'));
if (!input) {
  console.error('Cách dùng: npm run process -- <vào.stl> [ra.stl] [--flip]');
  process.exit(1);
}
const wasm = await Module();
wasm.setup();
const buf = readFileSync(input);
const t0 = performance.now();
const { manifold, report } = processWheel(wasm, parseStl(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), DEFAULT_SPEC, { flip });
const ms = Math.round(performance.now() - t0);
console.log(JSON.stringify({ ...report, ms }, null, 2));
if (output) {
  const mesh = manifold.getMesh();
  writeFileSync(output, Buffer.from(writeStl(mesh.vertProperties, mesh.triVerts, mesh.numProp)));
  console.log('Đã ghi', output);
}
manifold.delete();
