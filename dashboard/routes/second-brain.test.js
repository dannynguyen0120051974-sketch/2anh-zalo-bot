import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecondBrain, WINDOWS_NOTE } from '../lib/second-brain.js';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

function fakeBrain({ enabled = true } = {}) {
  const calls = [];
  return {
    calls,
    status: () => (enabled ? { enabled: true, reason: 'ok', note: '' } : { enabled: false, reason: 'unset', note: 'chưa bật' }),
    roots: () => ['viking://resources'],
    list: async (uri) => { calls.push(['list', uri]); return []; },
    read: async () => 'nội dung',
    search: async (q) => { calls.push(['search', q]); return [{ uri: 'viking://resources/a.md', score: 0.9, abstract: 'A' }]; },
    addNote: async (n) => { calls.push(['note', n]); return 'viking://resources/so-tay-dashboard/x.md'; },
  };
}

test('Second brain: chỉ Quản trị; tìm/đọc/ghi chú; ghi chú vào Nhật ký với URI', async (t) => {
  const deps = makeDeps(t, { secondBrain: fakeBrain() });
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  for (const p of ['/api/admin/second-brain/roots', '/api/admin/second-brain/status', '/api/admin/second-brain/search?q=ab']) assert.equal((await call(p, { cookie: owner })).status, 403, p);
  assert.equal((await call('/api/admin/second-brain/notes', { method: 'POST', cookie: owner, body: { title: 'a', text: 'b' } })).status, 403);
  const admin = await loginAs(t, deps, call);
  assert.equal((await call('/api/admin/second-brain/search?q=dashboard', { cookie: admin })).json.hits[0].uri, 'viking://resources/a.md');
  assert.equal((await call('/api/admin/second-brain/read?uri=viking://resources/a.md', { cookie: admin })).json.text, 'nội dung');
  const note = await call('/api/admin/second-brain/notes', { method: 'POST', cookie: admin, body: { title: 'Ý tưởng', text: 'x' } });
  assert.equal(note.status, 200);
  assert.equal(deps.activity.list().find((e) => e.action === 'second_brain_note').detail, 'viking://resources/so-tay-dashboard/x.md');
});

test('/api/features: thanh bên chỉ hiện Second brain cho Quản trị khi tính năng bật', async (t) => {
  const on = makeDeps(t, { secondBrain: fakeBrain() });
  const a = await startApp(t, on);
  assert.equal((await a.call('/api/features')).status, 401);
  assert.equal((await a.call('/api/features', { cookie: await loginAs(t, on, a.call) })).json.secondBrain, true);
  assert.equal((await a.call('/api/features', { cookie: await loginAs(t, on, a.call, { username: 'khach', role: 'owner' }) })).json.secondBrain, false);
  const off = makeDeps(t, { secondBrain: fakeBrain({ enabled: false }) });
  const b = await startApp(t, off);
  assert.equal((await b.call('/api/features', { cookie: await loginAs(t, off, b.call) })).json.secondBrain, false);
});

test('máy Windows: đã đặt ZALO_SECOND_BRAIN_URL vẫn tắt, trang nhận câu "chỉ bật trên máy chủ VPS", không gọi OpenViking', async (t) => {
  const deps = makeDeps(t, { secondBrain: createSecondBrain({ settings: () => ({ url: 'http://127.0.0.1:1933' }), platform: 'win32', fetchImpl: async () => { throw new Error('không được gọi'); } }) });
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  assert.deepEqual((await call('/api/admin/second-brain/status', { cookie: admin })).json, { ok: true, enabled: false, reason: 'windows', note: WINDOWS_NOTE });
  assert.equal((await call('/api/features', { cookie: admin })).json.secondBrain, false);
  const r = await call('/api/admin/second-brain/search?q=dashboard', { cookie: admin });
  assert.equal(r.status, 404);
  assert.equal(r.json.error, WINDOWS_NOTE);
});
