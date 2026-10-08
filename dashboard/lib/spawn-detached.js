import { EDITABLE_KEYS } from './env-file.js';

// Môi trường cho tiến trình con khởi động lại: không mang theo giá trị cũ của mọi khoá dashboard sửa được
// (chủ nhân + Cấu hình) — con tự nạp lại từ .env Hermes.
export function childEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !EDITABLE_KEYS.has(k)));
}

// Chờ tiến trình con thật sự khởi động (sự kiện 'spawn') hoặc báo lỗi ('error', ví dụ ENOENT)
// trước khi tách rời. Không gắn listener 'error' thì lỗi này làm sập cả dashboard.
export function waitSpawned(child) {
  return new Promise((resolve, reject) => {
    if (typeof child?.once !== 'function') { child?.unref?.(); resolve(); return; }
    child.once('error', reject);
    child.once('spawn', () => { child.removeListener?.('error', reject); child.on?.('error', () => {}); child.unref?.(); resolve(); });
  });
}
