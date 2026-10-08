// Trang Kho tri thức (spec §18) — khung tạm, task sau thay bằng trang thật.
import { html, PageHead } from '../ui.js';

export function Kb() {
  return html`<${PageHead} title="Kho tri thức" sub="Đang chuẩn bị." />`;
}
