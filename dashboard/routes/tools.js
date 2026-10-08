// Công cụ (spec §18.6) — chỉ Quản trị. Tắt riêng công cụ công khai cho người không phải chủ nhân: hiệu lực ngay
// (plugin đọc permissions.json theo mtime). Công cụ MCP mở cho thành viên theo ZALO_PUBLIC_MCP: chỉ xem ở đây.
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';
import { parseToolsOff, readManifest } from '../lib/tools-catalog.js';

export function toolRoutes({ permissions, toolsManifestFile, publicMcp = () => '', activity }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const view = () => {
    const manifest = readManifest(toolsManifestFile);
    const off = new Set(permissions.get().toolsOff);
    return {
      ok: true, available: Boolean(manifest), generatedAt: manifest?.generatedAt ?? null,
      tools: (manifest?.tools || []).map((t) => ({ ...t, off: off.has(t.name) })),
      publicMcp: String(publicMcp() || '').split(',').map((s) => s.trim()).filter(Boolean),
    };
  };
  r.get('/admin/tools', ...guard, (req, res) => {
    try { res.json(view()); } catch (err) { console.error('[dashboard]', err); res.status(500).json({ ok: false, error: 'Chưa đọc được danh sách công cụ — tải lại trang.' }); }
  });
  r.put('/admin/tools', ...guard, (req, res) => {
    try {
      const before = new Set(permissions.get().toolsOff);
      const off = parseToolsOff(req.body, readManifest(toolsManifestFile));
      permissions.setToolsOff(off);
      const added = off.filter((n) => !before.has(n)); const removed = [...before].filter((n) => !off.includes(n));
      try {
        activity.append({ actor: req.user.username, action: 'tools_off', detail: [added.length && `tắt: ${added.join(', ')}`, removed.length && `bật lại: ${removed.join(', ')}`].filter(Boolean).join(' · ') || 'không đổi' });
      } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
      res.json(view());
    } catch (err) {
      if (err?.statusCode === 400 || err?.name === 'InvalidPermissions') return res.status(400).json({ ok: false, error: err.message });
      console.error('[dashboard]', err);
      res.status(500).json({ ok: false, error: 'Chưa lưu được — thử lại, nếu vẫn lỗi hãy báo người cài đặt.' });
    }
  });
  return r;
}
