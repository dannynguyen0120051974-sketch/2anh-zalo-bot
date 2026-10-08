/**
 * Liên hệ (spec §18.4): gộp ba nguồn về một danh sách theo UID Zalo —
 *   bạn bè của bot (kết nối Zalo, /control/friends), người đã nhắn riêng với bot (lịch sử SQLite),
 *   hồ sơ trong sổ người quen (people.json).
 * Mỗi nguồn hỏng thì vẫn trả phần còn lại kèm cờ lỗi để trang ghi rõ.
 */
import { ZALO_UID } from './users.js';
import { fold } from '../public/fold.js';

export const CONTACT_KINDS = ['all', 'friend', 'dm', 'profile'];

/** @returns {Array<{uid, name, friend: boolean, lastDmAt: number|null, profile: {name, note}|null, owner: boolean}>} */
export function mergeContacts({ friends = [], dmPeers = [], people = [], owners = [] }) {
  const map = new Map();
  const get = (uid) => {
    if (!map.has(uid)) map.set(uid, { uid, name: '', friend: false, lastDmAt: null, profile: null, owner: owners.includes(uid) });
    return map.get(uid);
  };
  for (const f of friends) if (ZALO_UID.test(f.uid)) { const c = get(f.uid); c.friend = true; c.name ||= f.name; }
  for (const d of dmPeers) if (ZALO_UID.test(d.uid)) { const c = get(d.uid); c.lastDmAt = d.lastAtMs ?? null; c.name ||= d.name; }
  for (const p of people) if (ZALO_UID.test(p.uid)) { const c = get(p.uid); c.profile = { name: p.name, note: p.note }; c.name ||= p.name; }
  return [...map.values()].sort((a, b) => (b.lastDmAt || 0) - (a.lastDmAt || 0) || a.name.localeCompare(b.name, 'vi'));
}

/** Lọc theo loại và chữ (không dấu, theo tên, UID, ghi chú hồ sơ). */
export function filterContacts(list, { kind = 'all', q = '' } = {}) {
  const needle = fold(q).trim();
  return list.filter((c) => (kind === 'all' || (kind === 'friend' && c.friend) || (kind === 'dm' && c.lastDmAt) || (kind === 'profile' && c.profile))
    && (!needle || fold(`${c.name} ${c.uid} ${c.profile?.name || ''} ${c.profile?.note || ''}`).includes(needle)));
}
