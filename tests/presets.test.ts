import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEC } from '../src/core/wheel';
import { BUILTIN, MAX_NAME, nameError, parsePresets, sameSpec, type Preset } from '../src/lib/presets';

const preset = (id: string, name: string, over = {}): Preset => ({ id, name, spec: { ...DEFAULT_SPEC, ...over } });

describe('cấu hình đã lưu', () => {
  it('đọc lại đúng danh sách đã lưu', () => {
    const list = [preset('a', 'Mâm A', { diameter: 10, bossHeight: 2.5 }), preset('b', 'Mâm B')];
    expect(parsePresets(JSON.stringify(list))).toEqual(list);
  });

  it('dữ liệu hỏng không làm app lỗi', () => {
    expect(parsePresets(null)).toEqual([]);
    expect(parsePresets('không phải json')).toEqual([]);
    expect(parsePresets('{"a":1}')).toEqual([]);
  });

  it('bỏ mục sai, giữ mục đúng', () => {
    const raw = JSON.stringify([
      preset('ok', 'Đúng'),
      { id: 'x', name: 'Thiếu tên hợp lệ', spec: { hole: 99 } }, // lỗ to hơn khối trụ
      { id: 'y', name: '   ', spec: DEFAULT_SPEC },
      { name: 'Không có id', spec: DEFAULT_SPEC },
      preset(BUILTIN.id, 'Giả mạo mặc định'),
      preset('ok', 'Trùng id'),
    ]);
    expect(parsePresets(raw).map((p) => p.name)).toEqual(['Đúng']);
  });

  it('mục lưu từ bản cũ chưa có thông số chiều cao thì dùng tự động', () => {
    const raw = JSON.stringify([{ id: 'old', name: 'Cũ', spec: { diameter: 9, width: 5, hole: 1, boss: 3, wall: 1 } }]);
    const [p] = parsePresets(raw);
    expect(p.spec.diameter).toBe(9);
    expect(p.spec.bossHeight).toBeNull();
    expect(p.spec.wallHeight).toBeNull();
  });

  it('kiểm tra tên: trống, quá dài, trùng', () => {
    const list = [preset('a', 'Mâm A')];
    expect(nameError('  ', list)).toMatch(/nhập tên/);
    expect(nameError('x'.repeat(MAX_NAME + 1), list)).toMatch(/tối đa/);
    expect(nameError('mâm a', list)).toMatch(/Đã có/);
    expect(nameError('mặc định', list)).toMatch(/Đã có/);
    expect(nameError('Mâm B', list)).toBeNull();
    expect(nameError('Mâm A', list, 'a')).toBeNull(); // đổi tên giữ nguyên chính nó
  });

  it('so sánh bộ thông số, kể cả ô tự động', () => {
    expect(sameSpec(DEFAULT_SPEC, { ...DEFAULT_SPEC })).toBe(true);
    expect(sameSpec(DEFAULT_SPEC, { ...DEFAULT_SPEC, bossHeight: 2 })).toBe(false);
  });
});
