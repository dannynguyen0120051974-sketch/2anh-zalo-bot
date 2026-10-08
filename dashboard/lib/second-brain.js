/**
 * Second brain (spec §18.5.4, chỉ Quản trị, chỉ máy chủ Linux/VPS): kho ngữ cảnh OpenViking chạy trên CÙNG máy.
 * Tính năng của sản phẩm, bật bằng cấu hình: chỉ bật khi `.env` của Hermes có `ZALO_SECOND_BRAIN_URL` (địa chỉ loopback);
 * máy Windows LUÔN tắt dù có đặt — OpenViking ở máy nhà là bộ nhớ riêng của chủ máy, không được lộ qua dashboard.
 * Tài khoản/người dùng: `OPENVIKING_ACCOUNT`, `OPENVIKING_USER` (mặc định "default"). Dashboard là cửa sổ xem + tìm + ghi chú:
 *  - chỉ địa chỉ loopback (không bao giờ thành cầu gọi ra mạng ngoài — SSRF);
 *  - chỉ đọc trong các gốc cho phép: viking://resources, viking://user/<user>/memories, viking://user/<user>/peers
 *    (không mở privacy/sessions/agent…);
 *  - chỉ GHI ghi chú mới vào viking://resources/so-tay-dashboard/ (chế độ "create" — không sửa/xoá gì có sẵn).
 * Khoá OPENVIKING_API_KEY (nếu có) chỉ dùng ở máy chủ, không bao giờ trả ra trình duyệt.
 */
import { randomBytes } from 'node:crypto';

export const NOTE_ROOT = 'viking://resources/so-tay-dashboard';
const TIMEOUT_MS = 15_000;
const MAX_NOTE = 8000;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export const SECOND_BRAIN_KEY = 'ZALO_SECOND_BRAIN_URL';
export const WINDOWS_NOTE = 'Second brain chỉ bật trên máy chủ VPS';
export const UNSET_NOTE = 'Second brain chưa bật — người cài đặt đặt ZALO_SECOND_BRAIN_URL (OpenViking trên cùng máy) trong .env của Hermes.';
export const NOT_LOOPBACK_NOTE = 'ZALO_SECOND_BRAIN_URL phải là địa chỉ trên cùng máy (127.0.0.1) — báo người cài đặt sửa lại.';

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/** Địa chỉ OpenViking hợp lệ để dùng: http(s) + loopback; trống hoặc ngược lại → null. */
export function loopbackEndpoint(raw) {
  if (!String(raw ?? '').trim()) return null;
  try {
    const u = new URL(String(raw).trim());
    if (!['http:', 'https:'].includes(u.protocol) || !LOOPBACK.has(u.hostname) || u.username || u.password) return null;
    return u.origin;
  } catch { return null; }
}

/**
 * Tính năng có bật không — một chỗ quyết cho dashboard, bộ cài và doctor:
 * Windows → luôn tắt; chưa đặt `ZALO_SECOND_BRAIN_URL` → tắt; không phải loopback → tắt; còn lại → bật.
 */
export function secondBrainStatus({ url, platform = process.platform }) {
  if (platform === 'win32') return { enabled: false, reason: 'windows', note: WINDOWS_NOTE };
  if (!String(url ?? '').trim()) return { enabled: false, reason: 'unset', note: UNSET_NOTE };
  const base = loopbackEndpoint(url);
  if (!base) return { enabled: false, reason: 'not-loopback', note: NOT_LOOPBACK_NOTE };
  return { enabled: true, reason: 'ok', note: '', base };
}

const FORBIDDEN_SEGMENTS = new Set(['privacy', 'sessions']);

/** URI được phép đọc: đúng gốc cho phép, không "..", không "%" hay "\", không ký tự điều khiển, không thư mục privacy/sessions. */
export function allowedUri(uri, user) {
  const s = String(uri ?? '');
  // eslint-disable-next-line no-control-regex
  if (!s.startsWith('viking://') || s.includes('..') || /[\u0000-\u001f%\\]/.test(s) || s.length > 500) return false;
  // Phần riêng tư của OpenViking: cấm ở mọi độ sâu, kể cả bên trong thư mục được phép.
  if (s.slice('viking://'.length).split('/').some((seg) => FORBIDDEN_SEGMENTS.has(seg.toLowerCase()))) return false;
  const roots = ['viking://resources', `viking://user/${user}/memories`, `viking://user/${user}/peers`];
  return roots.some((r) => s === r || s.startsWith(`${r}/`));
}

/** Tên tệp ghi chú: ngày VN + chữ không dấu từ tiêu đề + đuôi ngẫu nhiên. */
export function noteUri(title, nowMs, rand = randomBytes(3).toString('hex')) {
  const day = new Date(nowMs + 7 * 3600_000).toISOString().slice(0, 10);
  const slug = String(title).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'ghi-chu';
  return `${NOTE_ROOT}/${day}-${slug}-${rand}.md`;
}

/**
 * Một yêu cầu tới OpenViking trên cùng máy — dùng chung cho Second brain và Kho tri thức tự học (spec §19.6).
 * `conn`: `{ base, account, user, apiKey }`, `base` đã qua `loopbackEndpoint`. Lỗi mạng → 503, máy chủ từ chối → 502
 * (không lộ chi tiết). Không theo chuyển hướng.
 */
export async function ovRequest(conn, path, { method = 'GET', query, body } = {}, fetchImpl = fetch) {
  const url = new URL(path, conn.base);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
  const headers = { 'X-OpenViking-Account': conn.account, 'X-OpenViking-User': conn.user, ...(conn.apiKey ? { 'X-API-Key': conn.apiKey } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
  let res; let json = {};
  try {
    res = await fetchImpl(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    json = await res.json();
  } catch { throw err(503, 'Bộ nhớ dài hạn (OpenViking) không trả lời — kiểm tra dịch vụ trên máy chủ (Sức khoẻ máy chủ).'); }
  if (!res.ok || json.status !== 'ok') throw err(502, 'Bộ nhớ dài hạn từ chối yêu cầu — thử lại, nếu vẫn lỗi hãy báo người cài đặt.');
  return json.result;
}

/** `settings()` đọc lại mỗi lần: `{ url, account, user, apiKey }` (chuỗi thô từ .env). */
export function createSecondBrain({ settings, platform = process.platform, fetchImpl = fetch, now = Date.now }) {
  const status = () => secondBrainStatus({ url: settings().url, platform });
  function conf() {
    const s = settings();
    const st = secondBrainStatus({ url: s.url, platform });
    if (!st.enabled) throw err(404, st.note);
    return { base: st.base, account: s.account || 'default', user: s.user || 'default', apiKey: s.apiKey || '' };
  }
  async function call(path, opts) {
    const c = conf();
    return { result: await ovRequest(c, path, opts, fetchImpl), user: c.user };
  }
  return {
    status() { const { enabled, reason, note } = status(); return { enabled, reason, note }; },
    roots() { const { user } = conf(); return ['viking://resources', `viking://user/${user}/memories`, `viking://user/${user}/peers`]; },
    async list(uri) {
      const { user } = conf();
      if (!allowedUri(uri, user)) throw err(400, 'Không mở được mục này — chọn lại từ danh sách.');
      const { result } = await call('/api/v1/fs/ls', { query: { uri } });
      return (Array.isArray(result) ? result : []).filter((e) => allowedUri(e?.uri, user)).slice(0, 500)
        .map((e) => ({ uri: e.uri, dir: Boolean(e.isDir), size: Number(e.size) || 0, modTime: e.modTime || null, abstract: String(e.abstract || '').slice(0, 400) }));
    },
    async read(uri) {
      const { user } = conf();
      if (!allowedUri(uri, user)) throw err(400, 'Không mở được mục này — chọn lại từ danh sách.');
      const { result } = await call('/api/v1/content/read', { query: { uri, limit: 2000 } });
      return String(result ?? '').slice(0, 200_000);
    },
    async search(query) {
      const q = String(query ?? '').trim();
      if (q.length < 2 || q.length > 200) throw err(400, 'Gõ 2–200 ký tự để tìm.');
      // Tìm đúng trong các gốc cho phép: kho trí nhớ theo nhóm/người (tài khoản "zalo") không chen mất 20 chỗ kết quả.
      const { user } = conf();
      const target = ['viking://resources', `viking://user/${user}/memories`, `viking://user/${user}/peers`];
      const { result } = await call('/api/v1/search/find', { method: 'POST', body: { query: q, limit: 20, target_uri: target } });
      return ['memories', 'resources'].flatMap((k) => (Array.isArray(result?.[k]) ? result[k] : []))
        .filter((h) => allowedUri(h?.uri, user))
        .map((h) => ({ uri: h.uri, score: Number(h.score) || 0, abstract: String(h.abstract || '').slice(0, 600) }))
        .sort((a, b) => b.score - a.score);
    },
    async addNote({ title, text }) {
      const t = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const body = String(text ?? '').replace(/\r\n/g, '\n').trim();
      if (!t || !body) throw err(400, 'Cần tiêu đề và nội dung ghi chú.');
      if (body.length > MAX_NOTE) throw err(400, `Ghi chú tối đa ${MAX_NOTE} ký tự — chia thành nhiều ghi chú.`);
      const uri = noteUri(t, now());
      await call('/api/v1/content/write', { method: 'POST', body: { uri, content: `# ${t}\n\n${body}\n`, mode: 'create' } });
      return uri;
    },
  };
}
