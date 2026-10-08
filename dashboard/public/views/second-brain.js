// Trang Second brain (spec §18) — khung tạm, task sau thay bằng trang thật.
import { html, PageHead } from '../ui.js';

export function SecondBrain() {
  return html`<${PageHead} title="Second brain" sub="Đang chuẩn bị." />`;
}
