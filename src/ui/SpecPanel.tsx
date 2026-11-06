import { useEffect, useState } from 'react';
import { DEFAULT_SPEC, specError, type WheelSpec } from '../core/wheel';
import { BUILTIN, MAX_NAME, loadPresets, nameError, newPresetId, sameSpec, savePresets, type Preset } from '../lib/presets';

const KEY = 'wheel-tool.spec.v1';

const FIELDS: { key: keyof WheelSpec; label: string; hint: string; optional?: boolean }[] = [
  { key: 'diameter', label: 'Đường kính ngoài', hint: 'Mép ngoài cùng của vành' },
  { key: 'width', label: 'Bề rộng mâm', hint: 'Dọc theo trục, mặt trong → mặt ngoài' },
  { key: 'hole', label: 'Lỗ trục', hint: 'Đúng kích thước, không cộng dung sai' },
  { key: 'boss', label: 'Khối trụ sỏ trục', hint: 'Đường kính khối trụ ở tâm mặt trong' },
  { key: 'bossHeight', label: 'Chiều cao khối trụ sỏ trục', hint: 'Tính từ mặt trong. Để trống: tự động tới mặt nan', optional: true },
  { key: 'wall', label: 'Viền vành tối thiểu', hint: 'Chỗ mỏng hơn sẽ được đắp vào phía trong' },
  { key: 'wallHeight', label: 'Chiều cao vòng đắp viền vành', hint: 'Tính từ mặt trong. Để trống: tự động tới chỗ nan nối vành', optional: true },
];

export function loadSpec(): WheelSpec {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const spec = { ...DEFAULT_SPEC, ...(JSON.parse(raw) as Partial<WheelSpec>) };
      if (specError(spec) === null) return spec;
    }
  } catch {
    /* trình duyệt chặn lưu trữ – dùng mặc định */
  }
  return DEFAULT_SPEC;
}

export function saveSpec(spec: WheelSpec) {
  try {
    localStorage.setItem(KEY, JSON.stringify(spec));
  } catch {
    /* bỏ qua */
  }
}

/** Đang mở ô nào trong phần cấu hình. */
type Mode = 'list' | 'new' | 'rename' | 'delete';

export function SpecPanel({ spec, onApply }: { spec: WheelSpec; onApply: (s: WheelSpec) => void }) {
  const [draft, setDraft] = useState<Record<keyof WheelSpec, string>>(() => toDraft(spec));
  useEffect(() => setDraft(toDraft(spec)), [spec]);

  const [library, setLibrary] = useState(loadPresets);
  const { presets, selectedId } = library;
  const [mode, setMode] = useState<Mode>('list');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);

  const update = (next: Preset[], selected: string) => {
    setLibrary({ presets: next, selectedId: selected });
    savePresets(next, selected);
  };
  const openMode = (m: Mode, initial = '') => {
    setMode(m);
    setName(initial);
    setNameTouched(false);
  };

  const parsed = Object.fromEntries(FIELDS.map((f) => [f.key, parseField(draft[f.key], f.optional)])) as unknown as WheelSpec;
  const error = specError(parsed);
  const dirty = !sameSpec(parsed, spec);
  const selected = presets.find((p) => p.id === selectedId) ?? BUILTIN;
  const isBuiltin = selected.id === BUILTIN.id;
  const modified = !sameSpec(parsed, selected.spec);
  const nameProblem = nameError(name, presets, mode === 'rename' ? selected.id : undefined);

  const choose = (p: Preset) => {
    update(presets, p.id);
    openMode('list');
    setDraft(toDraft(p.spec));
    if (!sameSpec(p.spec, spec)) onApply(p.spec);
  };
  // Lưu dùng số đang nhập trong các ô; nếu chưa áp dụng thì áp dụng luôn để hình và cấu hình khớp nhau.
  const commit = () => {
    if (dirty) onApply(parsed);
  };
  const saveNew = () => {
    setNameTouched(true);
    if (nameProblem || error) return;
    const preset: Preset = { id: newPresetId(), name: name.trim(), spec: parsed };
    update([...presets, preset], preset.id);
    openMode('list');
    commit();
  };
  const overwrite = () => {
    if (error || isBuiltin) return;
    update(presets.map((p) => (p.id === selected.id ? { ...p, spec: parsed } : p)), selected.id);
    commit();
  };
  const rename = () => {
    setNameTouched(true);
    if (nameProblem) return;
    update(presets.map((p) => (p.id === selected.id ? { ...p, name: name.trim() } : p)), selected.id);
    openMode('list');
  };
  const remove = () => {
    update(presets.filter((p) => p.id !== selected.id), BUILTIN.id);
    openMode('list');
    setDraft(toDraft(BUILTIN.spec));
    if (!sameSpec(BUILTIN.spec, spec)) onApply(BUILTIN.spec);
  };

  return (
    <>
      <section className="panel">
        <h2 className="panel-title">Cấu hình đã lưu</h2>
        <ul className="presets">
          {[BUILTIN, ...presets].map((p) => (
            <li key={p.id}>
              <button type="button" className="preset" aria-pressed={p.id === selected.id} onClick={() => choose(p)}>
                <span className="preset-name" title={p.name}>
                  {p.name}
                  {p.id === selected.id && modified && <em> · đã sửa</em>}
                </span>
                <span className="preset-sum mono">{summary(p.spec)}</span>
              </button>
            </li>
          ))}
        </ul>

        {mode === 'list' && (
          <div className="preset-actions">
            <button type="button" className="btn btn-quiet btn-sm" disabled={!!error} onClick={() => openMode('new')}>
              Lưu thành cấu hình mới
            </button>
            {!isBuiltin && (
              <>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => openMode('rename', selected.name)}>
                  Đổi tên
                </button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => openMode('delete')}>
                  Xóa
                </button>
              </>
            )}
          </div>
        )}

        {(mode === 'new' || mode === 'rename') && (
          <form
            className="preset-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (mode === 'new') saveNew();
              else rename();
            }}
          >
            <label className="preset-field">
              {mode === 'new' ? 'Tên cấu hình mới' : `Đổi tên “${selected.name}”`}
              <input
                autoFocus
                value={name}
                maxLength={MAX_NAME}
                placeholder="Ví dụ: Mâm Hot Wheels 1:64"
                aria-invalid={nameTouched && !!nameProblem}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {nameTouched && nameProblem && <p className="spec-error">{nameProblem}</p>}
            <div className="preset-actions">
              <button type="submit" className="btn btn-ink btn-sm">
                {mode === 'new' ? 'Lưu' : 'Đổi tên'}
              </button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => openMode('list')}>
                Hủy
              </button>
            </div>
          </form>
        )}

        {mode === 'delete' && (
          <div className="preset-form">
            <p className="preset-confirm">Xóa cấu hình “{selected.name}”? Không khôi phục lại được.</p>
            <div className="preset-actions">
              <button type="button" className="btn btn-danger btn-sm" onClick={remove}>
                Xóa
              </button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => openMode('list')}>
                Hủy
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <h2 className="panel-title">Thông số chuẩn</h2>
        <form
          className="spec"
          onSubmit={(e) => {
            e.preventDefault();
            if (!error && dirty) onApply(parsed);
          }}
        >
          {FIELDS.map((f) => (
            <label className="spec-row" key={f.key} title={f.hint}>
              <span className="spec-label">
                {f.label}
                <small>{f.hint}</small>
              </span>
              <span className="spec-input">
                <input
                  className="mono"
                  inputMode="decimal"
                  aria-label={`${f.label} (mm)`}
                  placeholder={f.optional ? 'Tự động' : undefined}
                  value={draft[f.key]}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  aria-invalid={!((parseField(draft[f.key], f.optional) ?? 1) > 0)}
                />
                <span className="unit">mm</span>
              </span>
            </label>
          ))}
          {error && <p className="spec-error">{error}</p>}
          <div className="spec-actions">
            <button type="submit" className="btn btn-ink" disabled={!!error || !dirty}>
              Áp dụng
            </button>
            {dirty && (
              <button type="button" className="btn btn-quiet" onClick={() => setDraft(toDraft(spec))}>
                Hủy
              </button>
            )}
            {!isBuiltin && modified && (
              <button type="button" className="btn btn-quiet" disabled={!!error} onClick={overwrite} title={`Ghi đè số đang nhập vào “${selected.name}”`}>
                Lưu vào cấu hình này
              </button>
            )}
          </div>
          {isBuiltin && modified && !error && <p className="muted small">“Mặc định” không ghi đè được. Muốn giữ bộ số này, bấm “Lưu thành cấu hình mới”.</p>}
        </form>
      </section>
    </>
  );
}

function summary(s: WheelSpec): string {
  const n = (v: number) => String(v).replace('.', ',');
  return `Ø${n(s.diameter)} × ${n(s.width)} · lỗ ${n(s.hole)} · trụ ${n(s.boss)}`;
}

function parseField(text: string, optional?: boolean): number | null {
  if (optional && text.trim() === '') return null;
  return Number(text.replace(',', '.'));
}

function toDraft(s: WheelSpec): Record<keyof WheelSpec, string> {
  return Object.fromEntries(FIELDS.map((f) => [f.key, s[f.key] === null ? '' : String(s[f.key]).replace('.', ',')])) as Record<keyof WheelSpec, string>;
}
