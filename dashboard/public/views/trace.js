// Theo dõi agent (spec §18.6, chỉ Quản trị), dạng gọn: mỗi phiên một dòng (tên · lần cuối · số lượt/công cụ);
// số liệu kỹ thuật (model, token) và từng lượt chỉ hiện khi bấm. Tham số công cụ chỉ hiện tên, không hiện nội dung.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, fmtTime, Live, PageHead, Spinner } from '../ui.js';

export const SOURCES = [{ value: 'zalo', label: 'Zalo' }, { value: 'cron', label: 'Việc hẹn giờ' }, { value: 'all', label: 'Tất cả' }];
const PAGE = 50;
const fmtNum = (n) => new Intl.NumberFormat('vi-VN').format(n);

/** "850 ms", "2,5 giây", "1 phút 5 giây". */
export function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(ms / 1000)} giây`;
  return `${Math.floor(ms / 60_000)} phút ${Math.round((ms % 60_000) / 1000)} giây`;
}

/** Dòng tóm tắt của một phiên: "12 tin · 5 công cụ" (bỏ phần bằng 0). */
export function sessionSummary(s) {
  const bits = [s.messages ? `${fmtNum(s.messages)} tin` : '', s.toolCalls ? `${fmtNum(s.toolCalls)} công cụ` : ''].filter(Boolean);
  return bits.join(' · ') || 'Chưa có hoạt động';
}

const statusClass = (st) => `badge ${st === 'lỗi' ? 'badge-danger' : st === 'xong' ? 'badge-ok' : 'badge-idle'}`;

function Turns({ id }) {
  const [turns, setTurns] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setTurns(null); api(`/api/admin/trace/sessions/${encodeURIComponent(id)}/turns`).then((r) => setTurns(r.turns)).catch((e) => setError(e.message)); }, [id]);
  if (error) return html`<${Live} error=${error} />`;
  if (!turns) return html`<${Spinner} />`;
  if (!turns.length) return html`<p class="muted">Phiên chưa có lượt nào.</p>`;
  return html`<ol class="trace-turns">${turns.map((t) => {
    const failed = t.tools.filter((c) => c.status === 'lỗi').length;
    return html`<li key=${t.at}><details class="trace-turn">
      <summary><small class="muted">${fmtTime(t.at)}</small><span class="trace-q">${t.user || '(không có chữ)'}</span>
        ${t.tools.length ? html`<small class="muted">${t.tools.length} công cụ${failed ? html` · <span class="badge badge-danger">${failed} lỗi</span>` : ''}</small>` : null}</summary>
      <div class="trace-detail">
        <p class="muted small">Mất ${fmtMs(t.ms)}</p>
        ${t.tools.length ? html`<ul class="trace-tools">${t.tools.map((c, i) => html`<li key=${i}>
          <span class="mono">${c.name}</span> <span class=${statusClass(c.status)}>${c.status}</span>
          <small class="muted">${fmtMs(c.ms)}${c.args.length ? ` · ${c.args.map((a) => `${a.key} (${a.kind})`).join(', ')}` : ''}</small></li>`)}</ul>` : null}
        ${t.reply ? html`<p>Đáp: ${t.reply}</p>` : html`<p class="muted small">Không có câu trả lời bằng chữ.</p>`}
      </div>
    </details></li>`;
  })}</ol>`;
}

export function Trace() {
  const [source, setSource] = useState('zalo');
  const [list, setList] = useState(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState('');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const load = (before) => api(`/api/admin/trace/sessions?source=${source}&limit=${PAGE}${before ? `&before=${before}` : ''}`)
    .then((r) => {
      setList((cur) => { const prev = before ? cur || [] : []; const seen = new Set(prev.map((s) => s.id)); return [...prev, ...r.sessions.filter((s) => !seen.has(s.id))]; });
      setMore(r.sessions.length === PAGE);
    })
    .catch((e) => setError(e.message));
  useEffect(() => { setList(null); setError(''); load(); }, [source]);
  const last = list && list.length ? list[list.length - 1] : null;
  return html`<${PageHead} title="Theo dõi agent" sub="Trợ lý đã làm gì trong từng phiên. Bấm vào phiên để xem từng lượt, bấm vào lượt để xem công cụ và câu trả lời." />
    <section class="card">
      <div class="chips" role="group" aria-label="Nguồn">
        ${SOURCES.map((s) => html`<button key=${s.value} type="button" class="btn btn-secondary btn-sm chip" aria-pressed=${source === s.value ? 'true' : 'false'} onClick=${() => { setSource(s.value); setOpen(''); setInfo(''); }}>${s.label}</button>`)}
      </div>
      <${Live} error=${error} />
      ${!list && !error ? html`<${Spinner} />` : null}
      ${list && !list.length ? html`<p class="muted">Chưa có phiên nào.</p>` : null}
      <ul class="row-list">${(list || []).map((s) => html`<li key=${s.id} class="row-item">
        <span class="row-main"><strong>${s.chatName || s.title || s.id}</strong>
          <small class="muted">${fmtTime(s.lastAt || s.startedAt)} · ${sessionSummary(s)}</small></span>
        <button type="button" class="btn btn-secondary btn-sm" aria-expanded=${info === s.id ? 'true' : 'false'} onClick=${() => setInfo(info === s.id ? '' : s.id)}>Chi tiết</button>
        <button type="button" class="btn btn-secondary btn-sm" aria-expanded=${open === s.id ? 'true' : 'false'} onClick=${() => setOpen(open === s.id ? '' : s.id)}>${open === s.id ? 'Thu gọn' : 'Xem lượt'}</button>
        ${info === s.id ? html`<p class="trace-meta">
          ${s.title && s.chatName ? html`<span>${s.title}</span>` : null}<span>Model ${s.model || '—'}</span>
          <span>${fmtNum(s.apiCalls)} lượt gọi AI</span><span>Token vào ${fmtNum(s.input)} / ra ${fmtNum(s.output)}${s.cached ? ` (đệm ${fmtNum(s.cached)})` : ''}</span>
          <span>Bắt đầu ${fmtTime(s.startedAt)}</span></p>` : null}
        ${open === s.id ? html`<div class="trace-box"><${Turns} id=${s.id} /></div>` : null}
      </li>`)}</ul>
      ${more && last ? html`<button type="button" class="btn btn-secondary btn-sm" onClick=${() => load(last.lastAt || last.startedAt)}>Xem phiên cũ hơn</button>` : null}
    </section>`;
}
