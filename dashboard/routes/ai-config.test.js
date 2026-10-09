import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAgentConfig } from '../lib/agent-config.js';
import { createAiKeys } from '../lib/ai-keys.js';
import { createAiModels } from '../lib/ai-models.js';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

const SECRET = 'core-abcdefghijklmnop9876';

function withAi(t) {
  const deps = makeDeps(t);
  const envFile = join(deps.dir, '.env');
  const configFile = join(deps.dir, 'config.yaml');
  writeFileSync(envFile, `CORE_API_KEY=${SECRET}\n`);
  writeFileSync(configFile, 'model:\n  default: 2anhPRO\n  provider: custom\n  base_url: http://127.0.0.1:9/v1\n  api_key: sk-abcdefghijkl0000\ntts:\n  provider: gemini-9router\n  gemini:\n    voice: Leda\nimage_gen:\n  provider: openai-codex\n  model: gpt-image-2-medium\n');
  const fetchImpl = async (url) => {
    if (url.endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: '2anhPRO' }, { id: 'ag/gemini-3.8-flash-low' }] }) };
    if (url.endsWith('/chat/completions')) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Xin chào, mình sẵn sàng.' } }] }) };
    return { ok: true, status: 200 };
  };
  deps.agentConfig = createAgentConfig({ configFile, fetchImpl });
  deps.aiKeys = createAiKeys({ envFile, configFile, fetchImpl });
  deps.aiModels = createAiModels({ configFile, fetchImpl, ovConf: join(deps.dir, 'khong-co.conf') });
  return { deps, envFile, configFile };
}

test('Khoá API & Model: chỉ Quản trị; thẻ theo chức năng; đổi model chính, thử; thay khoá ghi Nhật ký chỉ tên', async (t) => {
  const { deps, envFile, configFile } = withAi(t);
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  for (const p of ['/api/admin/ai/models', '/api/admin/ai/keys']) assert.equal((await call(p, { cookie: owner })).status, 403);
  const admin = await loginAs(t, deps, call);
  const m = (await call('/api/admin/ai/models', { cookie: admin })).json;
  assert.deepEqual(m.cards.map((c) => [c.id, c.model]), [['main', '2anhPRO'], ['tts', 'giọng Leda'], ['image', 'gpt-image-2-medium']]);
  assert.deepEqual(m.models, ['2anhPRO', 'ag/gemini-3.8-flash-low']);
  assert.ok(!JSON.stringify(m).includes('sk-abcdefghijkl'), 'không lộ khoá cổng AI');
  const changed = await call('/api/admin/ai/model', { method: 'PUT', cookie: admin, body: { model: 'ag/gemini-3.8-flash-low' } });
  assert.equal(changed.status, 200);
  assert.match(readFileSync(configFile, 'utf8'), /default: ag\/gemini-3.8-flash-low/);
  const tried = (await call('/api/admin/ai/test', { method: 'POST', cookie: admin, body: {} })).json;
  assert.deepEqual([tried.ok, tried.reply], [true, 'Xin chào, mình sẵn sàng.']);
  const keys = (await call('/api/admin/ai/keys', { cookie: admin })).json;
  assert.ok(!JSON.stringify(keys).includes(SECRET));
  const put = await call('/api/admin/ai/keys/CORE_API_KEY', { method: 'PUT', cookie: admin, body: { value: 'core-moi-1234567890abcd' } });
  assert.equal(put.status, 200);
  assert.match(readFileSync(envFile, 'utf8'), /CORE_API_KEY=core-moi-1234567890abcd/);
  assert.ok(deps.restartFlags.get().assistant, 'nhắc khởi động lại');
  const log = deps.activity.list().filter((e) => e.action.startsWith('ai_key'));
  assert.deepEqual(log.map((e) => [e.action, e.detail]), [['ai_key_set', 'CORE_API_KEY']]);
  assert.ok(!JSON.stringify(deps.activity.list()).includes('core-moi'), 'Nhật ký không ghi giá trị khoá');
  assert.equal((await call('/api/admin/ai/keys/ZALO_ALLOWED_USERS', { method: 'PUT', cookie: admin, body: { value: 'abcdefgh12345678' } })).status, 400);
});
