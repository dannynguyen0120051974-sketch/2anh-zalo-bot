"""Hàng đợi xưởng: nhận việc, viết (AI không công cụ) → kiểm → dựng (tiến trình con) → gửi → dọn.

Chạy trên MỘT luồng riêng có vòng lặp asyncio của nó: vòng lặp của luồng agent chỉ chạy khi có
công cụ đang chạy, việc nền gắn vào đó sẽ đứng im ngay khi ``zalo_studio`` trả lời. Mặc định một
việc một lúc (``ZALO_STUDIO_CONCURRENCY`` tối đa 2), tối đa 5 việc chờ, mỗi người một việc.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import shutil
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence, Tuple

from . import author, builtin, doan_docx, images, recipes, sandbox, validate
from .. import group_permissions as gp
from .ledger import Ledger

logger = logging.getLogger(__name__)

MAX_QUEUE = 5
MAX_FILES = 4
MAX_FILE_BYTES = {".mp4": 200 * 1024 * 1024}
DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_SLIDE_PAGES = validate.MAX_PAGES
STALE_DIR_SECONDS = 24 * 3600
# error.step của bộ dựng 2Anh Studio do NỘI DUNG sai (viết lại được); bước khác là lỗi máy.
CONTENT_STEPS = {"input", "parse", "canh", "model", "check", "framework", "json", "the-thuc"}
SLIDE_MAX_AI_IMAGES = 4
SLIDE_MAX_WEB_IMAGES = 6
IMAGE_TOOL_NAME = "2Anh Zalo (máy chủ)"
LECTURE_VOICE = "vi-VN-HoaiMyNeural"
# Mã lỗi của bộ kiểm văn bản Đoàn do DỮ LIỆU còn thiếu (bản nháp) — không phải lỗi thể thức của bộ sinh.
DOAN_DRAFT_CODES = {"placeholder": "Bản nháp: còn ô [CẦN BỔ SUNG] cần điền",
                    "invalid_document_number": "Số văn bản để trống cho văn thư điền"}


class StudioError(Exception):
    """Việc hỏng. ``refund``: lỗi do máy (trả lượt); ngược lại do nội dung (vẫn tính lượt)."""

    def __init__(self, message: str, *, refund: bool):
        super().__init__(message)
        self.refund = refund


class Busy(Exception):
    pass


@dataclass
class Job:
    id: str
    kind: str
    brief: str
    options: Dict[str, str]
    turn: Dict[str, Any]          # danh tính chụp lúc nhận việc — nơi gửi trả, không lấy từ mô hình
    created: float = field(default_factory=time.time)

    @property
    def uid(self) -> str:
        return str(self.turn.get("sender_uid") or "")

    @property
    def name(self) -> str:
        return str(self.turn.get("sender_name") or "") or "bạn"

    @property
    def recipe(self) -> recipes.Recipe:
        return recipes.RECIPES[self.kind]


def new_job_id() -> str:
    return time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)


@dataclass
class Outcome:
    files: List[Path]
    notes: List[str]
    usage: author.Usage
    images: int = 0


# ---------------------------------------------------------------------- dựng
def _last_json(text: str) -> Dict[str, Any]:
    for line in reversed((text or "").strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                value = json.loads(line)
                return value if isinstance(value, dict) else {}
            except json.JSONDecodeError:
                return {}
    return {}


def collect(job_dir: Path, project: Path, outputs: Sequence[str]) -> List[Path]:
    """Tệp kết quả: nằm trong thư mục việc, đúng đuôi, không quá cỡ; nhiều nhất 4 tệp. Quét lại thư mục việc trước
    (liên kết tượng trưng/tệp lạ → dừng, tính lượt)."""
    try:
        sandbox.scan_job_dir(job_dir)
    except sandbox.UnsafeJobDir:
        raise StudioError("bộ dựng để lại tệp không an toàn nên đã dừng", refund=False) from None
    root = job_dir.resolve()
    found = []
    for path in sorted(project.rglob("*")):
        try:
            real = path.resolve()
        except OSError:
            continue
        if path.is_symlink() or not real.is_file() or root not in real.parents:
            continue
        if real.suffix.lower() not in outputs or "backup" in real.relative_to(root).parts:
            continue
        if real.stat().st_size > MAX_FILE_BYTES.get(real.suffix.lower(), DEFAULT_MAX_FILE_BYTES):
            raise StudioError("tệp làm ra quá lớn để gửi qua Zalo", refund=False)
        found.append(real)
    if not found:
        raise StudioError("bộ dựng không tạo ra tệp nào", refund=True)
    return found[:MAX_FILES]


class Builder:
    """Một việc: chỗ cài, thư mục việc, AI viết, chạy bộ dựng. Tách riêng để test thay từng phần."""

    def __init__(self, job: Job, llm: Any, where: recipes.Places, job_dir: Path):
        self.job, self.llm, self.where, self.job_dir = job, llm, where, job_dir
        self.recipe = job.recipe
        self.project = job_dir / "p"
        self.usage = author.Usage()
        self.notes: List[str] = []
        self.images_used = 0
        self.guides = author.read_guides(recipes.guide_paths(self.recipe, where, job.options))

    async def write(self, *, types: Sequence[str] = (), repair: Optional[Tuple[str, str]] = None) -> str:
        return await author.write_source(
            self.llm, kind=self.job.kind, builder=self.recipe.builder, source=self.recipe.source,
            guides=self.guides, brief=self.job.brief, options=self.job.options, usage=self.usage,
            types=types, repair=repair)

    async def run(self, argv: Sequence[str], *, timeout: Optional[int] = None,
                  extra: Sequence[Optional[Path]] = (), extra_env: Optional[Dict[str, str]] = None,
                  network: Optional[bool] = None) -> sandbox.Result:
        """``network``: None = theo công thức. Bước nào không cần mạng thì truyền False (lập kế hoạch ảnh, kiểm…).

        Trước MỖI bước, ``prepare_job_dir`` quét thư mục việc: bộ dựng (đã chạy nội dung của AI) để lại liên kết
        tượng trưng / tệp đặc biệt / liên kết cứng → gỡ và dừng việc, TÍNH lượt (nghi do nội dung). Đường dẫn cấu
        hình không dùng được cho systemd (khoảng trắng…) → lỗi máy, trả lượt."""
        try:
            sandbox.prepare_job_dir(self.job_dir)
            read_only = sandbox.read_only_paths(str(self.where.python) if self.where.python else None,
                                                self.where.studio, *extra)
            return await sandbox.run(argv, self.job_dir, timeout=timeout or self.recipe.timeout,
                                     network=self.recipe.network if network is None else network,
                                     read_only=read_only, extra_env=extra_env)
        except sandbox.UnsafeJobDir as exc:
            logger.warning("[zalo] xưởng %s: %s", self.job.id, exc)
            raise StudioError("bộ dựng để lại tệp không an toàn nên đã dừng", refund=False) from None
        except sandbox.SandboxConfigError as exc:
            logger.error("[zalo] xưởng %s: %s", self.job.id, exc)
            raise StudioError("hộp cát trên máy chủ cấu hình sai", refund=True) from None

    # -- ảnh: chỉ plugin vẽ/tải, ở tiến trình cha (studio/images.py) --------------
    async def picture(self, request: Dict[str, str], *, size: str, orientation: str) -> images.Picture:
        if "ai" in request:
            picture = await images.generate(request["ai"], size)
        else:
            picture = await images.search_web(request["web"], orientation)
        self.images_used += 1
        return picture

    async def deck_images(self, requests: List[Dict[str, str]], folder: Path) -> Dict[str, Dict[str, str]]:
        """Ảnh slide mô hình đã xin → ``{mã: {path (tương đối từ svg_output), note}}``; ảnh không lấy được thì bỏ."""
        got: Dict[str, Dict[str, str]] = {}
        for request in requests:
            try:
                picture = await self.picture(request, size="1536x1024", orientation="landscape")
            except images.ImageError as exc:
                logger.info("[zalo] xưởng %s: bỏ ảnh %s — %s", self.job.id, request["id"], exc)
                self.notes.append(f"không lấy được ảnh {request['id']} ({exc})")
                continue
            path = images.save(picture, folder, request["id"], root=self.job_dir)
            credit = ("ảnh vẽ bằng AI" if "ai" in request
                      else f"ảnh web — ghi nhỏ dưới ảnh: 'Ảnh: {picture.author} · {picture.license}'")
            got[request["id"]] = {"path": f"../images/{path.name}",
                                  "note": f"{(request.get('ai') or request.get('web'))[:80]}; {credit}"}
        return got

    async def with_repair(self, attempt: Callable[[str], Awaitable[List[Path]]], first: str) -> List[Path]:
        """Thử nội dung; nội dung sai thì nhờ AI viết lại đúng một lần."""
        text = first
        for round_ in (1, 2):
            try:
                return await attempt(text)
            except validate.SourceError as exc:
                if round_ == 2:
                    raise StudioError(f"nội dung chưa dựng được ({exc})", refund=False) from None
                logger.info("[zalo] xưởng %s: viết lại vì %s", self.job.id, exc)
                text = await self.write(types=self._types(), repair=(text, str(exc)))
        raise AssertionError("unreachable")

    def _types(self) -> Sequence[str]:
        return recipes.DOC_TYPES.get(self.recipe.script, ())

    # -- từng loại bộ dựng -------------------------------------------------
    async def studio_cli(self) -> List[Path]:
        library = validate.library_ids(self.where.studio)
        extra_env: Dict[str, str] = {}
        extra: List[Optional[Path]] = []
        if self.recipe.kind == "video":
            browsers = sandbox.browsers_dir()
            extra.append(browsers)
            if browsers:
                extra_env = {"PLAYWRIGHT_BROWSERS_PATH": str(browsers), "LOCALAPPDATA": str(browsers.parent)}

        async def attempt(text: str) -> List[Path]:
            if self.recipe.kind == "thi_nghiem":
                text = validate.check_thi_nghiem(text, library)
            elif self.recipe.kind == "video":
                text = validate.check_video(text, library)
            else:
                text = validate.clean_text(text)
            if self.project.exists():
                shutil.rmtree(self.project)
            self.project.mkdir(parents=True)
            (self.project / self.recipe.source).write_text(text, encoding="utf-8")
            if self.recipe.kind == "video" and validate.front_matter(text)[0].get("phong-cach") == "vox":
                await self.vox_images(extra, extra_env)
            args = [a.replace("{project}", str(self.project)) for a in self.recipe.args]
            result = await self.run([str(self.where.python), str(self.where.studio / self.recipe.script), *args],
                                    extra=extra, extra_env=extra_env)
            return self._studio_result(result)

        return await self.with_repair(attempt, await self.write())

    async def vox_images(self, extra: Sequence[Optional[Path]], extra_env: Optional[Dict[str, str]]) -> None:
        """Video Vox: 2Anh Studio LẬP KẾ HOẠCH ảnh (trong hộp cát, không mạng) → plugin vẽ/tải đúng các ảnh đó ở
        tiến trình cha → 2Anh Studio xử lý ảnh đã có (trong hộp cát, không mạng, không khoá)."""
        script = str(self.where.studio / "tools" / "vi" / "anh_vox.py")
        plan = await self.run([str(self.where.python), script, str(self.project), "--chi-ke-hoach"], timeout=120,
                              network=False, extra=extra, extra_env=extra_env)
        if plan.timed_out or not _last_json(plan.out).get("ready"):
            error = _last_json(plan.out).get("error") or {}
            if error.get("step") in CONTENT_STEPS:
                raise validate.SourceError(str(error.get("message") or "kế hoạch ảnh sai")[:600])
            raise StudioError("chưa lập được kế hoạch ảnh cho video", refund=True)
        try:
            raw = sandbox.read_file(self.job_dir, self.project / "anh" / "ai" / "ke-hoach.json", limit=2_000_000)
            items = json.loads(raw.decode("utf-8"))["muc"]
        except sandbox.UnsafeJobDir:
            raise StudioError("kế hoạch ảnh của video không an toàn", refund=False) from None
        except (OSError, ValueError, KeyError, TypeError):
            raise StudioError("kế hoạch ảnh của video hỏng", refund=True) from None
        root = self.project.resolve()
        wanted = []
        for item in items if isinstance(items, list) else []:
            source = item.get("nguon") if isinstance(item, dict) else None
            if source not in ("ve", "tim"):
                raise validate.SourceError("video chỉ dùng ảnh `ve:` hoặc `tim:` (không dùng tệp có sẵn)")
            target = (self.project / str(item.get("file_goc") or "")).resolve()
            size = str(item.get("kich_thuoc") or "1920x1080")
            if root not in target.parents or target.suffix not in (".png", ".jpg") or not re.fullmatch(r"\d{3,4}x\d{3,4}", size):
                raise StudioError("kế hoạch ảnh của video có mục lạ", refund=True)
            wanted.append((source, str(item.get("prompt") or ""), size, target))
        if sum(1 for w in wanted if w[0] == "ve") > images.MAX_AI_IMAGES:
            raise validate.SourceError(f"video cần quá {images.MAX_AI_IMAGES} ảnh AI — bớt nhịp `anh: ve:`/nền cảnh")
        if sum(1 for w in wanted if w[0] == "tim") > images.MAX_WEB_IMAGES:
            raise validate.SourceError(f"video cần quá {images.MAX_WEB_IMAGES} ảnh web — bớt nhịp `anh: tim:`")
        sources = []
        for source, prompt, size, target in wanted:
            if target.is_file():
                continue
            request = {"ai": prompt} if source == "ve" else {"web": prompt}
            try:
                width, height = (int(n) for n in size.split("x"))
                picture = await self.picture(request, size=size, orientation="portrait" if width < height else "landscape")
            except images.ImageError as exc:
                raise StudioError(f"không lấy được ảnh cho video ({exc})", refund=True) from None
            try:
                sandbox.write_file(self.job_dir, target, picture.data)   # không theo liên kết, không ra ngoài
            except sandbox.UnsafeJobDir:
                raise StudioError("thư mục ảnh của video không an toàn", refund=False) from None
            if source == "tim":
                sources.append({"filename": target.name, "author": picture.author, "license_name": picture.license,
                                "provider": picture.provider, "source_url": picture.source_url})
        if sources:
            images.sources_manifest(sources, self.project / "anh" / "image_sources.json", root=self.job_dir)
        model = images.image_config().model
        done = await self.run([str(self.where.python), script, str(self.project), "--cong-cu", IMAGE_TOOL_NAME,
                               "--mo-hinh", model], timeout=900, network=False, extra=extra, extra_env=extra_env)
        if done.timed_out or not _last_json(done.out).get("ready"):
            logger.warning("[zalo] xưởng %s: xử lý ảnh Vox lỗi — %s", self.job.id, (done.out + done.err)[-2000:])
            raise StudioError("chưa xử lý được ảnh cho video", refund=True)

    def _studio_result(self, result: sandbox.Result) -> List[Path]:
        if result.timed_out:
            raise StudioError("làm quá lâu nên đã dừng", refund=True)
        report = _last_json(result.out)
        if report.get("ready"):
            self.notes = [str(w)[:200] for w in (report.get("warnings") or [])[:3]]
            return collect(self.job_dir, self.project, self.recipe.outputs)
        error = report.get("error") if isinstance(report.get("error"), dict) else {}
        if error.get("step") in CONTENT_STEPS:
            raise validate.SourceError(str(error.get("message") or "nội dung sai ngữ pháp")[:600])
        logger.warning("[zalo] xưởng %s: bộ dựng lỗi %s — %s", self.job.id, error or result.code, result.err[-2000:])
        raise StudioError("máy chủ chưa dựng được sản phẩm này", refund=True)

    async def node_engine(self) -> List[Path]:
        skill = self.where.skills / self.recipe.script

        async def attempt(text: str) -> List[Path]:
            data = validate.check_engine_json(text, self._types())
            if self.project.exists():
                shutil.rmtree(self.project)
            self.project.mkdir(parents=True)
            source = self.project / self.recipe.source
            source.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            out = self.project / "van-ban.docx"
            script = skill / recipes.node_engine(self.recipe, data["loai_van_ban"])
            result = await self.run([self.where.node, str(script), "--input", str(source), "--output", str(out)],
                                    extra=[skill])
            if result.timed_out:
                raise StudioError("làm quá lâu nên đã dừng", refund=True)
            if result.code != 0 or not out.is_file():
                logger.warning("[zalo] xưởng %s: bộ soạn văn bản lỗi %s — %s", self.job.id, result.code, result.err[-2000:])
                raise validate.SourceError("bộ soạn văn bản không đọc được nội dung — kiểm lại các trường theo ví dụ")
            return collect(self.job_dir, self.project, self.recipe.outputs)

        return await self.with_repair(attempt, await self.write(types=self._types()))

    async def markdown_docx(self) -> List[Path]:
        async def attempt(text: str) -> List[Path]:
            text = validate.clean_text(text)
            self.project.mkdir(parents=True, exist_ok=True)
            out = self.project / f"{self.recipe.source.rsplit('.', 1)[0]}.docx"
            await asyncio.to_thread(builtin.build_markdown_docx, text, self.recipe.label, out)
            return collect(self.job_dir, self.project, self.recipe.outputs)

        return await self.with_repair(attempt, await self.write())

    async def game_html(self) -> List[Path]:
        kind = self.job.options.get("loai", "quiz")

        async def attempt(text: str) -> List[Path]:
            data = validate.check_game(text, kind)
            self.project.mkdir(parents=True, exist_ok=True)
            builtin.build_game_html(data, self.project / f"tro-choi-{kind}.html")
            return collect(self.job_dir, self.project, self.recipe.outputs)

        return await self.with_repair(attempt, await self.write())

    async def doan_docx(self) -> List[Path]:
        validator = self.where.skills / self.recipe.script / "scripts" / "validate_van_ban_doan.py"

        async def attempt(text: str) -> List[Path]:
            data = validate.check_doan_json(text)
            self.project.mkdir(parents=True, exist_ok=True)
            out = self.project / "van-ban-doan.docx"
            await asyncio.to_thread(doan_docx.build, data, out)
            report = await asyncio.to_thread(_doan_report, validator, out)
            errors = [i for i in report.get("items", []) if i.get("level") == "error"]
            hard = [i for i in errors if i.get("code") not in DOAN_DRAFT_CODES]
            if hard:
                logger.warning("[zalo] xưởng %s: bộ kiểm văn bản Đoàn báo %s", self.job.id, hard)
                raise StudioError("văn bản Đoàn chưa qua bộ kiểm thể thức", refund=True)
            self.notes = [DOAN_DRAFT_CODES[i["code"]] for i in errors] + ["Chưa ký, chưa đóng dấu"]
            return collect(self.job_dir, self.project, self.recipe.outputs)

        return await self.with_repair(attempt, await self.write())

    async def _deck(self) -> Tuple[Dict[str, Any], Dict[int, str], Path, Dict[str, Dict[str, str]]]:
        """Dàn ý → ảnh → trang SVG → bộ kiểm (sửa 1 vòng). Trả (dàn ý, trang, thư mục scripts, ảnh)."""
        scripts = self.where.studio / "skills" / "ppt-master" / "scripts"
        py = str(self.where.python)
        guard = await self.run([py, str(scripts / "attribution_guard.py")], timeout=60, network=False)
        if guard.code != 0:
            raise StudioError("bộ làm slide trên máy chủ không còn nguyên vẹn", refund=True)
        try:
            outline = await author.write_outline(self.llm, guides=self.guides, brief=self.job.brief,
                                                 options=self.job.options, usage=self.usage, max_pages=MAX_SLIDE_PAGES,
                                                 max_ai=SLIDE_MAX_AI_IMAGES, max_web=SLIDE_MAX_WEB_IMAGES)
        except validate.SourceError as exc:
            raise StudioError(f"chưa lập được dàn ý ({exc})", refund=False) from None
        init = await self.run([py, str(scripts / "project_manager.py"), "init", "deck", "--quick-generate",
                               "--dir", str(self.job_dir)], timeout=120, network=False)
        decks = sorted(self.job_dir.glob("deck_*"))
        if init.code != 0 or not decks:
            raise StudioError("chưa tạo được dự án slide", refund=True)
        self.project = decks[0]
        pics = await self.deck_images(outline.get("images") or [], self.project / "images")
        refs = {k: v["path"] for k, v in pics.items()}
        available = {k: v["note"] for k, v in pics.items()}
        pages = {}
        for index in range(1, len(outline["pages"]) + 1):
            pages[index] = await self._page(outline, index, None, refs, available)
        for round_ in (1, 2):
            svg_dir = self.project / "svg_output"
            for old in svg_dir.glob("*.svg"):
                old.unlink()
            for index, text in pages.items():
                role = outline["pages"][index - 1]["role"]
                (svg_dir / f"{index:02d}_{role}.svg").write_text(text, encoding="utf-8")
            await self.run([py, str(scripts / "compact_svg_styles.py"), str(svg_dir), "--inplace"], timeout=120,
                           network=False)
            check = await self.run([py, str(scripts / "svg_quality_checker.py"), str(self.project), "--quick-generate",
                                    "--canonical-authoring", "--stage", "final", "--json"], timeout=300, network=False)
            errors = self._checker_errors()
            if check.code == 0 and not errors:
                break
            if round_ == 2 or not errors:
                raise StudioError("slide chưa qua được bộ kiểm của 2Anh Studio", refund=not errors)
            for index, message in errors.items():
                pages[index] = await self._page(outline, index, (pages[index], message), refs, available)
        return outline, pages, scripts, pics

    async def slides(self) -> List[Path]:
        _outline, _pages, scripts, _pics = await self._deck()
        export = await self.run([str(self.where.python), str(scripts / "svg_to_pptx.py"), str(self.project),
                                 "--quick-generate", "--no-notes"], timeout=600, network=False)
        if export.timed_out or export.code != 0:
            logger.warning("[zalo] xưởng %s: xuất pptx lỗi %s — %s", self.job.id, export.code, export.err[-2000:])
            raise StudioError("chưa xuất được tệp PowerPoint", refund=True)
        return collect(self.job_dir, self.project / "exports", self.recipe.outputs)[:1]

    async def lecture_video(self) -> List[Path]:
        """Video bài giảng (§11 của 2Anh Studio): slide → lời giảng → giọng đọc → PPTX gắn tiếng → MP4 (FFmpeg)."""
        outline, _pages, scripts, _pics = await self._deck()
        py = str(self.where.python)
        try:
            notes = await author.write_notes(self.llm, guides=self.guides, brief=self.job.brief,
                                             options=self.job.options, outline=outline, usage=self.usage)
        except validate.SourceError as exc:
            raise StudioError(f"chưa viết được lời giảng ({exc})", refund=False) from None
        notes_dir = self.project / "notes"
        notes_dir.mkdir(exist_ok=True)
        for svg in sorted((self.project / "svg_output").glob("*.svg")):
            index = int(svg.name[:2])
            (notes_dir / f"{svg.stem}.md").write_text(notes[index] + "\n", encoding="utf-8")
        steps = (
            ([py, str(scripts / "notes_to_audio.py"), str(self.project), "--voice", LECTURE_VOICE], 900, True),
            ([py, str(scripts / "svg_to_pptx.py"), str(self.project), "--quick-generate", "--with-notes",
              "--recorded-narration", "audio"], 600, False),
            ([py, str(self.where.studio / "tools" / "vi" / "video.py"), str(self.project), "--cach", "ffmpeg",
              "--phu-de", "hinh", "--do-phan-giai", "720"], 1800, False),
        )
        browsers = sandbox.browsers_dir()
        # video.py chụp slide bằng Chromium: chỉ cho nó đúng chỗ Chromium (môi trường đã lọc không có LOCALAPPDATA).
        # video.py tự bật máy chủ xem trước (svg_editor/server.py --daemon) trên 127.0.0.1 rồi visual_review.py
        # (Chromium) đọc nó, tắt khi xong — cả ba trong CÙNG một đơn vị systemd. Bước này chạy network=False →
        # PrivateNetwork=yes: đơn vị có loopback riêng, nên 127.0.0.1 của đơn vị chạy được mà không chạm 127.0.0.1
        # của máy (9router, dashboard, sidecar). Chỉ bước giọng đọc (edge-tts) có mạng, và bước đó không cần
        # loopback (IPAddressDeny chặn localhost). Đừng đổi bước video.py sang network=True.
        extra_env = ({"PLAYWRIGHT_BROWSERS_PATH": str(browsers), "LOCALAPPDATA": str(browsers.parent)} if browsers else None)
        for argv, timeout, network in steps:
            result = await self.run(argv, timeout=timeout, network=network, extra=[browsers], extra_env=extra_env)
            if result.timed_out or result.code != 0:
                logger.warning("[zalo] xưởng %s: bước %s lỗi %s — %s", self.job.id, Path(argv[1]).name, result.code,
                               (result.out + result.err)[-2000:])
                raise StudioError("chưa dựng được video bài giảng", refund=True)
        return collect(self.job_dir, self.project, self.recipe.outputs)[:1]

    async def _page(self, outline: Dict[str, Any], index: int, repair: Optional[Tuple[str, str]],
                    refs: Optional[Dict[str, str]] = None, available: Optional[Dict[str, str]] = None) -> str:
        text = await author.write_page(self.llm, guides=self.guides, brief=self.job.brief, options=self.job.options,
                                       outline=outline, index=index, usage=self.usage, repair=repair,
                                       available=available)
        try:
            return validate.check_svg(text, refs)
        except validate.SourceError as exc:
            if repair is not None:
                raise StudioError(f"trang {index} chưa dựng được ({exc})", refund=False) from None
            return await self._page(outline, index, (text, str(exc)), refs, available)

    def _checker_errors(self) -> Dict[int, str]:
        try:
            report = json.loads((self.project / "validation" / "svg_quality_report.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        out = {}
        for item in report.get("files") or []:
            name = str(item.get("file") or "")
            if item.get("errors") and name[:2].isdigit():
                out[int(name[:2])] = "; ".join(str(e) for e in item["errors"])[:1500]
        return out


def _doan_report(validator: Path, docx: Path) -> Dict[str, Any]:
    """Chạy ``validate_document`` của skill soan-van-ban-doan (mã của chủ bot) trên tệp do bộ sinh cố định tạo."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("zalo_studio_doan_validator", validator)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.validate_document(docx, profile="doan")


async def produce(job: Job, llm: Any, job_dir: Path, where: Optional[recipes.Places] = None) -> Outcome:
    where = where or recipes.places()
    reason = recipes.missing(job.recipe, where)
    if reason:
        raise StudioError(reason, refund=True)
    builder = Builder(job, llm, where, job_dir)
    try:
        files = await getattr(builder, job.recipe.builder)()
    except StudioError as exc:
        exc.usage = builder.usage  # type: ignore[attr-defined]
        exc.images = builder.images_used  # type: ignore[attr-defined]
        raise
    return Outcome(files=files, notes=builder.notes, usage=builder.usage, images=builder.images_used)


# ---------------------------------------------------------------------- hàng đợi
Deliver = Callable[[Job, List[Path], str], Awaitable[bool]]
Notify = Callable[[Job, str], Awaitable[None]]
Allowed = Callable[[Job], bool]


class Studio:
    def __init__(self, *, ledger: Ledger, llm: Callable[[], Any], deliver: Deliver, notify: Notify,
                 still_allowed: Allowed, quota_left: Callable[[Job], Optional[int]],
                 concurrency: Optional[int] = None, max_queue: int = MAX_QUEUE):
        self.ledger, self.llm, self.deliver, self.notify = ledger, llm, deliver, notify
        self.still_allowed, self.quota_left = still_allowed, quota_left
        wanted = concurrency or int(os.getenv("ZALO_STUDIO_CONCURRENCY", "1") or 1)
        self.concurrency = max(1, min(2, wanted))
        self.max_queue = max_queue
        self._pending: Dict[str, Job] = {}
        self._lock = threading.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._sem: Optional[asyncio.Semaphore] = None
        try:
            sweep_work_root()
            lost = ledger.sweep_lost()
            if lost:
                logger.info("[zalo] xưởng: %d việc dở từ lần chạy trước — đã trả lượt", lost)
        except Exception as exc:
            logger.warning("[zalo] xưởng: không dọn được việc cũ: %s", exc)
        # Dashboard đọc studio-policy.json để khoá nút video + hiện ghi chú (Windows / Linux không hộp cát).
        gp.publish_video_policy()

    # -- luồng nền ----------------------------------------------------------
    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        with self._lock:
            if self._loop is None:
                loop = asyncio.new_event_loop()
                ready = threading.Event()

                def main() -> None:
                    asyncio.set_event_loop(loop)
                    self._sem = asyncio.Semaphore(self.concurrency)
                    ready.set()
                    loop.run_forever()

                threading.Thread(target=main, name="zalo-studio", daemon=True).start()
                ready.wait(5)
                self._loop = loop
            return self._loop

    def pending_for(self, uid: str) -> bool:
        with self._lock:
            return any(job.uid == uid for job in self._pending.values())

    def submit(self, job: Job) -> int:
        """Xếp việc; trả vị trí (1 = làm ngay). Đầy hàng hoặc người này đang có việc → Busy."""
        with self._lock:
            if any(other.uid == job.uid for other in self._pending.values()):
                raise Busy("bạn đang có một việc chưa xong — chờ bot gửi xong rồi nhờ tiếp")
            if len(self._pending) >= self.max_queue:
                raise Busy("xưởng đang bận nhiều việc — thử lại sau ít phút")
            self._pending[job.id] = job
            position = len(self._pending)
        asyncio.run_coroutine_threadsafe(self._run(job), self._ensure_loop())
        return position

    async def _run(self, job: Job) -> None:
        if self._sem is None:
            self._sem = asyncio.Semaphore(self.concurrency)
        try:
            async with self._sem:
                await self.run_job(job)
        finally:
            with self._lock:
                self._pending.pop(job.id, None)

    async def run_job(self, job: Job) -> None:
        """Làm một việc từ đầu tới cuối; không bao giờ ném ra ngoài."""
        job_dir = sandbox.work_root() / job.id
        usage = author.Usage()
        keep = False
        self.ledger.finish(job.id, "running")
        try:
            job_dir.mkdir(parents=True, exist_ok=False)
            llm = self.llm()
            if llm is None:
                raise StudioError("Hermes trên máy chủ chưa hỗ trợ xưởng (thiếu ctx.llm)", refund=True)
            outcome = await produce(job, llm, job_dir)
            usage = outcome.usage
            if not self.still_allowed(job):
                raise StudioError("chủ bot vừa tắt tính năng này", refund=True)
            left = self.quota_left(job)
            caption = f"Xong {job.recipe.label} cho {job.name}."
            if outcome.notes:
                caption += " Cần soát: " + "; ".join(outcome.notes)
            if left is not None:
                caption += f" Hôm nay còn {left} lượt."
            sent = await self.deliver(job, outcome.files, caption)
            if sent is None:
                keep = True  # Zalo chưa xác nhận: tệp có thể vẫn đang gửi — xoá sau
            elif not sent:
                raise StudioError("chưa gửi được tệp vào Zalo", refund=True)
            self.ledger.finish(job.id, "ok", input_tokens=usage.input_tokens, output_tokens=usage.output_tokens,
                               images=outcome.images)
        except StudioError as exc:
            usage = getattr(exc, "usage", usage)
            logger.info("[zalo] xưởng %s (%s, %s): %s", job.id, job.kind, job.uid, exc)
            self.ledger.finish(job.id, "refunded" if exc.refund else "failed", input_tokens=usage.input_tokens,
                               output_tokens=usage.output_tokens, error=str(exc), images=getattr(exc, "images", 0))
            tail = " Lượt này không bị trừ." if exc.refund else ""
            await self._safe_notify(job, f"Xin lỗi {job.name}, chưa làm được {job.recipe.label}: {exc}.{tail}")
        except Exception as exc:  # lỗi lạ: trả lượt, báo gọn, ghi đủ vào log
            logger.exception("[zalo] xưởng %s hỏng bất ngờ: %s", job.id, exc)
            self.ledger.finish(job.id, "refunded", input_tokens=usage.input_tokens,
                               output_tokens=usage.output_tokens, error="lỗi bên trong")
            await self._safe_notify(job, f"Xin lỗi {job.name}, xưởng gặp lỗi khi làm {job.recipe.label}. Lượt này không bị trừ.")
        finally:
            if keep:
                timer = threading.Timer(900, shutil.rmtree, args=(job_dir,), kwargs={"ignore_errors": True})
                timer.daemon = True
                timer.start()
            else:
                shutil.rmtree(job_dir, ignore_errors=True)

    async def _safe_notify(self, job: Job, text: str) -> None:
        try:
            await self.notify(job, text)
        except Exception as exc:
            logger.warning("[zalo] xưởng %s: không báo được người nhờ: %s", job.id, exc)


def sweep_work_root(now: Optional[float] = None) -> None:
    """Dọn thư mục việc sót lại quá 24 giờ (gateway tắt ngang khi đang dựng)."""
    root = sandbox.work_root()
    if not root.is_dir():
        return
    now = now or time.time()
    for child in root.iterdir():
        try:
            if child.is_dir() and now - child.stat().st_mtime > STALE_DIR_SECONDS:
                shutil.rmtree(child, ignore_errors=True)
        except OSError:
            continue
