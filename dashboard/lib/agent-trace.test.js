import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildTurns, createAgentTrace, redactArgs, redactSecrets, toolFailed } from './agent-trace.js';

/** state.db thu nhỏ đúng các cột dashboard đọc (lược đồ 28/30 của Hermes). */
function stateDb(t) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-trace-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.db');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, chat_type TEXT, chat_id TEXT, title TEXT, model TEXT, started_at REAL,
    last_activity_at REAL, ended_at REAL, message_count INTEGER, tool_call_count INTEGER, api_call_count INTEGER, input_tokens INTEGER,
    output_tokens INTEGER, cache_read_tokens INTEGER, system_prompt TEXT);
  CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT, tool_call_id TEXT, timestamp REAL);`);
  const s = db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  s.run('z1', 'zalo', 'group', '200', 'Họp tổ', 'hermes', 1000, 1100, null, 4, 1, 2, 9000, 300, 7000, 'LỜI NHẮC HỆ THỐNG BÍ MẬT');
  s.run('c1', 'cron', null, null, 'Báo cáo', 'hermes', 900, 950, 960, 2, 0, 1, 100, 10, 0, '');
  const m = db.prepare('INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, timestamp) VALUES (?,?,?,?,?,?)');
  m.run('z1', 'system', 'LỜI NHẮC HỆ THỐNG BÍ MẬT', null, null, 999);
  m.run('z1', 'user', 'Tra giá vàng hôm nay', null, null, 1000);
  m.run('z1', 'assistant', '', JSON.stringify([{ id: 'call_1', function: { name: 'zalo_web_search', arguments: '{"query":"giá vàng SJC 0912345678","max":5}' } }]), null, 1001);
  m.run('z1', 'tool', '{"results": ["https://bao.vn/vang"]}', null, 'call_1', 1003.5);
  m.run('z1', 'assistant', 'Giá vàng SJC hôm nay là…', '[]', null, 1006);
  db.close();
  return path;
}

test('che tham số: chỉ tên khoá + loại/độ dài; trạng thái lỗi theo JSON', () => {
  assert.deepEqual(redactArgs('{"query":"giá vàng 0912345678","max":5,"urls":["a","b"],"opt":null}'),
    [{ key: 'query', kind: 'chữ, 19 ký tự' }, { key: 'max', kind: 'số' }, { key: 'urls', kind: 'danh sách 2 mục' }, { key: 'opt', kind: 'trống' }]);
  assert.deepEqual(redactArgs('{hỏng'), [{ key: '(không đọc được)', kind: '' }]);
  assert.equal(toolFailed('{"success": false, "error": "x"}'), true);
  assert.equal(toolFailed('{"error": "Công cụ chỉ dùng được…"}'), true);
  assert.equal(toolFailed('{"results": []}'), false);
  assert.equal(toolFailed('Error: timeout'), true);
});

test('che chuỗi giống khoá bí mật trong câu hỏi/câu trả lời', () => {
  const s = redactSecrets('khoá sk-abcdEFGH1234567890xyz, ghp_AbCdEf0123456789AbCdEf0123456789abcd, Bearer eyJhbGciOi.eyJzdWIi.sig123, api_key=bimat123 và AIzaSyA1234567890abcdefghijklmnopqrstu');
  assert.doesNotMatch(s, /abcdEFGH|AbCdEf0123|eyJhbGciOi|bimat123|AIzaSyA123/);
  assert.match(s, /\[đã che\]/);
  assert.equal(redactSecrets('Giá vàng SJC hôm nay là 82 triệu'), 'Giá vàng SJC hôm nay là 82 triệu');
});

test('phiên theo nguồn và hội thoại; token theo phiên; không đọc lời nhắc hệ thống', (t) => {
  const trace = createAgentTrace({ dbPath: stateDb(t) });
  const z = trace.sessions({ source: 'zalo' });
  assert.deepEqual(z.map((s) => [s.id, s.chatId, s.input, s.output, s.cached]), [['z1', '200', 9000, 300, 7000]]);
  assert.equal(trace.sessions({ source: 'all' }).length, 2);
  assert.deepEqual(trace.sessions({ source: 'all', before: 1100_000 }).map((s) => s.id), ['c1'], 'trang sau: phiên cũ hơn mốc');
  assert.equal(trace.sessions({ source: 'zalo', chat: '999' }).length, 0);
  assert.doesNotMatch(JSON.stringify(z), /BÍ MẬT/);
  assert.throws(() => trace.sessions({ source: 'x' }), (e) => e.statusCode === 400);
  assert.throws(() => trace.sessions({ chat: "1' OR 1=1" }), (e) => e.statusCode === 400);
  assert.throws(() => trace.sessions({ before: 'abc' }), (e) => e.statusCode === 400);
});

test('lượt: câu hỏi, công cụ (tham số đã che, trạng thái, thời gian), câu trả lời; không lộ kết quả công cụ', (t) => {
  const trace = createAgentTrace({ dbPath: stateDb(t) });
  const [turn] = trace.turns('z1');
  assert.equal(turn.user, 'Tra giá vàng hôm nay');
  assert.equal(turn.reply, 'Giá vàng SJC hôm nay là…');
  assert.equal(turn.ms, 6000);
  assert.deepEqual(turn.tools, [{ name: 'zalo_web_search', args: [{ key: 'query', kind: 'chữ, 23 ký tự' }, { key: 'max', kind: 'số' }], status: 'xong', ms: 2500 }]);
  const text = JSON.stringify(trace.turns('z1'));
  assert.doesNotMatch(text, /0912345678|bao\.vn|BÍ MẬT/);
  assert.throws(() => trace.turns('../x'), (e) => e.statusCode === 400);
  assert.throws(() => createAgentTrace({ dbPath: join(tmpdir(), 'khong-co.db') }).sessions(), (e) => e.statusCode === 503);
});

test('gom lượt: phần đầu trang bị cắt (chưa có tin người dùng) thì bỏ; công cụ chưa có kết quả là "đang chạy"', () => {
  const turns = buildTurns([
    { role: 'tool', content: '{}', tool_call_id: 'x', timestamp: 1 },
    { role: 'user', content: 'a', timestamp: 2 },
    { role: 'assistant', content: '', tool_calls: JSON.stringify([{ id: 'k', function: { name: 'terminal', arguments: '{}' } }]), timestamp: 3 },
  ]);
  assert.equal(turns.length, 1);
  assert.deepEqual(turns[0].tools, [{ name: 'terminal', args: [], status: 'đang chạy', ms: null }]);
});
