/**
 * Công cụ (spec §18.6, chỉ Quản trị): danh sách công cụ Zalo do plugin ghi lúc nạp (`<HERMES_HOME>/zalo/tools-manifest.json`,
 * zalo_tools/tools.py `write_tools_manifest`). Dashboard chỉ đọc tệp này; tắt/bật công cụ ghi vào `permissions.json`
 * mục `tools.off` (plugin chặn tại `guard_member_tool_call`, có hiệu lực ngay, chủ nhân không bao giờ bị chặn).
 */
import { readFileSync } from 'node:fs';
import { FEATURES, STUDIO_FEATURES, TOOL_NAME, MAX_TOOLS_OFF } from './permissions.js';

export const LEVELS = { zalo_public: 'Mọi người', zalo_owner: 'Chỉ chủ nhân', zalo_cron: 'Việc hẹn giờ', zalo_cron_member: 'Hẹn giờ nhóm' };

/** Nhãn nút điều khiển một công cụ: tên nút ở Phân quyền Bot, "Xưởng tạo sản phẩm", "Luôn bật" hoặc "—". */
export function switchLabel(feature) {
  if (feature === 'always') return 'Luôn bật (không có nút)';
  if (feature === 'studio') return `Xưởng tạo sản phẩm (${STUDIO_FEATURES.map((f) => f.label).join(', ')})`;
  return FEATURES.find((f) => f.key === feature)?.label || '';
}

/** Đọc danh sách công cụ; chưa có tệp (plugin cũ / chưa khởi động lại trợ lý) → null. */
export function readManifest(file) {
  try {
    const m = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(m?.tools)) return null;
    return {
      generatedAt: Number(m.generatedAt) || null,
      tools: m.tools.filter((t) => typeof t?.name === 'string' && TOOL_NAME.test(t.name)).map((t) => ({
        name: t.name, toolset: String(t.toolset || ''), level: LEVELS[t.toolset] || String(t.toolset || ''),
        description: String(t.description || '').slice(0, 400), feature: t.feature || null, switch: switchLabel(t.feature),
        registered: t.registered !== false, dmOnly: Boolean(t.dmOnly), confirm: Boolean(t.confirm),
      })),
    };
  } catch { return null; }
}

/** Công cụ được phép tắt từ dashboard: chỉ công cụ công khai (người ngoài vốn không gọi được công cụ chủ nhân). */
export function parseToolsOff(body, manifest) {
  const off = body?.off;
  if (!Array.isArray(off) || off.length > MAX_TOOLS_OFF) throw Object.assign(new Error('Danh sách không hợp lệ — tải lại trang.'), { statusCode: 400 });
  const pub = new Set((manifest?.tools || []).filter((t) => t.toolset === 'zalo_public').map((t) => t.name));
  for (const n of off) {
    if (!pub.has(n)) throw Object.assign(new Error(`"${String(n).slice(0, 40)}" không phải công cụ công khai — tải lại trang.`), { statusCode: 400 });
  }
  return [...new Set(off)];
}
