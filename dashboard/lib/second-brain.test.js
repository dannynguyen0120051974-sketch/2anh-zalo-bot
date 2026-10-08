import test from 'node:test';
import assert from 'node:assert/strict';
import { WINDOWS_NOTE, allowedUri, createSecondBrain, loopbackEndpoint, noteUri, secondBrainStatus } from './second-brain.js';

function fakeOv(reply = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), method: opts.method, headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null, redirect: opts.redirect });
    const path = new URL(url).pathname;
    const result = reply[path] ?? null;
    return { ok: true, json: async () => ({ status: 'ok', result }) };
  };
  return { calls, fetchImpl };
}
const settings = (over = {}) => () => ({ url: 'http://127.0.0.1:1933', account: '', user: '', apiKey: 'bi-mat', ...over });
const linux = { platform: 'linux' };

test('chỉ địa chỉ loopback; gốc đọc được giới hạn; tên ghi chú không dấu theo ngày VN', () => {
  assert.equal(loopbackEndpoint('http://127.0.0.1:1933/'), 'http://127.0.0.1:1933');
  assert.equal(loopbackEndpoint(''), null, 'chưa đặt = tắt, không tự đoán địa chỉ');
  for (const bad of ['http://10.0.0.5:1933', 'https://api.vikingdb.com', 'file:///etc/passwd', 'http://u:p@127.0.0.1:1933', 'không phải url']) assert.equal(loopbackEndpoint(bad), null, bad);
  assert.equal(allowedUri('viking://user/default/memories/a.md', 'default'), true);
  assert.equal(allowedUri('viking://resources', 'default'), true);
  assert.equal(allowedUri('viking://resources/privacy-policy.md', 'default'), true, 'chỉ cấm đúng tên thư mục, không cấm tiền tố');
  for (const bad of ['viking://user/default/privacy/x', 'viking://user/khac/memories', 'viking://resources/../user/default/privacy', 'http://x', 'viking://resourcesX',
    'viking://user/default/memories/%2e%2e/privacy', 'viking://resources/a%2fb', 'viking://resources\\x', 'viking://user/default/memories/sessions/x',
    'viking://resources/a/privacy/b.md', 'viking://user/default/peers/zalo/Sessions', 'viking://resources/privacy']) {
    assert.equal(allowedUri(bad, 'default'), false, bad);
  }
  assert.equal(noteUri('Họp Đoàn trường tháng 10!', Date.UTC(2026, 9, 7, 18, 0), 'abc123'), 'viking://resources/so-tay-dashboard/2026-10-08-hop-doan-truong-thang-10-abc123.md');
});

test('tìm: gửi đúng tiêu đề tài khoản/khoá, bỏ kết quả ngoài gốc cho phép, xếp theo điểm', async () => {
  const ov = fakeOv({ '/api/v1/search/find': {
    memories: [{ uri: 'viking://user/default/memories/a.md', score: 0.5, abstract: 'A' }, { uri: 'viking://user/default/privacy/k', score: 0.9 }],
    resources: [{ uri: 'viking://resources/b.md', score: 0.7, abstract: 'B' }],
  } });
  const sb = createSecondBrain({ settings: settings(), fetchImpl: ov.fetchImpl, ...linux });
  assert.deepEqual((await sb.search('dashboard')).map((h) => h.uri), ['viking://resources/b.md', 'viking://user/default/memories/a.md']);
  assert.equal(ov.calls[0].headers['X-OpenViking-Account'], 'default');
  assert.equal(ov.calls[0].headers['X-API-Key'], 'bi-mat');
  assert.equal(ov.calls[0].redirect, 'error', 'không theo chuyển hướng ra ngoài');
  await assert.rejects(sb.search('a'), (e) => e.statusCode === 400);
});

test('liệt kê/đọc: URI ngoài gốc → 400 trước khi gọi; ghi chú chỉ tạo mới dưới so-tay-dashboard', async () => {
  const ov = fakeOv({ '/api/v1/fs/ls': [{ uri: 'viking://resources/x.md', isDir: false, size: 3 }, { uri: 'viking://user/default/privacy', isDir: true }], '/api/v1/content/read': 'nội dung' });
  const sb = createSecondBrain({ settings: settings(), fetchImpl: ov.fetchImpl, now: () => Date.UTC(2026, 9, 7, 1), ...linux });
  assert.deepEqual((await sb.list('viking://resources')).map((e) => e.uri), ['viking://resources/x.md']);
  assert.equal(await sb.read('viking://resources/x.md'), 'nội dung');
  await assert.rejects(sb.read('viking://user/default/privacy/keys'), (e) => e.statusCode === 400);
  assert.equal(ov.calls.length, 2);
  const uri = await sb.addNote({ title: 'Ý tưởng', text: 'Làm trang Insight' });
  assert.match(uri, /^viking:\/\/resources\/so-tay-dashboard\/2026-10-07-y-tuong-[0-9a-f]{6}\.md$/);
  assert.deepEqual({ ...ov.calls.at(-1).body, uri: 'x' }, { uri: 'x', content: '# Ý tưởng\n\nLàm trang Insight\n', mode: 'create' });
  await assert.rejects(sb.addNote({ title: '', text: 'x' }), (e) => e.statusCode === 400);
});

test('bật/tắt theo cấu hình: Windows luôn tắt; chưa đặt hoặc không loopback → tắt, không gọi mạng', async () => {
  assert.deepEqual(secondBrainStatus({ url: 'http://127.0.0.1:1933', platform: 'win32' }), { enabled: false, reason: 'windows', note: WINDOWS_NOTE });
  assert.equal(WINDOWS_NOTE, 'Second brain chỉ bật trên máy chủ VPS');
  assert.equal(secondBrainStatus({ url: '', platform: 'linux' }).reason, 'unset');
  assert.equal(secondBrainStatus({ url: 'http://10.0.0.5:1933', platform: 'linux' }).reason, 'not-loopback');
  assert.deepEqual(secondBrainStatus({ url: 'http://127.0.0.1:1933/', platform: 'linux' }), { enabled: true, reason: 'ok', note: '', base: 'http://127.0.0.1:1933' });
  const never = async () => { throw new Error('không được gọi'); };
  const win = createSecondBrain({ settings: settings(), platform: 'win32', fetchImpl: never });
  assert.deepEqual(win.status(), { enabled: false, reason: 'windows', note: WINDOWS_NOTE });
  await assert.rejects(win.search('abc'), (e) => e.statusCode === 404 && e.message === WINDOWS_NOTE);
  await assert.rejects(createSecondBrain({ settings: settings({ url: '' }), fetchImpl: never, ...linux }).list('viking://resources'), (e) => e.statusCode === 404);
});

test('địa chỉ không phải loopback → tắt (404); dịch vụ tắt → 503; trả lỗi → 502 (không lộ chi tiết)', async () => {
  await assert.rejects(createSecondBrain({ settings: settings({ url: 'http://192.168.1.5:1933' }), fetchImpl: async () => { throw new Error('không được gọi'); }, ...linux }).search('abc'), (e) => e.statusCode === 404);
  await assert.rejects(createSecondBrain({ settings: settings(), fetchImpl: async () => { throw new Error('ECONNREFUSED'); }, ...linux }).search('abc'), (e) => e.statusCode === 503);
  await assert.rejects(createSecondBrain({ settings: settings(), fetchImpl: async () => ({ ok: false, json: async () => ({ status: 'error', error: { message: 'secret path' } }) }), ...linux }).search('abc'),
    (e) => e.statusCode === 502 && !/secret/.test(e.message));
});

test('tìm (spec §19.6): luôn gửi target_uri = các gốc cho phép, kho trí nhớ theo nhóm/người không chen vào', async () => {
  const ov = fakeOv({ '/api/v1/search/find': { memories: [{ uri: 'viking://user/zalo-g-1/memories/a.md', score: 0.99 }], resources: [] } });
  const sb = createSecondBrain({ settings: settings(), fetchImpl: ov.fetchImpl, ...linux });
  assert.deepEqual(await sb.search('lịch họp'), []);
  assert.deepEqual(ov.calls[0].body.target_uri, ['viking://resources', 'viking://user/default/memories', 'viking://user/default/peers']);
});
