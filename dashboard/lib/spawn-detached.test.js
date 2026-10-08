import test from 'node:test';
import assert from 'node:assert/strict';
import { childEnv } from './spawn-detached.js';
import { EDITABLE_KEYS } from './env-file.js';

test('childEnv bỏ mọi khoá dashboard sửa được (chủ nhân + Cấu hình), giữ phần còn lại', () => {
  const env = { PATH: '/bin', HOME: '/h', ZALO_ALLOWED_USERS: '1', ZALO_FLOOD_WINDOW_S: '9', ZALO_PUBLIC_MCP: 'rag', ZALO_PEOPLE_FILE: '/p' };
  const out = childEnv(env);
  assert.deepEqual(out, { PATH: '/bin', HOME: '/h', ZALO_PEOPLE_FILE: '/p' });
  assert.ok(EDITABLE_KEYS.has('ZALO_FLOOD_WINDOW_S'));
});
