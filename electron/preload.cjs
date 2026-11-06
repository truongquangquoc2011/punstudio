// Cầu nối tối thiểu giữa trang và tiến trình chính: trang chỉ gọi được đúng các việc cập nhật này.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('punstudio', {
  version: () => ipcRenderer.invoke('app:version'),
  check: () => ipcRenderer.invoke('update:check'),
  download: () => ipcRenderer.invoke('update:download'),
  install: () => ipcRenderer.invoke('update:install'),
  onUpdate: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },
});
