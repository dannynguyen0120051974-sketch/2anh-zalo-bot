import test from 'node:test';
import assert from 'node:assert/strict';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

const fakeTrace = {
  sessions: ({ source, chat }) => {
    if (!['zalo', 'cron', 'all'].includes(source)) throw Object.assign(new Error('Nguồn không hợp lệ.'), { statusCode: 400 });
    return [{ id: 'z1', source: 'zalo', chatType: 'group', chatId: '200', title: 'Họp', model: 'hermes', input: 1, output: 2 }].filter((s) => !chat || s.chatId === chat);
  },
  turns: () => [{ at: 1, user: 'hỏi', reply: 'đáp', tools: [], ms: 5 }],
};

test('Theo dõi agent: chỉ Quản trị; tên nhóm từ danh bạ; lỗi tham số 400; state.db hỏng 500 câu chung', async (t) => {
  const deps = makeDeps(t, { agentTrace: fakeTrace });
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/trace/sessions', { cookie: owner })).status, 403);
  assert.equal((await call('/api/admin/trace/sessions/z1/turns', { cookie: owner })).status, 403);
  const admin = await loginAs(t, deps, call);
  const r = await call('/api/admin/trace/sessions?source=zalo', { cookie: admin });
  assert.equal(r.json.sessions[0].chatName, 'Tổ Hoá');
  assert.equal((await call('/api/admin/trace/sessions?source=khac', { cookie: admin })).status, 400);
  assert.equal((await call('/api/admin/trace/sessions/z1/turns', { cookie: admin })).json.turns[0].reply, 'đáp');
  const broken = makeDeps(t, { agentTrace: { sessions: () => { throw new Error('database disk image is malformed'); }, turns: () => [] } });
  const app2 = await startApp(t, broken);
  const a2 = await loginAs(t, broken, app2.call);
  const b = await app2.call('/api/admin/trace/sessions', { cookie: a2 });
  assert.equal(b.status, 500);
  assert.doesNotMatch(b.json.error, /malformed/);
});
