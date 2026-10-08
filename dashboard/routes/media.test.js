import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createImageFetcher, ImageProxyError } from '../lib/image-proxy.js';
import { loginAs, makeDeps, pngOf, startApp } from '../test-helpers.js';

const URL1 = 'https://photo-stal-27.zdn.vn/gr/jpg/4465fc927e4faf11f65e/a.jpg';
const PNG = pngOf(3, 3);
const q = (u) => `/api/media/img?u=${encodeURIComponent(u)}`;

async function ready(t, overrides = {}, role = 'owner') {
  const deps = makeDeps(t, overrides);
  const { call, base } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: `u-${role}`, role });
  return { deps, call, base, cookie };
}

test('tải ảnh cần đăng nhập; câu trả lời lỗi cũng khoá CSP và nosniff', async (t) => {
  let calls = 0;
  const deps = makeDeps(t, { imageFetch: async () => { calls += 1; return { type: 'image/png', body: PNG }; } });
  const { call } = await startApp(t, deps);
  const res = await call(q(URL1));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('content-security-policy'), "default-src 'none'");
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(calls, 0);
});

test('cả Quản trị và Chủ bot đều xem được ảnh; trả đúng byte, loại, đệm riêng 1 ngày, nosniff, CSP none', async (t) => {
  for (const role of ['admin', 'owner']) {
    const seen = [];
    const { base, cookie } = await ready(t, { imageFetch: async (u) => { seen.push(u); return { type: 'image/png', body: PNG }; } }, role);
    const res = await fetch(base + q(URL1), { headers: { Cookie: cookie } });
    assert.equal(res.status, 200, role);
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(PNG));
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('cache-control'), 'private, max-age=3600');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('content-security-policy'), "default-src 'none'");
    assert.deepEqual(seen, [URL1]);
  }
});

test('link ngoài danh sách máy ảnh Zalo (tệp, video, máy lạ, http, IP) bị từ chối 400 có bước tiếp theo, không tải', async (t) => {
  let calls = 0;
  const { call, cookie } = await ready(t, { imageFetch: async () => { calls += 1; return { type: 'image/png', body: PNG }; } });
  for (const u of ['https://file-stal-18.dlfl.vn/gr/a/b', 'https://video-stal-46.dlmd.me/gr/a', 'https://evil.com/a.jpg', 'http://photo-stal-1.zdn.vn/a.jpg',
    'https://169.254.169.254/latest/meta-data', 'https://zdn.vn.evil.com/a.jpg', '']) {
    const res = await call(q(u), { cookie });
    assert.equal(res.status, 400, u);
    assert.match(res.json.error, /—/, u);
  }
  assert.equal((await call('/api/media/img', { cookie })).status, 400);
  assert.equal((await call(`/api/media/img?u=${encodeURIComponent(URL1)}&u=x`, { cookie })).status, 400);
  assert.equal(calls, 0);
});

test('giới hạn mỗi người: quá số lần trong một phút → 429 có bước tiếp theo; người khác vẫn xem được', async (t) => {
  let clock = 0;
  const deps = makeDeps(t, { imageFetch: async () => ({ type: 'image/png', body: PNG }), imageLimit: { max: 3, windowMs: 60_000 }, now: () => clock });
  const { call } = await startApp(t, deps);
  const a = await loginAs(t, deps, call, { username: 'mot', role: 'owner' });
  const b = await loginAs(t, deps, call, { username: 'hai', role: 'admin' });
  for (let i = 0; i < 3; i += 1) assert.equal((await call(q(URL1), { cookie: a })).status, 200);
  const over = await call(q(URL1), { cookie: a });
  assert.equal(over.status, 429);
  assert.match(over.json.error, /đợi một phút/);
  assert.equal((await call(q(URL1), { cookie: b })).status, 200);
  clock = 60_000;
  assert.equal((await call(q(URL1), { cookie: a })).status, 200);
});

test('lỗi khi tải: quá hạn 504, quá lớn/không tải được 502 — câu dễ hiểu, không lộ chi tiết kỹ thuật', async (t) => {
  let err = new ImageProxyError('timeout');
  const { call, cookie } = await ready(t, { imageFetch: async () => { throw err; } });
  const expect = [['timeout', 504, /chậm/], ['too_large', 413, /5 MB/], ['not_found', 404, /Zalo đã xoá/], ['blocked_address', 502, /thử lại sau/],
    ['bad_type', 415, /không phải ảnh/], ['redirect', 502, /thử lại sau/], ['upstream_status', 502, /thử lại sau/]];
  for (const [code, status, re] of expect) {
    err = new ImageProxyError(code);
    const res = await call(q(URL1), { cookie });
    assert.equal(res.status, status, code);
    assert.match(res.json.error, re, code);
    assert.match(res.json.error, /—/, code);
    assert.doesNotMatch(res.json.error, new RegExp(code), code);
  }
});

test('giới hạn tải cùng lúc: mỗi người 4 (429), toàn máy chủ 6 (503); xong thì nhả chỗ, kể cả khi lỗi', async (t) => {
  const pending = [];
  const imageFetch = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const deps = makeDeps(t, { imageFetch });
  const { call, base } = await startApp(t, deps);
  const cookies = {};
  for (const [name, role] of [['mot', 'owner'], ['hai', 'admin'], ['bon', 'owner']]) cookies[name] = await loginAs(t, deps, call, { username: name, role });
  const open = (who) => fetch(base + q(URL1), { headers: { Cookie: cookies[who] } });
  const waitPending = async (n) => { for (let i = 0; i < 200 && pending.length < n; i += 1) await new Promise((r) => setTimeout(r, 5)); assert.equal(pending.length, n); };

  const first = [1, 2, 3, 4].map(() => open('mot'));
  await waitPending(4);
  const perUser = await call(q(URL1), { cookie: cookies.mot });
  assert.equal(perUser.status, 429);
  assert.match(perUser.json.error, /—/);
  const second = [1, 2].map(() => open('hai'));
  await waitPending(6);
  const global = await call(q(URL1), { cookie: cookies.bon });
  assert.equal(global.status, 503);
  assert.match(global.json.error, /thử lại/);
  assert.equal(pending.length, 6); // lần bị từ chối không gọi tải

  pending[0].reject(new Error('hỏng')); // lỗi vẫn nhả chỗ
  for (const p of pending.slice(1)) p.resolve({ type: 'image/png', body: PNG });
  const statuses = (await Promise.all([...first, ...second])).map((r) => r.status);
  assert.deepEqual(statuses.sort(), [200, 200, 200, 200, 200, 502]);
  const again = open('bon');
  await waitPending(7);
  pending[6].resolve({ type: 'image/png', body: PNG });
  assert.equal((await again).status, 200);
});

test('đăng xuất (một máy và mọi máy) xoá đệm của trình duyệt — ảnh Zalo không còn cho người dùng sau', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  for (const path of ['/api/auth/logout', '/api/auth/logout-all']) {
    const cookie = await loginAs(t, deps, call, { username: 'xoa', role: 'owner' });
    const res = await call(path, { method: 'POST', cookie });
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('clear-site-data'), '"cache"', path);
  }
});

test('trọn đường: bộ tải thật với DNS và kết nối giả — nối đúng IP công khai, chặn tên máy trỏ về mạng nội bộ', async (t) => {
  const dns = { 'photo-stal-27.zdn.vn': [{ address: '203.113.1.10', family: 4 }], 'photo-stal-9.zdn.vn': [{ address: '127.0.0.1', family: 4 }] };
  const opened = [];
  const request = (opts, onRes) => {
    opened.push(opts.hostname);
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () => setImmediate(() => {
      const res = new PassThrough();
      res.statusCode = 200; res.headers = { 'content-type': 'image/png' };
      onRes(res); res.end(PNG);
    });
    return req;
  };
  const imageFetch = createImageFetcher({ resolve: async (h) => dns[h], request });
  const { base, call, cookie } = await ready(t, { imageFetch });
  const ok = await fetch(base + q(URL1), { headers: { Cookie: cookie } });
  assert.equal(ok.status, 200);
  assert.ok(Buffer.from(await ok.arrayBuffer()).equals(PNG));
  const blocked = await call(q('https://photo-stal-9.zdn.vn/a.jpg'), { cookie });
  assert.equal(blocked.status, 502);
  assert.deepEqual(opened, ['photo-stal-27.zdn.vn']);
});
