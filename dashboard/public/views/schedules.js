// Trang Lịch hẹn (spec §18) — khung tạm, task sau thay bằng trang thật.
import { html, PageHead } from '../ui.js';

export function Schedules() {
  return html`<${PageHead} title="Lịch hẹn" sub="Đang chuẩn bị." />`;
}
