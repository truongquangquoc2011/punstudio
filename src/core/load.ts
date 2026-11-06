import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { DEFAULT_REMESH, remesh, surfaceDeviation, type RemeshStage } from './remesh';
import { MeshError, diagnose, toSolid, tryManifold, weld, type Diagnosis } from './repair';

/**
 * Đọc mâm từ STL, tự chọn cách sửa theo mức độ lỗi:
 * - Lưới kín: dùng nguyên, không đụng tới bề mặt.
 * - Lỗi rất ít (≤ 0,2% số cạnh): vá nhẹ, giữ nguyên bề mặt còn lại.
 * - Lỗi nặng, hoặc vá nhẹ không được: đúc lại thành khối đặc mới (xem remesh.ts).
 * Vá nhẹ trên lưới hỏng nặng cho ra lớp vỏ sai hình mà số đo vẫn đẹp, nên không được dùng cho trường hợp đó.
 */

export type RepairMode = 'auto' | 'rebuild';

export interface RepairOptions {
  mode: RepairMode;
  /** Số ô lưới theo chiều dài nhất khi đúc lại. */
  resolution: number;
}

export const DEFAULT_REPAIR: RepairOptions = { mode: 'auto', resolution: DEFAULT_REMESH.resolution };

/** Độ mịn khi đúc lại: càng mịn càng giữ được chi tiết nhỏ nhưng càng lâu. */
export const RESOLUTIONS = [
  { label: 'Nhanh', value: 150 },
  { label: 'Vừa', value: 220 },
  { label: 'Mịn', value: 320 },
];

export interface RepairInfo {
  method: 'none' | 'patch' | 'rebuild';
  diagnosis: Diagnosis;
  /** Chỉ có khi đúc lại. Đơn vị của file gốc. */
  rebuild?: { cell: number; dropped: number; p95: number; max: number; resolution: number };
}

export type LoadStage = RemeshStage | 'check';

export interface LoadedWheel {
  manifold: Manifold;
  repairs: string[];
  info: RepairInfo;
}

const LIGHT_LIMIT = 0.002;

export function loadWheel(
  wasm: ManifoldToplevel,
  soup: Float32Array,
  options: RepairOptions = DEFAULT_REPAIR,
  onStage?: (stage: LoadStage) => void,
): LoadedWheel {
  const mesh = weld(soup);
  const diagnosis = diagnose(mesh);
  const defects = diagnosis.openEdges + diagnosis.multiEdges + diagnosis.flippedEdges;

  if (options.mode === 'auto') {
    const direct = tryManifold(wasm, mesh);
    if (direct) return { manifold: direct, repairs: [], info: { method: 'none', diagnosis } };
    if (defects <= diagnosis.edges * LIGHT_LIMIT) {
      try {
        const { manifold, repairs } = toSolid(wasm, soup);
        return { manifold, repairs, info: { method: 'patch', diagnosis } };
      } catch (e) {
        if (!(e instanceof MeshError)) throw e;
      }
    }
  }

  const { manifold, cell, dropped } = remesh(wasm, soup, { ...DEFAULT_REMESH, resolution: options.resolution }, onStage);
  onStage?.('check');
  const { p95, max } = surfaceDeviation(soup, manifold);
  const repairs: string[] = [];
  if (defects > 0) repairs.push(describe(diagnosis));
  repairs.push('Đúc lại thành khối đặc kín từ bề mặt của file');
  if (dropped) repairs.push(`Bỏ ${dropped} mảnh vụn nhiễu`);
  return { manifold, repairs, info: { method: 'rebuild', diagnosis, rebuild: { cell, dropped, p95, max, resolution: options.resolution } } };
}

function describe(d: Diagnosis): string {
  const parts: string[] = [];
  if (d.openEdges) parts.push(`${d.openEdges} cạnh hở`);
  if (d.multiEdges) parts.push(`${d.multiEdges} cạnh chồng`);
  if (d.flippedEdges) parts.push(`${d.flippedEdges} cạnh lật mặt`);
  return `Lưới lỗi: ${parts.join(', ')}`;
}
