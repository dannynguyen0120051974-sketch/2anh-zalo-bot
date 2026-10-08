/**
 * Cờ "đã đổi cài đặt, chờ khởi động lại" dùng chung cho Agent, Kết nối MCP, Cấu hình (spec §18.6).
 * `<dashboard>/restart-flags.json`: { assistant: { since, rev, reasons: [..] } | null, sidecar: { … } | null }.
 * Dải vàng trên các trang Quản trị đọc cờ này; nút "Khởi động lại" (routes/admin.js) xoá cờ sau khi khởi động lại xong
 * — chỉ khi không có thay đổi mới chen vào trong lúc khởi động lại (`rev` không đổi).
 * Cờ chủ nhân bot cũ (pending-restart.json, owners.js) vẫn giữ nguyên — không trộn hai cơ chế.
 */
import { readJson, writeJsonAtomic } from './json-store.js';

export const TARGETS = ['assistant', 'sidecar'];
const MAX_REASONS = 10;

export function createRestartFlags({ file, now = Date.now }) {
  const read = () => {
    const raw = readJson(file, {});
    return Object.fromEntries(TARGETS.map((t) => {
      const f = raw?.[t];
      return [t, f && Number.isFinite(f.since) && Array.isArray(f.reasons)
        ? { since: f.since, rev: Number.isInteger(f.rev) ? f.rev : 1, reasons: f.reasons.map(String).slice(0, MAX_REASONS) } : null];
    }));
  };
  return {
    get: read,
    /** Đánh dấu cần khởi động lại `target` vì `reason` (vd. "Đổi model"); lý do trùng không ghi lại. */
    mark(target, reason) {
      if (!TARGETS.includes(target)) throw new Error(`restart-flags: đích lạ ${target}`);
      const all = read();
      const cur = all[target] || { since: now(), rev: 0, reasons: [] };
      if (!cur.reasons.includes(reason)) cur.reasons = [...cur.reasons, String(reason)].slice(-MAX_REASONS);
      cur.rev += 1;
      all[target] = cur;
      writeJsonAtomic(file, all);
    },
    /** Xoá cờ nếu `rev` còn bằng `seenRev` (giá trị đọc lúc bắt đầu khởi động lại). Trả true nếu đã xoá. */
    clear(target, seenRev) {
      const all = read();
      if (!all[target] || all[target].rev !== seenRev) return false;
      all[target] = null;
      writeJsonAtomic(file, all);
      return true;
    },
  };
}
