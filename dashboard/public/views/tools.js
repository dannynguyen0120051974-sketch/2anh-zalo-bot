// Công cụ (spec §18.6, chỉ Quản trị): mọi công cụ Zalo của bot, ai dùng được, nút nào điều khiển; tắt riêng công cụ
// công khai cho người không phải chủ nhân (chồng lên các nút ở Phân quyền Bot).
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, fmtTime, Live, Notice, PageHead, SaveBar, Spinner } from '../ui.js';
import { fold } from '../fold.js';

/** Nhóm công cụ theo mức quyền, giữ thứ tự của plugin. */
export function groupTools(tools) {
  const out = new Map();
  for (const t of tools) { if (!out.has(t.level)) out.set(t.level, []); out.get(t.level).push(t); }
  return [...out].map(([level, list]) => ({ level, list }));
}

/** Số khác biệt giữa bản nháp và đã lưu (tập tên công cụ tắt). */
export const offDiff = (draft, saved) => [...draft].filter((n) => !saved.has(n)).length + [...saved].filter((n) => !draft.has(n)).length;

export function Tools() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(new Set());
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState(false);
  const take = (r) => { setData(r); setDraft(new Set(r.tools.filter((t) => t.off).map((t) => t.name))); };
  useEffect(() => { api('/api/admin/tools').then(take).catch((e) => setMsg({ error: e.message })); }, []);
  const head = html`<${PageHead} title="Công cụ" sub="Những việc bot làm được, ai được nhờ, và nút nào ở Phân quyền Bot điều khiển. Chỉ Quản trị." />`;
  if (!data) return html`${head}<${Live} error=${msg.error} />${msg.error ? null : html`<${Spinner} />`}`;
  if (!data.available) return html`${head}<${Notice} kind="info">Trợ lý chưa ghi danh sách công cụ — cập nhật plugin lên bản mới rồi khởi động lại trợ lý.<//>`;
  const saved = new Set(data.tools.filter((t) => t.off).map((t) => t.name));
  const count = offDiff(draft, saved);
  const n = fold(q).trim();
  const toggle = (name, on) => { const d = new Set(draft); if (on) d.delete(name); else d.add(name); setDraft(d); };
  async function save(e) {
    e.preventDefault(); setBusy(true); setMsg({});
    try { take(await api('/api/admin/tools', { method: 'PUT', body: { off: [...draft] } })); setMsg({ ok: 'Đã lưu — có hiệu lực ngay từ tin nhắn sau.' }); } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }
  return html`${head}
    <form class="card" onSubmit=${save}>
      <div class="toolbar"><label class="sr-only" for="tool-q">Tìm công cụ</label>
        <input id="tool-q" type="search" placeholder="Tìm theo tên hoặc mô tả…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
        <small class="muted">Danh sách cập nhật lúc ${fmtTime(data.generatedAt)}</small></div>
      ${data.publicMcp.length ? html`<${Notice} kind="info">Công cụ MCP mở cho thành viên (ZALO_PUBLIC_MCP): ${data.publicMcp.join(', ')}. Đổi ở trang Cấu hình của người cài đặt.<//>` : null}
      ${groupTools(data.tools.filter((t) => !n || fold(`${t.name} ${t.description}`).includes(n))).map((g) => html`<div key=${g.level} class="mem-block">
        <h3>${g.level} <small class="muted">${g.list.length}</small></h3>
        <ul class="row-list">${g.list.map((t) => html`<li key=${t.name} class="row-item">
          <span class="row-main"><strong class="mono">${t.name}</strong><small>${t.description}</small>
            <small class="muted">${t.switch ? `Nút: ${t.switch}` : 'Không có nút ở Phân quyền Bot'}${t.confirm ? ' · cần mã xác nhận' : ''}${t.dmOnly ? ' · chỉ trong tin nhắn riêng' : ''}${t.registered ? '' : ' · đang tắt ở cài đặt (ZALO_FRIEND_TOOLS)'}</small></span>
          ${t.toolset === 'zalo_public' ? html`<label class="check"><input type="checkbox" checked=${!draft.has(t.name)} onChange=${(e) => toggle(t.name, e.currentTarget.checked)} />Cho người ngoài dùng</label>`
            : html`<span class="badge badge-idle">Người ngoài không dùng được</span>`}
        </li>`)}</ul></div>`)}
      <${SaveBar} count=${count} busy=${busy} canSave=${count > 0} onUndo=${() => setDraft(saved)} idle="Chưa có thay đổi." msg=${msg} />
    </form>`;
}
