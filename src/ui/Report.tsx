import type { WheelSpec } from '../core/wheel';
import type { WorkerResponse } from '../lib/protocol';

type Result = Extract<WorkerResponse, { type: 'result' }>;

interface Props {
  result: Result | null;
  busy: boolean;
  spec: WheelSpec;
  flipped: boolean;
  canDownload: boolean;
  onDownload: () => void;
  onFlip: () => void;
}

export function Report({ result, busy, flipped, canDownload, onDownload, onFlip }: Props) {
  if (!result) {
    return (
      <section className="panel">
        <h2 className="panel-title">Kiểm tra</h2>
        <p className="muted">
          {busy
            ? 'Đang đo và xử lý mâm. File nặng hoặc lưới lỗi cần đúc lại có thể mất vài chục giây.'
            : 'Sau khi xử lý, mọi số đo ở đây được đo lại trực tiếp trên file kết quả – không phải con số mong muốn.'}
        </p>
      </section>
    );
  }
  const { report } = result;
  const passed = report.checks.filter((c) => c.ok).length;
  const allOk = passed === report.checks.length;

  return (
    <>
      <section className="panel">
        <h2 className="panel-title">Kiểm tra</h2>
        <div className={`score${allOk ? ' is-ok' : ' is-bad'}`}>
          <span className="score-num mono">
            {passed}/{report.checks.length}
          </span>
          <span className="score-text">
            {!allOk ? 'Có mục chưa đạt — xem bên dưới' : report.warnings.length ? 'Đạt số đo — còn mục cần xem lại' : 'Đạt toàn bộ — sẵn sàng in'}
          </span>
        </div>
        <table className="checks">
          <thead>
            <tr>
              <th>Mục</th>
              <th>Chuẩn</th>
              <th>Đo được</th>
            </tr>
          </thead>
          <tbody>
            {report.checks.map((c) => (
              <tr key={c.label} className={c.ok ? '' : 'is-bad'}>
                <td>{c.label}</td>
                <td className="mono">{c.target}</td>
                <td className="mono">
                  <span className="mark" aria-label={c.ok ? 'đạt' : 'không đạt'}>
                    {c.ok ? '' : '!'}
                  </span>
                  {c.actual}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {report.warnings.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">Cần xem lại</h2>
          <ul className="warnings">
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2 className="panel-title">Đã làm</h2>
        <ol className="steps">
          {report.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="muted small">
          {flipped
            ? 'Mặt ngoài đang theo lựa chọn của bạn (đảo so với app tự nhận).'
            : 'Mặt ngoài do app tự nhận: phía gặp mặt nan sớm hơn khi nhìn dọc trục.'}{' '}
          Khối trụ luôn nằm ở mặt trong – nếu thấy nó mọc ra phía mặt nan, bấm “Đảo mặt trong/ngoài”.
        </p>
      </section>

      <div className="actions">
        <button type="button" className="btn btn-ink btn-lg" disabled={!canDownload} onClick={onDownload}>
          Tải file STL
        </button>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onFlip}>
          Đảo mặt trong/ngoài
        </button>
      </div>
    </>
  );
}
