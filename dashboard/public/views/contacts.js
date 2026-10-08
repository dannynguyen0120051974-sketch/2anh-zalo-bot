// Trang Liên hệ (spec §18) — khung tạm, task sau thay bằng trang thật.
import { html, PageHead } from '../ui.js';

export function Contacts() {
  return html`<${PageHead} title="Liên hệ" sub="Đang chuẩn bị." />`;
}
