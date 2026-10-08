// Kho tri thức (spec §18.5): tài liệu bot được tra; tải tệp mới vào thư mục riêng; xoá tệp đã tải lên từ đây.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api, NETWORK_ERROR } from '../api.js';
import { html, fmtTime, Icon, Live, Notice, PageHead, Spinner } from '../ui.js';
import { fold } from '../fold.js';

/** "12 KB", "3,4 MB". */
export function fmtSize(bytes) {
  const n = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${n.format(bytes / 1024)} KB`;
  return `${n.format(bytes / 1024 / 1024)} MB`;
}

/** Kiểm trước khi gửi (máy chủ kiểm lại): đuôi và cỡ. Trả câu lỗi hoặc ''. */
export function uploadProblem(file, types, maxBytes) {
  const ext = (/\.[^.]+$/.exec(file.name)?.[0] || '').toLowerCase();
  if (!types.includes(ext)) return `Chỉ nhận ${types.join(', ')} — đổi định dạng rồi tải lại.`;
  if (file.size > maxBytes) return `Tệp quá ${fmtSize(maxBytes)} — chia nhỏ hoặc nén lại rồi tải lên.`;
  if (!file.size) return 'Tệp rỗng — chọn tệp khác.';
  return '';
}

async function sendFile(file) {
  let res;
  try {
    res = await fetch('/api/kb/upload', {
      method: 'POST', credentials: 'same-origin', body: file,
      headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'zalo-dashboard', 'X-File-Name': encodeURIComponent(file.name) },
    });
  } catch { throw new Error(NETWORK_ERROR); }
  let json = {};
  try { json = await res.json(); } catch { /* không phải JSON */ }
  if (res.status === 401) window.dispatchEvent(new Event('zd:logout'));
  if (!res.ok || json.ok === false) throw new Error(json.error || `Lỗi ${res.status} — thử lại.`);
  return json;
}

export function Kb() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState(false);
  const load = (fresh) => api(`/api/kb${fresh ? '?fresh=1' : ''}`).then(setData).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { load(); }, []);
  async function onPick(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    const problem = uploadProblem(file, data.uploadTypes, data.maxBytes);
    if (problem) { setMsg({ error: problem }); return; }
    setBusy(true); setMsg({});
    try { const r = await sendFile(file); setMsg({ ok: `Đã tải lên ${r.path}. Bot thấy tệp mới trong vòng 5 phút.` }); await load(true); } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }
  async function remove(f) {
    if (!confirm(`Xoá ${f.path}?`)) return;
    try { await api('/api/kb/file', { method: 'DELETE', body: { path: f.path } }); setMsg({ ok: 'Đã xoá.' }); await load(true); } catch (err) { setMsg({ error: err.message }); }
  }
  const head = html`<${PageHead} title="Kho tri thức" sub="Tài liệu bot được tra cứu khi trả lời trong nhóm và tin nhắn riêng." />`;
  if (!data) return html`${head}<${Live} error=${msg.error} />${msg.error ? null : html`<${Spinner} />`}`;
  if (!data.configured) return html`${head}<${Notice} kind="info">Chưa có kho tri thức — người cài đặt cần đặt ZALO_KB_DIR trong cài đặt của trợ lý.<//>`;
  const n = fold(q).trim();
  const files = n ? data.files.filter((f) => fold(f.path).includes(n)) : data.files;
  return html`${head}
    <section class="card">
      <h2>Tải tài liệu lên</h2>
      <p class="muted small">Nhận ${data.uploadTypes.join(', ')}, tối đa ${fmtSize(data.maxBytes)}. Tệp được lưu vào thư mục <span class="mono">${data.uploadDir}</span>.
        ${data.publicDirs.length ? ` Bot chỉ đọc các thư mục: ${data.publicDirs.join(', ')}.` : ''}</p>
      <label class="btn btn-primary file-btn">
        <input class="sr-only" type="file" accept=${data.uploadTypes.join(',')} disabled=${busy} onChange=${onPick} />
        <${Icon} name="plus" size=${16} /> ${busy ? 'Đang tải lên…' : 'Chọn tệp…'}</label>
      <${Live} error=${msg.error} ok=${msg.ok} />
    </section>
    <section class="card">
      <div class="toolbar"><h2>Tài liệu bot đọc được <small class="muted">${data.files.length}${data.truncated ? '+' : ''}</small></h2>
        <label class="sr-only" for="kb-q">Tìm tài liệu</label>
        <input id="kb-q" type="search" placeholder="Tìm theo tên hoặc thư mục…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
        <button type="button" class="btn btn-secondary btn-sm" onClick=${() => load(true)}><${Icon} name="refresh" size=${16} /> Tải lại</button></div>
      ${data.truncated ? html`<${Notice} kind="info">Kho lớn — chỉ hiện 3000 tệp mới sửa gần nhất.<//>` : null}
      <ul class="row-list">${files.slice(0, 500).map((f) => html`<li key=${f.path} class="row-item">
        <${Icon} name="file" />
        <span class="row-main"><span class="mono">${f.path}</span><small class="muted">${fmtSize(f.size)} · ${fmtTime(f.mtime)}</small></span>
        ${f.uploaded ? html`<button type="button" class="btn btn-secondary btn-sm" onClick=${() => remove(f)}>Xoá</button>` : null}
      </li>`)}</ul>
      ${files.length > 500 ? html`<p class="muted small">Còn ${files.length - 500} tệp — gõ để tìm cụ thể hơn.</p>` : null}
    </section>`;
}
