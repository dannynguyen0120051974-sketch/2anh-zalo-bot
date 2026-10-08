// Sổ người quen (spec §18.5) — Quản trị và Chủ bot đều xem/sửa/xoá (§18.2). Mọi lần ghi vào Nhật ký.
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { parsePerson } from '../lib/people-store.js';
import { fold } from '../public/fold.js';
import { ZALO_UID } from '../lib/users.js';

const MAX_LIST = 500;

export function peopleRoutes({ people, activity }) {
  const r = express.Router();
  const fail = (res, err, fallback) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status >= 400 && status < 600 && status !== 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: fallback });
  };
  const log = (req, action, detail) => {
    try { activity.append({ actor: req.user.username, action, detail }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
  };

  r.get('/people', requireAuth, (req, res) => {
    try {
      const q = fold(String(req.query.q ?? '')).trim().slice(0, 100);
      const all = people.list();
      const hits = q ? all.filter((p) => fold(`${p.name} ${p.note} ${p.uid} ${p.fields.map((f) => `${f.key} ${f.value}`).join(' ')}`).includes(q)) : all;
      res.json({ ok: true, total: all.length, people: hits.slice(0, MAX_LIST), truncated: hits.length > MAX_LIST });
    } catch (err) { fail(res, err, 'Chưa đọc được sổ người quen — tải lại trang, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });

  r.put('/people/:uid', requireAuth, (req, res) => {
    try {
      if (!ZALO_UID.test(req.params.uid)) return res.status(400).json({ ok: false, error: 'UID Zalo không hợp lệ — chọn lại người trong danh sách.' });
      const person = people.put(req.params.uid, parsePerson(req.body), req.user.username);
      log(req, 'people_update', person.name || req.params.uid);
      res.json({ ok: true, person });
    } catch (err) { fail(res, err, 'Chưa lưu được hồ sơ — thử lại, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });

  r.delete('/people/:uid', requireAuth, (req, res) => {
    try {
      if (!ZALO_UID.test(req.params.uid)) return res.status(400).json({ ok: false, error: 'UID Zalo không hợp lệ — chọn lại người trong danh sách.' });
      if (!people.remove(req.params.uid)) return res.status(404).json({ ok: false, error: 'Hồ sơ này không còn — tải lại trang.' });
      log(req, 'people_delete', req.params.uid);
      res.json({ ok: true });
    } catch (err) { fail(res, err, 'Chưa xoá được hồ sơ — thử lại, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });
  return r;
}
