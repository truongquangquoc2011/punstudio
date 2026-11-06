import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_REPAIR, RESOLUTIONS, type RepairOptions } from './core/load';
import type { WheelSpec } from './core/wheel';
import { createProcessor } from './lib/processor';
import type { WorkerResponse } from './lib/protocol';
import { SpecPanel, loadSpec, saveSpec } from './ui/SpecPanel';
import { Report } from './ui/Report';
import { UpdateBar } from './ui/UpdateBar';
import { Viewer, type Angle } from './ui/Viewer';

type Result = Extract<WorkerResponse, { type: 'result' }>;
type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; result: Result } | { kind: 'error'; message: string };

const MAX_BYTES = 200 * 1024 * 1024;

const STAGES: Record<string, string> = {
  voxel: 'Sửa mâm: đọc bề mặt',
  fill: 'Sửa mâm: tìm phần ruột',
  smooth: 'Sửa mâm: làm mịn',
  surface: 'Sửa mâm: dựng lại bề mặt',
  simplify: 'Sửa mâm: gọn lưới',
  clean: 'Sửa mâm: dọn mảnh vụn',
  check: 'Sửa mâm: so với file gốc',
  wheel: 'Chuẩn hóa mâm',
};

export default function App() {
  // Tạo worker khi cần; khi component gỡ ra thì tắt và lần sau tạo lại (React dev gắn/gỡ hai lần).
  const proc = useRef<ReturnType<typeof createProcessor> | null>(null);
  const processor = useMemo(() => ({ run: (...a: Parameters<ReturnType<typeof createProcessor>['run']>) => (proc.current ??= createProcessor()).run(...a) }), []);
  useEffect(
    () => () => {
      proc.current?.dispose();
      proc.current = null;
    },
    [],
  );

  const [spec, setSpec] = useState<WheelSpec>(loadSpec);
  const [file, setFile] = useState<{ name: string; size: number; buffer: ArrayBuffer } | null>(null);
  const [flip, setFlip] = useState(false);
  const [repair, setRepair] = useState<RepairOptions>(DEFAULT_REPAIR);
  const [stage, setStage] = useState('');
  const fileId = useRef(0);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [show, setShow] = useState<'result' | 'source'>('result');
  const [section, setSection] = useState(false);
  const [angle, setAngle] = useState<Angle>('iso');
  const [angleNonce, setAngleNonce] = useState(0);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const lastDone = useRef<Result | null>(null);

  const run = useCallback(
    (buffer: ArrayBuffer, s: WheelSpec, f: boolean, r: RepairOptions) => {
      setStatus({ kind: 'busy' });
      setStage('');
      processor.run(buffer, s, f, r, fileId.current, setStage).then(
        (result) => {
          lastDone.current = result;
          setStatus({ kind: 'done', result });
        },
        (err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        },
      );
    },
    [processor],
  );

  const openFile = async (f: File) => {
    if (!/\.stl$/i.test(f.name)) {
      setStatus({ kind: 'error', message: `“${f.name}” không phải file .stl.` });
      return;
    }
    if (f.size > MAX_BYTES) {
      setStatus({ kind: 'error', message: 'File lớn hơn 200 MB – hãy giảm số tam giác trước.' });
      return;
    }
    const buffer = await f.arrayBuffer();
    setFile({ name: f.name, size: f.size, buffer });
    setFlip(false);
    setShow('result');
    setAngle('iso');
    setAngleNonce((n) => n + 1);
    lastDone.current = null;
    fileId.current += 1;
    setRepair(DEFAULT_REPAIR);
    run(buffer, spec, false, DEFAULT_REPAIR);
  };

  const applySpec = (next: WheelSpec) => {
    setSpec(next);
    saveSpec(next);
    if (file) run(file.buffer, next, flip, repair);
  };

  const toggleFlip = () => {
    if (!file) return;
    setFlip(!flip);
    run(file.buffer, spec, !flip, repair);
  };

  const applyRepair = (next: RepairOptions) => {
    setRepair(next);
    if (file) run(file.buffer, spec, flip, next);
  };

  const download = () => {
    if (status.kind !== 'done' || !file) return;
    const base = file.name.replace(/\.stl$/i, '');
    const tag = `${spec.diameter}x${spec.width}`.replace(/\./g, ',');
    const url = URL.createObjectURL(new Blob([status.result.stl], { type: 'model/stl' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}-chuan-${tag}mm.stl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Trong lúc xử lý lại vẫn giữ hình cũ trên màn hình, tránh nháy trắng.
  const shown = status.kind === 'done' ? status.result : status.kind === 'busy' ? lastDone.current : null;
  const viewMesh = shown ? (show === 'result' ? shown.result : shown.source) : null;
  const method = shown?.report.source.repair.method;

  return (
    <div
      className={`app${dragging ? ' is-dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) void openFile(f);
      }}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 20 20" width="18" height="18">
              <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="10" cy="10" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="10" cy="10" r="1" fill="currentColor" />
            </svg>
          </span>
          <span className="brand-name">Punstudio</span>
          <span className="brand-tag mono">STL · 1:64</span>
        </div>
        <div className="topbar-right">
          <div className="topbar-status mono">
            {status.kind === 'busy' && <span className="pulse">{STAGES[stage] ?? 'Đang xử lý'}</span>}
            {status.kind === 'done' && <span>Xong trong {(status.result.ms / 1000).toFixed(1).replace('.', ',')} s</span>}
          </div>
          <UpdateBar />
        </div>
        {status.kind === 'busy' && <div className="progress" aria-hidden />}
      </header>

      <aside className="col col-left">
        <SpecPanel spec={spec} onApply={applySpec} />
        <section className="panel">
          <h2 className="panel-title">File mâm</h2>
          {file ? (
            <div className="file">
              <div className="file-name" title={file.name}>{file.name}</div>
              <dl className="kv mono">
                <dt>Dung lượng</dt>
                <dd>{(file.size / 1024).toFixed(0)} KB</dd>
                {shown && (
                  <>
                    <dt>Tam giác</dt>
                    <dd>{shown.report.source.triangles.toLocaleString('vi-VN')}</dd>
                    <dt>Gốc</dt>
                    <dd>
                      Ø{fmt(shown.report.source.diameter)} × {fmt(shown.report.source.width)} mm
                    </dd>
                  </>
                )}
              </dl>
              <button type="button" className="btn btn-quiet" onClick={() => input.current?.click()}>
                Chọn file khác
              </button>
            </div>
          ) : (
            <p className="muted">Chưa có file. Thả file .stl vào giữa màn hình hoặc bấm chọn file.</p>
          )}
        </section>
        {file && (
          <section className="panel">
            <h2 className="panel-title">Sửa mâm</h2>
            {method && (
              <p className={`repair-state${method === 'rebuild' ? ' is-rebuilt' : ''}`}>
                {method === 'none' && 'Lưới kín, không cần sửa. Bề mặt giữ nguyên.'}
                {method === 'patch' && 'Lưới có vài lỗi nhỏ, đã vá. Phần còn lại giữ nguyên.'}
                {method === 'rebuild' && 'Mâm đã được đúc lại thành khối kín.'}
              </p>
            )}
            {shown && shown.report.source.repairs.length > 0 && (
              <ul className="repairs">
                {shown.report.source.repairs.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            <div className="repair-row">
              <span>Cách sửa</span>
              <div className="seg" role="group" aria-label="Cách sửa">
                <button type="button" aria-pressed={repair.mode === 'auto'} disabled={status.kind === 'busy'} onClick={() => applyRepair({ ...repair, mode: 'auto' })}>
                  Tự động
                </button>
                <button type="button" aria-pressed={repair.mode === 'rebuild'} disabled={status.kind === 'busy'} onClick={() => applyRepair({ ...repair, mode: 'rebuild' })}>
                  Luôn đúc lại
                </button>
              </div>
            </div>
            {(method === 'rebuild' || repair.mode === 'rebuild') && (
              <div className="repair-row">
                <span>Độ mịn</span>
                <div className="seg" role="group" aria-label="Độ mịn khi đúc lại">
                  {RESOLUTIONS.map((r) => (
                    <button type="button" key={r.value} aria-pressed={repair.resolution === r.value} disabled={status.kind === 'busy'} onClick={() => applyRepair({ ...repair, resolution: r.value })}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
        <p className="footnote">File được xử lý ngay trong trình duyệt, không gửi đi đâu.</p>
      </aside>

      <main className="stage">
        <Viewer mesh={viewMesh} section={section} highlight={show === 'result'} angle={angle} angleNonce={angleNonce} />
        {!file && (
          <button type="button" className="drop" onClick={() => input.current?.click()}>
            <span className="drop-frame" aria-hidden>
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="drop-title">Thả file STL của mâm vào đây</span>
            <span className="drop-sub">hoặc bấm để chọn file — mâm bất kỳ, chưa cần xử lý gì</span>
          </button>
        )}
        {file && (
          <div className="toolbar">
            <div className="seg" role="group" aria-label="Hiển thị">
              <button type="button" aria-pressed={show === 'result'} onClick={() => setShow('result')}>
                Kết quả
              </button>
              <button type="button" aria-pressed={show === 'source'} onClick={() => setShow('source')}>
                {method === 'rebuild' ? 'Đã sửa' : 'Gốc'}
              </button>
            </div>
            <div className="seg" role="group" aria-label="Góc nhìn">
              {(
                [
                  ['iso', 'Nghiêng'],
                  ['outer', 'Mặt ngoài'],
                  ['inner', 'Mặt trong'],
                ] as [Angle, string][]
              ).map(([a, label]) => (
                <button
                  type="button"
                  key={a}
                  aria-pressed={angle === a}
                  onClick={() => {
                    setAngle(a);
                    setAngleNonce((n) => n + 1);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="chip" aria-pressed={section} onClick={() => setSection(!section)}>
              Cắt đôi
            </button>
          </div>
        )}
        {shown && show === 'result' && (
          <div className="legend">
            <span>
              <i className="sw sw-model" /> {method === 'rebuild' ? 'Mâm đã đúc lại' : 'Giữ nguyên từ file gốc'}
            </span>
            <span>
              <i className="sw sw-accent" /> App thêm vào
            </span>
          </div>
        )}
        {shown && (
          <div className="readout mono">
            Ø {fmt(show === 'result' ? shown.report.result.diameter : spec.diameter, 3)} × {fmt(show === 'result' ? shown.report.result.width : spec.width, 3)} mm
          </div>
        )}
        {status.kind === 'error' && (
          <div className="stage-error" role="alert">
            <strong>Không xử lý được file.</strong>
            <span>{status.message}</span>
          </div>
        )}
      </main>

      <aside className="col col-right">
        <Report
          result={shown}
          busy={status.kind === 'busy'}
          spec={spec}
          flipped={flip}
          onDownload={download}
          onFlip={toggleFlip}
          canDownload={status.kind === 'done'}
        />
      </aside>

      <input
        ref={input}
        type="file"
        accept=".stl,model/stl"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function fmt(v: number, d = 2) {
  return v.toFixed(d).replace('.', ',');
}

