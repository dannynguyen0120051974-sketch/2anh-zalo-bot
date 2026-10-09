// Theo dõi agent (spec §18.6) — chỉ Quản trị, chỉ đọc state.db của Hermes. Tên nhóm/người lấy như Phiên chat.
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';
import { fallbackName } from '../lib/thread-names.js';

export function traceRoutes({ agentTrace, threadNames }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const fail = (res, err) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status !== 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: 'Chưa đọc được dữ liệu của trợ lý (state.db đang bận hoặc đổi cấu trúc) — thử lại sau ít phút.' });
  };
  r.get('/admin/trace/sessions', ...guard, async (req, res) => {
    try {
      const list = agentTrace.sessions({ source: String(req.query.source || 'zalo'), chat: String(req.query.chat || ''), limit: req.query.limit, before: req.query.before });
      let names = new Map();
      try { names = await threadNames.load(); } catch { /* tên dự phòng */ }
      res.json({ ok: true, sessions: list.map((s) => ({ ...s, chatName: s.chatId ? names.get(s.chatId) || fallbackName(s.chatId, s.chatType === 'group' ? 1 : 0) : '' })) });
    } catch (err) { fail(res, err); }
  });
  // Trang gọn: mỗi cuộc trò chuyện một dòng (gộp phiên, bỏ phiên trống), lượt đi ngược qua các phiên.
  r.get('/admin/trace/chats', ...guard, async (req, res) => {
    try {
      const list = agentTrace.chats({ source: String(req.query.source || 'zalo'), limit: req.query.limit, before: req.query.before });
      let names = new Map();
      try { names = await threadNames.load(); } catch { /* tên dự phòng */ }
      res.json({ ok: true, chats: list.map((c) => ({ ...c, chatName: c.chatId ? names.get(c.chatId) || fallbackName(c.chatId, c.chatType === 'group' ? 1 : 0) : '' })) });
    } catch (err) { fail(res, err); }
  });
  r.get('/admin/trace/chats/:key/turns', ...guard, (req, res) => {
    try { res.json({ ok: true, turns: agentTrace.chatTurns(req.params.key, { limit: req.query.limit }) }); } catch (err) { fail(res, err); }
  });
  r.get('/admin/trace/sessions/:id/turns', ...guard, (req, res) => {
    try { res.json({ ok: true, turns: agentTrace.turns(req.params.id, { limit: req.query.limit }) }); } catch (err) { fail(res, err); }
  });
  return r;
}
