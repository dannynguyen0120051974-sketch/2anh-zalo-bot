import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

test('bộ nhớ trợ lý: chỉ Quản trị; sửa/xoá ghi Nhật ký không kèm nội dung; mục cũ → 409', async (t) => {
  const deps = makeDeps(t);
  mkdirSync(join(deps.dir, 'memories'), { recursive: true });
  writeFileSync(join(deps.dir, 'memories', 'MEMORY.md'), 'Anh dạy Hoá\n§\nBí mật: số nhà 12');
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/agent-memory', { cookie: owner })).status, 403);
  const admin = await loginAs(t, deps, call);
  const v = await call('/api/admin/agent-memory', { cookie: admin });
  assert.deepEqual(v.json.memory.entries, ['Anh dạy Hoá', 'Bí mật: số nhà 12']);
  const put = await call('/api/admin/agent-memory/memory/0', { method: 'PUT', cookie: admin, body: { old: 'Anh dạy Hoá', text: 'Anh dạy Hoá lớp 10' } });
  assert.equal(put.status, 200);
  assert.equal(put.json.memory.entries[0], 'Anh dạy Hoá lớp 10');
  assert.equal((await call('/api/admin/agent-memory/memory/1', { method: 'DELETE', cookie: admin, body: { old: 'sai' } })).status, 409);
  assert.equal((await call('/api/admin/agent-memory/memory/1', { method: 'DELETE', cookie: admin, body: { old: 'Bí mật: số nhà 12' } })).status, 200);
  assert.equal(readFileSync(join(deps.dir, 'memories', 'MEMORY.md'), 'utf8'), 'Anh dạy Hoá lớp 10');
  assert.equal((await call('/api/admin/agent-memory/khac/0', { method: 'DELETE', cookie: admin, body: { old: 'x' } })).status, 400);
  const log = deps.activity.list().filter((e) => e.action.startsWith('agent_memory'));
  assert.deepEqual(log.map((e) => e.detail), ['Ghi chú của trợ lý, mục 2', 'Ghi chú của trợ lý, mục 1']);
  assert.doesNotMatch(JSON.stringify(log), /Bí mật/);
});
