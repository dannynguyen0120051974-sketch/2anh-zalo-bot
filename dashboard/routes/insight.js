// Insight nhóm (spec §18.5) — cả hai vai trò, chỉ đọc lịch sử. Tóm tắt chủ đề bằng AI qua hàng đợi tệp (lib/insight-ai.js).
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { INSIGHT_DAYS } from '../lib/insight.js';
import { failStore } from '../lib/route-errors.js';
import { fallbackName } from '../lib/thread-names.js';

export function insightRoutes({ store, threadNames, insightAi, activity }) {
  const r = express.Router();
  const fail = (res, err, fallback) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status >= 400 && status < 500) return res.status(status).json({ ok: false, error: err.message });
    return failStore(res, err, fallback);
  };
  r.get('/insight/groups/:id', requireAuth, async (req, res) => {
    const id = req.params.id;
    if (!/^\d{1,32}$/.test(id)) return res.status(400).json({ ok: false, error: 'Nhóm không hợp lệ — chọn lại từ danh sách.' });
    const days = INSIGHT_DAYS.includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    try {
      if (!store.available()) return res.json({ ok: true, unavailable: true });
      const data = store.groupInsight(id, { days });
      let name = '';
      try { name = (await threadNames.load()).get(id) || ''; } catch { /* dùng tên dự phòng */ }
      res.json({ ok: true, name: name || fallbackName(id, 1), ...(data || { empty: true }) });
    } catch (err) { failStore(res, err, 'Chưa tính được số liệu nhóm — thử lại sau ít phút.'); }
  });

  // Tóm tắt chủ đề bằng AI: bấm nút mới chạy (tốn lượt AI), plugin giữ trần lượt/ngày.
  r.post('/insight/groups/:id/summary', requireAuth, async (req, res) => {
    const id = req.params.id;
    if (!insightAi) return res.status(404).json({ ok: false, error: 'Bản cài này chưa có tóm tắt bằng AI.' });
    if (!/^\d{1,32}$/.test(id)) return res.status(400).json({ ok: false, error: 'Nhóm không hợp lệ — chọn lại từ danh sách.' });
    const days = INSIGHT_DAYS.includes(Number(req.body?.days)) ? Number(req.body.days) : 7;
    try {
      if (!store.available()) return res.status(400).json({ ok: false, error: 'Chưa có lịch sử trò chuyện để tóm tắt.' });
      let name = '';
      try { name = (await threadNames.load()).get(id) || ''; } catch { /* tên dự phòng */ }
      const requestId = insightAi.request({ groupId: id, groupName: name || fallbackName(id, 1), days, transcript: store.groupTranscript(id, { days }), by: req.user.username });
      try { activity.append({ actor: req.user.username, action: 'insight_summary', detail: `${name || fallbackName(id, 1)} · ${days} ngày` }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
      res.json({ ok: true, id: requestId });
    } catch (err) { fail(res, err, 'Chưa gửi được yêu cầu tóm tắt — thử lại.'); }
  });

  r.get('/insight/summary/:rid', requireAuth, (req, res) => {
    if (!insightAi) return res.status(404).json({ ok: false, error: 'Bản cài này chưa có tóm tắt bằng AI.' });
    try { res.json({ ok: true, ...insightAi.result(req.params.rid) }); } catch (err) { fail(res, err, 'Chưa đọc được kết quả — thử lại.'); }
  });
  return r;
}
