import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalize } from '../lib/permissions.js';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

const MANIFEST = { v: 1, generatedAt: 5, tools: [
  { name: 'zalo_pdf', toolset: 'zalo_public', description: 'Xử lý PDF', feature: 'files', registered: true },
  { name: 'zalo_send_sticker', toolset: 'zalo_public', description: 'Gửi nhãn dán', feature: 'always', registered: true },
  { name: 'zalo_rename_group', toolset: 'zalo_owner', description: 'Đổi tên nhóm', feature: null, registered: true, confirm: true },
] };

test('Công cụ: chỉ Quản trị; liệt kê mức quyền + nút điều khiển; tắt công cụ công khai ghi tools.off và Nhật ký; giữ mục khác', async (t) => {
  const deps = makeDeps(t);
  mkdirSync(join(deps.dir, 'zalo'), { recursive: true });
  deps.toolsManifestFile = join(deps.dir, 'zalo', 'tools-manifest.json');
  writeFileSync(deps.toolsManifestFile, JSON.stringify(MANIFEST));
  writeFileSync(join(deps.dir, 'zalo', 'permissions.json'), JSON.stringify({ version: 1, defaults: {}, groups: {}, dm: { who: 'list', features: {}, people: {} } }));
  deps.publicMcp = () => 'rag, mcp-search';
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/tools', { cookie: owner })).status, 403);
  assert.equal((await call('/api/admin/tools', { method: 'PUT', cookie: owner, body: { off: ['zalo_pdf'] } })).status, 403);
  const admin = await loginAs(t, deps, call);
  const v = await call('/api/admin/tools', { cookie: admin });
  assert.deepEqual(v.json.tools.map((x) => [x.name, x.level, x.switch, x.off]), [
    ['zalo_pdf', 'Mọi người', 'Gửi và tạo tệp', false], ['zalo_send_sticker', 'Mọi người', 'Luôn bật (không có nút)', false], ['zalo_rename_group', 'Chỉ chủ nhân', '', false],
  ]);
  assert.deepEqual(v.json.publicMcp, ['rag', 'mcp-search']);
  const put = await call('/api/admin/tools', { method: 'PUT', cookie: admin, body: { off: ['zalo_pdf'] } });
  assert.equal(put.json.tools[0].off, true);
  const file = JSON.parse(readFileSync(join(deps.dir, 'zalo', 'permissions.json'), 'utf8'));
  assert.deepEqual(file.tools, { off: ['zalo_pdf'] });
  assert.equal(file.version, 1, 'permissions.json vẫn phiên bản 1');
  assert.equal(file.dm.who, 'list', 'mục nhắn riêng còn nguyên');
  assert.equal((await call('/api/admin/tools', { method: 'PUT', cookie: admin, body: { off: ['zalo_rename_group'] } })).status, 400, 'công cụ chủ nhân không có nút');
  assert.equal((await call('/api/admin/tools', { method: 'PUT', cookie: admin, body: { off: ['terminal'] } })).status, 400, 'tên ngoài danh sách');
  assert.equal((await call('/api/admin/tools', { method: 'PUT', cookie: admin, body: { off: 'zalo_pdf' } })).status, 400);
  assert.equal(deps.activity.list().find((e) => e.action === 'tools_off').detail, 'tắt: zalo_pdf');
  // Lưu nhóm sau đó vẫn giữ tools.off.
  await call('/api/permissions/defaults', { method: 'PUT', cookie: admin, body: { active: true, replyOnlyTagged: true, features: Object.fromEntries(['web', 'files', 'voice', 'reminders', 'groupCron', 'kb', 'people', 'academic', 'video'].map((k) => [k, true])) } });
  assert.deepEqual(JSON.parse(readFileSync(join(deps.dir, 'zalo', 'permissions.json'), 'utf8')).tools, { off: ['zalo_pdf'] });
  // Bật lại.
  await call('/api/admin/tools', { method: 'PUT', cookie: admin, body: { off: [] } });
  assert.deepEqual(JSON.parse(readFileSync(join(deps.dir, 'zalo', 'permissions.json'), 'utf8')).tools, { off: [] });
  assert.equal(deps.activity.list()[0].detail, 'bật lại: zalo_pdf');
});

test('Công cụ: chưa có tools-manifest.json (plugin cũ) → available=false, không lỗi', async (t) => {
  const deps = makeDeps(t);
  deps.toolsManifestFile = join(deps.dir, 'khong-co.json');
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  const v = await call('/api/admin/tools', { cookie: admin });
  assert.equal(v.status, 200);
  assert.equal(v.json.available, false);
  assert.deepEqual(v.json.tools, []);
});

test('permissions.json: mục tools hỏng/lạ → bỏ tên sai, không trùng; không có thì không thêm', () => {
  assert.deepEqual(normalize({ version: 1, tools: { off: ['zalo_pdf', 'zalo_pdf', 'BAD NAME', 5] } }).tools, { off: ['zalo_pdf'] });
  assert.deepEqual(normalize({ version: 1, tools: { off: 'zalo_pdf' } }).tools, { off: [] });
  assert.equal('tools' in normalize({ version: 1 }), false);
  assert.equal('tools' in normalize({ version: 1, tools: 'x' }), false);
});
