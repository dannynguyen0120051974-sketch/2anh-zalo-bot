/**
 * Tóm tắt chủ đề nhóm bằng AI (spec §18.5) — phía dashboard của hàng đợi tệp (plugin: zalo_tools/insight_ai.py).
 * Dashboard ghi `<dir>/requests/<id>.json` (600) rồi trang hỏi lại `<dir>/results/<id>.json`. Mỗi lúc chỉ một yêu
 * cầu đang chờ; quá 3 phút không có kết quả → báo "trợ lý chưa trả lời" (plugin cũ hoặc gateway tắt).
 * Trần lượt mỗi ngày do plugin giữ (`ZALO_INSIGHT_DAILY`) — plugin là nơi duy nhất thật sự tốn tiền AI.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './json-store.js';

export const REQUEST_ID = /^[0-9a-f]{16}$/;
export const PENDING_TIMEOUT_MS = 3 * 60_000;
const KEEP_RESULTS_MS = 7 * 86_400_000;

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });

export function createInsightAi({ dir, now = Date.now, newId = () => randomBytes(8).toString('hex') }) {
  const reqDir = join(dir, 'requests');
  const resDir = join(dir, 'results');
  const readdirSafe = (d) => { try { return readdirSync(d); } catch { return []; } };
  const files = (d) => { try { return readdirSync(d).filter((f) => f.endsWith('.json')); } catch { return []; } };
  const CLAIMED = '.json.claimed'; // plugin đã nhận yêu cầu (đổi tên nguyên tử) và đang xử lý
  const age = (f) => { try { return now() - statSync(f).mtimeMs; } catch { return Infinity; } };

  function cleanup() {
    for (const f of files(resDir)) if (age(join(resDir, f)) > KEEP_RESULTS_MS) rmSync(join(resDir, f), { force: true });
    // Yêu cầu bị bỏ rơi (plugin không chạy) thì xoá sau thời hạn chờ để lần sau gửi được.
    for (const f of files(reqDir)) if (age(join(reqDir, f)) > PENDING_TIMEOUT_MS) rmSync(join(reqDir, f), { force: true });
  }

  return {
    /** Gửi một yêu cầu; trả id. Đang có yêu cầu khác chờ → 409. Không có chữ nào để tóm tắt → 400. */
    request({ groupId, groupName, days, transcript, by }) {
      cleanup();
      if (!String(transcript || '').trim()) throw err(400, 'Nhóm chưa có tin nào trong khoảng này để tóm tắt.');
      const busy = files(reqDir).length > 0
        || readdirSafe(reqDir).some((f) => f.endsWith(CLAIMED) && age(join(reqDir, f)) <= PENDING_TIMEOUT_MS);
      if (busy) throw err(409, 'Đang tóm tắt một nhóm khác — đợi xong rồi bấm lại.');
      const id = newId();
      writeJsonAtomic(join(reqDir, `${id}.json`), { v: 1, id, groupId: String(groupId), groupName: String(groupName || '').slice(0, 80), days, transcript, by: String(by), createdAt: now() });
      return id;
    },
    /** `{ status: 'pending' | 'done' | 'timeout', result? }`; id lạ → 400; không có → 404. */
    result(id) {
      if (!REQUEST_ID.test(String(id))) throw err(400, 'Mã yêu cầu không hợp lệ — bấm Tóm tắt lại.');
      const res = join(resDir, `${id}.json`);
      if (existsSync(res)) {
        try { return { status: 'done', result: JSON.parse(readFileSync(res, 'utf8')) }; } catch { return { status: 'done', result: { ok: false, error: 'Kết quả hỏng — bấm Tóm tắt lại.' } }; }
      }
      const req = [join(reqDir, `${id}.json`), join(reqDir, `${id}${CLAIMED}`)].find((f) => existsSync(f));
      if (req) return age(req) > PENDING_TIMEOUT_MS ? { status: 'timeout' } : { status: 'pending' };
      throw err(404, 'Không thấy yêu cầu này — bấm Tóm tắt lại.');
    },
  };
}
