import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPeopleStore, parsePerson } from './people-store.js';

const A = '1111111111111111111';
const B = '2222222222222222222';
function setup(t, data) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-people-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'people.json');
  if (data !== undefined) writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  return { file, store: createPeopleStore({ file, now: () => 1_800_000_000_000 }) };
}

test('parsePerson: làm sạch chữ, bỏ dòng trống, kiểm giới hạn của people.py, hồ sơ trống bị từ chối', () => {
  assert.deepEqual(parsePerson({ name: ' Cô\nLan ', note: '', fields: [{ key: 'môn', value: 'Hoá' }, { key: '', value: '' }] }),
    { name: 'Cô Lan', note: '', fields: { 'môn': 'Hoá' } });
  for (const [body, re] of [
    [null, /không hợp lệ/], [{ name: 'x'.repeat(81) }, /Tên tối đa 80/], [{ name: 'a', note: 'x'.repeat(401) }, /Ghi chú tối đa 400/],
    [{ name: 'a', fields: Array.from({ length: 13 }, (_, i) => ({ key: `k${i}`, value: 'v' })) }, /Tối đa 12/],
    [{ name: 'a', fields: [{ key: '', value: 'v' }] }, /chưa đặt tên mục/], [{ name: 'a', fields: [{ key: 'k', value: 'x'.repeat(121) }] }, /120/],
    [{ name: '', note: '', fields: [] }, /Hồ sơ trống/],
  ]) assert.throws(() => parsePerson(body), (e) => e.statusCode === 400 && re.test(e.message), JSON.stringify(body).slice(0, 40));
});

test('liệt kê mới sửa trước; không có tệp = rỗng; tệp hỏng = 503, không ghi đè', (t) => {
  const { store } = setup(t, { [A]: { name: 'Lan', updated_at: 10, fields: { 'môn': 'Hoá' } }, [B]: { name: 'Minh', updated_at: 20 } });
  assert.deepEqual(store.list().map((p) => [p.uid, p.updatedAt]), [[B, 20_000], [A, 10_000]]);
  assert.deepEqual(store.list()[1].fields, [{ key: 'môn', value: 'Hoá' }]);
  assert.deepEqual(setup(t).store.list(), []);
  const broken = setup(t, '{hỏng');
  assert.throws(() => broken.store.list(), (e) => e.statusCode === 503);
  assert.throws(() => broken.store.put(A, parsePerson({ name: 'x' }), 'anh'), (e) => e.statusCode === 503);
  assert.equal(readFileSync(broken.file, 'utf8'), '{hỏng');
});

test('sửa: thay cả hồ sơ, giữ khoá lạ của plugin, ghi người sửa, có .bak; xoá', (t) => {
  const { file, store } = setup(t, { [A]: { name: 'Lan', note: 'cũ', fields: { a: '1' }, updated_at: 1, extra: 'giữ' } });
  const p = store.put(A, parsePerson({ name: 'Cô Lan', note: '', fields: [{ key: 'môn', value: 'Hoá' }] }), 'anh');
  assert.equal(p.name, 'Cô Lan');
  const saved = JSON.parse(readFileSync(file, 'utf8'))[A];
  assert.deepEqual(saved, { name: 'Cô Lan', fields: { 'môn': 'Hoá' }, updated_at: 1_800_000_000, extra: 'giữ', updated_by: 'dashboard:anh' });
  assert.ok(existsSync(`${file}.bak`));
  assert.equal(store.remove(A), true);
  assert.equal(store.remove(A), false);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {});
  assert.throws(() => store.put('abc', parsePerson({ name: 'x' }), 'anh'), (e) => e.statusCode === 400);
});

test('bot ghi chen giữa lúc đọc và lúc ghi → 409, không đè mất hồ sơ bot vừa ghi', (t) => {
  const { file } = setup(t, { [A]: { name: 'Lan', updated_at: 1 } });
  let calls = 0;
  const store = createPeopleStore({
    file,
    now: () => {
      calls += 1;
      writeFileSync(file, JSON.stringify({ [A]: { name: 'Lan' }, [B]: { name: 'Bot vừa ghi', updated_at: 2 } }));
      utimesSync(file, 2_000_000_000, 2_000_000_000);
      return 1_800_000_000_000;
    },
  });
  assert.throws(() => store.put(A, parsePerson({ name: 'Cô Lan' }), 'anh'), (e) => e.statusCode === 409);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(readFileSync(file, 'utf8'))[B].name, 'Bot vừa ghi');
});
