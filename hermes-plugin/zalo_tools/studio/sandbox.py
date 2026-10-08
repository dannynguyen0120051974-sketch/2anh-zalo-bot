"""Chạy một bộ dựng cố định trong tiến trình con, càng ít quyền càng tốt.

Linux (máy chủ VPS, gateway chạy bằng root): bọc lệnh bằng ``systemd-run`` — đơn vị tạm chạy
bằng ``nobody``, ``/`` chỉ đọc, ``/root`` và ``/home`` thay bằng thư mục rỗng (không thấy
``.env``, ``state.db``, khoá SSH), chỉ ghi được thư mục việc, không mạng (trừ video: có mạng
nhưng chặn 127.0.0.1 và mạng nội bộ để không gọi được 9router, dashboard, kết nối Zalo),
giới hạn RAM/CPU/số tiến trình/thời gian. Thứ bộ dựng cần đọc mà nằm dưới ``/root`` (Python
của uv, Chromium của Playwright, skill soạn văn bản) được gắn lại chỉ đọc từng thư mục một.

Windows và Linux không có systemd: không có hộp cát của hệ điều hành. Lớp bảo vệ còn lại:
dòng lệnh cố định, môi trường đã lọc khoá, thư mục việc riêng, hạn giờ + giết cả cây tiến
trình, và (quan trọng nhất) nội dung đã qua ``validate.py``. Xem spec §17.6.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

# Biến môi trường được chuyển cho bộ dựng; mọi biến khác (khoá API, token, mật khẩu) bị bỏ.
BASE_ENV_KEYS = ("PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TZ",
                 "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE")
# Video cần tìm Chromium (Playwright) và giọng VieNeu.
NETWORK_ENV_KEYS = ("LOCALAPPDATA", "PLAYWRIGHT_BROWSERS_PATH", "VIENEU_PYTHON")
MEMORY_MAX = "1536M"
CPU_QUOTA = "200%"
TASKS_MAX = "256"
OUTPUT_TAIL = 20_000


@dataclass(frozen=True)
class Result:
    code: Optional[int]
    out: str
    err: str
    timed_out: bool


def mode() -> str:
    """``systemd`` khi dùng được hộp cát systemd, ngược lại ``plain``. ``ZALO_STUDIO_SANDBOX=none`` để tắt hẳn."""
    wanted = os.getenv("ZALO_STUDIO_SANDBOX", "auto").strip().lower()
    if wanted in ("none", "off", "plain"):
        return "plain"
    usable = (sys.platform.startswith("linux") and hasattr(os, "geteuid") and os.geteuid() == 0
              and shutil.which("systemd-run") is not None)
    if wanted == "systemd" and not usable:
        logger.warning("[zalo] ZALO_STUDIO_SANDBOX=systemd nhưng máy không dùng được systemd-run — chạy không hộp cát")
    return "systemd" if usable else "plain"


def work_root() -> Path:
    """Thư mục chứa các thư mục việc. Linux: /var/lib/zalo-studio (PrivateTmp che mất /tmp và /var/tmp)."""
    explicit = os.getenv("ZALO_STUDIO_WORK", "").strip()
    if explicit:
        return Path(explicit)
    if sys.platform.startswith("linux"):
        return Path("/var/lib/zalo-studio")
    import tempfile
    return Path(tempfile.gettempdir()) / "zalo-studio"


def clean_env(job_dir: Path, *, network: bool, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    keys = BASE_ENV_KEYS + (NETWORK_ENV_KEYS if network else ())
    env = {k: os.environ[k] for k in keys if os.environ.get(k)}
    tmp = str(job_dir / "tmp")
    env.update({"TEMP": tmp, "TMP": tmp, "TMPDIR": tmp, "HOME": str(job_dir), "USERPROFILE": str(job_dir),
                "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1",
                "NO_COLOR": "1"})
    env.update(extra or {})
    return env


def _under_hidden_home(path: Path) -> bool:
    try:
        resolved = path.resolve()
    except OSError:
        return False
    return any(resolved == base or base in resolved.parents for base in (Path("/root"), Path("/home")))


def browsers_dir() -> Optional[Path]:
    """Chromium của Playwright (video): PLAYWRIGHT_BROWSERS_PATH, hoặc chỗ mặc định của từng hệ điều hành."""
    explicit = os.getenv("PLAYWRIGHT_BROWSERS_PATH", "").strip()
    if explicit:
        path = Path(explicit)
    elif os.name == "nt":
        path = Path(os.getenv("LOCALAPPDATA", "")) / "ms-playwright"
    else:
        path = Path.home() / ".cache" / "ms-playwright"
    return path if path.is_dir() else None


def read_only_paths(python: Optional[str], *others: Optional[Path]) -> List[Path]:
    """Thư mục bộ dựng cần đọc: kho Python mà venv trỏ tới (uv đặt dưới /root), cộng ``others``
    và ``ZALO_STUDIO_BIND`` (danh sách cách nhau bằng dấu phẩy, cho cách cài lạ)."""
    out: List[Path] = []
    if python:
        real = Path(os.path.realpath(python))
        out.append(real.parents[2] if len(real.parents) > 2 else real.parent)
    out += [p for p in others if p]
    out += [Path(p.strip()) for p in os.getenv("ZALO_STUDIO_BIND", "").split(",") if p.strip()]
    return out


def systemd_command(argv: Sequence[str], job_dir: Path, env: Dict[str, str], *, network: bool,
                    timeout: int, read_only: Sequence[Path] = ()) -> List[str]:
    """Dòng lệnh ``systemd-run`` bọc ``argv``. ``read_only``: thư mục cần đọc nằm dưới /root hoặc /home."""
    work = job_dir.as_posix()
    props = [
        "User=nobody", "Group=nogroup", "NoNewPrivileges=yes", "PrivateTmp=yes", "PrivateDevices=yes",
        "ProtectSystem=strict", "ProtectHome=tmpfs", f"ReadWritePaths={work}",
        "ProtectKernelTunables=yes", "ProtectKernelModules=yes", "ProtectControlGroups=yes",
        "RestrictSUIDSGID=yes", "LockPersonality=yes", "CapabilityBoundingSet=",
        f"MemoryMax={MEMORY_MAX}", f"CPUQuota={CPU_QUOTA}", f"TasksMax={TASKS_MAX}",
        f"RuntimeMaxSec={int(timeout)}", f"WorkingDirectory={work}",
    ]
    if network:
        props.append("IPAddressDeny=localhost link-local multicast 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10")
    else:
        props.append("PrivateNetwork=yes")
    binds = sorted({p.resolve().as_posix() for p in read_only if p and Path(p).exists() and _under_hidden_home(Path(p))})
    for bind in binds:
        props.append(f"BindReadOnlyPaths={bind}")
    cmd = ["systemd-run", "--quiet", "--wait", "--pipe", "--collect", "--service-type=exec"]
    for prop in props:
        cmd += ["-p", prop]
    for key, value in sorted(env.items()):
        cmd += ["-E", f"{key}={value}"]
    return [*cmd, "--", *argv]


def prepare_job_dir(job_dir: Path) -> None:
    """Tạo thư mục việc (và tmp/); trên Linux có hộp cát thì trao cho ``nobody``."""
    (job_dir / "tmp").mkdir(parents=True, exist_ok=True)
    if mode() != "systemd":
        return
    import pwd
    import grp
    uid = pwd.getpwnam("nobody").pw_uid
    gid = grp.getgrnam("nogroup").gr_gid
    os.chmod(job_dir.parent, 0o711)
    for root, dirs, files in os.walk(job_dir):
        os.chown(root, uid, gid)
        for name in files:
            os.chown(os.path.join(root, name), uid, gid)


async def kill_tree(proc) -> None:
    """Giết tiến trình cùng cây con (``kill()`` trên Windows chỉ giết cha)."""
    if proc.returncode is not None:
        return
    try:
        if os.name == "nt":
            killer = await asyncio.create_subprocess_exec(
                "taskkill", "/T", "/F", "/PID", str(proc.pid),
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await killer.wait()
        else:
            proc.kill()
        await asyncio.wait_for(proc.wait(), timeout=10)
    except Exception as exc:  # pragma: no cover — dọn dẹp, không được ném đè lỗi gốc
        logger.warning("[zalo] không dừng hẳn được bộ dựng %s: %s", proc.pid, exc)


async def run(argv: Sequence[str], job_dir: Path, *, timeout: int, network: bool = False,
              read_only: Sequence[Path] = (), extra_env: Optional[Dict[str, str]] = None) -> Result:
    """Chạy ``argv`` (danh sách cố định, không qua shell) trong ``job_dir``; không bao giờ ném vì lỗi của bộ dựng."""
    env = clean_env(job_dir, network=network, extra=extra_env)
    if mode() == "systemd":
        cmd = systemd_command(argv, job_dir, env, network=network, timeout=timeout, read_only=read_only)
        spawn_env = {k: os.environ[k] for k in ("PATH", "LANG") if os.environ.get(k)}
    else:
        cmd, spawn_env = list(argv), env
    kwargs = {}
    if os.name == "nt":
        kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW: không bật cửa sổ đen trên máy chủ nhân
    proc = await asyncio.create_subprocess_exec(
        *cmd, cwd=str(job_dir), env=spawn_env, stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, **kwargs)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout + 30)
    except asyncio.TimeoutError:
        await kill_tree(proc)
        return Result(None, "", "", True)
    except BaseException:
        await kill_tree(proc)
        raise
    return Result(proc.returncode, out.decode("utf-8", "replace")[-OUTPUT_TAIL:],
                  err.decode("utf-8", "replace")[-OUTPUT_TAIL:], False)
