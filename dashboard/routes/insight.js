// Insight nhóm (spec §18.5) — cả hai vai trò, chỉ đọc lịch sử. Tóm tắt chủ đề bằng AI: thêm ở Task 9.
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { INSIGHT_DAYS } from '../lib/insight.js';
import { failStore } from '../lib/route-errors.js';
import { fallbackName } from '../lib/thread-names.js';

export function insightRoutes({ store, threadNames }) {
  const r = express.Router();
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
  return r;
}
