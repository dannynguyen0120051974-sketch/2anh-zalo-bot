// Lịch hẹn bằng lời thường ↔ lịch của Hermes (dùng chung trình duyệt + máy chủ, không phụ thuộc gì).
// Dạng thường: { repeat: 'once'|'daily'|'weekly'|'monthly', times: ['HH:MM', …], days: [1..7] (T2=1 … CN=7),
//                dayOfMonth: 1..31, date: 'YYYY-MM-DD' }.
// Hermes: cron "M H dom * dow" (dow 0 = CN) cho việc lặp; "YYYY-MM-DDTHH:MM" cho việc một lần.

export const DAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
export const DAY_NAMES = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];
export const REPEATS = [
  { value: 'once', label: 'Một lần' },
  { value: 'daily', label: 'Hằng ngày' },
  { value: 'weekly', label: 'Các thứ trong tuần' },
  { value: 'monthly', label: 'Hằng tháng' },
];

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const pad = (n) => String(n).padStart(2, '0');
const uniqSorted = (xs) => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Lỗi đầu tiên của dạng thường (câu dễ hiểu), hoặc ''. */
export function specProblem(s) {
  if (!s || !REPEATS.some((r) => r.value === s.repeat)) return 'Chọn kiểu lặp lại.';
  const times = Array.isArray(s.times) ? s.times : [];
  if (!times.length) return 'Chọn giờ chạy.';
  if (times.some((t) => !TIME.test(String(t)))) return 'Giờ phải dạng giờ:phút, ví dụ 07:30.';
  if (s.repeat === 'once') {
    if (times.length !== 1) return 'Việc một lần chỉ có một giờ chạy.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date || '')) || Number.isNaN(Date.parse(`${s.date}T00:00:00Z`))) return 'Chọn ngày chạy.';
  }
  if (s.repeat === 'weekly' && !(Array.isArray(s.days) && s.days.length && s.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7))) return 'Chọn ít nhất một thứ trong tuần.';
  if (s.repeat === 'monthly' && !(Number.isInteger(s.dayOfMonth) && s.dayOfMonth >= 1 && s.dayOfMonth <= 31)) return 'Chọn ngày trong tháng (1–31).';
  if (s.repeat !== 'once') {
    const minutes = new Set(times.map((t) => t.slice(3)));
    if (minutes.size > 1) return 'Các giờ trong ngày phải cùng số phút (vd. 08:00 và 20:00).';
  }
  return '';
}

/** Dạng thường → chuỗi lịch đưa cho `hermes cron create/edit`. Ném lỗi nếu dạng thường sai. */
export function toSchedule(s) {
  const bad = specProblem(s);
  if (bad) throw new Error(bad);
  const times = uniqSorted(s.times);
  if (s.repeat === 'once') return `${s.date}T${times[0]}`;
  const minute = Number(times[0].slice(3));
  const hours = times.map((t) => Number(t.slice(0, 2))).join(',');
  if (s.repeat === 'daily') return `${minute} ${hours} * * *`;
  if (s.repeat === 'monthly') return `${minute} ${hours} ${s.dayOfMonth} * *`;
  const dow = uniqSorted(s.days.map(Number)).map((d) => d % 7).sort((a, b) => a - b).join(',');
  return `${minute} ${hours} * * ${dow}`;
}

const NUM_LIST = /^\d{1,2}(,\d{1,2})*$/;

/** Lịch đã lưu của Hermes ({kind, expr, run_at}) → dạng thường; null nếu là lịch nâng cao (khoảng, cron phức tạp). */
export function fromSchedule(sch) {
  if (!sch || typeof sch !== 'object') return null;
  if (sch.kind === 'once' && sch.run_at) {
    // Đổi về giờ Việt Nam: việc agent tạo có thể lưu "…Z" hoặc múi khác; gửi lại không kèm múi = Hermes hiểu là giờ VN.
    const raw = String(sch.run_at);
    const naive = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(\+07:00)?$/.exec(raw);
    if (naive) return { repeat: 'once', date: naive[1], times: [`${naive[2]}:${naive[3]}`] };
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) return null;
    const vn = new Date(ms + 7 * 3_600_000).toISOString();
    return { repeat: 'once', date: vn.slice(0, 10), times: [vn.slice(11, 16)] };
  }
  if (sch.kind !== 'cron') return null;
  const f = String(sch.expr || '').trim().split(/\s+/);
  if (f.length !== 5 || !/^\d{1,2}$/.test(f[0]) || !NUM_LIST.test(f[1]) || f[3] !== '*') return null;
  const minute = Number(f[0]);
  const hours = f[1].split(',').map(Number);
  if (minute > 59 || hours.some((h) => h > 23)) return null;
  const times = hours.map((h) => `${pad(h)}:${pad(minute)}`);
  if (f[2] === '*' && f[4] === '*') return { repeat: 'daily', times };
  if (f[2] === '*' && NUM_LIST.test(f[4])) {
    const dow = f[4].split(',').map(Number);
    if (dow.some((d) => d > 7)) return null;
    return { repeat: 'weekly', times, days: uniqSorted(dow.map((d) => (d === 0 ? 7 : d))) };
  }
  if (/^\d{1,2}$/.test(f[2]) && f[4] === '*' && Number(f[2]) >= 1 && Number(f[2]) <= 31) return { repeat: 'monthly', times, dayOfMonth: Number(f[2]) };
  return null;
}

/** Câu mô tả: "Hằng ngày lúc 08:00, 20:00", "T3, T5 lúc 20:00", "Ngày 5 hằng tháng lúc 07:00", "Một lần, 23/10/2026 lúc 08:00". */
export function describeSpec(s) {
  if (!s) return 'Lịch nâng cao';
  const at = `lúc ${uniqSorted(s.times).join(', ')}`;
  if (s.repeat === 'once') { const [y, m, d] = s.date.split('-'); return `Một lần, ${d}/${m}/${y} ${at}`; }
  if (s.repeat === 'daily') return `Hằng ngày ${at}`;
  if (s.repeat === 'monthly') return `Ngày ${s.dayOfMonth} hằng tháng ${at}`;
  const days = uniqSorted(s.days);
  return `${days.length === 7 ? 'Mọi ngày' : days.map((d) => DAY_LABELS[d - 1]).join(', ')} ${at}`;
}

/**
 * Các lần chạy trong tuần bắt đầu ở `weekStart` (ngày thứ Hai, 'YYYY-MM-DD'): [{ day: 1..7, time: 'HH:MM' }].
 * Tính theo lịch, không theo múi giờ máy (giờ trong lịch là giờ của trợ lý).
 */
export function weekOccurrences(s, weekStart) {
  if (!s) return [];
  const times = uniqSorted(s.times);
  const out = [];
  const base = Date.parse(`${weekStart}T00:00:00Z`);
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(base + i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    const day = i + 1;
    const hit = s.repeat === 'daily' || (s.repeat === 'weekly' && s.days.includes(day))
      || (s.repeat === 'monthly' && d.getUTCDate() === s.dayOfMonth) || (s.repeat === 'once' && s.date === iso);
    if (hit) for (const time of times) out.push({ day, time, date: iso });
  }
  return out;
}

/**
 * Kéo một lần chạy từ ngày `fromDay` sang `toDay` (1..7) của tuần đang xem (ngày cụ thể `toDate`):
 * một lần → đổi ngày; các thứ → thay thứ cũ bằng thứ mới; hằng tháng → đổi sang ngày trong tháng đó;
 * hằng ngày → không đổi (null).
 */
export function moveSpec(s, fromDay, toDay, toDate) {
  if (!s || fromDay === toDay) return null;
  if (s.repeat === 'once') return { ...s, date: toDate };
  if (s.repeat === 'weekly') return { ...s, days: uniqSorted([...s.days.filter((d) => d !== fromDay), toDay]) };
  if (s.repeat === 'monthly') return { ...s, dayOfMonth: Number(toDate.slice(8, 10)) };
  return null;
}

/** Thứ Hai của tuần chứa `date` ('YYYY-MM-DD'). */
export function mondayOf(date) {
  const t = Date.parse(`${date}T00:00:00Z`);
  const dow = new Date(t).getUTCDay(); // 0 = CN
  return new Date(t - ((dow + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}
