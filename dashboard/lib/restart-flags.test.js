import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRestartFlags } from './restart-flags.js';

test('cờ chờ khởi động lại: gộp lý do, không trùng; xoá chỉ khi không có thay đổi mới chen vào', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'zd-flags-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const f = createRestartFlags({ file: join(d, 'restart-flags.json'), now: () => 5 });
  assert.deepEqual(f.get(), { assistant: null, sidecar: null });
  f.mark('assistant', 'Đổi model'); f.mark('assistant', 'Đổi model'); f.mark('assistant', 'Tính cách');
  const seen = f.get().assistant;
  assert.deepEqual(seen, { since: 5, rev: 3, reasons: ['Đổi model', 'Tính cách'] });
  f.mark('assistant', 'Cấu hình: chống spam');           // đổi thêm trong lúc đang khởi động lại
  assert.equal(f.clear('assistant', seen.rev), false);
  assert.equal(f.clear('assistant', f.get().assistant.rev), true);
  assert.equal(f.get().assistant, null);
  assert.throws(() => f.mark('khac', 'x'), /đích lạ/);
});
