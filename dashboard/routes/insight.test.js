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

test('tóm tắt AI: gửi yêu cầu kèm đoạn hội thoại + Nhật ký; hỏi kết quả pending → done; đang chờ thì 409', async (t) => {
  const { mkdirSync, readdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const deps = makeDeps(t);
  seedHistory(deps, { messages: [chatMsg({ threadId: '200', threadType: 1, senderName: 'Lan', text: 'Họp tổ thứ Hai', ts: Date.now() - 60_000 })] });
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const sent = await call('/api/insight/groups/200/summary', { method: 'POST', cookie: owner, body: { days: 7 } });
  assert.equal(sent.status, 200);
  const dir = join(deps.dir, 'zalo', 'insight');
  const req = JSON.parse(readFileSync(join(dir, 'requests', readdirSync(join(dir, 'requests'))[0]), 'utf8'));
  assert.equal(req.groupName, 'Tổ Hoá');
  assert.match(req.transcript, /Lan: Họp tổ thứ Hai$/);
  assert.equal((await call(`/api/insight/summary/${sent.json.id}`, { cookie: owner })).json.status, 'pending');
  assert.equal((await call('/api/insight/groups/200/summary', { method: 'POST', cookie: owner, body: { days: 7 } })).status, 409);
  mkdirSync(join(dir, 'results'), { recursive: true });
  writeFileSync(join(dir, 'results', `${sent.json.id}.json`), JSON.stringify({ ok: true, summary: { topics: [{ title: 'Họp tổ', summary: 'x' }] } }));
  const done = await call(`/api/insight/summary/${sent.json.id}`, { cookie: owner });
  assert.equal(done.json.status, 'done');
  assert.equal(done.json.result.summary.topics[0].title, 'Họp tổ');
  assert.equal(deps.activity.list().find((e) => e.action === 'insight_summary').detail, 'Tổ Hoá · 7 ngày');
  assert.equal((await call('/api/insight/summary/khong-hop-le', { cookie: owner })).status, 400);
});
