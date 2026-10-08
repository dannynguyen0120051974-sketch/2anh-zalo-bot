/**
 * Kết nối MCP (spec §18.6, chỉ Quản trị): các máy chủ MCP trong `mcp_servers` của config.yaml Hermes.
 * - Xem: tên, kiểu (http/stdio), đích rút gọn (máy:cổng, hoặc tên lệnh), bật/tắt, có mở cho thành viên không
 *   (ZALO_PUBLIC_MCP). KHÔNG BAO GIỜ trả `env`, `headers`, `args`, đường dẫn/chuỗi truy vấn của URL (hay chứa khoá).
 * - Trạng thái: chỉ dò TCP tới địa chỉ loopback (127.0.0.1/localhost), có thời hạn; máy ngoài không dò (tránh biến
 *   dashboard thành cầu quét mạng). stdio: không chạy lệnh để dò — "không kiểm được từ dashboard".
 * - Bật/tắt: sửa đúng dòng `mcp_servers.<tên>.enabled` (Hermes bỏ qua máy chủ có enabled: false) → cần khởi động
 *   lại trợ lý. KHÔNG có "thêm máy chủ mới" — thêm = chạy lệnh tuỳ ý trên máy chủ; dùng `hermes mcp install` ở máy.
 */
import { connect } from 'node:net';
import { basename } from 'node:path';
import { editConfigYaml, readConfigYaml } from './config-yaml.js';

export const SERVER_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const truthy = (v) => !(v === false || /^(false|0|no|off)$/i.test(String(v ?? '').trim()));

/** fnmatch đơn giản của Python (`*`, `?`) như `_mcp_open_to_members` của plugin. */
export function globMatch(pattern, text) {
  const re = new RegExp(`^${String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  return re.test(text);
}

/** Một mục mcp_servers → dạng an toàn để hiện. */
export function describeServer(name, cfg, publicPatterns = []) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  let transport = 'stdio'; let target = ''; let host = ''; let port = 0;
  if (c.url) {
    transport = 'http';
    try { const u = new URL(String(c.url)); host = u.hostname; port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80); target = `${u.protocol}//${u.host}`; } catch { target = '(địa chỉ hỏng)'; }
  } else if (c.command) target = basename(String(c.command)).slice(0, 60);
  return {
    name, transport, target, enabled: truthy(c.enabled ?? true), loopback: LOOPBACK.has(host),
    publicToMembers: publicPatterns.some((p) => globMatch(p, name) || globMatch(p, `mcp-${name}`)), host, port,
  };
}

const probeTcp = (host, port, timeoutMs = 1500) => new Promise((resolve) => {
  const s = connect({ host: host.replace(/^\[|\]$/g, ''), port });
  const done = (ok) => { s.destroy(); resolve(ok); };
  s.setTimeout(timeoutMs, () => done(false));
  s.once('connect', () => done(true));
  s.once('error', () => done(false));
});

export function createMcpServers({ configFile, publicMcp = () => '', probe = probeTcp }) {
  const patterns = () => String(publicMcp() || '').split(',').map((s) => s.trim()).filter(Boolean);
  const servers = () => {
    const m = readConfigYaml(configFile)?.mcp_servers;
    return m && typeof m === 'object' && !Array.isArray(m) ? Object.entries(m).filter(([n]) => SERVER_NAME.test(n)) : [];
  };
  return {
    async list() {
      const pats = patterns();
      return Promise.all(servers().map(async ([name, cfg]) => {
        const { host, port, ...d } = describeServer(name, cfg, pats);
        let status = 'Chạy cùng trợ lý — không kiểm được từ dashboard';
        if (!d.enabled) status = 'Đã tắt';
        else if (d.transport === 'http') status = d.loopback ? ((await probe(host, port)) ? 'Đang mở' : 'Không phản hồi') : 'Máy ngoài — không kiểm';
        return { ...d, status };
      }));
    },
    setEnabled(name, enabled) {
      if (!SERVER_NAME.test(String(name)) || !servers().some(([n]) => n === name)) throw err(404, 'Không có kết nối MCP này — tải lại trang.');
      if (typeof enabled !== 'boolean') throw err(400, 'Giá trị bật/tắt không hợp lệ.');
      return editConfigYaml(configFile, [{ path: ['mcp_servers', name, 'enabled'], value: enabled }]);
    },
  };
}
