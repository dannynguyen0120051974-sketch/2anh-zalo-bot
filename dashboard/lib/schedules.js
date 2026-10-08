/**
 * Lịch hẹn (spec §18.4): việc hẹn giờ của Hermes (`<HERMES_HOME>/cron/jobs.json`) có gửi kết quả về Zalo —
 * cả việc của chủ nhân lẫn "hẹn giờ cho nhóm" (`origin.zalo_scope = "group"`, tạo bằng `zalo_group_cron`).
 * Đọc thẳng jobs.json (Hermes ghi bằng đổi tên nguyên tử). Tạm dừng / chạy lại / xoá KHÔNG sửa tệp: chạy lệnh
 * `hermes cron pause|resume|remove <id>` của chính Hermes (giữ khoá `.jobs.lock`), chỉ với việc thuộc Zalo.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const JOB_ID = /^[0-9a-f]{6,32}$/;
export const CRON_ACTIONS = ['pause', 'resume', 'remove'];

const short = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Hội thoại Zalo mà việc gửi kết quả về (như `_cron_target` của plugin); rỗng = không thuộc Zalo. */
export function cronTarget(job) {
  for (const part of String(job?.deliver ?? '').split(',')) {
    const p = part.trim();
    if (p.startsWith('zalo:')) return p.slice(5).split(':')[0];
  }
  const o = job?.origin;
  return o && typeof o === 'object' && o.platform === 'zalo' ? String(o.chat_id ?? '') : '';
}

/** Các việc thuộc Zalo, dạng an toàn để hiện (không có đường dẫn script, model, khoá…). */
export function zaloJobs(data) {
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  return jobs.filter((j) => j && JOB_ID.test(String(j.id ?? '')) && cronTarget(j)).map((j) => {
    const o = j.origin && typeof j.origin === 'object' ? j.origin : {};
    const group = o.zalo_scope === 'group';
    return {
      id: String(j.id), name: short(j.name, 120), prompt: short(j.prompt, 400),
      schedule: short(j.schedule_display || j.schedule?.display || j.schedule?.expr, 80),
      enabled: j.enabled !== false, paused: j.state === 'paused' || Boolean(j.paused_at),
      nextRunAt: j.next_run_at ? Date.parse(j.next_run_at) || null : null,
      lastRunAt: j.last_run_at ? Date.parse(j.last_run_at) || null : null,
      lastStatus: short(j.last_status, 20), target: cronTarget(j),
      kind: group ? 'group' : 'owner',
      creatorUid: group ? String(o.zalo_creator_uid ?? '') : '', creatorName: group ? short(o.zalo_creator_name, 80) : '',
    };
  });
}

export function readZaloJobs(hermesHome) {
  const file = join(hermesHome, 'cron', 'jobs.json');
  if (!existsSync(file)) return [];
  return zaloJobs(JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')));
}

/** Đường tới lệnh `hermes`: ZALO_HERMES_BIN → `<HERMES_HOME>/bin/hermes(.exe)` (bản cài Windows) → `hermes` trên PATH. */
export function hermesBin({ hermesHome, env = process.env, platform = process.platform, exists = existsSync }) {
  if (env.ZALO_HERMES_BIN) return env.ZALO_HERMES_BIN;
  const bundled = join(hermesHome, 'bin', platform === 'win32' ? 'hermes.exe' : 'hermes');
  return exists(bundled) ? bundled : 'hermes';
}

const defaultExec = (file, args, opts) => new Promise((resolve, reject) => {
  execFile(file, args, opts, (e, stdout, stderr) => (e ? reject(Object.assign(e, { stderr: String(stderr || '') })) : resolve({ stdout: String(stdout) })));
});

export function createSchedules({ hermesHome, bin, execImpl = defaultExec, env = process.env }) {
  return {
    list: () => readZaloJobs(hermesHome),
    /** Chỉ việc thuộc Zalo; id đã kiểm; lệnh cố định, không qua shell. */
    async cron(action, id) {
      if (!CRON_ACTIONS.includes(action)) throw Object.assign(new Error('Thao tác không hợp lệ — tải lại trang.'), { statusCode: 400 });
      const job = readZaloJobs(hermesHome).find((j) => j.id === id);
      if (!JOB_ID.test(String(id)) || !job) throw Object.assign(new Error('Không tìm thấy việc hẹn giờ này — tải lại trang.'), { statusCode: 404 });
      try {
        await execImpl(bin, ['cron', action, id], { windowsHide: true, timeout: 30_000, env: { ...env, HERMES_HOME: hermesHome } });
      } catch (e) {
        console.error('[dashboard] hermes cron', action, id, 'lỗi:', e.message, e.stderr?.slice(0, 300));
        throw Object.assign(new Error('Trợ lý chưa làm được việc này — thử lại sau ít phút, nếu vẫn lỗi hãy báo người cài đặt.'), { statusCode: 502 });
      }
      return job;
    },
  };
}
