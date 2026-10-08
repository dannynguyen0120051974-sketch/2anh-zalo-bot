import test from 'node:test';
import assert from 'node:assert/strict';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

const JOB = { id: 'aa11bb22cc33', name: 'Nhắc nộp bài', kind: 'group', target: '200', paused: false };

function fakeSchedules(over = {}) {
  const calls = [];
  return { calls, list: () => [JOB], cron: async (action, id) => { calls.push([action, id]); return JOB; }, ...over };
}

test('Lịch hẹn: Chủ bot xem việc + tên nhóm; tạm dừng ghi Nhật ký; thao tác lạ 400; lỗi đọc vẫn 200 kèm câu lỗi', async (t) => {
  const deps = makeDeps(t, { schedules: fakeSchedules() });
  const { call } = await startApp(t, deps);
  assert.equal((await call('/api/schedules')).status, 401);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const r = await call('/api/schedules', { cookie: owner });
  assert.equal(r.json.jobs[0].targetName, 'Tổ Hoá');
  assert.equal((await call('/api/schedules/cron/aa11bb22cc33/pause', { method: 'POST', cookie: owner })).status, 200);
  assert.deepEqual(deps.schedules.calls, [['pause', 'aa11bb22cc33']]);
  assert.equal(deps.activity.list()[0].action, 'cron_pause');
  assert.equal((await call('/api/schedules/cron/aa11bb22cc33/run', { method: 'POST', cookie: owner })).status, 400);

  const broken = makeDeps(t, { schedules: fakeSchedules({ list: () => { throw new Error('jobs.json hỏng'); } }) });
  const app2 = await startApp(t, broken);
  const admin = await loginAs(t, broken, app2.call);
  const r2 = await app2.call('/api/schedules', { cookie: admin });
  assert.equal(r2.status, 200);
  assert.match(r2.json.cronError, /Chưa đọc được/);
});

test('Lịch hẹn: lỗi lệnh Hermes ghi Nhật ký thất bại và trả câu của lib; lời nhắc Zalo chuyển xuống kết nối Zalo kèm người làm', async (t) => {
  const deps = makeDeps(t, { schedules: fakeSchedules({ cron: async () => { throw Object.assign(new Error('Trợ lý chưa làm được việc này — thử lại.'), { statusCode: 502 }); } }) });
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  const r = await call('/api/schedules/cron/aa11bb22cc33/remove', { method: 'POST', cookie: admin });
  assert.equal(r.status, 502);
  assert.equal(deps.activity.list()[0].ok, false);
  assert.equal((await call('/api/schedules/reminders?threadId=200&threadType=1', { cookie: admin })).json.reminders[0].title, 'Họp tổ');
  assert.equal((await call('/api/schedules/reminders?threadId=abc&threadType=1', { cookie: admin })).status, 400);
  await call('/api/schedules/reminders/remove', { method: 'POST', cookie: admin, body: { reminderId: '77', threadId: '200', threadType: 1 } });
  assert.deepEqual(deps.sidecar.calls.at(-1), ['remove-reminder', { reminderId: '77', threadId: '200', threadType: 1, actor: 'anh' }]);
});
