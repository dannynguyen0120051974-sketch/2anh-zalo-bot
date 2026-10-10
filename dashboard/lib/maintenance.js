/**
 * Bảo trì (chỉ Quản trị): phiên bản + cập nhật, và nơi giữ bản sao lưu cài đặt.
 * - Bot Zalo (2anh-zalo-bot): phiên bản trong plugin.yaml đã cài; bản mới nhất từ GitHub Releases (repo công khai,
 *   lưu đệm 1 giờ). Cập nhật bot do người cài đặt làm (đổi cả sidecar lẫn plugin) — dashboard chỉ báo.
 * - Hermes: `hermes --version`, `hermes update --check` (bấm mới chạy, ~10 giây). Cập nhật: chạy tách rời
 *   `hermes update --yes --backup` (Hermes tự chụp điểm khôi phục + sao lưu trước), ghi nhật ký ra tệp để xem tiến độ.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { waitSpawned } from './spawn-detached.js';

export const RELEASES_URL = 'https://api.github.com/repos/luonghaianh1208/2anh-zalo-bot/releases/latest';
export const BACKUP_FILE = /^hermes-zalo-\d{8}-\d{6}(-[a-z0-9-]{1,30})?\.zip$/;
const HOUR = 3600_000;
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/** "version: 2.7.0" trong plugin.yaml → "2.7.0". */
export function pluginVersion(text) {
  return /^version:\s*['"]?([\w.+-]+)/m.exec(String(text || ''))?.[1] || '';
}

/** So hai phiên bản dạng x.y.z (bỏ "v"): >0 nếu a mới hơn b. */
export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/** Kết quả `hermes update --check` → 'available' | 'current' | 'unknown'. */
export function parseUpdateCheck(out) {
  const t = String(out || '').replace(ANSI, '');
  if (/update available|behind origin/i.test(t)) return 'available';
  if (/up to date|already (on the )?latest|no updates?/i.test(t)) return 'current';
  return 'unknown';
}

const run = (file, args, opts) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, timeout: 60_000, ...opts }, (e, stdout, stderr) => resolve({ ok: !e, out: `${stdout || ''}${stderr || ''}` }));
});

export function createMaintenance({ hermesBin, pluginYaml = () => '', dataDir, fetchImpl = globalThis.fetch, runImpl = run, spawnImpl = spawn, now = Date.now }) {
  const backupDir = join(dataDir, 'backups');
  const stateFile = join(dataDir, 'hermes-update.json');
  const logFile = join(dataDir, 'hermes-update.log');
  let latest = null; // { at, value }
  let hermesCheck = null; // { at, status }

  async function latestRelease() {
    if (latest && now() - latest.at < HOUR) return latest.value;
    let value = null;
    try {
      const res = await fetchImpl(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': '2anh-zalo-dashboard' }, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const j = await res.json();
        value = { tag: String(j.tag_name || ''), name: String(j.name || ''), url: String(j.html_url || ''), notes: String(j.body || '').slice(0, 6000), publishedAt: j.published_at || '' };
      }
    } catch { /* mất mạng → không biết bản mới */ }
    latest = { at: now(), value };
    return value;
  }

  function updateState() {
    let s = {};
    try { s = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { /* chưa cập nhật lần nào */ }
    let running = false;
    if (s.pid && !s.finishedAt) { try { process.kill(s.pid, 0); running = true; } catch { running = false; } }
    let log = '';
    try { log = readFileSync(logFile, 'utf8').replace(ANSI, '').split(/\r?\n/).filter((l) => l.trim()).slice(-40).join('\n'); } catch { /* chưa có */ }
    return { startedAt: s.startedAt || 0, running, log };
  }

  return {
    backupDir,
    async versions() {
      const bot = pluginVersion(pluginYaml());
      const rel = await latestRelease();
      let hermes = '';
      const v = await runImpl(hermesBin, ['--version']);
      if (v.ok) hermes = v.out.replace(ANSI, '').split(/\r?\n/)[0].trim().slice(0, 200);
      return {
        bot: { version: bot, latest: rel, newer: Boolean(rel?.tag && bot && compareVersions(rel.tag, bot) > 0) },
        hermes: { version: hermes, check: hermesCheck },
        update: updateState(),
      };
    },
    async checkHermes() {
      const r = await runImpl(hermesBin, ['update', '--check'], { timeout: 90_000 });
      hermesCheck = { at: now(), status: parseUpdateCheck(r.out) };
      return hermesCheck;
    },
    async updateHermes() {
      if (updateState().running) throw fail(409, 'Hermes đang cập nhật — chờ xong rồi xem lại.');
      mkdirSync(dataDir, { recursive: true });
      const fd = openSync(logFile, 'w');
      const child = spawnImpl(hermesBin, ['update', '--yes', '--backup'], { detached: true, windowsHide: true, stdio: ['ignore', fd, fd], env: { ...process.env, NO_COLOR: '1' } });
      await waitSpawned(child);
      writeFileSync(stateFile, JSON.stringify({ pid: child.pid, startedAt: now() }));
      hermesCheck = null;
      return updateState();
    },
    updateState,
    backups() {
      if (!existsSync(backupDir)) return [];
      return readdirSync(backupDir).filter((f) => BACKUP_FILE.test(f)).sort().reverse()
        .map((f) => { const st = statSync(join(backupDir, f)); return { file: f, size: st.size, at: st.mtimeMs }; });
    },
    backupPath(file) {
      if (!BACKUP_FILE.test(String(file || ''))) throw fail(400, 'Tên bản sao lưu không hợp lệ.');
      const p = join(backupDir, file);
      if (!existsSync(p)) throw fail(404, 'Không còn bản sao lưu này — tải lại trang.');
      return p;
    },
  };
}
