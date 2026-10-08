import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkContent, createKbStore, kbAllowed, safeFileName } from './kb-store.js';

const PDF = Buffer.from('%PDF-1.7\n...');
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....word/document.xml....')]);

function kb(t, { scope = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zd-kb-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const d of ['Nam 2026', 'Nam 2026/.git', 'node_modules', 'Luu tru']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'Nam 2026', 'Ke hoach.docx'), DOCX);
  writeFileSync(join(root, 'Nam 2026', 'mat-khau-password.txt'), 'x');
  writeFileSync(join(root, 'Nam 2026', '.git', 'config'), 'x');
  writeFileSync(join(root, 'node_modules', 'a.md'), 'x');
  writeFileSync(join(root, 'Luu tru', 'cu.pdf'), PDF);
  writeFileSync(join(root, 'goc.md'), '# gốc');
  writeFileSync(join(root, 'anh.png'), 'x');
  return { root, store: createKbStore({ kbDir: () => root, publicDirs: () => scope }) };
}

test('luật lọc giống plugin: phạm vi thư mục cấp 1, bỏ thư mục ẩn/mã nguồn, tên gợi ý dữ liệu riêng', () => {
  assert.equal(kbAllowed('Nam 2026/Ke hoach.docx', ['nam 2026']), true);
  assert.equal(kbAllowed('goc.md', ['nam 2026']), false, 'tệp ở gốc nằm ngoài phạm vi khi có phạm vi');
  assert.equal(kbAllowed('goc.md', []), true);
  assert.equal(kbAllowed('a/.env/x.md', []), false);
  assert.equal(kbAllowed('a/khach-hang.xlsx', []), false);
});

test('liệt kê đúng tệp bot đọc được; có phạm vi thì chỉ trong phạm vi; chưa cấu hình → rỗng', async (t) => {
  const { store } = kb(t);
  assert.deepEqual((await store.list()).files.map((f) => f.path).sort(), ['Luu tru/cu.pdf', 'Nam 2026/Ke hoach.docx', 'goc.md']);
  const scoped = kb(t, { scope: 'Nam 2026' }).store;
  assert.deepEqual((await scoped.list()).files.map((f) => f.path), ['Nam 2026/Ke hoach.docx']);
  assert.equal(scoped.info().uploadDir, 'Nam 2026/tai-len-dashboard');
  const none = createKbStore({ kbDir: () => '', publicDirs: () => '' });
  assert.deepEqual(none.info(), { configured: false, publicDirs: [], uploadDir: null });
  assert.deepEqual(await none.list(), { files: [], truncated: false });
});

test('tên tệp: tên thiết bị Windows bị từ chối (có/không đuôi, hoa thường); cắt dài chỉ cắt phần tên, giữ đuôi', () => {
  for (const bad of ['CON.txt', 'nul.md', 'Aux.pdf', 'prn.docx', 'COM1.txt', 'lpt9.md', 'com5.tar.txt', 'con .txt']) {
    assert.throws(() => safeFileName(bad), (e) => e.statusCode === 400 && /Windows/.test(e.message), bad);
  }
  assert.equal(safeFileName('console.txt'), 'console.txt');
  assert.equal(safeFileName('COM10.txt'), 'COM10.txt');
  const long = safeFileName(`${'a'.repeat(300)}.DOCX`);
  assert.ok(long.endsWith('.DOCX') && long.length === 125, long.length);
});

test('tên tệp: bỏ đường dẫn và ký tự cấm, chỉ docx/pdf/md/txt; nội dung phải khớp đuôi, ≤ 10 MB', () => {
  assert.equal(safeFileName('C:\\fakepath\\Kế hoạch: tháng 10?.docx'), 'Kế hoạch tháng 10 .docx');
  assert.equal(safeFileName('../../.env.md'), 'env.md');
  for (const bad of ['', '.docx', 'a.exe', 'a.html']) assert.throws(() => safeFileName(bad), (e) => e.statusCode === 400, bad);
  checkContent('a.pdf', PDF); checkContent('a.docx', DOCX); checkContent('a.md', Buffer.from('Xin chào'));
  assert.throws(() => checkContent('a.pdf', DOCX), (e) => e.statusCode === 400);
  assert.throws(() => checkContent('a.docx', Buffer.from('PK\u0003\u0004 không có word')), (e) => e.statusCode === 400);
  assert.throws(() => checkContent('a.txt', Buffer.from([0xff, 0xfe, 0x00])), (e) => e.statusCode === 400);
  assert.throws(() => checkContent('a.pdf', Buffer.alloc(10 * 1024 * 1024 + 1)), (e) => e.statusCode === 413);
});

test('tải lên vào thư mục riêng, không đè tệp trùng tên; chỉ xoá được tệp trong thư mục đó', async (t) => {
  const { root, store } = kb(t);
  assert.equal(store.upload('Ke hoach.pdf', PDF), 'tai-len-dashboard/Ke hoach.pdf');
  assert.equal(store.upload('Ke hoach.pdf', PDF), 'tai-len-dashboard/Ke hoach (2).pdf');
  assert.ok((await store.list()).files.find((f) => f.path === 'tai-len-dashboard/Ke hoach (2).pdf').uploaded);
  store.remove('tai-len-dashboard/Ke hoach.pdf');
  assert.equal(existsSync(join(root, 'tai-len-dashboard', 'Ke hoach.pdf')), false);
  for (const rel of ['Luu tru/cu.pdf', 'tai-len-dashboard/../goc.md', '../x', 'tai-len-dashboard']) {
    assert.throws(() => store.remove(rel), (e) => e.statusCode === 403, rel);
  }
  assert.throws(() => store.remove('tai-len-dashboard/khong-co.pdf'), (e) => e.statusCode === 404);
  assert.equal(readFileSync(join(root, 'Luu tru', 'cu.pdf'), 'latin1').slice(0, 5), '%PDF-');
});

test('liên kết tượng trưng: thư mục tải lên trỏ ra ngoài kho thì không ghi/xoá được; tệp là liên kết thì không xoá', (t) => {
  const { root, store } = kb(t);
  const outside = mkdtempSync(join(tmpdir(), 'zd-out-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'x.pdf'), PDF);
  try { symlinkSync(outside, join(root, 'tai-len-dashboard'), 'junction'); } catch { t.skip('không tạo được liên kết trên máy này'); return; }
  assert.throws(() => store.upload('a.pdf', PDF), (e) => e.statusCode === 403);
  assert.equal(existsSync(join(outside, 'a.pdf')), false);
  assert.throws(() => store.remove('tai-len-dashboard/x.pdf'), (e) => e.statusCode === 403);
  assert.equal(existsSync(join(outside, 'x.pdf')), true);
});

test('thư mục cha (phạm vi) là liên kết trỏ ra ngoài: từ chối TRƯỚC khi mkdir, không tạo gì ngoài kho', (t) => {
  const { root, store } = kb(t, { scope: 'ngoai' });
  const outside = mkdtempSync(join(tmpdir(), 'zd-out-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  try { symlinkSync(outside, join(root, 'ngoai'), 'junction'); } catch { t.skip('không tạo được liên kết trên máy này'); return; }
  assert.throws(() => store.upload('a.pdf', PDF), (e) => e.statusCode === 403);
  assert.equal(existsSync(join(outside, 'tai-len-dashboard')), false, 'không mkdir ngoài kho');
});

test('liệt kê bất đồng bộ giữ trần 3000 tệp và báo truncated', async (t) => {
  const { root, store } = kb(t);
  mkdirSync(join(root, 'nhieu'));
  for (let i = 0; i < 3100; i += 1) writeFileSync(join(root, 'nhieu', `f${i}.md`), 'x');
  const out = await store.list({ fresh: true });
  assert.equal(out.files.length, 3000);
  assert.equal(out.truncated, true);
});
