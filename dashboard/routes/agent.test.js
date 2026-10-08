import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAgentConfig, createSoul } from '../lib/agent-config.js';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

function withAgent(t) {
  const deps = makeDeps(t);
  writeFileSync(join(deps.dir, 'config.yaml'), 'model:\n  default: hermes\n  base_url: http://127.0.0.1:20128/v1\n  api_key: sk-bi-mat\nagent:\n  reasoning_effort: medium\n');
  writeFileSync(join(deps.dir, 'SOUL.md'), 'Tôi là bot.');
  deps.agentConfig = createAgentConfig({ configFile: join(deps.dir, 'config.yaml'), fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ id: 'hermes' }, { id: 'ag/gemini-3.1-pro' }] }) }) });
  deps.soul = createSoul({ hermesHome: deps.dir, historyDir: join(deps.dir, 'soul-history') });
  return deps;
}

test('Agent: chỉ Quản trị; đổi model không cần khởi động lại; SOUL và mức suy nghĩ đặt cờ chờ; mọi lần đổi vào Nhật ký; không lộ khoá', async (t) => {
  const deps = withAgent(t);
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/agent', { cookie: owner })).status, 403);
  for (const [method, path] of [['GET', '/api/admin/agent/models'], ['PUT', '/api/admin/agent/model'], ['PUT', '/api/admin/agent/reasoning'], ['PUT', '/api/admin/agent/soul'],
    ['GET', '/api/admin/agent/soul/history/original'], ['POST', '/api/admin/agent/soul/restore/original']]) {
    assert.equal((await call(path, { method, cookie: owner, body: method === 'GET' ? undefined : {} })).status, 403, `${method} ${path}`);
  }
  const admin = await loginAs(t, deps, call);
  const v = await call('/api/admin/agent', { cookie: admin });
  assert.equal(v.json.model, 'hermes');
  assert.doesNotMatch(JSON.stringify(v.json), /sk-bi-mat/);
  assert.deepEqual((await call('/api/admin/agent/models', { cookie: admin })).json.models, ['hermes', 'ag/gemini-3.1-pro']);
  assert.equal((await call('/api/admin/agent/model', { method: 'PUT', cookie: admin, body: { model: 'ag/gemini-3.1-pro' } })).json.model, 'ag/gemini-3.1-pro');
  assert.equal(deps.restartFlags.get().assistant, null, 'đổi model có hiệu lực ngay');
  assert.equal((await call('/api/admin/agent/model', { method: 'PUT', cookie: admin, body: { model: 'khong-co' } })).status, 400);
  await call('/api/admin/agent/soul', { method: 'PUT', cookie: admin, body: { text: 'Tôi là Uyển Nhi.' } });
  assert.equal(readFileSync(join(deps.dir, 'SOUL.md'), 'utf8'), 'Tôi là Uyển Nhi.');
  await call('/api/admin/agent/reasoning', { method: 'PUT', cookie: admin, body: { value: 'high' } });
  assert.deepEqual(deps.restartFlags.get().assistant.reasons, ['Tính cách (SOUL.md)', 'Mức suy nghĩ']);
  const restored = await call('/api/admin/agent/soul/restore/original', { method: 'POST', cookie: admin });
  assert.equal(restored.json.soul.text, 'Tôi là bot.');
  assert.equal((await call('/api/admin/agent/soul/history/..%2Fconfig', { cookie: admin })).status, 404);
  assert.deepEqual(deps.activity.list().map((e) => e.action).filter((a) => a.startsWith('agent_')),
    ['agent_soul_restore', 'agent_reasoning', 'agent_soul', 'agent_model']);
});
