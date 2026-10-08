import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInsightAi } from './insight-ai.js';
import { chatMsg, makeDeps, seedHistory } from '../test-helpers.js';

function setup(t, clock = { now: Date.now() }) {   // cùng đồng hồ với mtime của tệp
  const dir = mkdtempSync(join(tmpdir(), 'zd-ins-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let n = 0;
  return { dir, ai: createInsightAi({ dir, now: () => clock.now, newId: () => `${(n += 1)}`.padStart(16, '0') }), clock };
}

test('gửi yêu cầu: ghi tệp đúng dạng plugin đọc; một lúc một yêu cầu; không có chữ → 400', (t) => {
  const { dir, ai } = setup(t);
  const id = ai.request({ groupId: '200', groupName: 'Tổ Hoá', days: 7, transcript: '08:00 Lan: chào', by: 'anh' });
  const req = JSON.parse(readFileSync(join(dir, 'requests', `${id}.json`), 'utf8'));
  assert.deepEqual(Object.keys(req).sort(), ['by', 'createdAt', 'days', 'groupId', 'groupName', 'id', 'transcript', 'v']);
  assert.throws(() => ai.request({ groupId: '200', days: 7, transcript: 'x', by: 'anh' }), (e) => e.statusCode === 409);
  assert.throws(() => ai.request({ groupId: '200', days: 7, transcript: '  ', by: 'anh' }), (e) => e.statusCode === 400);
  assert.deepEqual(ai.result(id), { status: 'pending' });
});

test('kết quả: done khi plugin ghi; quá 3 phút không có → timeout; id lạ 400, không có 404', (t) => {
  const clock = { now: Date.now() };
  const { dir, ai } = setup(t, clock);
  const id = ai.request({ groupId: '200', days: 7, transcript: 'x', by: 'anh' });
  clock.now += 4 * 60_000;
  assert.deepEqual(ai.result(id), { status: 'timeout' });
  mkdirSync(join(dir, 'results'), { recursive: true });
  writeFileSync(join(dir, 'results', `${id}.json`), JSON.stringify({ ok: true, summary: { topics: [] } }));
  assert.equal(ai.result(id).status, 'done');
  assert.throws(() => ai.result('../x'), (e) => e.statusCode === 400);
  assert.throws(() => ai.result('ffffffffffffffff'), (e) => e.statusCode === 404);
  // Yêu cầu bỏ rơi quá hạn được dọn để lần sau gửi được.
  utimesSync(join(dir, 'requests', `${id}.json`), 1, 1);
  assert.ok(ai.request({ groupId: '200', days: 7, transcript: 'y', by: 'anh' }));
});

test('đoạn hội thoại gửi AI: theo thời gian, nhãn ảnh không kèm link, bỏ mã đăng nhập, cắt theo cỡ', (t) => {
  const deps = makeDeps(t);
  const base = Date.UTC(2026, 9, 7, 1, 0); // 08:00 VN
  const g = (over) => chatMsg({ threadId: '200', threadType: 1, ...over });
  seedHistory(deps, { messages: [
    g({ senderName: 'Lan', text: 'Họp tổ thứ Hai', ts: base }),
    g({ senderName: 'Minh', msgType: 'chat.photo', text: 'https://photo.zdn.vn/a.jpg', ts: base + 60_000 }),
    g({ isSelf: true, text: 'Mã đăng nhập dashboard: 123456', ts: base + 120_000 }),
    g({ isSelf: true, text: 'Dạ em ghi nhận', ts: base + 180_000 }),
  ] });
  const text = deps.store.groupTranscript('200', { days: 7, nowMs: base + 3_600_000 });
  assert.equal(text, '07/10 08:00 Lan: Họp tổ thứ Hai\n07/10 08:01 Minh: [Ảnh]\n07/10 08:03 Bot: Dạ em ghi nhận');
  assert.equal(deps.store.groupTranscript('200', { days: 7, nowMs: base + 3_600_000, maxChars: 40 }), '07/10 08:03 Bot: Dạ em ghi nhận', 'giữ tin mới nhất khi phải cắt');
});
