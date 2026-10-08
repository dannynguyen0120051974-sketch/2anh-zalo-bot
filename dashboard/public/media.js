// Phân loại tin ảnh/video/tệp/link — dùng chung cho máy chủ (dashboard/lib/store-reader.js) và giao diện.
// Dạng chữ bot lưu (hermes-bridge.js extractText: tiêu đề \n mô tả \n href, bỏ dòng trùng):
//   chat.photo      "https://photo-stal-27.zdn.vn/….jpg"  hoặc  "chú thích\nhttps://….zdn.vn/….jpg"
//   share.file      "Tên tệp.pdf\nhttps://file-stal-18.dlfl.vn/…"
//   chat.video.msg  "https://video-stal-46.dlmd.me/…"
//   chat.recommended "tiêu đề\nmô tả\nhttps://…" (thẻ link, danh thiếp…)

// Máy chủ ảnh của Zalo (lấy từ dữ liệu thật: photo-stal-N.zdn.vn, fN-zpg-r.zdn.vn, b-fN-zpg-r.zdn.vn,
// res-zalo.zadn.vn…). Chỉ những máy này mới được đi qua bộ tải ảnh của dashboard.
export const IMAGE_HOSTS = ['zdn.vn', 'zadn.vn'];
// Máy chủ tệp/video/tin thoại của Zalo — chỉ mở bằng link ngoài, không bao giờ tải qua dashboard.
export const FILE_HOSTS = ['dlfl.vn', 'dlmd.me', 'zdn.vn', 'zadn.vn'];
const CDN_HOSTS = [...new Set([...IMAGE_HOSTS, ...FILE_HOSTS])];

const URL_RE = /https:\/\/[^\s<>"'`]+/gi;
const TRAIL = /[.,;:!?…'"”’»\]}>]+$/;

/** Link https hợp lệ (không mật khẩu, cổng mặc định) → URL; còn lại null. */
export function httpsUrl(value) {
  const s = String(value ?? '').trim();
  if (!/^https:\/\//i.test(s) || s.length > 2048) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !u.hostname) return null;
  return u;
}

/** Tên máy là tên miền con thật của một trong các đuôi (không nhận chính đuôi, không nhận địa chỉ IP). */
export function hostUnder(hostname, suffixes) {
  const h = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  return suffixes.some((s) => h.length > s.length + 1 && h.endsWith(`.${s}`) && /^[a-z0-9.-]+$/.test(h));
}

export const isImageUrl = (v) => { const u = httpsUrl(v); return Boolean(u && hostUnder(u.hostname, IMAGE_HOSTS)); };
export const isFileUrl = (v) => { const u = httpsUrl(v); return Boolean(u && hostUnder(u.hostname, FILE_HOSTS)); };
export const isZaloCdn = (v) => { const u = httpsUrl(v); return Boolean(u && hostUnder(u.hostname, CDN_HOSTS)); };

/** Đường ảnh qua bộ tải của dashboard (cùng nguồn, hợp CSP img-src 'self'). */
export const proxied = (url) => `/api/media/img?u=${encodeURIComponent(url)}`;

/** Mọi link https trong chữ, bỏ dấu câu dính cuối, không trùng, giữ thứ tự xuất hiện. */
export function extractUrls(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(URL_RE)) {
    let s = m[0];
    for (;;) {
      const before = s;
      s = s.replace(TRAIL, '');
      // Ngoặc đóng cuối chỉ thuộc link khi trong link có ngoặc mở tương ứng (vd. wiki/A_(B)).
      if (s.endsWith(')') && (s.match(/\(/g) || []).length < (s.match(/\)/g) || []).length) s = s.slice(0, -1);
      if (s === before) break;
    }
    const u = httpsUrl(s);
    if (u && !out.includes(s)) out.push(s);
  }
  return out;
}

const lines = (text) => String(text ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

export function fileExt(name) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(name ?? '').trim());
  return m ? m[1].toLowerCase() : '';
}

function nameFromUrl(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'Tệp'; } catch { return 'Tệp'; }
}

/**
 * Tin ảnh/video/tệp → mô tả để vẽ; không đúng dạng hoặc link không thuộc máy chủ Zalo → null
 * (khi đó giao diện hiện như tin thường, không có link).
 *   { kind: 'photo', url, caption }   { kind: 'video', url, caption }   { kind: 'file', name, url, ext }
 */
export function classifyMedia(msgType, text) {
  const raw = String(text ?? '');
  if (msgType === 'chat.photo') {
    const url = extractUrls(raw).filter(isImageUrl).pop();
    if (!url) return null;
    return { kind: 'photo', url, caption: raw.replace(url, '').trim() };
  }
  if (msgType === 'chat.video.msg') {
    const url = extractUrls(raw).find(isFileUrl);
    if (!url) return null;
    return { kind: 'video', url, caption: raw.replace(url, '').trim() };
  }
  if (msgType === 'share.file') {
    const url = extractUrls(raw).filter(isFileUrl).pop();
    if (!url) return null;
    const name = lines(raw).find((x) => !x.includes(url)) || nameFromUrl(url);
    return { kind: 'file', name: name.slice(0, 255), url, ext: fileExt(name) };
  }
  return null;
}

// Kiểu tin không bao giờ góp vào mục Link (ảnh/tệp/video/thoại có mục riêng, nhãn dán không có link thật).
export const NOT_LINK_TYPES = ['chat.photo', 'share.file', 'chat.video.msg', 'chat.voice', 'chat.sticker', 'chat.gif'];

/**
 * Link trong một tin, bỏ link ảnh/tệp/video trên máy chủ Zalo, không trùng trong cùng tin.
 * Thẻ link (chat.recommended): tiêu đề = dòng chữ đầu tiên không phải link.
 */
export function linksOf(msgType, text) {
  if (NOT_LINK_TYPES.includes(msgType)) return [];
  const urls = extractUrls(text).filter((u) => !isZaloCdn(u));
  if (!urls.length) return [];
  const title = msgType === 'chat.recommended'
    ? (lines(text).find((x) => !/^https:\/\/\S+$/i.test(x)) || '').slice(0, 200)
    : '';
  return urls.map((url) => ({ url, host: httpsUrl(url).hostname, ...(title ? { title } : {}) }));
}
