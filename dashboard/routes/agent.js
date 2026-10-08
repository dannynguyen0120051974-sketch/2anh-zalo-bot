// Agent (spec §18.6) — chỉ Quản trị: model (hiệu lực ngay), mức suy nghĩ + tính cách (cần khởi động lại trợ lý).
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';
import { REASONING } from '../lib/agent-config.js';

export function agentRoutes({ agentConfig, soul, restartFlags, activity }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const fail = (res, err, fallback) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status !== 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: fallback });
  };
  const log = (req, action, detail) => { try { activity.append({ actor: req.user.username, action, detail }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); } };
  const view = () => ({ ok: true, ...agentConfig.view(), reasoningChoices: REASONING, soul: soul.view() });

  r.get('/admin/agent', ...guard, (req, res) => { try { res.json(view()); } catch (err) { fail(res, err, 'Chưa đọc được cài đặt trợ lý.'); } });
  r.get('/admin/agent/models', ...guard, async (req, res) => { try { res.json({ ok: true, models: await agentConfig.models() }); } catch (err) { fail(res, err, 'Chưa lấy được danh sách model.'); } });

  r.put('/admin/agent/model', ...guard, async (req, res) => {
    try {
      const before = agentConfig.view().model;
      if (await agentConfig.setModel(req.body?.model)) log(req, 'agent_model', `${before} → ${req.body.model}`);
      res.json(view());
    } catch (err) { fail(res, err, 'Chưa đổi được model — thử lại.'); }
  });
  r.put('/admin/agent/reasoning', ...guard, (req, res) => {
    try {
      if (agentConfig.setReasoning(req.body?.value)) { restartFlags.mark('assistant', 'Mức suy nghĩ'); log(req, 'agent_reasoning', req.body.value); }
      res.json(view());
    } catch (err) { fail(res, err, 'Chưa lưu được — thử lại.'); }
  });
  r.put('/admin/agent/soul', ...guard, (req, res) => {
    try {
      if (soul.save(req.body?.text, req.user.username)) { restartFlags.mark('assistant', 'Tính cách (SOUL.md)'); log(req, 'agent_soul', `${String(req.body.text).length} ký tự`); }
      res.json(view());
    } catch (err) { fail(res, err, 'Chưa lưu được tính cách — thử lại.'); }
  });
  r.get('/admin/agent/soul/history/:id', ...guard, (req, res) => { try { res.json({ ok: true, text: soul.snapshot(req.params.id) }); } catch (err) { fail(res, err, 'Chưa đọc được bản cũ.'); } });
  r.post('/admin/agent/soul/restore/:id', ...guard, (req, res) => {
    try {
      if (soul.restore(req.params.id, req.user.username)) { restartFlags.mark('assistant', 'Tính cách (SOUL.md)'); log(req, 'agent_soul_restore', req.params.id === 'original' ? 'bản gốc' : req.params.id); }
      res.json(view());
    } catch (err) { fail(res, err, 'Chưa khôi phục được — thử lại.'); }
  });
  return r;
}
