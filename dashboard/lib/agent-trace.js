/**
 * Theo dõi agent (spec §18.6, chỉ Quản trị): đọc `<HERMES_HOME>/state.db` của Hermes CHỈ ĐỌC (node:sqlite readOnly +
 * query_only, mở rồi đóng mỗi lần như ai-usage.js) — phiên, lượt, lời gọi công cụ, token, model.
 * - Tham số công cụ đã che: chỉ hiện TÊN khoá và loại/độ dài giá trị, không bao giờ hiện giá trị.
 * - Kết quả công cụ: chỉ trạng thái (xong/lỗi) và thời gian (giờ tin kết quả − giờ tin gọi), không hiện nội dung.
 * - Câu hỏi/câu trả lời: chỉ đoạn đầu, chuỗi trông như khoá bí mật bị che. Không bao giờ đọc lời nhắc hệ thống
 *   (cột sessions.system_prompt, tin role 'system').
 * - Token và model: theo phiên (Hermes không ghi token theo từng tin).
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const SOURCES = ['zalo', 'cron', 'all'];
const MAX_MESSAGES = 1500;

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Chuỗi trông như khoá bí mật: tiền tố khoá phổ biến, "Bearer …", "api_key=…", JWT.
const SECRET_PATTERNS = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abprs])[-_][A-Za-z0-9_-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{3,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];
const SECRET_ASSIGN = /\b([A-Za-z0-9_]*(?:api[_-]?key|token|secret|password|passwd|pwd)[A-Za-z0-9_]*)(\s*[:=]\s*)["']?[^\s"',;]{4,}/gi;
/** Che chuỗi trông như khoá bí mật trong đoạn xem trước. */
export function redactSecrets(text) {
  let s = String(text ?? '');
  for (const re of SECRET_PATTERNS) s = s.replace(re, '[đã che]');
  return s.replace(SECRET_ASSIGN, (m, key, sep) => `${key}${sep}[đã che]`);
}
const preview = (s, n) => clip(redactSecrets(s), n);

/** Tham số công cụ (chuỗi JSON) → [{ key, kind }] — không giá trị nào lọt ra. */
export function redactArgs(raw) {
  let a;
  try { a = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return [{ key: '(không đọc được)', kind: '' }]; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return [];
  return Object.entries(a).slice(0, 20).map(([key, v]) => ({
    key: clip(key, 40),
    kind: typeof v === 'string' ? `chữ, ${v.length} ký tự` : Array.isArray(v) ? `danh sách ${v.length} mục`
      : v === null ? 'trống' : typeof v === 'object' ? 'đối tượng' : typeof v === 'number' ? 'số' : typeof v === 'boolean' ? 'đúng/sai' : typeof v,
  }));
}

/** Kết quả công cụ có phải lỗi không (JSON `success: false` hoặc có khoá `error`). */
export function toolFailed(content) {
  try { const j = JSON.parse(String(content ?? '')); return Boolean(j && typeof j === 'object' && (j.success === false || (j.error != null && j.error !== ''))); } catch { return /^(error|lỗi)\b/i.test(String(content ?? '').trim()); }
}

/** Gom tin của một phiên (đã theo thứ tự id) thành lượt: tin người dùng → lời gọi công cụ → câu trả lời. */
export function buildTurns(rows) {
  const turns = []; let cur = null; const pending = new Map();
  for (const m of rows) {
    const at = Math.round(Number(m.timestamp) * 1000);
    if (m.role === 'user') { cur = { at, user: preview(m.content, 200), tools: [], reply: '', endAt: at }; turns.push(cur); continue; }
    if (!cur) continue;   // phần lượt bị cắt ở đầu trang
    cur.endAt = Math.max(cur.endAt, at);
    if (m.role === 'assistant') {
      let calls = [];
      try { calls = JSON.parse(m.tool_calls || '[]'); } catch { calls = []; }
      for (const c of Array.isArray(calls) ? calls : []) {
        const t = { name: clip(c?.function?.name, 64), args: redactArgs(c?.function?.arguments), status: 'đang chạy', ms: null };
        cur.tools.push(t);
        if (c?.id) pending.set(String(c.id), { t, at });
        if (c?.call_id) pending.set(String(c.call_id), { t, at });
      }
      if (m.content && (!calls || !calls.length)) cur.reply = preview(m.content, 300);
    } else if (m.role === 'tool') {
      const p = pending.get(String(m.tool_call_id ?? ''));
      if (p) { p.t.status = toolFailed(m.content) ? 'lỗi' : 'xong'; p.t.ms = Math.max(0, at - p.at); }
    }
  }
  return turns.map(({ endAt, ...t }) => ({ ...t, ms: endAt - t.at }));
}

export function createAgentTrace({ dbPath }) {
  function withDb(fn) {
    if (!existsSync(dbPath)) throw err(503, 'Chưa có dữ liệu của trợ lý (state.db) trên máy này.');
    const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1500 });
    try { db.exec('PRAGMA query_only = ON'); return fn(db); } finally { db.close(); }
  }
  return {
    /** Phiên mới hoạt động trước; `chat` = id nhóm/người Zalo (chat_id); `before` (ms) = trang sau: phiên cũ hơn mốc. */
    sessions({ source = 'zalo', chat = '', limit = 50, before } = {}) {
      if (!SOURCES.includes(source)) throw err(400, 'Nguồn không hợp lệ.');
      if (chat && !/^\d{1,32}$/.test(chat)) throw err(400, 'Hội thoại không hợp lệ.');
      const until = before === undefined || before === null || before === '' ? null : Number(before);
      if (until !== null && !(Number.isFinite(until) && until > 0)) throw err(400, 'Mốc thời gian không hợp lệ.');
      return withDb((db) => db.prepare(`SELECT id, source, chat_type, chat_id, title, model, started_at, last_activity_at, ended_at,
          message_count, tool_call_count, api_call_count, input_tokens, output_tokens, cache_read_tokens
        FROM sessions WHERE (? = 'all' OR source = ?) AND (? = '' OR chat_id = ?) AND (? IS NULL OR ROUND(COALESCE(last_activity_at, started_at) * 1000) < ?)
        ORDER BY COALESCE(last_activity_at, started_at) DESC LIMIT ?`)
        .all(source, source, chat, chat, until, until, Math.min(Math.max(Number(limit) || 50, 1), 200))
        .map((s) => ({
          id: String(s.id), source: s.source, chatType: s.chat_type || '', chatId: s.chat_id || '', title: preview(s.title, 120), model: clip(s.model, 80),
          startedAt: Math.round(Number(s.started_at) * 1000), lastAt: s.last_activity_at ? Math.round(Number(s.last_activity_at) * 1000) : null,
          ended: s.ended_at != null, messages: Number(s.message_count) || 0, toolCalls: Number(s.tool_call_count) || 0, apiCalls: Number(s.api_call_count) || 0,
          input: Number(s.input_tokens) || 0, output: Number(s.output_tokens) || 0, cached: Number(s.cache_read_tokens) || 0,
        })));
    },
    /** 30 lượt gần nhất của một phiên (đọc tối đa 1500 tin mới nhất). */
    turns(sessionId, { limit = 30 } = {}) {
      if (!/^[\w:.-]{1,128}$/.test(String(sessionId))) throw err(400, 'Phiên không hợp lệ.');
      return withDb((db) => {
        const rows = db.prepare(`SELECT id, role, content, tool_calls, tool_call_id, timestamp FROM messages
          WHERE session_id = ? AND role IN ('user', 'assistant', 'tool') ORDER BY id DESC LIMIT ?`).all(String(sessionId), MAX_MESSAGES).reverse();
        return buildTurns(rows).slice(-Math.min(Math.max(Number(limit) || 30, 1), 100)).reverse();
      });
    },
  };
}
