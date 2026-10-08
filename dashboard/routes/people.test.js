import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

const A = '1111111111111111111';

function seed(deps, data) {
  mkdirSync(join(deps.dir, 'zalo'), { recursive: true });
  writeFileSync(join(deps.dir, 'zalo', 'people.json'), JSON.stringify(data));
}

test('sổ người quen: 401 khi chưa đăng nhập; Chủ bot xem, tìm không dấu, sửa, xoá — mỗi lần ghi vào Nhật ký', async (t) => {
  const deps = makeDeps(t);
  seed(deps, { [A]: { name: 'Cô Lan', note: 'Tổ Hoá', updated_at: 1 } });
  const { call } = await startApp(t, deps);
  assert.equal((await call('/api/people')).status, 401);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/people?q=hoa', { cookie: owner })).json.people[0].uid, A);
  assert.equal((await call('/api/people?q=minh', { cookie: owner })).json.people.length, 0);
  const put = await call(`/api/people/${A}`, { method: 'PUT', cookie: owner, body: { name: 'Cô Lan', note: '', fields: [{ key: 'môn', value: 'Hoá' }] } });
  assert.equal(put.status, 200);
  assert.equal(JSON.parse(readFileSync(join(deps.dir, 'zalo', 'people.json'), 'utf8'))[A].updated_by, 'dashboard:khach');
  assert.equal((await call(`/api/people/${A}`, { method: 'PUT', cookie: owner, body: { name: '', note: '' } })).status, 400);
  assert.equal((await call('/api/people/abc', { method: 'PUT', cookie: owner, body: { name: 'x' } })).status, 400);
  assert.equal((await call(`/api/people/${A}`, { method: 'DELETE', cookie: owner })).status, 200);
  assert.equal((await call(`/api/people/${A}`, { method: 'DELETE', cookie: owner })).status, 404);
  assert.deepEqual(deps.activity.list().map((e) => e.action).filter((a) => a.startsWith('people')), ['people_delete', 'people_update']);
});

test('sổ người quen hỏng: đọc báo 503 có bước tiếp theo, không lộ đường dẫn tệp', async (t) => {
  const deps = makeDeps(t);
  seed(deps, {});
  writeFileSync(join(deps.dir, 'zalo', 'people.json'), '{hỏng');
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  const r = await call('/api/people', { cookie: admin });
  assert.equal(r.status, 503);
  assert.match(r.json.error, /báo người cài đặt/);
  assert.doesNotMatch(r.json.error, /[\\/]zalo[\\/]/);
});
