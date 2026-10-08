import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSidecar, chatMsg, loginAs, makeDeps, seedHistory, startApp } from '../test-helpers.js';

const A = '1111111111111111111';
const B = '2222222222222222222';

test('liên hệ: gộp bạn bè + người nhắn riêng; Chủ bot xem được; kết nối Zalo tắt vẫn trả phần còn lại', async (t) => {
  const deps = makeDeps(t);
  seedHistory(deps, { messages: [chatMsg({ threadId: B, threadType: 0, senderUid: B, senderName: 'Minh' })] });
  const { call } = await startApp(t, deps);
  assert.equal((await call('/api/contacts')).status, 401);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const r = await call('/api/contacts', { cookie: owner });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.contacts.map((c) => c.uid).sort(), [A, B]);
  assert.deepEqual(r.json.counts, { friend: 1, dm: 1, profile: 0 });
  assert.deepEqual((await call('/api/contacts?kind=dm', { cookie: owner })).json.contacts.map((c) => c.uid), [B]);

  const down = makeDeps(t, { sidecar: fakeSidecar({ friends: async () => { throw Object.assign(new Error('x'), { name: 'SidecarDown' }); } }) });
  seedHistory(down, { messages: [chatMsg({ threadId: B, threadType: 0, senderUid: B, senderName: 'Minh' })] });
  const app2 = await startApp(t, down);
  const admin = await loginAs(t, down, app2.call);
  const r2 = await app2.call('/api/contacts', { cookie: admin });
  assert.equal(r2.status, 200);
  assert.match(r2.json.errors.friends, /Kết nối Zalo đang tắt/);
  assert.deepEqual(r2.json.contacts.map((c) => c.uid), [B]);
});

test('lời mời kết bạn: liệt kê; đồng ý/từ chối chuyển đúng UID + người làm; thân sai → 400', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  assert.equal((await call('/api/contacts/requests', { cookie: admin })).json.requests[0].uid, B);
  assert.equal((await call(`/api/contacts/requests/${B}`, { method: 'POST', cookie: admin, body: { accept: true } })).status, 200);
  assert.deepEqual(deps.sidecar.calls.at(-1), ['answer', { uid: B, accept: true, actor: 'anh' }]);
  assert.equal((await call(`/api/contacts/requests/${B}`, { method: 'POST', cookie: admin, body: { accept: 'có' } })).status, 400);
  assert.equal((await call('/api/contacts/requests/abc', { method: 'POST', cookie: admin, body: { accept: false } })).status, 400);
});
