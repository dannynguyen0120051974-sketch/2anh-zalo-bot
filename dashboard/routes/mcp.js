// Kết nối MCP (spec §18.6) — chỉ Quản trị: xem, bật/tắt (cần khởi động lại trợ lý). Không có route thêm máy chủ.
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';

export function mcpRoutes({ mcpServers, restartFlags, activity }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const fail = (res, err) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status !== 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: 'Chưa đọc/ghi được config.yaml — thử lại, nếu vẫn lỗi hãy báo người cài đặt.' });
  };
  r.get('/admin/mcp', ...guard, async (req, res) => { try { res.json({ ok: true, servers: await mcpServers.list() }); } catch (err) { fail(res, err); } });
  r.put('/admin/mcp/:name', ...guard, async (req, res) => {
    try {
      const enabled = req.body?.enabled;
      if (mcpServers.setEnabled(req.params.name, enabled)) {
        restartFlags.mark('assistant', `Kết nối MCP: ${req.params.name}`);
        try { activity.append({ actor: req.user.username, action: enabled ? 'mcp_enable' : 'mcp_disable', detail: req.params.name }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
      }
      res.json({ ok: true, servers: await mcpServers.list() });
    } catch (err) { fail(res, err); }
  });
  return r;
}
