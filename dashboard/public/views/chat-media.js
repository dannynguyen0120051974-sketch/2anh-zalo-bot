// Ảnh, tệp, video trong Phiên chat: thẻ trong khung tin, khung xem ảnh lớn, bảng "Ảnh/Video · Tệp · Link".
// Ảnh luôn đi qua /api/media/img (cùng nguồn, hợp CSP); tệp và video chỉ là link ngoài, mở thẻ mới.
import { useEffect, useRef, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, Spinner, fmtTime } from '../ui.js';
import { proxied } from '../media.js';

const EXT_LABEL = {
  pdf: 'PDF', doc: 'DOC', docx: 'DOC', xls: 'XLS', xlsx: 'XLS', csv: 'XLS', ppt: 'PPT', pptx: 'PPT',
  zip: 'ZIP', rar: 'ZIP', '7z': 'ZIP', txt: 'TXT', mp3: 'NHẠC', m4a: 'NHẠC', mp4: 'VIDEO', mov: 'VIDEO',
  jpg: 'ẢNH', jpeg: 'ẢNH', png: 'ẢNH',
};

/** Nhãn và nhóm màu của biểu tượng tệp theo đuôi. */
export function fileBadge(ext) {
  const e = String(ext || '').toLowerCase();
  const label = EXT_LABEL[e] || (e ? e.slice(0, 4).toUpperCase() : 'TỆP');
  const tone = { PDF: 'pdf', DOC: 'doc', XLS: 'xls', PPT: 'ppt', ZIP: 'zip' }[label] || 'other';
  return { label, tone };
}

export function FileBadge({ ext: e }) {
  const b = fileBadge(e);
  return html`<span class=${`file-ico file-ico-${b.tone}`} aria-hidden="true">${b.label}</span>`;
}

/** Ảnh thu nhỏ qua bộ tải của dashboard; tải hỏng thì hiện chữ + link mở ảnh gốc. */
export function Thumb({ url, alt = 'Ảnh', onOpen, className = 'thumb', compact = false }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return html`<span class=${`${className} thumb-broken`} title="Không tải được ảnh — ảnh cũ có thể đã bị Zalo xoá."><${Icon} name="image" size=${18} />
      <span>${compact ? 'Không tải được' : 'Không tải được ảnh — ảnh cũ có thể đã bị Zalo xoá.'}
      <a href=${url} target="_blank" rel="noopener noreferrer">${compact ? 'Mở gốc' : 'Thử mở ảnh gốc'}</a></span></span>`;
  }
  return html`<button type="button" class=${`${className} thumb-btn`} onClick=${onOpen} aria-label=${`Xem lớn: ${alt}`}>
    <img src=${proxied(url)} alt=${alt} loading="lazy" decoding="async" onError=${() => setBroken(true)} />
  </button>`;
}

export function FileCard({ name, url, ext: e }) {
  return html`<span class="file-card">
    <${FileBadge} ext=${e} />
    <span class="file-name">${name}</span>
    <a class="btn btn-secondary btn-sm" href=${url} target="_blank" rel="noopener noreferrer"><${Icon} name="download" size=${16} /> Tải về</a>
  </span>`;
}

export function VideoCard({ url }) {
  return html`<a class="video-card" href=${url} target="_blank" rel="noopener noreferrer">
    <span class="video-play" aria-hidden="true"><${Icon} name="play" size=${28} /></span>
    <span>Video — bấm để mở</span>
  </a>`;
}

/** Khung xem ảnh lớn: ← → chuyển ảnh, Esc đóng; đóng xong trả tiêu điểm về chỗ cũ. */
export function Lightbox({ items, index, onIndex, onClose }) {
  const closeBtn = useRef(null);
  const [broken, setBroken] = useState(null); // url ảnh không tải được
  const item = items[index];
  useEffect(() => {
    const back = document.activeElement;
    closeBtn.current?.focus();
    return () => { if (back && typeof back.focus === 'function') back.focus(); };
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length]);
  if (!item) return null;
  return html`<div class="lightbox" role="dialog" aria-modal="true" aria-label="Xem ảnh" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="lightbox-bar">
      <span class="lightbox-count">${index + 1}/${items.length}${item.senderName ? ` · ${item.senderName}` : ''}${item.ts ? ` · ${fmtTime(item.ts)}` : ''}</span>
      <a class="btn btn-ghost btn-sm lightbox-btn" href=${item.url} target="_blank" rel="noopener noreferrer"><${Icon} name="external" size=${16} /> Ảnh gốc</a>
      <button type="button" ref=${closeBtn} class="btn btn-ghost btn-sm lightbox-btn" onClick=${onClose} aria-label="Đóng"><${Icon} name="close" /></button>
    </div>
    <div class="lightbox-stage">
      <button type="button" class="lightbox-nav" disabled=${index === 0} onClick=${() => onIndex(index - 1)} aria-label="Ảnh trước"><${Icon} name="prev" size=${28} /></button>
      ${broken === item.url
        ? html`<p class="lightbox-broken">Không tải được ảnh này — ảnh cũ có thể đã bị Zalo xoá. Thử “Ảnh gốc” ở trên hoặc xem trong ứng dụng Zalo.</p>`
        : html`<img class="lightbox-img" key=${item.url} src=${proxied(item.url)} alt=${item.caption || 'Ảnh'} onError=${() => setBroken(item.url)} />`}
      <button type="button" class="lightbox-nav" disabled=${index >= items.length - 1} onClick=${() => onIndex(index + 1)} aria-label="Ảnh sau"><${Icon} name="next" size=${28} /></button>
    </div>
    ${item.caption ? html`<p class="lightbox-caption">${item.caption}</p>` : null}
  </div>`;
}

const TABS = [['photo', 'Ảnh/Video'], ['file', 'Tệp'], ['link', 'Link']];
const EMPTY = { photo: 'Chưa có ảnh hay video nào trong hội thoại này.', file: 'Chưa có tệp nào trong hội thoại này.', link: 'Chưa có link nào trong hội thoại này.' };

/** Bảng bên phải (điện thoại: phủ cả màn hình) liệt kê ảnh/video, tệp, link của một hội thoại. */
export function MediaPanel({ conv, onClose, onOpenPhoto }) {
  const [tab, setTab] = useState('photo');
  const [data, setData] = useState({}); // kind → { items, next }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const base = `/api/chats/${encodeURIComponent(conv.threadId)}/media?type=${conv.threadType}`;

  async function load(kind, more = null) {
    const my = ++seq.current;
    setBusy(true); setError('');
    try {
      const r = await api(`${base}&kind=${kind}${more ? `&before=${encodeURIComponent(more)}` : ''}`);
      if (my !== seq.current) return;
      setData((cur) => ({ ...cur, [kind]: { items: more && cur[kind] ? [...cur[kind].items, ...r.items] : r.items, next: r.nextBefore } }));
    } catch (err) {
      if (my === seq.current) setError(err.message);
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }

  useEffect(() => { if (!data[tab]) load(tab); }, [tab]);

  const cur = data[tab];
  const photos = (data.photo?.items || []).filter((x) => !x.video);
  let body;
  if (!cur) body = error ? null : html`<${Spinner} />`;
  else if (!cur.items.length) body = html`<p class="muted small panel-empty">${EMPTY[tab]}</p>`;
  else if (tab === 'photo') {
    body = html`<ul class="media-grid">${cur.items.map((x) => html`<li key=${x.id}>
      ${x.video
        ? html`<a class="media-tile media-video" href=${x.url} target="_blank" rel="noopener noreferrer" aria-label=${`Mở video của ${x.senderName || 'thành viên'}, ${fmtTime(x.ts)}`}>
            <${Icon} name="play" size=${30} /><span class="media-video-label">Video</span></a>`
        : html`<${Thumb} className="media-tile" compact url=${x.url} alt=${`Ảnh của ${x.isSelf ? 'bot' : (x.senderName || 'thành viên')}, ${fmtTime(x.ts)}`}
            onOpen=${() => onOpenPhoto(photos, photos.indexOf(x))} />`}
    </li>`)}</ul>`;
  } else if (tab === 'file') {
    body = html`<ul class="media-list">${cur.items.map((x) => html`<li key=${x.id} class="media-row">
      <${FileBadge} ext=${x.ext} />
      <span class="media-main">
        <span class="file-name">${x.name}</span>
        <span class="muted small">${x.isSelf ? 'Bot' : (x.senderName || 'Thành viên')} · ${fmtTime(x.ts)}</span>
      </span>
      <a class="btn btn-ghost btn-sm" href=${x.url} target="_blank" rel="noopener noreferrer" aria-label=${`Tải về ${x.name}`}><${Icon} name="download" size=${16} /> Tải về</a>
    </li>`)}</ul>`;
  } else {
    body = html`<ul class="media-list">${cur.items.map((x) => html`<li key=${x.id}>
      <a class="media-row media-link" href=${x.url} target="_blank" rel="noopener noreferrer">
        <span class="link-ico" aria-hidden="true"><${Icon} name="link" size=${16} /></span>
        <span class="media-main">
          <span class="link-host">${x.host}</span>
          <span class="link-text">${x.title || x.url}</span>
          <span class="muted small">${x.isSelf ? 'Bot' : (x.senderName || 'Thành viên')} · ${fmtTime(x.ts)}</span>
        </span>
      </a>
    </li>`)}</ul>`;
  }

  return html`<aside class="side-panel" aria-label="Ảnh, tệp và link" onKeyDown=${(e) => { if (e.key === 'Escape' && !document.querySelector('.lightbox')) onClose(); }}>
    <header class="side-head">
      <h3>Ảnh/Video · Tệp · Link</h3>
      <button type="button" class="btn btn-ghost btn-sm" onClick=${onClose} aria-label="Đóng bảng ảnh, tệp, link"><${Icon} name="close" /></button>
    </header>
    <div class="tabs" role="tablist" aria-label="Loại mục">
      ${TABS.map(([k, label]) => html`<button type="button" role="tab" id=${`media-tab-${k}`} aria-selected=${tab === k ? 'true' : 'false'}
        aria-controls="media-tabpanel" class=${`tab${tab === k ? ' active' : ''}`} onClick=${() => setTab(k)}>${label}</button>`)}
    </div>
    <div class="side-body" role="tabpanel" id="media-tabpanel" aria-labelledby=${`media-tab-${tab}`}>
      <${Live} error=${error} />
      ${body}
      ${cur?.next ? html`<button type="button" class="btn btn-ghost btn-sm panel-more" disabled=${busy} onClick=${() => load(tab, cur.next)}>${busy ? 'Đang tải…' : 'Xem thêm'}</button>` : null}
    </div>
  </aside>`;
}
