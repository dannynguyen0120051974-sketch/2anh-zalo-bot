"""Xưởng tạo sản phẩm (spec §17): công thức, kiểm nội dung, chạy bộ dựng, viết bằng AI, hàng đợi, công cụ."""

import asyncio
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = os.path.dirname(__file__)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import plugins  # noqa: E402

plugins.__path__ = [os.path.join(ROOT, "hermes-plugin"), *list(plugins.__path__)]
from plugins.zalo_tools import group_permissions as gp  # noqa: E402
from plugins.zalo_tools.studio import recipes, validate  # noqa: E402

LIB = {"li-con-lac-don", "hoa-chuan-do"}


class RecipesTest(unittest.TestCase):
    def test_every_recipe_uses_a_studio_switch_and_a_known_builder(self):
        builders = {"studio_cli", "node_engine", "doan_docx", "markdown_docx", "game_html", "slides", "lecture_video"}
        for kind, recipe in recipes.RECIPES.items():
            self.assertEqual(kind, recipe.kind)
            self.assertIn(recipe.switch, gp.STUDIO_FEATURES, kind)
            self.assertIn(recipe.builder, builders, kind)
            self.assertTrue(recipe.outputs, kind)
            self.assertTrue(all(o.startswith(".") for o in recipe.outputs), kind)
        for switch in gp.STUDIO_FEATURES:
            self.assertTrue(recipes.kinds_for(switch), f"nút {switch} chưa có loại nào")

    def test_cli_arguments_are_fixed_and_only_reference_the_project_folder(self):
        for recipe in recipes.RECIPES.values():
            for arg in recipe.args:
                self.assertTrue(arg == "{project}" or "{" not in arg, f"{recipe.kind}: {arg}")
            if recipe.builder == "studio_cli":
                self.assertTrue(recipe.script.startswith("tools/vi/") and recipe.script.endswith(".py"), recipe.kind)

    def test_guides_follow_the_chosen_option(self):
        with tempfile.TemporaryDirectory() as tmp:
            studio, skills = Path(tmp, "studio"), Path(tmp, "skills")
            for rel in ("docs/vi/tro-ly/nhip-vox.md", "docs/vi/tro-ly/video-giai-thich.md", "docs/vi/tham-khao/video-viet-tay.md"):
                (studio / rel).parent.mkdir(parents=True, exist_ok=True)
                (studio / rel).write_text("x", encoding="utf-8")
            for rel in ("tro-choi-giao-duc/references/matching.md", "tro-choi-giao-duc/references/flashcard-timer.md"):
                (skills / rel).parent.mkdir(parents=True, exist_ok=True)
                (skills / rel).write_text("x", encoding="utf-8")
            where = recipes.Places(studio=studio, python=None, skills=skills, node=None)
            video, game = recipes.RECIPES["video"], recipes.RECIPES["tro_choi"]
            self.assertEqual([p.name for p in recipes.guide_paths(video, where, {"kieu": "vox"})], ["video-giai-thich.md", "nhip-vox.md"])
            self.assertEqual([p.name for p in recipes.guide_paths(video, where, {"kieu": "viet-tay"})], ["video-viet-tay.md"])
            self.assertEqual([p.name for p in recipes.guide_paths(game, where, {"loai": "matching"})], ["matching.md"])
            self.assertEqual([p.name for p in recipes.guide_paths(game, where, {"loai": "timer"})], ["flashcard-timer.md"])

    def test_node_engine_picks_generator_by_document_type(self):
        r = recipes.RECIPES["van_ban"]
        self.assertEqual(recipes.node_engine(r, "cong_van"), "engine/generate_cong_van_nd30.js")
        self.assertEqual(recipes.node_engine(r, "bien_ban"), "engine/generate_bien_ban_nd30.js")
        self.assertEqual(recipes.node_engine(r, "to_trinh"), "engine/generate_vb_co_ten_loai_nd30.js")
        self.assertEqual(recipes.node_engine(recipes.RECIPES["van_ban_dang"], "ket_luan"), "engine/generate_vb_co_ten_loai.js")

    def test_places_reads_env_and_reports_what_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            studio = Path(tmp, "studio")
            (studio / "tools" / "vi").mkdir(parents=True)
            py = studio / ("venv/Scripts/python.exe" if os.name == "nt" else "venv/bin/python")
            py.parent.mkdir(parents=True)
            py.write_text("")
            skills = Path(tmp, "skills")
            (skills / "de-kiem-tra").mkdir(parents=True)
            (skills / "de-kiem-tra" / "SKILL.md").write_text("# Đề", encoding="utf-8")
            with patch.dict(os.environ, {"ZALO_STUDIO_DIR": str(studio), "ZALO_STUDIO_SKILLS_DIR": str(skills),
                                         "ZALO_STUDIO_PYTHON": ""}):
                where = recipes.places()
            self.assertEqual(where.studio, studio)
            self.assertEqual(where.python, py)
            self.assertIsNone(recipes.missing(recipes.RECIPES["giao_an"], where))
            self.assertIsNone(recipes.missing(recipes.RECIPES["de_kiem_tra"], where))
            self.assertIn("bộ soạn văn bản", recipes.missing(recipes.RECIPES["van_ban"], where))
            self.assertEqual(recipes.guide_paths(recipes.RECIPES["de_kiem_tra"], where, {}),
                             (skills / "de-kiem-tra" / "SKILL.md",))
            with patch.dict(os.environ, {"ZALO_STUDIO_DIR": str(Path(tmp, "khong-co"))}):
                self.assertIn("2Anh Studio", recipes.missing(recipes.RECIPES["video"], recipes.places()))


class ValidateTest(unittest.TestCase):
    def test_clean_text_strips_fences_and_limits(self):
        self.assertEqual(validate.clean_text("```markdown\n# Bài 1\n```"), "# Bài 1\n")
        with self.assertRaises(validate.SourceError):
            validate.clean_text("   ")
        with self.assertRaises(validate.SourceError):
            validate.clean_text("a\x00b")
        with self.assertRaises(validate.SourceError):
            validate.clean_text("x" * 61_000)

    def test_thi_nghiem_accepts_only_library_models(self):
        ok = "---\ntieu-de: Con lắc\nmon: Vật lí\nlop: 10\nmau: li-con-lac-don\n---\n"
        self.assertIn("mau: li-con-lac-don", validate.check_thi_nghiem(ok, LIB))
        for bad in (ok.replace("li-con-lac-don", "moi"), ok.replace("li-con-lac-don", "khong-co"), "mau: moi\n"):
            with self.assertRaises(validate.SourceError, msg=bad):
                validate.check_thi_nghiem(bad, LIB)

    def test_video_all_styles_images_only_as_requests_and_forced_720(self):
        base = "---\ntieu-de: T\nmon: Lí\nlop: 10\ndo-phan-giai: 1080\nthoi-luong: 60\n---\n\n## Cảnh 1\nloai: tieu-de\nchu: Xin chào\nloi: Chào.\n"
        out = validate.check_video(base, LIB)
        self.assertIn("do-phan-giai: 720", out)
        self.assertNotIn("1080", out)
        self.assertIn("## Cảnh 1", out)
        vox = base.replace("lop: 10", "lop: 10\nphong-cach: vox\nnhan-vat: ve: cô giáo trẻ áo dài") + "nen: ve: lớp học buổi sáng\nanh: tim: mitochondria\n"
        self.assertIn("phong-cach: vox", validate.check_video(vox, LIB))
        self.assertIn("phong-cach: cat-dan", validate.check_video(base.replace("lop: 10", "lop: 10\nphong-cach: cat-dan"), LIB))
        self.assertIn("thoi-luong: 180", validate.check_video(base.replace("thoi-luong: 60", "thoi-luong: 180"), LIB))
        bad_cases = [
            base.replace("thoi-luong: 60", "thoi-luong: 181"),
            base.replace("lop: 10", "lop: 10\nnhac-nen: a.mp3"),
            base.replace("lop: 10", "lop: 10\nphong-cach: khac"),
            base + "anh: tim: cat\n",                                    # ảnh chỉ với vox
            vox.replace("anh: tim: mitochondria", "anh: ../../.env"),       # không phải lời xin
            vox.replace("anh: tim: mitochondria", "anh: tim: https://evil.vn/x.png"),
            vox.replace("anh: tim: mitochondria", "anh: ve: C:\\Hermes\\.env"),
            vox.replace("nhan-vat: ve: cô giáo trẻ áo dài", "nhan-vat: anh-co-san.png"),
            base + "\n## Cảnh 2\nloai: thi-nghiem\nmau: moi\nloi: x\n",
        ]
        for bad in bad_cases:
            with self.assertRaises(validate.SourceError, msg=bad):
                validate.check_video(bad, LIB)

    def test_svg_allows_shapes_inline_images_and_local_refs_only(self):
        ok = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" data-pptx-page-role="cover">'
              '<defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="10" height="10"/>'
              '<use href="#g"/><image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/>'
              '<text x="1" y="2">Xin chào</text></svg>')
        self.assertEqual(validate.check_svg(ok).strip(), ok)
        bad_cases = [
            '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg viewBox="0 0 1 1">&x;</svg>',
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><image href="../../.env"/></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1 1">'
            '<image xlink:href="file:///E:/Hermes/.env"/></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect style="fill:url(http://x/y)"/></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><style>@import "x.css";</style></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect onload="x()"/></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><a href="https://lừa.vn"><text>Bấm</text></a></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><foreignObject/></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
            '<svg viewBox="0 0 1 1"><rect',
        ]
        for bad in bad_cases:
            with self.assertRaises(validate.SourceError, msg=bad):
                validate.check_svg(bad)

    def test_svg_image_refs_only_for_downloaded_ids_and_rewritten_to_local_paths(self):
        page = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><image href="img:w1" width="1" height="1"/>'
                "<image href='img:a2' width='1' height='1'/></svg>")
        out = validate.check_svg(page, {"w1": "../images/w1.jpg", "a2": "../images/a2.png"})
        self.assertIn('href="../images/w1.jpg"', out)
        self.assertIn("href='../images/a2.png'", out)
        self.assertNotIn("img:", out)
        for refs in ({"w1": "../images/w1.jpg"}, {}, None):
            with self.assertRaises(validate.SourceError, msg=refs):
                validate.check_svg(page, refs)
        with self.assertRaises(validate.SourceError):
            validate.check_svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><image href="img:../x"/></svg>', {"x": "a"})

    def test_engine_json_checks_type_and_drops_output_path(self):
        data = validate.check_engine_json(json.dumps({"loai_van_ban": "thong_bao", "noi_dung": "A",
                                                      "output_path": "C:/Windows/x.docx", "noi_nhan": ["a"]}),
                                          recipes.ND30_TYPES)
        self.assertNotIn("output_path", data)
        for bad in ('{"loai_van_ban": "hack"}', "[1]", "{hỏng", json.dumps({"loai_van_ban": "thong_bao", "x": {"a": {"b": {"c": {"d": {"e": {"f": 1}}}}}}})):
            with self.assertRaises(validate.SourceError, msg=bad):
                validate.check_engine_json(bad, recipes.ND30_TYPES)

    def test_games_all_six_templates_closed_schemas(self):
        mk = lambda d: json.dumps({"title": "Ôn tập", **d})
        self.assertEqual(validate.check_game(mk({"pairs": [{"left": "a", "right": "b"}, {"left": "c", "right": "d", "x": "<b>"}]}), "matching")["pairs"][1],
                         {"left": "c", "right": "d"})
        cw = validate.check_game(mk({"keyword": "Tế bào", "keywordClue": "đơn vị sống", "rows": [
            {"displayAnswer": "ATP", "clue": "c1"}, {"displayAnswer": "Enzim", "clue": "c2"}, {"displayAnswer": "Ribôxôm", "clue": "c3"},
            {"displayAnswer": "Quang hợp", "clue": "c4"}, {"displayAnswer": "Nhân con", "clue": "c5"}]}), "crossword")
        self.assertEqual(cw["keywordCol"], 5)
        for row in cw["rows"]:
            self.assertEqual(row["answer"][cw["keywordCol"] - row["startCol"]], "TEBAO"[cw["rows"].index(row)])
        sw = validate.check_game(mk({"mode": "quiz", "segments": [{"label": "Câu 1", "question": "q", "options": ["x", "y"], "correct": 1},
                                                                   {"label": "Câu 2", "question": "q", "options": ["x", "y"], "correct": 0}]}), "spinwheel")
        self.assertEqual(sw["segments"][0]["correct"], 1)
        self.assertEqual(len(validate.check_game(mk({"cards": [{"front": "a", "back": "b"}, {"front": "c", "back": "d"}]}), "flashcard")["cards"]), 2)
        self.assertEqual(validate.check_game(mk({"mode": "countdown", "presets": [60, 300]}), "timer")["presets"], [60, 300])
        self.assertEqual(validate.check_game(mk({"questions": [{"q": "1+1", "a": "2"}] * 3}), "timer")["mode"], "speedquiz")
        self.assertEqual(validate.check_game(mk({"questions": [{"question": "q", "options": ["a", "b"], "correct": 0}]}), "quiz")["type"], "quiz")
        bad = [
            (mk({"keyword": "AB", "rows": []}), "crossword"),
            (mk({"keyword": "TEBAO", "keywordClue": "x", "rows": [{"displayAnswer": "XYZ", "clue": "c"}] * 5}), "crossword"),
            (mk({"segments": [{"label": "rất rất rất dài quá hai mươi ký tự"}] * 2}), "spinwheel"),
            (mk({"segments": [{"label": "a"}] * 13}), "spinwheel"),
            (mk({"mode": "countdown", "presets": [5]}), "timer"),
            (mk({"pairs": [{"left": "a"}] * 2}), "matching"),
            (mk({"cards": "x"}), "flashcard"),
            (mk({}), "tu-mo-ta"),
        ]
        for text, kind in bad:
            with self.assertRaises(validate.SourceError, msg=(kind, text)):
                validate.check_game(text, kind)

    def test_doan_json_one_line_fields_closed_blocks(self):
        good = {"loai": "ke_hoach", "don_vi_cap_tren": "Trường THPT Chuyên Nguyễn Trãi", "so": "21", "dia_danh": "Hải Phòng",
                "ngay": "02", "thang": "10", "nam": "2026", "trich_yeu": "Tổ chức sinh hoạt chuyên đề",
                "noi_dung": [{"muc": "I. MỤC ĐÍCH"}, {"doan": "- Nâng cao nhận thức"}, {"bang": [["STT", "Lớp"], ["1", "10A"]]}],
                "noi_nhan": ["Ban Giám hiệu (để báo cáo);", "Lưu: VP Đoàn trường."]}
        data = validate.check_doan_json(json.dumps(good))
        self.assertEqual(data["don_vi_cap_tren"], "TRƯỜNG THPT CHUYÊN NGUYỄN TRÃI")
        self.assertEqual((data["don_vi"], data["quyen_han"], data["chuc_vu"]),
                         ("BAN CHẤP HÀNH ĐOÀN TRƯỜNG", "TM. BAN CHẤP HÀNH ĐOÀN TRƯỜNG", "Bí thư"))
        for patch_ in ({"loai": "quy_che"}, {"so": "21/KH"}, {"noi_dung": [{"muc": "a", "doan": "b"}]},
                       {"noi_dung": [{"bang": [["a", "b"], ["c"]]}]}, {"noi_nhan": []}, {"trich_yeu": ""},
                       {"don_vi_cap_tren": "X" * 61}):
            with self.assertRaises(validate.SourceError, msg=patch_):
                validate.check_doan_json(json.dumps({**good, **patch_}))

    def test_quiz_schema_is_closed_and_bounded(self):
        q = {"title": "Ôn tập Hoá", "subject": "Hoá 10", "timePerQuestion": 20,
             "questions": [{"question": "H₂O là gì?", "options": ["Nước", "Muối"], "correct": 0, "extra": "<script>"}]}
        out = validate.check_quiz(json.dumps(q))
        self.assertEqual(out["questions"][0], {"question": "H₂O là gì?", "options": ["Nước", "Muối"], "correct": 0})
        for patch_ in ({"timePerQuestion": 1}, {"questions": []}, {"title": ""},
                       {"questions": [{"question": "a", "options": ["x"], "correct": 0}]},
                       {"questions": [{"question": "a", "options": ["x", "y"], "correct": 2}]},
                       {"questions": [{"question": "a", "options": ["x", "y"], "correct": True}]}):
            with self.assertRaises(validate.SourceError, msg=patch_):
                validate.check_quiz(json.dumps({**q, **patch_}))

from plugins.zalo_tools.studio import sandbox  # noqa: E402


class SandboxTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="zalo-studio-test-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        (self.dir / "tmp").mkdir()

    def test_clean_env_drops_secrets_and_points_temp_into_the_job(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-x", "ZALO_BRIDGE_TOKEN": "t", "ANH_AI_KEY": "k",
                                     "PATH": "/usr/bin", "LOCALAPPDATA": "C:/x"}):
            env = sandbox.clean_env(self.dir, network=False)
            self.assertFalse({"OPENAI_API_KEY", "ZALO_BRIDGE_TOKEN", "ANH_AI_KEY", "LOCALAPPDATA"} & set(env))
            self.assertEqual(env["TEMP"], str(self.dir / "tmp"))
            self.assertEqual(env["HOME"], str(self.dir))
            self.assertEqual(env["PATH"], "/usr/bin")
            self.assertIn("LOCALAPPDATA", sandbox.clean_env(self.dir, network=True))

    def test_systemd_command_isolates_user_home_network_and_resources(self):
        cmd = sandbox.systemd_command(["/opt/s/venv/bin/python", "tools/vi/giao_an.py", "xuat", "/var/lib/zalo-studio/j1/p"],
                                      Path("/var/lib/zalo-studio/j1"), {"PATH": "/usr/bin", "HOME": "/var/lib/zalo-studio/j1"},
                                      network=False, timeout=300, read_only=[])
        self.assertEqual(cmd[:2], ["systemd-run", "--quiet"])
        props = [cmd[i + 1] for i, part in enumerate(cmd) if part == "-p"]
        for needed in ("User=nobody", "ProtectSystem=strict", "ProtectHome=tmpfs", "NoNewPrivileges=yes",
                       "PrivateNetwork=yes", "CapabilityBoundingSet=", "RuntimeMaxSec=300",
                       "ReadWritePaths=/var/lib/zalo-studio/j1"):
            self.assertIn(needed, props)
        self.assertEqual(cmd[cmd.index("--") + 1:], ["/opt/s/venv/bin/python", "tools/vi/giao_an.py", "xuat",
                                                     "/var/lib/zalo-studio/j1/p"])
        self.assertIn("HOME=/var/lib/zalo-studio/j1", cmd)
        net = sandbox.systemd_command(["x"], Path("/w"), {}, network=True, timeout=10)
        net_props = [net[i + 1] for i, part in enumerate(net) if part == "-p"]
        self.assertNotIn("PrivateNetwork=yes", net_props)
        self.assertTrue(any(p.startswith("IPAddressDeny=localhost") for p in net_props))

    def test_mode_is_plain_off_linux_root_and_can_be_forced_off(self):
        with patch.dict(os.environ, {"ZALO_STUDIO_SANDBOX": "none"}):
            self.assertEqual(sandbox.mode(), "plain")
        if os.name == "nt":
            self.assertEqual(sandbox.mode(), "plain")

    def test_read_only_paths_binds_the_python_store_and_extras(self):
        with patch.dict(os.environ, {"ZALO_STUDIO_BIND": "/root/a, /root/b"}):
            paths = sandbox.read_only_paths(None, Path("/root/.cache/ms-playwright"))
        self.assertEqual(paths, [Path("/root/.cache/ms-playwright"), Path("/root/a"), Path("/root/b")])

    async def test_run_captures_output_and_kills_on_timeout(self):
        with patch.dict(os.environ, {"ZALO_STUDIO_SANDBOX": "none", "ZALO_BRIDGE_TOKEN": "bí-mật"}):
            ok = await sandbox.run([sys.executable, "-c", "import os,json;print(json.dumps({'ready': True, 't': os.environ.get('ZALO_BRIDGE_TOKEN')}))"],
                                   self.dir, timeout=60)
            self.assertEqual(ok.code, 0)
            self.assertEqual(json.loads(ok.out.strip().splitlines()[-1]), {"ready": True, "t": None})
            # timeout=-29 → chờ tối đa 1 giây (run cộng 30 giây cho systemd tự dừng trước).
            slow = await sandbox.run([sys.executable, "-c", "import time; time.sleep(30)"], self.dir, timeout=-29)
            self.assertTrue(slow.timed_out)
            self.assertIsNone(slow.code)


from plugins.zalo_tools.studio import images  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PUBLIC = lambda host, port: ["93.184.216.34"]  # noqa: E731


def mock_client(handler):
    import httpx
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False)


class ImagesTest(unittest.IsolatedAsyncioTestCase):
    def test_magic_bytes_and_public_addresses(self):
        self.assertEqual(images.sniff(PNG), "png")
        self.assertEqual(images.sniff(JPG), "jpg")
        self.assertIsNone(images.sniff(b"<svg onload=alert(1)>"))
        self.assertIsNone(images.sniff(b"GIF89a"))
        for ip in ("127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
                   "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "224.0.0.1", "lạ"):
            self.assertFalse(images.is_public(ip), ip)
        self.assertTrue(images.is_public("93.184.216.34"))

    def test_check_url_https_only_and_every_resolved_address_must_be_public(self):
        self.assertEqual(images.check_url("https://upload.wikimedia.org/a.png?x=1", PUBLIC),
                         ("upload.wikimedia.org", "93.184.216.34", 443, "/a.png?x=1"))
        for url, resolver in (("http://a.vn/x.png", PUBLIC), ("https://u:p@a.vn/x", PUBLIC), ("https://localhost/x", PUBLIC),
                              ("https://máy.local/x", PUBLIC), ("https://10.0.0.5/x", PUBLIC),
                              ("https://rebind.vn/x", lambda h, p: ["93.184.216.34", "127.0.0.1"]),
                              ("https://nội-bộ.vn/x", lambda h, p: ["192.168.1.10"]), ("file:///E:/Hermes/.env", PUBLIC)):
            with self.assertRaises(images.ImageError, msg=url):
                images.check_url(url, resolver)

    async def test_fetch_pins_the_checked_ip_and_rechecks_every_redirect(self):
        seen = []

        def handler(request):
            seen.append((str(request.url), request.headers["host"], request.extensions.get("sni_hostname")))
            if request.headers["host"] == "a.vn":
                return __import__("httpx").Response(302, headers={"location": "https://b.vn/real.png"})
            return __import__("httpx").Response(200, headers={"content-type": "image/png"}, content=PNG)

        async with mock_client(handler) as client:
            data, kind = await images.fetch("https://a.vn/x.png", max_bytes=1000, accept=("image/",), client=client, resolver=PUBLIC)
        self.assertEqual((data, kind), (PNG, "image/png"))
        self.assertEqual(seen[0], ("https://93.184.216.34/x.png", "a.vn", "a.vn"))
        self.assertEqual(seen[1][1:], ("b.vn", "b.vn"))

        def to_private(request):
            return __import__("httpx").Response(302, headers={"location": "https://169.254.169.254/latest/meta-data"})

        async with mock_client(to_private) as client:
            with self.assertRaises(images.ImageError):
                await images.fetch("https://a.vn/x.png", max_bytes=1000, accept=("image/",), client=client, resolver=PUBLIC)

    async def test_fetch_caps_size_type_and_redirect_count(self):
        import httpx
        for handler in (lambda r: httpx.Response(200, headers={"content-type": "image/png"}, content=PNG * 100),
                        lambda r: httpx.Response(200, headers={"content-type": "text/html"}, content=b"<html>"),
                        lambda r: httpx.Response(302, headers={"location": "https://a.vn/again"}),
                        lambda r: httpx.Response(500)):
            async with mock_client(handler) as client:
                with self.assertRaises(images.ImageError):
                    await images.fetch("https://a.vn/x", max_bytes=1000, accept=("image/",), client=client, resolver=PUBLIC)

    async def test_generate_uses_the_owner_endpoint_and_accepts_only_png_or_jpeg(self):
        import base64
        import httpx
        calls = []

        def handler(request):
            calls.append((str(request.url), request.headers.get("authorization"), json.loads(request.content)))
            return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(PNG).decode()}]})

        cfg = images.ImageConfig(url="http://127.0.0.1:20128/v1", key="khoa-cua-chu", model="ag/gemini-3.1-flash-image")
        async with mock_client(handler) as client:
            picture = await images.generate("  tế bào\n  nhân thực  ", "1536x1024", config=cfg, client=client)
        self.assertEqual((picture.ext, picture.data), ("png", PNG))
        self.assertEqual(calls[0][0], "http://127.0.0.1:20128/v1/images/generations")
        self.assertEqual(calls[0][1], "Bearer khoa-cua-chu")
        self.assertEqual(calls[0][2], {"model": "ag/gemini-3.1-flash-image", "prompt": "tế bào nhân thực", "size": "1536x1024", "n": 1})
        for body in ({"data": [{"b64_json": base64.b64encode(b"<svg/>").decode()}]}, {"data": []}, {"lỗi": 1}):
            async with mock_client(lambda r, b=body: httpx.Response(200, json=b)) as client:
                with self.assertRaises(images.ImageError, msg=body):
                    await images.generate("x", "1024x1024", config=cfg, client=client)

    async def test_search_web_takes_an_openverse_result_with_credit(self):
        import httpx

        def handler(request):
            if request.headers["host"] == images.OPENVERSE_HOST:
                self.assertIn("q=te+bao", str(request.url))
                return httpx.Response(200, headers={"content-type": "application/json"}, json={"results": [
                    {"url": "http://khong-https.vn/a.jpg"},
                    {"url": "https://upload.wikimedia.org/a.jpg", "creator": "BruceBlaus", "license": "by", "license_version": "4.0",
                     "source": "wikimedia", "foreign_landing_url": "https://commons.wikimedia.org/x"}]})
            return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=JPG)

        async with mock_client(handler) as client:
            picture = await images.search_web("te bao", client=client, resolver=PUBLIC)
        self.assertEqual((picture.ext, picture.author, picture.license, picture.provider), ("jpg", "BruceBlaus", "CC BY 4.0", "Openverse/wikimedia"))

    def test_save_uses_plugin_names_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = images.save(images.Picture(PNG, "png"), Path(tmp), "a1")
            self.assertEqual(path.name, "a1.png")
            for bad in ("../x", "a/b", "a.png", ""):
                with self.assertRaises(images.ImageError, msg=bad):
                    images.save(images.Picture(PNG, "png"), Path(tmp), bad)
