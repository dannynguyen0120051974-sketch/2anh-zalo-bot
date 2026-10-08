// Liên hệ (spec §18.4) — cả hai vai trò. Đồng ý/từ chối kết bạn đi qua kết nối Zalo, nơi ghi audit_log có tên
// người dùng dashboard (Nhật ký gộp audit_log), nên route này không ghi activity.jsonl thêm lần nữa.
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { CONTACT_KINDS, filterContacts, mergeContacts } from '../lib/contacts.js';
import { failSidecar } from '../lib/route-errors.js';
import { ZALO_UID } from '../lib/users.js';

const MAX_LIST = 1000;

export function contactRoutes({ sidecar, store, people, owners }) {
  const r = express.Router();

  r.get('/contacts', requireAuth, async (req, res) => {
    const kind = CONTACT_KINDS.includes(req.query.kind) ? req.query.kind : 'all';
    const q = String(req.query.q ?? '').slice(0, 100);
    const errors = {};
    let friends = [];
    try { friends = await sidecar.friends({ fresh: req.query.fresh === '1' }); } catch (err) {
      errors.friends = err?.name === 'SidecarDown' ? 'Kết nối Zalo đang tắt — chưa lấy được danh sách bạn bè.' : 'Zalo chưa trả danh sách bạn bè — thử lại sau ít phút.';
    }
    let dmPeers = [];
    try {
      if (store.available()) {
        dmPeers = store.listConversations().filter((c) => c.threadType === 0).map((c) => ({ uid: c.threadId, name: c.peerName, lastAtMs: c.lastAtMs }));
      }
    } catch { errors.history = 'Chưa đọc được lịch sử nhắn riêng.'; }
    let profiles = [];
    try { profiles = people ? people.list() : []; } catch { errors.people = 'Sổ người quen đang hỏng — xem trang Trí nhớ.'; }
    let ownerUids = [];
    try { ownerUids = owners ? owners.list() : []; } catch { /* không có .env: không đánh dấu chủ nhân */ }
    const all = mergeContacts({ friends, dmPeers, people: profiles, owners: ownerUids });
    const hits = filterContacts(all, { kind, q });
    res.json({
      ok: true, total: all.length, contacts: hits.slice(0, MAX_LIST), truncated: hits.length > MAX_LIST, errors,
      counts: { friend: all.filter((c) => c.friend).length, dm: all.filter((c) => c.lastDmAt).length, profile: all.filter((c) => c.profile).length },
    });
  });

  r.get('/contacts/requests', requireAuth, async (req, res) => {
    try { res.json({ ok: true, requests: await sidecar.friendRequests() }); } catch (err) { failSidecar(res, err); }
  });

  r.post('/contacts/requests/:uid', requireAuth, async (req, res) => {
    const { uid } = req.params;
    const accept = req.body?.accept;
    if (!ZALO_UID.test(uid) || typeof accept !== 'boolean') return res.status(400).json({ ok: false, error: 'Lời mời không hợp lệ — tải lại trang rồi thử lại.' });
    try {
      await sidecar.answerFriendRequest({ uid, accept, actor: req.user.username });
      res.json({ ok: true });
    } catch (err) { failSidecar(res, err); }
  });
  return r;
}
