// Kết nối MCP (spec §18.6, chỉ Quản trị): máy chủ MCP của trợ lý — xem, bật/tắt. Thêm mới chỉ làm trên máy chủ.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Live, Notice, PageHead, Spinner } from '../ui.js';
import { RestartBanner } from './restart-banner.js';

/** Màu nhãn trạng thái. */
export function mcpKind(status) {
  return { 'Đang mở': 'ok', 'Chạy cùng trợ lý — không kiểm được từ dashboard': 'idle', 'Không phản hồi': 'danger', 'Đã tắt': 'idle' }[status] || 'warn';
}

export function Mcp() {
  const [list, setList] = useState(null);
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => { api('/api/admin/mcp').then((r) => setList(r.servers)).catch((e) => setMsg({ error: e.message })); }, []);
  async function toggle(s) {
    const enabled = !s.enabled;
    if (!confirm(`${enabled ? 'Bật' : 'Tắt'} kết nối ${s.name}? Cần khởi động lại trợ lý để áp dụng.`)) return;
    setBusy(s.name); setMsg({});
    try { setList((await api(`/api/admin/mcp/${encodeURIComponent(s.name)}`, { method: 'PUT', body: { enabled } })).servers); setVersion((v) => v + 1); } catch (e) { setMsg({ error: e.message }); } finally { setBusy(''); }
  }
  return html`<${PageHead} title="Kết nối MCP" sub="Dịch vụ bên ngoài trợ lý dùng làm công cụ (tra tài liệu, lịch, tệp…). Chỉ Quản trị." />
    <${RestartBanner} version=${version} />
    <${Notice} kind="info">Muốn thêm kết nối mới: người cài đặt chạy <span class="mono">${'hermes mcp install <tên>'}</span> trên máy chủ. Dashboard không thêm được vì việc đó chạy chương trình trên máy chủ.<//>
    <section class="card">
      <${Live} error=${msg.error} />
      ${!list && !msg.error ? html`<${Spinner} />` : null}
      ${list && !list.length ? html`<p class="muted">Trợ lý chưa có kết nối MCP nào.</p>` : null}
      <ul class="row-list">${(list || []).map((s) => html`<li key=${s.name} class="row-item">
        <span class="row-main"><strong>${s.name}</strong><small class="muted mono">${s.transport === 'http' ? s.target : `lệnh: ${s.target}`}</small>
          <small class="muted">${s.publicToMembers ? 'Thành viên nhóm dùng được (ZALO_PUBLIC_MCP)' : 'Chỉ chủ nhân dùng'}</small></span>
        <span class=${`badge badge-${mcpKind(s.status)}`}>${s.status}</span>
        <button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => toggle(s)}>${s.enabled ? 'Tắt' : 'Bật'}</button>
      </li>`)}</ul>
    </section>`;
}
