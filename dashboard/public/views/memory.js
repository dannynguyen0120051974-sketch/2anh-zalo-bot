// Trang Trí nhớ (spec §18) — khung tạm, task sau thay bằng trang thật.
import { html, PageHead } from '../ui.js';

export function Memory() {
  return html`<${PageHead} title="Trí nhớ" sub="Đang chuẩn bị." />`;
}
