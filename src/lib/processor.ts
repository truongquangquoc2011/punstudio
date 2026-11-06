import type { RepairOptions } from '../core/load';
import type { WheelSpec } from '../core/wheel';
import type { WorkerResponse } from './protocol';

type Result = Extract<WorkerResponse, { type: 'result' }>;

/** Gửi việc cho worker; chỉ nhận kết quả của lần gọi mới nhất (bấm liên tiếp không bị kết quả cũ đè lên). */
export function createProcessor() {
  const worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
  let seq = 0;
  const pending = new Map<number, { resolve: (r: Result) => void; reject: (e: Error) => void; onStage?: (stage: string) => void }>();
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'progress') {
      p.onStage?.(msg.stage);
      return;
    }
    pending.delete(msg.id);
    if (msg.type === 'error') p.reject(new Error(msg.message));
    else p.resolve(msg);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Bộ xử lý bị lỗi.'));
    pending.clear();
  };
  return {
    run(buffer: ArrayBuffer, spec: WheelSpec, flip: boolean, repair: RepairOptions, fileId: number, onStage?: (stage: string) => void): Promise<Result> {
      const id = ++seq;
      for (const [old, p] of pending) {
        if (old < id) p.reject(new DOMException('superseded', 'AbortError'));
      }
      pending.clear();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onStage });
        // Gửi bản sao: file gốc còn dùng lại khi đổi thông số.
        worker.postMessage({ id, buffer: buffer.slice(0), spec, flip, repair, fileId });
      });
    },
    dispose() {
      worker.terminate();
    },
  };
}
