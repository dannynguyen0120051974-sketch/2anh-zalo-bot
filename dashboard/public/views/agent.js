// Agent (spec §18.6, chỉ Quản trị): model, mức suy nghĩ, tính cách (SOUL.md) có lịch sử và khôi phục.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, fmtTime, Live, PageHead, SaveBar, Spinner } from '../ui.js';
import { RestartBanner } from './restart-banner.js';

export const REASONING_LABELS = { none: 'Không suy nghĩ', minimal: 'Rất ít', low: 'Ít', medium: 'Vừa (mặc định)', high: 'Nhiều', xhigh: 'Rất nhiều', max: 'Tối đa', ultra: 'Cực đại' };

/** Danh sách model hiển thị: chọn nhanh trước, rồi phần còn lại của cổng AI (lọc theo chữ), luôn có model đang dùng. */
export function modelOptions({ current, choices, all, q }) {
  const n = q.trim().toLowerCase();
  const rest = all.filter((m) => !choices.includes(m) && (!n || m.toLowerCase().includes(n)));
  const out = [...new Set([current, ...choices, ...rest])].filter(Boolean);
  return out.slice(0, 200);
}

export function Agent() {
  const [data, setData] = useState(null);
  const [soul, setSoul] = useState('');
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState('');
  const [version, setVersion] = useState(0);
  const [preview, setPreview] = useState(null);
  const take = (r) => { setData(r); setSoul(r.soul.text); setVersion((v) => v + 1); };
  useEffect(() => {
    api('/api/admin/agent').then(take).catch((e) => setMsg({ error: e.message }));
  }, []);
  async function run(key, path, body, ok) {
    setBusy(key); setMsg({});
    try { take(await api(path, { method: key === 'restore' ? 'POST' : 'PUT', body })); setMsg({ ok }); } catch (e) { setMsg({ error: e.message }); } finally { setBusy(''); }
  }
  const head = html`<${PageHead} title="Agent" sub="Bot suy nghĩ kỹ đến đâu và tính cách ra sao. Chỉ Quản trị." />`;
  if (!data) return html`${head}<${Live} error=${msg.error} />${msg.error ? null : html`<${Spinner} />`}`;
  const dirty = soul !== data.soul.text;
  return html`${head}<${RestartBanner} version=${version} />
    <${Live} error=${msg.error} ok=${msg.ok} />
    <section class="card">
      <h2>Mức suy nghĩ</h2>
      <p class="muted small">Model AI và khoá dịch vụ nằm ở trang <a href="#/ai">Khoá API &amp; Model</a>.</p>
      <div class="field"><label for="ag-reason">Mức suy nghĩ</label>
        <select id="ag-reason" value=${data.reasoning} disabled=${busy !== ''} onChange=${(e) => run('reason', '/api/admin/agent/reasoning', { value: e.currentTarget.value }, 'Đã lưu — khởi động lại trợ lý để áp dụng.')}>
          ${data.reasoningChoices.map((v) => html`<option key=${v} value=${v}>${REASONING_LABELS[v] || v}</option>`)}</select>
        <small class="muted">Suy nghĩ nhiều thì trả lời kỹ hơn nhưng chậm hơn và tốn lượt AI hơn. Không phải model nào cũng hỗ trợ.</small></div>
    </section>
    <form class="card" onSubmit=${(e) => { e.preventDefault(); run('soul', '/api/admin/agent/soul', { text: soul }, 'Đã lưu tính cách — khởi động lại trợ lý để áp dụng.'); }}>
      <h2>Tính cách (SOUL.md)</h2>
      <p class="muted small">Đoạn đầu tiên của lời nhắc hệ thống: bot là ai, xưng hô thế nào, giọng điệu ra sao. ${soul.length}/${data.soul.max} ký tự.</p>
      <label class="sr-only" for="ag-soul">Tính cách</label>
      <textarea id="ag-soul" class="mono soul-edit" rows="14" maxlength=${data.soul.max} value=${soul} onInput=${(e) => setSoul(e.currentTarget.value)}></textarea>
      ${data.zaloHint ? html`<details class="more-hint"><summary>Lời dặn riêng cho Zalo (config.yaml — chỉ xem)</summary><pre class="sb-text">${data.zaloHint}</pre></details>` : null}
      <${SaveBar} count=${dirty ? 1 : 0} busy=${busy === 'soul'} canSave=${dirty && soul.trim() !== ''} onUndo=${() => setSoul(data.soul.text)} idle="Chưa sửa gì." />
    </form>
    <section class="card">
      <h2>Lịch sử tính cách</h2>
      ${data.soul.history.length ? null : html`<p class="muted">Chưa sửa lần nào trên dashboard.</p>`}
      <ul class="row-list">${data.soul.history.map((h) => html`<li key=${h.id} class="row-item">
        <span class="row-main"><strong>${h.original ? 'Bản gốc (trước lần sửa đầu tiên)' : fmtTime(h.at)}</strong><small class="muted">${h.by ? `trước khi ${h.by} sửa · ` : ''}${h.size} byte</small></span>
        <button type="button" class="btn btn-secondary btn-sm" onClick=${() => api(`/api/admin/agent/soul/history/${h.id}`).then((r) => setPreview({ id: h.id, text: r.text })).catch((e) => setMsg({ error: e.message }))}>Xem</button>
        <button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => confirm('Khôi phục bản này? Bản hiện tại vẫn được cất vào lịch sử.') && run('restore', `/api/admin/agent/soul/restore/${h.id}`, undefined, 'Đã khôi phục — khởi động lại trợ lý để áp dụng.')}>Khôi phục</button>
      </li>`)}</ul>
      ${preview ? html`<pre class="sb-text">${preview.text}</pre>` : null}
    </section>`;
}
