// Second brain (spec §18.5.4, chỉ Quản trị, chỉ máy chủ Linux bật ZALO_SECOND_BRAIN_URL): tìm, xem kho OpenViking, thêm ghi chú.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, fmtTime, Icon, Live, Notice, PageHead, Spinner } from '../ui.js';

/** Tên ngắn của một mục: phần cuối URI, bỏ ".md". */
export function entryName(uri) {
  const last = String(uri).replace(/\/+$/, '').split('/').pop() || uri;
  try { return decodeURIComponent(last).replace(/\.md$/, ''); } catch { return last.replace(/\.md$/, ''); }
}

/** Đường dẫn lên một cấp, không vượt khỏi gốc đang xem. */
export function parentUri(uri, root) {
  if (uri === root) return null;
  const up = uri.replace(/\/[^/]+\/?$/, '');
  return up.length < root.length ? root : up;
}

function Reader({ uri, onClose }) {
  const [text, setText] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/api/admin/second-brain/read?${new URLSearchParams({ uri })}`).then((r) => setText(r.text)).catch((e) => setError(e.message)); }, [uri]);
  return html`<section class="card">
    <div class="toolbar"><h2>${entryName(uri)}</h2><button type="button" class="btn btn-secondary btn-sm" onClick=${onClose}><${Icon} name="close" size=${14} /> Đóng</button></div>
    <p class="muted small mono">${uri}</p>
    <${Live} error=${error} />
    ${text === null && !error ? html`<${Spinner} />` : html`<pre class="sb-text">${text}</pre>`}
  </section>`;
}

export function SecondBrain() {
  const [roots, setRoots] = useState([]);
  const [root, setRoot] = useState('');
  const [cwd, setCwd] = useState('');
  const [entries, setEntries] = useState(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [open, setOpen] = useState('');
  const [note, setNote] = useState({ title: '', text: '' });
  const [msg, setMsg] = useState({});
  const [st, setSt] = useState(null);
  useEffect(() => {
    api('/api/admin/second-brain/status').then((s) => {
      setSt(s);
      if (s.enabled) return api('/api/admin/second-brain/roots').then((r) => { setRoots(r.roots); setRoot(r.roots[0]); setCwd(r.roots[0]); });
      return null;
    }).catch((e) => setMsg({ error: e.message }));
  }, []);
  useEffect(() => { if (cwd) { setEntries(null); api(`/api/admin/second-brain/list?${new URLSearchParams({ uri: cwd })}`).then((r) => setEntries(r.entries)).catch((e) => setMsg({ error: e.message })); } }, [cwd]);
  async function search(e) {
    e.preventDefault(); setMsg({});
    try { setHits((await api(`/api/admin/second-brain/search?${new URLSearchParams({ q })}`)).hits); } catch (err) { setMsg({ error: err.message }); }
  }
  async function addNote(e) {
    e.preventDefault(); setMsg({});
    try { const r = await api('/api/admin/second-brain/notes', { method: 'POST', body: note }); setNote({ title: '', text: '' }); setMsg({ ok: `Đã lưu ghi chú: ${r.uri}` }); } catch (err) { setMsg({ error: err.message }); }
  }
  const up = root ? parentUri(cwd, root) : null;
  const head = html`<${PageHead} title="Second brain" sub="Kho ghi nhớ dài hạn (OpenViking) trên máy chủ: tìm, xem và thêm ghi chú. Chỉ Quản trị." />`;
  if (!st) return html`${head}<${Live} error=${msg.error} />${msg.error ? null : html`<${Spinner} />`}`;
  if (!st.enabled) return html`${head}<${Notice} kind="info">${st.note}<//>`;
  return html`${head}
    <${Live} error=${msg.error} ok=${msg.ok} />
    ${open ? html`<${Reader} uri=${open} onClose=${() => setOpen('')} />` : null}
    <section class="card">
      <form class="toolbar" onSubmit=${search}><label class="sr-only" for="sb-q">Tìm trong kho</label>
        <input id="sb-q" type="search" placeholder="Tìm theo ý nghĩa, vd. 'quyết định về dashboard'" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
        <button class="btn btn-primary btn-sm"><${Icon} name="search" size=${16} /> Tìm</button></form>
      ${hits ? html`<ul class="row-list">${hits.length ? hits.map((h) => html`<li key=${h.uri} class="row-item">
        <span class="row-main"><button type="button" class="link-btn" onClick=${() => setOpen(h.uri)}>${entryName(h.uri)}</button><small class="muted">${h.abstract}</small></span>
        <span class="badge">${Math.round(h.score * 100)}%</span></li>`) : html`<li class="muted">Không thấy gì.</li>`}</ul>` : null}
    </section>
    <section class="card">
      <div class="toolbar"><div class="chips" role="group" aria-label="Gốc">
        ${roots.map((r) => html`<button key=${r} type="button" class="btn btn-secondary btn-sm chip" aria-pressed=${root === r ? 'true' : 'false'} onClick=${() => { setRoot(r); setCwd(r); }}>${entryName(r)}</button>`)}</div>
        ${up ? html`<button type="button" class="btn btn-secondary btn-sm" onClick=${() => setCwd(up)}><${Icon} name="prev" size=${14} /> Lên</button>` : null}</div>
      <p class="muted small mono">${cwd}</p>
      ${!entries ? html`<${Spinner} />` : null}
      <ul class="row-list">${(entries || []).map((e) => html`<li key=${e.uri} class="row-item">
        <${Icon} name=${e.dir ? 'list' : 'file'} />
        <span class="row-main"><button type="button" class="link-btn" onClick=${() => (e.dir ? setCwd(e.uri) : setOpen(e.uri))}>${entryName(e.uri)}</button>
          ${e.abstract ? html`<small class="muted">${e.abstract}</small>` : null}</span>
        ${e.modTime ? html`<small class="muted">${fmtTime(Date.parse(e.modTime))}</small>` : null}</li>`)}</ul>
    </section>
    <form class="card" onSubmit=${addNote} novalidate>
      <h2>Thêm ghi chú</h2>
      <p class="muted small">Lưu vào viking://resources/so-tay-dashboard/ — không sửa hay xoá gì có sẵn.</p>
      <div class="field"><label for="sb-title">Tiêu đề</label><input id="sb-title" maxlength="120" value=${note.title} onInput=${(e) => setNote({ ...note, title: e.currentTarget.value })} /></div>
      <div class="field"><label for="sb-text">Nội dung</label><textarea id="sb-text" rows="5" maxlength="8000" value=${note.text} onInput=${(e) => setNote({ ...note, text: e.currentTarget.value })}></textarea></div>
      <button class="btn btn-primary" disabled=${!note.title.trim() || !note.text.trim()}>Lưu ghi chú</button>
    </form>`;
}
