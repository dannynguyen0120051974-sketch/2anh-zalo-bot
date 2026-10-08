import test from 'node:test';
import assert from 'node:assert/strict';
import { createZaloDirectory, normalizeFriend, normalizeReminder, normalizeRequests } from './zalo-directory.js';

const A = '1111111111111111111';
const B = '2222222222222222222';

function fakeApi(over = {}) {
  const calls = [];
  return {
    calls,
    getAllFriends: async (count, page) => { calls.push(['friends', count, page]); return [{ userId: A, displayName: ' Cô  Lan ', zaloName: 'lan' }, { userId: 'abc' }]; },
    getFriendRecommendations: async () => ({ recommItems: [
      { dataInfo: { userId: B, displayName: 'Minh', recommType: 2, recommTime: 5, recommInfo: { message: 'Chào bot' } } },
      { dataInfo: { userId: A, displayName: 'Gợi ý', recommType: 1 } },
    ] }),
    acceptFriendRequest: async (uid) => { calls.push(['accept', uid]); return ''; },
    rejectFriendRequest: async (uid) => { calls.push(['reject', uid]); return ''; },
    getListReminder: async (opts, threadId, type) => { calls.push(['list', opts, threadId, type]); return [
      { id: '77', creatorId: 'bot', params: { title: 'Họp tổ' }, startTime: 100, repeat: 1, createTime: 50 },
      { reminderId: '../x', params: { title: 'lạ' } },
    ]; },
    removeReminder: async (id, threadId, type) => { calls.push(['remove', id, threadId, type]); return ''; },
    getOwnId: () => 'bot',
    ...over,
  };
}

test('chuẩn hoá: bạn bè, lời mời (chỉ loại 2), lời nhắc (id nhóm/riêng, của bot hay không)', () => {
  assert.deepEqual(normalizeFriend({ userId: A, displayName: '', zaloName: 'lan' }), { uid: A, name: 'lan', zaloName: 'lan' });
  assert.equal(normalizeFriend({ userId: '0123' }), null);
  assert.deepEqual(normalizeRequests({ recommItems: [{ dataInfo: { userId: B, zaloName: 'M', recommType: 2 } }] }),
    [{ uid: B, name: 'M', message: '', at: null }]);
  assert.deepEqual(normalizeRequests(null), []);
  assert.deepEqual(normalizeReminder({ reminderId: 'r1', creatorUid: 'u', params: { title: 'X' }, startTime: 9 }, 'bot'),
    { id: 'r1', title: 'X', startAt: 9, repeat: 0, creatorUid: 'u', mine: false, createdAt: null });
  assert.equal(normalizeReminder({ id: 'a b' }, 'bot'), null);
});

test('danh sách bạn đệm 10 phút; fresh thì đọc lại; đồng ý kết bạn xoá đệm', async () => {
  const api = fakeApi();
  let clock = 0;
  const dir = createZaloDirectory({ getApi: () => api, now: () => clock });
  assert.deepEqual(await dir.friends(), [{ uid: A, name: 'Cô Lan', zaloName: 'lan' }]);
  clock = 60_000; await dir.friends();
  assert.equal(api.calls.filter((c) => c[0] === 'friends').length, 1);
  await dir.friends({ fresh: true });
  assert.equal(api.calls.filter((c) => c[0] === 'friends').length, 2);
  await dir.answerFriendRequest({ uid: B, accept: true, actor: 'anh' });
  await dir.friends();
  assert.equal(api.calls.filter((c) => c[0] === 'friends').length, 3);
});

test('đồng ý/từ chối: kiểm UID, xin lượt, ghi audit đúng hành động và người làm', async () => {
  const api = fakeApi();
  const audits = []; let acquired = 0;
  const dir = createZaloDirectory({
    getApi: () => api, acquire: async () => { acquired += 1; },
    audit: async (meta, fn) => { audits.push(meta); return fn(); },
  });
  await dir.answerFriendRequest({ uid: B, accept: false, actor: 'khach' });
  assert.deepEqual(api.calls.at(-1), ['reject', B]);
  assert.deepEqual(audits, [{ action: 'dashboard_friend_reject', actor: 'khach', threadId: B, threadType: 0 }]);
  assert.equal(acquired, 1);
  await assert.rejects(dir.answerFriendRequest({ uid: '123', accept: true, actor: 'a' }), (e) => e.validation === true);
  await assert.rejects(dir.answerFriendRequest({ uid: B, accept: 'yes', actor: 'a' }), (e) => e.validation === true);
});

test('lời nhắc: liệt kê theo hội thoại, bỏ mã lạ; xoá kiểm mã + hội thoại; Zalo chưa đăng nhập thì báo lỗi', async () => {
  const api = fakeApi();
  const audits = [];
  const dir = createZaloDirectory({ getApi: () => api, audit: async (meta, fn) => { audits.push(meta.action); return fn(); } });
  const list = await dir.reminders({ threadId: '555', threadType: 1 });
  assert.deepEqual(list, [{ id: '77', title: 'Họp tổ', startAt: 100, repeat: 1, creatorUid: 'bot', mine: true, createdAt: 50 }]);
  assert.deepEqual(api.calls.at(-1), ['list', { page: 1, count: 50 }, '555', 1]);
  await dir.removeReminder({ reminderId: '77', threadId: '555', threadType: 1, actor: 'anh' });
  assert.deepEqual(api.calls.at(-1), ['remove', '77', '555', 1]);
  assert.deepEqual(audits, ['dashboard_reminder_remove']);
  await assert.rejects(dir.removeReminder({ reminderId: '../x', threadId: '555', threadType: 1, actor: 'a' }), (e) => e.validation);
  await assert.rejects(dir.reminders({ threadId: 'abc', threadType: 1 }), (e) => e.validation);
  await assert.rejects(dir.reminders({ threadId: '1', threadType: 2 }), (e) => e.validation);
  await assert.rejects(createZaloDirectory({ getApi: () => null }).friends(), /Zalo chưa đăng nhập/);
});
