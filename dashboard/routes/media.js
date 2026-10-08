import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { checkImageUrl, createImageFetcher } from '../lib/image-proxy.js';

const BAD_URL = 'Ảnh này không nằm trên máy chủ ảnh của Zalo nên dashboard không tải — mở ảnh trong ứng dụng Zalo.';
const FETCH_FAIL = 'Chưa tải được ảnh từ Zalo — thử lại sau ít phút.';
const ERRORS = {
  bad_url: [400, BAD_URL],
  not_found: [404, 'Ảnh không còn trên Zalo — có thể Zalo đã xoá ảnh cũ; xem trong ứng dụng Zalo.'],
  redirect: [502, FETCH_FAIL],
  timeout: [504, 'Zalo trả ảnh quá chậm — thử lại sau ít phút.'],
  // Lỗi vĩnh viễn có mã riêng (không phải 502/503/429) để giao diện không tự thử lại.
  too_large: [413, 'Ảnh lớn quá 5 MB nên dashboard không tải — mở ảnh trong ứng dụng Zalo.'],
  bad_type: [415, 'Tệp này không phải ảnh dashboard hiển thị được — mở trong ứng dụng Zalo.'],
};

/**
 * GET /api/media/img?u=<link ảnh Zalo> — xem image-proxy.js.
 * Mỗi lần tải giữ tối đa 5 MB trong RAM, nên chặn số lần tải cùng lúc: toàn máy chủ `maxInFlight` (quá → 503),
 * mỗi người `perUserInFlight` (quá → 429), cộng `imageLimit` lần mỗi phút mỗi người (quá → 429).
 * Không đệm ảnh trên máy chủ: trình duyệt giữ ảnh 1 giờ (Cache-Control private), máy chủ của bot RAM ít và ảnh là nội dung riêng tư.
 */
export function mediaRoutes({
  imageFetch = createImageFetcher(), imageLimit = { max: 120, windowMs: 60_000 }, imageConcurrency = { global: 6, perUser: 4 }, now = Date.now,
}) {
  const r = express.Router();
  const windows = new Map(); // username → { start, n } — cửa sổ cố định mỗi người
  const running = new Map(); // username → số lần đang tải
  let inFlight = 0;

  function allow(username) {
    const t = now();
    let w = windows.get(username);
    if (!w || t - w.start >= imageLimit.windowMs) {
      if (windows.size > 1000) windows.clear();
      w = { start: t, n: 0 };
      windows.set(username, w);
    }
    w.n += 1;
    return w.n <= imageLimit.max;
  }

  // Mọi câu trả lời của đường này (kể cả lỗi) không được trình duyệt hiểu thành trang hay đoán loại.
  const lockDown = (req, res, next) => {
    res.set({ 'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
    next();
  };

  r.get('/media/img', lockDown, requireAuth, async (req, res) => {
    const u = typeof req.query.u === 'string' ? req.query.u : '';
    if (!checkImageUrl(u)) return res.status(400).json({ ok: false, error: BAD_URL });
    const who = req.user.username;
    if ((running.get(who) || 0) >= imageConcurrency.perUser) {
      return res.status(429).json({ ok: false, error: 'Bạn đang tải nhiều ảnh cùng lúc — đợi vài giây rồi bấm vào ảnh để thử lại.' });
    }
    if (inFlight >= imageConcurrency.global) {
      return res.status(503).json({ ok: false, error: 'Dashboard đang tải nhiều ảnh cho nhiều người — đợi vài giây rồi bấm vào ảnh để thử lại.' });
    }
    if (!allow(who)) {
      return res.status(429).json({ ok: false, error: 'Bạn đang mở quá nhiều ảnh trong một phút — đợi một phút rồi tải lại trang.' });
    }
    inFlight += 1;
    running.set(who, (running.get(who) || 0) + 1);
    try {
      const { type, body } = await imageFetch(u);
      res.set({ 'Content-Type': type, 'Content-Length': String(body.length), 'Cache-Control': 'private, max-age=3600' });
      res.end(body);
    } catch (err) {
      const [status, error] = ERRORS[err?.code] || [502, FETCH_FAIL];
      if (!err?.code) console.error('[dashboard] tải ảnh', err);
      res.status(status).json({ ok: false, error });
    } finally {
      inFlight -= 1;
      const left = (running.get(who) || 1) - 1;
      if (left > 0) running.set(who, left); else running.delete(who);
    }
  });

  return r;
}
