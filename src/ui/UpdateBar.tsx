import { useEffect, useState } from 'react';

export type UpdateStatus =
  | { state: 'idle' | 'checking' | 'latest' | 'none' }
  | { state: 'available' | 'ready'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'error'; message: string };

interface Bridge {
  version(): Promise<string>;
  check(): Promise<unknown>;
  download(): Promise<unknown>;
  install(): Promise<unknown>;
  onUpdate(listener: (status: UpdateStatus) => void): () => void;
}

declare global {
  interface Window {
    punstudio?: Bridge;
  }
}

/** Phần cập nhật trên thanh đầu. Chạy trên trình duyệt thường (không có cầu nối desktop) thì không hiện gì. */
export function UpdateBar() {
  const bridge = window.punstudio;
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });

  useEffect(() => {
    if (!bridge) return;
    void bridge.version().then(setVersion);
    return bridge.onUpdate(setStatus);
  }, [bridge]);

  if (!bridge) return null;

  return (
    <div className="update" aria-live="polite">
      {status.state === 'available' && (
        <>
          <span className="update-text">Có bản mới {status.version}</span>
          <button type="button" className="btn btn-accent btn-sm" onClick={() => void bridge.download()}>
            Cập nhật
          </button>
        </>
      )}
      {status.state === 'downloading' && (
        <>
          <span className="update-text mono">Đang tải {status.percent}%</span>
          <span className="update-meter" aria-hidden>
            <i style={{ width: `${status.percent}%` }} />
          </span>
        </>
      )}
      {status.state === 'ready' && (
        <>
          <span className="update-text">Đã tải xong bản {status.version}</span>
          <button type="button" className="btn btn-accent btn-sm" onClick={() => void bridge.install()}>
            Khởi động lại để cập nhật
          </button>
        </>
      )}
      {status.state === 'checking' && <span className="update-text">Đang kiểm tra…</span>}
      {status.state === 'latest' && <span className="update-text">Đang dùng bản mới nhất</span>}
      {status.state === 'error' && (
        <span className="update-text is-bad" title={status.message}>
          Không kiểm tra được cập nhật
        </span>
      )}
      {(status.state === 'idle' || status.state === 'latest' || status.state === 'error' || status.state === 'none') && (
        <button type="button" className="update-link mono" title="Kiểm tra bản mới" onClick={() => void bridge.check()}>
          v{version}
        </button>
      )}
    </div>
  );
}
