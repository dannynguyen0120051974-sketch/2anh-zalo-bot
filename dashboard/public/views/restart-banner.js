// Dải vàng "đã đổi cài đặt, cần khởi động lại" dùng chung cho Agent, Kết nối MCP, Cấu hình (spec §18.6, chỉ Quản trị).
// `version` đổi (trang vừa lưu) → đọc lại cờ.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live } from '../ui.js';

/** Câu cho dải vàng từ cờ máy chủ; không có gì chờ → ''. */
export function restartText(flags) {
  const reasons = [...(flags?.assistant?.reasons || []), ...(flags?.sidecar?.reasons || [])];
  if (!reasons.length) return '';
  const who = flags.sidecar ? 'trợ lý và kết nối Zalo' : 'trợ lý';
  return `Đã đổi: ${reasons.join(', ')}. Cần khởi động lại ${who} để áp dụng (bot im khoảng 1–3 phút).`;
}

export function RestartBanner({ version = 0 }) {
  const [flags, setFlags] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const load = () => api('/api/admin/restart-flags').then(setFlags).catch(() => {});
  useEffect(() => { load(); }, [version]);
  const text = restartText(flags);
  async function restart() {
    if (!confirm('Khởi động lại bây giờ? Bot sẽ không trả lời trong 1–3 phút.')) return;
    setBusy(true); setMsg({});
    try {
      const r = await api('/api/admin/restart-assistant', { method: 'POST' });
      setMsg(r.warning ? { error: r.warning } : { ok: 'Đã khởi động lại — thay đổi đã được áp dụng.' });
      await load();
    } catch (e) { setMsg({ error: e.message }); } finally { setBusy(false); }
  }
  if (!text && !msg.ok && !msg.error) return null;
  return html`<div class="notice notice-warn restart-banner">
    <${Icon} name="warn" />
    <div>${text ? html`<p>${text}</p>
      <button type="button" class="btn btn-primary btn-sm" disabled=${busy} onClick=${restart}>${busy ? 'Đang khởi động lại…' : 'Khởi động lại ngay'}</button>` : null}
      <${Live} error=${msg.error} ok=${msg.ok} /></div>
  </div>`;
}
