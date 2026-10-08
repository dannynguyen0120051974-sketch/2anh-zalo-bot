# Dashboard v2 — Giai đoạn 7B (hệ thống) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm 5 trang Hệ thống chỉ dành cho Quản trị — Agent (model, mức suy nghĩ, tính cách SOUL.md có lịch sử), Công cụ (danh sách + tắt riêng từng công cụ với người ngoài), Theo dõi agent (phiên/lượt/công cụ/token từ state.db), Kết nối MCP (xem, bật/tắt), Cấu hình (danh sách cài đặt an toàn + lời chào nhóm) — cùng cờ "chờ khởi động lại" dùng chung. Phát hành **v1.27.0** (sau v1.26.0 của kế hoạch 7A).

**Architecture:** Mọi sửa config.yaml đi qua một bộ sửa theo dòng có kiểm lại toàn tệp (`config-yaml.js`, cùng triết lý `/model`); mọi sửa `.env` đi qua `env-file.js` mở rộng (danh sách khoá + luật giá trị). Thay đổi cần khởi động lại ghi vào `restart-flags.json`; dải vàng chung gọi route khởi động lại sẵn có. Plugin ghi `tools-manifest.json` lúc nạp và chặn công cụ trong `permissions.json` mục mới `tools.off` (vẫn `version: 1`). Theo dõi agent đọc `state.db` chỉ đọc, che tham số công cụ. Thêm máy chủ MCP **không** có trên dashboard.

**Tech Stack:** Node ≥ 22 ESM, Express 5.2.1, `node:test`, `node:sqlite`, `node:net`, `yaml` 2 (đã có), Preact 10 + htm 3, Python 3.11 `unittest`. Không thêm gói npm nào.

**Spec:** `docs/superpowers/specs/2026-10-08-dashboard-v2-phase7-parity.md` (§18.6–§18.12). Kế hoạch này giả định kế hoạch `2026-10-08-dashboard-v2-phase7a.md` đã xong (thanh bên `GROUPS` có `admin`/`feature` theo mục, `visibleGroups(role, features)`, `READ_ONLY_KEYS`, `writeFileAtomic({tmpName})`, lớp `.row-list`, biểu tượng `tool`/`plug`/`settings`).

## Global Constraints

- Không thêm gói npm. Không bước build. CSP giữ nguyên (không `style=`, không `innerHTML`; `public.test.js` quét).
- **Mọi trang và route 7B: `requireAuth, requireRole('admin')`.** Chủ bot gọi → 403.
- Không route nào trả khoá: `model.api_key`, `mcp_servers.*.{headers,env,args}`, `bridge_token`, token Telegram, mọi khoá ngoài danh sách Cấu hình. Test ghim chữ khoá không xuất hiện trong JSON.
- config.yaml chỉ sửa qua `editConfigYaml` (theo dòng + kiểm lại toàn tệp + `.bak`); `.env` chỉ qua `writeEnvKey` (danh sách khoá + luật giá trị + `.bak`).
- Mọi thao tác ghi để lại dòng `activity.jsonl` có nhãn tiếng Việt ở Nhật ký.
- `permissions.json` giữ `version: 1`; mục mới `tools` tuỳ chọn, phải sống qua mọi lần lưu nhóm/mặc định/nhắn riêng/hạn mức.
- Plugin Python: mục `tools` thiếu/hỏng/đọc lỗi → không chặn thêm (hành vi cũ); chủ nhân không bao giờ bị chặn; ghi manifest lỗi không làm hỏng việc nạp plugin.
- Không chạy lệnh mới nào (7B không có `execFile` mới); dò mạng chỉ TCP tới loopback.
- Chữ giao diện tiếng Việt thường, mọi lỗi kèm bước tiếp theo; repo CRLF — sửa bằng công cụ Edit.
- Chạy test: `HERMES_HOME=E:/Hermes npm test`. Commit kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Quyết định (spec để ngỏ hoặc chọn trong kế hoạch)

1. **Model đổi là có hiệu lực ngay** (như `/model`) — không đặt cờ chờ. **Mức suy nghĩ, SOUL.md, MCP, Cấu hình** → cờ chờ khởi động lại trợ lý (Cấu hình có mục cần khởi động lại kết nối Zalo).
2. **Không có nhiệt độ** — Hermes không có cài đặt này cho trợ lý chính.
3. **SOUL.md giữ 30 bản cũ + "bản gốc"** (bản trước lần sửa đầu tiên trên dashboard), khôi phục bất kỳ bản nào.
4. **Công cụ chỉ tắt được công cụ công khai** (người ngoài vốn không gọi được công cụ chủ nhân); chặn ở `guard_member_tool_call` trước nút tính năng.
5. **Không có "thêm máy chủ MCP"** (lý do spec §18.6.6); bật/tắt = dòng `enabled`.
6. **Cấu hình ghi vào đúng nơi đang có hiệu lực** (config.yaml khi khoá đang nằm trong `extra` và `extra` thắng; còn lại `.env`).
7. **Lời chào nhóm** đặt ở Cấu hình, ghi `data/welcome.json` bằng chính `updateWelcomeGroup` của kết nối Zalo (đọc nóng, không cờ).
8. **Theo dõi agent: token theo phiên** (Hermes không ghi token theo tin); thời gian công cụ = giờ tin kết quả − giờ tin gọi.

## Review Focus

1. **config.yaml viết tay có chú thích, khối `|` dài, danh sách khối** → sửa một khoá không đổi gì khác; sửa sai → từ chối, tệp giữ nguyên. (Task 1 `sửa đúng khoá, giữ chú thích…`, `config.yaml thật của máy này…`.)
2. **Đổi thêm cài đặt trong lúc đang khởi động lại** → cờ không bị xoá nhầm, dải vàng còn. (Task 2 `cờ chờ khởi động lại: … xoá chỉ khi không có thay đổi mới chen vào`.)
3. **Lưu Phân quyền nhóm/mặc định sau khi đã tắt công cụ** → `tools.off` còn nguyên, plugin vẫn chặn. (Task 5 `… Lưu nhóm sau đó vẫn giữ tools.off`, Task 4 `test_tool_off_blocks_members…`.)
4. **Tham số công cụ chứa số điện thoại/khoá/URL riêng** → Theo dõi agent chỉ hiện tên khoá + loại/độ dài. (Task 6 `che tham số…`, `lượt: … không lộ kết quả công cụ`.)
5. **Giá trị Cấu hình có xuống dòng/nháy/`=` để chèn khoá khác vào .env** → 400, `.env` không đổi. (Task 8 `kiểm giá trị: … không ghi gì`.)

---

## File Structure

**Plugin Hermes:** Modify `hermes-plugin/zalo_tools/group_permissions.py` (`_tools_off`, `tool_off`), `hermes-plugin/zalo_tools/tools.py` (`_tool_off_block`, `tools_manifest`, `write_tools_manifest`), `test_zalo_permissions.py` (`ToolsOffTest`), hai `plugin.yaml`.

**Dashboard — lib mới:** `config-yaml.js`, `restart-flags.js`, `agent-config.js` (`createAgentConfig`, `createSoul`), `tools-catalog.js`, `agent-trace.js`, `mcp-servers.js`, `settings.js` (đều có `.test.js`).
**Dashboard — routes mới:** `agent.js`, `tools.js`, `trace.js`, `mcp.js`, `settings.js` (đều có `.test.js`).
**Dashboard — views mới:** `restart-banner.js`, `agent.js`, `tools.js`, `trace.js`, `mcp.js`, `settings.js`.
**Dashboard — sửa:** `app.js`, `server.js`, `lib/paths.js`, `lib/env-file.js`, `lib/permissions.js`, `lib/audit-feed.js` (+ test), `routes/admin.js` (+ test), `test-helpers.js`, `public/ui.js`, `public/style.css`, `public/views/shell.js`, `public/public.test.js`.

**Phát hành:** `README.vi.md`, `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, hai `plugin.yaml`.

---

### Task 1: Sửa config.yaml an toàn theo dòng

**Files:**
- Create: `dashboard/lib/config-yaml.js`, `dashboard/lib/config-yaml.test.js`

**Interfaces:**
- Consumes: `writeFileAtomic({ mode, tmpName, afterWrite })` (json-store.js), gói `yaml`.
- Produces: `renderScalar(v) → string`, `applyYamlEdits(text, [{ path: string[], value }]) → string` (lỗi `statusCode 400`), `editConfigYaml(file, edits) → boolean` (đã ghi?), `readConfigYaml(file) → object` (lỗi → `{}`).

- [ ] **Step 1: Viết test** — tạo `dashboard/lib/config-yaml.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { applyYamlEdits, editConfigYaml, renderScalar } from './config-yaml.js';

const CONFIG = [
  '# Cấu hình Hermes — viết tay',
  'model:',
  '  default: hermes   # model chính',
  '  provider: custom',
  '  base_url: http://127.0.0.1:20128/v1',
  'agent:',
  '  reasoning_effort: medium',
  'platform_hints:',
  '  zalo:',
  '    append: |',
  '      Giọng điệu: lễ phép.',
  '      model: không phải khoá',
  'mcp_servers:',
  '  rag:',
  '    url: http://127.0.0.1:9998/mcp',
  '    timeout: 180',
  '  files:',
  '    command: npx',
  '    args:',
  '    - -y',
  '    - "@modelcontextprotocol/server-filesystem"',
  'platforms:',
  '  zalo:',
  '    enabled: true',
  '    extra:',
  '      reply_only_tagged: true',
  '      owner_only_groups:',
  '      - "111"',
  '      - "222"',
  '',
  '      bridge_url: ws://127.0.0.1:3873',
  '',
].join('\n');

test('chữ YAML một dòng: chuỗi thường để trần, chuỗi đặc biệt/từ khoá YAML trong ngoặc, mảng dạng [..]', () => {
  assert.equal(renderScalar('ag/gemini-3.1-pro'), 'ag/gemini-3.1-pro');
  assert.equal(renderScalar('yes'), '"yes"');
  assert.equal(renderScalar('12'), '"12"');
  assert.equal(renderScalar('a b: c'), '"a b: c"');
  assert.equal(renderScalar(false), 'false');
  assert.equal(renderScalar(['111', '333']), '["111", "333"]');
  assert.throws(() => renderScalar({}), /không hợp lệ/);
});

test('sửa đúng khoá, giữ chú thích, khối chữ nhiều dòng và thứ tự; danh sách khối thay bằng một dòng', () => {
  const out = applyYamlEdits(CONFIG, [
    { path: ['model', 'default'], value: 'ag/gemini-3.1-pro' },
    { path: ['platforms', 'zalo', 'extra', 'owner_only_groups'], value: ['111', '333'] },
    { path: ['platforms', 'zalo', 'extra', 'reply_only_tagged'], value: false },
  ]);
  assert.match(out, /^ {2}default: ag\/gemini-3\.1-pro {3}# model chính$/m);
  assert.match(out, /^ {6}owner_only_groups: \["111", "333"\]$/m);
  assert.match(out, /^ {6}bridge_url: ws:\/\/127\.0\.0\.1:3873$/m, 'dòng sau danh sách còn nguyên');
  assert.match(out, /^# Cấu hình Hermes — viết tay$/m);
  assert.match(out, /^ {6}model: không phải khoá$/m, 'chữ trong khối | không bị coi là khoá');
  const y = YAML.parse(out);
  assert.equal(y.platform_hints.zalo.append, 'Giọng điệu: lễ phép.\nmodel: không phải khoá\n');
  assert.deepEqual(y.platforms.zalo.extra.owner_only_groups, ['111', '333']);
});

test('khoá chưa có thì chèn vào cuối khối cha đúng thụt lề; khối cha không có → lỗi, không đổi gì', () => {
  const out = applyYamlEdits(CONFIG, [{ path: ['mcp_servers', 'files', 'enabled'], value: false }, { path: ['platforms', 'zalo', 'extra', 'dm_policy'], value: 'open' }]);
  const y = YAML.parse(out);
  assert.equal(y.mcp_servers.files.enabled, false);
  assert.deepEqual(y.mcp_servers.files.args, ['-y', '@modelcontextprotocol/server-filesystem']);
  assert.equal(y.platforms.zalo.extra.dm_policy, 'open');
  assert.throws(() => applyYamlEdits(CONFIG, [{ path: ['khong_co', 'x'], value: 1 }]), (e) => e.statusCode === 400);
  assert.throws(() => applyYamlEdits('a: [1,\n', [{ path: ['a'], value: 1 }]), /lỗi cú pháp/);
});

test('ghi tệp: .bak, giữ CRLF và BOM; không đổi gì thì không ghi', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'zd-yaml-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const f = join(d, 'config.yaml');
  writeFileSync(f, `﻿${CONFIG.replace(/\n/g, '\r\n')}`);
  assert.equal(editConfigYaml(f, [{ path: ['agent', 'reasoning_effort'], value: 'high' }]), true);
  const text = readFileSync(f, 'utf8');
  assert.ok(text.startsWith('﻿'));
  assert.match(text, /reasoning_effort: high\r\n/);
  assert.ok(existsSync(`${f}.bak`));
  assert.equal(editConfigYaml(f, [{ path: ['agent', 'reasoning_effort'], value: 'high' }]), false);
});

test('config.yaml thật của máy này (nếu có): sửa thử trong bộ nhớ vẫn qua bước kiểm', { skip: !process.env.HERMES_HOME || !existsSync(join(process.env.HERMES_HOME, 'config.yaml')) }, () => {
  const real = readFileSync(join(process.env.HERMES_HOME, 'config.yaml'), 'utf8').replace(/^﻿/, '');
  const out = applyYamlEdits(real, [
    { path: ['model', 'default'], value: 'thu-nghiem' },
    { path: ['platforms', 'zalo', 'extra', 'reply_only_tagged'], value: true },
  ]);
  assert.equal(YAML.parse(out).model.default, 'thu-nghiem');
});
```

- [ ] **Step 2: Chạy test, thấy hỏng**

Run: `HERMES_HOME=E:/Hermes node --test dashboard/lib/config-yaml.test.js`
Expected: FAIL — `Cannot find module './config-yaml.js'`.

- [ ] **Step 3: Viết `dashboard/lib/config-yaml.js`**

```js
/**
 * Sửa config.yaml của Hermes theo từng dòng (spec §18.6): như lệnh /model của plugin (model_command.py), không dump
 * lại cả tệp — giữ nguyên chú thích, thứ tự khoá, khối chữ nhiều dòng anh viết tay. Mỗi lần sửa:
 *   1. tìm đúng khoá theo đường dẫn (vd. ['platforms','zalo','extra','reply_only_tagged']) bằng thụt lề;
 *   2. thay cả vùng giá trị của khoá (một dòng, hoặc khối con/danh sách bên dưới) bằng MỘT dòng mới;
 *      khoá chưa có thì chèn vào cuối khối cha (khối cha phải có sẵn);
 *   3. phân tích lại cả tệp: kết quả phải BẰNG bản cũ với đúng các khoá đã sửa — khác một chút là từ chối, giữ tệp cũ.
 * Ghi: theo symlink, giữ quyền + chủ sở hữu, `.bak`, tệp tạm rồi đổi tên.
 */
import { chmodSync, chownSync, copyFileSync, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import YAML from 'yaml';
import { writeFileAtomic } from './json-store.js';

const err = (message) => Object.assign(new Error(message), { statusCode: 400 });
const PLAIN = /^[A-Za-z0-9._/@:+-]+$/;
const RESERVED = /^(true|false|yes|no|on|off|null|~|[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?|0x[0-9a-f]+|\.inf|\.nan)$/i;

/** Giá trị → chữ YAML một dòng: chuỗi thường để trần, còn lại JSON (hợp lệ trong YAML); mảng thành [..]. */
export function renderScalar(v) {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) return `[${v.map((x) => renderScalar(x)).join(', ')}]`;
  if (typeof v === 'string') return PLAIN.test(v) && !RESERVED.test(v) ? v : JSON.stringify(v);
  throw err('Giá trị không hợp lệ.');
}

const indentOf = (line) => line.length - line.trimStart().length;
const isBlank = (line) => !line.trim() || line.trimStart().startsWith('#');
const keyRe = (key) => new RegExp(`^(\\s*)(${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|"${key}"|'${key}'):(\\s|$)`);

/** Dòng cuối (không gồm) của vùng giá trị bắt đầu ở dòng `i` có thụt lề `ind`. */
function regionEnd(lines, i, ind) {
  let j = i + 1;
  for (; j < lines.length; j += 1) {
    const l = lines[j];
    if (isBlank(l)) continue;
    const n = indentOf(l);
    if (n > ind || (n === ind && l.trimStart().startsWith('- '))) continue;
    break;
  }
  while (j > i + 1 && isBlank(lines[j - 1])) j -= 1;   // không nuốt dòng trống/chú thích cuối khối
  return j;
}

/** Tìm khoá theo đường dẫn: `{ index, indent }` của dòng khoá, hoặc `{ parent }` khi chỉ thiếu khoá cuối. */
function locate(lines, path) {
  let from = 0; let to = lines.length; let parentIndent = -1; let parentIndex = -1;
  for (let depth = 0; depth < path.length; depth += 1) {
    let found = -1; let childIndent = null;
    for (let i = from; i < to; i += 1) {
      if (isBlank(lines[i])) continue;
      const n = indentOf(lines[i]);
      if (n <= parentIndent) break;
      if (childIndent === null) childIndent = n;
      if (n !== childIndent) continue;
      if (keyRe(path[depth]).test(lines[i])) { found = i; break; }
    }
    if (found === -1) {
      if (depth === path.length - 1 && parentIndex >= -1) return { missing: true, parentIndex, parentIndent, childIndent, end: to };
      return null;
    }
    if (depth === path.length - 1) return { index: found, indent: indentOf(lines[found]) };
    parentIndex = found; parentIndent = indentOf(lines[found]);
    from = found + 1; to = regionEnd(lines, found, parentIndent);
  }
  return null;
}

function setIn(obj, path, value) {
  let o = obj;
  for (const k of path.slice(0, -1)) {
    if (!o[k] || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[path.at(-1)] = value;
}

/** Áp `edits` = [{ path: string[], value }] vào chữ YAML; trả chữ mới hoặc ném lỗi 400 (không bao giờ trả chữ sai). */
export function applyYamlEdits(text, edits) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let before;
  try { before = YAML.parse(text) ?? {}; } catch { throw err('config.yaml đang lỗi cú pháp — sửa tay trước rồi thử lại.'); }
  const expected = structuredClone(before);
  for (const { path, value } of edits) {
    const at = locate(lines, path);
    const key = path.at(-1);
    if (!at) throw err(`Không tìm thấy mục ${path.slice(0, -1).join('.')} trong config.yaml — báo người cài đặt.`);
    if (at.missing) {
      if (at.parentIndex < 0 && path.length > 1) throw err(`Không tìm thấy mục ${path.slice(0, -1).join('.')} trong config.yaml.`);
      const ind = at.childIndent ?? (at.parentIndent + 2);
      lines.splice(at.end, 0, `${' '.repeat(Math.max(0, ind))}${key}: ${renderScalar(value)}`);
    } else {
      const end = regionEnd(lines, at.index, at.indent);
      const m = /^(\s*\S[^:]*:)\s*(.*?)(\s+#.*)?$/.exec(lines[at.index]);
      const keepComment = end === at.index + 1 && m?.[3] ? m[3] : '';
      lines.splice(at.index, end - at.index, `${' '.repeat(at.indent)}${lines[at.index].trimStart().split(':')[0]}: ${renderScalar(value)}${keepComment}`);
    }
    setIn(expected, path, value);
  }
  const out = lines.join(eol);
  let after;
  try { after = YAML.parse(out); } catch { throw err('Sửa config.yaml sẽ làm hỏng cú pháp — đã giữ nguyên tệp. Báo người cài đặt.'); }
  if (!isDeepStrictEqual(after, expected)) throw err('Sửa config.yaml không ra đúng giá trị — đã giữ nguyên tệp. Báo người cài đặt.');
  return out;
}

/** Đọc → sửa → ghi nguyên tử config.yaml (có `.bak`). Không đổi gì thì không ghi. Trả true nếu đã ghi. */
export function editConfigYaml(link, edits) {
  let file = link;
  try { file = realpathSync(link); } catch { /* chưa có tệp */ }
  if (!existsSync(file)) throw err('Không có config.yaml của trợ lý — báo người cài đặt.');
  const raw = readFileSync(file, 'utf8');
  const bom = raw.startsWith('﻿') ? '﻿' : '';
  const next = applyYamlEdits(raw.slice(bom.length), edits);
  if (next === raw.slice(bom.length)) return false;
  copyFileSync(file, `${file}.bak`);
  try { chmodSync(`${file}.bak`, 0o600); } catch { /* Windows */ }
  const st = statSync(file);
  writeFileAtomic(file, bom + next, {
    mode: st.mode & 0o777, tmpName: '.config.dashboard.tmp',
    afterWrite: (tmp) => { try { chownSync(tmp, st.uid, st.gid); } catch { /* Windows / không đủ quyền */ } },
  });
  return true;
}

/** Đọc config.yaml đã phân tích (lỗi → {}). */
export function readConfigYaml(file) {
  try { return YAML.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) ?? {}; } catch { return {}; }
}
```

- [ ] **Step 4: Chạy test, thấy xanh**

Run: `HERMES_HOME=E:/Hermes node --test dashboard/lib/config-yaml.test.js`
Expected: PASS 5/5 (test cuối sửa thử `E:/Hermes/config.yaml` trong bộ nhớ, không ghi). Trên VPS sau triển khai: `HERMES_HOME=/root/.hermes node --test dashboard/lib/config-yaml.test.js`.

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/config-yaml.js dashboard/lib/config-yaml.test.js
git commit -m "feat(dashboard): sửa config.yaml theo dòng, kiểm lại toàn tệp trước khi ghi (giai đoạn 7B)"
```

---

### Task 2: Cờ chờ khởi động lại dùng chung + dải vàng

**Files:**
- Create: `dashboard/lib/restart-flags.js`, `dashboard/lib/restart-flags.test.js`, `dashboard/public/views/restart-banner.js`
- Modify: `dashboard/routes/admin.js`, `dashboard/routes/admin.test.js`, `dashboard/lib/paths.js`, `dashboard/server.js`, `dashboard/test-helpers.js`, `dashboard/public/public.test.js`

**Interfaces:**
- Consumes: `restartAssistant`, `restartSidecar`, `owners.pending()` (sẵn có).
- Produces: `createRestartFlags({ file, now? }) → { get() → {assistant, sidecar}, mark(target, reason), clear(target, seenRev) → bool }` (`target` ∈ `assistant|sidecar`; mỗi cờ `{since, rev, reasons[]}`); `GET /api/admin/restart-flags` → `{assistant, sidecar, owners}`; `POST /api/admin/restart-assistant` khởi động lại cả kết nối Zalo khi có cờ `sidecar`, xoá cờ theo `rev`, Nhật ký kèm lý do; deps `restartFlags`; `paths.restartFlagsFile`. View: `RestartBanner({ version })`, `restartText(flags)`.

- [ ] **Step 1: Viết test** — tạo `dashboard/lib/restart-flags.test.js`:

```js
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
```

thêm vào **cuối** `dashboard/routes/admin.test.js`:

```js
test('cờ chờ khởi động lại (giai đoạn 7B): Chủ bot 403; khởi động lại trợ lý xoá cờ, cờ kết nối Zalo thì khởi động lại cả kết nối Zalo', async (t) => {
  const order = [];
  const deps = makeDeps(t, { restartAssistant: async () => { order.push('assistant'); }, restartSidecar: async () => { order.push('sidecar'); } });
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/restart-flags', { cookie: owner })).status, 403);
  const admin = await loginAs(t, deps, call);
  deps.restartFlags.mark('assistant', 'Đổi model');
  deps.restartFlags.mark('sidecar', 'Cấu hình: kết bạn');
  const before = await call('/api/admin/restart-flags', { cookie: admin });
  assert.deepEqual(before.json.assistant.reasons, ['Đổi model']);
  assert.equal((await call('/api/admin/restart-assistant', { method: 'POST', cookie: admin })).status, 200);
  assert.deepEqual(order, ['sidecar', 'assistant']);
  const after = await call('/api/admin/restart-flags', { cookie: admin });
  assert.equal(after.json.assistant, null);
  assert.equal(after.json.sidecar, null);
  assert.match(deps.activity.list().find((e) => e.action === 'restart_assistant').detail, /Đổi model, Cấu hình: kết bạn/);
});
```

thêm vào **cuối** `dashboard/public/public.test.js`:

```js

// --- Giai đoạn 7B (spec §18.6): trang Hệ thống của Quản trị ---
```

```js
test('dải chờ khởi động lại: gộp lý do; có cờ kết nối Zalo thì nói cả hai; không có gì thì rỗng', async () => {
  const { restartText } = await import('./views/restart-banner.js');
  assert.equal(restartText({ assistant: null, sidecar: null }), '');
  assert.equal(restartText({ assistant: { reasons: ['Đổi model'] }, sidecar: null }), 'Đã đổi: Đổi model. Cần khởi động lại trợ lý để áp dụng (bot im khoảng 1–3 phút).');
  assert.match(restartText({ assistant: null, sidecar: { reasons: ['Cấu hình: kết bạn'] } }), /trợ lý và kết nối Zalo/);
});
```

- [ ] **Step 2: Chạy test, thấy hỏng**

Run: `node --test dashboard/lib/restart-flags.test.js dashboard/routes/admin.test.js dashboard/public/public.test.js`
Expected: FAIL — module chưa có; `/api/admin/restart-flags` 404.

- [ ] **Step 3: Viết `dashboard/lib/restart-flags.js`**

```js
/**
 * Cờ "đã đổi cài đặt, chờ khởi động lại" dùng chung cho Agent, Kết nối MCP, Cấu hình (spec §18.6).
 * `<dashboard>/restart-flags.json`: { assistant: { since, rev, reasons: [..] } | null, sidecar: { … } | null }.
 * Dải vàng trên các trang Quản trị đọc cờ này; nút "Khởi động lại" (routes/admin.js) xoá cờ sau khi khởi động lại xong
 * — chỉ khi không có thay đổi mới chen vào trong lúc khởi động lại (`rev` không đổi).
 * Cờ chủ nhân bot cũ (pending-restart.json, owners.js) vẫn giữ nguyên — không trộn hai cơ chế.
 */
import { readJson, writeJsonAtomic } from './json-store.js';

export const TARGETS = ['assistant', 'sidecar'];
const MAX_REASONS = 10;

export function createRestartFlags({ file, now = Date.now }) {
  const read = () => {
    const raw = readJson(file, {});
    return Object.fromEntries(TARGETS.map((t) => {
      const f = raw?.[t];
      return [t, f && Number.isFinite(f.since) && Array.isArray(f.reasons)
        ? { since: f.since, rev: Number.isInteger(f.rev) ? f.rev : 1, reasons: f.reasons.map(String).slice(0, MAX_REASONS) } : null];
    }));
  };
  return {
    get: read,
    /** Đánh dấu cần khởi động lại `target` vì `reason` (vd. "Đổi model"); lý do trùng không ghi lại. */
    mark(target, reason) {
      if (!TARGETS.includes(target)) throw new Error(`restart-flags: đích lạ ${target}`);
      const all = read();
      const cur = all[target] || { since: now(), rev: 0, reasons: [] };
      if (!cur.reasons.includes(reason)) cur.reasons = [...cur.reasons, String(reason)].slice(-MAX_REASONS);
      cur.rev += 1;
      all[target] = cur;
      writeJsonAtomic(file, all);
    },
    /** Xoá cờ nếu `rev` còn bằng `seenRev` (giá trị đọc lúc bắt đầu khởi động lại). Trả true nếu đã xoá. */
    clear(target, seenRev) {
      const all = read();
      if (!all[target] || all[target].rev !== seenRev) return false;
      all[target] = null;
      writeJsonAtomic(file, all);
      return true;
    },
  };
}
```

- [ ] **Step 4: Route** — `dashboard/routes/admin.js`: chữ ký thêm `restartFlags = null`. Ngay trước `r.post('/admin/restart-assistant', …` thêm:

```js
  // Cờ chờ khởi động lại của Agent / Kết nối MCP / Cấu hình (spec §18.6) — dải vàng trên trang Quản trị.
  r.get('/admin/restart-flags', ...guard, (req, res) => {
    try { res.json({ ok: true, ...(restartFlags ? restartFlags.get() : { assistant: null, sidecar: null }), owners: Boolean(owners?.pending()) }); } catch (err) { fail(res, err, 'Chưa đọc được trạng thái — tải lại trang.'); }
  });
```

Trong handler `restart-assistant`: sau `const pendingAtStart = owners?.pending();` thêm `const flags = restartFlags ? restartFlags.get() : { assistant: null, sidecar: null };`; điều kiện khởi động lại kết nối Zalo thành `if (pendingAtStart || flags.sidecar) {`; sau dòng `owners.clearPending()` thêm:

```js
      if (flags.sidecar && !sidecarFailed) restartFlags.clear('sidecar', flags.sidecar.rev);
      if (flags.assistant) restartFlags.clear('assistant', flags.assistant.rev);
```

và thay dòng `activity.append({ … action: 'restart_assistant' … })` bằng:

```js
      const reasons = [...(flags.assistant?.reasons || []), ...(flags.sidecar?.reasons || [])];
      activity.append({ actor: req.user.username, action: 'restart_assistant', detail: [sidecarFailed ? 'kết nối Zalo chưa khởi động lại được' : applied ? 'áp dụng danh sách chủ nhân mới' : '', reasons.join(', ')].filter(Boolean).join(' · ') });
```

`dashboard/lib/paths.js` sau `pendingRestartFile`: `restartFlagsFile: join(dataDir, 'restart-flags.json'),`.
`dashboard/server.js`: import `createRestartFlags`; trong `buildDeps` sau `restartSidecar,`: `restartFlags: createRestartFlags({ file: paths.restartFlagsFile }),`.
`dashboard/test-helpers.js`: import + sau `restartSidecar: async () => {},`: `restartFlags: createRestartFlags({ file: join(dir, 'restart-flags.json') }),`.

- [ ] **Step 5: Dải vàng** — tạo `dashboard/public/views/restart-banner.js`:

```js
// Dải vàng "đã đổi cài đặt, cần khởi động lại" dùng chung cho Agent, Kết nối MCP, Cấu hình (spec §18.6, chỉ Quản trị).
// `version` đổi (trang vừa lưu) → đọc lại cờ.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live } from '../ui.js';

/** Câu cho dải vàng từ cờ máy chủ; không có gì chờ → ''. */
export function restartText(flags) {
  const reasons = [...(flags?.assistant?.reasons || []), ...(flags?.sidecar?.reasons || [])];
  if (!reasons.length) return '';
  const who = flags.sidecar ? 'trợ lý và kết nối Zalo' : 'trợ lý';
  return `Đã đổi: ${reasons.join(', ')}. Cần khởi động lại ${who} để áp dụng (bot im khoảng 1–3 phút).`;
}

export function RestartBanner({ version = 0 }) {
  const [flags, setFlags] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const load = () => api('/api/admin/restart-flags').then(setFlags).catch(() => {});
  useEffect(() => { load(); }, [version]);
  const text = restartText(flags);
  async function restart() {
    if (!confirm('Khởi động lại bây giờ? Bot sẽ không trả lời trong 1–3 phút.')) return;
    setBusy(true); setMsg({});
    try {
      const r = await api('/api/admin/restart-assistant', { method: 'POST' });
      setMsg(r.warning ? { error: r.warning } : { ok: 'Đã khởi động lại — thay đổi đã được áp dụng.' });
      await load();
    } catch (e) { setMsg({ error: e.message }); } finally { setBusy(false); }
  }
  if (!text && !msg.ok && !msg.error) return null;
  return html`<div class="notice notice-warn restart-banner">
    <${Icon} name="warn" />
    <div>${text ? html`<p>${text}</p>
      <button type="button" class="btn btn-primary btn-sm" disabled=${busy} onClick=${restart}>${busy ? 'Đang khởi động lại…' : 'Khởi động lại ngay'}</button>` : null}
      <${Live} error=${msg.error} ok=${msg.ok} /></div>
  </div>`;
}
```

- [ ] **Step 6: Chạy test, thấy xanh**

Run: `node --test dashboard/lib/restart-flags.test.js dashboard/routes/admin.test.js dashboard/routes/owners.test.js dashboard/lib/paths.test.js dashboard/public/public.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib/restart-flags.js dashboard/lib/restart-flags.test.js dashboard/routes/admin.js dashboard/routes/admin.test.js dashboard/lib/paths.js dashboard/server.js dashboard/test-helpers.js dashboard/public/views/restart-banner.js dashboard/public/public.test.js
git commit -m "feat(dashboard): cờ chờ khởi động lại dùng chung + dải vàng, khởi động lại kèm lý do (giai đoạn 7B)"
```

---

### Task 3: Agent — model, mức suy nghĩ, tính cách (SOUL.md)

**Files:**
- Create: `dashboard/lib/agent-config.js`, `dashboard/lib/agent-config.test.js`, `dashboard/routes/agent.js`, `dashboard/routes/agent.test.js`, `dashboard/public/views/agent.js`
- Modify: `dashboard/lib/env-file.js`, `dashboard/lib/paths.js`, `dashboard/app.js`, `dashboard/server.js`, `dashboard/public/public.test.js`

**Interfaces:**
- Consumes: `editConfigYaml`, `readConfigYaml` (Task 1), `restartFlags.mark` (Task 2), `writeFileAtomic({mode, tmpName})`.
- Produces: `REASONING`, `MODEL_NAME`, `MAX_SOUL`, `createAgentConfig({ configFile, envValue?, fetchImpl? }) → { view() → {model, provider, endpoint, choices, defaultModel, reasoning, zaloHint}, models() → string[], setModel(name) → bool, setReasoning(v) → bool }`, `createSoul({ hermesHome, historyDir, now? }) → { view() → {text, exists, max, history:[{id, original, at, by, size}]}, save(text, by) → bool, snapshot(id) → string, restore(id, by) → bool }`; API admin `GET /api/admin/agent`, `GET /api/admin/agent/models`, `PUT /api/admin/agent/{model,reasoning,soul}`, `GET /api/admin/agent/soul/history/:id`, `POST /api/admin/agent/soul/restore/:id`; activity `agent_model|agent_reasoning|agent_soul|agent_soul_restore`; `paths.soulHistoryDir`; deps `agentConfig`, `soul`. View: `Agent`, `modelOptions`, `REASONING_LABELS`.

- [ ] **Step 1: Viết test** — tạo `dashboard/lib/agent-config.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { createAgentConfig, createSoul } from './agent-config.js';

const CONFIG = 'model:\n  default: hermes\n  provider: custom\n  base_url: http://127.0.0.1:20128/v1\n  api_key: sk-bi-mat\nagent:\n  reasoning_effort: medium\nplatform_hints:\n  zalo:\n    append: Lễ phép.\nplatforms:\n  zalo:\n    extra:\n      model_choices: [hermes, ag/gemini-3.1-pro]\n';

function home(t) {
  const h = mkdtempSync(join(tmpdir(), 'zd-agent-'));
  t.after(() => rmSync(h, { recursive: true, force: true }));
  writeFileSync(join(h, 'config.yaml'), CONFIG);
  return h;
}
const fakeFetch = (ids, calls = []) => async (url, opts) => { calls.push([url, opts.headers]); return { ok: true, json: async () => ({ data: ids.map((id) => ({ id })) }) }; };

test('xem: model, cổng AI chỉ tên máy, danh sách chọn nhanh, mức suy nghĩ, lời dặn Zalo — không bao giờ có khoá', (t) => {
  const h = home(t);
  const v = createAgentConfig({ configFile: join(h, 'config.yaml') }).view();
  assert.deepEqual({ ...v, zaloHint: undefined }, { model: 'hermes', provider: 'custom', endpoint: '127.0.0.1:20128', choices: ['hermes', 'ag/gemini-3.1-pro'], defaultModel: '', reasoning: 'medium', zaloHint: undefined });
  assert.equal(v.zaloHint, 'Lễ phép.');
  assert.doesNotMatch(JSON.stringify(v), /sk-bi-mat/);
});

test('đổi model: chỉ tên có trên cổng AI, khoá gửi kèm ở máy chủ; sửa đúng model.default', async (t) => {
  const h = home(t);
  const calls = [];
  const a = createAgentConfig({ configFile: join(h, 'config.yaml'), fetchImpl: fakeFetch(['hermes', 'ag/gemini-3.1-pro'], calls) });
  assert.equal(await a.setModel('ag/gemini-3.1-pro'), true);
  assert.equal(calls[0][0], 'http://127.0.0.1:20128/v1/models');
  assert.equal(calls[0][1].Authorization, 'Bearer sk-bi-mat');
  const y = YAML.parse(readFileSync(join(h, 'config.yaml'), 'utf8'));
  assert.equal(y.model.default, 'ag/gemini-3.1-pro');
  assert.equal(y.model.api_key, 'sk-bi-mat');
  await assert.rejects(a.setModel('khong-co'), (e) => e.statusCode === 400);
  await assert.rejects(a.setModel('a b'), (e) => e.statusCode === 400);
  await assert.rejects(createAgentConfig({ configFile: join(h, 'config.yaml'), fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }).models(), (e) => e.statusCode === 502);
});

test('mức suy nghĩ: chỉ giá trị Hermes nhận', (t) => {
  const h = home(t);
  const a = createAgentConfig({ configFile: join(h, 'config.yaml') });
  a.setReasoning('high');
  assert.equal(YAML.parse(readFileSync(join(h, 'config.yaml'), 'utf8')).agent.reasoning_effort, 'high');
  assert.throws(() => a.setReasoning('max-max'), (e) => e.statusCode === 400);
});

test('SOUL.md: lưu cất bản cũ + bản gốc; khôi phục; giới hạn; không đổi thì không ghi', (t) => {
  const h = home(t);
  writeFileSync(join(h, 'SOUL.md'), 'Tôi là Uyển Nhi.');
  let clock = 1_790_000_000_000;
  const soul = createSoul({ hermesHome: h, historyDir: join(h, 'soul-history'), now: () => (clock += 1000) });
  assert.equal(soul.save('Tôi là Uyển Nhi, lễ phép.', 'anh'), true);
  assert.equal(soul.save('Tôi là Uyển Nhi, lễ phép.', 'anh'), false);
  soul.save('Bản thứ ba', 'Anh.Hai');
  const v = soul.view();
  assert.equal(v.text, 'Bản thứ ba');
  assert.deepEqual(v.history.map((x) => [x.original, x.by]), [[false, 'anhhai'], [false, 'anh'], [true, '']]);
  assert.equal(soul.snapshot('original'), 'Tôi là Uyển Nhi.');
  soul.restore('original', 'anh');
  assert.equal(readFileSync(join(h, 'SOUL.md'), 'utf8'), 'Tôi là Uyển Nhi.');
  assert.throws(() => soul.save('   ', 'anh'), (e) => e.statusCode === 400);
  assert.throws(() => soul.save('x'.repeat(20_001), 'anh'), (e) => e.statusCode === 400);
  assert.throws(() => soul.snapshot('../config'), (e) => e.statusCode === 404);
});
```

tạo `dashboard/routes/agent.test.js`:

```js
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
  assert.deepEqual(deps.activity.list().map((e) => e.action).filter((a) => a.startsWith('agent_')),
    ['agent_soul_restore', 'agent_reasoning', 'agent_soul', 'agent_model']);
});
```

thêm vào **cuối** `dashboard/public/public.test.js`:

```js
test('Agent: danh sách model — đang dùng đầu, chọn nhanh, phần còn lại lọc theo chữ, không trùng', async () => {
  const { modelOptions, REASONING_LABELS } = await import('./views/agent.js');
  assert.deepEqual(modelOptions({ current: 'hermes', choices: ['hermes', 'b'], all: ['a', 'b', 'gemini-x'], q: 'gem' }), ['hermes', 'b', 'gemini-x']);
  assert.deepEqual(modelOptions({ current: '', choices: [], all: ['a'], q: '' }), ['a']);
  assert.equal(REASONING_LABELS.medium, 'Vừa (mặc định)');
});
```

- [ ] **Step 2: Chạy test, thấy hỏng**

Run: `node --test dashboard/lib/agent-config.test.js dashboard/routes/agent.test.js dashboard/public/public.test.js`
Expected: FAIL — module chưa có.

- [ ] **Step 3: Viết `dashboard/lib/agent-config.js`**

```js
/**
 * Agent (spec §18.6, chỉ Quản trị): model, mức suy nghĩ và tính cách (SOUL.md) của trợ lý Hermes.
 * - Model: như lệnh /model của chủ nhân (hermes-plugin/zalo/model_command.py) — chỉ nhận tên có trong
 *   `<model.base_url>/models`, sửa đúng dòng `model.default` của config.yaml. Gateway đọc lại config theo mtime ở
 *   mỗi tin nên có hiệu lực ngay, không cần khởi động lại. Khoá `model.api_key` chỉ dùng ở máy chủ để hỏi danh sách.
 * - Mức suy nghĩ: `agent.reasoning_effort` — đánh dấu cần khởi động lại trợ lý (không chắc gateway đọc lại nóng).
 * - SOUL.md: `<HERMES_HOME>/SOUL.md`; mỗi lần lưu cất bản cũ vào `<dashboard>/soul-history/` (giữ 30 bản), bản đầu
 *   tiên trước khi dashboard sửa lần nào được giữ riêng là "bản gốc". Hermes đọc SOUL.md khi dựng lời nhắc hệ thống
 *   cho phiên → đánh dấu cần khởi động lại trợ lý.
 * Không có "nhiệt độ" (temperature): Hermes không có cài đặt này cho trợ lý chính.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { editConfigYaml, readConfigYaml } from './config-yaml.js';
import { writeFileAtomic } from './json-store.js';

export const REASONING = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export const MODEL_NAME = /^[A-Za-z0-9._/@:+-]{1,120}$/;
export const MAX_SOUL = 20_000;
const KEEP_HISTORY = 30;
const SNAPSHOT_ID = /^(\d{13}-[a-z0-9_-]{1,32}|original)$/;

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const splitList = (v) => (Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[,\n]/)).map((s) => s.trim()).filter(Boolean);

export function createAgentConfig({ configFile, envValue = () => null, fetchImpl = fetch }) {
  const conf = () => readConfigYaml(configFile);
  return {
    view() {
      const c = conf();
      const extra = c?.platforms?.zalo?.extra || {};
      let endpoint = '';
      try { endpoint = new URL(String(c?.model?.base_url || '')).host; } catch { /* không có */ }
      return {
        model: String(c?.model?.default || ''), provider: String(c?.model?.provider || ''), endpoint,
        choices: splitList(extra.model_choices ?? envValue('ZALO_MODEL_CHOICES')),
        defaultModel: String(extra.model_default ?? envValue('ZALO_MODEL_DEFAULT') ?? '').trim(),
        reasoning: String(c?.agent?.reasoning_effort || 'medium'),
        zaloHint: String(c?.platform_hints?.zalo?.append || '').slice(0, 4000),
      };
    },
    /** Danh sách model của cổng AI đang cấu hình (chuẩn OpenAI `/models`). */
    async models() {
      const m = conf()?.model || {};
      const base = String(m.base_url || '').replace(/\/+$/, '');
      if (!/^https?:\/\//.test(base)) throw err(409, 'config.yaml chưa có model.base_url — báo người cài đặt.');
      let json;
      try {
        const res = await fetchImpl(`${base}/models`, { headers: m.api_key ? { Authorization: `Bearer ${m.api_key}` } : {}, signal: AbortSignal.timeout(10_000), redirect: 'error' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        json = await res.json();
      } catch { throw err(502, 'Cổng AI chưa trả danh sách model — thử lại sau ít phút.'); }
      return (Array.isArray(json?.data) ? json.data : []).map((x) => String(x?.id || '')).filter((id) => MODEL_NAME.test(id)).slice(0, 500);
    },
    async setModel(name) {
      const model = String(name ?? '').trim();
      if (!MODEL_NAME.test(model)) throw err(400, 'Tên model không hợp lệ — chọn trong danh sách.');
      const list = await this.models();
      if (!list.includes(model)) throw err(400, `Cổng AI không có model ${model} — chọn trong danh sách.`);
      return editConfigYaml(configFile, [{ path: ['model', 'default'], value: model }]);
    },
    setReasoning(value) {
      if (!REASONING.includes(value)) throw err(400, 'Mức suy nghĩ không hợp lệ — chọn lại.');
      return editConfigYaml(configFile, [{ path: ['agent', 'reasoning_effort'], value }]);
    },
  };
}

export function createSoul({ hermesHome, historyDir, now = Date.now }) {
  const file = join(hermesHome, 'SOUL.md');
  const snap = (id) => join(historyDir, `${id}.md`);
  const read = () => (existsSync(file) ? readFileSync(file, 'utf8').replace(/^﻿/, '') : '');
  function history() {
    let names = [];
    try { names = readdirSync(historyDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).filter((id) => SNAPSHOT_ID.test(id)); } catch { /* chưa có */ }
    return names.map((id) => ({
      id, original: id === 'original', at: id === 'original' ? statSync(snap(id)).mtimeMs : Number(id.slice(0, 13)),
      by: id === 'original' ? '' : id.slice(14), size: statSync(snap(id)).size,
    })).sort((a, b) => (a.original ? 1 : b.original ? -1 : b.at - a.at));
  }
  function write(text, by) {
    const t = String(text ?? '').replace(/\r\n/g, '\n');
    if (!t.trim()) throw err(400, 'Tính cách đang trống — viết ít nhất vài dòng, hoặc khôi phục một bản cũ.');
    if (t.length > MAX_SOUL) throw err(400, `Tối đa ${MAX_SOUL} ký tự — rút gọn rồi lưu.`);
    const cur = read();
    if (t === cur) return false;
    mkdirSync(historyDir, { recursive: true, mode: 0o700 });
    if (existsSync(file) && !existsSync(snap('original'))) writeFileAtomic(snap('original'), cur);
    if (existsSync(file)) writeFileAtomic(snap(`${now()}-${String(by).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'x'}`), cur);
    const mode = existsSync(file) ? statSync(file).mode & 0o777 : 0o644;
    writeFileAtomic(file, t, { mode, tmpName: 'SOUL.md.dashboard-tmp' });
    try { chmodSync(file, mode); } catch { /* Windows */ }
    for (const h of history().filter((x) => !x.original).slice(KEEP_HISTORY)) rmSync(snap(h.id), { force: true });
    return true;
  }
  return {
    view: () => ({ text: read(), exists: existsSync(file), max: MAX_SOUL, history: history() }),
    save: write,
    snapshot(id) {
      if (!SNAPSHOT_ID.test(String(id)) || !existsSync(snap(id))) throw err(404, 'Không có bản này — tải lại trang.');
      return readFileSync(snap(id), 'utf8');
    },
    restore(id, by) { return write(this.snapshot(id), by); },
  };
}
```

`dashboard/lib/env-file.js`: thêm vào cuối `READ_ONLY_KEYS`:

```js
  // Giai đoạn 7B: danh sách model chọn nhanh của lệnh /model, công cụ MCP mở cho thành viên.
  'ZALO_MODEL_CHOICES', 'ZALO_MODEL_DEFAULT', 'ZALO_PUBLIC_MCP',
```

- [ ] **Step 4: Viết `dashboard/routes/agent.js`** và nối

```js
// Agent (spec §18.6) — chỉ Quản trị: model (hiệu lực ngay), mức suy nghĩ + tính cách (cần khởi động lại trợ lý).
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';
import { REASONING } from '../lib/agent-config.js';

export function agentRoutes({ agentConfig, soul, restartFlags, activity }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const fail = (res, err, fallback) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status !== 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: fallback });
  };
  const log = (req, action, detail) => { try { activity.append({ actor: req.user.username, action, detail }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); } };
  const view = () => ({ ok: true, ...agentConfig.view(), reasoningChoices: REASONING, soul: soul.view() });

  r.get('/admin/agent', ...guard, (req, res) => { try { res.json(view()); } catch (err) { fail(res, err, 'Chưa đọc được cài đặt trợ lý.'); } });
  r.get('/admin/agent/models', ...guard, async (req, res) => { try { res.json({ ok: true, models: await agentConfig.models() }); } catch (err) { fail(res, err, 'Chưa lấy được danh sách model.'); } });

  r.put('/admin/agent/model', ...guard, async (req, res) => {
    try {
      const before = agentConfig.view().model;
      if (await agentConfig.setModel(req.body?.model)) log(req, 'agent_model', `${before} → ${req.body.model}`);
      res.json(view());
    } catch (err) { fail(res, err, 'Chưa đổi được model — thử lại.'); }
  });
  r.put('/admin/agent/reasoning', ...guard, (req, res) => {
    try {
      if (agentConfig.setReasoning(req.body?.value)) { restartFlags.mark('assistant', 'Mức suy nghĩ'); log(req, 'agent_reasoning', req.body.value); }
      res.json(view());
    } catch (err) { fail(res, err, 'Chưa lưu được — thử lại.'); }
  });
  r.put('/admin/agent/soul', ...guard, (req, res) => {
    try {
      if (soul.save(req.body?.text, req.user.username)) { restartFlags.mark('assistant', 'Tính cách (SOUL.md)'); log(req, 'agent_soul', `${String(req.body.text).length} ký tự`); }
      res.json(view());
    } catch (err) { fail(res, err, 'Chưa lưu được tính cách — thử lại.'); }
  });
  r.get('/admin/agent/soul/history/:id', ...guard, (req, res) => { try { res.json({ ok: true, text: soul.snapshot(req.params.id) }); } catch (err) { fail(res, err, 'Chưa đọc được bản cũ.'); } });
  r.post('/admin/agent/soul/restore/:id', ...guard, (req, res) => {
    try {
      if (soul.restore(req.params.id, req.user.username)) { restartFlags.mark('assistant', 'Tính cách (SOUL.md)'); log(req, 'agent_soul_restore', req.params.id === 'original' ? 'bản gốc' : req.params.id); }
      res.json(view());
    } catch (err) { fail(res, err, 'Chưa khôi phục được — thử lại.'); }
  });
  return r;
}
```

`dashboard/app.js`: import + `if (deps.agentConfig && deps.soul) app.use('/api', agentRoutes(deps));`.
`dashboard/lib/paths.js` sau `restartFlagsFile`: `soulHistoryDir: join(dataDir, 'soul-history'),`.
`dashboard/server.js`: `import { createAgentConfig, createSoul } from './lib/agent-config.js';` + trong `buildDeps`:

```js
    agentConfig: createAgentConfig({ configFile: paths.hermesConfigFile, envValue: (k) => readEnvKey(paths.hermesEnvFile, k) }),
    soul: createSoul({ hermesHome: paths.hermesHome, historyDir: paths.soulHistoryDir }),
```

- [ ] **Step 5: Trang Agent** — tạo `dashboard/public/views/agent.js`:

```js
// Agent (spec §18.6, chỉ Quản trị): model, mức suy nghĩ, tính cách (SOUL.md) có lịch sử và khôi phục.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, fmtTime, Live, PageHead, SaveBar, Spinner } from '../ui.js';
import { RestartBanner } from './restart-banner.js';

export const REASONING_LABELS = { none: 'Không suy nghĩ', minimal: 'Rất ít', low: 'Ít', medium: 'Vừa (mặc định)', high: 'Nhiều', xhigh: 'Rất nhiều', max: 'Tối đa', ultra: 'Cực đại' };

/** Danh sách model hiển thị: chọn nhanh trước, rồi phần còn lại của cổng AI (lọc theo chữ), luôn có model đang dùng. */
export function modelOptions({ current, choices, all, q }) {
  const n = q.trim().toLowerCase();
  const rest = all.filter((m) => !choices.includes(m) && (!n || m.toLowerCase().includes(n)));
  const out = [...new Set([current, ...choices, ...rest])].filter(Boolean);
  return out.slice(0, 200);
}

export function Agent() {
  const [data, setData] = useState(null);
  const [models, setModels] = useState([]);
  const [q, setQ] = useState('');
  const [soul, setSoul] = useState('');
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState('');
  const [version, setVersion] = useState(0);
  const [preview, setPreview] = useState(null);
  const take = (r) => { setData(r); setSoul(r.soul.text); setVersion((v) => v + 1); };
  useEffect(() => {
    api('/api/admin/agent').then(take).catch((e) => setMsg({ error: e.message }));
    api('/api/admin/agent/models').then((r) => setModels(r.models)).catch(() => {});
  }, []);
  async function run(key, path, body, ok) {
    setBusy(key); setMsg({});
    try { take(await api(path, { method: key === 'restore' ? 'POST' : 'PUT', body })); setMsg({ ok }); } catch (e) { setMsg({ error: e.message }); } finally { setBusy(''); }
  }
  const head = html`<${PageHead} title="Agent" sub="Bộ não của bot: model AI, mức suy nghĩ và tính cách. Chỉ Quản trị." />`;
  if (!data) return html`${head}<${Live} error=${msg.error} />${msg.error ? null : html`<${Spinner} />`}`;
  const dirty = soul !== data.soul.text;
  return html`${head}<${RestartBanner} version=${version} />
    <${Live} error=${msg.error} ok=${msg.ok} />
    <section class="card">
      <h2>Model</h2>
      <p class="muted small">Cổng AI: <span class="mono">${data.endpoint || 'chưa đặt'}</span>. Đổi model có hiệu lực từ tin nhắn tiếp theo ở mọi nhóm (giống lệnh /model trong Zalo).</p>
      <div class="toolbar">
        <label class="sr-only" for="ag-q">Lọc model</label>
        <input id="ag-q" type="search" placeholder="Lọc model, vd. gemini" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
        <label class="sr-only" for="ag-model">Model</label>
        <select id="ag-model" value=${data.model} disabled=${busy !== ''} onChange=${(e) => run('model', '/api/admin/agent/model', { model: e.currentTarget.value }, 'Đã đổi model.')}>
          ${modelOptions({ current: data.model, choices: data.choices, all: models, q }).map((m) => html`<option key=${m} value=${m}>${m}${m === data.defaultModel ? ' (mặc định)' : ''}</option>`)}
        </select>
      </div>
      <div class="field"><label for="ag-reason">Mức suy nghĩ</label>
        <select id="ag-reason" value=${data.reasoning} disabled=${busy !== ''} onChange=${(e) => run('reason', '/api/admin/agent/reasoning', { value: e.currentTarget.value }, 'Đã lưu — khởi động lại trợ lý để áp dụng.')}>
          ${data.reasoningChoices.map((v) => html`<option key=${v} value=${v}>${REASONING_LABELS[v] || v}</option>`)}</select>
        <small class="muted">Suy nghĩ nhiều thì trả lời kỹ hơn nhưng chậm hơn và tốn lượt AI hơn. Không phải model nào cũng hỗ trợ.</small></div>
    </section>
    <form class="card" onSubmit=${(e) => { e.preventDefault(); run('soul', '/api/admin/agent/soul', { text: soul }, 'Đã lưu tính cách — khởi động lại trợ lý để áp dụng.'); }}>
      <h2>Tính cách (SOUL.md)</h2>
      <p class="muted small">Đoạn đầu tiên của lời nhắc hệ thống: bot là ai, xưng hô thế nào, giọng điệu ra sao. ${soul.length}/${data.soul.max} ký tự.</p>
      <label class="sr-only" for="ag-soul">Tính cách</label>
      <textarea id="ag-soul" class="mono soul-edit" rows="14" maxlength=${data.soul.max} value=${soul} onInput=${(e) => setSoul(e.currentTarget.value)}></textarea>
      ${data.zaloHint ? html`<details class="more-hint"><summary>Lời dặn riêng cho Zalo (config.yaml — chỉ xem)</summary><pre class="sb-text">${data.zaloHint}</pre></details>` : null}
      <${SaveBar} count=${dirty ? 1 : 0} busy=${busy === 'soul'} canSave=${dirty && soul.trim() !== ''} onUndo=${() => setSoul(data.soul.text)} idle="Chưa sửa gì." />
    </form>
    <section class="card">
      <h2>Lịch sử tính cách</h2>
      ${data.soul.history.length ? null : html`<p class="muted">Chưa sửa lần nào trên dashboard.</p>`}
      <ul class="row-list">${data.soul.history.map((h) => html`<li key=${h.id} class="row-item">
        <span class="row-main"><strong>${h.original ? 'Bản gốc (trước lần sửa đầu tiên)' : fmtTime(h.at)}</strong><small class="muted">${h.by ? `trước khi ${h.by} sửa · ` : ''}${h.size} byte</small></span>
        <button type="button" class="btn btn-secondary btn-sm" onClick=${() => api(`/api/admin/agent/soul/history/${h.id}`).then((r) => setPreview({ id: h.id, text: r.text })).catch((e) => setMsg({ error: e.message }))}>Xem</button>
        <button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => confirm('Khôi phục bản này? Bản hiện tại vẫn được cất vào lịch sử.') && run('restore', `/api/admin/agent/soul/restore/${h.id}`, undefined, 'Đã khôi phục — khởi động lại trợ lý để áp dụng.')}>Khôi phục</button>
      </li>`)}</ul>
      ${preview ? html`<pre class="sb-text">${preview.text}</pre>` : null}
    </section>`;
}
```

(Route `#/agent` và mục thanh bên thêm ở Task 9.)

- [ ] **Step 6: Chạy test, thấy xanh**

Run: `node --test dashboard/lib/agent-config.test.js dashboard/routes/agent.test.js dashboard/lib/env-file.test.js dashboard/public/public.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib/agent-config.js dashboard/lib/agent-config.test.js dashboard/routes/agent.js dashboard/routes/agent.test.js dashboard/public/views/agent.js dashboard/lib/env-file.js dashboard/lib/paths.js dashboard/app.js dashboard/server.js dashboard/public/public.test.js
git commit -m "feat(dashboard): trang Agent — đổi model, mức suy nghĩ, tính cách SOUL.md có lịch sử (giai đoạn 7B)"
```

---

### Task 4: Plugin — danh sách công cụ cho dashboard + tắt riêng từng công cụ

**Files:**
- Modify: `hermes-plugin/zalo_tools/group_permissions.py`, `hermes-plugin/zalo_tools/tools.py`, `test_zalo_permissions.py`

**Interfaces:**
- Consumes: `TOOLS`, `FRIEND_TOOL_NAMES`, `DM_ONLY_TOOLS`, `DANGEROUS_TOOL_NAMES`, `feature_of`, `STUDIO_TOOLS`, `ALWAYS_ON`, `permissions_path()`.
- Produces:
  - `group_permissions._tools_off(raw) → frozenset`, `tool_off(name) → bool`; `_parse` thêm khoá `tools_off`.
  - `tools._tool_off_block(name, args) → dict|None` (chạy trước `_feature_block` trong `guard_member_tool_call`).
  - `tools.tools_manifest(*, friend_tools) → {v, generatedAt, tools:[{name, toolset, description, feature, registered, dmOnly, confirm}]}`, `write_tools_manifest(*, friend_tools, path=None)` → `<HERMES_HOME>/zalo/tools-manifest.json` (gọi cuối `register_tools`).

- [ ] **Step 1: Viết test** — trong `test_zalo_permissions.py`, thêm lớp sau **ngay trước** dòng `if __name__ == "__main__":`:

```python
class ToolsOffTest(PermissionsFile, unittest.TestCase):
    """Giai đoạn 7B (spec §18.6): trang Công cụ tắt riêng từng công cụ với người không phải chủ nhân."""

    def setUp(self):
        super().setUp()
        self.addCleanup(zalo_tools.bind_turn, None)

    def turn(self, *, owner=False, group=True):
        zalo_tools.bind_turn({"sender_uid": OWNER if owner else MEMBER, "thread_id": GROUP_A if group else MEMBER,
                              "is_group": group, "is_owner": owner, "text": ""})

    def test_tool_off_blocks_members_in_groups_and_dm_but_never_owner(self):
        self.write({"version": 1, "defaults": {}, "groups": {}, "tools": {"off": ["zalo_pdf", "BAD NAME", 5]}})
        self.assertTrue(gp.tool_off("zalo_pdf"))
        self.assertFalse(gp.tool_off("zalo_make_file"), "cùng nút 'files' nhưng không bị tắt")
        for group in (True, False):
            self.turn(group=group)
            verdict = zalo_tools.guard_member_tool_call("zalo_pdf", {})
            self.assertEqual(verdict["action"], "block")
            self.assertIn("Chủ bot đã tắt công cụ zalo_pdf", verdict["message"])
            self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_make_file", {}))
        self.turn(owner=True)
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_pdf", {}))

    def test_missing_or_broken_tools_section_changes_nothing(self):
        for data in ({"version": 1}, {"version": 1, "tools": "x"}, {"version": 1, "tools": {"off": "zalo_pdf"}}):
            self.write(data)
            self.turn()
            self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_pdf", {}), data)
        self.write("{hỏng")
        self.assertFalse(gp.tool_off("zalo_pdf"))

    def test_manifest_lists_every_tool_with_its_switch(self):
        path = os.path.join(self.dir, "tools-manifest.json")
        zalo_tools.write_tools_manifest(friend_tools=False, path=path)
        with open(path, encoding="utf-8") as fh:
            manifest = json.load(fh)
        rows = {t["name"]: t for t in manifest["tools"]}
        self.assertEqual(len(rows), len(zalo_tools.TOOLS))
        self.assertEqual(rows["zalo_web_search"]["feature"], "web")
        self.assertEqual(rows["zalo_web_search"]["toolset"], zalo_tools.TOOLSET_PUBLIC)
        self.assertEqual(rows["zalo_send_sticker"]["feature"], "always")
        self.assertEqual(rows["zalo_studio"]["feature"], "studio")
        self.assertFalse(rows["zalo_send_friend_request"]["registered"])
        self.assertTrue(all(r["description"] for r in manifest["tools"]))
```

- [ ] **Step 2: Chạy test, thấy hỏng**

Run: `PYTHONPATH=E:/Hermes/hermes-agent E:/Hermes/hermes-agent/venv/Scripts/python.exe -m unittest test_zalo_permissions.ToolsOffTest -v`
Expected: FAIL — `module … has no attribute 'tool_off'`, `write_tools_manifest`.

- [ ] **Step 3: `group_permissions.py`** — thêm `import re` (cạnh `import os`). Ngay trước `def _parse(text: str)`:

```python
_TOOL_NAME = re.compile(r"^[a-z0-9_]{1,64}$")


def _tools_off(raw: Any) -> frozenset:
    """Mục ``tools.off`` (giai đoạn 7B, spec §18.6): công cụ chủ bot tắt với người không phải chủ nhân."""
    if not isinstance(raw, dict) or not isinstance(raw.get("off"), list):
        return frozenset()
    return frozenset(str(n) for n in raw["off"][:200] if isinstance(n, str) and _TOOL_NAME.match(n))
```

trong `_parse`, sau `"studio": _studio_section(data.get("studio")),` thêm `"tools_off": _tools_off(data.get("tools")),`. Ngay trước `def disabled_features(`:

```python
def tool_off(tool_name: str) -> bool:
    """Chủ bot đã tắt riêng công cụ này với thành viên/người nhắn riêng chưa (chồng lên các nút tính năng)."""
    return str(tool_name or "") in (_load().get("tools_off") or frozenset())
```

- [ ] **Step 4: `tools.py`** — ngay trước `def guard_member_tool_call(`:

```python
def _tool_off_block(name: str, args: Any) -> Optional[Dict[str, str]]:
    """Công cụ chủ bot tắt riêng ở trang Công cụ (``tools.off``, spec §18.6) → chặn. Đọc lỗi → không chặn thêm."""
    real = name
    if name == "tool_call":
        try:
            from tools.tool_search import resolve_underlying_call

            real, _args, error = resolve_underlying_call(args if isinstance(args, dict) else {})
        except Exception:
            return None
        if error or not real:
            return None
    try:
        if not group_permissions.tool_off(real):
            return None
    except Exception as exc:
        logger.warning("[zalo] không đọc được danh sách công cụ tắt: %s", exc)
        return None
    logger.info("[zalo] chặn %s — chủ bot đã tắt công cụ này với thành viên", real)
    return {
        "action": "block",
        "message": (f"Chủ bot đã tắt công cụ {real} với người không phải chủ nhân. Hãy nói ngắn gọn với người hỏi "
                    "rằng việc này hiện chưa làm được; đừng gọi lại công cụ này và đừng dùng công cụ khác để làm thay."),
    }
```

Trong `guard_member_tool_call`, đổi `blocked = _feature_block(turn, name, args)` thành `blocked = _tool_off_block(name, args) or _feature_block(turn, name, args)`.
Cuối `register_tools` (sau `logger.info("[zalo] đã đăng ký …")`), và hai hàm mới ngay sau `register_tools`:

```python
    # Trang Công cụ của dashboard (spec §18.6) đọc danh sách này — cố hết sức, không làm hỏng việc nạp plugin.
    try:
        write_tools_manifest(friend_tools=friend_tools)
    except Exception:
        logger.warning("[zalo] không ghi được tools-manifest.json", exc_info=True)


def tools_manifest(*, friend_tools: bool) -> Dict[str, Any]:
    """Mọi công cụ Zalo: tên, mức quyền, mô tả, nút tính năng điều khiển, có đang được đăng ký không."""
    rows = []
    for name, _emoji, schema, _handler, toolset in TOOLS:
        rows.append({
            "name": name,
            "toolset": toolset,
            "description": str(schema.get("description") or "")[:400],
            "feature": group_permissions.feature_of(name) or ("studio" if name in group_permissions.STUDIO_TOOLS else
                                                              ("always" if name in group_permissions.ALWAYS_ON else None)),
            "registered": not (name in FRIEND_TOOL_NAMES and not friend_tools),
            "dmOnly": name in DM_ONLY_TOOLS,
            "confirm": name in DANGEROUS_TOOL_NAMES,
        })
    return {"v": 1, "generatedAt": int(time.time() * 1000), "tools": rows}


def write_tools_manifest(*, friend_tools: bool, path=None) -> None:
    from pathlib import Path
    target = Path(path) if path else group_permissions.permissions_path().parent / "tools-manifest.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_text(json.dumps(tools_manifest(friend_tools=friend_tools), ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, target)
```

- [ ] **Step 5: Chạy test, thấy xanh**

Run: `HERMES_HOME=E:/Hermes node scripts/run-python-tests.js`
Expected: "Tất cả test Python đều xanh" (≈ 428, gồm 3 test `ToolsOffTest`).

- [ ] **Step 6: Commit**

```bash
git add hermes-plugin/zalo_tools/group_permissions.py hermes-plugin/zalo_tools/tools.py test_zalo_permissions.py
git commit -m "feat(plugin): tools-manifest.json cho dashboard + tắt riêng từng công cụ với người ngoài (tools.off) (giai đoạn 7B)"
```

---

### Task 5: Công cụ — trang dashboard

**Files:**
- Create: `dashboard/lib/tools-catalog.js`, `dashboard/routes/tools.js`, `dashboard/routes/tools.test.js`, `dashboard/public/views/tools.js`
- Modify: `dashboard/lib/permissions.js`, `dashboard/lib/paths.js`, `dashboard/app.js`, `dashboard/server.js`, `dashboard/public/public.test.js`

**Interfaces:**
- Consumes: `tools-manifest.json` (Task 4), `FEATURES`, `STUDIO_FEATURES` (permissions.js), `readEnvKey(…, 'ZALO_PUBLIC_MCP')`.
- Produces: `permissions.js`: `normalizeTools(raw)`, `TOOL_NAME`, `MAX_TOOLS_OFF`, `normalize` giữ `tools`, `get()` trả thêm `toolsOff: string[]`, `setToolsOff(names)`; `tools-catalog.js`: `LEVELS`, `switchLabel(feature)`, `readManifest(file) → {generatedAt, tools}|null`, `parseToolsOff(body, manifest) → string[]`; API admin `GET /api/admin/tools` → `{available, generatedAt, tools:[…, off], publicMcp}`, `PUT /api/admin/tools {off}`; activity `tools_off`; `paths.toolsManifestFile`; deps `toolsManifestFile`, `publicMcp`. View: `Tools`, `groupTools`, `offDiff`.

- [ ] **Step 1: Viết test** — tạo `dashboard/routes/tools.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

const MANIFEST = { v: 1, generatedAt: 5, tools: [
  { name: 'zalo_pdf', toolset: 'zalo_public', description: 'Xử lý PDF', feature: 'files', registered: true },
  { name: 'zalo_send_sticker', toolset: 'zalo_public', description: 'Gửi nhãn dán', feature: 'always', registered: true },
  { name: 'zalo_rename_group', toolset: 'zalo_owner', description: 'Đổi tên nhóm', feature: null, registered: true, confirm: true },
] };

test('Công cụ: chỉ Quản trị; liệt kê mức quyền + nút điều khiển; tắt công cụ công khai ghi tools.off và Nhật ký; giữ mục khác', async (t) => {
  const deps = makeDeps(t);
  mkdirSync(join(deps.dir, 'zalo'), { recursive: true });
  deps.toolsManifestFile = join(deps.dir, 'zalo', 'tools-manifest.json');
  writeFileSync(deps.toolsManifestFile, JSON.stringify(MANIFEST));
  writeFileSync(join(deps.dir, 'zalo', 'permissions.json'), JSON.stringify({ version: 1, defaults: {}, groups: {}, dm: { who: 'list', features: {}, people: {} } }));
  deps.publicMcp = () => 'rag, mcp-search';
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/tools', { cookie: owner })).status, 403);
  const admin = await loginAs(t, deps, call);
  const v = await call('/api/admin/tools', { cookie: admin });
  assert.deepEqual(v.json.tools.map((x) => [x.name, x.level, x.switch, x.off]), [
    ['zalo_pdf', 'Mọi người', 'Gửi và tạo tệp', false], ['zalo_send_sticker', 'Mọi người', 'Luôn bật (không có nút)', false], ['zalo_rename_group', 'Chỉ chủ nhân', '', false],
  ]);
  assert.deepEqual(v.json.publicMcp, ['rag', 'mcp-search']);
  const put = await call('/api/admin/tools', { method: 'PUT', cookie: admin, body: { off: ['zalo_pdf'] } });
  assert.equal(put.json.tools[0].off, true);
  const file = JSON.parse(readFileSync(join(deps.dir, 'zalo', 'permissions.json'), 'utf8'));
  assert.deepEqual(file.tools, { off: ['zalo_pdf'] });
  assert.equal(file.dm.who, 'list', 'mục nhắn riêng còn nguyên');
  assert.equal((await call('/api/admin/tools', { method: 'PUT', cookie: admin, body: { off: ['zalo_rename_group'] } })).status, 400, 'công cụ chủ nhân không có nút');
  assert.equal(deps.activity.list().find((e) => e.action === 'tools_off').detail, 'tắt: zalo_pdf');
  // Lưu nhóm sau đó vẫn giữ tools.off.
  await call('/api/permissions/defaults', { method: 'PUT', cookie: admin, body: { active: true, replyOnlyTagged: true, features: Object.fromEntries(['web', 'files', 'voice', 'reminders', 'groupCron', 'kb', 'people', 'academic', 'video'].map((k) => [k, true])) } });
  assert.deepEqual(JSON.parse(readFileSync(join(deps.dir, 'zalo', 'permissions.json'), 'utf8')).tools, { off: ['zalo_pdf'] });
});

test('Công cụ: chưa có tools-manifest.json (plugin cũ) → available=false, không lỗi', async (t) => {
  const deps = makeDeps(t);
  deps.toolsManifestFile = join(deps.dir, 'khong-co.json');
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  const v = await call('/api/admin/tools', { cookie: admin });
  assert.equal(v.status, 200);
  assert.equal(v.json.available, false);
  assert.deepEqual(v.json.tools, []);
});
```

thêm vào **cuối** `dashboard/public/public.test.js`:

```js
test('Công cụ: nhóm theo mức quyền giữ thứ tự; đếm thay đổi hai chiều', async () => {
  const { groupTools, offDiff } = await import('./views/tools.js');
  assert.deepEqual(groupTools([{ level: 'Mọi người', name: 'a' }, { level: 'Chỉ chủ nhân', name: 'b' }, { level: 'Mọi người', name: 'c' }]).map((g) => [g.level, g.list.length]),
    [['Mọi người', 2], ['Chỉ chủ nhân', 1]]);
  assert.equal(offDiff(new Set(['a', 'b']), new Set(['b', 'c'])), 2);
  assert.equal(offDiff(new Set(), new Set()), 0);
});
```

- [ ] **Step 2: Chạy test, thấy hỏng**

Run: `node --test dashboard/routes/tools.test.js dashboard/public/public.test.js`
Expected: FAIL — `/api/admin/tools` 404, `./views/tools.js` không có.

- [ ] **Step 3: Mục `tools` trong permissions.js** — `dashboard/lib/permissions.js`, thay cuối `normalize`:

```js
  const dm = normalizeDm(raw.dm);
  const studio = normalizeStudio(raw.studio);
  // Mục `tools` (giai đoạn 7B, spec §18.6): công cụ tắt riêng với người không phải chủ nhân — cũng phải sống qua mọi lần lưu.
  const tools = normalizeTools(raw.tools);
  return { version: 1, defaults: layer(raw.defaults), groups, ...(dm ? { dm } : {}), ...(studio ? { studio } : {}), ...(tools ? { tools } : {}) };
}

export const TOOL_NAME = /^[a-z0-9_]{1,64}$/;
export const MAX_TOOLS_OFF = 200;

/** Như `_tools_off` bên Python: `{ off: [tên công cụ hợp lệ, không trùng] }`; không phải object → null. */
export function normalizeTools(raw) {
  if (!isObj(raw)) return null;
  const off = Array.isArray(raw.off) ? [...new Set(raw.off.filter((n) => typeof n === 'string' && TOOL_NAME.test(n)))].slice(0, MAX_TOOLS_OFF) : [];
  return { off };
}
```

trong `view(...)` trả thêm `toolsOff: data.tools?.off || []`; thêm phương thức (trước `setStudio`):

```js
    /** Lưu danh sách công cụ tắt với người không phải chủ nhân (trang Công cụ, chỉ Quản trị). `names` đã kiểm ở route. */
    setToolsOff(names) {
      const { data } = read();
      data.tools = { off: [...new Set(names)].sort() };
      write(data);
      return view({ data, exists: true, corrupt: false });
    },
```

- [ ] **Step 4: Viết `dashboard/lib/tools-catalog.js`**

```js
/**
 * Công cụ (spec §18.6, chỉ Quản trị): danh sách công cụ Zalo do plugin ghi lúc nạp (`<HERMES_HOME>/zalo/tools-manifest.json`,
 * zalo_tools/tools.py `write_tools_manifest`). Dashboard chỉ đọc tệp này; tắt/bật công cụ ghi vào `permissions.json`
 * mục `tools.off` (plugin chặn tại `guard_member_tool_call`, có hiệu lực ngay, chủ nhân không bao giờ bị chặn).
 */
import { readFileSync } from 'node:fs';
import { FEATURES, STUDIO_FEATURES } from './permissions.js';

export const LEVELS = { zalo_public: 'Mọi người', zalo_owner: 'Chỉ chủ nhân', zalo_cron: 'Việc hẹn giờ', zalo_cron_member: 'Hẹn giờ nhóm' };

/** Nhãn nút điều khiển một công cụ: tên nút ở Phân quyền Bot, "Xưởng tạo sản phẩm", "Luôn bật" hoặc "—". */
export function switchLabel(feature) {
  if (feature === 'always') return 'Luôn bật (không có nút)';
  if (feature === 'studio') return `Xưởng tạo sản phẩm (${STUDIO_FEATURES.map((f) => f.label).join(', ')})`;
  return FEATURES.find((f) => f.key === feature)?.label || '';
}

/** Đọc danh sách công cụ; chưa có tệp (plugin cũ / chưa khởi động lại trợ lý) → null. */
export function readManifest(file) {
  try {
    const m = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(m?.tools)) return null;
    return {
      generatedAt: Number(m.generatedAt) || null,
      tools: m.tools.filter((t) => typeof t?.name === 'string' && /^[a-z0-9_]{1,64}$/.test(t.name)).map((t) => ({
        name: t.name, toolset: String(t.toolset || ''), level: LEVELS[t.toolset] || String(t.toolset || ''),
        description: String(t.description || '').slice(0, 400), feature: t.feature || null, switch: switchLabel(t.feature),
        registered: t.registered !== false, dmOnly: Boolean(t.dmOnly), confirm: Boolean(t.confirm),
      })),
    };
  } catch { return null; }
}

/** Công cụ được phép tắt từ dashboard: chỉ công cụ công khai (người ngoài vốn không gọi được công cụ chủ nhân). */
export function parseToolsOff(body, manifest) {
  const off = body?.off;
  if (!Array.isArray(off) || off.length > 200) throw Object.assign(new Error('Danh sách không hợp lệ — tải lại trang.'), { statusCode: 400 });
  const pub = new Set((manifest?.tools || []).filter((t) => t.toolset === 'zalo_public').map((t) => t.name));
  for (const n of off) {
    if (!pub.has(n)) throw Object.assign(new Error(`"${String(n).slice(0, 40)}" không phải công cụ công khai — tải lại trang.`), { statusCode: 400 });
  }
  return [...new Set(off)];
}
```

- [ ] **Step 5: Viết `dashboard/routes/tools.js`** và nối

```js
// Công cụ (spec §18.6) — chỉ Quản trị. Tắt riêng công cụ công khai cho người không phải chủ nhân: hiệu lực ngay
// (plugin đọc permissions.json theo mtime). Công cụ MCP mở cho thành viên theo ZALO_PUBLIC_MCP: chỉ xem ở đây.
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';
import { parseToolsOff, readManifest } from '../lib/tools-catalog.js';

export function toolRoutes({ permissions, toolsManifestFile, publicMcp = () => '', activity }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const view = () => {
    const manifest = readManifest(toolsManifestFile);
    const off = new Set(permissions.get().toolsOff);
    return {
      ok: true, available: Boolean(manifest), generatedAt: manifest?.generatedAt ?? null,
      tools: (manifest?.tools || []).map((t) => ({ ...t, off: off.has(t.name) })),
      publicMcp: String(publicMcp() || '').split(',').map((s) => s.trim()).filter(Boolean),
    };
  };
  r.get('/admin/tools', ...guard, (req, res) => {
    try { res.json(view()); } catch (err) { console.error('[dashboard]', err); res.status(500).json({ ok: false, error: 'Chưa đọc được danh sách công cụ — tải lại trang.' }); }
  });
  r.put('/admin/tools', ...guard, (req, res) => {
    try {
      const before = new Set(permissions.get().toolsOff);
      const off = parseToolsOff(req.body, readManifest(toolsManifestFile));
      permissions.setToolsOff(off);
      const added = off.filter((n) => !before.has(n)); const removed = [...before].filter((n) => !off.includes(n));
      try {
        activity.append({ actor: req.user.username, action: 'tools_off', detail: [added.length && `tắt: ${added.join(', ')}`, removed.length && `bật lại: ${removed.join(', ')}`].filter(Boolean).join(' · ') || 'không đổi' });
      } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
      res.json(view());
    } catch (err) {
      if (err?.statusCode === 400 || err?.name === 'InvalidPermissions') return res.status(400).json({ ok: false, error: err.message });
      console.error('[dashboard]', err);
      res.status(500).json({ ok: false, error: 'Chưa lưu được — thử lại, nếu vẫn lỗi hãy báo người cài đặt.' });
    }
  });
  return r;
}
```

`dashboard/app.js`: import + `if (deps.toolsManifestFile) app.use('/api', toolRoutes(deps));`.
`dashboard/lib/paths.js` sau `soulHistoryDir`:

```js
    // Plugin ghi lúc nạp (zalo_tools/tools.py write_tools_manifest) — dashboard chỉ đọc.
    toolsManifestFile: join(hermesHome, 'zalo', 'tools-manifest.json'),
```

`dashboard/server.js` trong `buildDeps`:

```js
    toolsManifestFile: paths.toolsManifestFile,
    publicMcp: () => readEnvKey(paths.hermesEnvFile, 'ZALO_PUBLIC_MCP'),
```

- [ ] **Step 6: Trang Công cụ** — tạo `dashboard/public/views/tools.js`:

```js
// Công cụ (spec §18.6, chỉ Quản trị): mọi công cụ Zalo của bot, ai dùng được, nút nào điều khiển; tắt riêng công cụ
// công khai cho người không phải chủ nhân (chồng lên các nút ở Phân quyền Bot).
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, fmtTime, Live, Notice, PageHead, SaveBar, Spinner } from '../ui.js';
import { fold } from '../fold.js';

/** Nhóm công cụ theo mức quyền, giữ thứ tự của plugin. */
export function groupTools(tools) {
  const out = new Map();
  for (const t of tools) { if (!out.has(t.level)) out.set(t.level, []); out.get(t.level).push(t); }
  return [...out].map(([level, list]) => ({ level, list }));
}

/** Số khác biệt giữa bản nháp và đã lưu (tập tên công cụ tắt). */
export const offDiff = (draft, saved) => [...draft].filter((n) => !saved.has(n)).length + [...saved].filter((n) => !draft.has(n)).length;

export function Tools() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(new Set());
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState(false);
  const take = (r) => { setData(r); setDraft(new Set(r.tools.filter((t) => t.off).map((t) => t.name))); };
  useEffect(() => { api('/api/admin/tools').then(take).catch((e) => setMsg({ error: e.message })); }, []);
  const head = html`<${PageHead} title="Công cụ" sub="Những việc bot làm được, ai được nhờ, và nút nào ở Phân quyền Bot điều khiển. Chỉ Quản trị." />`;
  if (!data) return html`${head}<${Live} error=${msg.error} />${msg.error ? null : html`<${Spinner} />`}`;
  if (!data.available) return html`${head}<${Notice} kind="info">Trợ lý chưa ghi danh sách công cụ — cập nhật plugin lên bản mới rồi khởi động lại trợ lý.<//>`;
  const saved = new Set(data.tools.filter((t) => t.off).map((t) => t.name));
  const count = offDiff(draft, saved);
  const n = fold(q).trim();
  const toggle = (name, on) => { const d = new Set(draft); if (on) d.delete(name); else d.add(name); setDraft(d); };
  async function save(e) {
    e.preventDefault(); setBusy(true); setMsg({});
    try { take(await api('/api/admin/tools', { method: 'PUT', body: { off: [...draft] } })); setMsg({ ok: 'Đã lưu — có hiệu lực ngay từ tin nhắn sau.' }); } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }
  return html`${head}
    <form class="card" onSubmit=${save}>
      <div class="toolbar"><label class="sr-only" for="tool-q">Tìm công cụ</label>
        <input id="tool-q" type="search" placeholder="Tìm theo tên hoặc mô tả…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
        <small class="muted">Danh sách cập nhật lúc ${fmtTime(data.generatedAt)}</small></div>
      ${data.publicMcp.length ? html`<${Notice} kind="info">Công cụ MCP mở cho thành viên (ZALO_PUBLIC_MCP): ${data.publicMcp.join(', ')}. Đổi ở trang Cấu hình của người cài đặt.<//>` : null}
      ${groupTools(data.tools.filter((t) => !n || fold(`${t.name} ${t.description}`).includes(n))).map((g) => html`<div key=${g.level} class="mem-block">
        <h3>${g.level} <small class="muted">${g.list.length}</small></h3>
        <ul class="row-list">${g.list.map((t) => html`<li key=${t.name} class="row-item">
          <span class="row-main"><strong class="mono">${t.name}</strong><small>${t.description}</small>
            <small class="muted">${t.switch ? `Nút: ${t.switch}` : 'Không có nút ở Phân quyền Bot'}${t.confirm ? ' · cần mã xác nhận' : ''}${t.dmOnly ? ' · chỉ trong tin nhắn riêng' : ''}${t.registered ? '' : ' · đang tắt ở cài đặt (ZALO_FRIEND_TOOLS)'}</small></span>
          ${t.toolset === 'zalo_public' ? html`<label class="check"><input type="checkbox" checked=${!draft.has(t.name)} onChange=${(e) => toggle(t.name, e.currentTarget.checked)} />Cho người ngoài dùng</label>`
            : html`<span class="badge badge-idle">Người ngoài không dùng được</span>`}
        </li>`)}</ul></div>`)}
      <${SaveBar} count=${count} busy=${busy} canSave=${count > 0} onUndo=${() => setDraft(saved)} idle="Chưa có thay đổi." msg=${msg} />
    </form>`;
}
```

- [ ] **Step 7: Chạy test, thấy xanh**

Run: `node --test dashboard/routes/tools.test.js dashboard/lib/permissions.test.js dashboard/routes/permissions.test.js dashboard/public/public.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add dashboard/lib/tools-catalog.js dashboard/routes/tools.js dashboard/routes/tools.test.js dashboard/public/views/tools.js dashboard/lib/permissions.js dashboard/lib/paths.js dashboard/app.js dashboard/server.js dashboard/public/public.test.js
git commit -m "feat(dashboard): trang Công cụ — mọi công cụ, nút điều khiển, tắt riêng với người ngoài (giai đoạn 7B)"
```

---

### Task 6: Theo dõi agent — phiên, lượt, công cụ, token (chỉ đọc state.db)

**Files:**
- Create: `dashboard/lib/agent-trace.js`, `dashboard/lib/agent-trace.test.js`, `dashboard/routes/trace.js`, `dashboard/routes/trace.test.js`, `dashboard/public/views/trace.js`
- Modify: `dashboard/app.js`, `dashboard/server.js`, `dashboard/public/public.test.js`

**Interfaces:**
- Consumes: `paths.hermesStateDb`, `threadNames.load()`, `fallbackName`.
- Produces: `SOURCES`, `redactArgs(raw) → [{key, kind}]`, `toolFailed(content) → bool`, `buildTurns(rows) → [{at, user, tools:[{name, args, status, ms}], reply, ms}]`, `createAgentTrace({ dbPath }) → { sessions({source, chat, limit}), turns(sessionId, {limit}) }`; API admin `GET /api/admin/trace/sessions?source=&chat=` (thêm `chatName`), `GET /api/admin/trace/sessions/:id/turns`; deps `agentTrace`. View: `Trace`, `fmtMs`, `SOURCES`.

- [ ] **Step 1: Viết test** — tạo `dashboard/lib/agent-trace.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildTurns, createAgentTrace, redactArgs, toolFailed } from './agent-trace.js';

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

test('phiên theo nguồn và hội thoại; token theo phiên; không đọc lời nhắc hệ thống', (t) => {
  const trace = createAgentTrace({ dbPath: stateDb(t) });
  const z = trace.sessions({ source: 'zalo' });
  assert.deepEqual(z.map((s) => [s.id, s.chatId, s.input, s.output, s.cached]), [['z1', '200', 9000, 300, 7000]]);
  assert.equal(trace.sessions({ source: 'all' }).length, 2);
  assert.equal(trace.sessions({ source: 'zalo', chat: '999' }).length, 0);
  assert.doesNotMatch(JSON.stringify(z), /BÍ MẬT/);
  assert.throws(() => trace.sessions({ source: 'x' }), (e) => e.statusCode === 400);
  assert.throws(() => trace.sessions({ chat: "1' OR 1=1" }), (e) => e.statusCode === 400);
});

test('lượt: câu hỏi, công cụ (tham số đã che, trạng thái, thời gian), câu trả lời; không lộ kết quả công cụ', (t) => {
  const trace = createAgentTrace({ dbPath: stateDb(t) });
  const [turn] = trace.turns('z1');
  assert.equal(turn.user, 'Tra giá vàng hôm nay');
  assert.equal(turn.reply, 'Giá vàng SJC hôm nay là…');
  assert.equal(turn.ms, 6000);
  assert.deepEqual(turn.tools, [{ name: 'zalo_web_search', args: [{ key: 'query', kind: 'chữ, 23 ký tự' }, { key: 'max', kind: 'số' }], status: 'xong', ms: 2500 }]);
  const text = JSON.stringify(turn);
  assert.doesNotMatch(text, /0912345678|bao\.vn/);
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
```

tạo `dashboard/routes/trace.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

const fakeTrace = {
  sessions: ({ source, chat }) => {
    if (!['zalo', 'cron', 'all'].includes(source)) throw Object.assign(new Error('Nguồn không hợp lệ.'), { statusCode: 400 });
    return [{ id: 'z1', source: 'zalo', chatType: 'group', chatId: '200', title: 'Họp', model: 'hermes', input: 1, output: 2 }].filter((s) => !chat || s.chatId === chat);
  },
  turns: () => [{ at: 1, user: 'hỏi', reply: 'đáp', tools: [], ms: 5 }],
};

test('Theo dõi agent: chỉ Quản trị; tên nhóm từ danh bạ; lỗi tham số 400; state.db hỏng 500 câu chung', async (t) => {
  const deps = makeDeps(t, { agentTrace: fakeTrace });
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/trace/sessions', { cookie: owner })).status, 403);
  const admin = await loginAs(t, deps, call);
  const r = await call('/api/admin/trace/sessions?source=zalo', { cookie: admin });
  assert.equal(r.json.sessions[0].chatName, 'Tổ Hoá');
  assert.equal((await call('/api/admin/trace/sessions?source=khac', { cookie: admin })).status, 400);
  assert.equal((await call('/api/admin/trace/sessions/z1/turns', { cookie: admin })).json.turns[0].reply, 'đáp');
  const broken = makeDeps(t, { agentTrace: { sessions: () => { throw new Error('database disk image is malformed'); }, turns: () => [] } });
  const app2 = await startApp(t, broken);
  const a2 = await loginAs(t, broken, app2.call);
  const b = await app2.call('/api/admin/trace/sessions', { cookie: a2 });
  assert.equal(b.status, 500);
  assert.doesNotMatch(b.json.error, /malformed/);
});
```

thêm vào **cuối** `dashboard/public/public.test.js`:

```js
test('Theo dõi agent: thời gian dễ đọc', async () => {
  const { fmtMs } = await import('./views/trace.js');
  assert.equal(fmtMs(null), '—');
  assert.equal(fmtMs(850), '850 ms');
  assert.equal(fmtMs(2500), '2,5 giây');
  assert.equal(fmtMs(65_000), '1 phút 5 giây');
});
```

- [ ] **Step 2: Chạy test, thấy hỏng**

Run: `node --test dashboard/lib/agent-trace.test.js dashboard/routes/trace.test.js dashboard/public/public.test.js`
Expected: FAIL — module chưa có.

- [ ] **Step 3: Viết `dashboard/lib/agent-trace.js`**

```js
/**
 * Theo dõi agent (spec §18.6, chỉ Quản trị): đọc `<HERMES_HOME>/state.db` của Hermes CHỈ ĐỌC (node:sqlite readOnly +
 * query_only, mở rồi đóng mỗi lần như ai-usage.js) — phiên, lượt, lời gọi công cụ, token, model.
 * - Tham số công cụ đã che: chỉ hiện TÊN khoá và loại/độ dài giá trị, không bao giờ hiện giá trị.
 * - Kết quả công cụ: chỉ trạng thái (xong/lỗi) và thời gian (giờ tin kết quả − giờ tin gọi), không hiện nội dung.
 * - Token và model: theo phiên (Hermes không ghi token theo từng tin).
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const SOURCES = ['zalo', 'cron', 'all'];
const MAX_MESSAGES = 1500;

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Tham số công cụ (chuỗi JSON) → [{ key, kind }] — không giá trị nào lọt ra. */
export function redactArgs(raw) {
  let a;
  try { a = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return [{ key: '(không đọc được)', kind: '' }]; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return [];
  return Object.entries(a).slice(0, 20).map(([key, v]) => ({
    key: clip(key, 40),
    kind: typeof v === 'string' ? `chữ, ${v.length} ký tự` : Array.isArray(v) ? `danh sách ${v.length} mục`
      : v === null ? 'trống' : typeof v === 'object' ? 'đối tượng' : typeof v === 'number' ? 'số' : typeof v === 'boolean' ? 'đúng/sai' : typeof v,
  }));
}

/** Kết quả công cụ có phải lỗi không (JSON `success: false` hoặc có khoá `error`). */
export function toolFailed(content) {
  try { const j = JSON.parse(String(content ?? '')); return Boolean(j && typeof j === 'object' && (j.success === false || (j.error != null && j.error !== ''))); } catch { return /^(error|lỗi)\b/i.test(String(content ?? '').trim()); }
}

/** Gom tin của một phiên (đã theo thứ tự id) thành lượt: tin người dùng → lời gọi công cụ → câu trả lời. */
export function buildTurns(rows) {
  const turns = []; let cur = null; const pending = new Map();
  for (const m of rows) {
    const at = Math.round(Number(m.timestamp) * 1000);
    if (m.role === 'user') { cur = { at, user: clip(m.content, 200), tools: [], reply: '', endAt: at }; turns.push(cur); continue; }
    if (!cur) continue;   // phần lượt bị cắt ở đầu trang
    cur.endAt = Math.max(cur.endAt, at);
    if (m.role === 'assistant') {
      let calls = [];
      try { calls = JSON.parse(m.tool_calls || '[]'); } catch { calls = []; }
      for (const c of Array.isArray(calls) ? calls : []) {
        const t = { name: clip(c?.function?.name, 64), args: redactArgs(c?.function?.arguments), status: 'đang chạy', ms: null };
        cur.tools.push(t);
        if (c?.id) pending.set(String(c.id), { t, at });
        if (c?.call_id) pending.set(String(c.call_id), { t, at });
      }
      if (m.content && (!calls || !calls.length)) cur.reply = clip(m.content, 300);
    } else if (m.role === 'tool') {
      const p = pending.get(String(m.tool_call_id ?? ''));
      if (p) { p.t.status = toolFailed(m.content) ? 'lỗi' : 'xong'; p.t.ms = Math.max(0, at - p.at); }
    }
  }
  return turns.map(({ endAt, ...t }) => ({ ...t, ms: endAt - t.at }));
}

export function createAgentTrace({ dbPath }) {
  function withDb(fn) {
    if (!existsSync(dbPath)) throw err(503, 'Chưa có dữ liệu của trợ lý (state.db) trên máy này.');
    const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1500 });
    try { db.exec('PRAGMA query_only = ON'); return fn(db); } finally { db.close(); }
  }
  return {
    /** Phiên mới hoạt động trước; `chat` = id nhóm/người Zalo (chat_id). */
    sessions({ source = 'zalo', chat = '', limit = 50 } = {}) {
      if (!SOURCES.includes(source)) throw err(400, 'Nguồn không hợp lệ.');
      if (chat && !/^\d{1,32}$/.test(chat)) throw err(400, 'Hội thoại không hợp lệ.');
      return withDb((db) => db.prepare(`SELECT id, source, chat_type, chat_id, title, model, started_at, last_activity_at, ended_at,
          message_count, tool_call_count, api_call_count, input_tokens, output_tokens, cache_read_tokens
        FROM sessions WHERE (? = 'all' OR source = ?) AND (? = '' OR chat_id = ?)
        ORDER BY COALESCE(last_activity_at, started_at) DESC LIMIT ?`).all(source, source, chat, chat, Math.min(Math.max(Number(limit) || 50, 1), 200))
        .map((s) => ({
          id: String(s.id), source: s.source, chatType: s.chat_type || '', chatId: s.chat_id || '', title: clip(s.title, 120), model: clip(s.model, 80),
          startedAt: Math.round(Number(s.started_at) * 1000), lastAt: s.last_activity_at ? Math.round(Number(s.last_activity_at) * 1000) : null,
          ended: s.ended_at != null, messages: Number(s.message_count) || 0, toolCalls: Number(s.tool_call_count) || 0, apiCalls: Number(s.api_call_count) || 0,
          input: Number(s.input_tokens) || 0, output: Number(s.output_tokens) || 0, cached: Number(s.cache_read_tokens) || 0,
        })));
    },
    /** 30 lượt gần nhất của một phiên (đọc tối đa 1500 tin mới nhất). */
    turns(sessionId, { limit = 30 } = {}) {
      if (!/^[\w:.-]{1,128}$/.test(String(sessionId))) throw err(400, 'Phiên không hợp lệ.');
      return withDb((db) => {
        const rows = db.prepare(`SELECT id, role, content, tool_calls, tool_call_id, timestamp FROM messages
          WHERE session_id = ? AND role IN ('user', 'assistant', 'tool') ORDER BY id DESC LIMIT ?`).all(String(sessionId), MAX_MESSAGES).reverse();
        return buildTurns(rows).slice(-Math.min(Math.max(Number(limit) || 30, 1), 100)).reverse();
      });
    },
  };
}
```

- [ ] **Step 4: Viết `dashboard/routes/trace.js`** và nối

```js
// Theo dõi agent (spec §18.6) — chỉ Quản trị, chỉ đọc state.db của Hermes. Tên nhóm/người lấy như Phiên chat.
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';
import { fallbackName } from '../lib/thread-names.js';

export function traceRoutes({ agentTrace, threadNames }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const fail = (res, err) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status !== 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: 'Chưa đọc được dữ liệu của trợ lý (state.db đang bận hoặc đổi cấu trúc) — thử lại sau ít phút.' });
  };
  r.get('/admin/trace/sessions', ...guard, async (req, res) => {
    try {
      const list = agentTrace.sessions({ source: String(req.query.source || 'zalo'), chat: String(req.query.chat || ''), limit: req.query.limit });
      let names = new Map();
      try { names = await threadNames.load(); } catch { /* tên dự phòng */ }
      res.json({ ok: true, sessions: list.map((s) => ({ ...s, chatName: s.chatId ? names.get(s.chatId) || fallbackName(s.chatId, s.chatType === 'group' ? 1 : 0) : '' })) });
    } catch (err) { fail(res, err); }
  });
  r.get('/admin/trace/sessions/:id/turns', ...guard, (req, res) => {
    try { res.json({ ok: true, turns: agentTrace.turns(req.params.id, { limit: req.query.limit }) }); } catch (err) { fail(res, err); }
  });
  return r;
}
```

`dashboard/app.js`: import + `if (deps.agentTrace) app.use('/api', traceRoutes(deps));`. `dashboard/server.js`: import + `agentTrace: createAgentTrace({ dbPath: paths.hermesStateDb }),`.

- [ ] **Step 5: Trang Theo dõi agent** — tạo `dashboard/public/views/trace.js`:

```js
// Theo dõi agent (spec §18.6, chỉ Quản trị): phiên của trợ lý, từng lượt, công cụ đã gọi (tham số đã che), token.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, fmtTime, Live, PageHead, Spinner } from '../ui.js';

export const SOURCES = [{ value: 'zalo', label: 'Zalo' }, { value: 'cron', label: 'Việc hẹn giờ' }, { value: 'all', label: 'Tất cả' }];
const fmtNum = (n) => new Intl.NumberFormat('vi-VN').format(n);

/** "850 ms", "2,5 giây", "1 phút 5 giây". */
export function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(ms / 1000)} giây`;
  return `${Math.floor(ms / 60_000)} phút ${Math.round((ms % 60_000) / 1000)} giây`;
}

function Turns({ id }) {
  const [turns, setTurns] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setTurns(null); api(`/api/admin/trace/sessions/${encodeURIComponent(id)}/turns`).then((r) => setTurns(r.turns)).catch((e) => setError(e.message)); }, [id]);
  if (error) return html`<${Live} error=${error} />`;
  if (!turns) return html`<${Spinner} />`;
  if (!turns.length) return html`<p class="muted">Phiên chưa có lượt nào.</p>`;
  return html`<ol class="trace-turns">${turns.map((t) => html`<li key=${t.at} class="trace-turn">
    <p><strong>${fmtTime(t.at)}</strong> <small class="muted">· ${fmtMs(t.ms)}</small></p>
    <p class="muted">Hỏi: ${t.user || '(không có chữ)'}</p>
    ${t.tools.length ? html`<ul class="trace-tools">${t.tools.map((c, i) => html`<li key=${i}>
      <span class="mono">${c.name}</span> <span class=${`badge ${c.status === 'lỗi' ? 'badge-danger' : c.status === 'xong' ? 'badge-ok' : 'badge-idle'}`}>${c.status}</span>
      <small class="muted">${fmtMs(c.ms)}${c.args.length ? ` · ${c.args.map((a) => `${a.key} (${a.kind})`).join(', ')}` : ''}</small></li>`)}</ul>` : null}
    ${t.reply ? html`<p>Đáp: ${t.reply}</p>` : null}
  </li>`)}</ol>`;
}

export function Trace() {
  const [source, setSource] = useState('zalo');
  const [list, setList] = useState(null);
  const [open, setOpen] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setList(null); api(`/api/admin/trace/sessions?source=${source}`).then((r) => setList(r.sessions)).catch((e) => setError(e.message)); }, [source]);
  return html`<${PageHead} title="Theo dõi agent" sub="Trợ lý đã làm gì trong từng phiên: câu hỏi, công cụ đã gọi, thời gian, token. Tham số công cụ chỉ hiện tên, không hiện nội dung." />
    <section class="card">
      <div class="chips" role="group" aria-label="Nguồn">
        ${SOURCES.map((s) => html`<button key=${s.value} type="button" class="btn btn-secondary btn-sm chip" aria-pressed=${source === s.value ? 'true' : 'false'} onClick=${() => { setSource(s.value); setOpen(''); }}>${s.label}</button>`)}
      </div>
      <${Live} error=${error} />
      ${!list && !error ? html`<${Spinner} />` : null}
      <ul class="row-list">${(list || []).map((s) => html`<li key=${s.id} class="row-item">
        <span class="row-main"><strong>${s.chatName || s.title || s.id}</strong>
          <small class="muted">${s.title && s.chatName ? `${s.title} · ` : ''}${s.model} · ${fmtNum(s.apiCalls)} lượt gọi AI · ${fmtNum(s.toolCalls)} công cụ · vào ${fmtNum(s.input)} / ra ${fmtNum(s.output)} token${s.cached ? ` (đệm ${fmtNum(s.cached)})` : ''}</small>
          <small class="muted">Hoạt động lần cuối ${fmtTime(s.lastAt || s.startedAt)}</small></span>
        <button type="button" class="btn btn-secondary btn-sm" aria-expanded=${open === s.id ? 'true' : 'false'} onClick=${() => setOpen(open === s.id ? '' : s.id)}>${open === s.id ? 'Thu gọn' : 'Xem lượt'}</button>
        ${open === s.id ? html`<div class="trace-box"><${Turns} id=${s.id} /></div>` : null}
      </li>`)}</ul>
    </section>`;
}
```

- [ ] **Step 6: Chạy test, thấy xanh + đọc thử state.db thật (chỉ đọc)**

Run: `node --test dashboard/lib/agent-trace.test.js dashboard/routes/trace.test.js dashboard/public/public.test.js`
Expected: PASS.
Run: `node --input-type=module -e "import { createAgentTrace } from './dashboard/lib/agent-trace.js'; const t = createAgentTrace({ dbPath: 'E:/Hermes/state.db' }); const s = t.sessions({ limit: 3 }); console.log(s.length, t.turns(s[0].id).length)"`
Expected: hai số > 0, không lỗi lược đồ (state.db lược đồ 28; VPS 30 cùng các cột này).

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib/agent-trace.js dashboard/lib/agent-trace.test.js dashboard/routes/trace.js dashboard/routes/trace.test.js dashboard/public/views/trace.js dashboard/app.js dashboard/server.js dashboard/public/public.test.js
git commit -m "feat(dashboard): trang Theo dõi agent — phiên, lượt, công cụ (tham số đã che), token (giai đoạn 7B)"
```

---

### Task 7: Kết nối MCP — xem, trạng thái, bật/tắt

**Files:**
- Create: `dashboard/lib/mcp-servers.js`, `dashboard/lib/mcp-servers.test.js`, `dashboard/routes/mcp.js`, `dashboard/routes/mcp.test.js`, `dashboard/public/views/mcp.js`
- Modify: `dashboard/app.js`, `dashboard/server.js`, `dashboard/public/public.test.js`

**Interfaces:**
- Consumes: `editConfigYaml`, `readConfigYaml` (Task 1), `restartFlags.mark` (Task 2).
- Produces: `SERVER_NAME`, `globMatch(pattern, text)`, `describeServer(name, cfg, publicPatterns)`, `createMcpServers({ configFile, publicMcp?, probe? }) → { list() → [{name, transport, target, enabled, loopback, publicToMembers, status}], setEnabled(name, enabled) → bool }`; API admin `GET /api/admin/mcp`, `PUT /api/admin/mcp/:name {enabled}`; activity `mcp_enable|mcp_disable`; cờ "Kết nối MCP: <tên>". View: `Mcp`, `mcpKind`.

- [ ] **Step 1: Viết test** — tạo `dashboard/lib/mcp-servers.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { createMcpServers, describeServer, globMatch } from './mcp-servers.js';

const CONFIG = [
  'mcp_servers:',
  '  rag:',
  '    url: http://127.0.0.1:9998/mcp?token=bi-mat',
  '    timeout: 180',
  '  github:',
  '    url: https://api.githubcopilot.com/mcp/',
  '    headers:',
  '      Authorization: Bearer ghp_bimat',
  '  files:',
  '    command: /usr/bin/npx',
  '    args: ["-y", "@modelcontextprotocol/server-filesystem", "/root"]',
  '    env:',
  '      SECRET: x',
  '    enabled: false',
  '',
].join('\n');

function setup(t) {
  const d = mkdtempSync(join(tmpdir(), 'zd-mcp-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(join(d, 'config.yaml'), CONFIG);
  return join(d, 'config.yaml');
}

test('mô tả an toàn: không bao giờ có khoá, header, env, args, đường dẫn/truy vấn URL', () => {
  const d = describeServer('rag', { url: 'http://127.0.0.1:9998/mcp?token=bi-mat' }, ['rag']);
  assert.deepEqual({ ...d }, { name: 'rag', transport: 'http', target: 'http://127.0.0.1:9998', enabled: true, loopback: true, publicToMembers: true, host: '127.0.0.1', port: 9998 });
  assert.equal(describeServer('f', { command: '/usr/bin/npx', enabled: 'false' }).enabled, false);
  assert.equal(globMatch('mcp-*', 'mcp-rag'), true);
  assert.equal(globMatch('r?g', 'rag'), true);
  assert.equal(globMatch('rag', 'rag2'), false);
});

test('liệt kê: chỉ dò loopback, máy ngoài không dò, tắt thì không dò; mở cho thành viên theo ZALO_PUBLIC_MCP', async (t) => {
  const file = setup(t);
  const probes = [];
  const mcp = createMcpServers({ configFile: file, publicMcp: () => 'mcp-rag', probe: async (h, p) => { probes.push(`${h}:${p}`); return true; } });
  const list = await mcp.list();
  assert.deepEqual(list.map((s) => [s.name, s.transport, s.target, s.enabled, s.status, s.publicToMembers]), [
    ['rag', 'http', 'http://127.0.0.1:9998', true, 'Đang mở', true],
    ['github', 'http', 'https://api.githubcopilot.com', true, 'Máy ngoài — không kiểm', false],
    ['files', 'stdio', 'npx', false, 'Đã tắt', false],
  ]);
  assert.deepEqual(probes, ['127.0.0.1:9998']);
  assert.doesNotMatch(JSON.stringify(list), /bi-mat|ghp_|SECRET|server-filesystem|\/root|"host"|"port"/);
});

test('bật/tắt: sửa đúng mcp_servers.<tên>.enabled, giữ khối khác; tên lạ 404', (t) => {
  const file = setup(t);
  const mcp = createMcpServers({ configFile: file });
  assert.equal(mcp.setEnabled('rag', false), true);
  assert.equal(mcp.setEnabled('files', true), true);
  const y = YAML.parse(readFileSync(file, 'utf8'));
  assert.equal(y.mcp_servers.rag.enabled, false);
  assert.equal(y.mcp_servers.files.enabled, true);
  assert.equal(y.mcp_servers.github.headers.Authorization, 'Bearer ghp_bimat');
  assert.throws(() => mcp.setEnabled('khong-co', true), (e) => e.statusCode === 404);
  assert.throws(() => mcp.setEnabled('rag', 'có'), (e) => e.statusCode === 400);
});
```

tạo `dashboard/routes/mcp.test.js`:

```js
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
  const admin = await loginAs(t, deps, call);
  assert.equal((await call('/api/admin/mcp', { cookie: admin })).json.servers[0].status, 'Không phản hồi');
  const off = await call('/api/admin/mcp/rag', { method: 'PUT', cookie: admin, body: { enabled: false } });
  assert.equal(off.json.servers[0].status, 'Đã tắt');
  assert.deepEqual(deps.restartFlags.get().assistant.reasons, ['Kết nối MCP: rag']);
  assert.equal(deps.activity.list().find((e) => e.action === 'mcp_disable').detail, 'rag');
  assert.equal((await call('/api/admin/mcp', { method: 'POST', cookie: admin, body: { name: 'x', command: 'rm' } })).status, 404);
});
```

thêm vào **cuối** `dashboard/public/public.test.js`:

```js
test('Kết nối MCP: màu trạng thái', async () => {
  const { mcpKind } = await import('./views/mcp.js');
  assert.deepEqual(['Đang mở', 'Không phản hồi', 'Đã tắt', 'Máy ngoài — không kiểm'].map(mcpKind), ['ok', 'danger', 'idle', 'warn']);
});
```

- [ ] **Step 2: Chạy test, thấy hỏng**

Run: `node --test dashboard/lib/mcp-servers.test.js dashboard/routes/mcp.test.js dashboard/public/public.test.js`
Expected: FAIL — module chưa có.

- [ ] **Step 3: Viết `dashboard/lib/mcp-servers.js`**

```js
/**
 * Kết nối MCP (spec §18.6, chỉ Quản trị): các máy chủ MCP trong `mcp_servers` của config.yaml Hermes.
 * - Xem: tên, kiểu (http/stdio), đích rút gọn (máy:cổng, hoặc tên lệnh), bật/tắt, có mở cho thành viên không
 *   (ZALO_PUBLIC_MCP). KHÔNG BAO GIỜ trả `env`, `headers`, `args`, đường dẫn/chuỗi truy vấn của URL (hay chứa khoá).
 * - Trạng thái: chỉ dò TCP tới địa chỉ loopback (127.0.0.1/localhost); máy ngoài không dò (tránh biến dashboard
 *   thành cầu quét mạng). stdio: "chạy cùng trợ lý".
 * - Bật/tắt: sửa đúng dòng `mcp_servers.<tên>.enabled` (Hermes bỏ qua máy chủ có enabled: false) → cần khởi động
 *   lại trợ lý. KHÔNG có "thêm máy chủ mới" — thêm = chạy lệnh tuỳ ý trên máy chủ; dùng `hermes mcp install` ở máy.
 */
import { connect } from 'node:net';
import { basename } from 'node:path';
import { editConfigYaml, readConfigYaml } from './config-yaml.js';

export const SERVER_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const truthy = (v) => !(v === false || /^(false|0|no|off)$/i.test(String(v ?? '').trim()));

/** fnmatch đơn giản của Python (`*`, `?`) như `_mcp_open_to_members` của plugin. */
export function globMatch(pattern, text) {
  const re = new RegExp(`^${String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  return re.test(text);
}

/** Một mục mcp_servers → dạng an toàn để hiện. */
export function describeServer(name, cfg, publicPatterns = []) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  let transport = 'stdio'; let target = ''; let host = ''; let port = 0;
  if (c.url) {
    transport = 'http';
    try { const u = new URL(String(c.url)); host = u.hostname; port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80); target = `${u.protocol}//${u.host}`; } catch { target = '(địa chỉ hỏng)'; }
  } else if (c.command) target = basename(String(c.command)).slice(0, 60);
  return {
    name, transport, target, enabled: truthy(c.enabled ?? true), loopback: LOOPBACK.has(host),
    publicToMembers: publicPatterns.some((p) => globMatch(p, name) || globMatch(p, `mcp-${name}`)), host, port,
  };
}

const probeTcp = (host, port, timeoutMs = 1500) => new Promise((resolve) => {
  const s = connect({ host: host.replace(/^\[|\]$/g, ''), port });
  const done = (ok) => { s.destroy(); resolve(ok); };
  s.setTimeout(timeoutMs, () => done(false));
  s.once('connect', () => done(true));
  s.once('error', () => done(false));
});

export function createMcpServers({ configFile, publicMcp = () => '', probe = probeTcp }) {
  const patterns = () => String(publicMcp() || '').split(',').map((s) => s.trim()).filter(Boolean);
  const servers = () => {
    const m = readConfigYaml(configFile)?.mcp_servers;
    return m && typeof m === 'object' ? Object.entries(m).filter(([n]) => SERVER_NAME.test(n)) : [];
  };
  return {
    async list() {
      const pats = patterns();
      return Promise.all(servers().map(async ([name, cfg]) => {
        const { host, port, ...d } = describeServer(name, cfg, pats);
        let status = 'Chạy cùng trợ lý';
        if (!d.enabled) status = 'Đã tắt';
        else if (d.transport === 'http') status = d.loopback ? ((await probe(host, port)) ? 'Đang mở' : 'Không phản hồi') : 'Máy ngoài — không kiểm';
        return { ...d, status };
      }));
    },
    setEnabled(name, enabled) {
      if (!SERVER_NAME.test(String(name)) || !servers().some(([n]) => n === name)) throw err(404, 'Không có kết nối MCP này — tải lại trang.');
      if (typeof enabled !== 'boolean') throw err(400, 'Giá trị bật/tắt không hợp lệ.');
      return editConfigYaml(configFile, [{ path: ['mcp_servers', name, 'enabled'], value: enabled }]);
    },
  };
}
```

- [ ] **Step 4: Viết `dashboard/routes/mcp.js`** và nối

```js
// Kết nối MCP (spec §18.6) — chỉ Quản trị: xem, bật/tắt (cần khởi động lại trợ lý). Không có route thêm máy chủ.
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';

export function mcpRoutes({ mcpServers, restartFlags, activity }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const fail = (res, err) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status !== 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: 'Chưa đọc/ghi được config.yaml — thử lại, nếu vẫn lỗi hãy báo người cài đặt.' });
  };
  r.get('/admin/mcp', ...guard, async (req, res) => { try { res.json({ ok: true, servers: await mcpServers.list() }); } catch (err) { fail(res, err); } });
  r.put('/admin/mcp/:name', ...guard, async (req, res) => {
    try {
      const enabled = req.body?.enabled;
      if (mcpServers.setEnabled(req.params.name, enabled)) {
        restartFlags.mark('assistant', `Kết nối MCP: ${req.params.name}`);
        try { activity.append({ actor: req.user.username, action: enabled ? 'mcp_enable' : 'mcp_disable', detail: req.params.name }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
      }
      res.json({ ok: true, servers: await mcpServers.list() });
    } catch (err) { fail(res, err); }
  });
  return r;
}
```

`dashboard/app.js`: import + `if (deps.mcpServers) app.use('/api', mcpRoutes(deps));`.
`dashboard/server.js`: import + `mcpServers: createMcpServers({ configFile: paths.hermesConfigFile, publicMcp: () => readEnvKey(paths.hermesEnvFile, 'ZALO_PUBLIC_MCP') }),`.

- [ ] **Step 5: Trang Kết nối MCP** — tạo `dashboard/public/views/mcp.js`:

```js
// Kết nối MCP (spec §18.6, chỉ Quản trị): máy chủ MCP của trợ lý — xem, bật/tắt. Thêm mới chỉ làm trên máy chủ.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Live, Notice, PageHead, Spinner } from '../ui.js';
import { RestartBanner } from './restart-banner.js';

/** Màu nhãn trạng thái. */
export function mcpKind(status) {
  return { 'Đang mở': 'ok', 'Chạy cùng trợ lý': 'ok', 'Không phản hồi': 'danger', 'Đã tắt': 'idle' }[status] || 'warn';
}

export function Mcp() {
  const [list, setList] = useState(null);
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => { api('/api/admin/mcp').then((r) => setList(r.servers)).catch((e) => setMsg({ error: e.message })); }, []);
  async function toggle(s) {
    const enabled = !s.enabled;
    if (!confirm(`${enabled ? 'Bật' : 'Tắt'} kết nối ${s.name}? Cần khởi động lại trợ lý để áp dụng.`)) return;
    setBusy(s.name); setMsg({});
    try { setList((await api(`/api/admin/mcp/${encodeURIComponent(s.name)}`, { method: 'PUT', body: { enabled } })).servers); setVersion((v) => v + 1); } catch (e) { setMsg({ error: e.message }); } finally { setBusy(''); }
  }
  return html`<${PageHead} title="Kết nối MCP" sub="Dịch vụ bên ngoài trợ lý dùng làm công cụ (tra tài liệu, lịch, tệp…). Chỉ Quản trị." />
    <${RestartBanner} version=${version} />
    <${Notice} kind="info">Muốn thêm kết nối mới: người cài đặt chạy <span class="mono">${'hermes mcp install <tên>'}</span> trên máy chủ. Dashboard không thêm được vì việc đó chạy chương trình trên máy chủ.<//>
    <section class="card">
      <${Live} error=${msg.error} />
      ${!list && !msg.error ? html`<${Spinner} />` : null}
      ${list && !list.length ? html`<p class="muted">Trợ lý chưa có kết nối MCP nào.</p>` : null}
      <ul class="row-list">${(list || []).map((s) => html`<li key=${s.name} class="row-item">
        <span class="row-main"><strong>${s.name}</strong><small class="muted mono">${s.transport === 'http' ? s.target : `lệnh: ${s.target}`}</small>
          <small class="muted">${s.publicToMembers ? 'Thành viên nhóm dùng được (ZALO_PUBLIC_MCP)' : 'Chỉ chủ nhân dùng'}</small></span>
        <span class=${`badge badge-${mcpKind(s.status)}`}>${s.status}</span>
        <button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${() => toggle(s)}>${s.enabled ? 'Tắt' : 'Bật'}</button>
      </li>`)}</ul>
    </section>`;
}
```

- [ ] **Step 6: Chạy test, thấy xanh**

Run: `node --test dashboard/lib/mcp-servers.test.js dashboard/routes/mcp.test.js dashboard/public/public.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib/mcp-servers.js dashboard/lib/mcp-servers.test.js dashboard/routes/mcp.js dashboard/routes/mcp.test.js dashboard/public/views/mcp.js dashboard/app.js dashboard/server.js dashboard/public/public.test.js
git commit -m "feat(dashboard): trang Kết nối MCP — xem không lộ khoá, dò loopback, bật/tắt; không thêm máy chủ (giai đoạn 7B)"
```

---

### Task 8: Cấu hình — danh sách cài đặt an toàn + lời chào thành viên mới

**Files:**
- Create: `dashboard/lib/settings.js`, `dashboard/lib/settings.test.js`, `dashboard/routes/settings.js`, `dashboard/routes/settings.test.js`, `dashboard/public/views/settings.js`
- Modify: `dashboard/lib/env-file.js`, `dashboard/app.js`, `dashboard/server.js`, `dashboard/public/public.test.js`

**Interfaces:**
- Consumes: `writeEnvKey` (mở rộng ở đây), `editConfigYaml`, `readConfigYaml`, `restartFlags.mark`, `readWelcomeConfig`/`updateWelcomeGroup` (`zalo-welcome.js` gốc repo), `GROUP_ID`, `sidecar.groups()`.
- Produces: `env-file.js`: `SETTINGS_ENV_KEYS`, `EDITABLE_KEYS` gồm chúng, luật giá trị (`VALUE_RULES`, `SETTING_VALUE`), ghi trong ngoặc kép khi có khoảng trắng/chữ có dấu; `settings.js`: `SETTINGS` (13 mục), `validateSetting(def, v)`, `createSettings({ envFile, configFile, inherited }) → { view() → [{id, group, label, hint, type, …, key, value, source, restart}], save(values) → [{id, label, restart, before, after}] }`; API admin `GET|PUT /api/admin/settings`, `GET /api/admin/welcome`, `PUT /api/admin/welcome/:groupId`; activity `settings_update`, `welcome_update`; deps `settings`, `welcomeFile`. View: `Settings`, `parseInput`, `changedValues`, `SOURCE_LABELS`.

- [ ] **Step 1: Viết test** — tạo `dashboard/lib/settings.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { SETTINGS, createSettings, validateSetting } from './settings.js';

const ENV = 'OPENAI_API_KEY=sk-bimat\nZALO_FLOOD_THRESHOLD=8\nZALO_FRIEND_TOOLS=true\n';
const CONFIG = 'platforms:\n  zalo:\n    extra:\n      reply_only_tagged: false\n      owner_only_groups:\n      - "111"\n      bridge_token: bi-mat\n';

function setup(t, { env = ENV, config = CONFIG, inherited = {} } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'zd-set-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(join(d, '.env'), env);
  writeFileSync(join(d, 'config.yaml'), config);
  return { d, s: createSettings({ envFile: join(d, '.env'), configFile: join(d, 'config.yaml'), inherited }) };
}
const pick = (view, id) => view.find((x) => x.id === id);

test('danh sách cố định: không khoá bí mật nào; mỗi mục có kiểu, nhóm, đích khởi động lại', () => {
  for (const s of SETTINGS) {
    assert.doesNotMatch(s.env, /KEY|TOKEN|SECRET|PASSWORD/, s.env);
    assert.ok(['bool', 'int', 'enum', 'ids', 'names', 'patterns'].includes(s.type), s.id);
    assert.ok(s.restart.length && s.group && s.label, s.id);
  }
});

test('đọc đúng thứ tự ưu tiên của adapter: config.yaml thắng .env với khoá extraWins; .env thắng với cờ tag; mặc định', (t) => {
  const { s } = setup(t, { env: `${ENV}ZALO_GROUP_REPLY_ONLY_TAGGED=true\nZALO_OWNER_ONLY_GROUPS=999\n` });
  const v = s.view();
  assert.deepEqual([pick(v, 'replyOnlyTagged').value, pick(v, 'replyOnlyTagged').source], [true, 'env'], 'env khác rỗng đè extra.reply_only_tagged');
  assert.deepEqual([pick(v, 'ownerOnlyGroups').value, pick(v, 'ownerOnlyGroups').source], [['111'], 'config'], 'extra thắng .env');
  assert.deepEqual([pick(v, 'floodThreshold').value, pick(v, 'floodWindow').value, pick(v, 'floodWindow').source], [8, 15, 'default']);
  assert.equal(pick(v, 'friendTools').value, true);
  assert.doesNotMatch(JSON.stringify(v), /sk-bimat|bi-mat/);
});

test('lưu: ghi vào đúng nơi đang có hiệu lực, giữ dòng khác; không đổi thì không ghi; trả danh sách đổi + đích khởi động lại', (t) => {
  const { d, s } = setup(t);
  const changes = s.save({ floodThreshold: 10, ownerOnlyGroups: ['111', '333'], friendTools: true, kbPublicDirs: ['Năm 2026', 'Văn bản'] });
  assert.deepEqual(changes.map((c) => [c.id, c.restart]), [['floodThreshold', ['assistant']], ['ownerOnlyGroups', ['assistant']], ['kbPublicDirs', ['assistant']]]);
  const env = readFileSync(join(d, '.env'), 'utf8');
  assert.match(env, /^OPENAI_API_KEY=sk-bimat$/m);
  assert.match(env, /^ZALO_FLOOD_THRESHOLD=10$/m);
  assert.match(env, /^ZALO_KB_PUBLIC_DIRS="Năm 2026,Văn bản"$/m);
  assert.doesNotMatch(env, /ZALO_OWNER_ONLY_GROUPS/, 'khoá đang ở config.yaml thì sửa config.yaml');
  const y = YAML.parse(readFileSync(join(d, 'config.yaml'), 'utf8'));
  assert.deepEqual(y.platforms.zalo.extra.owner_only_groups, ['111', '333']);
  assert.equal(y.platforms.zalo.extra.bridge_token, 'bi-mat');
  assert.equal(pick(s.view(), 'kbPublicDirs').value.join('|'), 'Năm 2026|Văn bản');
});

test('kiểm giá trị: kiểu, giới hạn, ký tự; khoá ngoài danh sách bị từ chối, không ghi gì', (t) => {
  const { d, s } = setup(t);
  const def = (id) => SETTINGS.find((x) => x.id === id);
  assert.throws(() => validateSetting(def('floodThreshold'), 1), /từ 2 đến 50/);
  assert.throws(() => validateSetting(def('floodThreshold'), '8'), /số nguyên/);
  assert.throws(() => validateSetting(def('dmPolicy'), 'everyone'), /chọn lại/);
  assert.throws(() => validateSetting(def('ownerOnlyGroups'), ['12a']), /không hợp lệ/);
  assert.throws(() => validateSetting(def('kbPublicDirs'), ['..']), /không hợp lệ/);
  assert.throws(() => validateSetting(def('kbPublicDirs'), ['a"\nOPENAI_API_KEY=x']), /không hợp lệ/);
  assert.throws(() => validateSetting(def('publicMcp'), ['rag;rm']), /không hợp lệ/);
  assert.throws(() => s.save({ OPENAI_API_KEY: 'x' }), /không nằm trong danh sách/);
  assert.throws(() => s.save({ floodThreshold: 999 }), /từ 2 đến 50/);
  assert.equal(readFileSync(join(d, '.env'), 'utf8'), ENV);
});
```

tạo `dashboard/routes/settings.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSettings } from '../lib/settings.js';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

function withSettings(t) {
  const deps = makeDeps(t);
  writeFileSync(join(deps.dir, 'hermes.env'), 'TELEGRAM_BOT_TOKEN=bi-mat\n');
  writeFileSync(join(deps.dir, 'config.yaml'), 'platforms:\n  zalo:\n    extra:\n      dm_policy: owner-only\n');
  deps.settings = createSettings({ envFile: join(deps.dir, 'hermes.env'), configFile: join(deps.dir, 'config.yaml') });
  deps.welcomeFile = join(deps.dir, 'welcome.json');
  return deps;
}

test('Cấu hình: chỉ Quản trị; lưu đặt cờ chờ đúng đích + Nhật ký "cũ → mới"; khoá lạ 400; không bao giờ lộ khoá bí mật', async (t) => {
  const deps = withSettings(t);
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/settings', { cookie: owner })).status, 403);
  const admin = await loginAs(t, deps, call);
  const v = await call('/api/admin/settings', { cookie: admin });
  assert.doesNotMatch(JSON.stringify(v.json), /bi-mat|TELEGRAM/);
  const put = await call('/api/admin/settings', { method: 'PUT', cookie: admin, body: { values: { dmPolicy: 'open', historyDays: 90 } } });
  assert.equal(put.json.changed, 2);
  assert.match(readFileSync(join(deps.dir, 'config.yaml'), 'utf8'), /dm_policy: open/);
  assert.match(readFileSync(join(deps.dir, 'hermes.env'), 'utf8'), /^ZALO_HISTORY_RETENTION_DAYS=90$/m);
  const flags = deps.restartFlags.get();
  assert.deepEqual(flags.assistant.reasons, ['Cấu hình: Nhắn riêng khi chưa chọn ở Phân quyền Bot']);
  assert.deepEqual(flags.sidecar.reasons, ['Cấu hình: Giữ lịch sử trò chuyện (ngày)']);
  assert.match(deps.activity.list().find((e) => e.action === 'settings_update').detail, /owner-only → open/);
  assert.equal((await call('/api/admin/settings', { method: 'PUT', cookie: admin, body: { values: { TELEGRAM_BOT_TOKEN: 'x' } } })).status, 400);
});

test('Lời chào nhóm: liệt kê nhóm của bot; bật cần nội dung; giới hạn số; ghi data/welcome.json + Nhật ký', async (t) => {
  const deps = withSettings(t);
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  assert.deepEqual((await call('/api/admin/welcome', { cookie: admin })).json.groups.map((g) => [g.id, g.name, g.enabled]), [['200', 'Tổ Hoá', false]]);
  const body = { enabled: true, message: '', batchSize: 5, maxWaitMinutes: 15, name: 'Tổ Hoá' };
  assert.equal((await call('/api/admin/welcome/200', { method: 'PUT', cookie: admin, body })).status, 400);
  assert.equal((await call('/api/admin/welcome/200', { method: 'PUT', cookie: admin, body: { ...body, message: 'Chào mừng!', batchSize: 99 } })).status, 400);
  assert.equal((await call('/api/admin/welcome/200', { method: 'PUT', cookie: admin, body: { ...body, message: 'Chào mừng!' } })).status, 200);
  assert.equal(JSON.parse(readFileSync(deps.welcomeFile, 'utf8')).groups['200'].message, 'Chào mừng!');
  assert.equal(deps.activity.list().find((e) => e.action === 'welcome_update').detail, 'Tổ Hoá: bật');
});
```

thêm vào **cuối** `dashboard/public/public.test.js`:

```js
test('Cấu hình: chữ nhập thành giá trị đúng kiểu; chỉ gửi mục đã đổi', async () => {
  const { parseInput, changedValues } = await import('./views/settings.js');
  assert.equal(parseInput({ type: 'int' }, ' 12 '), 12);
  assert.ok(Number.isNaN(parseInput({ type: 'int' }, '12a')));
  assert.deepEqual(parseInput({ type: 'ids' }, '111, 222,,'), ['111', '222']);
  const list = [{ id: 'a', value: 6 }, { id: 'b', value: ['1'] }, { id: 'c', value: true }];
  assert.deepEqual(changedValues(list, { a: 6, b: ['1', '2'], c: false }), { b: ['1', '2'], c: false });
});
```

- [ ] **Step 2: Chạy test, thấy hỏng**

Run: `node --test dashboard/lib/settings.test.js dashboard/routes/settings.test.js dashboard/public/public.test.js`
Expected: FAIL — module chưa có.

- [ ] **Step 3: Mở rộng `dashboard/lib/env-file.js`** — thay dòng `export const EDITABLE_KEYS = new Set(['ZALO_ALLOWED_USERS']);` bằng:

```js
// Cấu hình (giai đoạn 7B, spec §18.6): khoá trong danh sách cho phép của trang Cấu hình — lib/settings.js kiểm giá trị.
export const SETTINGS_ENV_KEYS = [
  'ZALO_GROUP_REPLY_ONLY_TAGGED', 'ZALO_DM_POLICY', 'ZALO_FLOOD_THRESHOLD', 'ZALO_FLOOD_WINDOW_S', 'ZALO_FLOOD_MUTE_S',
  'ZALO_ACK_GESTURES', 'ZALO_AUTO_REACT', 'ZALO_FRIEND_TOOLS', 'ZALO_OWNER_ONLY_GROUPS', 'ZALO_CONFIRM_DANGEROUS',
  'ZALO_HISTORY_RETENTION_DAYS', 'ZALO_KB_PUBLIC_DIRS', 'ZALO_PUBLIC_MCP',
];
export const EDITABLE_KEYS = new Set(['ZALO_ALLOWED_USERS', ...SETTINGS_ENV_KEYS]);
// Giá trị ghi được: UID chủ nhân chỉ chữ số + dấu phẩy; khoá Cấu hình: chữ (cả có dấu), số, khoảng trắng, _ . , * ? : / -
// — không bao giờ có nháy, \, xuống dòng, # hay = nên không chèn được dòng/khoá khác.
const VALUE_RULES = { ZALO_ALLOWED_USERS: /^[0-9,]*$/ };
const SETTING_VALUE = /^[\p{L}\p{N} _.,*?:/-]*$/u;
const BARE_VALUE = /^[A-Za-z0-9_.,*?:/-]*$/;
```

Trong `writeEnvKey`, thay dòng kiểm `if (!/^[0-9,]*$/.test(value)) throw …` (và câu chú thích "`value` chỉ được chứa chữ số và dấu phẩy…") bằng:

```js
  const rule = VALUE_RULES[key] || SETTING_VALUE;
  if (typeof value !== 'string' || !rule.test(value)) {
    throw new Error(key === 'ZALO_ALLOWED_USERS' ? 'env-file: giá trị chỉ được gồm chữ số và dấu phẩy' : `env-file: giá trị của ${key} có ký tự không cho phép`);
  }
  const rendered = BARE_VALUE.test(value) ? value : `"${value}"`;
```

và hai chỗ ghi `` `${key}=${value}` `` thành `` `${key}=${rendered}` ``.

- [ ] **Step 4: Viết `dashboard/lib/settings.js`**

```js
/**
 * Cấu hình (spec §18.6, chỉ Quản trị): danh sách CỐ ĐỊNH các cài đặt an toàn của bot. Không bao giờ có khoá bí mật,
 * không bao giờ sửa được khoá ngoài danh sách. Mỗi mục biết:
 *  - đọc/ghi ở đâu: `.env` của Hermes (env-file.js) hoặc `platforms.zalo.extra` của config.yaml (config-yaml.js),
 *    đúng thứ tự ưu tiên adapter đọc (extraWins: config.yaml thắng .env; ngược lại .env thắng);
 *  - kiểu + giới hạn để kiểm giá trị;
 *  - cần khởi động lại gì (trợ lý / kết nối Zalo) — mọi khoá ở đây adapter/sidecar đọc lúc khởi động.
 * Ghi vào đúng nơi đang có hiệu lực: khoá đang nằm trong config.yaml thì sửa config.yaml, còn lại sửa .env.
 */
import { parseEnv } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { writeEnvKey } from './env-file.js';
import { editConfigYaml, readConfigYaml } from './config-yaml.js';

const A = ['assistant']; const S = ['sidecar']; const AS = ['assistant', 'sidecar'];
export const SETTINGS = [
  { id: 'replyOnlyTagged', group: 'Trả lời', label: 'Trong nhóm chỉ trả lời khi được tag', hint: 'Mặc định cho mọi nhóm; từng nhóm vẫn chỉnh riêng ở Phân quyền Bot.', type: 'bool', env: 'ZALO_GROUP_REPLY_ONLY_TAGGED', extra: 'reply_only_tagged', extraWins: false, def: true, restart: A },
  { id: 'dmPolicy', group: 'Trả lời', label: 'Nhắn riêng khi chưa chọn ở Phân quyền Bot', hint: '"Chỉ chủ nhân" hoặc "Mọi người". Mục Nhắn riêng ở Phân quyền Bot (nếu đã lưu) thắng cài đặt này.', type: 'enum', options: [{ value: 'owner-only', label: 'Chỉ chủ nhân' }, { value: 'open', label: 'Mọi người' }], env: 'ZALO_DM_POLICY', extra: 'dm_policy', extraWins: true, def: 'owner-only', restart: A },
  { id: 'ackGestures', group: 'Trả lời', label: 'Báo đã xem khi nhận tin', type: 'bool', env: 'ZALO_ACK_GESTURES', extra: 'ack_gestures', extraWins: true, def: true, restart: A },
  { id: 'autoReact', group: 'Trả lời', label: 'Thả cảm xúc tự động', type: 'bool', env: 'ZALO_AUTO_REACT', extra: 'auto_react', extraWins: true, def: true, restart: A },
  { id: 'ownerOnlyGroups', group: 'Trả lời', label: 'Nhóm chỉ chủ nhân gọi được bot', hint: 'Người khác tag bot thì bot im, tin vẫn được lưu làm ngữ cảnh. Chọn nhóm từ danh sách.', type: 'ids', max: 50, env: 'ZALO_OWNER_ONLY_GROUPS', extra: 'owner_only_groups', extraWins: true, def: [], restart: A },
  { id: 'floodThreshold', group: 'Chống nhắn dồn', label: 'Số tin tối đa trong một khoảng', type: 'int', min: 2, max: 50, env: 'ZALO_FLOOD_THRESHOLD', def: 6, restart: A },
  { id: 'floodWindow', group: 'Chống nhắn dồn', label: 'Khoảng tính (giây)', type: 'int', min: 5, max: 600, env: 'ZALO_FLOOD_WINDOW_S', def: 15, restart: A },
  { id: 'floodMute', group: 'Chống nhắn dồn', label: 'Bỏ qua người nhắn dồn trong (giây)', type: 'int', min: 10, max: 3600, env: 'ZALO_FLOOD_MUTE_S', def: 90, restart: A },
  { id: 'friendTools', group: 'Kết bạn và an toàn', label: 'Cho chủ nhân nhờ bot kết bạn, lập nhóm với người lạ', type: 'bool', env: 'ZALO_FRIEND_TOOLS', def: false, restart: AS },
  { id: 'confirmDangerous', group: 'Kết bạn và an toàn', label: 'Bắt chủ nhân gửi mã xác nhận trước thao tác nguy hiểm', hint: 'Chặn thêm trường hợp tài liệu/trang web bot đọc có cài lệnh ẩn.', type: 'bool', env: 'ZALO_CONFIRM_DANGEROUS', def: false, restart: A },
  { id: 'kbPublicDirs', group: 'Tài liệu và MCP', label: 'Thư mục kho tài liệu mở cho mọi người', hint: 'Tên thư mục cấp 1 trong kho, cách nhau bằng dấu phẩy. Để trống = cả kho.', type: 'names', max: 20, env: 'ZALO_KB_PUBLIC_DIRS', def: [], restart: A },
  { id: 'publicMcp', group: 'Tài liệu và MCP', label: 'Kết nối MCP thành viên được dùng', hint: 'Tên kết nối (được dùng * và ?). Mở cho thành viên là cho người ngoài dùng tài nguyên của chủ bot — cân nhắc kỹ.', type: 'patterns', max: 20, env: 'ZALO_PUBLIC_MCP', def: [], restart: A, confirm: true },
  { id: 'historyDays', group: 'Lưu trữ', label: 'Giữ lịch sử trò chuyện (ngày)', type: 'int', min: 30, max: 3650, env: 'ZALO_HISTORY_RETENTION_DAYS', def: 365, restart: S },
];

const err = (message) => Object.assign(new Error(message), { statusCode: 400 });
const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
const list = (v) => (Array.isArray(v) ? v.map(String) : String(v ?? '').split(',')).map((s) => s.trim()).filter(Boolean);

/** Giá trị thô (chuỗi .env hoặc giá trị YAML) → giá trị đúng kiểu của mục. */
function coerce(def, raw) {
  if (raw === undefined || raw === null || raw === '') return def.def;
  if (def.type === 'bool') return typeof raw === 'boolean' ? raw : truthy(raw);
  if (def.type === 'int') { const n = Number(raw); return Number.isInteger(n) ? n : def.def; }
  if (def.type === 'enum') { const s = String(raw).trim().toLowerCase(); return def.options.some((o) => o.value === s) ? s : def.def; }
  return list(raw);
}

/** Kiểm giá trị người dùng gửi lên; trả giá trị đã chuẩn hoá hoặc ném lỗi 400 có câu dễ hiểu. */
export function validateSetting(def, v) {
  if (def.type === 'bool') { if (typeof v !== 'boolean') throw err(`${def.label}: chọn bật hoặc tắt.`); return v; }
  if (def.type === 'int') {
    if (!Number.isInteger(v) || v < def.min || v > def.max) throw err(`${def.label}: nhập số nguyên từ ${def.min} đến ${def.max}.`);
    return v;
  }
  if (def.type === 'enum') { if (!def.options.some((o) => o.value === v)) throw err(`${def.label}: chọn lại.`); return v; }
  if (!Array.isArray(v) || v.length > def.max) throw err(`${def.label}: tối đa ${def.max} mục.`);
  const rule = { ids: /^\d{1,32}$/, names: /^[\p{L}\p{N} _.-]{1,60}$/u, patterns: /^[A-Za-z0-9_.*?-]{1,64}$/ }[def.type];
  const out = [...new Set(v.map((x) => String(x).trim()).filter(Boolean))];
  for (const x of out) if (!rule.test(x) || (def.type === 'names' && (x === '.' || x === '..'))) throw err(`${def.label}: "${x.slice(0, 30)}" không hợp lệ.`);
  return out;
}

/** `inherited`: giá trị các khoá này trong môi trường dịch vụ, chụp trước khi nạp .env (như makeDmEnv). */
export function createSettings({ envFile, configFile, inherited = {} }) {
  function envValues() {
    try { return existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8').replace(/^﻿/, '')) : {}; } catch { return {}; }
  }
  function resolve(def, env, extra) {
    const inExtra = def.extra && extra && Object.hasOwn(extra, def.extra);
    const envRaw = Object.hasOwn(env, def.env) ? env[def.env] : inherited[def.env];
    if (def.extraWins && inExtra) return { value: coerce(def, extra[def.extra]), source: 'config' };
    if (envRaw !== undefined && String(envRaw).trim() !== '') return { value: coerce(def, envRaw), source: 'env' };
    if (inExtra) return { value: coerce(def, extra[def.extra]), source: 'config' };
    return { value: def.def, source: 'default' };
  }
  const read = () => {
    const env = envValues();
    const extra = readConfigYaml(configFile)?.platforms?.zalo?.extra || {};
    return SETTINGS.map((d) => ({ ...d, ...resolve(d, env, extra) }));
  };
  return {
    view: () => read().map(({ env, extra, extraWins, ...rest }) => ({ ...rest, key: env })),
    /** Lưu các mục đổi; trả [{ id, label, restart, before, after }] của mục thật sự đổi. */
    save(values) {
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw err('Dữ liệu không hợp lệ — tải lại trang.');
      const current = new Map(read().map((s) => [s.id, s]));
      const changes = [];
      for (const [id, raw] of Object.entries(values)) {
        const cur = current.get(id);
        if (!cur) throw err('Có mục không nằm trong danh sách cài đặt — tải lại trang.');
        const v = validateSetting(cur, raw);
        if (JSON.stringify(v) === JSON.stringify(cur.value)) continue;
        changes.push({ cur, v });
      }
      const yamlEdits = changes.filter((c) => c.cur.source === 'config').map((c) => ({ path: ['platforms', 'zalo', 'extra', c.cur.extra], value: c.v }));
      if (yamlEdits.length) editConfigYaml(configFile, yamlEdits);
      for (const c of changes.filter((x) => x.cur.source !== 'config')) {
        writeEnvKey(envFile, c.cur.env, Array.isArray(c.v) ? c.v.join(',') : String(c.v));
      }
      return changes.map((c) => ({ id: c.cur.id, label: c.cur.label, restart: c.cur.restart, before: c.cur.value, after: c.v }));
    },
  };
}
```

- [ ] **Step 5: Viết `dashboard/routes/settings.js`** và nối

```js
// Cấu hình (spec §18.6) — chỉ Quản trị: cài đặt trong danh sách cố định (lib/settings.js) + lời chào thành viên mới
// theo nhóm (data/welcome.json của kết nối Zalo, đọc lại mỗi lần có người vào nhóm nên có hiệu lực ngay).
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';
import { readWelcomeConfig, updateWelcomeGroup } from '../../zalo-welcome.js';
import { GROUP_ID } from '../lib/permissions.js';

const show = (v) => (Array.isArray(v) ? (v.join(', ') || 'trống') : typeof v === 'boolean' ? (v ? 'bật' : 'tắt') : String(v));

export function settingsRoutes({ settings, restartFlags, activity, welcomeFile, sidecar }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const fail = (res, err, fallback) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status >= 400 && status < 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: fallback });
  };
  const log = (req, action, detail) => { try { activity.append({ actor: req.user.username, action, detail }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); } };

  r.get('/admin/settings', ...guard, (req, res) => { try { res.json({ ok: true, settings: settings.view() }); } catch (err) { fail(res, err, 'Chưa đọc được cài đặt.'); } });
  r.put('/admin/settings', ...guard, (req, res) => {
    try {
      const changes = settings.save(req.body?.values);
      for (const c of changes) for (const target of c.restart) restartFlags.mark(target, `Cấu hình: ${c.label}`);
      if (changes.length) log(req, 'settings_update', changes.map((c) => `${c.label}: ${show(c.before)} → ${show(c.after)}`).join(' · '));
      res.json({ ok: true, changed: changes.length, settings: settings.view() });
    } catch (err) { fail(res, err, 'Chưa lưu được cài đặt — thử lại, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });

  r.get('/admin/welcome', ...guard, async (req, res) => {
    try {
      const conf = readWelcomeConfig(welcomeFile).groups || {};
      let groups = [];
      try { groups = await sidecar.groups(); } catch { /* chỉ hiện nhóm đã có cấu hình */ }
      const ids = [...new Set([...groups.map((g) => String(g.id ?? '')), ...Object.keys(conf)])].filter((id) => GROUP_ID.test(id));
      const name = (id) => groups.find((g) => String(g.id) === id)?.name || conf[id]?.name || `Nhóm ${id.slice(-4)}`;
      res.json({ ok: true, groups: ids.map((id) => ({ id, name: name(id), enabled: Boolean(conf[id]?.enabled), message: conf[id]?.message || '',
        batchSize: conf[id]?.batchSize ?? 5, maxWaitMinutes: conf[id]?.maxWaitMinutes ?? 15 })) });
    } catch (err) { fail(res, err, 'Chưa đọc được lời chào.'); }
  });
  r.put('/admin/welcome/:groupId', ...guard, (req, res) => {
    const { groupId } = req.params;
    if (!GROUP_ID.test(groupId)) return res.status(400).json({ ok: false, error: 'Nhóm không hợp lệ — chọn lại.' });
    const b = req.body || {};
    if (typeof b.enabled !== 'boolean' || typeof b.message !== 'string' || b.message.length > 1500
      || !Number.isInteger(b.batchSize) || b.batchSize < 1 || b.batchSize > 20 || !Number.isInteger(b.maxWaitMinutes) || b.maxWaitMinutes < 1 || b.maxWaitMinutes > 1440) {
      return res.status(400).json({ ok: false, error: 'Lời chào ≤ 1500 ký tự, gom 1–20 người, chờ 1–1440 phút — sửa lại rồi lưu.' });
    }
    try {
      const g = updateWelcomeGroup(groupId, { enabled: b.enabled, message: b.message, name: String(b.name || '').slice(0, 200), batchSize: b.batchSize, maxWaitMinutes: b.maxWaitMinutes }, welcomeFile);
      log(req, 'welcome_update', `${b.name || groupId}: ${g.enabled ? 'bật' : 'tắt'}`);
      res.json({ ok: true, group: g });
    } catch (err) {
      if (/Cần nội dung/.test(err?.message)) return res.status(400).json({ ok: false, error: 'Cần nội dung lời chào trước khi bật.' });
      fail(res, err, 'Chưa lưu được lời chào.');
    }
  });
  return r;
}
```

`dashboard/app.js`: import + `if (deps.settings) app.use('/api', settingsRoutes(deps));`.
`dashboard/server.js`: `import { createSettings } from './lib/settings.js';`, `import { SETTINGS_ENV_KEYS } from './lib/env-file.js';` (gộp với import `readEnvKey` sẵn có); `buildDeps({ …, inheritedDm = {}, inheritedSettings = {} } = {})`; trong `buildDeps`:

```js
    settings: createSettings({ envFile: paths.hermesEnvFile, configFile: paths.hermesConfigFile, inherited: inheritedSettings }),
    // Lời chào thành viên mới: cùng tệp kết nối Zalo đọc (zalo-welcome.js); ZALO_WELCOME_FILE của kết nối Zalo thắng.
    welcomeFile: env.ZALO_WELCOME_FILE || join(paths.sidecarRoot, 'data', 'welcome.json'),
```

trong `main()`, ngay sau dòng `inheritedDm` (trước khi nạp `.env`):

```js
  const inheritedSettings = Object.fromEntries(SETTINGS_ENV_KEYS.map((k) => [k, process.env[k]]));
```

và `buildDeps({ sidecarRoot, inheritedReplyOnlyTagged, inheritedOwners, inheritedDm, inheritedSettings })`.

- [ ] **Step 6: Trang Cấu hình** — tạo `dashboard/public/views/settings.js`:

```js
// Cấu hình (spec §18.6, chỉ Quản trị): cài đặt an toàn trong danh sách cố định + lời chào thành viên mới theo nhóm.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Live, PageHead, SaveBar, Spinner, Toggle } from '../ui.js';
import { RestartBanner } from './restart-banner.js';

/** Chữ trong ô nhập → giá trị gửi lên theo kiểu của mục. */
export function parseInput(s, text) {
  if (s.type === 'int') return /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;
  if (['ids', 'names', 'patterns'].includes(s.type)) return text.split(',').map((x) => x.trim()).filter(Boolean);
  return text;
}

/** Mục đã sửa so với giá trị đã lưu: { id: value }. */
export function changedValues(list, draft) {
  return Object.fromEntries(list.filter((s) => JSON.stringify(draft[s.id]) !== JSON.stringify(s.value)).map((s) => [s.id, draft[s.id]]));
}

export const SOURCE_LABELS = { env: 'Cài đặt của trợ lý (.env)', config: 'config.yaml', default: 'Mặc định' };

function Field({ s, value, onChange }) {
  const id = `set-${s.id}`;
  const note = html`<small class="muted">${s.hint ? `${s.hint} ` : ''}Đang lấy từ: ${SOURCE_LABELS[s.source]} · đổi xong cần khởi động lại ${s.restart.includes('sidecar') ? (s.restart.includes('assistant') ? 'trợ lý và kết nối Zalo' : 'kết nối Zalo') : 'trợ lý'}.</small>`;
  if (s.type === 'bool') return html`<${Toggle} id=${id} checked=${value} onChange=${onChange} label=${s.label} hint=${note} />`;
  if (s.type === 'enum') return html`<div class="field"><label for=${id}>${s.label}</label>
    <select id=${id} value=${value} onChange=${(e) => onChange(e.currentTarget.value)}>${s.options.map((o) => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}</select>${note}</div>`;
  const text = Array.isArray(value) ? value.join(', ') : Number.isNaN(value) ? '' : String(value);
  return html`<div class="field"><label for=${id}>${s.label}${s.type === 'int' ? ` (${s.min}–${s.max})` : ''}</label>
    <input id=${id} inputmode=${s.type === 'int' ? 'numeric' : undefined} value=${text} onChange=${(e) => onChange(parseInput(s, e.currentTarget.value))} />${note}</div>`;
}

function Welcome() {
  const [groups, setGroups] = useState(null);
  const [msg, setMsg] = useState({});
  useEffect(() => { api('/api/admin/welcome').then((r) => setGroups(r.groups)).catch((e) => setMsg({ error: e.message })); }, []);
  const set = (id, patch) => setGroups(groups.map((g) => (g.id === id ? { ...g, ...patch, dirty: true } : g)));
  async function save(g) {
    setMsg({});
    try { await api(`/api/admin/welcome/${g.id}`, { method: 'PUT', body: { enabled: g.enabled, message: g.message, batchSize: g.batchSize, maxWaitMinutes: g.maxWaitMinutes, name: g.name } }); set(g.id, { dirty: false }); setMsg({ ok: `Đã lưu lời chào cho ${g.name}.` }); } catch (e) { setMsg({ error: e.message }); }
  }
  return html`<section class="card"><h2>Lời chào thành viên mới</h2>
    <p class="muted small">Bot gom người mới vào nhóm rồi chào một lần (tag tất cả). Có hiệu lực ngay, không cần khởi động lại.</p>
    <${Live} error=${msg.error} ok=${msg.ok} />
    ${!groups && !msg.error ? html`<${Spinner} />` : null}
    ${(groups || []).map((g) => html`<details key=${g.id} class="perm-box"><summary>${g.name} <span class=${`badge ${g.enabled ? 'badge-ok' : 'badge-idle'}`}>${g.enabled ? 'Đang chào' : 'Tắt'}</span></summary>
      <${Toggle} id=${`wel-${g.id}`} checked=${g.enabled} onChange=${(v) => set(g.id, { enabled: v })} label="Chào thành viên mới" />
      <div class="field"><label for=${`welm-${g.id}`}>Lời chào</label><textarea id=${`welm-${g.id}`} rows="3" maxlength="1500" value=${g.message} onInput=${(e) => set(g.id, { message: e.currentTarget.value })}></textarea></div>
      <div class="grid grid-2">
        <div class="field"><label for=${`welb-${g.id}`}>Gom đủ (người)</label><input id=${`welb-${g.id}`} type="number" min="1" max="20" value=${g.batchSize} onInput=${(e) => set(g.id, { batchSize: Number(e.currentTarget.value) })} /></div>
        <div class="field"><label for=${`welw-${g.id}`}>Chờ tối đa (phút)</label><input id=${`welw-${g.id}`} type="number" min="1" max="1440" value=${g.maxWaitMinutes} onInput=${(e) => set(g.id, { maxWaitMinutes: Number(e.currentTarget.value) })} /></div>
      </div>
      <button type="button" class="btn btn-primary btn-sm" disabled=${!g.dirty} onClick=${() => save(g)}>Lưu lời chào</button>
    </details>`)}
  </section>`;
}

export function Settings() {
  const [list, setList] = useState(null);
  const [draft, setDraft] = useState({});
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const take = (r) => { setList(r.settings); setDraft(Object.fromEntries(r.settings.map((s) => [s.id, s.value]))); };
  useEffect(() => { api('/api/admin/settings').then(take).catch((e) => setMsg({ error: e.message })); }, []);
  const head = html`<${PageHead} title="Cấu hình" sub="Cài đặt chung của bot trong danh sách an toàn. Khoá bí mật và cài đặt khác chỉ sửa được trên máy chủ. Chỉ Quản trị." />`;
  if (!list) return html`${head}<${Live} error=${msg.error} />${msg.error ? null : html`<${Spinner} />`}`;
  const changes = changedValues(list, draft);
  const count = Object.keys(changes).length;
  async function save(e) {
    e.preventDefault();
    if (changes.publicMcp && !confirm('Mở kết nối MCP cho thành viên nghĩa là người ngoài dùng được tài nguyên của chủ bot qua kết nối đó. Tiếp tục?')) return;
    setBusy(true); setMsg({});
    try { take(await api('/api/admin/settings', { method: 'PUT', body: { values: changes } })); setVersion((v) => v + 1); setMsg({ ok: 'Đã lưu — bấm "Khởi động lại ngay" ở dải vàng để áp dụng.' }); } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }
  const groups = [...new Set(list.map((s) => s.group))];
  return html`${head}<${RestartBanner} version=${version} />
    <form class="card" onSubmit=${save} novalidate>
      ${groups.map((g) => html`<fieldset key=${g} class="mem-block"><legend><h3>${g}</h3></legend>
        ${list.filter((s) => s.group === g).map((s) => html`<${Field} key=${s.id} s=${s} value=${draft[s.id]} onChange=${(v) => setDraft({ ...draft, [s.id]: v })} />`)}
      </fieldset>`)}
      <${SaveBar} count=${count} busy=${busy} canSave=${count > 0} onUndo=${() => take({ settings: list })} msg=${msg} />
    </form>
    <${Welcome} />`;
}
```

- [ ] **Step 7: Chạy test, thấy xanh**

Run: `node --test dashboard/lib/settings.test.js dashboard/routes/settings.test.js dashboard/lib/env-file.test.js dashboard/lib/owners.test.js dashboard/routes/owners.test.js dashboard/server.test.js dashboard/public/public.test.js`
Expected: PASS (test cũ của Chủ nhân bot vẫn xanh: UID chỉ chữ số + dấu phẩy).

- [ ] **Step 8: Commit**

```bash
git add dashboard/lib/settings.js dashboard/lib/settings.test.js dashboard/routes/settings.js dashboard/routes/settings.test.js dashboard/public/views/settings.js dashboard/lib/env-file.js dashboard/app.js dashboard/server.js dashboard/public/public.test.js
git commit -m "feat(dashboard): trang Cấu hình — danh sách cài đặt an toàn, ghi đúng nơi có hiệu lực, lời chào nhóm (giai đoạn 7B)"
```

---

### Task 9: Thanh bên 7B + phát hành v1.27.0

**Files:**
- Modify: `dashboard/public/views/shell.js`, `dashboard/public/ui.js`, `dashboard/public/style.css`, `dashboard/public/public.test.js`, `dashboard/lib/audit-feed.js`, `dashboard/lib/audit-feed.test.js`, `README.vi.md`, `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `hermes-plugin/zalo/plugin.yaml`, `hermes-plugin/zalo_tools/plugin.yaml`

**Interfaces:**
- Consumes: view `Agent`, `Tools`, `Trace`, `Mcp`, `Settings` (Task 3, 5–8); mọi tên hành động 7B.
- Produces: route `/agent`, `/tools`, `/trace`, `/mcp`, `/settings` (đều `admin: true`); biểu tượng `eye`; nhãn Nhật ký 7B.

- [ ] **Step 1: Viết test** — `dashboard/public/public.test.js`, trong test `thanh điều hướng điện thoại…` đổi danh sách `admin.more`:

```js
  assert.deepEqual(admin.more.map((i) => i.path), ['/contacts', '/schedules', '/memory', '/kb', '/insight', '/second-brain', '/mcp',
    '/agent', '/tools', '/trace', '/audit', '/brand', '/health', '/settings', '/users', '/owners', '/alerts', '/profile']);
```

trong test `thanh bên: 5 nhóm theo mẫu…`, dòng `admin[2]` thành:

```js
  assert.deepEqual(admin[2].items.map((i) => i.text), ['Trí nhớ', 'Kho tri thức', 'Insight nhóm', 'Second brain', 'Kết nối MCP']);
  assert.deepEqual(admin[3].items.map((i) => i.text), ['Tài khoản Zalo', 'Agent', 'Công cụ', 'Theo dõi agent', 'Nhật ký', 'Thương hiệu', 'Sức khoẻ máy chủ', 'Cấu hình']);
```

(danh sách `owner.more` giữ nguyên — Chủ bot không thấy mục 7B nào.) `dashboard/lib/audit-feed.test.js` thêm vào cuối:

```js
test('giai đoạn 7B: mọi hành động mới đều có nhãn tiếng Việt trong Nhật ký', () => {
  for (const action of ['agent_model', 'agent_reasoning', 'agent_soul', 'agent_soul_restore', 'tools_off', 'mcp_enable', 'mcp_disable', 'settings_update', 'welcome_update']) {
    assert.ok(ACTION_LABELS[action], action);
  }
});
```

- [ ] **Step 2: Chạy test, thấy hỏng**

Run: `node --test dashboard/public/public.test.js dashboard/lib/audit-feed.test.js`
Expected: FAIL — danh sách thanh bên thiếu mục 7B; `agent_model` chưa có nhãn.

- [ ] **Step 3: Thanh bên** — `dashboard/public/views/shell.js`: import `Agent`, `Tools`, `Trace`, `Mcp`, `Settings` (từ `./agent.js`, `./tools.js`, `./trace.js`, `./mcp.js`, `./settings.js`); `ROUTES` sau `'/second-brain'`:

```js
  '/mcp': { view: Mcp, admin: true },
  '/agent': { view: Agent, admin: true },
  '/tools': { view: Tools, admin: true },
  '/trace': { view: Trace, admin: true },
  '/settings': { view: Settings, admin: true },
```

nhóm "Dữ liệu" thêm cuối `{ path: '/mcp', text: 'Kết nối MCP', icon: 'plug', admin: true },`; nhóm "Hệ thống" thành:

```js
  { label: 'Hệ thống', items: [
    { path: '/zalo', text: 'Tài khoản Zalo', icon: 'phone' },
    { path: '/agent', text: 'Agent', icon: 'bot', admin: true },
    { path: '/tools', text: 'Công cụ', icon: 'tool', admin: true },
    { path: '/trace', text: 'Theo dõi agent', icon: 'eye', admin: true },
    { path: '/audit', text: 'Nhật ký', icon: 'list' },
    { path: '/brand', text: 'Thương hiệu', icon: 'image' },
    { path: '/health', text: 'Sức khoẻ máy chủ', icon: 'activity' },
    { path: '/settings', text: 'Cấu hình', icon: 'settings', admin: true },
  ] },
```

`SHORT` thêm `'/trace': 'Theo dõi', '/second-brain': 'Second brain', '/mcp': 'MCP',`. `dashboard/public/ui.js` thêm `eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zm11 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',`. `dashboard/public/style.css`, sau khối `/* Second brain */`:

```css
/* Giai đoạn 7B: dải chờ khởi động lại, Agent, Theo dõi agent */
.restart-banner { margin-bottom: 16px; }
.restart-banner p { margin: 0 0 8px; }
.soul-edit { width: 100%; min-height: 280px; font-size: 13.5px; line-height: 1.5; }
.trace-box { flex: 1 1 100%; margin-top: 6px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; }
.trace-turns { list-style: none; margin: 0; padding: 0; }
.trace-turn + .trace-turn { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border); }
.trace-turn p { margin: 2px 0; overflow-wrap: anywhere; }
.trace-tools { margin: 4px 0; padding-left: 18px; }
.trace-tools li { margin: 2px 0; overflow-wrap: anywhere; }
```

- [ ] **Step 4: Nhãn Nhật ký** — `dashboard/lib/audit-feed.js`, cuối `ACTION_LABELS`:

```js
  // Giai đoạn 7B (spec §18.6)
  agent_model: 'Đổi model của trợ lý',
  agent_reasoning: 'Đổi mức suy nghĩ của trợ lý',
  agent_soul: 'Sửa tính cách của trợ lý',
  agent_soul_restore: 'Khôi phục tính cách của trợ lý',
  tools_off: 'Bật/tắt công cụ với người ngoài',
  mcp_enable: 'Bật kết nối MCP',
  mcp_disable: 'Tắt kết nối MCP',
  settings_update: 'Đổi cấu hình bot',
  welcome_update: 'Đổi lời chào thành viên mới',
```

- [ ] **Step 5: Phiên bản + tài liệu**
  - `package.json` + 2 chỗ đầu `package-lock.json`: `1.26.0` → `1.27.0`; hai `plugin.yaml`: `version: 1.27.0`.
  - `CHANGELOG.md`, trên `[1.26.0]`:

```markdown
## [1.27.0] — 2026-10-08

### Thêm (chỉ Quản trị)

- **Agent**: đổi model (hiệu lực ngay, như /model), mức suy nghĩ, tính cách SOUL.md — có lịch sử 30 bản + bản gốc, khôi phục một chạm.
- **Công cụ**: mọi công cụ Zalo, ai dùng được, nút nào ở Phân quyền Bot điều khiển; tắt riêng từng công cụ công khai với người ngoài (`permissions.json` mục `tools.off`, hiệu lực ngay).
- **Theo dõi agent**: phiên của trợ lý (Zalo, việc hẹn giờ), từng lượt, công cụ đã gọi (tham số đã che), thời gian, token và model.
- **Kết nối MCP**: danh sách máy chủ MCP, trạng thái, bật/tắt. Thêm mới vẫn làm trên máy chủ (`hermes mcp install`).
- **Cấu hình**: 13 cài đặt an toàn (tag, nhắn riêng, chống nhắn dồn, nhóm chỉ chủ nhân, kết bạn, mã xác nhận, kho tài liệu, MCP cho thành viên, giữ lịch sử…) và lời chào thành viên mới theo nhóm.
- Dải vàng "cần khởi động lại" dùng chung + nút khởi động lại kèm lý do trong Nhật ký.

### An toàn

- config.yaml sửa theo dòng, kiểm lại toàn tệp trước khi ghi, `.bak`. `.env` chỉ khoá trong danh sách, giá trị không chèn được dòng khác. Không route nào trả khoá; dò MCP chỉ loopback; không có đường thêm máy chủ MCP.
```

  - `README.vi.md`: bảng 5 trang Hệ thống (chỉ Quản trị), danh sách Cấu hình, ghi chú "đổi model có hiệu lực ngay, phần khác cần khởi động lại", lệnh kiểm `config-yaml.test.js` trên VPS. `README.md`: đoạn tóm tắt tiếng Anh.

- [ ] **Step 6: Chạy toàn bộ test**

Run: `HERMES_HOME=E:/Hermes npm test`
Expected: JS PASS (≈ 734), Python xanh (≈ 428).

- [ ] **Step 7: Kiểm tay (Lăng Tiêu, rồi Uyển Nhi sau triển khai)**
  1. Chủ bot: không thấy mục 7B nào; gõ `#/agent` → "Không có quyền"; gọi `/api/admin/settings` → 403.
  2. Agent: đổi model → nhắn bot `/model` thấy model mới (không khởi động lại); sửa SOUL.md → dải vàng → Khởi động lại ngay → bot xưng hô theo tính cách mới ở phiên mới; khôi phục "bản gốc".
  3. Công cụ: tắt `zalo_web_search` → thành viên nhờ tra web trong nhóm → bot nói chưa làm được; chủ nhân vẫn tra được; lưu Phân quyền nhóm → vẫn tắt.
  4. Theo dõi agent: mở phiên nhóm vừa chat → thấy lượt, công cụ, tham số chỉ có tên khoá.
  5. Kết nối MCP (VPS): `rag` "Đang mở"; tắt → khởi động lại → công cụ rag biến mất; bật lại.
  6. Cấu hình: đổi "Số tin tối đa" → `.env` có dòng mới, `.env.bak` có bản cũ; đổi "Nhóm chỉ chủ nhân" trên VPS → sửa `config.yaml` (đang ở `extra`), `config.yaml.bak` có; lời chào nhóm thử với tài khoản phụ vào nhóm.

- [ ] **Step 8: Commit**

```bash
git add dashboard/public/views/shell.js dashboard/public/ui.js dashboard/public/style.css dashboard/public/public.test.js dashboard/lib/audit-feed.js dashboard/lib/audit-feed.test.js README.vi.md README.md CHANGELOG.md package.json package-lock.json hermes-plugin/zalo/plugin.yaml hermes-plugin/zalo_tools/plugin.yaml
git commit -m "release: v1.27.0 — dashboard giai đoạn 7B: Agent, Công cụ, Theo dõi agent, Kết nối MCP, Cấu hình"
```

## Triển khai (spec §18.9)

- **Plugin Hermes** (chép vào `<hermes-agent>/plugins/…`, khởi động lại gateway — cũng để ghi `tools-manifest.json`): `zalo_tools/group_permissions.py`, `zalo_tools/tools.py`, hai `plugin.yaml`.
- **Dashboard** (khởi động lại `zalo-dashboard`): `dashboard/` theo các task trên.
- **Kết nối Zalo**: không đổi.
- Sau triển khai trên VPS: `HERMES_HOME=/root/.hermes node --test dashboard/lib/config-yaml.test.js` (sửa thử config.yaml thật trong bộ nhớ, không ghi).
- Cập nhật plugin và dashboard cùng lúc (dashboard 7A ghi `permissions.json` sẽ làm rơi `tools.off`).
