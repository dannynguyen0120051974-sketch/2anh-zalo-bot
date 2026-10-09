import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiKeys, maskTail, MODEL_KEY } from './ai-keys.js';

const SECRET = 'tvly-abcdefghijklmnopqrstuvwxyz123456';
const MODEL_SECRET = 'sk-9router-0123456789abcdefWXYZ';

function setup(t, fetchImpl) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-aikeys-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envFile = join(dir, '.env');
  const configFile = join(dir, 'config.yaml');
  writeFileSync(envFile, `TAVILY_API_KEY=${SECRET}\nZALO_BRIDGE_TOKEN=noi-bo-khong-dong\nMY_SERVICE_TOKEN=abcdefgh12345678\nVBEE_WEBHOOK_SECRET=webhook-bi-mat-123\nPLAIN=1\n`);
  writeFileSync(configFile, `model:\n  default: 2anhPRO\n  provider: custom\n  base_url: http://127.0.0.1:20128/v1\n  api_key: ${MODEL_SECRET}\n`);
  return { envFile, configFile, keys: createAiKeys({ envFile, configFile, fetchImpl }) };
}

test('danh sách khoá: chỉ 4 ký tự cuối, không bao giờ có giá trị; khoá hệ thống ZALO_* không hiện; khoá lạ vào "Khác"', (t) => {
  const { keys } = setup(t);
  const { keys: rows, available } = keys.list();
  const json = JSON.stringify({ rows, available });
  assert.ok(!json.includes(SECRET) && !json.includes(MODEL_SECRET), 'không lộ khoá');
  assert.equal(rows.find((r) => r.key === 'TAVILY_API_KEY').hint, '••••3456');
  assert.equal(rows.find((r) => r.key === MODEL_KEY).set, true);
  assert.equal(rows.find((r) => r.key === 'CORE_API_KEY').set, false, 'khoá quen thuộc hay dùng hiện cả khi chưa đặt');
  assert.ok(!rows.some((r) => r.key === 'ZALO_BRIDGE_TOKEN'));
  assert.equal(rows.find((r) => r.key === 'MY_SERVICE_TOKEN').known, false);
  assert.equal(rows.find((r) => r.key === 'VBEE_WEBHOOK_SECRET').editable, false, 'khoá nội bộ không sửa ở đây');
  assert.ok(available.some((a) => a.key === 'APIFY_TOKEN'));
  assert.equal(maskTail('ngan'), '••••');
});

test('thay / gỡ khoá: luật giá trị chặt, không ghi được khoá hệ thống, khoá cổng AI chính ghi vào config.yaml', (t) => {
  const { keys, envFile, configFile } = setup(t);
  assert.equal(keys.set('CORE_API_KEY', 'core-key-abcdef123456'), true);
  assert.match(readFileSync(envFile, 'utf8'), /^CORE_API_KEY=core-key-abcdef123456$/m);
  assert.equal(keys.set('CORE_API_KEY', 'core-key-abcdef123456'), false, 'không đổi thì không ghi');
  for (const bad of ['có khoảng trắng 123', 'abc"def12345', 'abc\nEVIL=1xxxx', 'ngan']) {
    assert.throws(() => keys.set('CORE_API_KEY', bad), (e) => e.statusCode === 400, JSON.stringify(bad));
  }
  for (const k of ['ZALO_ALLOWED_USERS', 'ZALO_BRIDGE_TOKEN', 'HERMES_HOME', 'PATH', 'VBEE_WEBHOOK_SECRET']) {
    assert.throws(() => keys.set(k, 'abcdefgh12345678'), (e) => e.statusCode === 400, k);
  }
  assert.equal(keys.set('TAVILY_API_KEY', ''), true, 'gỡ khoá');
  assert.match(readFileSync(envFile, 'utf8'), /^TAVILY_API_KEY=$/m);
  assert.throws(() => keys.set(MODEL_KEY, ''), /Không gỡ được/);
  keys.set(MODEL_KEY, 'sk-moi-0000111122223333');
  assert.match(readFileSync(configFile, 'utf8'), /api_key: sk-moi-0000111122223333/);
  assert.match(readFileSync(configFile, 'utf8'), /default: 2anhPRO/, 'giữ nguyên phần khác');
});

test('kiểm tra khoá: gọi địa chỉ cố định của dịch vụ bằng khoá đang lưu; trả được/không + lý do, không trả khoá', async (t) => {
  const seen = [];
  const { keys } = setup(t, async (url, init) => {
    seen.push([url, init.headers]);
    return { ok: !url.includes('tavily'), status: url.includes('tavily') ? 401 : 200 };
  });
  const bad = await keys.test('TAVILY_API_KEY');
  assert.deepEqual([bad.ok, bad.detail], [false, 'Khoá sai hoặc đã bị thu hồi.']);
  assert.equal(seen[0][0], 'https://api.tavily.com/search');
  assert.equal(seen[0][1].Authorization, `Bearer ${SECRET}`);
  const good = await keys.test(MODEL_KEY);
  assert.equal(good.ok, true);
  assert.equal(seen[1][0], 'http://127.0.0.1:20128/v1/models');
  assert.ok(!JSON.stringify([bad, good]).includes(SECRET));
  await assert.rejects(keys.test('CORE_API_KEY'), (e) => e.statusCode === 400, 'chưa đặt');
  await assert.rejects(keys.test('MY_SERVICE_TOKEN'), /chưa có cách kiểm tra/);
});
