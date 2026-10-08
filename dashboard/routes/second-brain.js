// Second brain (spec §18.5.4) — chỉ Quản trị, chỉ khi bật bằng ZALO_SECOND_BRAIN_URL trên máy Linux: xem/tìm kho OpenViking
// trên cùng máy, thêm ghi chú mới (ghi Nhật ký). `/api/features` cho thanh bên biết có hiện mục này không.
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';

export function secondBrainRoutes({ secondBrain, activity }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const fail = (res, err) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status !== 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: 'Lỗi bên trong dashboard — xem nhật ký dịch vụ.' });
  };
  // Tính năng bật theo cấu hình — mọi người đăng nhập hỏi được, nhưng chỉ Quản trị nhận `true`.
  r.get('/features', requireAuth, (req, res) => {
    let on = false;
    try { on = req.user.role === 'admin' && secondBrain.status().enabled; } catch { /* lỗi đọc cấu hình = tắt */ }
    res.json({ ok: true, secondBrain: on });
  });
  r.get('/admin/second-brain/status', ...guard, (req, res) => { try { res.json({ ok: true, ...secondBrain.status() }); } catch (err) { fail(res, err); } });
  r.get('/admin/second-brain/roots', ...guard, (req, res) => { try { res.json({ ok: true, roots: secondBrain.roots() }); } catch (err) { fail(res, err); } });
  r.get('/admin/second-brain/list', ...guard, async (req, res) => { try { res.json({ ok: true, entries: await secondBrain.list(String(req.query.uri ?? '')) }); } catch (err) { fail(res, err); } });
  r.get('/admin/second-brain/read', ...guard, async (req, res) => { try { res.json({ ok: true, text: await secondBrain.read(String(req.query.uri ?? '')) }); } catch (err) { fail(res, err); } });
  r.get('/admin/second-brain/search', ...guard, async (req, res) => { try { res.json({ ok: true, hits: await secondBrain.search(req.query.q) }); } catch (err) { fail(res, err); } });
  r.post('/admin/second-brain/notes', ...guard, async (req, res) => {
    try {
      const uri = await secondBrain.addNote(req.body || {});
      try { activity.append({ actor: req.user.username, action: 'second_brain_note', detail: uri }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
      res.json({ ok: true, uri });
    } catch (err) { fail(res, err); }
  });
  return r;
}
