# Dashboard v2 — §17 Giai đoạn 6: Xưởng tạo sản phẩm

**Ngày:** 2026-10-07 (sửa 2026-10-08 theo quyết định thứ hai của người dùng, §17.1.B)
**Trạng thái:** Quyết định của người dùng đã chốt (§17.1); bản viết chờ duyệt
**Dự án:** 2anh-zalo-bot (từ v1.23.1 → v1.24.0)
**Bổ sung cho:** `2026-10-07-zalo-dashboard-v2-design.md` (§1–§15) và `2026-10-07-dashboard-v2-phase5-addendum.md` (§16). Tệp này là §17.

## 17.1 Quyết định của người dùng (bắt buộc)

**A. Lần đầu (07/10):**
1. Người **không phải chủ nhân** — thành viên nhóm, và người nhắn riêng mà mục `dm` (§16) cho phép — được nhờ bot làm sản phẩm bằng tài nguyên AI của chủ bot: **slide PPTX**, **văn bản và giáo án** (NĐ30, Đoàn, Đảng, giáo án 5512), **đề thi, SKKN, trò chơi, thí nghiệm ảo**, **video** của 2Anh Studio.
2. Mỗi loại là **một nút riêng** ở cả Phân quyền nhóm lẫn Nhắn riêng (mặc định, từng nhóm, từng người).
3. **Hạn mức theo người theo ngày**, sửa trên dashboard: mặc định, ghi đè theo nhóm và theo người. Chủ nhân không giới hạn.
4. **An toàn cứng:** người không phải chủ nhân KHÔNG BAO GIỜ có terminal, đọc/ghi tệp hệ thống, `.env`/khoá, chạy lệnh tuỳ ý — trực tiếp hay gián tiếp, kể cả qua câu cài cắm khiến một tác tử có quyền cao chạy lệnh.

**B. Lần hai (08/10), trả lời các câu hỏi ở bản trước:**
1. **Đồng ý** hạn mức mặc định **3 việc/người/ngày**; hỏng vì nội dung vẫn tính lượt, hỏng vì máy chủ trả lượt; sửa được trên dashboard.
2. **Văn bản Đoàn phải có**: AI không công cụ viết JSON có cấu trúc → bộ sinh docx **cố định** theo thể thức của skill `soan-van-ban-doan`.
3. **Slide và video được dùng ảnh AI và ảnh web.** Chỉ mã cố định của plugin vẽ/tải ảnh; AI chỉ được XIN ảnh (câu mô tả / từ khoá). Ảnh AI gọi cổng vẽ (9router, khoá của chủ bot) từ **tiến trình cha**, không trong hộp cát; ảnh lưu vào thư mục việc sau khi kiểm byte đầu và cỡ. Ảnh web: tìm bằng bước cố định, tải với https-only, chặn IP riêng/loopback/link-local (phân giải rồi kiểm — SSRF), trần cỡ và thời gian, kiểm Content-Type + byte đầu, không chuyển hướng về địa chỉ riêng. SVG/slide chỉ được tham chiếu ảnh trong thư mục việc bằng **mã mờ**; mọi tham chiếu ngoài khác vẫn bị từ chối. Có trần số ảnh và chi phí mỗi việc.
4. **Trò chơi: mọi khuôn có sẵn** của skill (không chỉ trắc nghiệm). Vẫn cấm `mau: moi` (JS do AI viết chạy bằng Node). Chỉ khuôn cố định + dữ liệu đã kiểm.
5. **Video: mọi phong cách**, kể cả Vox có ảnh AI (qua đường ảnh ở mục 3), và **video bài giảng từ slide**. Trần: **≤ 180 giây, 720p**. Cập nhật bản 2Anh Studio trên VPS khi triển khai.
6. **Windows (Lăng Tiêu): chính sách cài đặt** — trên win32, nút video luôn tắt, dashboard ghi "Máy chủ Windows không có hộp cát — video tắt". Các nút sản phẩm khác mặc định tắt cho mọi nhóm, chủ bot tự bật cho nhóm/người tin cậy. Trên Linux theo cài đặt bình thường.
7. Giữ nguyên: AI không có công cụ, script cố định, môi trường sạch, hộp cát systemd-run trên Linux, hàng đợi, hạn giờ, `permissions.json` phiên bản 1, xưởng "đóng" khi lỗi.

## 17.2 Hiện trạng đã kiểm (đọc mã + máy thật, chỉ đọc)

| Điểm | Thấy gì |
|---|---|
| Skill `2anh-studio` | `E:/Hermes/skills/productivity/2anh-studio/SKILL.md` (VPS: `/root/.hermes/skills/productivity/2anh-studio/`) chỉ là lớp mỏng: trỏ agent tới repo 2Anh Studio (`C:/Users/ADMIN/Downloads/VIBE CODING/PPTmaster`, VPS `/opt/2anh-studio`, GitHub `luonghaianh1208/2anh-studio`) và `AGENTS.vi.md`. Agent **tự chạy lệnh** bằng terminal và gửi tệp bằng `zalo_send_file`, nên hôm nay chỉ chủ nhân dùng được. |
| Bộ dựng của 2Anh Studio | `tools/vi/*.py` nhận **một thư mục dự án chứa một tệp nguồn có ngữ pháp riêng** (`giao-an.md`, `de.md`, `thi-nghiem.md`, `video.md`) và in **một dòng JSON** `{ready, files, warnings, error:{step,message,fix}}`. Nguy hiểm: thí nghiệm `mau: moi` → `kiem_so.py` **chạy `mo-hinh.js` do AI viết bằng Node**. Slide (ppt-master Quick): `project_manager.py init … --quick-generate --dir` → `svg_output/*.svg` (ảnh nằm ở `images/`, trang trỏ `../images/x.png` — chỉ trong dự án) → `compact_svg_styles.py --inplace` → `svg_quality_checker.py … --stage final --json` (lỗi từng trang ở `validation/svg_quality_report.json`) → `svg_to_pptx.py --quick-generate`. |
| Ảnh của 2Anh Studio | Vox: `anh_vox.py <dự án> --chi-ke-hoach` **chỉ lập kế hoạch** (`anh/ai/ke-hoach.json`: mỗi mục `nguon` ve/tim/file, `prompt`, `kich_thuoc`, `file_goc` như `anh/ai/goc/<mã>.png`, `anh/tim-<mã>.jpg`); chạy lại với `--cong-cu --mo-hinh` khi ảnh đã nằm sẵn ở `file_goc` thì **không gọi mạng**, chỉ cắt nền/khung bằng FFmpeg; ảnh `tim:` cần bản ghi nguồn trong `anh/image_sources.json` (`{"items":[{filename, author, license_name, provider}]}`). Vẽ ảnh: `POST {ANH_AI_URL}/images/generations` `{model, prompt, size, n:1}` → `b64_json`/`url`, mặc định 9router `ag/gemini-3.1-flash-image`, khoá `ANH_AI_KEY`. Ảnh web: `image_search.py` dùng Openverse (không cần khoá; giấy phép `by,by-sa,cc0,pdm`). |
| Video | §11 **video bài giảng** từ slide: `notes/<trang>.md` → `notes_to_audio.py --voice vi-VN-HoaiMyNeural` (edge-tts, cần mạng) → `svg_to_pptx.py --with-notes --recorded-narration audio` → `tools/vi/video.py --cach ffmpeg --phu-de hinh --do-phan-giai 720` (Chromium + FFmpeg). §15 **video giải thích** `video_ma.py` từ `video.md`: `viet-tay`, `cat-dan`, `vox` (ảnh như trên); giọng VieNeu "Thu Giang" hoặc edge-tts; Chromium chụp 30 khung/giây, ~1,5 × thời lượng trên 6 lõi; 15–600 giây. VPS: repo cũ (`73109371`, chưa có `anh_vox.py`, `canh-video.md` ở `docs/vi/tro-ly/`), có bản vá cục bộ `co_chromium` (tìm `~/.cache/ms-playwright`). |
| Skill văn bản và trò chơi | `soan-van-ban-hanh-chinh`, `soan-van-ban-dang`: **bộ sinh Node cố định** `engine/generate_*.js --input --output`. `soan-van-ban-doan`: **không có bộ sinh**, có mẫu `assets/mau-van-ban/` (mẫu ưu tiên `Mau-Ke-hoach-Doan-hanh-chinh-ket-hop.docx`: lề 20/20/30/20 mm, bảng đầu 7/9 cm 11,5 pt đậm, `---***---`, `Số: N/KH-ĐTN`, ngày nghiêng cách 6 pt, tên loại 16 pt, thân 14 pt căn đều giãn 1,15 trước/sau 3 pt thụt 1,25 cm, khối ký "TM. BAN CHẤP HÀNH ĐOÀN TRƯỜNG" đậm + "BÍ THƯ" không đậm) và **bộ kiểm** `scripts/validate_van_ban_doan.py` (`validate_document(path, profile="doan")`). `tro-choi-giao-duc`: 6 loại có khuôn (`references/`: trắc nghiệm, ghép đôi, ô chữ, vòng quay, thẻ lật, đếm ngược/trả lời nhanh) + "trò chơi tự mô tả" (không khuôn — AI tự viết JS). `de-kiem-tra`, `skkn-writer`: AI tự viết mã docx. |
| Công cụ của Hermes | `delegate_task` (bộ công cụ ⊆ cha; lượt người ngoài chỉ có `zalo_public`; tác tử con nạp SOUL/bộ nhớ của chủ). Môi trường `terminal` (local/docker/ssh…) — không dùng. **`ctx.llm` (`agent/plugin_llm.py`)**: lời gọi mô hình đang dùng, **không công cụ**, trả `usage.input_tokens/output_tokens`; có ở cả hai máy. |
| Công cụ công khai sẵn có | `zalo_make_file`/`file_maker.py`: chỉ nhận nội dung, dựng trong thư mục tạm, có trần, gửi bằng `_invoke("sendMessage", …)`. `zalo_pdf`/`pdf_tools.py`: tiến trình con có hạn giờ, khoá một việc, giết cả cây. Vòng lặp asyncio của luồng agent **chỉ chạy khi có công cụ đang chạy**. |
| Rào chắn plugin | `guard_member_tool_call` (`pre_tool_call`): `_feature_block` rồi `_member_may_call`. Danh tính ở ContextVar `_TURN`. Sidecar kiểm vai trò `public` đúng hội thoại nguồn + mục `dm`. |
| Hộp cát | **VPS** (Ubuntu 24.04, root, 4 lõi, 3,9 GB): có `systemd-run` (systemd 255), không firejail/bubblewrap; `apparmor_restrict_unprivileged_userns = 1`; Python venv studio là symlink vào `/root/.local/share/uv/python/…`; Chromium ở `/root/.cache/ms-playwright`. **Windows**: không có hộp cát OS dùng được. |

## 17.3 Kiến trúc đã chọn và vì sao

### 17.3.1 Ba phương án

| Phương án | Đánh giá |
|---|---|
| **(a) Tác tử con có quyền chạy skill** | Loại. Skill cần `terminal` + ghi tệp; tác tử có terminal đọc chữ của người ngoài là cài cắm chạy được lệnh. Windows không có hộp cát. Tác tử con nạp SOUL/MEMORY của chủ. |
| **(b) Bộ dựng cố định; AI chỉ viết nội dung có cấu trúc** | **Chọn làm lõi.** AI viết tệp nguồn / JSON / trang SVG / lời xin ảnh trong lời gọi **không công cụ**; plugin kiểm rồi đưa cho script cố định. Chỗ thiếu bộ dựng cố định thì plugin tự có: Word từ Markdown (`file_maker.build_docx`), văn bản Đoàn (`doan_docx.py`), 6 khuôn trò chơi (`games.html`). Ảnh do mã cố định của plugin vẽ/tải. |
| **(c) Hàng đợi do sidecar/dashboard giữ** | Loại phần "ai giữ" (phải cấp khoá AI/ảnh cho tiến trình khác). Giữ ý hàng đợi trong plugin, **luồng riêng** có vòng lặp riêng; dashboard chỉ đọc sổ lượt. |

### 17.3.2 Luồng một việc

```
Người ngoài nhắn "@bot làm slide hô hấp tế bào lớp 10 có ảnh minh hoạ"
  └─ Lượt chat (chỉ zalo_public) ── zalo_studio(kind="slide", brief="…", options={loai})
        ├─ guard_member_tool_call: nút xưởng theo kind (đọc lỗi → CHẶN; Windows: video luôn chặn)
        ├─ zalo_studio: nút + hạn mức (trừ ngay), chụp danh tính từ _TURN, xếp hàng, trả lời ngay
        ▼
  Luồng "zalo-studio" (1 việc/lúc, ≤ 5 chờ, 1 việc/người)
        1. VIẾT   ctx.llm — KHÔNG công cụ; lời nhờ trong <yeu_cau>…</yeu_cau>; ảnh chỉ được XIN:
                  slide: "images": [{"id":"a1","ai":"mô tả"},{"id":"w1","web":"từ khoá"}]
                  Vox: `anh: ve: …` / `anh: tim: …` / `nen: ve: …` → 2Anh Studio lập kế hoạch (hộp cát, không mạng)
        2. KIỂM   validate.py: ngữ pháp, cỡ, chặn lối chạy mã/đọc tệp/ra mạng; lời xin ảnh không chứa đường dẫn/địa chỉ
        3. ẢNH    (tiến trình cha) images.py: vẽ ảnh AI ở cổng của chủ bot / tìm Openverse + tải an toàn
                  → kiểm byte đầu PNG/JPEG, ≤ 8 MB → ghi vào thư mục việc dưới tên do plugin đặt
        4. DỰNG   tiến trình con, dòng lệnh cố định, môi trường không khoá, hạn giờ; Linux: systemd-run nobody,
                  không thấy /root, không mạng (riêng bước giọng đọc/dựng video: có mạng nhưng chặn mạng nội bộ)
                  nội dung sai → AI viết lại đúng 1 lần; trang SVG chỉ được href="img:<mã>" → ../images/<mã>.<đuôi>
        5. GOM    tệp đúng đuôi, trong thư mục việc, dưới trần cỡ, ≤ 4 tệp
        6. GỬI    kiểm lại nút/nhóm/nhắn riêng; _invoke("sendMessage") dưới danh tính đã chụp
        7. GHI    sổ lượt: ok/failed/refunded + token + số ảnh; xoá thư mục việc
```

### 17.3.3 Cài cắm trong lời nhờ bị chặn ở đâu

| Đường tấn công | Chặn |
|---|---|
| Bảo mô hình chat gọi `terminal`/`read_file` | Như cũ: lượt người ngoài chỉ có `zalo_public`; guard chặn tại điểm thực thi. |
| Gửi sang hội thoại khác | `zalo_studio` không có tham số đích; danh tính từ `_TURN`; sidecar kiểm `sourceThreadId`. |
| Lời nhờ đi vào bước VIẾT, bảo "chạy lệnh" | Lời gọi không có `tools` — chỉ trả chữ. |
| Đầu ra AI chứa mã để bộ dựng chạy | Thí nghiệm: chỉ mẫu có sẵn (cấm `moi`). Trò chơi: 6 khuôn cố định do **plugin** chọn theo `options.loai`, dữ liệu JSON thoát `<`, hiển thị bằng `textContent`, trang có CSP `default-src 'none'`, không ảnh/không mạng. Văn bản: JSON kiểu đóng; đường ra do plugin đặt; Đoàn do bộ sinh của plugin dựng. |
| Đầu ra AI trỏ ra tệp/mạng (đọc `.env`, SSRF) | SVG: chỉ thẻ không gian tên SVG; cấm DOCTYPE/ENTITY, script, foreignObject, `<a>`, `<style>`, hoạt hình SMIL (`animate`, `set`, `animateMotion`, `animateTransform`, `mpath`), `on…=`, dấu `\` trong thuộc tính; hàm CSS chỉ trong danh sách cho phép (không `image-set(`, `image(`, `src(`, `element(`…), `url()` chỉ `#id`; `href` chỉ `#id` hoặc `img:<mã>` **có trong danh sách ảnh đã tải** (đổi thành `../images/…`), không ảnh `data:`. Video: `anh`/`nen`/`nhan-vat` và vật `anh` trong nhịp Vox (`nhip: <cụm> | anh: …`) chỉ `ve: <mô tả>` hoặc `tim: <từ khoá>`, cấm `/`, `\`, `..`, `http`, `file:`, `www.`; kế hoạch ảnh của 2Anh Studio bị kiểm lại (chỉ `ve`/`tim`, `file_goc` nằm trong dự án, đuôi `.png/.jpg`, cỡ `WxH`). |
| Lời xin ảnh dùng để tấn công mạng/tốn tiền | Ảnh AI: câu mô tả chỉ là chữ gửi tới cổng vẽ của chủ bot. Ảnh web: chỉ tìm ở `api.openverse.org`; tải kết quả qua `fetch` (https, phân giải rồi kiểm mọi IP là công cộng, nối thẳng IP đã kiểm với SNI/chứng chỉ của tên gốc, ≤ 3 chuyển hướng kiểm lại từng chặng, Content-Type ảnh, ≤ 8 MB, 30 giây). Trần: slide ≤ 4 ảnh AI + 6 ảnh web; video ≤ 12 AI + 8 web. |
| Lộ khoá ảnh/AI | Khoá chỉ dùng ở tiến trình cha; hộp cát không có khoá, không có mạng ở bước xử lý ảnh. |
| Lộ thông tin riêng của chủ bot | Lời gọi VIẾT chỉ có tài liệu công khai + lời nhờ. |
| Lạm dụng tài nguyên | Hạn mức/ngày (trừ ngay), 1 việc/người, 5 chờ, 1 chạy (tối đa 2), hạn giờ, systemd `MemoryMax=1536M CPUQuota=200% TasksMax=256`, slide ≤ 12 trang, video ≤ 180 s 720p. |

## 17.4 Sản phẩm

| Nút | `kind` (`options`) | Bộ dựng | AI viết | Kết quả | Hạn giờ |
|---|---|---|---|---|---|
| `studioSlides` | `slide` (`loai`: bai-giang, bao-cao-tong-ket, hoat-dong-doan, poster-mang-xa-hoi, tap-huan-workshop) | ppt-master Quick + ảnh plugin | dàn ý JSON (+ lời xin ≤ 4 ảnh AI, ≤ 6 ảnh web) + từng trang SVG (≤ 12) | `.pptx` | 900 s |
| `studioDocs` | `giao_an` | `tools/vi/giao_an.py xuat` | `giao-an.md` | `.docx` | 300 s |
| `studioDocs` | `van_ban` | `soan-van-ban-hanh-chinh/engine/generate_*_nd30.js` | JSON | `van-ban.docx` | 120 s |
| `studioDocs` | `van_ban_doan` | **`studio/doan_docx.py`** (plugin) + bộ kiểm `validate_van_ban_doan.py` của skill | JSON (kế hoạch, thông báo, công văn, báo cáo, giấy triệu tập, hướng dẫn, quyết định) | `van-ban-doan.docx` | 120 s |
| `studioDocs` | `van_ban_dang` | `soan-van-ban-dang/engine/generate_*.js` | JSON | `van-ban.docx` | 120 s |
| `studioExams` | `de_kiem_tra`, `skkn` | `file_maker.build_docx` | Markdown | `.docx` | 120 s |
| `studioExams` | `de_tieng_anh` | `tools/vi/de_thi.py` | `de.md` | `.docx` | 300 s |
| `studioExams` | `tro_choi` (`loai`: quiz, matching, crossword, spinwheel, flashcard, timer) | **`studio/games.html`** (plugin) | JSON theo khuôn | `.html` | 60 s |
| `studioExams` | `thi_nghiem` | `tools/vi/thi_nghiem.py` (mẫu có sẵn) | `thi-nghiem.md` | `.html` + `.docx` | 300 s |
| `studioVideo` | `video` (`kieu`: viet-tay, cat-dan, vox) | `video_ma.py`; Vox: `anh_vox.py --chi-ke-hoach` → ảnh plugin → `anh_vox.py --cong-cu --mo-hinh` | `video.md` (≤ 180 s, ép 720p) | `.mp4` ≤ 200 MB | 1800 s |
| `studioVideo` | `video_bai_giang` (`loai` như slide) | slide như trên → lời giảng → `notes_to_audio.py` → `svg_to_pptx --recorded-narration` → `video.py --cach ffmpeg --do-phan-giai 720` | dàn ý, trang, lời giảng từng trang | `.mp4` | 2400 s |

Không có: nhạc nền tải về (`nhac-nen`), ảnh/tệp người dùng có sẵn làm nguồn (`anh: <tệp>`), "trò chơi tự mô tả", thí nghiệm `mau: moi`, đường PowerPoint của video bài giảng (chỉ FFmpeg).

## 17.5 Lược đồ `permissions.json` (vẫn `version: 1`)

```json
{
  "version": 1,
  "defaults": { "features": { "web": true, "studioSlides": true, "studioDocs": true } },
  "groups": { "<id>": { "features": { "studioVideo": true, "studioDocs": false }, "studioQuota": 5 } },
  "dm": { "who": "list", "features": { "studioExams": true },
          "people": { "<uid>": { "features": { "voice": false, "studioSlides": true } } } },
  "studio": { "quota": 3, "people": { "<uid>": { "name": "Cô Lan", "quota": 10 } } }
}
```

- 4 nút xưởng nằm chung `features`, **thiếu khoá = TẮT**. Mặc định và `dm` chỉ ghi nút đang bật; nhóm và người ghi phần khác lớp dưới. Nhóm = tắt ← `defaults` ← `groups[id]`; nhắn riêng = tắt ← `dm` ← `dm.people[uid]`.
- Hạn mức (0–50): `studio.people[uid].quota` ← (trong nhóm) `groups[id].studioQuota` ← `studio.quota` ← 3. 0 = không được nhờ.
- **Windows, hoặc Linux không dùng được hộp cát systemd** (không root, không `systemd-run`, `ZALO_STUDIO_SANDBOX=none`): plugin ép `studioVideo = false` bất kể tệp (`group_permissions.video_policy()`), ghi kết luận + câu ghi chú vào `<HERMES_HOME>/zalo/studio-policy.json` để dashboard khoá nút và hiện đúng câu đó (thiếu tệp = tắt).
- Tương thích: bản v1.21–1.23 chỉ đọc khoá biết → bỏ qua. Dashboard cũ ghi tệp làm rơi khoá xưởng → xưởng tắt (an toàn). Dashboard v1.24 nhận thân PUT thiếu `studio` thì **giữ** nút xưởng đang có.
- **Fail open = xưởng tắt**: không có tệp, tệp hỏng, không đọc được, lỗi bất ngờ → 4 nút tắt (guard và công cụ).

## 17.6 Hộp cát: Linux và Windows

**Linux (VPS) — systemd** (`sandbox.mode() == "systemd"` khi Linux + root + có `systemd-run`):
```
systemd-run --quiet --wait --pipe --collect --service-type=exec --unit=zalo-studio-<mã việc>
  -p User=nobody -p Group=nogroup -p NoNewPrivileges=yes -p PrivateTmp=yes -p PrivateDevices=yes
  -p ProtectSystem=strict -p ProtectHome=tmpfs -p ProtectProc=invisible
  -p ProtectKernelTunables=yes -p ProtectKernelModules=yes -p ProtectKernelLogs=yes -p ProtectControlGroups=yes
  -p RestrictNamespaces=yes -p RestrictSUIDSGID=yes -p LockPersonality=yes -p CapabilityBoundingSet=
  -p RestrictAddressFamilies="AF_INET AF_INET6 AF_UNIX"
  -p MemoryMax=1536M -p CPUQuota=200% -p TasksMax=256 -p RuntimeMaxSec=<hạn giờ>
  -p TemporaryFileSystem=<chỗ bị che>:ro   (/opt /srv /mnt /media, HERMES_HOME, ZALO_SIDECAR_DIR, thư mục chứa các việc, ZALO_STUDIO_HIDE — chỉ thư mục có thật, ngoài /root, /home)
  -p BindPaths=<thư mục việc> -p ReadWritePaths=<thư mục việc>
  -p PrivateNetwork=yes            (bước có mạng — giọng đọc edge-tts, dựng video giải thích: IPAddressDeny=localhost link-local multicast 0/8 10/8 100.64/10 172.16/12 192.168/16 198.18/15 fc00::/7 fe80::/10 fec0::/10 <địa chỉ của chính máy chủ>)
  -p BindReadOnlyPaths=<2Anh Studio> <kho Python uv> [<Chromium>] [<skill văn bản>]   (chỉ thư mục nằm dưới chỗ bị che)
  -p InaccessiblePaths=<thư mục gắn lại>/.env   (nếu có)
  -E <môi trường đã lọc> -- <python|node> <script cố định> <tham số cố định>
```
Đường dẫn cấu hình có khoảng trắng, nháy, `\`, `:`, `%`, `;` → lỗi rõ (`SandboxConfigError`), việc dừng, trả lượt. Hết giờ / huỷ: `systemctl stop zalo-studio-<mã việc>` rồi giết client. Video bài giảng: bước `video.py` (máy chủ xem trước trên 127.0.0.1 + Chromium) chạy KHÔNG mạng → loopback riêng của đơn vị, không đụng 127.0.0.1 của máy.
Thư mục việc `/var/lib/zalo-studio/<id>` (không ở `/tmp`, `/var/tmp` vì `PrivateTmp`), trao cho `nobody` (`chown` không theo liên kết). Trước mỗi bước và khi gom kết quả: liên kết tượng trưng, tệp đặc biệt, liên kết cứng → gỡ, dừng việc, tính lượt. Tiến trình cha chỉ đọc/ghi trong thư mục việc qua `sandbox.read_file`/`write_file` (không theo liên kết, không ra ngoài). Lập kế hoạch ảnh, xử lý ảnh, kiểm slide, xuất PPTX: **không mạng**. Vẽ/tải ảnh: tiến trình cha (không trong hộp cát) qua `images.py`.

**Windows (Lăng Tiêu), và Linux không dùng được systemd — không có hộp cát OS → chính sách cài đặt:** video **luôn tắt** (plugin ép tắt, dashboard khoá nút + ghi chú "Máy chủ Windows không có hộp cát — video tắt" / câu riêng cho Linux không hộp cát). POSIX: bộ dựng chạy trong nhóm tiến trình riêng, hết giờ giết cả nhóm (`killpg`). Các loại khác mặc định tắt cho mọi nhóm (thiếu khoá = tắt) — chủ bot chỉ bật cho nhóm/người tin cậy. Hàng rào còn lại: bước viết không công cụ; `validate.py`; dòng lệnh cố định; môi trường chỉ `PATH`, `SYSTEMROOT`… (không khoá); `TEMP`/`HOME`/`USERPROFILE` vào thư mục việc; hạn giờ + `taskkill /T`; `CREATE_NO_WINDOW`; ảnh vẫn qua `images.py`.

## 17.7 Hàng đợi, giới hạn, dọn dẹp, gửi trả

- `zalo_studio` trả lời ngay; việc chạy trên luồng `zalo-studio`. `ZALO_STUDIO_CONCURRENCY` 1 (tối đa 2), 5 chờ, 1 việc chưa xong/người.
- Trần: lời nhờ 8.000 ký tự; tệp nguồn 60.000; trang SVG 120.000 (không ảnh `data:` — chỉ `img:<mã>`); ảnh ≤ 8 MB, PNG/JPEG, ≤ 8192 px mỗi cạnh, ≤ 40 MP; lời đọc video ≤ 180 s × 18 ký tự/s, ≤ 40 cảnh; slide ≤ 12 trang, ≤ 4 AI + 6 web; video ≤ 180 s, 720p, ≤ 12 AI + 8 web; tệp kết quả 50 MB (mp4 200 MB), ≤ 4 tệp. Lời gọi AI `timeout=300`; vẽ ảnh 150 s; tải ảnh 30 s.
- Nội dung sai → viết lại đúng một lần. Ảnh slide không lấy được → bỏ ảnh đó (trang không được dùng mã của nó) và ghi chú; ảnh Vox không lấy được → việc hỏng, trả lượt.
- Lỗi do máy (thiếu cài đặt, quá giờ, bộ dựng/bộ kiểm hỏng, ảnh không lấy được ở Vox, gửi không được, gateway khởi động lại, chủ bot vừa tắt nút) → trả lượt. Lỗi do nội dung → tính lượt. Lỗi lạ → trả lượt, câu chung.
- Gửi: kiểm lại nút + nhóm "Hoạt động" + `dm_allows`, gửi dưới danh tính đã chụp. "Sidecar không phản hồi" → giữ thư mục 15 phút. Khởi động: việc dở → `refunded`; thư mục việc > 24 giờ → xoá.

## 17.8 Đồng hồ chi phí

- Sổ `<HERMES_HOME>/zalo/studio-usage.json` (600): `days[ngày VN][uid] = {name, jobs, ok, failed, refunded, input_tokens, output_tokens, images, kinds}`, 200 việc gần nhất (kèm `images`). 30 ngày. Tệp hỏng → cất `.hong-<giờ>`; không ghi được → từ chối việc.
- Token từ `usage` của các lời gọi `ctx.llm` của việc; **ảnh** đếm mỗi ảnh vẽ/tải thành công (chi phí vẽ ảnh thuộc cổng vẽ của chủ bot — trần mỗi việc × hạn mức là trần mỗi ngày). Không hiện tiền.
- Dashboard: `GET /api/studio-usage` → mục **"Xưởng tạo sản phẩm"** ở Sức khoẻ máy chủ: hôm nay, bảng 14 ngày theo người (việc, đã gửi, không làm được, trả lượt, token, ảnh), 20 việc gần đây.

## 17.9 Dashboard — Phân quyền Bot

- `GET /api/permissions` thêm `studioFeatures`, `studioPolicy` (`{videoBlocked, note}` theo `process.platform` của máy dashboard — cùng máy với bot), `defaults.studio`, `groups[id].studio` + `studioQuota`, `dm.studio`, `dm.people[].studio`, `studio: {quota, people}`.
- `PUT` nhóm/mặc định/nhắn riêng nhận thêm `studio` (và nhóm `studioQuota`); mới `PUT /api/permissions/studio`. Nhật ký `permissions_studio` "Đổi hạn mức xưởng tạo sản phẩm"; dòng Nhật ký nhóm/mặc định/nhắn riêng thêm "xưởng: …".
- Giao diện: hộp gập **"Xưởng tạo sản phẩm"** (4 nút) ở Mặc định, nhóm (+ ô số lượt), Nhắn riêng, từng người; trên Windows nút Video tắt, khoá, gợi ý "Máy chủ Windows không có hộp cát — video tắt". Mục **"Hạn mức xưởng"**. CSP giữ nguyên.

## 17.10 Cấu hình trên máy bot (`.env` của Hermes)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `ZALO_STUDIO_DIR` | (trống = chỉ còn loại không cần 2Anh Studio) | Repo 2Anh Studio |
| `ZALO_STUDIO_PYTHON` | `<dir>/venv/Scripts/python.exe` hoặc `<dir>/venv/bin/python` | Python của venv studio |
| `ZALO_STUDIO_SKILLS_DIR` | `<HERMES_HOME>/skills` | Skill văn bản, đề, SKKN, trò chơi |
| `ZALO_STUDIO_IMAGE_URL` | `ANH_AI_URL` hoặc `http://127.0.0.1:20128/v1` | Cổng vẽ ảnh AI (OpenAI `images/generations`) |
| `ZALO_STUDIO_IMAGE_MODEL` | `ANH_AI_MO_HINH` hoặc `ag/gemini-3.1-flash-image` | Mô hình vẽ |
| `ANH_AI_KEY` | — | Khoá cổng vẽ (chỉ tiến trình cha dùng) |
| `ZALO_STUDIO_WORK` | Linux `/var/lib/zalo-studio`, Windows `%TEMP%\zalo-studio` | Thư mục việc |
| `ZALO_STUDIO_SANDBOX` | `auto` | `none` tắt hộp cát (chỉ gỡ lỗi) |
| `ZALO_STUDIO_CONCURRENCY` | `1` | Tối đa 2 |
| `ZALO_STUDIO_BIND` | — | Thư mục chỉ đọc thêm cho hộp cát |
| `ZALO_SIDECAR_DIR` | — | Thư mục cài sidecar (`.env`, `data/` của bot) — che khỏi hộp cát nếu không nằm dưới `/root`, `/home`, `/opt`, `/srv`, `/mnt`, `/media` |
| `ZALO_STUDIO_HIDE` | — | Thư mục che thêm khỏi hộp cát (cách nhau bằng dấu phẩy) |
| `PLAYWRIGHT_BROWSERS_PATH` | Linux `~/.cache/ms-playwright`, Windows `%LOCALAPPDATA%\ms-playwright` | Chromium cho video |

## 17.11 Triển khai

- **Plugin Hermes** (`zalo_tools/` gồm thư mục `studio/` có `games.html`; `zalo/adapter.py`; hai `plugin.yaml`) → khởi động lại gateway. **Kết nối Zalo** (`dm-rules.js`). **Dashboard** (Task 12). Cả ba cùng lúc, trước khi ai bật nút xưởng.
- **VPS — 2Anh Studio:** cập nhật `/opt/2anh-studio` lên cùng commit với local (stash/pop bản vá `video_ma.py`), cài lại phụ thuộc nếu `doctor.py` báo, kiểm `anh_vox.py`, `tools/vi/video.py`, `skills/ppt-master/scripts/notes_to_audio.py` có mặt; Chromium Playwright có ở `/root/.cache/ms-playwright`; FFmpeg có. Đặt biến §17.10 (cả `ANH_AI_KEY` nếu 9router đòi khoá).
- **Kiểm thật hộp cát** trên VPS (đơn vị tạm chạy bằng `nobody`, không đọc được `/root/.hermes/.env`), rồi mỗi loại một việc bằng tài khoản phụ.

## 17.12 Còn để ngỏ

Không còn quyết định nào chờ người dùng. Giai đoạn sau (không làm ở đây): Job Object giới hạn RAM trên Windows; nhạc nền có nguồn; dùng ảnh/tệp người dùng gửi làm nguồn; trò chơi khác ngoài 6 khuôn.

## 17.13 Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Bộ dựng 2Anh Studio có lỗi đọc đường dẫn lạ | Linux: hộp cát; mọi nơi: `validate.py`; Windows: video tắt, chỉ nhóm tin cậy |
| Chi phí ảnh AI | Trần mỗi việc (slide 4, video 12) × hạn mức/ngày; sổ đếm ảnh theo người; xem ở Sức khoẻ máy chủ |
| Ảnh web có bản quyền | Chỉ Openverse giấy phép `by, by-sa, cc0, pdm`; ghi tác giả + giấy phép (slide: chữ nhỏ dưới ảnh; video: `image_sources.json` → dòng nguồn) |
| Đổi DNS giữa lúc kiểm và lúc nối (DNS rebinding) | Nối thẳng IP đã kiểm, SNI/chứng chỉ theo tên gốc; kiểm lại mỗi chuyển hướng |
| Cổng vẽ ảnh của 9router lỗi/hết hạn mức | Slide: bỏ ảnh đó, ghi chú; Vox: việc hỏng, trả lượt |
| Video nặng trên VPS 4 lõi/3,9 GB | 1 việc/lúc, `MemoryMax`, `CPUQuota`, ≤ 180 s 720p |
| `systemd-run` trong `hermes-gateway` bị từ chối | Kiểm thật ở triển khai; không bật cho khách tới khi sửa; không tự đặt `ZALO_STUDIO_SANDBOX=none` |
| Repo studio hai máy lệch | Công thức thử nhiều đường dẫn hướng dẫn; cập nhật VPS khi triển khai |
| Chất lượng nội dung/slide do mô hình viết | Sửa 1 vòng theo báo lỗi; vẫn hỏng thì báo |
