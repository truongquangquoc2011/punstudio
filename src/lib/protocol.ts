import type { RepairOptions } from '../core/load';
import type { WheelReport, WheelSpec } from '../core/wheel';

export interface ViewMesh {
  positions: Float32Array; // 9 số / tam giác
  added: Uint8Array; // 1 = phần app thêm vào
}

export interface WorkerRequest {
  id: number;
  buffer: ArrayBuffer;
  spec: WheelSpec;
  flip: boolean;
  repair: RepairOptions;
  /** Tăng khi mở file mới; cùng file + cùng cách sửa thì worker dùng lại kết quả đã sửa. */
  fileId: number;
}

export type WorkerResponse =
  | { type: 'result'; id: number; report: WheelReport; result: ViewMesh; source: ViewMesh; stl: ArrayBuffer; ms: number }
  | { type: 'progress'; id: number; stage: string }
  | { type: 'error'; id: number; message: string };
