// Insight nhóm (spec §18.5): lượng tin theo ngày, người nhắn nhiều, giờ sôi nổi (SVG, chỉ class — CSP), loại tin.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Live, Notice, PageHead, Spinner } from '../ui.js';
import { InsightAi } from './insight-ai.js';

export const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
export const KIND_LABELS = { text: 'Chữ', photo: 'Ảnh/Video', file: 'Tệp', link: 'Có link', sticker: 'Nhãn dán', voice: 'Thoại', other: 'Khác' };
const fmtNum = (n) => new Intl.NumberFormat('vi-VN').format(n);

/** Mức màu 0–4 của một ô bản đồ giờ so với ô đông nhất (0 = không có tin). */
export function heatLevel(n, max) {
  if (!n || !max) return 0;
  return Math.min(4, Math.max(1, Math.ceil((n / max) * 4)));
}

/** "dd/mm" từ "YYYY-MM-DD". */
export const dayLabel = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

function DayBars({ perDay }) {
  const W = 300; const H = 120;
  const max = Math.max(1, ...perDay.map((d) => d.total));
  const bw = W / perDay.length;
  const top = perDay.reduce((a, d) => (d.total > (a?.total ?? -1) ? d : a), null);
  return html`<figure class="chart-box chart-bars">
    <figcaption class="muted small">Số tin mỗi ngày (phần đậm: tin của bot)</figcaption>
    <svg class="chart" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label=${`Số tin mỗi ngày trong ${perDay.length} ngày${top?.total ? `; nhiều nhất ${fmtNum(top.total)} tin ngày ${dayLabel(top.date)}` : ''}`}>
      <line class="chart-grid" x1="0" x2=${W} y1=${H} y2=${H} />
      ${perDay.map((d, i) => {
        const h = (d.total / max) * (H - 4); const hb = (d.bot / max) * (H - 4);
        return html`<g key=${d.date}><rect class="chart-bar chart-bar-soft" x=${(i * bw + bw * 0.15).toFixed(1)} y=${(H - h).toFixed(1)} width=${(bw * 0.7).toFixed(1)} height=${h.toFixed(1)}>
          <title>${dayLabel(d.date)}: ${fmtNum(d.total)} tin (${fmtNum(d.bot)} của bot)</title></rect>
          <rect class="chart-bar" x=${(i * bw + bw * 0.15).toFixed(1)} y=${(H - hb).toFixed(1)} width=${(bw * 0.7).toFixed(1)} height=${hb.toFixed(1)} /></g>`;
      })}
    </svg>
    <div class="chart-axis"><span>${dayLabel(perDay[0].date)}</span><span>${dayLabel(perDay.at(-1).date)}</span></div>
  </figure>`;
}

function Heat({ heat }) {
  const max = Math.max(0, ...heat.flat());
  return html`<figure class="chart-box">
    <figcaption class="muted small">Giờ thành viên nhắn nhiều (giờ Việt Nam)</figcaption>
    <table class="heat" aria-label="Số tin theo thứ và giờ">
      <thead><tr><th scope="col"><span class="sr-only">Thứ</span></th>${[0, 6, 12, 18].map((h) => html`<th key=${h} scope="col" colspan="6">${h}h</th>`)}</tr></thead>
      <tbody>${heat.map((row, d) => html`<tr key=${d}><th scope="row">${WEEKDAYS[d]}</th>
        ${row.map((n, h) => html`<td key=${h} class=${`heat-${heatLevel(n, max)}`} title=${`${WEEKDAYS[d]} ${h}h: ${fmtNum(n)} tin`}><span class="sr-only">${n}</span></td>`)}</tr>`)}</tbody>
    </table>
  </figure>`;
}

export function Insight() {
  const [groups, setGroups] = useState(null);
  const [sel, setSel] = useState('');
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/api/chats').then((r) => {
      const list = (r.conversations || []).filter((c) => c.threadType === 1);
      setGroups(list); if (list[0]) setSel(list[0].threadId);
    }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!sel) return;
    setData(null);
    api(`/api/insight/groups/${sel}?days=${days}`).then((r) => { setData(r); setError(''); }).catch((e) => setError(e.message));
  }, [sel, days]);
  const head = html`<${PageHead} title="Insight nhóm" sub="Nhóm sôi nổi lúc nào, ai nhắn nhiều, bot trả lời bao nhiêu — từ lịch sử bot lưu." />`;
  if (groups && !groups.length) return html`${head}<${Notice} kind="info">Bot chưa có tin nhắn nhóm nào trong lịch sử.<//>`;
  return html`${head}
    <section class="card">
      <div class="toolbar">
        <div class="field"><label for="ins-group">Nhóm</label>
          <select id="ins-group" value=${sel} onChange=${(e) => setSel(e.currentTarget.value)}>
            ${(groups || []).map((g) => html`<option key=${g.threadId} value=${g.threadId}>${g.name}</option>`)}</select></div>
        <div class="chips" role="group" aria-label="Khoảng thời gian">
          ${[7, 30, 90].map((d) => html`<button key=${d} type="button" class="btn btn-secondary btn-sm chip" aria-pressed=${days === d ? 'true' : 'false'} onClick=${() => setDays(d)}>${d} ngày</button>`)}
        </div>
      </div>
      <${Live} error=${error} />
      ${!data && !error ? html`<${Spinner} />` : null}
      ${data?.unavailable ? html`<${Notice} kind="info">Chưa có lịch sử trò chuyện.<//>` : null}
      ${data?.totals ? html`
        <div class="grid grid-3">
          <div class="stat"><span class="muted small">Tin nhắn</span><strong class="stat-value">${fmtNum(data.totals.messages)}</strong></div>
          <div class="stat"><span class="muted small">Người có nhắn</span><strong class="stat-value">${fmtNum(data.totals.members)}</strong></div>
          <div class="stat"><span class="muted small">Bot trả lời</span><strong class="stat-value">${fmtNum(data.totals.bot)}</strong></div>
        </div>
        <div class="charts"><${DayBars} perDay=${data.perDay} /><${Heat} heat=${data.heat} /></div>
        <div class="grid grid-2">
          <div><h3>Nhắn nhiều nhất</h3>
            ${data.top.length ? html`<ol class="top-list">${data.top.map((p) => html`<li key=${p.name}><span>${p.name}</span><strong>${fmtNum(p.count)}</strong></li>`)}</ol>` : html`<p class="muted">Chưa có ai nhắn.</p>`}</div>
          <div><h3>Loại tin</h3>
            <ul class="top-list">${Object.entries(KIND_LABELS).map(([k, label]) => html`<li key=${k}><span>${label}</span><strong>${fmtNum(data.kinds[k])}</strong></li>`)}</ul></div>
        </div>
        <${InsightAi} groupId=${sel} days=${Math.min(days, 30)} />` : null}
    </section>`;
}
