/**
 * Lượt dùng Xưởng tạo sản phẩm (spec §17): đọc CHỈ ĐỌC `<HERMES_HOME>/zalo/studio-usage.json` do plugin ghi
 * (hermes-plugin/zalo_tools/studio/ledger.py). Không có tệp = chưa ai dùng; tệp hỏng/không đọc được → `error`.
 */
import { readFileSync } from 'node:fs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const STATUSES = new Set(['queued', 'running', 'ok', 'failed', 'refunded']);

function person(uid, p) {
  return {
    uid, name: typeof p.name === 'string' ? p.name.slice(0, 80) : '',
    jobs: num(p.jobs), ok: num(p.ok), failed: num(p.failed), refunded: num(p.refunded),
    inputTokens: num(p.input_tokens), outputTokens: num(p.output_tokens), images: num(p.images),
  };
}

/** `{ error: null | 'unreadable', days: [{ date, jobs, ok, failed, refunded, inputTokens, outputTokens, images, people }], recent }` — mới nhất trước. */
export function readStudioUsage(file, { days = 14, recent = 20 } = {}) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    if (err?.code === 'ENOENT') return { error: null, days: [], recent: [] };
    return { error: 'unreadable', days: [], recent: [] };
  }
  if (!isObj(data) || data.version !== 1 || !isObj(data.days)) return { error: 'unreadable', days: [], recent: [] };
  const out = Object.keys(data.days).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().slice(0, days).map((date) => {
    const people = Object.entries(isObj(data.days[date]) ? data.days[date] : {})
      .filter(([uid, p]) => /^\d{1,32}$/.test(uid) && isObj(p)).map(([uid, p]) => person(uid, p))
      .sort((a, b) => b.jobs - a.jobs || a.uid.localeCompare(b.uid));
    const sum = (k) => people.reduce((n, p) => n + p[k], 0);
    return { date, jobs: sum('jobs'), ok: sum('ok'), failed: sum('failed'), refunded: sum('refunded'),
      inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), images: sum('images'), people };
  });
  const jobs = (Array.isArray(data.jobs) ? data.jobs : []).filter(isObj).slice(-recent).reverse().map((j) => ({
    at: num(j.at) * 1000, name: typeof j.name === 'string' ? j.name.slice(0, 80) : '', kind: String(j.kind || ''),
    status: STATUSES.has(j.status) ? j.status : 'failed', group: Boolean(j.group),
  }));
  return { error: null, days: out, recent: jobs };
}
