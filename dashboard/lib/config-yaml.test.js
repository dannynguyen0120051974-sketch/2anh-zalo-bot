import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { applyYamlEdits, editConfigYaml, readConfigYaml, renderScalar } from './config-yaml.js';

const CONFIG = [
  '# Cấu hình Hermes — viết tay',
  'model:',
  '  default: hermes   # model chính',
  '  provider: custom',
  '  base_url: http://127.0.0.1:20128/v1',
  'agent:',
  '  reasoning_effort: medium',
  'platform_hints:',
  '  zalo:',
  '    append: |',
  '      Giọng điệu: lễ phép.',
  '      model: không phải khoá',
  'mcp_servers:',
  '  rag:',
  '    url: http://127.0.0.1:9998/mcp',
  '    timeout: 180',
  '  files:',
  '    command: npx',
  '    args:',
  '    - -y',
  '    - "@modelcontextprotocol/server-filesystem"',
  'platforms:',
  '  zalo:',
  '    enabled: true',
  '    extra:',
  '      reply_only_tagged: true',
  '      owner_only_groups:',
  '      - "111"',
  '      - "222"',
  '',
  '      bridge_url: ws://127.0.0.1:3873',
  '',
].join('\n');

test('chữ YAML một dòng: chuỗi thường để trần, chuỗi đặc biệt/từ khoá YAML trong ngoặc, mảng dạng [..]', () => {
  assert.equal(renderScalar('ag/gemini-3.1-pro'), 'ag/gemini-3.1-pro');
  assert.equal(renderScalar('yes'), '"yes"');
  assert.equal(renderScalar('12'), '"12"');
  assert.equal(renderScalar('a b: c'), '"a b: c"');
  assert.equal(renderScalar(false), 'false');
  assert.equal(renderScalar(['111', '333']), '["111", "333"]');
  assert.throws(() => renderScalar({}), /không hợp lệ/);
  // Ký tự chỉ thị YAML ở đầu / dấu ":" ở cuối không được để trần.
  assert.equal(renderScalar('@scope/pkg'), '"@scope/pkg"');
  assert.equal(renderScalar('-y'), '"-y"');
  assert.equal(renderScalar('a:'), '"a:"');
  assert.equal(renderScalar('dòng 1\ndòng 2'), '"dòng 1\\ndòng 2"');
});

test('sửa đúng khoá, giữ chú thích, khối chữ nhiều dòng và thứ tự; danh sách khối thay bằng một dòng', () => {
  const out = applyYamlEdits(CONFIG, [
    { path: ['model', 'default'], value: 'ag/gemini-3.1-pro' },
    { path: ['platforms', 'zalo', 'extra', 'owner_only_groups'], value: ['111', '333'] },
    { path: ['platforms', 'zalo', 'extra', 'reply_only_tagged'], value: false },
  ]);
  assert.match(out, /^ {2}default: ag\/gemini-3\.1-pro {3}# model chính$/m);
  assert.match(out, /^ {6}owner_only_groups: \["111", "333"\]$/m);
  assert.match(out, /^ {6}bridge_url: ws:\/\/127\.0\.0\.1:3873$/m, 'dòng sau danh sách còn nguyên');
  assert.match(out, /^# Cấu hình Hermes — viết tay$/m);
  assert.match(out, /^ {6}model: không phải khoá$/m, 'chữ trong khối | không bị coi là khoá');
  const y = YAML.parse(out);
  assert.equal(y.platform_hints.zalo.append, 'Giọng điệu: lễ phép.\nmodel: không phải khoá\n');
  assert.deepEqual(y.platforms.zalo.extra.owner_only_groups, ['111', '333']);
});

test('khoá chưa có thì chèn vào cuối khối cha đúng thụt lề; khối cha không có → lỗi, không đổi gì', () => {
  const out = applyYamlEdits(CONFIG, [{ path: ['mcp_servers', 'files', 'enabled'], value: false }, { path: ['platforms', 'zalo', 'extra', 'dm_policy'], value: 'open' }]);
  const y = YAML.parse(out);
  assert.equal(y.mcp_servers.files.enabled, false);
  assert.deepEqual(y.mcp_servers.files.args, ['-y', '@modelcontextprotocol/server-filesystem']);
  assert.equal(y.platforms.zalo.extra.dm_policy, 'open');
  assert.throws(() => applyYamlEdits(CONFIG, [{ path: ['khong_co', 'x'], value: 1 }]), (e) => e.statusCode === 400);
  assert.throws(() => applyYamlEdits('a: [1,\n', [{ path: ['a'], value: 1 }]), /lỗi cú pháp/);
});

test('sửa một khoá mà khoá khác cũng đổi theo (bí danh YAML) → từ chối, không trả chữ sai', () => {
  const text = 'base: &b\n  k: 1\nother: *b\n';
  assert.throws(() => applyYamlEdits(text, [{ path: ['base', 'k'], value: 2 }]), (e) => e.statusCode === 400 && /không ra đúng giá trị/.test(e.message));
});

test('ghi tệp: .bak, giữ CRLF và BOM; không đổi gì thì không ghi', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'zd-yaml-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const f = join(d, 'config.yaml');
  writeFileSync(f, `﻿${CONFIG.replace(/\n/g, '\r\n')}`);
  assert.equal(editConfigYaml(f, [{ path: ['agent', 'reasoning_effort'], value: 'high' }]), true);
  const text = readFileSync(f, 'utf8');
  assert.ok(text.startsWith('﻿'));
  assert.match(text, /reasoning_effort: high\r\n/);
  assert.equal(text.replace('reasoning_effort: high', 'reasoning_effort: medium'), `﻿${CONFIG.replace(/\n/g, '\r\n')}`, 'mọi byte khác còn nguyên');
  assert.ok(existsSync(`${f}.bak`));
  assert.equal(editConfigYaml(f, [{ path: ['agent', 'reasoning_effort'], value: 'high' }]), false);
  assert.equal(readConfigYaml(f).agent.reasoning_effort, 'high');
  assert.deepEqual(readConfigYaml(join(d, 'khong-co.yaml')), {});
});

test('ghi tệp: giữ quyền tệp (POSIX)', { skip: process.platform === 'win32' }, (t) => {
  const d = mkdtempSync(join(tmpdir(), 'zd-yaml-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const f = join(d, 'config.yaml');
  writeFileSync(f, CONFIG, { mode: 0o640 });
  editConfigYaml(f, [{ path: ['agent', 'reasoning_effort'], value: 'high' }]);
  assert.equal(statSync(f).mode & 0o777, 0o640);
});

test('tệp bị tiến trình khác (lệnh /model) ghi chen giữa lúc đọc và lúc ghi → 409, giữ bản của tiến trình kia', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'zd-yaml-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const f = join(d, 'config.yaml');
  writeFileSync(f, CONFIG);
  const theirs = CONFIG.replace('default: hermes', 'default: bot-doi');
  assert.throws(() => editConfigYaml(f, [{ path: ['agent', 'reasoning_effort'], value: 'high' }], { afterRead: () => writeFileSync(f, theirs) }),
    (e) => e.statusCode === 409);
  assert.equal(readFileSync(f, 'utf8'), theirs);
  assert.ok(!existsSync(join(d, '.config.dashboard.tmp')), 'không để lại tệp tạm');
});

test('config.yaml thật của máy này (nếu có): sửa thử trong bộ nhớ vẫn qua bước kiểm', { skip: !process.env.HERMES_HOME || !existsSync(join(process.env.HERMES_HOME, 'config.yaml')) }, () => {
  const real = readFileSync(join(process.env.HERMES_HOME, 'config.yaml'), 'utf8').replace(/^﻿/, '');
  const out = applyYamlEdits(real, [
    { path: ['model', 'default'], value: 'thu-nghiem' },
    { path: ['platforms', 'zalo', 'extra', 'reply_only_tagged'], value: true },
  ]);
  assert.equal(YAML.parse(out).model.default, 'thu-nghiem');
});
