import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, createMaintenance, parseUpdateCheck, pluginVersion } from './maintenance.js';

test('phiên bản: đọc plugin.yaml, so x.y.z, hiểu kết quả hermes update --check', () => {
  assert.equal(pluginVersion('name: zalo_tools\nversion: 2.7.0\n'), '2.7.0');
  assert.equal(pluginVersion(''), '');
  assert.ok(compareVersions('v2.10.0', '2.9.1') > 0);
  assert.equal(compareVersions('v2.7.0', '2.7.0'), 0);
  assert.ok(compareVersions('2.6.9', '2.7.0') < 0);
  assert.equal(parseUpdateCheck('→ Fetching from origin...\n\u001b[33m⚕ Update available (behind origin/main).\u001b[0m'), 'available');
  assert.equal(parseUpdateCheck('✓ Already up to date.'), 'current');
  assert.equal(parseUpdateCheck('fatal: not a git repository'), 'unknown');
});

function setup(t, over = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zalo-maint-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const m = createMaintenance({
    hermesBin: 'hermes', dataDir: dir, pluginYaml: () => 'version: 2.7.0\n',
    fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'v2.8.0', name: 'v2.8.0 — Skill', html_url: 'https://x', body: '## Mới' }) }),
    runImpl: async (file, args) => { calls.push(args); return { ok: true, out: args[0] === '--version' ? 'Hermes Agent v0.21.1 (2026.9.7)\nInstall: git' : 'Update available' }; },
    ...over,
  });
  return { dir, m, calls };
}

test('thông tin bảo trì: bản mới của bot, phiên bản Hermes; kiểm tra Hermes chỉ khi bấm', async (t) => {
  const { m, calls } = setup(t);
  const v = await m.versions();
  assert.deepEqual([v.bot.version, v.bot.latest.tag, v.bot.newer], ['2.7.0', 'v2.8.0', true]);
  assert.equal(v.hermes.version, 'Hermes Agent v0.21.1 (2026.9.7)');
  assert.equal(v.hermes.check, null);
  assert.ok(!calls.some((a) => a[0] === 'update'), 'không tự chạy update --check');
  assert.equal((await m.checkHermes()).status, 'available');
  assert.equal((await m.versions()).hermes.check.status, 'available');
});

test('mất mạng: không biết bản mới, không lỗi', async (t) => {
  const { m } = setup(t, { fetchImpl: async () => { throw new Error('offline'); } });
  const v = await m.versions();
  assert.deepEqual([v.bot.latest, v.bot.newer], [null, false]);
});

test('cập nhật Hermes: chạy tách rời với --yes --backup, ghi nhật ký; đang chạy thì từ chối', async (t) => {
  const spawned = [];
  const { m, dir } = setup(t, { spawnImpl: (file, args, opts) => { spawned.push({ file, args, opts }); const c = new EventEmitter(); c.pid = process.pid; c.unref = () => {}; setImmediate(() => c.emit('spawn')); return c; } });
  const st = await m.updateHermes();
  assert.deepEqual(spawned[0].args, ['update', '--yes', '--backup']);
  assert.equal(spawned[0].opts.detached, true);
  assert.equal(spawned[0].opts.windowsHide, true);
  assert.equal(st.running, true, 'pid còn sống');
  await assert.rejects(m.updateHermes(), { statusCode: 409 });
  writeFileSync(join(dir, 'hermes-update.log'), '\u001b[32mĐang tải…\u001b[0m\n\nXong\n');
  assert.equal(m.updateState().log, 'Đang tải…\nXong');
});

test('bản sao lưu: chỉ tên đúng mẫu trong thư mục backups', (t) => {
  const { m, dir } = setup(t);
  mkdirSync(join(dir, 'backups'));
  writeFileSync(join(dir, 'backups', 'hermes-zalo-20261010-134504.zip'), 'x');
  writeFileSync(join(dir, 'backups', 'khac.txt'), 'x');
  assert.deepEqual(m.backups().map((b) => b.file), ['hermes-zalo-20261010-134504.zip']);
  assert.throws(() => m.backupPath('../users.json'), { statusCode: 400 });
  assert.throws(() => m.backupPath('hermes-zalo-20261010-134505.zip'), { statusCode: 404 });
  assert.ok(m.backupPath('hermes-zalo-20261010-134504.zip').endsWith('hermes-zalo-20261010-134504.zip'));
});
