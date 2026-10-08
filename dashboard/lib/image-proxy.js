/**
 * Tải ảnh Zalo cho Phiên chat — trình duyệt chỉ được tải ảnh cùng nguồn (CSP img-src 'self'),
 * nên dashboard tải hộ rồi trả lại. Đây là chỗ máy chủ tự đi ra Internet theo link lấy từ tin nhắn,
 * nên mọi bước đều khoá chặt:
 *   1. chỉ https, chỉ tên miền con của máy chủ ảnh Zalo (IMAGE_HOSTS), không mật khẩu, không cổng lạ;
 *   2. tự phân giải tên máy, từ chối nếu BẤT KỲ địa chỉ nào là mạng nội bộ/máy mình/link-local…,
 *      rồi nối thẳng vào đúng địa chỉ đã kiểm (lookup cố định) — tên máy vẫn dùng cho SNI và kiểm chứng chỉ,
 *      nên không bị đổi DNS giữa chừng (DNS rebinding);
 *   3. chuyển hướng: tối đa MAX_REDIRECTS lần, mỗi lần kiểm lại từ bước 1;
 *   4. quá hạn 10 s cho cả chuỗi; tối đa 5 MB, đọc dần và cắt ngay khi vượt;
 *   5. chỉ nhận image/jpeg|png|webp|gif và byte đầu tệp phải đúng loại đã khai; Zalo khai "application/octet-stream"
 *      thì loại ảnh lấy từ byte đầu (phải là một trong bốn loại trên), không bao giờ trả lại octet-stream.
 */
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { httpsUrl, hostUnder, IMAGE_HOSTS } from '../public/media.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 2;

// Cùng các dải mạng hộp cát của xưởng chặn (hermes-plugin/zalo_tools/studio/sandbox.py), thêm vài dải dành riêng.
const DENIED = [
  ['0.0.0.0', 8, 'ipv4'], ['10.0.0.0', 8, 'ipv4'], ['100.64.0.0', 10, 'ipv4'], ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'], ['172.16.0.0', 12, 'ipv4'], ['192.0.0.0', 24, 'ipv4'], ['192.0.2.0', 24, 'ipv4'],
  ['192.88.99.0', 24, 'ipv4'], ['192.168.0.0', 16, 'ipv4'], ['198.18.0.0', 15, 'ipv4'], ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'], ['224.0.0.0', 4, 'ipv4'], ['240.0.0.0', 4, 'ipv4'],
  // Không thêm ::ffff:0:0/96 vào đây: BlockList so cả địa chỉ IPv4 với luật đó nên sẽ chặn mọi IPv4 — xử lý riêng bên dưới.
  // ::/96 = IPv4-compatible cũ (gồm cả :: và ::1); 64:ff9b::/96 và 64:ff9b:1::/48 = NAT64; 2001::/32 = Teredo; 2002::/16 = 6to4.
  ['::', 96, 'ipv6'], ['64:ff9b::', 96, 'ipv6'], ['64:ff9b:1::', 48, 'ipv6'], ['100::', 64, 'ipv6'],
  ['2001::', 32, 'ipv6'], ['2001:db8::', 32, 'ipv6'], ['2002::', 16, 'ipv6'], ['fc00::', 7, 'ipv6'], ['fe80::', 10, 'ipv6'], ['fec0::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
];
const BLOCKED = new BlockList();
for (const [net, prefix, type] of DENIED) BLOCKED.addSubnet(net, prefix, type);

/** Địa chỉ IP công khai (không phải nội bộ, máy mình, link-local, đa hướng, dành riêng). */
export function isPublicAddress(ip) {
  const v = isIP(String(ip ?? ''));
  if (!v) return false;
  // IPv4 lồng trong IPv6: dạng chấm thì xét phần IPv4; dạng hex (::ffff:7f00:1) thì từ chối luôn.
  const mapped = v === 6 && /^(?:0{0,4}:){0,5}:?ffff:(.+)$/i.exec(ip);
  if (mapped) return isIP(mapped[1]) === 4 && isPublicAddress(mapped[1]);
  return !BLOCKED.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}

/** URL ảnh được phép tải hộ → URL; còn lại null. */
export function checkImageUrl(value) {
  const u = httpsUrl(value);
  if (!u || isIP(u.hostname.replace(/^\[|\]$/g, '')) || !hostUnder(u.hostname, IMAGE_HOSTS)) return null;
  return u;
}

const MAGIC = {
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/gif': (b) => b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1')),
  'image/webp': (b) => b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};
export const IMAGE_TYPES = Object.keys(MAGIC);
// Máy ảnh của Zalo khai "image/jpg" (không chuẩn) cho mọi ảnh JPEG — coi là image/jpeg, vẫn phải đúng byte JPEG.
const TYPE_ALIASES = { 'image/jpg': 'image/jpeg' };

/** Byte đầu tệp có đúng loại ảnh đã khai không. */
export const magicMatches = (type, body) => Boolean(MAGIC[type]?.(body));

export class ImageProxyError extends Error {
  constructor(code, message) { super(message || code); this.name = 'ImageProxyError'; this.code = code; }
}

/**
 * Mọi địa chỉ đã kiểm, IPv4 trước: máy chủ không có IPv6 mà DNS trả AAAA trước thì vẫn nối được
 * (một địa chỉ → thử IPv4; { all: true } → Node tự thử lần lượt).
 */
export function pinAddresses(addrs) {
  const list = addrs.map((a) => ({ address: a.address, family: isIP(a.address) }));
  return [...list.filter((a) => a.family === 4), ...list.filter((a) => a.family === 6)];
}

async function defaultResolve(hostname) {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

/**
 * Tạo hàm tải ảnh. `resolve(hostname)` → [{address, family}], `request(options, onResponse)` giống https.request —
 * cả hai thay được trong test (không cần mạng thật).
 */
export function createImageFetcher({
  resolve = defaultResolve, request = https.request, timeoutMs = IMAGE_TIMEOUT_MS, maxBytes = MAX_IMAGE_BYTES,
  maxRedirects = MAX_REDIRECTS, now = Date.now,
} = {}) {
  async function fetchOnce(u, deadline) {
    let addrs;
    try { addrs = await withTimeout(Promise.resolve().then(() => resolve(u.hostname)), deadline - now()); } catch (err) {
      if (err instanceof ImageProxyError) throw err;
      throw new ImageProxyError('dns');
    }
    if (!Array.isArray(addrs) || !addrs.length) throw new ImageProxyError('dns');
    if (addrs.some((a) => !isPublicAddress(a?.address))) throw new ImageProxyError('blocked_address');
    const pinned = pinAddresses(addrs);
    return new Promise((resolveP, reject) => {
      let done = false;
      let req = null;
      const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
      const timer = setTimeout(() => {
        finish(reject, new ImageProxyError('timeout'));
        req?.destroy?.();
      }, Math.max(0, deadline - now()));
      req = request({
        protocol: 'https:', hostname: u.hostname, servername: u.hostname, port: 443, method: 'GET',
        path: `${u.pathname}${u.search}`, agent: false,
        headers: { accept: 'image/webp,image/png,image/jpeg,image/gif;q=0.9', 'user-agent': 'Mozilla/5.0 (zalo-dashboard)' },
        // Chỉ nối vào các địa chỉ vừa kiểm; Node 22 có thể hỏi dạng { all: true }.
        lookup: (host, opts, cb) => (opts && opts.all ? cb(null, pinned) : cb(null, pinned[0].address, pinned[0].family)),
      }, (res) => {
        const status = Number(res.statusCode);
        if (status >= 300 && status < 400) {
          res.resume();
          return finish(resolveP, { redirect: res.headers?.location || '' });
        }
        if (status === 404 || status === 410) { res.resume(); return finish(reject, new ImageProxyError('not_found')); }
        if (status !== 200) { res.resume(); return finish(reject, new ImageProxyError('upstream_status')); }
        const declaredType = String(res.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
        // "application/octet-stream": Zalo trả kiểu này cho một số ảnh cũ ở *.zadn.vn — nhận dạng bằng byte đầu (sniff = true).
        const sniff = declaredType === 'application/octet-stream';
        const type = sniff ? null : TYPE_ALIASES[declaredType] || declaredType;
        if (!sniff && !IMAGE_TYPES.includes(type)) { res.destroy(); return finish(reject, new ImageProxyError('bad_type')); }
        const declared = Number(res.headers?.['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) { res.destroy(); return finish(reject, new ImageProxyError('too_large')); }
        const chunks = []; let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) { res.destroy(); req.destroy?.(); return finish(reject, new ImageProxyError('too_large')); }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const real = sniff ? IMAGE_TYPES.find((t) => magicMatches(t, body)) : type;
          if (!real || !magicMatches(real, body)) return finish(reject, new ImageProxyError('bad_type'));
          finish(resolveP, { type: real, body });
        });
        res.on('error', () => finish(reject, new ImageProxyError('upstream')));
      });
      req.on('error', () => finish(reject, new ImageProxyError('upstream')));
      req.end();
    });
  }

  return async function fetchImage(url) {
    const deadline = now() + timeoutMs;
    let u = checkImageUrl(url);
    if (!u) throw new ImageProxyError('bad_url');
    for (let hop = 0; ; hop += 1) {
      const r = await fetchOnce(u, deadline);
      if (!('redirect' in r)) return r;
      if (hop >= maxRedirects || !r.redirect) throw new ImageProxyError('redirect');
      let next = null;
      try { next = new URL(r.redirect, u).href; } catch { /* sai dạng */ }
      u = next && checkImageUrl(next);
      if (!u) throw new ImageProxyError('redirect');
    }
  };
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new ImageProxyError('timeout')), Math.max(0, ms)); }),
  ]).finally(() => clearTimeout(t));
}
