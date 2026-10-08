/**
 * Bạn bè, lời mời kết bạn và lời nhắc Zalo cho dashboard (spec §18.4). Dashboard không bao giờ chạm Zalo trực
 * tiếp — mọi lời gọi đi qua /control/* (control-api.js) rồi tới đây. Đọc thì gọi thẳng zca-js (danh sách bạn
 * đệm 10 phút); ghi (đồng ý/từ chối kết bạn, xoá lời nhắc) xin lượt từ bộ giới hạn nhịp như lệnh thường và
 * để lại một dòng audit_log `actor_role="dashboard"` mang tên người dùng dashboard.
 */

export const ZALO_UID = /^[1-9]\d{14,21}$/;
export const THREAD_ID = /^\d{1,32}$/;
export const REMINDER_ID = /^[\w-]{1,64}$/;
const FRIENDS_TTL_MS = 10 * 60_000;
const MAX_FRIENDS = 5000;
const MAX_REMINDERS = 50;

const text = (v, max = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Một người bạn từ `getAllFriends` → `{ uid, name, zaloName }`; UID lạ thì null. */
export function normalizeFriend(u) {
  const uid = String(u?.userId ?? '');
  if (!ZALO_UID.test(uid)) return null;
  return { uid, name: text(u.displayName || u.zaloName), zaloName: text(u.zaloName) };
}

/** Lời mời người khác gửi tới bot (`getFriendRecommendations`, recommType 2) → `{ uid, name, message, at }`. */
export function normalizeRequests(res) {
  const items = Array.isArray(res?.recommItems) ? res.recommItems : [];
  return items.map((it) => it?.dataInfo).filter((d) => d && d.recommType === 2 && ZALO_UID.test(String(d.userId ?? '')))
    .map((d) => ({
      uid: String(d.userId), name: text(d.displayName || d.zaloName), message: text(d.recommInfo?.message, 300),
      at: Number.isFinite(d.recommTime) ? d.recommTime : null,
    }));
}

/** Lời nhắc của một hội thoại (`getListReminder`): nhóm dùng `id`, tin riêng dùng `reminderId`. */
export function normalizeReminder(r, selfUid) {
  const id = String(r?.reminderId ?? r?.id ?? '');
  if (!REMINDER_ID.test(id)) return null;
  const creatorUid = String(r.creatorId ?? r.creatorUid ?? '');
  return {
    id, title: text(r.params?.title, 300), startAt: Number(r.startTime) || null, repeat: Number(r.repeat) || 0,
    creatorUid, mine: Boolean(selfUid) && creatorUid === String(selfUid), createdAt: Number(r.createTime) || null,
  };
}

const bad = (message) => Object.assign(new Error(message), { validation: true });

export function checkThread(threadId, threadType) {
  if (!THREAD_ID.test(String(threadId ?? ''))) throw bad('threadId không hợp lệ');
  if (threadType !== 0 && threadType !== 1) throw bad('threadType phải là 0 hoặc 1');
}

/**
 * @param {{ getApi: () => object|null, acquire?: () => Promise<void>,
 *   audit?: (meta: {action: string, actor: string, threadId: string, threadType: number}, fn: () => Promise<any>) => Promise<any>,
 *   now?: () => number }} deps
 */
export function createZaloDirectory({ getApi, acquire = async () => {}, audit = async (_meta, fn) => fn(), now = Date.now }) {
  let friendsCache = null; // { at, list }
  const api = () => {
    const a = getApi();
    if (!a) throw new Error('Zalo chưa đăng nhập');
    return a;
  };

  return {
    async friends({ fresh = false } = {}) {
      if (!fresh && friendsCache && now() - friendsCache.at < FRIENDS_TTL_MS) return friendsCache.list;
      const raw = await api().getAllFriends(MAX_FRIENDS, 1);
      const list = (Array.isArray(raw) ? raw : []).map(normalizeFriend).filter(Boolean);
      friendsCache = { at: now(), list };
      return list;
    },
    async friendRequests() {
      return normalizeRequests(await api().getFriendRecommendations());
    },
    async answerFriendRequest({ uid, accept, actor }) {
      if (!ZALO_UID.test(String(uid ?? ''))) throw bad('UID Zalo không hợp lệ');
      if (typeof accept !== 'boolean') throw bad('accept phải là true/false');
      const a = api();
      await audit({ action: accept ? 'dashboard_friend_accept' : 'dashboard_friend_reject', actor, threadId: String(uid), threadType: 0 }, async () => {
        await acquire();
        if (accept) await a.acceptFriendRequest(String(uid)); else await a.rejectFriendRequest(String(uid));
      });
      friendsCache = null;
      return {};
    },
    async reminders({ threadId, threadType }) {
      checkThread(threadId, threadType);
      const a = api();
      const raw = await a.getListReminder({ page: 1, count: MAX_REMINDERS }, String(threadId), threadType);
      const self = typeof a.getOwnId === 'function' ? a.getOwnId() : '';
      return (Array.isArray(raw) ? raw : []).map((r) => normalizeReminder(r, self)).filter(Boolean);
    },
    async removeReminder({ reminderId, threadId, threadType, actor }) {
      checkThread(threadId, threadType);
      if (!REMINDER_ID.test(String(reminderId ?? ''))) throw bad('Mã lời nhắc không hợp lệ');
      const a = api();
      await audit({ action: 'dashboard_reminder_remove', actor, threadId: String(threadId), threadType }, async () => {
        await acquire();
        await a.removeReminder(String(reminderId), String(threadId), threadType);
      });
      return {};
    },
  };
}
