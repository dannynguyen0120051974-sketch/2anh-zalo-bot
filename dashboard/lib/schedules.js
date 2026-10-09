/**
 * Lịch hẹn (spec §18.4): việc hẹn giờ của Hermes (`<HERMES_HOME>/cron/jobs.json`) có gửi kết quả về Zalo —
 * cả việc của chủ nhân lẫn "hẹn giờ cho nhóm" (`origin.zalo_scope = "group"`, tạo bằng `zalo_group_cron`).
 * Đọc thẳng jobs.json (Hermes ghi bằng đổi tên nguyên tử). Tạm dừng / chạy lại / xoá KHÔNG sửa tệp: chạy lệnh
 * `hermes cron pause|resume|remove <id>` của chính Hermes (giữ khoá `.jobs.lock`), chỉ với việc thuộc Zalo.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromSchedule, toSchedule } from '../public/schedule-spec.js';

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

// Việc hẹn giờ nhóm (plugin `_group_cron_prompt`): "<chỉ dẫn hệ thống>\n---\n<nội dung thành viên viết>".
// Dashboard chỉ cho sửa phần sau dấu tách; khi ghi tự bọc lại phần chỉ dẫn cũ.
export const GROUP_PROMPT_SEPARATOR = '\n---\n';
const MAX_PROMPT = 2000;

function editablePrompt(job, group) {
  const raw = String(job?.prompt ?? '');
  if (!group) return raw;
  const at = raw.indexOf(GROUP_PROMPT_SEPARATOR);
  return at >= 0 ? raw.slice(at + GROUP_PROMPT_SEPARATOR.length) : raw;
}

/** Các việc thuộc Zalo, dạng an toàn để hiện (không có đường dẫn script, model, khoá…). */
export function zaloJobs(data) {
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  return jobs.filter((j) => j && JOB_ID.test(String(j.id ?? '')) && cronTarget(j)).map((j) => {
    const o = j.origin && typeof j.origin === 'object' ? j.origin : {};
    const group = o.zalo_scope === 'group';
    const prompt = editablePrompt(j, group);
    return {
      // `prompt`: nguyên văn phần sửa được (không cắt, không gộp dòng) — biểu mẫu gửi lại đúng như cũ nếu không sửa.
      id: String(j.id), name: short(j.name, 120), prompt: prompt.slice(0, MAX_PROMPT), promptPreview: short(prompt, 200),
      schedule: short(j.schedule_display || j.schedule?.display || j.schedule?.expr, 80),
      // Lịch bằng lời thường cho biểu mẫu / lịch tuần; null = lịch nâng cao (khoảng lặp, cron phức tạp).
      spec: fromSchedule(j.schedule), expr: short(j.schedule?.expr || '', 80),
      enabled: j.enabled !== false, paused: j.state === 'paused' || Boolean(j.paused_at),
      nextRunAt: j.next_run_at ? Date.parse(j.next_run_at) || null : null,
      lastRunAt: j.last_run_at ? Date.parse(j.last_run_at) || null : null,
      lastStatus: short(j.last_status, 20), target: cronTarget(j),
      kind: group ? 'group' : 'owner',
      creatorName: group ? short(o.zalo_creator_name, 80) : '',
    };
  });
}

function readRaw(hermesHome) {
  const file = join(hermesHome, 'cron', 'jobs.json');
  if (!existsSync(file)) return { jobs: [] };
  return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

export function readZaloJobs(hermesHome) {
  return zaloJobs(readRaw(hermesHome));
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

const RAW_CRON = /^[\w*,/-]+( [\w*,/-]+){4}$/;
// Ký tự điều khiển (trừ xuống dòng/tab) và ký tự vô hình Hermes chặn trong prompt (`_scan_cron_prompt`).
const BAD_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/;
const bad = (message) => Object.assign(new Error(message), { statusCode: 400 });

/**
 * Kiểm + chuẩn hoá thân tạo/sửa. Tạo (`partial` false): đủ tên, việc bot làm, nơi gửi, lịch. Sửa (`partial` true):
 * trường nào không gửi là giữ nguyên (kéo thả chỉ gửi `spec`). Lịch từ dạng thường (`spec`) hoặc, chỉ Quản trị, cron
 * gốc (`expr`). Trả { name?, prompt?, target?, schedule? }.
 */
export function parseJobInput(body, { admin = false, partial = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const out = {};
  if (!partial || b.name !== undefined) {
    out.name = String(b.name ?? '').replace(/\s+/g, ' ').trim();
    if (!out.name || out.name.length > 120 || BAD_CHARS.test(out.name)) throw bad('Đặt tên cho lịch hẹn (tối đa 120 ký tự).');
  }
  if (!partial || b.prompt !== undefined) {
    out.prompt = String(b.prompt ?? '').replace(/\r\n/g, '\n').trim();
    if (!out.prompt || out.prompt.length > MAX_PROMPT) throw bad(`Ghi việc bot cần làm (tối đa ${MAX_PROMPT} ký tự).`);
    if (BAD_CHARS.test(out.prompt)) throw bad('Nội dung có ký tự ẩn (thường do dán từ nơi khác) — gõ lại hoặc dán dạng chữ thường.');
  }
  if (!partial || b.target !== undefined) {
    out.target = String(b.target ?? '').trim();
    if (!/^\d{1,32}$/.test(out.target)) throw bad('Chọn nhóm hoặc người nhận.');
  }
  if (b.spec) {
    try { out.schedule = toSchedule(b.spec); } catch (e) { throw bad(e.message); }
  } else if (admin && typeof b.expr === 'string' && b.expr.trim()) {
    if (!RAW_CRON.test(b.expr.trim())) throw bad('Cron gốc phải có 5 trường: phút giờ ngày tháng thứ.');
    out.schedule = b.expr.trim();
  } else if (!partial) throw bad('Chọn lịch chạy.');
  return out;
}

const isOnce = (schedule) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(schedule));
/** Lịch đã lưu khớp chuỗi lịch vừa gửi: cron so đúng nguyên chuỗi; một lần so ngày giờ (Hermes thêm giây + múi giờ). */
function sameSchedule(raw, schedule) {
  const sch = raw?.schedule || {};
  if (isOnce(schedule)) return sch.kind === 'once' && String(sch.run_at || '').startsWith(`${schedule}:`);
  return String(sch.expr || '') === schedule;
}

export function createSchedules({ hermesHome, bin, execImpl = defaultExec, env = process.env }) {
  const fail = () => Object.assign(new Error('Trợ lý chưa làm được việc này — tải lại trang xem trạng thái, rồi thử lại sau ít phút; nếu vẫn lỗi hãy báo người cài đặt.'), { statusCode: 502 });
  const rawJob = (id) => (readRaw(hermesHome).jobs || []).find((j) => String(j?.id) === String(id));
  /**
   * Chạy `hermes cron …` (không qua shell). Hermes thoát 0 cả khi từ chối — dòng "Failed to … job: <lý do>" là lỗi
   * người dùng sửa được (lịch đã qua, cron sai…) → 400 kèm lý do; lỗi chạy lệnh → `onCrash` quyết (mặc định 502).
   */
  async function run(args, label) {
    let out;
    try {
      out = await execImpl(bin, ['cron', ...args], { windowsHide: true, timeout: 30_000, env: { ...env, HERMES_HOME: hermesHome } });
    } catch (e) {
      console.error('[dashboard] hermes cron', label, 'lỗi:', e.message, e.stderr?.slice(0, 300));
      return false;
    }
    const refused = /^\s*(?:Failed to (?:create|update) job|Blocked)[:\s]*(.*)$/m.exec(String(out?.stdout ?? ''));
    if (refused) {
      console.error('[dashboard] hermes cron', label, 'từ chối:', refused[0].slice(0, 300));
      const why = refused[1].trim();
      if (/in the past/i.test(why)) throw bad('Thời điểm này đã qua — chọn ngày giờ sau bây giờ.');
      if (/invalid cron|out of range/i.test(why)) throw bad('Lịch chạy không hợp lệ — kiểm lại giờ, ngày.');
      throw bad(`Trợ lý không nhận lịch này: ${why.slice(0, 200) || 'kiểm lại ngày giờ'}.`);
    }
    return true;
  }
  return {
    list: () => readZaloJobs(hermesHome),
    /** Tạo việc mới gửi về Zalo. Trả việc vừa tạo (đọc lại từ jobs.json — kể cả khi lệnh lỗi/hết giờ, để không tạo trùng). */
    async create(input) {
      const before = new Set((readRaw(hermesHome).jobs || []).map((j) => String(j?.id)));
      // "--" trước đối số vị trí: việc bot làm bắt đầu bằng "-" không bị hiểu thành tuỳ chọn.
      const ran = await run(['create', `--name=${input.name}`, `--deliver=zalo:${input.target}`, '--', input.schedule, input.prompt], 'create');
      const raw = (readRaw(hermesHome).jobs || []).find((j) => !before.has(String(j?.id)) && j.name === input.name && sameSchedule(j, input.schedule));
      const made = raw && readZaloJobs(hermesHome).find((j) => j.id === String(raw.id));
      if (!made) { console.error('[dashboard] hermes cron create', ran ? 'thoát 0 nhưng không thấy việc mới' : 'lỗi'); throw fail(); }
      return made;
    },
    /**
     * Sửa một việc thuộc Zalo — CHỈ gửi trường thật sự đổi (kéo thả chỉ đổi lịch). Việc nhóm: giữ phần chỉ dẫn hệ thống
     * trong prompt, không cho đổi nơi gửi. Đổi giữa "một lần" và "lặp lại" thì chỉnh số lần chạy cho khớp.
     */
    async update(id, input) {
      const job = readZaloJobs(hermesHome).find((j) => j.id === id);
      const raw = job && rawJob(id);
      if (!JOB_ID.test(String(id)) || !job || !raw) throw Object.assign(new Error('Không tìm thấy việc hẹn giờ này — tải lại trang.'), { statusCode: 404 });
      const group = job.kind === 'group';
      const args = ['edit', id];
      if (input.name !== undefined && input.name !== job.name) args.push(`--name=${input.name}`);
      let prompt;
      if (input.prompt !== undefined && input.prompt !== job.prompt.trim()) {
        if (group) {
          const at = String(raw.prompt ?? '').indexOf(GROUP_PROMPT_SEPARATOR);
          prompt = at >= 0 ? `${String(raw.prompt).slice(0, at)}${GROUP_PROMPT_SEPARATOR}${input.prompt}` : input.prompt;
        } else prompt = input.prompt;
        args.push(`--prompt=${prompt}`);
      }
      if (input.schedule !== undefined && !sameSchedule(raw, input.schedule)) {
        args.push(`--schedule=${input.schedule}`);
        const wasOnce = raw.schedule?.kind === 'once';
        const completed = Number(raw.repeat?.completed) || 0;
        if (wasOnce && !isOnce(input.schedule)) args.push('--repeat=0');            // lặp mãi
        else if (!wasOnce && isOnce(input.schedule)) args.push(`--repeat=${completed + 1}`); // chạy đúng một lần nữa
      }
      if (input.target !== undefined && input.target !== job.target) {
        if (group) throw bad('Việc do thành viên nhóm tạo chỉ gửi vào chính nhóm đó — muốn gửi nơi khác hãy tạo lịch hẹn mới.');
        args.push(`--deliver=zalo:${input.target}`);
      }
      if (args.length === 2) return job; // không có gì đổi
      if (!(await run(args, `edit ${id}`))) throw fail();
      const after = rawJob(id);
      const view = readZaloJobs(hermesHome).find((j) => j.id === id);
      const ok = after && view && (input.name === undefined || view.name === input.name)
        && (input.schedule === undefined || sameSchedule(after, input.schedule))
        && (prompt === undefined || String(after.prompt) === prompt)
        && (input.target === undefined || view.target === input.target);
      if (!ok) { console.error('[dashboard] hermes cron edit', id, 'thoát 0 nhưng jobs.json không đổi như mong đợi'); throw fail(); }
      return view;
    },
    /** Chỉ việc thuộc Zalo; id đã kiểm; lệnh cố định, không qua shell. */
    async cron(action, id) {
      if (!CRON_ACTIONS.includes(action)) throw Object.assign(new Error('Thao tác không hợp lệ — tải lại trang.'), { statusCode: 400 });
      const job = readZaloJobs(hermesHome).find((j) => j.id === id);
      if (!JOB_ID.test(String(id)) || !job) throw Object.assign(new Error('Không tìm thấy việc hẹn giờ này — tải lại trang.'), { statusCode: 404 });
      const fail = () => Object.assign(new Error('Trợ lý chưa làm được việc này — tải lại trang xem trạng thái, rồi thử lại sau ít phút; nếu vẫn lỗi hãy báo người cài đặt.'), { statusCode: 502 });
      let out;
      try {
        out = await execImpl(bin, ['cron', action, id], { windowsHide: true, timeout: 30_000, env: { ...env, HERMES_HOME: hermesHome } });
      } catch (e) {
        console.error('[dashboard] hermes cron', action, id, 'lỗi:', e.message, e.stderr?.slice(0, 300));
        throw fail();
      }
      // `hermes cron` thoát 0 cả khi thất bại (cmd_cron bỏ mã trả về) → kiểm lại chữ báo lỗi và trạng thái thật trong jobs.json.
      if (/Failed to/i.test(String(out?.stdout ?? ''))) {
        console.error('[dashboard] hermes cron', action, id, 'báo lỗi:', String(out.stdout).slice(0, 300));
        throw fail();
      }
      let after;
      try { after = readZaloJobs(hermesHome).find((j) => j.id === id); } catch { after = undefined; }
      const ok = action === 'remove' ? !after : Boolean(after) && after.paused === (action === 'pause');
      if (!ok) {
        console.error('[dashboard] hermes cron', action, id, 'thoát 0 nhưng jobs.json không đổi như mong đợi');
        throw fail();
      }
      return job;
    },
  };
}
