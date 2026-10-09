import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSpec, fromSchedule, mondayOf, moveSpec, specProblem, toSchedule, weekOccurrences } from './schedule-spec.js';

test('lịch bằng lời thường → lịch Hermes và ngược lại', () => {
  const cases = [
    [{ repeat: 'daily', times: ['08:30'] }, '30 8 * * *'],
    [{ repeat: 'daily', times: ['20:00', '08:00'] }, '0 8,20 * * *'],
    [{ repeat: 'weekly', times: ['07:00'], days: [1, 7] }, '0 7 * * 0,1'],
    [{ repeat: 'monthly', times: ['06:15'], dayOfMonth: 5 }, '15 6 5 * *'],
  ];
  for (const [spec, expr] of cases) {
    assert.equal(toSchedule(spec), expr);
    const back = fromSchedule({ kind: 'cron', expr });
    assert.equal(toSchedule(back), expr, expr);
  }
  assert.equal(toSchedule({ repeat: 'once', date: '2026-10-23', times: ['08:00'] }), '2026-10-23T08:00');
  assert.deepEqual(fromSchedule({ kind: 'once', run_at: '2026-10-23T08:00:00+07:00' }), { repeat: 'once', date: '2026-10-23', times: ['08:00'] });
  assert.deepEqual(fromSchedule({ kind: 'cron', expr: '0 7 * * 1' }), { repeat: 'weekly', times: ['07:00'], days: [1] });
  for (const advanced of [{ kind: 'interval', minutes: 30 }, { kind: 'cron', expr: '*/15 * * * *' }, { kind: 'cron', expr: '0 9 * 1 *' }, { kind: 'cron', expr: '0 9-17 * * *' }, null]) {
    assert.equal(fromSchedule(advanced), null, JSON.stringify(advanced));
  }
});

test('kiểm dạng thường: câu lỗi dễ hiểu', () => {
  assert.match(specProblem({ repeat: 'weekly', times: ['07:00'], days: [] }), /ít nhất một thứ/);
  assert.match(specProblem({ repeat: 'daily', times: ['25:00'] }), /giờ:phút/);
  assert.match(specProblem({ repeat: 'daily', times: ['08:00', '20:30'] }), /cùng số phút/);
  assert.match(specProblem({ repeat: 'once', times: ['08:00'] }), /ngày chạy/);
  assert.equal(specProblem({ repeat: 'monthly', times: ['08:00'], dayOfMonth: 31 }), '');
  assert.throws(() => toSchedule({ repeat: 'daily', times: [] }), /giờ chạy/);
});

test('mô tả, lần chạy trong tuần, kéo sang ngày khác', () => {
  assert.equal(describeSpec({ repeat: 'weekly', times: ['20:00'], days: [2, 4] }), 'T3, T5 lúc 20:00');
  assert.equal(describeSpec({ repeat: 'once', date: '2026-10-23', times: ['08:00'] }), 'Một lần, 23/10/2026 lúc 08:00');
  assert.equal(describeSpec(null), 'Lịch nâng cao');
  assert.equal(mondayOf('2026-10-09'), '2026-10-05');
  assert.equal(mondayOf('2026-10-11'), '2026-10-05', 'Chủ nhật thuộc tuần bắt đầu thứ Hai trước');
  const week = '2026-10-05';
  assert.deepEqual(weekOccurrences({ repeat: 'weekly', times: ['20:00'], days: [2, 4] }, week).map((o) => [o.day, o.date]), [[2, '2026-10-06'], [4, '2026-10-08']]);
  assert.equal(weekOccurrences({ repeat: 'daily', times: ['08:00', '20:00'] }, week).length, 14);
  assert.deepEqual(weekOccurrences({ repeat: 'monthly', times: ['07:00'], dayOfMonth: 9 }, week).map((o) => o.day), [5]);
  assert.deepEqual(weekOccurrences({ repeat: 'once', date: '2026-10-23', times: ['08:00'] }, week), []);
  assert.deepEqual(moveSpec({ repeat: 'weekly', times: ['20:00'], days: [2, 4] }, 2, 5, '2026-10-09').days, [4, 5]);
  assert.equal(moveSpec({ repeat: 'once', date: '2026-10-06', times: ['08:00'] }, 2, 6, '2026-10-10').date, '2026-10-10');
  assert.equal(moveSpec({ repeat: 'monthly', times: ['07:00'], dayOfMonth: 9 }, 5, 1, '2026-10-05').dayOfMonth, 5);
  assert.equal(moveSpec({ repeat: 'daily', times: ['08:00'] }, 1, 3, '2026-10-07'), null, 'hằng ngày không kéo đổi ngày');
});

test('việc một lần lưu theo múi giờ khác (agent tạo "…Z") → đổi đúng sang giờ Việt Nam', () => {
  assert.deepEqual(fromSchedule({ kind: 'once', run_at: '2026-10-23T01:00:00Z' }), { repeat: 'once', date: '2026-10-23', times: ['08:00'] });
  assert.deepEqual(fromSchedule({ kind: 'once', run_at: '2026-10-23T23:30:00+00:00' }), { repeat: 'once', date: '2026-10-24', times: ['06:30'] });
  assert.deepEqual(fromSchedule({ kind: 'once', run_at: '2026-10-23T08:00' }), { repeat: 'once', date: '2026-10-23', times: ['08:00'] });
  assert.equal(fromSchedule({ kind: 'once', run_at: 'hỏng' }), null);
});
