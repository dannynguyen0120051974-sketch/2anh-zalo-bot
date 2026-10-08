// Lượt dùng Xưởng tạo sản phẩm (spec §17): Quản trị và Chủ bot đều xem (như Sức khoẻ máy chủ).
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { readStudioUsage } from '../lib/studio-usage.js';

export function studioRoutes({ studioUsageFile }) {
  const r = express.Router();
  r.get('/studio-usage', requireAuth, (req, res) => {
    res.json({ ok: true, ...readStudioUsage(studioUsageFile) });
  });
  return r;
}
