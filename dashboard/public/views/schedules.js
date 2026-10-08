// Lịch hẹn (spec §18.4): việc hẹn giờ của trợ lý gửi về Zalo (của chủ nhân và "hẹn giờ cho nhóm"), lời nhắc Zalo.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, fmtTime, Icon, Live, Notice, PageHead, Spinner } from '../ui.js';
import { fold } from '../fold.js';

export const REPEAT_LABELS = { 0: 'Một lần', 1: 'Hằng ngày', 2: 'Hằng tuần', 3: 'Hằng tháng' };

/** Trạng thái một việc hẹn giờ: { kind, text } cho nhãn màu. */
export function jobState(j) {
  if (!j.enabled) return { kind: 'idle', text: 'Đã tắt' };
  if (j.paused) return { kind: 'warn', text: 'Tạm dừng' };
  if (j.lastStatus && j.lastStatus !== 'ok') return { kind: 'danger', text: 'Lần trước lỗi' };
  return { kind: 'ok', text: 'Đang chạy' };
}

/** Lọc việc theo chữ không dấu (tên, lời nhắn, tên nhóm, người tạo). */
export function filterJobs(jobs, q) {
  const n = fold(q).trim();
  return n ? jobs.filter((j) => fold(`${j.name} ${j.prompt} ${j.targetName} ${j.creatorName}`).includes(n)) : jobs;
}

function Jobs() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState('');
  const load = () => api('/api/schedules').then(setData).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { load(); }, []);
  async function act(j, action) {
    const ask = { remove: `Xoá hẳn việc "${j.name}"? Không hoàn tác được.`, pause: `Tạm dừng "${j.name}"?` }[action];
    if (ask && !confirm(ask)) return;
    setBusy(j.id); setMsg({});
    try { await api(`/api/schedules/cron/${j.id}/${action}`, { method: 'POST' }); setMsg({ ok: { pause: 'Đã tạm dừng.', resume: 'Đã chạy lại.', remove: 'Đã xoá.' }[action] }); await load(); } catch (e) { setMsg({ error: e.message }); } finally { setBusy(''); }
  }
  const jobs = filterJobs(data?.jobs || [], q);
  const section = (kind, title, hint) => {
    const list = jobs.filter((j) => j.kind === kind);
    return html`<div class="mem-block"><h3>${title} <small class="muted">${list.length}</small></h3><p class="muted small">${hint}</p>
      ${list.length ? null : html`<p class="muted">Không có việc nào.</p>`}
      <ul class="row-list">${list.map((j) => { const st = jobState(j); return html`<li key=${j.id} class="row-item">
        <span class="row-main"><strong>${j.name || j.id}</strong>
          <small class="muted">${j.schedule} · gửi vào ${j.targetName}${j.creatorName ? ` · ${j.creatorName} tạo` : ''}</small>
          ${j.prompt ? html`<small>${j.prompt}</small>` : null}
          <small class="muted">Lần tới: ${fmtTime(j.nextRunAt)} · Lần trước: ${fmtTime(j.lastRunAt)}</small></span>
        <span class=${`badge badge-${st.kind}`}>${st.text}</span>
        ${j.paused ? html`<button class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => act(j, 'resume')}>Chạy lại</button>`
          : html`<button class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => act(j, 'pause')}>Tạm dừng</button>`}
        <button class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => act(j, 'remove')}>Xoá</button>
      </li>`; })}</ul></div>`;
  };
  return html`<section class="card">
    <h2>Việc hẹn giờ của trợ lý</h2>
    <div class="toolbar"><label class="sr-only" for="job-q">Tìm việc hẹn giờ</label>
      <input id="job-q" type="search" placeholder="Tìm theo tên, nhóm, người tạo…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
    <${Live} error=${msg.error} ok=${msg.ok} />
    ${data?.cronError ? html`<${Notice} kind="warn">${data.cronError}<//>` : null}
    ${!data && !msg.error ? html`<${Spinner} />` : null}
    ${data ? section('group', 'Hẹn giờ cho nhóm', 'Thành viên tạo bằng câu "nhắc nhóm mỗi…". Tắt nút "Hẹn giờ cho nhóm" ở Phân quyền Bot chỉ chặn tạo mới — việc đã có vẫn chạy cho tới khi tạm dừng hoặc xoá ở đây.') : null}
    ${data ? section('owner', 'Việc của chủ nhân', 'Chủ nhân nhờ trợ lý làm định kỳ và gửi kết quả về Zalo.') : null}
  </section>`;
}

function Reminders() {
  const [convs, setConvs] = useState(null);
  const [sel, setSel] = useState('');
  const [list, setList] = useState(null);
  const [msg, setMsg] = useState({});
  useEffect(() => { api('/api/chats').then((r) => setConvs(r.conversations || [])).catch((e) => setMsg({ error: e.message })); }, []);
  const conv = (convs || []).find((c) => `${c.threadType}:${c.threadId}` === sel);
  const load = () => conv && api(`/api/schedules/reminders?${new URLSearchParams({ threadId: conv.threadId, threadType: String(conv.threadType) })}`)
    .then((r) => setList(r.reminders)).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { setList(null); setMsg({}); load(); }, [sel]);
  async function remove(r) {
    if (!confirm(`Xoá lời nhắc "${r.title}" trong ${conv.name}?`)) return;
    try { await api('/api/schedules/reminders/remove', { method: 'POST', body: { reminderId: r.id, threadId: conv.threadId, threadType: conv.threadType } }); setMsg({ ok: 'Đã xoá lời nhắc.' }); load(); } catch (e) { setMsg({ error: e.message }); }
  }
  return html`<section class="card">
    <h2>Lời nhắc Zalo</h2>
    <p class="muted small">Lời nhắc tạo trong Zalo (bởi bot hoặc thành viên). Chọn hội thoại để xem.</p>
    <div class="field"><label for="rem-conv">Hội thoại</label>
      <select id="rem-conv" value=${sel} onChange=${(e) => setSel(e.currentTarget.value)}>
        <option value="">— Chọn nhóm hoặc người —</option>
        ${(convs || []).map((c) => html`<option key=${`${c.threadType}:${c.threadId}`} value=${`${c.threadType}:${c.threadId}`}>${c.threadType === 1 ? 'Nhóm' : 'Riêng'} · ${c.name}</option>`)}
      </select></div>
    <${Live} error=${msg.error} ok=${msg.ok} />
    ${sel && !list && !msg.error ? html`<${Spinner} />` : null}
    ${list && !list.length ? html`<p class="muted">Hội thoại này chưa có lời nhắc.</p>` : null}
    <ul class="row-list">${(list || []).map((r) => html`<li key=${r.id} class="row-item">
      <span class="row-main"><strong>${r.title || '(không tên)'}</strong>
        <small class="muted">${fmtTime(r.startAt)} · ${REPEAT_LABELS[r.repeat] || 'Lặp lại'}${r.mine ? ' · bot tạo' : ''}</small></span>
      <button class="btn btn-secondary btn-sm" onClick=${() => remove(r)}><${Icon} name="close" size=${14} /> Xoá</button>
    </li>`)}</ul>
  </section>`;
}

export function Schedules() {
  return html`<${PageHead} title="Lịch hẹn" sub="Việc trợ lý làm theo giờ và lời nhắc trong các nhóm Zalo." />
    <${Jobs} /><${Reminders} />`;
}
