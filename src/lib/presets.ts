import { DEFAULT_SPEC, specError, type WheelSpec } from '../core/wheel';

/** Bộ thông số có tên, lưu lại để chọn nhanh cho từng loại mâm. */
export interface Preset {
  id: string;
  name: string;
  spec: WheelSpec;
}

/** Luôn có sẵn, không sửa hay xóa được. */
export const BUILTIN: Preset = { id: 'default', name: 'Mặc định', spec: DEFAULT_SPEC };

export const MAX_NAME = 40;

const KEY = 'wheel-tool.presets.v1';
const SELECTED_KEY = 'wheel-tool.preset-selected.v1';

export function sameSpec(a: WheelSpec, b: WheelSpec): boolean {
  return (Object.keys(DEFAULT_SPEC) as (keyof WheelSpec)[]).every((k) => a[k] === b[k]);
}

/** Đọc danh sách đã lưu; mục hỏng thì bỏ, thông số mới chưa có trong mục cũ thì lấy mặc định. */
export function parsePresets(raw: string | null): Preset[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: Preset[] = [];
  for (const item of data as Partial<Preset>[]) {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || !item.name.trim()) continue;
    if (item.id === BUILTIN.id || out.some((p) => p.id === item.id)) continue;
    const spec = { ...DEFAULT_SPEC, ...item.spec };
    if (specError(spec) === null) out.push({ id: item.id, name: item.name, spec });
  }
  return out;
}

/** Lý do tên không dùng được, hoặc null. Không phân biệt hoa thường khi so trùng. */
export function nameError(name: string, presets: Preset[], exceptId?: string): string | null {
  const clean = name.trim();
  if (!clean) return 'Hãy nhập tên cấu hình.';
  if (clean.length > MAX_NAME) return `Tên dài tối đa ${MAX_NAME} ký tự.`;
  const lower = clean.toLocaleLowerCase('vi');
  const taken = [BUILTIN, ...presets].some((p) => p.id !== exceptId && p.name.toLocaleLowerCase('vi') === lower);
  return taken ? `Đã có cấu hình tên “${clean}”.` : null;
}

export function newPresetId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function loadPresets(): { presets: Preset[]; selectedId: string } {
  try {
    const presets = parsePresets(localStorage.getItem(KEY));
    const selected = localStorage.getItem(SELECTED_KEY);
    return { presets, selectedId: presets.some((p) => p.id === selected) ? selected! : BUILTIN.id };
  } catch {
    return { presets: [], selectedId: BUILTIN.id }; // trình duyệt chặn lưu trữ
  }
}

export function savePresets(presets: Preset[], selectedId: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(presets));
    localStorage.setItem(SELECTED_KEY, selectedId);
  } catch {
    /* bỏ qua */
  }
}
