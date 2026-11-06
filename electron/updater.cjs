// Cập nhật app qua electron-updater: nguồn bản mới lấy từ cấu hình "publish" lúc build (GitHub Releases).
// Không tự tải: chỉ báo cho người dùng, họ bấm mới tải và cài.
const { app, ipcMain } = require('electron');

const SIX_HOURS = 6 * 60 * 60 * 1000;

function setupUpdater(win) {
  let last = { state: 'idle' };
  let manual = false;
  const send = (status) => {
    last = status;
    if (!win.isDestroyed()) win.webContents.send('update:status', status);
  };

  ipcMain.handle('app:version', () => app.getVersion());

  // Chạy không đóng gói (npm run app) thì không có gì để cập nhật.
  if (!app.isPackaged) {
    ipcMain.handle('update:check', () => send({ state: 'none' }));
    ipcMain.handle('update:download', () => {});
    ipcMain.handle('update:install', () => {});
    return;
  }

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true; // đã tải xong mà tắt app thì lần tắt đó cài luôn

  autoUpdater.on('checking-for-update', () => {
    if (manual) send({ state: 'checking' });
  });
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => {
    send(manual ? { state: 'latest' } : { state: 'idle' });
    manual = false;
  });
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => {
    // Mất mạng lúc tự kiểm tra thì im lặng; chỉ báo khi người dùng chủ động bấm hoặc đang tải dở.
    const busy = last.state === 'downloading';
    if (manual || busy) send({ state: 'error', message: String((err && err.message) || err).split('\n')[0] });
    manual = false;
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  ipcMain.handle('update:check', () => {
    manual = true;
    return check();
  });
  ipcMain.handle('update:download', () => {
    send({ state: 'downloading', percent: 0 });
    return autoUpdater.downloadUpdate().catch(() => {});
  });
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall(true, true));

  win.webContents.once('did-finish-load', () => {
    check();
    setInterval(check, SIX_HOURS);
  });
}

module.exports = { setupUpdater };
