import test from 'node:test';
import assert from 'node:assert/strict';
import { chatMsg, makeDeps, seedHistory } from '../test-helpers.js';
import { vnDay } from './insight.js';

const G = '2054797107487294899';
// 2026-10-07 09:30 giờ VN (thứ Tư) = 02:30 UTC.
const WED_0930 = Date.UTC(2026, 9, 7, 2, 30);
const NOW = Date.UTC(2026, 9, 8, 5, 0); // 12:00 VN ngày 08/10

test('insight nhóm: tổng, theo ngày (giờ VN, đủ N ngày), người nhắn nhiều, bản đồ giờ, loại tin; bỏ tin mã đăng nhập', (t) => {
  const deps = makeDeps(t);
  const g = (over) => chatMsg({ threadId: G, threadType: 1, ...over });
  seedHistory(deps, { messages: [
    g({ senderUid: '1', senderName: 'Lan cũ', ts: WED_0930 - 60_000 }),
    g({ senderUid: '1', senderName: 'Lan', ts: WED_0930 }),
    g({ senderUid: '1', senderName: 'Lan', ts: WED_0930 + 1000, msgType: 'chat.photo', text: 'https://photo.zdn.vn/a.jpg' }),
    g({ senderUid: '2', senderName: 'Minh', ts: WED_0930 + 2000, text: 'xem https://vnexpress.net/a' }),
    g({ senderUid: 'bot', senderName: 'Bot', ts: WED_0930 + 3000, isSelf: true }),
    g({ senderUid: 'bot', ts: WED_0930 + 4000, isSelf: true, text: 'Mã đăng nhập dashboard: 123456' }),
    g({ senderUid: '3', senderName: 'Cũ', ts: NOW - 40 * 86_400_000 }),
    chatMsg({ threadId: '999', threadType: 1, senderUid: '9', ts: WED_0930 }),
  ] });
  const r = deps.store.groupInsight(G, { days: 7, nowMs: NOW });
  assert.deepEqual(r.totals, { messages: 5, members: 2, bot: 1 });
  assert.equal(r.perDay.length, 7);
  assert.equal(r.perDay.at(-1).date, '2026-10-08');
  assert.deepEqual(r.perDay.find((d) => d.date === '2026-10-07'), { date: '2026-10-07', total: 5, bot: 1 });
  assert.deepEqual(r.top, [{ name: 'Lan', count: 3 }, { name: 'Minh', count: 1 }]);
  assert.equal(r.heat[2][9], 4, 'thứ Tư (hàng 3, T2 = 0) lúc 9 giờ: 4 tin của thành viên');
  assert.equal(r.heat.flat().reduce((a, b) => a + b, 0), 4, 'tin của bot không tính vào bản đồ giờ');
  assert.deepEqual(r.kinds, { text: 4, photo: 1, file: 0, link: 1, sticker: 0, voice: 0, other: 0 });
  assert.doesNotMatch(JSON.stringify(r), /"1"|sender_uid|uid/);
  assert.equal(vnDay(Date.UTC(2026, 9, 7, 17, 30)), '2026-10-08', '00:30 VN là ngày mới');
});
