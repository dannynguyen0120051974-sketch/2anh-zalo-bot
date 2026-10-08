# Dashboard v2 — §18 Giai đoạn 7: Đủ trang như dashboard mẫu

**Ngày:** 2026-10-08
**Trạng thái:** Người dùng đã chốt các câu hỏi ở §18.11 (08/10, lần hai); bản viết chờ duyệt
**Dự án:** 2anh-zalo-bot (từ v1.25.1 → **v1.26.0** (7A) → **v1.27.0** (7B))
**Bổ sung cho:** `2026-10-07-zalo-dashboard-v2-design.md` (§1–§15), `2026-10-07-dashboard-v2-phase5-addendum.md` (§16), `2026-10-07-dashboard-v2-phase6-studio.md` (§17). Tệp này là §18.
**Thay đổi so với §3 (phi mục tiêu):** §3 từng loại Agent, Insight nhóm, Second brain, Theo dõi agent, Kết nối MCP, Lịch hẹn. Giai đoạn 7 đưa tất cả vào — mỗi trang có giới hạn an toàn riêng ở dưới.

## 18.1 Yêu cầu của người dùng

Dashboard phải có đủ trang như dashboard mẫu "Zalo Agent" (ảnh mẫu trong phiên làm việc 08/10):

```
TỔNG QUAN   Tổng quan
HỘI THOẠI   Phiên chat · Liên hệ · Phân quyền Bot · Lịch hẹn
DỮ LIỆU     Trí nhớ · Kho tri thức · Insight nhóm · Second brain · Kết nối MCP
HỆ THỐNG    Tài khoản Zalo · Agent · Công cụ · Theo dõi agent · Nhật ký · Thương hiệu · Cấu hình
```

kèm đường dẫn vị trí ("Hệ thống / Thương hiệu") trên đầu trang và dòng phụ "Không gian làm việc" dưới tên thương hiệu. Giữ các trang riêng của mình (Sức khoẻ máy chủ, Người dùng, Chủ nhân bot, Cảnh báo Telegram). Chia hai bản phát hành:

- **7A "dữ liệu & hội thoại"** (v1.26.0): Liên hệ, Lịch hẹn, Trí nhớ, Kho tri thức, Insight nhóm, Second brain, khung điều hướng mới.
- **7B "hệ thống"** (v1.27.0, mọi trang chỉ Quản trị): Agent, Công cụ, Theo dõi agent, Kết nối MCP, Cấu hình.

Ràng buộc giữ nguyên từ các giai đoạn trước: không thêm gói npm; CSP chặt (không `style=`, không `innerHTML`); tiếng Việt thường; lỗi theo `route-errors`; mẫu `perm-box`/hộp gập; thanh Lưu dính; điện thoại 4 mục + "Thêm"; mọi thao tác ghi để lại dấu vết trong Nhật ký; ghi tệp nguyên tử + `.bak`; plugin Python lỗi thì quay về hành vi cũ; `permissions.json` giữ `version: 1`.

## 18.2 Hiện trạng đã kiểm (đọc mã + máy thật, chỉ đọc, 08/10)

| Điểm | Thấy gì |
|---|---|
| `state.db` của Hermes | Lăng Tiêu `E:/Hermes/state.db` lược đồ 28, Uyển Nhi `/root/.hermes/state.db` lược đồ 30. `sessions` (id, source `zalo`/`cron`/`cli`/`telegram`, chat_type, chat_id, title, model, started_at, last_activity_at, message_count, tool_call_count, api_call_count, input/output/cache_read tokens, system_prompt…), `messages` (session_id, role `user`/`assistant`/`tool`/`session_meta`, content, `tool_calls` JSON `[{id, call_id, function:{name, arguments}}]`, `tool_call_id`, `tool_name`, timestamp giây). `token_count` của từng tin luôn NULL → token chỉ có theo phiên. Không có cột thời lượng công cụ → tính = giờ tin kết quả − giờ tin gọi. Phiên Zalo nhóm sống rất lâu (`session_reset: none`), có phiên 5.229 tin. |
| Việc hẹn giờ | `<HERMES_HOME>/cron/jobs.json` `{jobs:[{id (12 hex), name, prompt, schedule{display,expr}, enabled, state, paused_at, next_run_at, last_run_at, last_status, deliver, origin{platform, chat_id, zalo_scope, zalo_creator_uid, zalo_creator_name}, script…}]}`. Ghi qua khoá `.jobs.lock` (flock). Có lệnh `hermes cron pause|resume|remove <id>` dùng đúng khoá đó (Windows: `E:/Hermes/bin/hermes.exe`; VPS: `/usr/local/bin/hermes`). Việc thuộc Zalo = `deliver` chứa `zalo:` hoặc `origin.platform = zalo` (như `_cron_target` của plugin); hẹn giờ nhóm = `origin.zalo_scope = "group"`. Máy local còn việc gửi Telegram (báo cáo GCP) — không được đụng. |
| Lời nhắc Zalo | zca-js 2.1.2: `getListReminder({page,count}, threadId, type)` theo **từng hội thoại** (nhóm: `id`, riêng: `reminderId`; `creatorId`/`creatorUid`, `params.title`, `startTime`, `repeat` 0–3), `removeReminder(id, threadId, type)`. Không có API "mọi lời nhắc của bot". |
| Bạn bè, lời mời | zca-js: `getAllFriends(count, page)`, `getFriendRecommendations()` (`recommType 2` = lời mời người khác gửi tới bot, kèm lời nhắn), `acceptFriendRequest(uid)`, `rejectFriendRequest(uid)`. `zalo-friends.js` hiện chỉ nhắn chủ bot khi người lạ mời, không đồng ý hộ. |
| MCP | `mcp_servers.<tên>` trong config.yaml: http (`url`, `headers`, `timeout`) hoặc stdio (`command`, `args`, `env`); `enabled: false` → Hermes bỏ qua (`tools/mcp_tool.py`). Kết nối lúc gateway khởi động. VPS: `rag → http://127.0.0.1:9998/mcp`; local: không có. Hermes có danh mục duyệt sẵn `optional-mcps/` + lệnh `hermes mcp install`. Thành viên chỉ dùng được MCP khớp `ZALO_PUBLIC_MCP` (plugin `_mcp_open_to_members`). |
| Bộ nhớ của Hermes | `memory.provider` **không đặt** trên cả hai máy → chỉ bộ nhớ có sẵn: `<HERMES_HOME>/memories/MEMORY.md` (ghi chú của trợ lý, trần `memory_char_limit` 2.200) và `USER.md` (hồ sơ chủ nhân, `user_char_limit` 1.375); mục nối bằng `"\n§\n"`; Hermes đọc lại tệp dưới khoá `<tệp>.lock` trước mỗi lần ghi và có "drift guard"; chụp vào lời nhắc hệ thống khi mở phiên. |
| OpenViking | Local: `openviking-server` 0.4.17 `:1933` `auth_mode: trusted` (header `X-OpenViking-Account/User: default`) — đây là bộ nhớ của Claude Code của anh (viking://user/default/memories, peers/…), có `privacy/`. VPS: `hermes-openviking.service` 0.4.13 `:1933` `auth_mode: dev`, `OPENVIKING_ENDPOINT` có trong `.env` Hermes nhưng Hermes **không** nối (không có `memory.provider`), kho gần như rỗng. API: `GET /api/v1/fs/ls?uri=`, `GET /api/v1/content/read?uri=`, `POST /api/v1/search/find {query, limit}` → `{memories, resources, skills}`, `POST /api/v1/content/write {uri, content, mode: replace|append|create}`. |
| Tính cách | `<HERMES_HOME>/SOUL.md` (667 byte ở cả hai máy) — `agent/prompt_builder.load_soul_md` đọc khi dựng lời nhắc hệ thống, qua bộ quét cài cắm + cắt cỡ. Lời dặn riêng Zalo: `platform_hints.zalo.append` trong config.yaml (khối chữ dài). Hermes **không có** "nhiệt độ" cho trợ lý chính; có `agent.reasoning_effort` (`none` + `minimal low medium high xhigh max ultra`). |
| Đổi model | `hermes-plugin/zalo/model_command.py` (v1.17.0): chỉ nhận tên có trong `<model.base_url>/models` (kèm `model.api_key`), sửa đúng dòng `model.default`, kiểm lại bằng YAML; gateway đọc lại config theo mtime ở mỗi tin → **hiệu lực ngay**. |
| Đọc nóng hay khởi động lại | Nóng: `permissions.json` (mtime), `model.default`, `people.json` (mỗi lần dùng), `data/welcome.json` (mỗi sự kiện), lời nhắc/hẹn giờ. Cần khởi động lại trợ lý: `platforms.zalo.extra.*` và các biến `ZALO_*` adapter đọc trong `__init__` (tag, dm_policy, flood, ack/react, owner_only_groups…), `mcp_servers`, SOUL.md (chụp theo phiên). Cần khởi động lại kết nối Zalo: `ZALO_FRIEND_TOOLS`, `ZALO_HISTORY_RETENTION_DAYS`. `ZALO_FRIEND_TOOLS` còn quyết việc plugin đăng ký công cụ → cả hai. |
| Thứ tự ưu tiên khoá Zalo | `extra.*` thắng `.env` với `dm_policy`, `ack_gestures`, `auto_react`, `owner_only_groups`, `ignore_sender_uids`, `model_choices`, `model_default`; riêng `reply_only_tagged`: giá trị `.env` khác rỗng đè `extra` (`_env_enablement`). Local: `extra.reply_only_tagged`; VPS: `extra.reply_only_tagged` + `extra.owner_only_groups`. |
| Kho tài liệu | `ZALO_KB_DIR` (thư mục), `ZALO_KB_PUBLIC_DIRS` (thư mục cấp 1 mở cho mọi người, áp cho cả chủ nhân), luật lọc `_kb_allowed` (bỏ thư mục ẩn, `node_modules`…, tên chứa `backup/order/khach/secret/token/password/private`…), danh sách đệm 300 giây. **Không có phạm vi theo nhóm.** |
| Sổ người quen | `<HERMES_HOME>/zalo/people.json` (hoặc `ZALO_PEOPLE_FILE`): `{uid: {name≤80, note≤400, fields{≤12; khoá≤40, giá trị≤120}, updated_at (giây), updated_by}}`, plugin đọc mỗi lần dùng, ghi `people.json.tmp` rồi `replace` (không khoá). |
| AI không công cụ | `ctx.llm.complete(messages, max_tokens, timeout, purpose)` (đồng bộ) trả `{text, model, usage.input_tokens/output_tokens}` — Xưởng (§17) đã dùng. Dashboard không giữ khoá AI và không gọi được plugin trực tiếp. |
| Lịch sử chat | `data/zalo.sqlite` bảng `messages` (thread_type, thread_id, sender_uid, sender_name, text, msg_type, timestamp_ms, is_self) + chỉ mục `idx_messages_thread_time` — đủ cho Insight nhóm, không cần gọi Zalo. |

## 18.3 Bố cục, vai trò

### 18.3.1 Thanh bên, đường dẫn vị trí, dòng phụ

```
TỔNG QUAN   Tổng quan
HỘI THOẠI   Phiên chat · Liên hệ · Phân quyền Bot · Lịch hẹn
DỮ LIỆU     Trí nhớ · Kho tri thức · Insight nhóm · Second brain(QT, chỉ khi bật) · Kết nối MCP(QT, 7B)
HỆ THỐNG    Tài khoản Zalo · Agent(QT) · Công cụ(QT) · Theo dõi agent(QT) · Nhật ký · Thương hiệu · Sức khoẻ máy chủ · Cấu hình(QT)
QUẢN TRỊ    Người dùng · Chủ nhân bot · Cảnh báo Telegram   (cả nhóm chỉ Quản trị)
```

- Mục có thể gắn `admin: true` riêng (không chỉ cả nhóm) và `feature` (hiện chỉ khi `/api/features` bật — Second brain); nhóm không còn mục nào thì ẩn. Mọi mục `admin` đều có route `admin: true` (test ghim).
- **Đường dẫn vị trí** "Nhóm / Trang" trên đầu nội dung (`<nav aria-label="Vị trí trang"><ol>`), Tổng quan không có.
- **Dòng phụ** dưới tên thương hiệu: trường mới `subtitle` của `brand.json` (≤ 40 ký tự, mặc định "Không gian làm việc"), sửa ở trang Thương hiệu, có trong xem trước.
- Điện thoại: giữ 4 mục chính (`/`, `/chats`, `/zalo`, `/permissions`); menu "Thêm" chia theo nhóm (có nhãn nhóm), cuộn được.

### 18.3.2 Ma trận vai trò (bổ sung §6)

| Trang | Quản trị | Chủ bot | Lý do |
|---|---|---|---|
| Liên hệ (xem, đồng ý/từ chối kết bạn) | ✅ | ✅ | Danh bạ của bot là của chủ bot; ai nhắn riêng được vẫn do Phân quyền Bot quyết |
| Lịch hẹn (xem, tạm dừng, chạy lại, xoá) | ✅ | ✅ | Hẹn giờ nhóm do thành viên tạo — chủ bot phải dừng được |
| Trí nhớ — Sổ người quen | ✅ | ✅ | Dữ liệu về người trong nhóm của chủ bot |
| Trí nhớ — Bộ nhớ của trợ lý (MEMORY/USER.md) | ✅ | ❌ | Là một phần lời nhắc hệ thống — cùng loại với Agent |
| Kho tri thức (xem, tải lên, xoá tệp đã tải lên) | ✅ | ✅ | Tài liệu của chủ bot |
| Insight nhóm (+ tóm tắt AI) | ✅ | ✅ | Chỉ đọc lịch sử; AI có trần lượt/ngày |
| Second brain | ✅ (chỉ khi bật trên máy chủ Linux) | ❌ | Kho cá nhân trên máy chủ; Windows luôn tắt (§18.5.4) |
| Agent, Công cụ, Theo dõi agent, Kết nối MCP, Cấu hình | ✅ | ❌ | Đổi được hành vi/quyền của bot (7B) |

## 18.4 7A — Hội thoại: Liên hệ, Lịch hẹn

### 18.4.1 Đường điều khiển mới của kết nối Zalo (`control-api.js`)

Dashboard chỉ tới Zalo qua `/control/*` (Bearer `ZALO_BRIDGE_TOKEN`, `timingSafeEqual`). Module mới `zalo-directory.js` (gốc repo) giữ phần gọi zca-js, test được không cần Zalo:

| Route | Việc | Kiểm |
|---|---|---|
| `GET /control/friends[?fresh=1]` | `getAllFriends(5000, 1)` → `[{uid, name, zaloName}]`, đệm 10 phút | UID `^[1-9]\d{14,21}$`, bỏ mục lạ |
| `GET /control/friend-requests` | `getFriendRecommendations()` lọc `recommType 2` → `[{uid, name, message, at}]` | — |
| `POST /control/friend-requests/answer` | `{uid, accept: bool, actor}` → `acceptFriendRequest`/`rejectFriendRequest` | UID, `accept` boolean, `actor` bắt buộc ≤ 64 |
| `GET /control/reminders?threadId=&threadType=` | `getListReminder({page:1,count:50}, …)` → `[{id, title, startAt, repeat, creatorUid, mine, createdAt}]` | threadId `^\d{1,32}$`, threadType 0/1 |
| `POST /control/reminders/remove` | `{reminderId, threadId, threadType, actor}` → `removeReminder` | id `^[\w-]{1,64}$`, như trên |

- Ghi (đồng ý/từ chối, xoá lời nhắc) xin lượt từ bộ giới hạn nhịp (`acquireSendQuota`) như lệnh thường, và ghi `audit_log` qua hàm mới `auditDashboardAction` (hermes-bridge.js): `actor_role="dashboard"`, `actor_uid=<tên người dùng dashboard>`, category `admin`, hành động `dashboard_friend_accept|dashboard_friend_reject|dashboard_reminder_remove`, `attempted → succeeded|failed`.
- Lỗi kiểm → 400; lỗi Zalo → 502 (như các route cũ); `api` đọc qua hàm (đăng nhập lại không cần khởi động lại).
- Không gắn với `ZALO_FRIEND_TOOLS`: đây là người thật bấm trên dashboard, không phải AI.

### 18.4.2 Liên hệ (`#/contacts`)

- `GET /api/contacts?kind=all|friend|dm|profile&q=` gộp theo UID: bạn bè (kết nối Zalo), người đã nhắn riêng (SQLite, `threadType 0`), sổ người quen (people.json); đánh dấu chủ nhân (`ZALO_ALLOWED_USERS`). Tìm không dấu theo tên, UID, ghi chú. Nguồn nào lỗi vẫn trả phần còn lại kèm `errors.{friends|history|people}` (câu dễ hiểu). Trần 1.000 dòng.
- `GET /api/contacts/requests`, `POST /api/contacts/requests/:uid {accept}` → kết nối Zalo (audit_log ở đó; Nhật ký đã gộp audit_log nên route không ghi activity lần nữa).
- Giao diện: hộp "Lời mời kết bạn đang chờ" (Đồng ý / Từ chối có hỏi lại), lọc bằng nút chip, ô tìm, nhãn Chủ nhân · Bạn bè · Đã nhắn riêng · Có hồ sơ. Không hiện ảnh đại diện (CSP `img-src 'self'`; không cần cho việc này).

### 18.4.3 Lịch hẹn (`#/schedules`)

- **Việc hẹn giờ của trợ lý**: đọc `cron/jobs.json` (chỉ việc thuộc Zalo; không lộ `script`, `model`, `origin` khác), chia "Hẹn giờ cho nhóm" / "Việc của chủ nhân", tên nhóm từ danh bạ nhóm. Tìm không dấu. **Tạm dừng / Chạy lại / Xoá** = chạy `hermes cron pause|resume|remove <id>` (`execFile`, không shell, `windowsHide`, 30 s, `HERMES_HOME` đúng) — chỉ khi id nằm trong danh sách việc Zalo vừa đọc. Đường lệnh: `ZALO_HERMES_BIN` → `<HERMES_HOME>/bin/hermes(.exe)` → `hermes` trên PATH. Lỗi lệnh → 502 câu chung (stderr chỉ vào log dịch vụ). Ghi activity `cron_pause|cron_resume|cron_remove` (cả khi lỗi, `ok:false`).
- **Lời nhắc Zalo**: chọn hội thoại (danh sách Phiên chat) → `GET /api/schedules/reminders` → xoá từng lời nhắc (`POST /api/schedules/reminders/remove`). Nhãn lặp lại: Một lần / Hằng ngày / Hằng tuần / Hằng tháng; "bot tạo" khi `creatorId` = UID bot.
- Ghi chú trên trang: tắt nút "Hẹn giờ cho nhóm" ở Phân quyền Bot chỉ chặn tạo mới (§8.3) — việc đã có dừng/xoá ở đây.

## 18.5 7A — Dữ liệu: Trí nhớ, Kho tri thức, Insight nhóm, Second brain

### 18.5.1 Trí nhớ (`#/memory`)

**Sổ người quen** (cả hai vai trò): `GET /api/people?q=`, `PUT /api/people/:uid {name, note, fields:[{key,value}]}` (thay cả hồ sơ; giới hạn khớp people.py; giữ khoá lạ plugin có thể thêm sau), `DELETE /api/people/:uid`. Đường tệp: `ZALO_PEOPLE_FILE` trong `.env` Hermes thắng `<HERMES_HOME>/zalo/people.json`. Ghi: `.bak`, tệp tạm **tên riêng** `people.json.dashboard-tmp` (plugin dùng `people.json.tmp`), từ chối 409 nếu tệp đổi (mtime+cỡ) kể từ lúc đọc; tệp hỏng → 503 "báo người cài đặt", không ghi đè. `updated_by = "dashboard:<tên>"`. Activity `people_update|people_delete`.

**Bộ nhớ của trợ lý** (chỉ Quản trị): `GET /api/admin/agent-memory` → hai khối (Ghi chú của trợ lý / Hồ sơ chủ nhân) với mục, ký tự đã dùng/trần (từ config.yaml `memory.*_char_limit`). `PUT|DELETE /api/admin/agent-memory/:target/:index` kèm `old` (nội dung người dùng đã thấy) → 409 nếu mục đã đổi hoặc tệp đổi; nội dung không được có dòng chỉ gồm "§"; vượt trần → 400. Ghi lại đúng định dạng Hermes (nối `"\n§\n"`) để drift guard không coi là sửa ngoài. Nhật ký `agent_memory_edit|agent_memory_delete` chỉ ghi "mục N", **không** ghi nội dung. Có hiệu lực từ phiên mới.

*Không* dùng `MemoryStore` của Hermes qua tiến trình Python con: thêm một đường chạy lệnh cho một tệp 2 KB không đáng; khoảng hở giữa lần kiểm và lần đổi tên là vài mili giây, và Hermes đọc lại tệp dưới khoá trước mỗi lần ghi của nó.

### 18.5.2 Kho tri thức (`#/kb`)

- `GET /api/kb` → `{configured, publicDirs, uploadDir, files:[{path, size, mtime, uploaded}], truncated}`: chỉ tệp bot đọc được — cùng luật `_kb_allowed` + đuôi đọc được của plugin, không theo symlink, sâu ≤ 8, trần 3.000 tệp, đệm 60 giây.
- **Tải lên** `POST /api/kb/upload` (thân nhị phân `application/octet-stream`, tên ở `X-File-Name` dạng `encodeURIComponent`; không base64): chỉ `.docx .pdf .md .txt`, ≤ 10 MB, nội dung khớp đuôi (PDF `%PDF-`; DOCX là ZIP có `word/document.xml`; MD/TXT UTF-8 không byte 0), tên an toàn (bỏ đường dẫn, ký tự cấm Windows, dấu chấm đầu, ≤ 120 ký tự). Lưu vào **một thư mục riêng** `tai-len-dashboard` (nằm trong thư mục công khai đầu tiên nếu có `ZALO_KB_PUBLIC_DIRS`, để bot thấy được); trùng tên → "(2)". Bot thấy tệp mới trong ≤ 5 phút (đệm của plugin).
- **Xoá** `DELETE /api/kb/file {path}`: chỉ tệp nằm trực tiếp trong `tai-len-dashboard` (resolve + kiểm tương đối, không symlink) → 403 với mọi chỗ khác. Phần còn lại của kho là tài liệu của chủ bot — dashboard không xoá.
- **Phạm vi theo nhóm: không làm.** Plugin chỉ có phạm vi toàn cục (`ZALO_KB_PUBLIC_DIRS`, áp cho cả chủ nhân, danh sách đệm dùng chung giữa các lượt). Thêm phạm vi theo nhóm = sửa `zalo_kb_list/read` + đệm theo nhóm — để giai đoạn sau nếu người dùng cần (§18.11). Trang hiện phạm vi hiện tại; sửa phạm vi ở Cấu hình (7B).
- Activity `kb_upload|kb_delete` (đường tương đối).

### 18.5.3 Insight nhóm (`#/insight`)

- `GET /api/insight/groups/:id?days=7|30|90` (mặc định 30) từ SQLite chỉ đọc, giờ Việt Nam: tổng (tin, người có nhắn, tin của bot), số tin mỗi ngày (đủ N ngày, có phần của bot), 10 người nhắn nhiều nhất (tên mới nhất, **không** UID), bản đồ giờ 7 × 24 (T2…CN × 0–23h, chỉ tin thành viên), loại tin (chữ, ảnh/video, tệp, có link, nhãn dán, thoại, khác). Bỏ tin mã đăng nhập như mọi màn. Mọi câu đi theo `idx_messages_thread_time`.
- Giao diện: 3 ô số, biểu đồ cột SVG (class, không `style=`), bảng nhiệt `<table>` với class `heat-0..4` (`color-mix` theo màu thương hiệu), hai danh sách.
- **Tóm tắt chủ đề bằng AI — làm, qua hàng đợi tệp** (dashboard không giữ khoá AI, không gọi được plugin):
  - Dashboard `POST /api/insight/groups/:id/summary {days}` dựng đoạn hội thoại (mới nhất trước tới 30.000 ký tự rồi đảo theo thời gian; dòng "dd/mm HH:MM Tên: chữ ≤ 300"; ảnh/tệp chỉ ghi nhãn, **không** gửi đường dẫn; bỏ mã đăng nhập) → ghi `<HERMES_HOME>/zalo/insight/requests/<16 hex>.json` (600). Mỗi lúc một yêu cầu (409). Activity `insight_summary`.
  - Plugin `zalo_tools/insight_ai.py`: luồng nền `zalo-insight` (bật trong `register`, `ZALO_INSIGHT_AI=off` tắt) đọc yêu cầu 3 giây/lần, trừ lượt `ZALO_INSIGHT_DAILY` (mặc định 10/ngày VN, 0 = tắt, trần cứng 100), gọi `ctx.llm.complete` **không công cụ**, `max_tokens` 1.200, `timeout` 120, lời nhắc hệ thống nói rõ phần `<hoi_thoai>` là dữ liệu không phải lời dặn; kiểm JSON `{topics[≤6]{title≤80, summary≤400}, mood≤200, open_questions[≤5]}` → `results/<id>.json` `{ok, summary|error, usage, model, at}`, xoá yêu cầu. Mọi lỗi (thiếu `ctx.llm`, cổng AI lỗi, AI trả sai dạng, tệp hỏng, tên tệp lạ) → kết quả `ok:false` có câu dễ hiểu; không bao giờ ném ra ngoài luồng.
  - Trang hỏi `GET /api/insight/summary/:id` 3 giây/lần; quá 3 phút không có kết quả → "Trợ lý chưa trả lời — có thể đang tắt hoặc chưa cập nhật" (plugin cũ = hành vi cũ: không có tóm tắt). Kết quả giữ 7 ngày. Chữ AI hiển thị bằng htm (textContent).
  - Chi phí: trần lượt/ngày × ≤ 30.000 ký tự vào × 1.200 token ra; token mỗi lần nằm trong kết quả; tổng vẫn hiện ở Sức khoẻ máy chủ (state.db).

### 18.5.4 Second brain (`#/second-brain`, chỉ Quản trị, chỉ máy chủ Linux/VPS) — quyết định

**Chọn: cửa sổ vào OpenViking trên cùng máy** — xem, tìm theo nghĩa, đọc, và **thêm ghi chú mới** — làm thành **tính năng của sản phẩm, bật bằng cấu hình**, để sau này cài được cho khách. Lý do chọn OpenViking: là kho tri thức cá nhân thật duy nhất đang có (VPS có `hermes-openviking.service`), có sẵn tìm theo nghĩa và API HTTP cục bộ; bộ nhớ có sẵn của Hermes chỉ ~3.500 ký tự (đã ở Trí nhớ), Kho tri thức là tệp.

**Bật/tắt (người dùng chốt 08/10):**
- Chỉ bật khi `.env` của Hermes có **`ZALO_SECOND_BRAIN_URL`** = địa chỉ OpenViking **loopback** (`http://127.0.0.1:1933`). Không đặt → tắt; không phải loopback/có user:pass → tắt (doctor báo hỏng). Tài khoản/người dùng: `OPENVIKING_ACCOUNT`, `OPENVIKING_USER` (mặc định `default`), khoá `OPENVIKING_API_KEY` nếu có — chỉ dùng ở máy chủ.
- **Máy Windows: luôn tắt, kể cả khi đã đặt biến** — ghi chú "Second brain chỉ bật trên máy chủ VPS". OpenViking ở máy nhà (Lăng Tiêu) là bộ nhớ Claude Code riêng của chủ máy; dashboard nhìn ra Internet không bao giờ được mở nó.
- Một hàm quyết định duy nhất `secondBrainStatus({url, platform})` (`dashboard/lib/second-brain.js`) dùng chung cho dashboard, bộ cài và doctor.
- **Thanh bên**: mục có `feature: 'secondBrain'`; giao diện hỏi `GET /api/features` (`requireAuth`, chỉ Quản trị nhận `secondBrain: true` khi đang bật) — tắt thì **ẩn mục**; mở thẳng `#/second-brain` thì thấy câu ghi chú, mọi route `/api/admin/second-brain/*` (trừ `status`) trả 404 kèm câu đó, không gọi OpenViking.
- **Bộ cài** (`scripts/hermes-install-lib.js` → `secondBrainHint`): trên Linux, chưa đặt biến mà `systemctl is-active hermes-openviking.service` (hoặc `openviking.service`) chạy → **in** cách bật (dòng cần thêm vào `.env`); **không bao giờ tự đặt biến**.
- **Doctor**: dòng `second-brain` — "luôn tắt trên Windows", "tắt — muốn bật trên VPS: thêm ZALO_SECOND_BRAIN_URL=…", "bật — http://127.0.0.1:1933", hoặc FAIL khi địa chỉ không phải loopback. Chỉ đọc cấu hình, không gọi mạng.

**Giới hạn an toàn khi bật:**
- Địa chỉ chỉ loopback, `redirect: 'error'`, hạn 15 s — không thành cầu SSRF.
- Chỉ đọc trong 3 gốc: `viking://resources`, `viking://user/<user>/memories`, `viking://user/<user>/peers` (không `privacy/`, sessions, agent…); URI có `..` hoặc ký tự điều khiển → 400 trước khi gọi.
- Chỉ **ghi mới** (`mode: "create"`) dưới `viking://resources/so-tay-dashboard/<ngày VN>-<chữ không dấu>-<6 hex>.md`; không sửa, không xoá gì có sẵn. Ghi chú ≤ 8.000 ký tự. Activity `second_brain_note` (URI).
- Hermes hiện **không** đọc OpenViking (không có `memory.provider`) → ghi chú chưa đến tay bot (xem §18.13).

## 18.6 7B — Hệ thống (mọi trang chỉ Quản trị)

### 18.6.1 Sửa config.yaml an toàn (`dashboard/lib/config-yaml.js`)

Như `/model`: sửa **theo dòng**, không dump lại YAML (giữ chú thích, khối chữ `platform_hints`, thứ tự). Tìm khoá theo đường dẫn bằng thụt lề; thay cả vùng giá trị (một dòng, hoặc khối con/danh sách) bằng một dòng (`renderScalar`: chuỗi thường để trần, từ khoá YAML/ký tự đặc biệt → JSON trong ngoặc kép, mảng → `[..]`); khoá chưa có thì chèn cuối khối cha (khối cha phải có). Sau đó **phân tích lại cả tệp — phải bằng bản cũ với đúng các khoá đã sửa**, khác là từ chối và giữ tệp. Ghi theo symlink, giữ quyền + chủ sở hữu, `.bak`, tệp tạm riêng `.config.dashboard.tmp`. Có test chạy thử trên `config.yaml` thật của máy (bỏ qua khi không có `HERMES_HOME`).

### 18.6.2 Cờ chờ khởi động lại (`restart-flags.json`)

`{assistant: {since, rev, reasons[]}|null, sidecar: {…}|null}` trong thư mục dữ liệu dashboard. Agent/MCP/Cấu hình đánh dấu kèm lý do; dải vàng chung (`RestartBanner`) trên các trang 7B + nút "Khởi động lại ngay" → `POST /api/admin/restart-assistant` (sẵn có), nay khởi động lại cả kết nối Zalo khi có cờ `sidecar`, xoá cờ chỉ khi `rev` không đổi trong lúc chạy, Nhật ký ghi lý do. Cờ chủ nhân bot cũ (`pending-restart.json`) giữ nguyên.

### 18.6.3 Agent (`#/agent`)

- **Model**: danh sách = model đang dùng + chọn nhanh (`extra.model_choices` hoặc `ZALO_MODEL_CHOICES`) + mọi model của cổng AI (`GET /api/admin/agent/models` hỏi `<base_url>/models` kèm khoá ở máy chủ, hạn 10 s). `PUT /api/admin/agent/model` chỉ nhận tên có trong danh sách cổng AI → sửa `model.default` → **hiệu lực ngay**, không cờ. Trang chỉ hiện `máy:cổng` của `base_url`, không bao giờ khoá.
- **Mức suy nghĩ** `agent.reasoning_effort` (`none minimal low medium high xhigh max ultra`) → cờ chờ (chưa chắc gateway đọc nóng).
- **Không có nhiệt độ** — Hermes không có cài đặt này cho trợ lý chính; trang không giả vờ có.
- **Tính cách (SOUL.md)**: xem/sửa (≤ 20.000 ký tự, không rỗng), mỗi lần lưu cất bản cũ vào `<dữ liệu dashboard>/soul-history/<ms>-<người>.md` (giữ 30), bản đầu tiên trước lần sửa đầu tiên giữ riêng là "bản gốc"; xem, **khôi phục** bất kỳ bản nào (bản hiện tại vẫn được cất). Giữ quyền tệp, tệp tạm riêng. Cờ chờ "Tính cách (SOUL.md)". Lời dặn riêng Zalo (`platform_hints.zalo.append`) chỉ xem.
- Activity `agent_model` ("cũ → mới"), `agent_reasoning`, `agent_soul` (số ký tự), `agent_soul_restore`.

### 18.6.4 Công cụ (`#/tools`)

- Plugin ghi `<HERMES_HOME>/zalo/tools-manifest.json` lúc nạp (`write_tools_manifest`, cố hết sức): mọi công cụ trong `TOOLS` — tên, mức quyền (toolset), mô tả, nút điều khiển (`feature_of`, `studio`, `always`), có đăng ký không (công cụ kết bạn khi `ZALO_FRIEND_TOOLS` tắt), chỉ tin riêng, cần mã xác nhận.
- Trang: nhóm theo mức quyền (Mọi người / Chỉ chủ nhân / Việc hẹn giờ…), mỗi công cụ ghi nút ở Phân quyền Bot điều khiển nó. Công cụ **công khai** có ô "Cho người ngoài dùng" — tắt = thêm vào `permissions.json` mục mới **`tools: {off: [...]}`** (vẫn `version: 1`).
- Plugin: `group_permissions._tools_off` + `tool_off(name)`; `guard_member_tool_call` chặn trước cả nút tính năng (`_tool_off_block`, tháo `tool_call` như `_feature_block`) — lượt không phải chủ nhân, ở nhóm và tin riêng; **chủ nhân không bao giờ bị chặn**; thiếu mục/sai kiểu/đọc lỗi → không chặn thêm (hành vi cũ). Hiệu lực ngay (mtime).
- Dashboard `normalize` giữ `tools` qua mọi lần lưu nhóm/mặc định/nhắn riêng/hạn mức. `PUT /api/admin/tools {off}` chỉ nhận tên công cụ công khai có trong manifest. Activity `tools_off` ("tắt: … · bật lại: …").
- MCP mở cho thành viên (`ZALO_PUBLIC_MCP`): hiện ở đây, sửa ở Cấu hình.
- Plugin cũ (chưa có manifest) → trang báo "cập nhật plugin rồi khởi động lại trợ lý".

### 18.6.5 Theo dõi agent (`#/trace`)

- `node:sqlite` chỉ đọc (`readOnly` + `query_only`), mở/đóng mỗi lần. `GET /api/admin/trace/sessions?source=zalo|cron|all&chat=` → phiên mới hoạt động trước (≤ 200): tên hội thoại (danh bạ nhóm), tiêu đề, model, lượt gọi AI, số công cụ, token vào/ra/đệm (theo phiên). **Không** đọc `system_prompt`.
- `GET /api/admin/trace/sessions/:id/turns` → 30 lượt mới nhất (đọc ≤ 1.500 tin mới nhất): giờ, câu hỏi (≤ 200), công cụ đã gọi — tên, **tham số đã che** (chỉ tên khoá + "chữ, N ký tự"/"số"/"danh sách N mục"…, không bao giờ giá trị), trạng thái (xong/lỗi theo JSON `success:false`/`error`; chưa có kết quả = đang chạy), thời gian — và câu trả lời (≤ 300), tổng thời gian lượt. **Không** hiện nội dung kết quả công cụ.
- state.db khoá/đổi lược đồ → 500 câu chung, chi tiết vào log.

### 18.6.6 Kết nối MCP (`#/mcp`) — quyết định

- **Xem**: tên, kiểu (http/stdio), đích rút gọn (`giao thức://máy:cổng`, hoặc tên lệnh), bật/tắt, có mở cho thành viên không. **Không bao giờ** trả `env`, `headers`, `args`, đường dẫn/chuỗi truy vấn của URL (thường chứa khoá).
- **Trạng thái**: chỉ dò TCP tới địa chỉ loopback (1,5 s); máy ngoài ghi "không kiểm" (không biến dashboard thành công cụ quét mạng); stdio "chạy cùng trợ lý"; tắt "đã tắt".
- **Bật/tắt**: sửa dòng `mcp_servers.<tên>.enabled` (config-yaml) → cờ chờ khởi động lại. Activity `mcp_enable|mcp_disable`.
- **Thêm máy chủ mới: KHÔNG có trên dashboard.** Thêm MCP = cho gateway (root trên VPS) chạy một lệnh/kết nối tuỳ ý. Kể cả chỉ cho chọn từ danh mục `optional-mcps/` của Hermes, việc cài vẫn chạy `uvx/npx/git`, nhiều mục cần khoá + OAuth hỏi tương tác — thuộc về dòng lệnh. Một phiên dashboard bị chiếm (XSS sau này, máy người dùng nhiễm mã độc, mật khẩu lộ) không được trở thành chạy lệnh trên máy chủ. Trang ghi rõ: người cài đặt chạy `hermes mcp install <tên>` trên máy.

### 18.6.7 Cấu hình (`#/settings`) — danh sách cho phép

Danh sách **cố định** trong mã (`dashboard/lib/settings.js`); không khoá nào khác sửa được; không có khoá bí mật. Ghi vào **đúng nơi đang có hiệu lực** (khoá đang nằm trong `extra` của config.yaml và `extra` thắng → sửa config.yaml; còn lại → `.env` của Hermes qua `env-file.js` mở rộng).

| Mục | Khoá | Kiểu, giới hạn | Nguồn thắng | Khởi động lại |
|---|---|---|---|---|
| Trong nhóm chỉ trả lời khi được tag (mặc định) | `ZALO_GROUP_REPLY_ONLY_TAGGED` / `extra.reply_only_tagged` | bật/tắt | .env khác rỗng | trợ lý |
| Nhắn riêng khi chưa chọn ở Phân quyền | `ZALO_DM_POLICY` / `extra.dm_policy` | `owner-only` \| `open` | config.yaml | trợ lý |
| Báo đã xem | `ZALO_ACK_GESTURES` / `extra.ack_gestures` | bật/tắt | config.yaml | trợ lý |
| Thả cảm xúc tự động | `ZALO_AUTO_REACT` / `extra.auto_react` | bật/tắt | config.yaml | trợ lý |
| Nhóm chỉ chủ nhân gọi được bot | `ZALO_OWNER_ONLY_GROUPS` / `extra.owner_only_groups` | ≤ 50 id nhóm `^\d{1,32}$` | config.yaml | trợ lý |
| Chống nhắn dồn: số tin | `ZALO_FLOOD_THRESHOLD` | 2–50 | .env | trợ lý |
| … khoảng tính (giây) | `ZALO_FLOOD_WINDOW_S` | 5–600 | .env | trợ lý |
| … bỏ qua trong (giây) | `ZALO_FLOOD_MUTE_S` | 10–3600 | .env | trợ lý |
| Công cụ kết bạn/lập nhóm của chủ nhân | `ZALO_FRIEND_TOOLS` | bật/tắt | .env | trợ lý + kết nối Zalo |
| Mã xác nhận trước thao tác nguy hiểm | `ZALO_CONFIRM_DANGEROUS` | bật/tắt | .env | trợ lý |
| Thư mục kho tài liệu mở cho mọi người | `ZALO_KB_PUBLIC_DIRS` | ≤ 20 tên thư mục (chữ có dấu, số, khoảng trắng, `_ . -`) | .env | trợ lý |
| Kết nối MCP thành viên dùng được | `ZALO_PUBLIC_MCP` | ≤ 20 mẫu `[A-Za-z0-9_.*?-]` — hỏi lại trước khi lưu | .env | trợ lý |
| Giữ lịch sử trò chuyện (ngày) | `ZALO_HISTORY_RETENTION_DAYS` | 30–3650 | .env | kết nối Zalo |

- `env-file.js`: các khoá trên vào danh sách ghi được; giá trị qua luật chung `^[\p{L}\p{N} _.,*?:/-]*$` (không nháy, `\`, `#`, `=`, xuống dòng → không chèn được dòng/khoá khác), có khoảng trắng/chữ có dấu thì ghi trong ngoặc kép. `ZALO_ALLOWED_USERS` giữ luật chữ số + dấu phẩy.
- Giao diện: nhóm theo mục, mỗi ô ghi "Đang lấy từ …" và cần khởi động lại gì; thanh Lưu dính; chỉ gửi mục đã đổi; Nhật ký `settings_update` "Mục: cũ → mới".
- **Lời chào thành viên mới** (cùng trang): theo nhóm, bật/tắt, lời chào ≤ 1.500, gom 1–20 người, chờ 1–1440 phút → `data/welcome.json` của kết nối Zalo bằng chính `updateWelcomeGroup` (đọc lại mỗi sự kiện → hiệu lực ngay). Activity `welcome_update`.
- Không có: token/khoá, `ZALO_ALLOWED_USERS` (đã có trang Chủ nhân bot), `ZALO_ALLOW_ALL_USERS` (mở cổng Hermes — để người cài đặt), `ignore_sender_uids`, cổng, đường dẫn.

## 18.7 Tệp và lược đồ

- `permissions.json` **vẫn `version: 1`**, thêm mục tuỳ chọn `tools: { "off": ["zalo_pdf", …] }` (tên `^[a-z0-9_]{1,64}$`, ≤ 200). Plugin/dashboard cũ bỏ qua; dashboard cũ ghi đè làm rơi mục → công cụ bật lại (an toàn về hành vi bot: về như trước 7B). Cập nhật dashboard + plugin cùng lúc.
- Tệp mới của plugin: `<HERMES_HOME>/zalo/tools-manifest.json`, `<HERMES_HOME>/zalo/insight/{requests,results}/`, `insight/usage.json`.
- Tệp mới của dashboard (`<HERMES_HOME>/zalo/dashboard/`): `restart-flags.json`, `soul-history/`. `brand.json` thêm `subtitle`.
- Tệp người dùng được ghi: `people.json` (+`.bak`), `memories/MEMORY.md|USER.md` (+`.bak`), `SOUL.md`, `config.yaml` (+`.bak`), `.env` (+`.bak`), `<ZALO_KB_DIR>/…/tai-len-dashboard/*`, `<sidecar>/data/welcome.json`.

## 18.8 Bảo mật

1. Vai trò kiểm ở máy chủ cho mọi route mới (bảng §18.3.2); mọi trang 7B `requireRole('admin')`.
2. Không route nào trả khoá: `model.api_key`, `OPENVIKING_API_KEY`, `mcp_servers.*.headers/env/args`, `bridge_token`, token Telegram. Test ghim chữ khoá không xuất hiện trong JSON.
3. Không chạy lệnh tuỳ ý: lệnh duy nhất mới là `hermes cron <pause|resume|remove> <id 6–32 hex>` qua `execFile` (không shell), id phải là việc Zalo đang có.
4. Không SSRF: OpenViking chỉ loopback và chỉ trên máy Linux có `ZALO_SECOND_BRAIN_URL`; dò MCP chỉ TCP loopback; cổng AI chỉ `model.base_url` của chính config.
5. Đường dẫn: kho tài liệu resolve + kiểm tương đối + không symlink; URI OpenViking theo gốc cho phép; id bản SOUL, id yêu cầu Insight, id phiên theo regex.
6. Chữ do AI/thành viên viết (tóm tắt, tên, ghi chú) chỉ hiển thị bằng htm — không HTML.
7. Ghi tệp: nguyên tử, `.bak`, giữ quyền/chủ sở hữu, tệp tạm tên riêng khi tiến trình khác cũng ghi tệp đó; 409 khi tệp đổi giữa chừng.
8. Mọi thao tác ghi để lại dấu vết: qua kết nối Zalo → `audit_log`; trong dashboard → `activity.jsonl` (có nhãn tiếng Việt ở Nhật ký). Nội dung bộ nhớ trợ lý không vào Nhật ký.

## 18.9 Triển khai

**7A (v1.26.0)** — cập nhật cả ba phần cùng lúc:
- *Kết nối Zalo* (khởi động lại `zalo-bridge` / tiến trình Windows): `zalo-directory.js` (mới), `control-api.js`, `hermes-bridge.js`, `server.js`.
- *Plugin Hermes* (chép vào `<hermes-agent>/plugins/…`, khởi động lại gateway): `zalo_tools/insight_ai.py` (mới), `zalo_tools/__init__.py`, hai `plugin.yaml`.
- *Dashboard* (khởi động lại `zalo-dashboard`): lib/routes/views mới và sửa theo kế hoạch 7A. *Bộ cài/doctor*: `scripts/hermes-install-lib.js`, `scripts/install-hermes.js`.
- VPS: không cần đổi `.env`; tuỳ chọn `ZALO_INSIGHT_DAILY`; muốn bật Second brain thì thêm `ZALO_SECOND_BRAIN_URL=http://127.0.0.1:1933` (bộ cài in gợi ý khi thấy `hermes-openviking.service`). Lăng Tiêu: không đặt gì (Windows luôn tắt). Kiểm `hermes` có trên PATH của dịch vụ `zalo-dashboard` (`/usr/local/bin/hermes`) hoặc đặt `ZALO_HERMES_BIN`.

**7B (v1.27.0)**:
- *Plugin Hermes* (khởi động lại gateway — cũng để ghi `tools-manifest.json`): `zalo_tools/group_permissions.py`, `zalo_tools/tools.py`, hai `plugin.yaml`.
- *Dashboard* (khởi động lại `zalo-dashboard`): theo kế hoạch 7B.
- Sau triển khai trên VPS chạy `HERMES_HOME=/root/.hermes node --test dashboard/lib/config-yaml.test.js` (test sửa thử config.yaml thật trong bộ nhớ, không ghi).
- Kết nối Zalo: không đổi ở 7B.

## 18.10 Kiểm thử

Node `node --test` (mọi lib/route mới có test; `public.test.js` cho hàm thuần của giao diện + quét CSP), Python `unittest` qua `scripts/run-python-tests.js` (`test_zalo_insight.py` mới; `ToolsOffTest` trong `test_zalo_permissions.py`). Kiểm tay trên Lăng Tiêu (local) và Uyển Nhi (VPS) theo danh sách trong README.vi.md.

## 18.11 Người dùng đã chốt (08/10, lần hai)

1. **Second brain**: chỉ Quản trị, chỉ Linux/VPS, bật bằng `ZALO_SECOND_BRAIN_URL`, Windows luôn tắt, bộ cài chỉ gợi ý, doctor kiểm, thanh bên ẩn khi tắt (§18.5.4).
2. **Nối Hermes ↔ OpenViking**: chưa làm — ghi thành giai đoạn sau (§18.13).
3. **Kho tri thức theo nhóm**: không làm (giữ phạm vi chung `ZALO_KB_PUBLIC_DIRS`).
4. **Tóm tắt AI**: 10 lần/ngày (`ZALO_INSIGHT_DAILY`).
5. **Mức suy nghĩ**: giữ cờ "cần khởi động lại".

## 18.12 Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Sửa config.yaml làm hỏng cấu hình viết tay | Sửa theo dòng + phân tích lại so khớp toàn bộ, khác là từ chối; `.bak`; test trên tệp thật |
| Dashboard và bot cùng ghi people.json / MEMORY.md | Tệp tạm tên riêng; 409 khi tệp đổi; Hermes đọc lại dưới khoá trước khi ghi |
| `hermes` không có trên PATH của dịch vụ dashboard | Dò `<HERMES_HOME>/bin/hermes(.exe)`, biến `ZALO_HERMES_BIN`; lỗi → 502 câu chung, Nhật ký ghi thất bại |
| Phiên Zalo rất dài (hàng nghìn tin) | Theo dõi agent chỉ đọc 1.500 tin mới nhất; mở/đóng CSDL mỗi lần |
| Kho tài liệu lớn trên ổ mạng (RaiDrive) | Trần 3.000 tệp, sâu 8, đệm 60 s |
| Tóm tắt AI tốn tiền / bị cài cắm | Chỉ chạy khi bấm; trần lượt/ngày ở plugin; không công cụ; một yêu cầu một lúc; chữ ra chỉ hiển thị |
| Dashboard cũ ghi đè làm rơi `tools.off` | Cập nhật cùng lúc; rơi thì công cụ bật lại như trước 7B |
| `tools-manifest.json` thiếu (plugin cũ) | Trang báo cập nhật plugin; không lỗi |
| Lời mời kết bạn: Zalo đổi định dạng `getFriendRecommendations` | Chuẩn hoá trong `zalo-directory.js` (một chỗ), bỏ mục lạ |
| Mở MCP cho thành viên qua Cấu hình | Hỏi lại trước khi lưu, Nhật ký ghi cũ → mới |

## 18.13 Giai đoạn sau (chưa làm)

**Bộ nhớ của bot = SQLite + OpenViking.** Dùng `zalo.sqlite` cho lịch sử chính xác (ai nói gì, lúc nào) và OpenViking cho trí nhớ ngữ nghĩa dài hạn, gộp lại thành `memory.provider` của Hermes. Thử trước trên VPS (Uyển Nhi, `hermes-openviking.service` đã chạy); không đụng máy nhà. Cần spec riêng: cái gì được ghi vào OpenViking (chỉ tóm tắt, không tin thô của người ngoài?), tách theo nhóm/người, quyền đọc của lượt người ngoài, xoá theo yêu cầu, chi phí embedding.
