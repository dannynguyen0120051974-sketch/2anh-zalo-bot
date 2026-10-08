import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { checkImageUrl, createImageFetcher } from '../lib/image-proxy.js';

const BAD_URL = 'Ảnh này không nằm trên máy chủ ảnh của Zalo nên dashboard không tải — mở ảnh trong ứng dụng Zalo.';
const FETCH_FAIL = 'Chưa tải được ảnh từ Zalo — thử lại sau ít phút; ảnh quá cũ có thể đã bị Zalo xoá, khi đó hãy xem trong ứng dụng Zalo.';
const ERRORS = {
  bad_url: [400, BAD_URL],
  redirect: [502, FETCH_FAIL],
  timeout: [504, 'Zalo trả ảnh quá chậm — thử lại sau ít phút.'],
  too_large: [502, 'Ảnh lớn quá 8 MB nên dashboard không tải — mở ảnh trong ứng dụng Zalo.'],
};

/**
 * GET /api/media/img?u=<link ảnh Zalo> — xem image-proxy.js. Không đệm ảnh trên máy chủ:
 * trình duyệt đã giữ ảnh 1 ngày (Cache-Control private), còn máy chủ của bot RAM ít và ảnh là nội dung riêng tư.
 */
export function mediaRoutes({ imageFetch = createImageFetcher(), imageLimit = { max: 120, windowMs: 60_000 }, now = Date.now }) {
  const r = express.Router();
  const windows = new Map(); // username → { start, n } — cửa sổ cố định mỗi người

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
    if (!allow(req.user.username)) {
      return res.status(429).json({ ok: false, error: 'Bạn đang mở quá nhiều ảnh cùng lúc — đợi một phút rồi tải lại trang.' });
    }
    try {
      const { type, body } = await imageFetch(u);
      res.set({ 'Content-Type': type, 'Content-Length': String(body.length), 'Cache-Control': 'private, max-age=86400' });
      res.end(body);
    } catch (err) {
      const [status, error] = ERRORS[err?.code] || [502, FETCH_FAIL];
      if (!err?.code) console.error('[dashboard] tải ảnh', err);
      res.status(status).json({ ok: false, error });
    }
  });

  return r;
}
