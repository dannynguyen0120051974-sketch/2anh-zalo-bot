/**
 * Kho tri thức (spec §18.5): thư mục `ZALO_KB_DIR` mà bot tra bằng `zalo_kb_list`/`zalo_kb_read`. Dashboard liệt kê
 * đúng những tệp bot được đọc (cùng luật lọc với plugin `tools.py`: phạm vi `ZALO_KB_PUBLIC_DIRS`, bỏ thư mục ẩn,
 * thư mục mã nguồn, tên gợi ý dữ liệu riêng), tải tệp mới vào MỘT thư mục riêng `tai-len-dashboard`, và chỉ xoá
 * được tệp trong thư mục đó — phần còn lại của kho là tài liệu của chủ bot, dashboard không đụng.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { writeFileAtomic } from './json-store.js';

export const UPLOAD_DIR = 'tai-len-dashboard';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TYPES = ['.docx', '.pdf', '.md', '.txt'];
// Khớp tools.py (KB_TEXT_SUFFIXES | KB_DOC_SUFFIXES | KB_LINK_SUFFIXES, KB_SKIP_DIRS, KB_SKIP_PATTERNS).
const READABLE = new Set(['.md', '.txt', '.html', '.htm', '.json', '.yaml', '.yml', '.csv', '.xml', '.rst', '.ini', '.toml',
  '.docx', '.xlsx', '.pdf', '.doc', '.pptx', '.ppt', '.rtf', '.epub', '.odt', '.url']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '__pycache__', 'venv', '.venv', 'vendor', 'tmp', 'temp', 'cache']);
const SKIP_PATTERNS = ['backup', 'order', 'customer', 'khach', 'don-hang', 'donhang', 'secret', 'credential', 'password', 'token', 'private'];
const MAX_FILES = 3000;
const LIST_TTL_MS = 60_000;

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const NOT_ALLOWED = 'Chỉ xoá được tệp đã tải lên từ dashboard — tài liệu khác trong kho hãy xoá trên máy.';

export function parsePublicDirs(raw) {
  return String(raw ?? '').split(',').map((s) => s.trim().replace(/^\/+|\/+$/g, '').toLowerCase()).filter(Boolean);
}

/** Như `_kb_allowed` của plugin: đường tương đối dạng a/b/c.pdf này bot có được thấy không. */
export function kbAllowed(rel, publicDirs) {
  const parts = rel.split('/');
  if (publicDirs.length && (parts.length < 2 || !publicDirs.includes(parts[0].trim().toLowerCase()))) return false;
  if (parts.some((p) => p.startsWith('.') || SKIP_DIRS.has(p.toLowerCase()))) return false;
  const low = rel.toLowerCase();
  return !SKIP_PATTERNS.some((p) => low.includes(p));
}

/** Tên tệp an toàn trên cả Windows lẫn Linux; giữ chữ có dấu. Rỗng → lỗi 400. */
export function safeFileName(raw) {
  // eslint-disable-next-line no-control-regex
  const name = basename(String(raw ?? '').replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^\.+/, '').slice(0, 120);
  const ext = extname(name).toLowerCase();
  if (!name || name === ext) throw err(400, 'Tên tệp không hợp lệ — đổi tên tệp rồi tải lại.');
  if (!UPLOAD_TYPES.includes(ext)) throw err(400, `Chỉ nhận ${UPLOAD_TYPES.join(', ')} — đổi định dạng rồi tải lại.`);
  return name;
}

/** Kiểm nội dung khớp đuôi: PDF "%PDF-", DOCX là ZIP có word/document.xml, MD/TXT là UTF-8 không có byte 0. */
export function checkContent(name, buf) {
  if (!buf?.length) throw err(400, 'Tệp rỗng — chọn tệp khác.');
  if (buf.length > MAX_UPLOAD_BYTES) throw err(413, 'Tệp quá 10 MB — chia nhỏ hoặc nén lại rồi tải lên.');
  const ext = extname(name).toLowerCase();
  if (ext === '.pdf' && buf.subarray(0, 5).toString('latin1') === '%PDF-') return;
  if (ext === '.docx' && buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && buf.includes('word/document.xml')) return;
  if (ext === '.md' || ext === '.txt') {
    if (!buf.includes(0)) {
      try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return; } catch { /* không phải UTF-8 */ }
    }
  }
  throw err(400, 'Nội dung tệp không khớp với đuôi tệp — mở bằng Word/trình đọc PDF rồi lưu lại đúng định dạng.');
}

/** `kbDir`, `publicDirs`: đọc lại mỗi lần (người cài đặt có thể đổi .env). */
export function createKbStore({ kbDir, publicDirs, now = Date.now }) {
  let cache = null;
  function root() {
    const raw = String(kbDir() || '').trim();
    if (!raw) return null;
    try { const r = realpathSync(resolve(raw)); return statSync(r).isDirectory() ? r : null; } catch { return null; }
  }
  function uploadDir(r, scope) {
    if (!scope.length) return join(r, UPLOAD_DIR);
    const first = readdirSync(r, { withFileTypes: true }).find((d) => d.isDirectory() && d.name.trim().toLowerCase() === scope[0]);
    return join(r, first ? first.name : scope[0], UPLOAD_DIR);
  }
  /** Thư mục tải lên phải là thư mục thật nằm trong kho — không phải liên kết trỏ ra ngoài. */
  function assertRealInside(r, dir) {
    let real;
    try { real = realpathSync(dir); } catch { return false; }
    const rel = relative(r, real);
    if (!rel || rel.startsWith('..') || resolve(r, rel) !== real || real !== resolve(dir)) throw err(403, 'Thư mục tải lên không nằm trong kho — báo người cài đặt kiểm tra.');
    return true;
  }
  function walk(r, scope) {
    const out = [];
    const stack = [''];
    while (stack.length && out.length < MAX_FILES) {
      const relDir = stack.pop();
      let entries;
      try { entries = readdirSync(join(r, relDir), { withFileTypes: true }); } catch { continue; }
      for (const d of entries) {
        const rel = relDir ? `${relDir}/${d.name}` : d.name;
        if (d.isSymbolicLink()) continue;
        if (d.isDirectory()) { if (!d.name.startsWith('.') && !SKIP_DIRS.has(d.name.toLowerCase()) && rel.split('/').length < 8) stack.push(rel); continue; }
        if (!d.isFile() || !READABLE.has(extname(d.name).toLowerCase()) || !kbAllowed(rel, scope)) continue;
        let st; try { st = statSync(join(r, rel)); } catch { continue; }
        out.push({ path: rel, size: st.size, mtime: st.mtimeMs, uploaded: rel.split('/').includes(UPLOAD_DIR) });
        if (out.length >= MAX_FILES) break;
      }
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  }
  return {
    info() {
      const r = root();
      const scope = parsePublicDirs(publicDirs());
      return { configured: Boolean(r), publicDirs: scope, uploadDir: r ? relative(r, uploadDir(r, scope)).split(sep).join('/') : null };
    },
    list({ fresh = false } = {}) {
      const r = root();
      if (!r) return { files: [], truncated: false };
      const scope = parsePublicDirs(publicDirs());
      const key = `${r}|${scope.join(',')}`;
      if (fresh || !cache || cache.key !== key || now() - cache.at > LIST_TTL_MS) cache = { key, at: now(), files: walk(r, scope) };
      return { files: cache.files, truncated: cache.files.length >= MAX_FILES };
    },
    upload(rawName, buf) {
      const r = root();
      if (!r) throw err(409, 'Chưa cấu hình kho tri thức (ZALO_KB_DIR) — báo người cài đặt.');
      const name = safeFileName(rawName);
      checkContent(name, buf);
      const dir = uploadDir(r, parsePublicDirs(publicDirs()));
      if (existsSync(dir)) assertRealInside(r, dir);
      mkdirSync(dir, { recursive: true });
      assertRealInside(r, dir);
      const ext = extname(name); const stem = name.slice(0, -ext.length);
      let final = name;
      for (let i = 2; existsSync(join(dir, final)); i += 1) final = `${stem} (${i})${ext}`;
      writeFileAtomic(join(dir, final), buf, { mode: 0o644 });
      cache = null;
      return relative(r, join(dir, final)).split(sep).join('/');
    },
    remove(rel) {
      const r = root();
      if (!r) throw err(409, 'Chưa cấu hình kho tri thức (ZALO_KB_DIR) — báo người cài đặt.');
      const dir = uploadDir(r, parsePublicDirs(publicDirs()));
      const target = resolve(r, String(rel ?? ''));
      const inside = relative(dir, target);
      if (!inside || inside.startsWith('..') || inside.includes(sep) || resolve(dir, inside) !== target) throw err(403, NOT_ALLOWED);
      if (!assertRealInside(r, dir)) throw err(404, 'Tệp không còn — tải lại trang.');
      let st; try { st = lstatSync(target); } catch { throw err(404, 'Tệp không còn — tải lại trang.'); }
      if (!st.isFile()) throw err(403, NOT_ALLOWED);
      unlinkSync(target);
      cache = null;
    },
  };
}
