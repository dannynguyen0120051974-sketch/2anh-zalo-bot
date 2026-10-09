// Bộ nhớ của trợ lý (spec §18.5) — chỉ Quản trị: đây là phần lời nhắc hệ thống của trợ lý, cùng loại với Agent (§18.6).
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';
import { TARGETS } from '../lib/hermes-memory.js';

export function agentMemoryRoutes({ agentMemory, activity }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const fail = (res, err, fallback) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status >= 400 && status < 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: fallback });
  };
  const target = (req) => (Object.hasOwn(TARGETS, req.params.target) ? req.params.target : null);
  const log = (req, action, t, index) => {
    try { activity.append({ actor: req.user.username, action, detail: `${TARGETS[t].label}, mục ${index + 1}` }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
  };

  r.get('/admin/agent-memory', ...guard, (req, res) => {
    try { res.json({ ok: true, ...agentMemory.view() }); } catch (err) { fail(res, err, 'Chưa đọc được bộ nhớ của trợ lý — tải lại trang.'); }
  });
  r.post('/admin/agent-memory/:target', ...guard, (req, res) => {
    const t = target(req);
    if (!t) return res.status(400).json({ ok: false, error: 'Không có mục bộ nhớ này — tải lại trang.' });
    try {
      agentMemory.add(t, req.body?.text);
      const v = agentMemory.view();
      log(req, 'agent_memory_add', t, v[t].entries.length - 1);
      res.json({ ok: true, ...v });
    } catch (err) { fail(res, err, 'Chưa thêm được — thử lại.'); }
  });
  r.put('/admin/agent-memory/:target/:index', ...guard, (req, res) => {
    const t = target(req); const i = Number(req.params.index);
    if (!t) return res.status(400).json({ ok: false, error: 'Không có mục bộ nhớ này — tải lại trang.' });
    try { agentMemory.replace(t, i, req.body?.old, req.body?.text); log(req, 'agent_memory_edit', t, i); res.json({ ok: true, ...agentMemory.view() }); } catch (err) { fail(res, err, 'Chưa lưu được — thử lại.'); }
  });
  r.delete('/admin/agent-memory/:target/:index', ...guard, (req, res) => {
    const t = target(req); const i = Number(req.params.index);
    if (!t) return res.status(400).json({ ok: false, error: 'Không có mục bộ nhớ này — tải lại trang.' });
    try { agentMemory.remove(t, i, req.body?.old); log(req, 'agent_memory_delete', t, i); res.json({ ok: true, ...agentMemory.view() }); } catch (err) { fail(res, err, 'Chưa xoá được — thử lại.'); }
  });
  return r;
}
