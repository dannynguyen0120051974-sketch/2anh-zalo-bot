import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { checkImageUrl, createImageFetcher, isPublicAddress, magicMatches } from './image-proxy.js';
import { pngOf } from '../test-helpers.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = pngOf(2, 2);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(20)]);
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBPVP8 ', 'latin1'), Buffer.alloc(20)]);
const HOST = 'photo-stal-27.zdn.vn';
const URL1 = `https://${HOST}/gr/jpg/4465/a.jpg`;

/** Mạng giả: routes["host/path"] = { status, headers, body, hang }. Ghi lại mọi lần gọi. */
function fakeNet(routes, dns = {}) {
  const requests = []; const lookups = [];
  const resolve = async (host) => { lookups.push(host); if (!(host in dns)) throw new Error('ENOTFOUND'); return dns[host]; };
  const request = (opts, onRes) => {
    requests.push(opts);
    const req = new EventEmitter();
    req.destroy = () => { req.destroyed = true; };
    req.end = () => {
      const r = routes[`${opts.hostname}${opts.path}`];
      if (!r) { setImmediate(() => req.emit('error', new Error('ECONNREFUSED'))); return; }
      if (r.hang) return;
      setImmediate(() => {
        const res = new PassThrough();
        res.statusCode = r.status ?? 200;
        res.headers = r.headers ?? {};
        onRes(res);
        for (const chunk of [].concat(r.body ?? [])) { if (!res.destroyed) res.write(chunk); }
        if (!res.destroyed) res.end();
      });
    };
    return req;
  };
  return { resolve, request, requests, lookups };
}
const PUBLIC = [{ address: '203.113.1.10', family: 4 }];
const img = (body, type = 'image/jpeg', extra = {}) => ({ headers: { 'content-type': type, ...extra }, body });

test('địa chỉ IP: chặn máy mình, mạng nội bộ, link-local (IMDS), đa hướng, IPv6 nội bộ và dạng IPv4 lồng IPv6', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '255.255.255.255', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd00:ec2::254', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', 'abc', '']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['203.113.1.10', '8.8.8.8', '172.32.0.1', '2404:6800:4005::200e', '::ffff:8.8.8.8']) assert.equal(isPublicAddress(ip), true, ip);
});

test('danh sách máy cho phép: chỉ https, tên miền con của zdn.vn/zadn.vn; còn lại từ chối trước khi phân giải tên', async () => {
  assert.ok(checkImageUrl(URL1));
  assert.ok(checkImageUrl('https://b-f64-zpg-r.zdn.vn/1/2.jpg'));
  assert.ok(checkImageUrl('https://res-zalo.zadn.vn/upload/a.png'));
  const net = fakeNet({}, {});
  const fetchImage = createImageFetcher(net);
  for (const bad of ['http://photo-stal-1.zdn.vn/a.jpg', 'https://zdn.vn/a.jpg', 'https://evil.com/a.jpg', 'https://zdn.vn.evil.com/a.jpg',
    'https://evilzdn.vn/a.jpg', 'https://file-stal-18.dlfl.vn/gr/x', 'https://video-stal-46.dlmd.me/gr/x', 'https://127.0.0.1/a.jpg',
    'https://[::1]/a.jpg', 'https://u:p@photo-stal-1.zdn.vn/a.jpg', 'https://photo-stal-1.zdn.vn:8443/a.jpg', 'file:///etc/passwd', '', null]) {
    await assert.rejects(fetchImage(bad), { code: 'bad_url' }, String(bad));
  }
  assert.deepEqual(net.lookups, []);
  assert.deepEqual(net.requests, []);
});

test('tên máy trỏ về địa chỉ nội bộ (dù chỉ một trong nhiều địa chỉ) thì từ chối, không mở kết nối', async () => {
  for (const addrs of [[{ address: '127.0.0.1', family: 4 }], [{ address: '169.254.169.254', family: 4 }], [{ address: '::1', family: 6 }],
    [{ address: '::ffff:192.168.1.5', family: 6 }], [...PUBLIC, { address: '10.0.0.5', family: 4 }], []]) {
    const net = fakeNet({ [`${HOST}/gr/jpg/4465/a.jpg`]: img(JPEG) }, { [HOST]: addrs });
    await assert.rejects(createImageFetcher(net)(URL1), { code: addrs.length ? 'blocked_address' : 'dns' }, JSON.stringify(addrs));
    assert.equal(net.requests.length, 0);
  }
});

test('tải được: nối thẳng tới đúng IP đã kiểm, giữ tên máy cho SNI, không dùng agent chung', async () => {
  const net = fakeNet({ [`${HOST}/gr/jpg/4465/a.jpg?x=1`]: img(JPEG) }, { [HOST]: PUBLIC });
  const r = await createImageFetcher(net)(`${URL1}?x=1`);
  assert.equal(r.type, 'image/jpeg');
  assert.ok(r.body.equals(JPEG));
  const opts = net.requests[0];
  assert.deepEqual([opts.hostname, opts.servername, opts.port, opts.method, opts.agent, opts.path], [HOST, HOST, 443, 'GET', false, '/gr/jpg/4465/a.jpg?x=1']);
  const got = [];
  opts.lookup(HOST, {}, (err, address, family) => got.push([err, address, family]));
  opts.lookup(HOST, { all: true }, (err, list) => got.push([err, list]));
  assert.deepEqual(got, [[null, '203.113.1.10', 4], [null, [{ address: '203.113.1.10', family: 4 }]]]);
});

test('loại ảnh: chỉ jpeg/png/webp/gif, byte đầu tệp phải khớp loại đã khai', async () => {
  const cases = [
    [img(JPEG, 'image/jpeg; charset=binary'), 'ok'], [img(PNG, 'image/png'), 'ok'], [img(GIF, 'image/gif'), 'ok'], [img(WEBP, 'image/webp'), 'ok'],
    [img(JPEG, 'image/png'), 'bad_type'], [img(PNG, 'image/jpg'), 'bad_type'], [img(Buffer.from('<html><script>alert(1)</script>'), 'image/jpeg'), 'bad_type'],
    [img(Buffer.from('<svg onload=alert(1)>'), 'image/svg+xml'), 'bad_type'], [img(JPEG, 'text/html'), 'bad_type'], [img(JPEG, ''), 'bad_type'],
    [img(Buffer.alloc(0), 'image/jpeg'), 'bad_type'],
  ];
  for (const [route, want] of cases) {
    const net = fakeNet({ [`${HOST}/gr/jpg/4465/a.jpg`]: route }, { [HOST]: PUBLIC });
    const p = createImageFetcher(net)(URL1);
    if (want === 'ok') assert.equal((await p).body.length, route.body.length);
    else await assert.rejects(p, { code: want }, route.headers['content-type']);
  }
  // Zalo khai "image/jpg" cho ảnh JPEG thật: nhận, trả ra loại chuẩn image/jpeg.
  const zalo = fakeNet({ [`${HOST}/gr/jpg/4465/a.jpg`]: img(JPEG, 'image/jpg') }, { [HOST]: PUBLIC });
  assert.equal((await createImageFetcher(zalo)(URL1)).type, 'image/jpeg');
  assert.equal(magicMatches('image/jpeg', PNG), false);
  assert.equal(magicMatches('image/bmp', Buffer.from('BM')), false);
});

test('giới hạn dung lượng: khai quá trần thì bỏ ngay; không khai mà đọc dần vượt trần thì cắt', async () => {
  const big = { [HOST]: PUBLIC };
  const declared = fakeNet({ [`${HOST}/gr/jpg/4465/a.jpg`]: img(JPEG, 'image/jpeg', { 'content-length': '5000' }) }, big);
  await assert.rejects(createImageFetcher({ ...declared, maxBytes: 1000 })(URL1), { code: 'too_large' });
  const chunks = [JPEG, ...Array.from({ length: 10 }, () => Buffer.alloc(200, 7))];
  const streamed = fakeNet({ [`${HOST}/gr/jpg/4465/a.jpg`]: img(chunks) }, big);
  await assert.rejects(createImageFetcher({ ...streamed, maxBytes: 1000 })(URL1), { code: 'too_large' });
  const fits = fakeNet({ [`${HOST}/gr/jpg/4465/a.jpg`]: img(chunks.slice(0, 3)) }, big);
  assert.equal((await createImageFetcher({ ...fits, maxBytes: 1000 })(URL1)).body.length, 204 + 400);
});

test('chuyển hướng: chỉ theo tới máy trong danh sách, kiểm lại địa chỉ mỗi lần, tối đa 2 lần', async () => {
  const OTHER = 'f64-zpg-r.zdn.vn';
  const dns = { [HOST]: PUBLIC, [OTHER]: [{ address: '203.113.1.11', family: 4 }], 'evil.zdn.vn': [{ address: '10.0.0.1', family: 4 }] };
  const redirect = (location) => ({ status: 302, headers: { location } });
  const ok = fakeNet({ [`${HOST}/gr/jpg/4465/a.jpg`]: redirect(`https://${OTHER}/b.jpg`), [`${OTHER}/b.jpg`]: img(JPEG) }, dns);
  assert.ok((await createImageFetcher(ok)(URL1)).body.equals(JPEG));
  assert.deepEqual(ok.lookups, [HOST, OTHER]);
  for (const [location, code] of [['https://evil.com/a.jpg', 'redirect'], ['http://f64-zpg-r.zdn.vn/b.jpg', 'redirect'], ['https://evil.zdn.vn/a.jpg', 'blocked_address'], ['', 'redirect']]) {
    const net = fakeNet({ [`${HOST}/gr/jpg/4465/a.jpg`]: redirect(location) }, dns);
    await assert.rejects(createImageFetcher(net)(URL1), { code }, location);
    assert.equal(net.requests.length, 1, location);
  }
  // Đường tương đối vẫn ở máy cũ; vòng lặp quá 2 lần thì dừng.
  const loop = fakeNet({ [`${HOST}/gr/jpg/4465/a.jpg`]: redirect('/gr/jpg/4465/a.jpg') }, dns);
  await assert.rejects(createImageFetcher(loop)(URL1), { code: 'redirect' });
  assert.equal(loop.requests.length, 3);
});

test('quá hạn: máy ảnh không trả lời hoặc phân giải tên quá lâu → timeout; lỗi kết nối, mã 404 → lỗi chung', async () => {
  const hang = fakeNet({ [`${HOST}/gr/jpg/4465/a.jpg`]: { hang: true } }, { [HOST]: PUBLIC });
  await assert.rejects(createImageFetcher({ ...hang, timeoutMs: 30 })(URL1), { code: 'timeout' });
  const slowDns = { resolve: () => new Promise(() => {}), request: hang.request };
  await assert.rejects(createImageFetcher({ ...slowDns, timeoutMs: 30 })(URL1), { code: 'timeout' });
  const down = fakeNet({}, { [HOST]: PUBLIC });
  await assert.rejects(createImageFetcher(down)(URL1), { code: 'upstream' });
  const gone = fakeNet({ [`${HOST}/gr/jpg/4465/a.jpg`]: { status: 404, headers: { 'content-type': 'text/html' }, body: Buffer.from('x') } }, { [HOST]: PUBLIC });
  await assert.rejects(createImageFetcher(gone)(URL1), { code: 'upstream_status' });
});
