// Khoá API & Model (chỉ Quản trị): mỗi chức năng dùng AI một thẻ (model gì, qua đâu, nút Thử, đổi model chính);
// mỗi khoá dịch vụ một dòng (dùng cho gì, đã đặt chưa ••••1234, Kiểm tra, Thay khoá — không bao giờ hiện khoá cũ).
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { Dialog, html, Icon, Live, PageHead, Spinner } from '../ui.js';
import { fold } from '../fold.js';
import { RestartBanner } from './restart-banner.js';
import { modelOptions } from './agent.js';

const fmtMs = (ms) => (ms < 1000 ? `${ms} ms` : `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(ms / 1000)} giây`);

/** Câu kết quả "Thử"/"Kiểm tra": ✓ … (1,2 giây) / ✗ … */
export function resultText(r) {
  if (!r) return '';
  return r.ok ? `Được — ${r.reply ? `"${r.reply}"` : r.detail} (${fmtMs(r.ms)})` : `Không được — ${r.detail}`;
}

function Models({ onRestart }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [tests, setTests] = useState({});
  const [msg, setMsg] = useState({});
  useEffect(() => { api('/api/admin/ai/models').then(setData).catch((e) => setMsg({ error: e.message })); }, []);
  async function test(id, model) {
    setBusy(id); setTests((t) => ({ ...t, [id]: null }));
    try { const r = await api('/api/admin/ai/test', { method: 'POST', body: { model } }); setTests((t) => ({ ...t, [id]: r })); } catch (e) { setTests((t) => ({ ...t, [id]: { ok: false, detail: e.message } })); } finally { setBusy(''); }
  }
  async function setModel(model) {
    setBusy('main'); setMsg({});
    try { const r = await api('/api/admin/ai/model', { method: 'PUT', body: { model } }); setData((d) => ({ ...d, ...r })); setMsg({ ok: `Đã đổi model chính sang ${model} — có hiệu lực từ tin nhắn tiếp theo.` }); onRestart(); } catch (e) { setMsg({ error: e.message }); } finally { setBusy(''); }
  }
  if (!data) return html`<${Live} error=${msg.error} />${msg.error ? null : html`<${Spinner} />`}`;
  const main = data.cards.find((c) => c.id === 'main');
  return html`<${Live} error=${msg.error} ok=${msg.ok} />
    <div class="ai-cards">${data.cards.map((c) => html`<section key=${c.id} class="ai-card">
      <h3>${c.label}</h3>
      <p class="ai-model">${c.model || html`<span class="muted">—</span>`}</p>
      ${c.via ? html`<p class="muted small">Qua: <span class="mono">${c.via}</span></p>` : null}
      ${c.note ? html`<p class="muted small">${c.note}</p>` : null}
      ${c.id === 'main' ? html`<div class="field"><label for="ai-main">Đổi model chính</label>
        <input type="search" placeholder="Lọc, vd. gemini" aria-label="Lọc model" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
        <select id="ai-main" value=${main.model} disabled=${busy !== '' || !data.models.length} onChange=${(e) => setModel(e.currentTarget.value)}>
          ${modelOptions({ current: main.model, choices: data.choices, all: data.models, q }).map((m) => html`<option key=${m} value=${m}>${m}${m === data.defaultModel ? ' (mặc định /model)' : ''}</option>`)}
        </select>
        ${data.listError ? html`<small class="muted">${data.listError}</small>` : html`<small class="muted">Danh sách lấy từ cổng AI (gồm cả combo). Đổi là có hiệu lực ngay, như lệnh /model trong Zalo.</small>`}</div>` : null}
      ${c.testable ? html`<p><button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => test(c.id, c.model)}>${busy === c.id ? 'Đang thử…' : 'Thử'}</button></p>` : null}
      ${tests[c.id] ? html`<p class=${`ai-result ${tests[c.id].ok ? 'is-ok' : 'is-bad'}`} role="status">${resultText(tests[c.id])}</p>` : null}
    </section>`)}</div>
    <p class="muted small"><${Icon} name="info" size=${14} /> Mức suy nghĩ và tính cách của bot nằm ở trang Agent. Giọng đọc, nghe giọng nói, tạo ảnh đặt bằng cấu hình trên máy chủ — nhờ người cài đặt nếu muốn đổi.</p>`;
}

function KeyDialog({ row, available, onSaved, onClose }) {
  const [key, setKey] = useState(row?.key || '');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e, remove = false) {
    e?.preventDefault();
    if (remove && !confirm(`Gỡ khoá ${row.label}? Tính năng dùng khoá này sẽ ngừng sau khi khởi động lại trợ lý.`)) return;
    setBusy(true); setError('');
    try { onSaved(await api(`/api/admin/ai/keys/${encodeURIComponent(key)}`, { method: 'PUT', body: { value: remove ? '' : value.trim() } }), remove ? 'Đã gỡ khoá.' : 'Đã lưu khoá mới — khởi động lại trợ lý để áp dụng.'); } catch (err) { setError(err.message); setBusy(false); }
  }
  return html`<${Dialog} title=${row ? `Thay khoá — ${row.label}` : 'Thêm khoá dịch vụ'} onClose=${onClose} dirty=${() => !busy && Boolean(value)}>
    <form class="stack" onSubmit=${save}>
      ${row ? html`<p class="muted small">${row.feature}${row.set ? ` · Đang dùng khoá ${row.hint}` : ' · Chưa đặt'}</p>`
        : html`<label class="field"><span>Dịch vụ</span><select value=${key} onChange=${(e) => setKey(e.currentTarget.value)}>
          <option value="">— Chọn dịch vụ —</option>${available.map((a) => html`<option key=${a.key} value=${a.key}>${a.label}</option>`)}</select>
          ${key ? html`<small class="muted">${available.find((a) => a.key === key)?.feature}</small>` : null}</label>`}
      <label class="field"><span>Khoá mới</span>
        <input type="password" autocomplete="off" spellcheck="false" class="mono" value=${value} placeholder="Dán khoá dịch vụ cấp" onInput=${(e) => setValue(e.currentTarget.value)} />
        <small class="muted">Khoá cũ không bao giờ hiện ra. Lưu xong cần khởi động lại trợ lý.</small></label>
      <${Live} error=${error} />
      <div class="dialog-actions">
        <button class="btn btn-primary" disabled=${busy || !value.trim() || !key}>${busy ? 'Đang lưu…' : 'Lưu khoá'}</button>
        ${row?.set && row.key !== 'model.api_key' ? html`<button type="button" class="btn btn-danger-outline" disabled=${busy} onClick=${(e) => save(e, true)}>Gỡ khoá</button>` : null}
      </div>
    </form>
  <//>`;
}

function Keys({ onRestart }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [tests, setTests] = useState({});
  const [open, setOpen] = useState(null); // { row } | { row: null } (thêm)
  const [msg, setMsg] = useState({});
  useEffect(() => { api('/api/admin/ai/keys').then(setData).catch((e) => setMsg({ error: e.message })); }, []);
  async function test(row) {
    setBusy(row.key); setTests((t) => ({ ...t, [row.key]: null }));
    try { const r = await api(`/api/admin/ai/keys/${encodeURIComponent(row.key)}/test`, { method: 'POST' }); setTests((t) => ({ ...t, [row.key]: r })); } catch (e) { setTests((t) => ({ ...t, [row.key]: { ok: false, detail: e.message } })); } finally { setBusy(''); }
  }
  const saved = (r, text) => { setData(r); setOpen(null); setMsg({ ok: text }); setTests({}); onRestart(); };
  if (!data) return html`<${Live} error=${msg.error} />${msg.error ? null : html`<${Spinner} />`}`;
  const n = fold(q).trim();
  const rows = data.keys.filter((k) => !n || fold(`${k.label} ${k.feature} ${k.key}`).includes(n));
  const known = rows.filter((k) => k.known);
  const others = rows.filter((k) => !k.known);
  const line = (k) => html`<li key=${k.key} class="row-item">
    <span class="row-main"><strong>${k.label}</strong><small class="muted">${k.feature || k.key}</small></span>
    <span class=${`badge ${k.set ? 'badge-ok' : 'badge-idle'}`}>${k.set ? `Đã đặt ${k.hint}` : 'Chưa đặt'}</span>
    ${k.testable && k.set ? html`<button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => test(k)}>${busy === k.key ? 'Đang kiểm…' : 'Kiểm tra'}</button>` : null}
    ${k.editable ? html`<button type="button" class="btn btn-secondary btn-sm" aria-label=${`Thay khoá ${k.label}`} onClick=${() => setOpen({ row: k })}>${k.set ? 'Thay khoá' : 'Đặt khoá'}</button>` : null}
    ${tests[k.key] ? html`<p class=${`ai-result row-full ${tests[k.key].ok ? 'is-ok' : 'is-bad'}`} role="status">${resultText(tests[k.key])}</p>` : null}
  </li>`;
  return html`<${Live} error=${msg.error} ok=${msg.ok} />
    <div class="toolbar"><label class="sr-only" for="key-q">Tìm khoá</label>
      <input id="key-q" type="search" placeholder="Tìm theo dịch vụ, tính năng…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
      ${data.available.length ? html`<button type="button" class="btn btn-primary btn-sm" onClick=${() => setOpen({ row: null })}><${Icon} name="plus" size=${14} /> Thêm khoá dịch vụ</button>` : null}</div>
    <ul class="row-list">${known.map(line)}</ul>
    ${others.length ? html`<h3>Khoá khác <small class="muted">${others.length}</small></h3><ul class="row-list">${others.map(line)}</ul>` : null}
    <p class="muted small"><${Icon} name="info" size=${14} /> "Kiểm tra" gọi thử dịch vụ bằng khoá đang lưu (Tavily/Exa tính một lượt tìm). Khoá chỉ hiện 4 ký tự cuối; Nhật ký chỉ ghi tên khoá.</p>
    ${open ? html`<${KeyDialog} row=${open.row} available=${data.available} onSaved=${saved} onClose=${() => setOpen(null)} />` : null}`;
}

const TAB_KEY = 'zd-ai-tab';
export function Ai() {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem(TAB_KEY) === 'keys' ? 'keys' : 'models'; } catch { return 'models'; } });
  const [rev, setRev] = useState(0);
  const pick = (t) => { setTab(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* tiện ích */ } };
  return html`<${PageHead} title="Khoá API & Model" sub="Bot đang dùng model AI nào cho từng việc, và các khoá dịch vụ đã cài. Chỉ Quản trị." />
    <${RestartBanner} version=${rev} />
    <section class="card">
      <div class="chips" role="group" aria-label="Mục">
        <button type="button" class="btn btn-secondary btn-sm chip" aria-pressed=${tab === 'models' ? 'true' : 'false'} onClick=${() => pick('models')}>Model AI</button>
        <button type="button" class="btn btn-secondary btn-sm chip" aria-pressed=${tab === 'keys' ? 'true' : 'false'} onClick=${() => pick('keys')}>Khoá API</button>
      </div>
      ${tab === 'models' ? html`<${Models} onRestart=${() => setRev((r) => r + 1)} />` : html`<${Keys} onRestart=${() => setRev((r) => r + 1)} />`}
    </section>`;
}
