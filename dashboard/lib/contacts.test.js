import test from 'node:test';
import assert from 'node:assert/strict';
import { filterContacts, mergeContacts } from './contacts.js';

const A = '1111111111111111111';
const B = '2222222222222222222';
const C = '3333333333333333333';

test('gộp theo UID: bạn bè + nhắn riêng + hồ sơ; tên ưu tiên Zalo; nhắn gần nhất lên đầu; bỏ UID lạ', () => {
  const list = mergeContacts({
    friends: [{ uid: A, name: 'Lan Zalo' }, { uid: 'nhóm-1', name: 'x' }],
    dmPeers: [{ uid: A, name: 'Lan cũ', lastAtMs: 5 }, { uid: B, name: 'Minh', lastAtMs: 9 }],
    people: [{ uid: C, name: 'Cô Hà', note: 'Tổ Văn' }, { uid: A, name: 'Cô Lan', note: '' }],
    owners: [B],
  });
  assert.deepEqual(list.map((c) => [c.uid, c.name, c.friend, c.lastDmAt, Boolean(c.profile), c.owner]), [
    [B, 'Minh', false, 9, false, true],
    [A, 'Lan Zalo', true, 5, true, false],
    [C, 'Cô Hà', false, null, true, false],
  ]);
});

test('lọc theo loại và chữ không dấu (cả ghi chú hồ sơ)', () => {
  const list = mergeContacts({ friends: [{ uid: A, name: 'Lan' }], dmPeers: [{ uid: B, name: 'Minh', lastAtMs: 1 }], people: [{ uid: C, name: 'Hà', note: 'Tổ Văn' }] });
  assert.deepEqual(filterContacts(list, { kind: 'friend' }).map((c) => c.uid), [A]);
  assert.deepEqual(filterContacts(list, { kind: 'dm' }).map((c) => c.uid), [B]);
  assert.deepEqual(filterContacts(list, { kind: 'profile', q: 'to van' }).map((c) => c.uid), [C]);
  assert.deepEqual(filterContacts(list, { q: '2222' }).map((c) => c.uid), [B]);
});
