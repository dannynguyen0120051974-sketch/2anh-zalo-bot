/**
 * Insight nhóm (spec §18.5): số liệu một nhóm trong N ngày từ lịch sử SQLite (chỉ đọc), giờ Việt Nam.
 * Mọi câu đi theo chỉ mục idx_messages_thread_time (account_id, thread_type, thread_id, timestamp_ms) và lọc bỏ tin
 * mã đăng nhập như các màn khác. Không bao giờ trả UID người gửi ra ngoài danh sách thành viên tích cực.
 */
import { MEDIA_MATCH } from './store-reader.js';

const DAY_MS = 86_400_000;
const VN_S = 7 * 3600;
export const INSIGHT_DAYS = [7, 30, 90];

/** Ngày VN dạng YYYY-MM-DD của mốc ms. */
export const vnDay = (ms) => new Date(ms + VN_S * 1000).toISOString().slice(0, 10);

/**
 * @returns {{ days: number, since: number, totals: {messages, members, bot}, perDay: Array<{date, total, bot}>,
 *   top: Array<{name, count}>, heat: number[][] (7 hàng T2..CN × 24 giờ), kinds: {text, photo, file, link, sticker, voice, other} }}
 */
export function groupInsightQuery(db, account, threadId, { days = 30, nowMs = Date.now(), secretLike }) {
  const since = nowMs - days * DAY_MS;
  const where = 'account_id = ? AND thread_type = 1 AND thread_id = ? AND timestamp_ms >= ? AND text NOT LIKE ?';
  const args = [account, String(threadId), since, secretLike];
  const totals = db.prepare(`SELECT COUNT(*) AS messages, COUNT(DISTINCT CASE WHEN is_self = 0 THEN sender_uid END) AS members,
    SUM(is_self) AS bot FROM messages WHERE ${where}`).get(...args);
  const dayRows = db.prepare(`SELECT strftime('%Y-%m-%d', timestamp_ms / 1000 + ${VN_S}, 'unixepoch') AS d, COUNT(*) AS total, SUM(is_self) AS bot
    FROM messages WHERE ${where} GROUP BY d`).all(...args);
  const byDay = new Map(dayRows.map((r) => [r.d, r]));
  const perDay = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = vnDay(nowMs - i * DAY_MS);
    const r = byDay.get(date);
    perDay.push({ date, total: Number(r?.total || 0), bot: Number(r?.bot || 0) });
  }
  // Tên mới nhất của mỗi người (đổi tên Zalo thì lấy tên sau cùng).
  const top = db.prepare(`SELECT sender_uid, COUNT(*) AS n, (SELECT m2.sender_name FROM messages m2 WHERE m2.account_id = messages.account_id
      AND m2.thread_type = 1 AND m2.thread_id = messages.thread_id AND m2.sender_uid = messages.sender_uid AND m2.sender_name <> ''
      ORDER BY m2.timestamp_ms DESC LIMIT 1) AS name
    FROM messages WHERE ${where} AND is_self = 0 AND sender_uid <> '' GROUP BY sender_uid ORDER BY n DESC LIMIT 10`).all(...args)
    .map((r) => ({ name: String(r.name || 'Không rõ tên'), count: Number(r.n) }));
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of db.prepare(`SELECT CAST(strftime('%w', timestamp_ms / 1000 + ${VN_S}, 'unixepoch') AS INTEGER) AS w,
      CAST(strftime('%H', timestamp_ms / 1000 + ${VN_S}, 'unixepoch') AS INTEGER) AS h, COUNT(*) AS n
    FROM messages WHERE ${where} AND is_self = 0 GROUP BY w, h`).all(...args)) {
    heat[(Number(r.w) + 6) % 7][Number(r.h)] = Number(r.n);   // %w: 0 = Chủ nhật → hàng cuối
  }
  const k = db.prepare(`SELECT
      SUM(msg_type = 'webchat') AS text, SUM(${MEDIA_MATCH.photo}) AS photo, SUM(${MEDIA_MATCH.file}) AS file,
      SUM(${MEDIA_MATCH.link}) AS link, SUM(msg_type = 'chat.sticker') AS sticker, SUM(msg_type = 'chat.voice') AS voice,
      COUNT(*) AS total FROM messages WHERE ${where}`).get(...args);
  const kinds = Object.fromEntries(['text', 'photo', 'file', 'link', 'sticker', 'voice'].map((x) => [x, Number(k[x] || 0)]));
  // "Link" có thể là tin chữ chứa link — đã đếm trong text; "khác" = phần còn lại sau các loại riêng.
  kinds.other = Math.max(0, Number(k.total || 0) - kinds.text - kinds.photo - kinds.file - kinds.sticker - kinds.voice);
  return {
    days, since,
    totals: { messages: Number(totals.messages || 0), members: Number(totals.members || 0), bot: Number(totals.bot || 0) },
    perDay, top, heat, kinds,
  };
}
