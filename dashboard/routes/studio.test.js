import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

const usage = {
  version: 1,
  days: {
    '2026-10-06': { '1234567890123456': { name: 'Cô Lan', jobs: 2, ok: 1, failed: 0, refunded: 1, input_tokens: 9000, output_tokens: 3000, kinds: { slide: 2 } } },
    '2026-10-07': {
      '1234567890123456': { name: 'Cô Lan', jobs: 1, ok: 1, failed: 0, refunded: 0, input_tokens: 5000, output_tokens: 2000 },
      '2234567890123456789': { name: 'Thầy Nam', jobs: 3, ok: 2, failed: 1, refunded: 0, input_tokens: 100, output_tokens: 50, images: 9 },
      rác: { jobs: 99 },
    },
    'không phải ngày': {},
  },
  jobs: [{ id: 'a', at: 1_790_000_000, name: 'Thầy Nam', kind: 'video', status: 'ok', group: true },
    { id: 'b', at: 1_790_000_100, name: 'Cô Lan', kind: 'giao_an', status: 'lạ', group: false }],
};

test('lượt dùng xưởng: cả hai vai trò xem được, ngày mới nhất trước, người dùng nhiều nhất trước; 401 khi chưa đăng nhập', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  assert.equal((await call('/api/studio-usage')).status, 401);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const empty = await call('/api/studio-usage', { cookie: owner });
  assert.deepEqual(empty.json, { ok: true, error: null, days: [], recent: [] });
  mkdirSync(dirname(deps.studioUsageFile), { recursive: true });
  writeFileSync(deps.studioUsageFile, JSON.stringify(usage));
  const res = await call('/api/studio-usage', { cookie: owner });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.days.map((d) => d.date), ['2026-10-07', '2026-10-06']);
  assert.deepEqual(res.json.days[0].people.map((p) => p.name), ['Thầy Nam', 'Cô Lan']);
  assert.equal(res.json.days[0].jobs, 4);
  assert.equal(res.json.days[0].inputTokens, 5100);
  assert.equal(res.json.days[0].images, 9);
  assert.equal(res.json.days[0].people[0].images, 9);
  assert.deepEqual(res.json.recent.map((j) => [j.kind, j.status, j.at]), [['giao_an', 'failed', 1_790_000_100_000], ['video', 'ok', 1_790_000_000_000]]);
  writeFileSync(deps.studioUsageFile, '{hỏng');
  assert.equal((await call('/api/studio-usage', { cookie: owner })).json.error, 'unreadable');
});
