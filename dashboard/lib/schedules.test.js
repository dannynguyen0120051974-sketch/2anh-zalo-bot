import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSchedules, cronTarget, hermesBin, zaloJobs } from './schedules.js';

const JOBS = { jobs: [
  { id: 'cc158a101f88', name: 'Báo cáo GCP', prompt: 'x', script: 'run_billing_report.py', deliver: 'origin', origin: { platform: 'telegram', chat_id: '86' } },
  { id: 'aa11bb22cc33', name: 'Nhắc nộp bài', prompt: 'Nhắc lớp nộp bài', schedule: { display: '0 7 * * 1' }, enabled: true, state: 'scheduled',
    next_run_at: '2026-10-12T07:00:00+07:00', deliver: 'origin', origin: { platform: 'zalo', chat_id: '555', zalo_scope: 'group', zalo_creator_uid: '1111111111111111111', zalo_creator_name: 'Lan' } },
  { id: 'dd44ee55ff66', name: 'Tin sáng', schedule_display: '0 6 * * *', deliver: 'zalo:777:1', state: 'paused', paused_at: '2026-10-01T00:00:00Z', origin: {} },
  { id: '../evil', deliver: 'zalo:1' },
] };

function home(t, data = JOBS) {
  const h = mkdtempSync(join(tmpdir(), 'zd-cron-'));
  t.after(() => rmSync(h, { recursive: true, force: true }));
  mkdirSync(join(h, 'cron'));
  writeFileSync(join(h, 'cron', 'jobs.json'), JSON.stringify(data));
  return h;
}

/** Giả lập Hermes thật sự làm việc: sửa jobs.json (hoặc xoá việc nếu fn trả 'remove'). */
function mutate(h, id, fn) {
  const file = join(h, 'cron', 'jobs.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const job = data.jobs.find((j) => j.id === id);
  if (fn(job) === 'remove') data.jobs = data.jobs.filter((j) => j.id !== id);
  writeFileSync(file, JSON.stringify(data));
}

test('chỉ việc gửi về Zalo; phân biệt hẹn giờ nhóm và việc của chủ nhân; không lộ script', () => {
  assert.equal(cronTarget({ deliver: 'telegram,zalo:42:1' }), '42');
  assert.equal(cronTarget({ deliver: 'origin', origin: { platform: 'zalo', chat_id: 9 } }), '9');
  const list = zaloJobs(JOBS);
  assert.deepEqual(list.map((j) => [j.id, j.kind, j.target, j.paused]), [['aa11bb22cc33', 'group', '555', false], ['dd44ee55ff66', 'owner', '777', true]]);
  assert.equal(list[0].creatorName, 'Lan');
  assert.equal('creatorUid' in list[0], false, 'không lộ uid người tạo');
  assert.equal(list[0].schedule, '0 7 * * 1');
  assert.equal(list[0].nextRunAt, Date.parse('2026-10-12T07:00:00+07:00'));
  assert.doesNotMatch(JSON.stringify(list), /run_billing|telegram/);
});

test('thao tác chạy đúng lệnh Hermes, chỉ với việc Zalo; id lạ/việc khác → 404; lệnh lỗi → 502 câu chung', async (t) => {
  const h = home(t);
  const calls = [];
  const s = createSchedules({ hermesHome: h, bin: 'hermes', env: {}, execImpl: async (file, args, opts) => {
    calls.push([file, args, opts.env.HERMES_HOME, opts.windowsHide]);
    mutate(h, args[2], (j) => { j.state = 'paused'; j.paused_at = '2026-10-08T00:00:00Z'; });
    return { stdout: '' };
  } });
  assert.equal((await s.cron('pause', 'aa11bb22cc33')).name, 'Nhắc nộp bài');
  assert.deepEqual(calls, [['hermes', ['cron', 'pause', 'aa11bb22cc33'], h, true]]);
  await assert.rejects(s.cron('remove', 'cc158a101f88'), (e) => e.statusCode === 404, 'việc gửi Telegram không đụng tới được');
  await assert.rejects(s.cron('remove', '../evil'), (e) => e.statusCode === 404);
  await assert.rejects(s.cron('run', 'aa11bb22cc33'), (e) => e.statusCode === 400);
  const failing = createSchedules({ hermesHome: h, bin: 'hermes', env: {}, execImpl: async () => { throw Object.assign(new Error('exit 1'), { stderr: '/root/.hermes bí mật' }); } });
  await assert.rejects(failing.cron('resume', 'dd44ee55ff66'), (e) => e.statusCode === 502 && !/root/.test(e.message));
});

test('đường lệnh hermes: biến môi trường → bản cài kèm → PATH', () => {
  assert.equal(hermesBin({ hermesHome: '/h', env: { ZALO_HERMES_BIN: '/x/hermes' } }), '/x/hermes');
  assert.equal(hermesBin({ hermesHome: 'E:/Hermes', env: {}, platform: 'win32', exists: () => true }), join('E:/Hermes', 'bin', 'hermes.exe'));
  assert.equal(hermesBin({ hermesHome: '/root/.hermes', env: {}, platform: 'linux', exists: () => false }), 'hermes');
});

test('hermes cron thoát 0 mà không làm được → 502 có bước tiếp theo; làm được thì resume/remove cũng được xác nhận', async (t) => {
  const h = home(t);
  const noop = createSchedules({ hermesHome: h, bin: 'hermes', env: {}, execImpl: async () => ({ stdout: 'ok' }) });
  for (const [action, id] of [['pause', 'aa11bb22cc33'], ['resume', 'dd44ee55ff66'], ['remove', 'aa11bb22cc33']]) {
    await assert.rejects(noop.cron(action, id), (e) => e.statusCode === 502 && /thử lại/.test(e.message), `${action} không đổi trạng thái`);
  }
  const said = createSchedules({ hermesHome: h, bin: 'hermes', env: {}, execImpl: async (f, a) => { mutate(h, a[2], (j) => { j.state = 'paused'; }); return { stdout: 'Failed to pause job' }; } });
  await assert.rejects(said.cron('pause', 'aa11bb22cc33'), (e) => e.statusCode === 502, 'chữ "Failed to" trong stdout');
  const real = createSchedules({ hermesHome: h, bin: 'hermes', env: {}, execImpl: async (f, [, action, id]) => {
    mutate(h, id, (j) => { if (action === 'resume') { j.state = 'scheduled'; delete j.paused_at; } else if (action === 'remove') return 'remove'; });
    return { stdout: 'done' };
  } });
  assert.equal((await real.cron('resume', 'dd44ee55ff66')).id, 'dd44ee55ff66');
  assert.equal((await real.cron('remove', 'aa11bb22cc33')).id, 'aa11bb22cc33');
  assert.deepEqual(real.list().map((j) => j.id), ['dd44ee55ff66']);
});
