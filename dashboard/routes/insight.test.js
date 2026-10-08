import test from 'node:test';
import assert from 'node:assert/strict';
import { chatMsg, loginAs, makeDeps, seedHistory, startApp } from '../test-helpers.js';

test('Insight nhóm: Chủ bot xem được, tên nhóm từ danh bạ, số ngày chỉ 7/30/90, id lạ 400, chưa có lịch sử vẫn 200', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const empty = await call('/api/insight/groups/200', { cookie: owner });
  assert.equal(empty.status, 200);
  assert.equal(empty.json.unavailable, true);
  seedHistory(deps, { messages: [chatMsg({ threadId: '200', threadType: 1, senderUid: '5', senderName: 'Lan', ts: Date.now() - 1000 })] });
  const r = await call('/api/insight/groups/200?days=7', { cookie: owner });
  assert.equal(r.json.name, 'Tổ Hoá');
  assert.equal(r.json.days, 7);
  assert.equal(r.json.totals.messages, 1);
  assert.equal((await call('/api/insight/groups/200?days=365', { cookie: owner })).json.days, 30);
  assert.equal((await call('/api/insight/groups/abc', { cookie: owner })).status, 400);
  assert.equal((await call('/api/insight/groups/200')).status, 401);
});
