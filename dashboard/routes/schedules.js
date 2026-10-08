// Lịch hẹn (spec §18.4) — cả hai vai trò. Việc hẹn giờ: lệnh `hermes cron` (ghi Nhật ký dashboard). Lời nhắc Zalo:
// qua kết nối Zalo (ghi audit_log ở đó). Tên nhóm lấy từ danh bạ nhóm như Phiên chat.
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { CRON_ACTIONS } from '../lib/schedules.js';
import { fallbackName } from '../lib/thread-names.js';
import { failSidecar } from '../lib/route-errors.js';

const ACTION_LOG = { pause: 'cron_pause', resume: 'cron_resume', remove: 'cron_remove' };

export function scheduleRoutes({ schedules, sidecar, threadNames, activity }) {
  const r = express.Router();

  r.get('/schedules', requireAuth, async (req, res) => {
    let jobs = []; let cronError = '';
    try { jobs = schedules.list(); } catch (err) {
      console.error('[dashboard] đọc jobs.json lỗi:', err?.message || err);
      cronError = 'Chưa đọc được danh sách việc hẹn giờ của trợ lý — thử lại sau ít phút.';
    }
    let names = new Map();
    try { names = await threadNames.load(); } catch { /* không có tên nhóm: dùng tên dự phòng */ }
    res.json({ ok: true, cronError, jobs: jobs.map((j) => ({ ...j, targetName: names.get(j.target) || fallbackName(j.target, j.kind === 'group' ? 1 : 0) })) });
  });

  r.post('/schedules/cron/:id/:action', requireAuth, async (req, res) => {
    const { id, action } = req.params;
    if (!CRON_ACTIONS.includes(action)) return res.status(400).json({ ok: false, error: 'Thao tác không hợp lệ — tải lại trang.' });
    try {
      const job = await schedules.cron(action, id);
      try { activity.append({ actor: req.user.username, action: ACTION_LOG[action], detail: job.name || id }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
      res.json({ ok: true });
    } catch (err) {
      const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      try { activity.append({ actor: req.user.username, action: ACTION_LOG[action], detail: id, ok: false }); } catch { /* bỏ qua */ }
      res.status(status).json({ ok: false, error: status === 500 ? 'Lỗi bên trong dashboard — xem nhật ký dịch vụ.' : err.message });
    }
  });

  r.get('/schedules/reminders', requireAuth, async (req, res) => {
    const threadId = String(req.query.threadId ?? '');
    const threadType = Number(req.query.threadType);
    if (!/^\d{1,32}$/.test(threadId) || (threadType !== 0 && threadType !== 1)) return res.status(400).json({ ok: false, error: 'Chọn lại hội thoại.' });
    try { res.json({ ok: true, reminders: await sidecar.reminders({ threadId, threadType }) }); } catch (err) { failSidecar(res, err); }
  });

  r.post('/schedules/reminders/remove', requireAuth, async (req, res) => {
    const { reminderId, threadId, threadType } = req.body || {};
    try {
      await sidecar.removeReminder({ reminderId: String(reminderId ?? ''), threadId: String(threadId ?? ''), threadType, actor: req.user.username });
      res.json({ ok: true });
    } catch (err) { failSidecar(res, err); }
  });
  return r;
}
