# Dashboard v2 — §17 Giai đoạn 6: Xưởng tạo sản phẩm

**Ngày:** 2026-10-07
**Trạng thái:** Quyết định của người dùng đã chốt (§17.1); thiết kế bên dưới chờ duyệt bản viết
**Dự án:** 2anh-zalo-bot (từ v1.23.1 → v1.24.0)
**Bổ sung cho:** `2026-10-07-zalo-dashboard-v2-design.md` (§1–§15) và `2026-10-07-dashboard-v2-phase5-addendum.md` (§16). Tệp này là §17.

## 17.1 Quyết định của người dùng (bắt buộc)

1. Người **không phải chủ nhân** — thành viên nhóm, và người nhắn riêng mà mục `dm` (§16) cho phép — được nhờ bot làm sản phẩm bằng tài nguyên AI của chủ bot, để khách dùng thử:
   1. **Slide PPTX đẹp** (2Anh Studio: bài giảng, báo cáo, hoạt động Đoàn, poster, tập huấn).
   2. **Văn bản và giáo án** (văn bản hành chính NĐ30, văn bản Đoàn/Đảng, giáo án 5512, kế hoạch bài dạy).
   3. **Đề thi, SKKN, trò chơi giáo dục / thí nghiệm ảo** (HTML + phiếu Word).
   4. **Video**, bằng chính khả năng làm video của 2Anh Studio.
2. Mỗi loại là **một nút bật/tắt riêng** ở cả Phân quyền nhóm lẫn Nhắn riêng (mặc định, từng nhóm, từng người), cạnh các nút tính năng sẵn có.
3. **Hạn mức theo người theo ngày**, sửa trên dashboard: một số mặc định, ghi đè được theo nhóm và theo người. Chủ nhân không giới hạn.
4. **Yêu cầu an toàn cứng:** người không phải chủ nhân KHÔNG BAO GIỜ có terminal, đọc/ghi tệp hệ thống, `.env`/khoá, hay chạy lệnh tuỳ ý — trực tiếp hay gián tiếp, kể cả qua câu cài cắm trong lời nhờ khiến một tác tử có quyền cao chạy lệnh.

## 17.2 Hiện trạng đã kiểm (đọc mã + máy thật, chỉ đọc)

| Điểm | Thấy gì |
|---|---|
| Skill `2anh-studio` | `E:/Hermes/skills/productivity/2anh-studio/SKILL.md` (VPS: `/root/.hermes/skills/productivity/2anh-studio/`) chỉ là lớp mỏng: trỏ agent tới repo 2Anh Studio (`C:/Users/ADMIN/Downloads/VIBE CODING/PPTmaster`, VPS `/opt/2anh-studio`, GitHub `luonghaianh1208/2anh-studio`) và `AGENTS.vi.md`. Agent **tự chạy lệnh** bằng terminal: `tools/vi/doctor.py`, `giao_an.py xuat`, `de_thi.py`, `thi_nghiem.py`, và quy trình `skills/ppt-master` (agent tự viết từng trang SVG, chạy `svg_quality_checker.py`, `svg_to_pptx.py`). Gửi tệp bằng `zalo_send_file`. Vì cần terminal nên hôm nay **chỉ chủ nhân** dùng được. Văn bản NĐ30/Đoàn/Đảng đã chuyển sang skill `soan-van-ban-hanh-chinh`/`-doan`/`-dang`. |
| Bộ dựng của 2Anh Studio | Mỗi công cụ `tools/vi/*.py` nhận **một thư mục dự án chứa một tệp nguồn văn bản có ngữ pháp riêng** (`giao-an.md`, `de.md`, `thi-nghiem.md`, `video.md`) và in **đúng một dòng JSON** `{ready, files, warnings, error:{step,message,fix}}`. Không đọc tệp nào ngoài thư mục đó và repo. Ngoại lệ nguy hiểm: thí nghiệm `mau: moi` bắt agent viết `mo-hinh.js` rồi `kiem_so.py` **chạy JS đó bằng Node** trên máy chủ. Slide: `project_manager.py init <tên> --quick-generate --dir <thư mục>` → `svg_output/*.svg` → `svg_quality_checker.py … --quick-generate --canonical-authoring --stage final --json` (báo lỗi từng trang ở `validation/svg_quality_report.json`) → `svg_to_pptx.py … --quick-generate --no-notes` → `exports/*.pptx`; ảnh ngoài chỉ nhận đường dẫn **trong dự án**. Đã chạy thử thật trên máy local (AI giả): thí nghiệm con lắc ra `thi-nghiem.html` + `phieu-hoc-tap.docx`; 2 trang SVG ra `.pptx` 14 KB. |
| Skill văn bản | `soan-van-ban-hanh-chinh` và `soan-van-ban-dang` có **bộ sinh Node cố định** `engine/generate_*.js --input x.json --output y.docx` (gói `docx` trong `node_modules`), chạy thử thật ra `.docx` từ ví dụ trong `assets/examples/`. `soan-van-ban-doan`, `de-kiem-tra`, `skkn-writer`, `tro-choi-giao-duc` **không có bộ sinh cố định** — skill bảo agent tự viết mã docx/HTML. |
| Video | Hai đường: §11 video bài giảng từ slide (PPTX gắn tiếng → `video.py`, đường PowerPoint chỉ Windows và mở cửa sổ PowerPoint; đường FFmpeg cần Chromium) và §15 **video giải thích** `video_ma.py <thư mục>` từ `video.md`: kiểu `viet-tay` (bảng viết tay, cảnh dựng bằng mã), `cat-dan`, `vox` (cần ảnh AI qua `anh_vox.py` gọi 9router `ag/gemini-3.1-flash-image` bằng `ANH_AI_KEY`, ảnh thật tải từ web, nhạc Openverse). Giọng: VieNeu "Thu Giang" (chạy tại máy) hoặc edge-tts (cần mạng). Dựng bằng nhiều tiến trình Chromium chụp 30 khung/giây, khoảng 1,5 × thời lượng trên máy 6 lõi; thời lượng 15–600 giây. Skill `2anh-studio` hôm nay **từ chối video qua Zalo**. VPS: repo cũ hơn (`73109371`, chưa có `anh_vox.py`, `canh-video.md` nằm ở `docs/vi/tro-ly/`), giữ một bản vá cục bộ cho `co_chromium` (tìm `~/.cache/ms-playwright`). |
| Công cụ của Hermes | `delegate_task` (tác tử con, bộ công cụ ⊆ cha) — lượt người ngoài chỉ có `zalo_public` nên không gọi được, và tác tử con nạp SOUL/bộ nhớ của chủ bot. `toolsets_for_source` của adapter cho người ngoài đúng `zalo_public`. Môi trường chạy lệnh (`tools/environments/`: local, docker, ssh, modal…) là của `terminal` — không dùng. **`ctx.llm` (`agent/plugin_llm.py`)**: plugin gọi được mô hình đang dùng của chủ bot (`acomplete(messages, max_tokens, timeout, purpose)`), **không có công cụ**, trả `usage.input_tokens/output_tokens`; có ở cả Lăng Tiêu lẫn Uyển Nhi. |
| Công cụ công khai an toàn sẵn có | `zalo_make_file` / `file_maker.py`: chỉ nhận **nội dung** (Markdown, danh sách slide, bảng), dựng trong `tempfile.mkdtemp`, trần kích thước, gửi bằng `_invoke("sendMessage", [{msg, attachments}, thread, type])` rồi xoá. `zalo_pdf`/`pdf_tools.py`: chạy việc nặng trong **tiến trình con** có hạn giờ, khoá một việc một lúc, giết cả cây khi quá giờ, chỉ nhận tệp trong `turn["attachments"]`. Lỗi "Sidecar không phản hồi" → giữ tệp 15 phút (`media.schedule_cleanup`). |
| Rào chắn plugin | `guard_member_tool_call` (hook `pre_tool_call`): lượt không phải của riêng chủ nhân → `_feature_block` (nút nhóm / `dm`) rồi `_member_may_call` (chỉ `zalo_public`, `tool_search`, MCP mở tường minh). Danh tính lượt nằm ở ContextVar `_TURN`, gắn lại mỗi lượt trong `toolsets_for_source`. Sidecar kiểm thêm: vai trò `public` chỉ thao tác **đúng hội thoại nguồn** (`sourceThreadId`) và mục `dm`. Lưu ý: vòng lặp asyncio của luồng agent **chỉ chạy khi có công cụ đang chạy** — việc nền gắn vào đó sẽ đứng im. |
| Hộp cát | **VPS (Ubuntu 24.04, mọi dịch vụ chạy bằng root, 4 lõi, RAM 3,9 GB):** có `systemd-run` (systemd 255), `unshare`, `prlimit`; **không** có firejail/bubblewrap/nsjail; `kernel.apparmor_restrict_unprivileged_userns = 1`. Python của venv studio là **symlink vào `/root/.local/share/uv/python/…`** (0700 dưới `/root`); Chromium ở `/root/.cache/ms-playwright`. **Windows (Lăng Tiêu):** không có hộp cát của hệ điều hành dùng được mà không cần tài khoản riêng/mật khẩu. |

## 17.3 Kiến trúc đã chọn và vì sao

### 17.3.1 Ba phương án

| Phương án | Đánh giá |
|---|---|
| **(a) Tác tử con có quyền chạy skill 2Anh Studio**, lời nhờ đưa vào như dữ liệu | Loại. Skill như đang viết cần `terminal` + ghi tệp. Một tác tử có terminal mà đọc chữ của người ngoài thì cài cắm là chạy được lệnh; "dặn đừng nghe theo" không phải rào chắn. Hộp cát OS chỉ có trên Linux; trên Windows thì không có gì đỡ. Tác tử con còn nạp SOUL/MEMORY của chủ bot. |
| **(b) Bộ dựng cố định; AI chỉ viết nội dung có cấu trúc** | **Chọn làm lõi.** Phần lớn 2Anh Studio đã là bộ dựng cố định nhận một tệp nguồn (§17.2). AI viết tệp đó trong một lời gọi **không có công cụ nào**; plugin kiểm rồi đưa cho script cố định. Thiếu bộ dựng cố định (đề GDPT, SKKN, trò chơi) thì dùng bộ dựng sẵn trong plugin (`file_maker.build_docx`) hoặc khuôn HTML cố định. |
| **(c) Hàng đợi do sidecar/dashboard giữ** | Loại phần "ai giữ". Sidecar (Node) và dashboard không có `ctx.llm`, khoá, Python của studio; thêm một tiến trình phải cấp khoá AI là thêm chỗ lộ. Giữ ý **hàng đợi**, nhưng đặt trong plugin (tiến trình gateway) trên **một luồng riêng** có vòng lặp asyncio của nó. Dashboard chỉ đọc sổ lượt. |

### 17.3.2 Luồng một việc

```
Người ngoài nhắn "@bot làm slide hô hấp tế bào lớp 10"
  └─ Lượt chat (chỉ zalo_public) ── gọi zalo_studio(kind="slide", brief="…", options={loai})
        ├─ guard_member_tool_call: nút xưởng theo kind (đọc lỗi → CHẶN)
        ├─ zalo_studio: kiểm nút + hạn mức (sổ lượt, trừ ngay), chụp danh tính từ _TURN
        │   (không bao giờ lấy thread_id/uid từ tham số), xếp hàng → trả lời ngay "đã nhận"
        ▼
  Luồng "zalo-studio" (1 việc một lúc, tối đa 5 việc chờ, mỗi người 1 việc)
        1. VIẾT   ctx.llm.acomplete — KHÔNG công cụ; hướng dẫn = tài liệu công khai của studio/skill;
                  lời nhờ nằm trong <yeu_cau>…</yeu_cau> (người dùng không tự đóng khối được)
        2. KIỂM   validate.py: cỡ, ngữ pháp, chặn mọi lối chạy mã / đọc tệp / ra mạng (§17.4)
        3. DỰNG   tiến trình con, dòng lệnh cố định, thư mục việc riêng, môi trường lọc khoá, hạn giờ;
                  Linux: systemd-run, user nobody, không thấy /root, không mạng (§17.6)
                  nội dung sai → AI viết lại đúng 1 lần với thông báo lỗi
        4. GOM    chỉ tệp đúng đuôi, nằm trong thư mục việc, dưới trần cỡ, ≤ 4 tệp
        5. GỬI    kiểm lại nút/nhóm/nhắn riêng; _invoke("sendMessage") dưới danh tính đã chụp
                  → sidecar vẫn kiểm cùng-hội-thoại + quyền nhắn riêng
        6. GHI    sổ lượt: ok/failed/refunded + token; xoá thư mục việc
```

### 17.3.3 Cài cắm trong lời nhờ bị chặn ở đâu

| Đường tấn công | Chặn |
|---|---|
| Lời nhờ bảo mô hình chat gọi `terminal`/`read_file` | Như cũ: lượt người ngoài chỉ có `zalo_public`; `guard_member_tool_call` chặn tại điểm thực thi. |
| Lời nhờ bảo mô hình chat gửi tệp/kết quả sang hội thoại khác | `zalo_studio` không có tham số đích; danh tính lấy từ `_TURN`; sidecar kiểm `sourceThreadId`. |
| Lời nhờ đi vào bước VIẾT và bảo "chạy lệnh…" | Bước VIẾT là lời gọi chat không có `tools` — không có gì để chạy. Đầu ra chỉ là chữ. |
| Đầu ra AI chứa mã để bộ dựng chạy | Thí nghiệm: chỉ mẫu có sẵn (`mau` phải nằm trong `mo_hinh/*.json`, cấm `moi`) — Node chỉ chạy JS của repo. Video: cấm `anh`, `nen`, `nen-canh`, `nhac-nen`, nhân vật AI, cảnh `anh`/`ke-chuyen`, `mau: moi`. Trò chơi: khuôn HTML cố định, dữ liệu là JSON thoát `<`, hiển thị bằng `textContent`. Văn bản Node: JSON đúng kiểu, `loai_van_ban` trong danh sách, bỏ khoá `output_path`; đường ra do plugin đặt. |
| Đầu ra AI trỏ ra tệp/mạng (đọc `.env`, SSRF) | SVG: cấm DOCTYPE/ENTITY, `<script>`, `<foreignObject>`, `<a>`, `on…=`, `href`/`url()` khác `#id` và ảnh `data:` PNG/JPEG/GIF/WebP. Bộ dựng chạy với môi trường không có khoá; Linux không thấy `/root` và không có mạng (video: có mạng nhưng chặn 127.0.0.1 + mạng nội bộ — không gọi được 9router, dashboard, sidecar). |
| Đầu ra AI để lộ thông tin riêng của chủ bot | Lời gọi VIẾT không có SOUL/MEMORY/lịch sử chat — chỉ tài liệu công khai + lời nhờ. |
| Tệp phishing gửi cho học sinh | Không cho `<a>` trong slide; trò chơi không có liên kết; HTML thí nghiệm do studio dựng (bộ dựng tự chặn địa chỉ web). |
| Lạm dụng tài nguyên | Hạn mức theo người/ngày (trừ ngay khi nhận), 1 việc/người, 5 việc chờ, 1 việc chạy (tối đa 2), hạn giờ từng loại, systemd `MemoryMax=1536M CPUQuota=200% TasksMax=256`, slide ≤ 12 trang, video ≤ 120 giây 720p. |

## 17.4 Sản phẩm

| Nút | `kind` | Bộ dựng | Tệp nguồn AI viết | Kết quả | Hạn giờ |
|---|---|---|---|---|---|
| `studioSlides` | `slide` (`loai`: bai-giang, bao-cao-tong-ket, hoat-dong-doan, poster-mang-xa-hoi, tap-huan-workshop) | ppt-master Quick: `attribution_guard` → `init --quick-generate --dir` → trang SVG → `compact_svg_styles --inplace` → `svg_quality_checker` (sửa trang lỗi 1 lần) → `svg_to_pptx --no-notes` | dàn ý JSON + từng trang SVG (≤ 12) | `.pptx` | 900 s |
| `studioDocs` | `giao_an` | `tools/vi/giao_an.py xuat` | `giao-an.md` | `.docx` | 300 s |
| `studioDocs` | `van_ban` | `soan-van-ban-hanh-chinh/engine/generate_*_nd30.js` | `noi-dung.json` | `van-ban.docx` | 120 s |
| `studioDocs` | `van_ban_dang` | `soan-van-ban-dang/engine/generate_*.js` | `noi-dung.json` | `van-ban.docx` | 120 s |
| `studioExams` | `de_kiem_tra` | `file_maker.build_docx` (trong plugin) | Markdown theo `de-kiem-tra/SKILL.md` | `.docx` | 120 s |
| `studioExams` | `de_tieng_anh` | `tools/vi/de_thi.py` | `de.md` | `.docx` | 300 s |
| `studioExams` | `skkn` | `file_maker.build_docx` | Markdown theo `skkn-writer` | `.docx` | 120 s |
| `studioExams` | `tro_choi` | khuôn `studio/quiz.html` (trong plugin) | JSON trắc nghiệm ≤ 30 câu | `.html` | 60 s |
| `studioExams` | `thi_nghiem` | `tools/vi/thi_nghiem.py` (mẫu có sẵn) | `thi-nghiem.md` | `.html` + `.docx` | 300 s |
| `studioVideo` | `video` | `tools/vi/video_ma.py`, `phong-cach: viet-tay` | `video.md` (≤ 120 s, ép 720p) | `.mp4` ≤ 200 MB | 1800 s |

Không có trong giai đoạn này: **văn bản Đoàn** (skill không có bộ sinh cố định — bot nói rõ "cần chủ bot làm"), trò chơi khác trắc nghiệm, ảnh trong slide/video (ảnh AI, ảnh web), nhạc nền, video Vox/cắt dán, video từ slide, tệp người dùng gửi kèm làm nguồn (mô hình chat chép chữ từ ảnh vào `brief`).

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

- 4 nút xưởng nằm **chung `features`** với 9/8 nút cũ, nhưng **thiếu khoá = TẮT** (nút cũ: thiếu = bật). Mặc định và `dm` chỉ ghi nút đang bật; nhóm và người ghi phần khác lớp dưới.
- Gộp nút: nhóm = tắt ← `defaults` ← `groups[id]`; nhắn riêng = tắt ← `dm` ← `dm.people[uid]` (nút mặc định nhóm không áp cho nhắn riêng).
- Hạn mức (số nguyên 0–50): `studio.people[uid].quota` ← (trong nhóm) `groups[id].studioQuota` ← `studio.quota` ← 3. Người có hạn mức riêng thì thắng ở mọi nơi. 0 = không được nhờ.
- Tương thích: plugin/dashboard v1.21–1.23 chỉ đọc khoá biết → bỏ qua tất cả (xưởng không tồn tại với họ). Dashboard cũ **ghi** tệp làm rơi khoá xưởng → xưởng tắt (an toàn). Dashboard v1.24 nhận thân PUT thiếu `studio` (trang cũ còn trong trình duyệt) thì **giữ** nút xưởng đang có.
- **Fail open về hành vi cũ = xưởng tắt**: không có tệp, tệp hỏng, không đọc được, lỗi bất ngờ khi đọc quyền xưởng → cả 4 nút tắt (trong `guard` lẫn trong công cụ). Đây là chỗ duy nhất plugin "đóng" khi lỗi; mọi nút cũ giữ nguyên cách "mở".

## 17.6 Hộp cát: Linux và Windows

**Linux (VPS) — hộp cát thật bằng systemd** (`sandbox.mode() == "systemd"` khi Linux + root + có `systemd-run`):
```
systemd-run --quiet --wait --pipe --collect --service-type=exec
  -p User=nobody -p Group=nogroup -p NoNewPrivileges=yes -p PrivateTmp=yes -p PrivateDevices=yes
  -p ProtectSystem=strict -p ProtectHome=tmpfs -p ReadWritePaths=<thư mục việc>
  -p ProtectKernelTunables=yes -p ProtectKernelModules=yes -p ProtectControlGroups=yes
  -p RestrictSUIDSGID=yes -p LockPersonality=yes -p CapabilityBoundingSet=
  -p MemoryMax=1536M -p CPUQuota=200% -p TasksMax=256 -p RuntimeMaxSec=<hạn giờ>
  -p PrivateNetwork=yes            (video: IPAddressDeny=localhost link-local multicast 10/8 172.16/12 192.168/16 100.64/10)
  -p BindReadOnlyPaths=<kho Python uv> [<Chromium>] [<skill văn bản>]   (chỉ thư mục nằm dưới /root, /home)
  -E <môi trường đã lọc> -- <python|node> <script cố định> <tham số cố định>
```
- Thư mục việc ở `/var/lib/zalo-studio/<id>` (không ở `/tmp`, `/var/tmp` vì `PrivateTmp`), trao cho `nobody`, cha 0711.
- `nobody` không đọc được tệp 0600 của root; `/root` (chứa `.hermes/.env`, `state.db`) thay bằng tmpfs rỗng; chỉ gắn lại chỉ đọc từng thư mục bộ dựng cần.
- `ZALO_STUDIO_SANDBOX=none` tắt hộp cát (chỉ để gỡ lỗi); `ZALO_STUDIO_BIND` thêm thư mục chỉ đọc cho cách cài lạ.

**Windows (Lăng Tiêu) — không có hộp cát của hệ điều hành.** Hàng rào còn lại, theo thứ tự quan trọng: (1) bước viết không có công cụ; (2) `validate.py` chặn mọi lối chạy mã/đọc tệp/ra mạng đã biết của bộ dựng; (3) dòng lệnh cố định, không qua shell; (4) môi trường chỉ còn `PATH`, `SYSTEMROOT`… (không khoá), `TEMP`/`HOME`/`USERPROFILE` trỏ vào thư mục việc; (5) hạn giờ + `taskkill /T`; (6) `CREATE_NO_WINDOW`. Rủi ro còn lại: một lỗi trong bộ dựng của 2Anh Studio (đọc đường dẫn lạ từ tệp nguồn) chưa được hệ điều hành đỡ. Khuyến nghị (§17.12): mở xưởng cho khách chủ yếu trên VPS; trên Windows để **Video tắt** và chỉ bật cho nhóm tin cậy. Job Object giới hạn RAM trên Windows ghi lại làm việc sau.

## 17.7 Hàng đợi, giới hạn, dọn dẹp, gửi trả

- `zalo_studio` trả lời ngay (`status: queued`, vị trí, số lượt còn); việc chạy trên luồng `zalo-studio` (vòng lặp riêng). `ZALO_STUDIO_CONCURRENCY` 1 (tối đa 2), 5 việc chờ, mỗi người 1 việc chưa xong.
- Trần: lời nhờ 8.000 ký tự; tệp nguồn 60.000; trang SVG 120.000 (+1,5 MB ảnh nhúng); tệp kết quả 50 MB (mp4 200 MB); ≤ 4 tệp; slide ≤ 12 trang; video ≤ 120 s.
- Mỗi lời gọi AI: `timeout=300`, `max_tokens` 16.000 (trang SVG 12.000; dàn ý 6.000). Nội dung sai → viết lại **đúng một lần**.
- Lỗi do **máy** (thiếu cài đặt, quá giờ, bộ dựng hỏng, gửi không được, gateway khởi động lại, chủ bot vừa tắt nút) → **trả lượt** và báo "Lượt này không bị trừ". Lỗi do **nội dung** (viết lại vẫn sai) → tính lượt. Lỗi lạ → trả lượt, báo câu chung (không lộ đường dẫn/traceback).
- Gửi: kiểm lại nút + nhóm còn "Hoạt động" + `dm_allows`, rồi `_invoke("sendMessage", [{msg, attachments}, thread, type])` dưới **danh tính chụp lúc nhận việc** (đặt `_TURN` trong tác vụ nền, trả lại sau). "Sidecar không phản hồi" → giữ thư mục 15 phút rồi xoá. Còn lại xoá ngay.
- Khởi động: việc còn `queued/running` trong sổ → `refunded` ("gateway khởi động lại"); thư mục việc cũ hơn 24 giờ → xoá.

## 17.8 Đồng hồ chi phí

- Sổ `<HERMES_HOME>/zalo/studio-usage.json` (600, plugin ghi, ghi nguyên tử): `days[YYYY-MM-DD giờ VN][uid] = {name, jobs, ok, failed, refunded, input_tokens, output_tokens, kinds}`, `jobs` (200 việc gần nhất). Giữ 30 ngày. Tệp hỏng → cất `.hong-<giờ>`, bắt đầu sổ mới. Không ghi được → từ chối việc.
- Token lấy từ `usage` của chính các lời gọi `ctx.llm` của việc đó — số đúng cho riêng xưởng (khác §16.4.4 là tổng toàn trợ lý). Không hiện tiền (lý do như §16.4.4).
- Dashboard: `GET /api/studio-usage` (cả hai vai trò, chỉ đọc) → mục **"Xưởng tạo sản phẩm"** ở trang Sức khoẻ máy chủ: hôm nay, bảng 14 ngày theo người (việc, đã gửi, không làm được, trả lượt, token), 20 việc gần đây.

## 17.9 Dashboard — Phân quyền Bot

- `GET /api/permissions` thêm `studioFeatures` (4 nút, nhãn + gợi ý), `defaults.studio`, `groups[id].studio` + `studioQuota` (số | null), `dm.studio`, `dm.people[].studio`, `studio: { quota, people: [{uid, name, quota}] }`.
- `PUT /api/permissions/defaults|groups/:id`: thêm `studio` (đủ 4 boolean, tuỳ chọn) và (nhóm) `studioQuota` (0–50 | null). `PUT /api/permissions/dm`: `studio` chung và `people[].studio`. Mới `PUT /api/permissions/studio` `{quota, people:[{uid, name?, quota}]}` (≤ 500 người, UID theo `ZALO_UID`) — `requireAuth`, cả hai vai trò (như §6 Phân quyền), Nhật ký `permissions_studio` "Đổi hạn mức xưởng tạo sản phẩm". Dòng Nhật ký nhóm/mặc định/nhắn riêng thêm "xưởng: …".
- Giao diện: hộp gập **"Xưởng tạo sản phẩm"** (4 nút + câu giải thích tốn tài nguyên AI) trong Mặc định, từng nhóm (kèm ô "Số lượt mỗi người mỗi ngày", trống = theo mặc định) và Nhắn riêng; người có "tính năng riêng" có thêm 4 nút xưởng. Mục mới **"Hạn mức xưởng"** ở đầu danh sách trái: số mặc định + danh sách người có hạn mức riêng (chọn nhanh từ người đã biết hoặc nhập UID). Dùng lại hộp `perm-box`, hàng gập kiểu `dm-person`, thanh Lưu dính. CSP: không `style=`, không `innerHTML`.

## 17.10 Cấu hình trên máy bot (`.env` của Hermes)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `ZALO_STUDIO_DIR` | (trống = xưởng chỉ còn loại không cần 2Anh Studio) | Repo 2Anh Studio: Lăng Tiêu `C:/Users/ADMIN/Downloads/VIBE CODING/PPTmaster`, Uyển Nhi `/opt/2anh-studio` |
| `ZALO_STUDIO_PYTHON` | `<dir>/venv/Scripts/python.exe` hoặc `<dir>/venv/bin/python` | Python của venv studio |
| `ZALO_STUDIO_SKILLS_DIR` | `<HERMES_HOME>/skills` | Skill văn bản, đề, SKKN, trò chơi |
| `ZALO_STUDIO_WORK` | Linux `/var/lib/zalo-studio`, Windows `%TEMP%\zalo-studio` | Thư mục việc |
| `ZALO_STUDIO_SANDBOX` | `auto` | `none` để tắt hộp cát (gỡ lỗi) |
| `ZALO_STUDIO_CONCURRENCY` | `1` | Tối đa 2 |
| `ZALO_STUDIO_BIND` | — | Thư mục chỉ đọc thêm cho hộp cát |

Hermes cũ không có `ctx.llm` → việc hỏng "Hermes chưa hỗ trợ", trả lượt.

## 17.11 Triển khai

- **Plugin Hermes**: `zalo_tools/` (thêm thư mục `studio/`), `zalo/adapter.py`, hai `plugin.yaml` → khởi động lại gateway.
- **Kết nối Zalo**: `dm-rules.js` (giữ khoá xưởng khi chuẩn hoá) → khởi động lại `zalo-bridge`.
- **Dashboard**: danh sách ở Task 11 → khởi động lại `zalo-dashboard`.
- Cả ba lên cùng lúc, **trước** khi ai bật nút xưởng. VPS: cập nhật `/opt/2anh-studio` lên cùng commit với local (stash/pop bản vá `video_ma.py`), đặt biến §17.10, chạy thử một việc mỗi loại bằng tài khoản không phải chủ nhân.

## 17.12 Cần người dùng xác nhận

1. **Văn bản Đoàn** chưa làm cho người ngoài (skill không có bộ sinh cố định). Làm bộ sinh cố định cho Đoàn là một việc riêng.
2. **Slide và video không có ảnh** (chỉ hình khối, chữ, gradient, ảnh `data:`). Mở ảnh web/ảnh AI cho người ngoài cần thêm mạng và khoá ảnh trong hộp cát — để giai đoạn sau.
3. **Video chỉ kiểu viết tay, ≤ 2 phút, 720p**; mặc định tắt. Trên VPS 4 lõi/3,9 GB một video 2 phút chiếm máy khoảng 3–5 phút.
4. **Windows không có hộp cát của hệ điều hành** (§17.6). Đề xuất: Lăng Tiêu chỉ bật xưởng cho nhóm tin cậy, Video tắt.
5. Hạn mức mặc định **3 việc/người/ngày**, việc hỏng vì nội dung vẫn tính lượt.

## 17.13 Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Bộ dựng 2Anh Studio có lỗi đọc đường dẫn lạ từ tệp nguồn | Linux: hộp cát systemd; mọi nơi: `validate.py`; ghi vào kiểm tay một loạt tệp nguồn cài cắm |
| Chất lượng slide do mô hình đang dùng viết SVG kém, bộ kiểm từ chối | Sửa 1 vòng theo báo lỗi; vẫn hỏng thì báo và trả lượt (lỗi máy) hoặc tính lượt (lỗi nội dung) |
| Chi phí token slide lớn (hướng dẫn ~50 KB mỗi trang) | Hạn mức; sổ token theo người; xem ở Sức khoẻ máy chủ |
| systemd-run trong `hermes-gateway` bị chặn (đơn vị dịch vụ không được tạo đơn vị tạm) | Kiểm thật ở bước triển khai; `mode()` báo log; tạm `ZALO_STUDIO_SANDBOX=none` chỉ khi chấp nhận rủi ro |
| Repo studio hai máy lệch phiên bản | Recipe thử nhiều đường dẫn hướng dẫn; cập nhật VPS khi triển khai |
| Gateway khởi động lại giữa việc | Việc mất, trả lượt khi khởi động; người dùng nhờ lại |
| Việc nặng làm chậm bot | 1 việc một lúc, giới hạn RAM/CPU (Linux), hạn giờ |
