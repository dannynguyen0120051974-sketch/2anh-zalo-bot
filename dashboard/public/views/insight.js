// Trang Insight nhóm (spec §18) — khung tạm, task sau thay bằng trang thật.
import { html, PageHead } from '../ui.js';

export function Insight() {
  return html`<${PageHead} title="Insight nhóm" sub="Đang chuẩn bị." />`;
}
