import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMcpServers } from '../lib/mcp-servers.js';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

test('Kết nối MCP: chỉ Quản trị; tắt ghi config + cờ chờ + Nhật ký; không có route thêm máy chủ', async (t) => {
  const deps = makeDeps(t);
  writeFileSync(join(deps.dir, 'config.yaml'), 'mcp_servers:\n  rag:\n    url: http://127.0.0.1:9998/mcp\n');
  deps.mcpServers = createMcpServers({ configFile: join(deps.dir, 'config.yaml'), probe: async () => false });
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/mcp', { cookie: owner })).status, 403);
  assert.equal((await call('/api/admin/mcp/rag', { method: 'PUT', cookie: owner, body: { enabled: false } })).status, 403);
  const admin = await loginAs(t, deps, call);
  assert.equal((await call('/api/admin/mcp', { cookie: admin })).json.servers[0].status, 'Không phản hồi');
  const off = await call('/api/admin/mcp/rag', { method: 'PUT', cookie: admin, body: { enabled: false } });
  assert.equal(off.json.servers[0].status, 'Đã tắt');
  assert.deepEqual(deps.restartFlags.get().assistant.reasons, ['Kết nối MCP: rag']);
  assert.equal(deps.activity.list().find((e) => e.action === 'mcp_disable').detail, 'rag');
  assert.equal((await call('/api/admin/mcp/rag', { method: 'PUT', cookie: admin, body: { enabled: 'x' } })).status, 400);
  assert.equal((await call('/api/admin/mcp/khac', { method: 'PUT', cookie: admin, body: { enabled: true } })).status, 404);
  assert.equal((await call('/api/admin/mcp', { method: 'POST', cookie: admin, body: { name: 'x', command: 'rm' } })).status, 404);
});
