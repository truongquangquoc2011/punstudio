// Tạo icon app: build/icon.svg (bản lớn), build/icon.png (1024), build/icon.ico nhiều cỡ, và ảnh cho bộ cài
// (installerSidebar.bmp, installerHeader.bmp – NSIS chỉ đọc BMP 24-bit).
// Cỡ nhỏ (≤ 48 px) dùng hình giản lược nét dày để vẫn đọc được trên thanh tác vụ.
// Chạy lại khi đổi thiết kế: node scripts/make-icon.cjs
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const INK = '#1c1b19';
const PAPER = '#f2efe9';
const ACCENT = '#d4501c';
const OUT = path.join(__dirname, '..', 'build');

/** Tọa độ quanh tâm (512, 512): góc 0° hướng lên, quay theo chiều kim đồng hồ. */
function polar(r, deg) {
  const a = (deg * Math.PI) / 180;
  return `${(512 + r * Math.sin(a)).toFixed(1)} ${(512 - r * Math.cos(a)).toFixed(1)}`;
}

function detailed() {
  const spokes = [];
  for (let i = 0; i < 5; i++) {
    const c = i * 72;
    // Nan chữ Y: một thân từ moay-ơ, tách đôi trước khi chạm vành.
    spokes.push(`M ${polar(120, c - 11)} L ${polar(228, c - 4)} L ${polar(322, c - 17)} L ${polar(322, c - 7)} L ${polar(250, c)} L ${polar(322, c + 7)} L ${polar(322, c + 17)} L ${polar(228, c + 4)} L ${polar(120, c + 11)} Z`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect x="40" y="40" width="944" height="944" rx="208" fill="${INK}"/>
  <circle cx="512" cy="512" r="376" fill="none" stroke="${PAPER}" stroke-width="64"/>
  <circle cx="512" cy="512" r="316" fill="none" stroke="${PAPER}" stroke-width="10" opacity="0.45"/>
  <path d="${spokes.join(' ')}" fill="${PAPER}"/>
  <circle cx="512" cy="512" r="128" fill="${ACCENT}"/>
  <circle cx="512" cy="512" r="46" fill="${INK}"/>
</svg>`;
}

function simple() {
  const spokes = [];
  for (let i = 0; i < 5; i++) spokes.push(`M ${polar(100, i * 72)} L ${polar(350, i * 72)}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect x="0" y="0" width="1024" height="1024" rx="190" fill="${INK}"/>
  <circle cx="512" cy="512" r="392" fill="none" stroke="${PAPER}" stroke-width="104"/>
  <path d="${spokes.join(' ')}" stroke="${PAPER}" stroke-width="84" fill="none"/>
  <circle cx="512" cy="512" r="164" fill="${ACCENT}"/>
</svg>`;
}

/** ICO chứa ảnh PNG (Windows Vista trở lên đọc được mọi cỡ). */
function toIco(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const o = 6 + i * 16;
    header[o] = size >= 256 ? 0 : size;
    header[o + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(png.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((im) => im.png)]);
}

/** Ảnh cạnh trái màn hình chào/hoàn tất của bộ cài (164×314): mâm cắt góc, tên app. */
function sidebar() {
  const inner = detailed().replace(/^<svg[^>]*>/, '').replace('</svg>', '').replace(/<rect[^>]*\/>/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <rect width="164" height="314" fill="${INK}"/>
  <text x="16" y="42" font-family="Segoe UI, Arial, sans-serif" font-size="21" font-weight="600" fill="${PAPER}">Punstudio</text>
  <rect x="16" y="52" width="26" height="3" fill="${ACCENT}"/>
  <g transform="translate(-66 118) scale(0.3)">${inner}</g>
</svg>`;
}

/** Dải đầu các màn hình giữa của bộ cài (150×57). */
function header() {
  const inner = simple().replace(/^<svg[^>]*>/, '').replace('</svg>', '').replace(/<rect[^>]*\/>/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <rect width="150" height="57" fill="#ffffff"/>
  <rect x="96" y="5" width="47" height="47" rx="9" fill="${INK}"/>
  <g transform="translate(96 5) scale(0.0459)">${inner}</g>
</svg>`;
}

/** BMP 24-bit từ ảnh RGB thô (dòng dưới cùng trước, mỗi dòng đệm tới bội số của 4). */
function toBmp(rgb, w, h) {
  const stride = Math.ceil((w * 3) / 4) * 4;
  const out = Buffer.alloc(54 + stride * h);
  out.write('BM', 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(w, 18);
  out.writeInt32LE(h, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(stride * h, 34);
  for (let y = 0; y < h; y++) {
    const row = 54 + (h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      out[row + x * 3] = rgb[i + 2];
      out[row + x * 3 + 1] = rgb[i + 1];
      out[row + x * 3 + 2] = rgb[i];
    }
  }
  return out;
}

async function writeBmp(svg, name, preview) {
  const { data, info } = await sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  fs.writeFileSync(path.join(OUT, name), toBmp(data, info.width, info.height));
  if (preview) await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).resize(info.width * 2).png().toFile(path.join(preview, name + '.png'));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await writeBmp(sidebar(), 'installerSidebar.bmp', process.argv[3]);
  await writeBmp(header(), 'installerHeader.bmp', process.argv[3]);
  fs.writeFileSync(path.join(OUT, 'icon.svg'), detailed());
  const render = (svg, size) => sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toBuffer();
  fs.writeFileSync(path.join(OUT, 'icon.png'), await render(detailed(), 1024));
  const images = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    images.push({ size, png: await render(size <= 48 ? simple() : detailed(), size) });
  }
  fs.writeFileSync(path.join(OUT, 'icon.ico'), toIco(images));
  // Ảnh xem thử các cỡ trên nền sáng và tối (không đóng gói vào app).
  if (process.argv[2]) {
    const sizes = images.filter((im) => im.size !== 64);
    const W = 760, H = 300;
    const layers = [];
    let x = 20;
    for (const { size, png } of sizes) {
      layers.push({ input: png, left: x, top: 20 });
      layers.push({ input: png, left: x, top: 160 > 20 + size ? 160 : 20 + size });
      x += size + 20;
    }
    const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H / 2}" fill="#f3f3f3"/><rect y="${H / 2}" width="${W}" height="${H / 2}" fill="#202020"/></svg>`);
    await sharp(bg).composite(layers.slice(0, 12)).png().toFile(process.argv[2]);
  }
  console.log('Đã tạo', fs.readdirSync(OUT).join(', '));
})();
