// Kho tri thức (spec §18.5) — cả hai vai trò: xem, tải lên (≤ 10 MB, docx/pdf/md/txt), xoá tệp đã tải lên từ dashboard.
// Tải lên gửi thân nhị phân (application/octet-stream) + tên tệp ở X-File-Name (encodeURIComponent) — không base64.
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES } from '../lib/kb-store.js';

export function kbRoutes({ kb, activity }) {
  const r = express.Router();
  const fail = (res, err, fallback) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : (err?.type === 'entity.too.large' ? 413 : 500);
    if (status === 413) return res.status(413).json({ ok: false, error: 'Tệp quá 10 MB — chia nhỏ hoặc nén lại rồi tải lên.' });
    if (status >= 400 && status < 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: fallback });
  };
  const log = (req, action, detail) => {
    try { activity.append({ actor: req.user.username, action, detail }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
  };

  r.get('/kb', requireAuth, async (req, res) => {
    try { res.json({ ok: true, ...kb.info(), ...(await kb.list({ fresh: req.query.fresh === '1' })), uploadTypes: UPLOAD_TYPES, maxBytes: MAX_UPLOAD_BYTES }); } catch (err) { fail(res, err, 'Chưa đọc được kho tri thức — thử lại sau ít phút.'); }
  });

  r.post('/kb/upload', requireAuth, express.raw({ type: 'application/octet-stream', limit: MAX_UPLOAD_BYTES }), (req, res) => {
    try {
      let name = '';
      try { name = decodeURIComponent(String(req.get('x-file-name') || '')); } catch { /* tên hỏng → lỗi bên dưới */ }
      if (!Buffer.isBuffer(req.body)) return res.status(400).json({ ok: false, error: 'Chưa nhận được tệp — chọn lại tệp rồi tải lên.' });
      const path = kb.upload(name, req.body);
      log(req, 'kb_upload', path);
      res.json({ ok: true, path });
    } catch (err) { fail(res, err, 'Chưa tải lên được — thử lại, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });

  r.delete('/kb/file', requireAuth, (req, res) => {
    try {
      const path = String(req.body?.path ?? '');
      kb.remove(path);
      log(req, 'kb_delete', path);
      res.json({ ok: true });
    } catch (err) { fail(res, err, 'Chưa xoá được — thử lại.'); }
  });

  // Lỗi của express.raw (quá cỡ) đi qua đây thay vì câu chung của app.
  r.use('/kb', (err, req, res, next) => (err?.type === 'entity.too.large' ? fail(res, err, '') : next(err)));
  return r;
}
