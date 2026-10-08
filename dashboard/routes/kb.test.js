import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createKbStore } from '../lib/kb-store.js';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

function withKb(t) {
  const deps = makeDeps(t);
  const root = join(deps.dir, 'kho');
  mkdirSync(root);
  deps.kb = createKbStore({ kbDir: () => root, publicDirs: () => '' });
  return deps;
}

async function upload(base, cookie, name, body, headers = {}) {
  const res = await fetch(`${base}/api/kb/upload`, {
    method: 'POST', body,
    headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'zalo-dashboard', 'X-File-Name': encodeURIComponent(name), ...headers },
  });
  return { status: res.status, json: await res.json() };
}

test('kho tri thức: Chủ bot tải lên PDF, thấy trong danh sách, xoá được; Nhật ký có tên tệp', async (t) => {
  const deps = withKb(t);
  const { base, call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const up = await upload(base, owner, 'Kế hoạch tháng 10.pdf', Buffer.from('%PDF-1.7 nội dung'));
  assert.equal(up.status, 200);
  assert.equal(up.json.path, 'tai-len-dashboard/Kế hoạch tháng 10.pdf');
  const list = await call('/api/kb', { cookie: owner });
  assert.equal(list.json.configured, true);
  assert.deepEqual(list.json.files.map((f) => f.path), ['tai-len-dashboard/Kế hoạch tháng 10.pdf']);
  assert.equal((await call('/api/kb/file', { method: 'DELETE', cookie: owner, body: { path: up.json.path } })).status, 200);
  assert.deepEqual(deps.activity.list().filter((e) => e.action.startsWith('kb_')).map((e) => [e.action, e.detail]),
    [['kb_delete', 'tai-len-dashboard/Kế hoạch tháng 10.pdf'], ['kb_upload', 'tai-len-dashboard/Kế hoạch tháng 10.pdf']]);
});

test('kho tri thức: 401 chưa đăng nhập, sai định dạng 400, quá 10 MB 413 có câu dễ hiểu, xoá ngoài thư mục tải lên 403', async (t) => {
  const deps = withKb(t);
  const { base, call } = await startApp(t, deps);
  assert.equal((await call('/api/kb')).status, 401);
  const admin = await loginAs(t, deps, call);
  assert.equal((await upload(base, admin, 'a.exe', Buffer.from('MZ'))).status, 400);
  assert.equal((await upload(base, admin, 'a.pdf', Buffer.from('không phải pdf'))).status, 400);
  const big = await upload(base, admin, 'a.pdf', Buffer.alloc(10 * 1024 * 1024 + 10, 0x41));
  assert.equal(big.status, 413);
  assert.match(big.json.error, /10 MB/);
  assert.equal((await call('/api/kb/file', { method: 'DELETE', cookie: admin, body: { path: '../config.yaml' } })).status, 403);
});
