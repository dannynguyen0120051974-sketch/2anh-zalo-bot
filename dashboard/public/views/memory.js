// Trí nhớ (spec §18.5): sổ người quen của bot (cả hai vai trò) và bộ nhớ của trợ lý Hermes (chỉ Quản trị).
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, fmtTime, Icon, Live, PageHead, Spinner } from '../ui.js';

/** Bản nháp sửa hồ sơ: luôn có ít nhất một dòng "thông tin thêm" trống để gõ tiếp. */
export function personDraft(p) {
  return { name: p?.name || '', note: p?.note || '', fields: [...(p?.fields || []), { key: '', value: '' }] };
}

/** Thân PUT /api/people/:uid — bỏ dòng thông tin thêm trống hoàn toàn. */
export function personPayload(d, updatedAt) {
  const out = { name: d.name, note: d.note, fields: d.fields.filter((f) => f.key.trim() || f.value.trim()) };
  if (updatedAt !== undefined) out.updatedAt = updatedAt;   // mốc sửa khách đã thấy: bot sửa sau đó thì server trả 409
  return out;
}

/** "1.234/2.200 ký tự (56 %)" cho thanh dung lượng bộ nhớ. */
export function usageText(used, limit) {
  const n = new Intl.NumberFormat('vi-VN');
  return `${n.format(used)}/${n.format(limit)} ký tự (${limit ? Math.min(100, Math.round((used / limit) * 100)) : 0} %)`;
}

function PersonEditor({ person, onDone, onStale }) {
  const [d, setD] = useState(personDraft(person));
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState(false);
  const setField = (i, k, v) => { const fields = d.fields.map((f, j) => (j === i ? { ...f, [k]: v } : f)); if (i === fields.length - 1 && v) fields.push({ key: '', value: '' }); setD({ ...d, fields }); };
  async function save(e) {
    e.preventDefault(); setBusy(true); setMsg({});
    try { await api(`/api/people/${person.uid}`, { method: 'PUT', body: personPayload(d, person.updatedAt ?? null) }); onDone('Đã lưu hồ sơ.'); } catch (err) { if (err.status === 409) onStale(err.message); else setMsg({ error: err.message }); } finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm(`Xoá hồ sơ của ${person.name || person.uid}? Bot sẽ không còn nhớ người này.`)) return;
    setBusy(true); setMsg({});
    try { await api(`/api/people/${person.uid}`, { method: 'DELETE', body: { updatedAt: person.updatedAt ?? null } }); onDone('Đã xoá hồ sơ.'); } catch (err) { if (err.status === 409) onStale(err.message); else { setMsg({ error: err.message }); setBusy(false); } }
  }
  return html`<form class="mem-editor" onSubmit=${save} novalidate>
    <div class="field"><label for=${`pn-${person.uid}`}>Tên gọi</label>
      <input id=${`pn-${person.uid}`} maxlength="80" value=${d.name} onInput=${(e) => setD({ ...d, name: e.currentTarget.value })} /></div>
    <div class="field"><label for=${`pt-${person.uid}`}>Ghi chú</label>
      <textarea id=${`pt-${person.uid}`} maxlength="400" rows="2" value=${d.note} onInput=${(e) => setD({ ...d, note: e.currentTarget.value })}></textarea></div>
    <fieldset class="field"><legend>Thông tin thêm (tối đa 12 mục)</legend>
      ${d.fields.map((f, i) => html`<div class="mem-field" key=${i}>
        <input aria-label="Tên mục" placeholder="vd. môn dạy" maxlength="40" value=${f.key} onInput=${(e) => setField(i, 'key', e.currentTarget.value)} />
        <input aria-label="Nội dung" placeholder="vd. Hoá học" maxlength="120" value=${f.value} onInput=${(e) => setField(i, 'value', e.currentTarget.value)} />
      </div>`)}
    </fieldset>
    <${Live} error=${msg.error} />
    <div class="row form-end">
      <button class="btn btn-primary" disabled=${busy}>${busy ? 'Đang lưu…' : 'Lưu'}</button>
      <button type="button" class="btn btn-secondary" disabled=${busy} onClick=${() => onDone('')}>Huỷ</button>
      <button type="button" class="btn btn-danger-outline" disabled=${busy} onClick=${remove}>Xoá hồ sơ</button>
    </div>
  </form>`;
}

function People() {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState({});
  const [open, setOpen] = useState('');
  const load = () => api(`/api/people?${new URLSearchParams({ q })}`).then((r) => setData(r)).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { const id = setTimeout(load, 250); return () => clearTimeout(id); }, [q]);
  const done = (text) => { setOpen(''); setMsg(text ? { ok: text } : {}); load(); };
  const stale = (text) => { setOpen(''); setMsg({ error: text }); load(); };   // bot vừa sửa hồ sơ: đóng form, tải lại danh sách
  return html`<section class="card">
    <h2>Sổ người quen</h2>
    <p class="muted small">Bot tự ghi khi được dặn "nhớ giúp…" (tự khai — không dùng để cấp quyền). Sửa ở đây có hiệu lực ngay từ tin nhắn sau.</p>
    <div class="toolbar"><label class="sr-only" for="people-q">Tìm hồ sơ</label>
      <input id="people-q" type="search" placeholder="Tìm theo tên, ghi chú, UID…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
      ${data ? html`<small class="muted">${data.total} hồ sơ</small>` : null}</div>
    <${Live} error=${msg.error} ok=${msg.ok} />
    ${!data && !msg.error ? html`<${Spinner} />` : null}
    ${data && !data.people.length ? html`<p class="muted">${data.total ? 'Không có hồ sơ nào khớp.' : 'Bot chưa nhớ ai.'}</p>` : null}
    <ul class="row-list">${(data?.people || []).map((p) => html`<li key=${p.uid} class="row-item">
      <span class="row-main"><strong>${p.name || 'Chưa rõ tên'}</strong><small class="muted mono">${p.uid}</small>
        ${p.note ? html`<small>${p.note}</small>` : null}
        ${p.fields.length ? html`<small class="muted">${p.fields.map((f) => `${f.key}: ${f.value}`).join(' · ')}</small>` : null}
        <small class="muted">Sửa lần cuối ${fmtTime(p.updatedAt)}${p.updatedBy.startsWith('dashboard:') ? ` trên dashboard (${p.updatedBy.slice(10)})` : ''}</small></span>
      <button type="button" class="btn btn-secondary btn-sm" aria-expanded=${open === p.uid ? 'true' : 'false'} onClick=${() => setOpen(open === p.uid ? '' : p.uid)}>Sửa</button>
      ${open === p.uid ? html`<${PersonEditor} person=${p} onDone=${done} onStale=${stale} />` : null}
    </li>`)}</ul>
  </section>`;
}

function AgentEntry({ target, index, text, onSaved }) {
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState('');
  async function run(method, body) {
    setMsg('');
    try { onSaved(await api(`/api/admin/agent-memory/${target}/${index}`, { method, body })); setEdit(null); } catch (e) { setMsg(e.message); }
  }
  return html`<li class="row-item">
    ${edit === null ? html`<span class="row-main mem-text">${text}</span>
      <button type="button" class="btn btn-secondary btn-sm" onClick=${() => setEdit(text)}>Sửa</button>
      <button type="button" class="btn btn-secondary btn-sm" onClick=${() => confirm('Xoá mục này khỏi bộ nhớ của trợ lý?') && run('DELETE', { old: text })}>Xoá</button>`
    : html`<span class="row-main"><label class="sr-only" for=${`am-${target}-${index}`}>Nội dung mục</label>
      <textarea id=${`am-${target}-${index}`} rows="3" value=${edit} onInput=${(e) => setEdit(e.currentTarget.value)}></textarea></span>
      <button type="button" class="btn btn-primary btn-sm" onClick=${() => run('PUT', { old: text, text: edit })}>Lưu</button>
      <button type="button" class="btn btn-secondary btn-sm" onClick=${() => setEdit(null)}>Huỷ</button>`}
    ${msg ? html`<p class="dm-add-error" role="alert">${msg}</p>` : null}
  </li>`;
}

function AgentMemory() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/admin/agent-memory').then(setData).catch((e) => setError(e.message)); }, []);
  return html`<section class="card">
    <h2>Bộ nhớ của trợ lý <span class="badge">Quản trị</span></h2>
    <p class="muted small">Trợ lý tự ghi những điều cần nhớ lâu dài. Sửa ở đây áp dụng từ phiên trò chuyện mới.</p>
    <${Live} error=${error} />
    ${!data && !error ? html`<${Spinner} />` : null}
    ${data ? ['memory', 'user'].map((t) => html`<div key=${t} class="mem-block">
      <h3>${data[t].label} <small class="muted">${usageText(data[t].used, data[t].limit)}</small></h3>
      ${data[t].entries.length ? null : html`<p class="muted">Chưa có mục nào.</p>`}
      <ul class="row-list">${data[t].entries.map((text, i) => html`<${AgentEntry} key=${`${t}-${i}-${text.length}`} target=${t} index=${i} text=${text} onSaved=${setData} />`)}</ul>
    </div>`) : null}
  </section>`;
}

export function Memory({ me }) {
  return html`<${PageHead} title="Trí nhớ" sub="Những gì bot nhớ về mọi người và về chủ nhân." />
    <${People} />
    ${me?.role === 'admin' ? html`<${AgentMemory} />` : null}
    <p class="muted small"><${Icon} name="info" size=${14} /> Tài liệu dài để bot tra cứu nằm ở Kho tri thức.</p>`;
}
