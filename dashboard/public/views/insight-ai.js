// Tóm tắt chủ đề nhóm bằng AI (spec §18.5): chỉ chạy khi bấm nút, hỏi kết quả mỗi 3 giây, tối đa ~3 phút.
import { useEffect, useRef, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Live, Spinner } from '../ui.js';

export const POLL_MS = 3000;

/** Câu cho trạng thái hàng đợi: pending/timeout/done-lỗi → chữ cho người dùng; done-ok → ''. */
export function summaryStatusText(r) {
  if (r.status === 'pending') return 'Đang nhờ trợ lý đọc và tóm tắt…';
  if (r.status === 'timeout') return 'Trợ lý chưa trả lời sau 3 phút — có thể trợ lý đang tắt hoặc chưa cập nhật bản mới. Báo người cài đặt nếu lặp lại.';
  if (r.status === 'done' && !r.result?.ok) return r.result?.error || 'Chưa tóm tắt được — thử lại.';
  return '';
}

export function InsightAi({ groupId, days }) {
  const [state, setState] = useState({ busy: false, error: '', note: '', summary: null });
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { clearTimeout(timer.current); setState({ busy: false, error: '', note: '', summary: null }); }, [groupId, days]);
  async function poll(id) {
    try {
      const r = await api(`/api/insight/summary/${id}`);
      const text = summaryStatusText(r);
      if (r.status === 'pending') { setState((s) => ({ ...s, note: text })); timer.current = setTimeout(() => poll(id), POLL_MS); return; }
      setState({ busy: false, error: text, note: '', summary: r.status === 'done' && r.result?.ok ? r.result.summary : null });
    } catch (e) { setState({ busy: false, error: e.message, note: '', summary: null }); }
  }
  async function start() {
    if (!confirm(`Nhờ AI tóm tắt ${days} ngày gần nhất của nhóm? Việc này dùng lượt AI của bot (có giới hạn mỗi ngày).`)) return;
    setState({ busy: true, error: '', note: 'Đang gửi…', summary: null });
    try { const r = await api(`/api/insight/groups/${groupId}/summary`, { method: 'POST', body: { days } }); poll(r.id); } catch (e) { setState({ busy: false, error: e.message, note: '', summary: null }); }
  }
  const s = state.summary;
  return html`<div class="mem-block">
    <h3>Chủ đề đang bàn <small class="muted">tóm tắt bằng AI</small></h3>
    <p class="muted small">Chỉ chạy khi bấm nút. Ảnh và tệp không được gửi cho AI — chỉ chữ trong nhóm.</p>
    <button type="button" class="btn btn-secondary" disabled=${state.busy} onClick=${start}>${state.busy ? 'Đang tóm tắt…' : 'Tóm tắt chủ đề'}</button>
    ${state.busy ? html`<${Spinner} label=${state.note} />` : null}
    <${Live} error=${state.error} />
    ${s ? html`<div class="ai-summary">
      ${s.mood ? html`<p><strong>Không khí:</strong> ${s.mood}</p>` : null}
      <ul class="row-list">${s.topics.map((t) => html`<li key=${t.title} class="row-item"><span class="row-main"><strong>${t.title}</strong><span>${t.summary}</span></span></li>`)}</ul>
      ${s.open_questions.length ? html`<p><strong>Câu hỏi còn bỏ ngỏ:</strong></p><ul>${s.open_questions.map((q) => html`<li key=${q}>${q}</li>`)}</ul>` : null}
    </div>` : null}
  </div>`;
}
