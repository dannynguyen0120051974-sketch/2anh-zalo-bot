// Theo dõi agent (spec §18.6, chỉ Quản trị), dạng gọn: mỗi cuộc trò chuyện một dòng (gộp các phiên, bỏ phiên trống);
// bấm cả dòng để mở các lượt gần nhất — mỗi lượt chỉ hiện người hỏi + câu hỏi thật, bấm lượt mới thấy công cụ và câu
// trả lời; model/token thu thành một dòng nhỏ cuối. Tham số công cụ chỉ hiện tên, không hiện nội dung.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, fmtTime, Live, PageHead, Spinner } from '../ui.js';
import { fold } from '../fold.js';

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

/** Dòng tóm tắt một cuộc trò chuyện: "64 lượt · 5 công cụ · 18 phiên" (bỏ phần bằng 0, "1 phiên"). */
export function chatSummary(c) {
  const bits = [c.turns ? `${fmtNum(c.turns)} lượt` : '', c.toolCalls ? `${fmtNum(c.toolCalls)} công cụ` : '', c.sessions > 1 ? `${fmtNum(c.sessions)} phiên` : ''];
  return bits.filter(Boolean).join(' · ') || 'Chưa có lượt nào';
}

/** Tên hiển thị: tên nhóm/người; việc hẹn giờ/CLI không có hội thoại thì dùng tiêu đề phiên. */
export const chatLabel = (c) => c.chatName || c.title || (c.source === 'cron' ? 'Việc hẹn giờ' : 'Phiên khác');

const statusClass = (st) => `badge ${st === 'lỗi' ? 'badge-danger' : st === 'xong' ? 'badge-ok' : 'badge-idle'}`;

function Turns({ chat }) {
  const [turns, setTurns] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/api/admin/trace/chats/${encodeURIComponent(chat.key)}/turns`).then((r) => setTurns(r.turns)).catch((e) => setError(e.message)); }, [chat.key]);
  const meta = html`<p class="trace-meta"><span>Model ${chat.model || '—'}</span><span>${fmtNum(chat.apiCalls)} lượt gọi AI</span>
    <span>Token vào ${fmtNum(chat.input)} / ra ${fmtNum(chat.output)}${chat.cached ? ` (đệm ${fmtNum(chat.cached)})` : ''}</span></p>`;
  if (error) return html`<${Live} error=${error} />`;
  if (!turns) return html`<${Spinner} />`;
  return html`${turns.length ? html`<ol class="trace-turns">${turns.map((t) => {
    const failed = t.tools.filter((c) => c.status === 'lỗi').length;
    return html`<li key=${t.at}><details class="trace-turn">
      <summary><small class="muted">${fmtTime(t.at)}</small>
        <span class="trace-q">${t.who ? html`<strong>${t.who}:</strong> ` : null}${t.user || '(không có chữ)'}</span>
        ${t.tools.length ? html`<small class="muted">${t.tools.length} công cụ${failed ? html` · <span class="badge badge-danger">${failed} lỗi</span>` : ''}</small>` : null}</summary>
      <div class="trace-detail">
        ${t.tools.length ? html`<ul class="trace-tools">${t.tools.map((c, i) => html`<li key=${i}>
          <span class="mono">${c.name}</span> <span class=${statusClass(c.status)}>${c.status}</span>
          <small class="muted">${fmtMs(c.ms)}${c.args.length ? ` · ${c.args.map((a) => `${a.key} (${a.kind})`).join(', ')}` : ''}</small></li>`)}</ul>` : null}
        ${t.reply ? html`<p>Đáp: ${t.reply}</p>` : html`<p class="muted small">Không có câu trả lời bằng chữ.</p>`}
        <p class="muted small">Mất ${fmtMs(t.ms)}</p>
      </div>
    </details></li>`;
  })}</ol>` : html`<p class="muted">Chưa có lượt nào.</p>`}${meta}`;
}

export function Trace() {
  const [source, setSource] = useState('zalo');
  const [list, setList] = useState(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const load = (before) => api(`/api/admin/trace/chats?source=${source}&limit=${PAGE}${before ? `&before=${before}` : ''}`)
    .then((r) => {
      setList((cur) => { const prev = before ? cur || [] : []; const seen = new Set(prev.map((c) => c.key)); return [...prev, ...r.chats.filter((c) => !seen.has(c.key))]; });
      setMore(r.chats.length === PAGE);
    })
    .catch((e) => setError(e.message));
  useEffect(() => { setList(null); setError(''); setOpen(''); load(); }, [source]);
  const n = fold(q).trim();
  const shown = (list || []).filter((c) => !n || fold(chatLabel(c)).includes(n));
  const last = list && list.length ? list[list.length - 1] : null;
  return html`<${PageHead} title="Theo dõi agent" sub="Trợ lý đã làm gì trong từng cuộc trò chuyện. Bấm vào một dòng để xem các lượt gần nhất." />
    <section class="card">
      <div class="toolbar">
        <div class="chips" role="group" aria-label="Nguồn">
          ${SOURCES.map((s) => html`<button key=${s.value} type="button" class="btn btn-secondary btn-sm chip" aria-pressed=${source === s.value ? 'true' : 'false'} onClick=${() => setSource(s.value)}>${s.label}</button>`)}
        </div>
        <label class="sr-only" for="trace-q">Lọc theo tên</label>
        <input id="trace-q" type="search" placeholder="Lọc theo tên nhóm/người…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
      </div>
      <${Live} error=${error} />
      ${!list && !error ? html`<${Spinner} />` : null}
      ${list && !shown.length ? html`<p class="muted">${n ? 'Không có cuộc trò chuyện nào trùng tên.' : 'Chưa có cuộc trò chuyện nào.'}</p>` : null}
      <ul class="row-list">${shown.map((c) => html`<li key=${c.key} class="trace-chat">
        <button type="button" class="trace-row" aria-expanded=${open === c.key ? 'true' : 'false'} onClick=${() => setOpen(open === c.key ? '' : c.key)}>
          <span class="trace-caret" aria-hidden="true">▸</span>
          <span class="row-main"><strong>${chatLabel(c)}</strong><small class="muted">${fmtTime(c.lastAt)} · ${chatSummary(c)}</small></span>
        </button>
        ${open === c.key ? html`<div class="trace-box"><${Turns} chat=${c} /></div>` : null}
      </li>`)}</ul>
      ${more && last && !n ? html`<button type="button" class="btn btn-secondary btn-sm" onClick=${() => load(last.lastAt)}>Xem cuộc trò chuyện cũ hơn</button>` : null}
    </section>`;
}
