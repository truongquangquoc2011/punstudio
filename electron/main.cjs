// Vỏ desktop cho Punstudio: một cửa sổ nạp bản build tĩnh trong dist/ qua giao thức app:// (để WebAssembly và
// Web Worker chạy y như trên trình duyệt – file:// chặn module worker). Trang không có Node; mạng chỉ dùng để kiểm tra bản cập nhật.
const { app, BrowserWindow, Menu, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setupUpdater } = require('./updater.cjs');

const DIST = path.join(__dirname, '..', 'dist');

// Giữ thư mục dữ liệu của các bản trước (tên gói cũ wheel-tool) để không mất các cấu hình đã lưu khi đổi tên app.
app.setPath('userData', path.join(app.getPath('appData'), 'wheel-tool'));
// Khớp với shortcut bộ cài tạo ra, để thanh tác vụ gộp đúng cửa sổ và hiện đúng icon.
app.setAppUserModelId('com.punstudio.app');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f2efe9',
    title: 'Punstudio',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  // Liên kết ngoài (nếu có) mở bằng trình duyệt của máy, không mở trong app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('app://bundle/index.html');
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  const win = createWindow();
  setupUpdater(win);
  if (process.env.WHEEL_SMOKE) smokeTest(win, process.env.WHEEL_SMOKE);
});

app.on('window-all-closed', () => app.quit());

/** Tự kiểm tra (chỉ khi đặt biến WHEEL_SMOKE=<đường dẫn .stl>): nạp file, chờ kết quả, in ra rồi thoát. */
function smokeTest(win, stlPath) {
  const fs = require('node:fs');
  win.webContents.once('did-finish-load', async () => {
    try {
      const b64 = fs.readFileSync(stlPath).toString('base64');
      const result = await win.webContents.executeJavaScript(`(async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], 'smoke.stl'));
        const input = document.querySelector('input[type=file]');
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        for (let i = 0; i < 200; i++) {
          const err = document.querySelector('.stage-error');
          if (err) return 'LỖI: ' + err.innerText;
          const score = document.querySelector('.score-num');
          if (score) {
            // Đếm số lần chạy tự kiểm tra: tăng dần qua các lần mở nghĩa là dữ liệu lưu không bị mất khi tắt app.
            const runs = Number(localStorage.getItem('wheel-tool.smoke-runs') ?? 0) + 1;
            localStorage.setItem('wheel-tool.smoke-runs', String(runs));
            return score.textContent + ' | ' + document.querySelector('.readout').textContent + ' | lần chạy ' + runs;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
        return 'HẾT GIỜ';
      })()`);
      console.log('[smoke]', result);
    } catch (e) {
      console.log('[smoke] lỗi', e);
    }
    app.quit();
  });
}
