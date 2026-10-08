"""Sổ lượt xưởng: đếm lượt theo người theo ngày (giờ Việt Nam), token và số ảnh (AI + web) đã dùng, 200 việc gần nhất.

Một tệp ``<HERMES_HOME>/zalo/studio-usage.json`` (quyền 600), plugin ghi, dashboard chỉ đọc
(mục "Xưởng tạo sản phẩm" ở Sức khoẻ máy chủ). Giữ 30 ngày. Tệp hỏng → đổi tên thành
``.hong-<giờ>`` rồi bắt đầu sổ mới (lượt hôm nay đếm lại từ 0 — nút bật/tắt vẫn quyết ai được
dùng). Không GHI được sổ → từ chối việc (không trừ được lượt thì không nhận việc).

Lượt trừ NGAY khi nhận việc (``take``), trong cùng một khoá với việc đếm — hai tin gửi cùng lúc
không lách được hạn mức. Việc hỏng vì máy TRƯỚC khi tốn gì (thiếu bộ dựng, AI không gọi được) được trả lượt; việc hỏng vì nội dung, hoặc hỏng SAU khi đã tốn token/ảnh, vẫn tính lượt (``jobs.run_job``). Gateway khởi
động lại giữa việc: chỉ trả lượt nếu sổ (ghi dần) cho thấy chưa tốn gì (``sweep_lost``).
Mỗi người mỗi ngày được trả lượt tối đa bằng hạn mức của mình (``quota`` ghi lúc nhận việc) — quá trần thì việc hỏng
tính như ``failed``: không ai lấy được việc miễn phí vô hạn bằng cách cố tình làm hỏng.

Windows: người đọc khác (dashboard, ``used_today`` của lượt khác) đang mở tệp thì ``os.replace`` có thể lỗi
WinError 32/5 — thử lại vài lần trước khi coi là không ghi được. Mọi ``Ledger`` cùng một tệp dùng chung một khoá.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

VN = timezone(timedelta(hours=7))
KEEP_DAYS = 30
KEEP_JOBS = 200
OPEN_STATES = ("queued", "running")
# Ngưỡng "chưa tốn gì": không ảnh nào và token ≤ ngưỡng này (một lời gọi AI thật luôn vượt xa). Dùng cho trả lượt.
SPEND_TOKENS = 1_000
REPLACE_RETRIES = 8
REPLACE_SLEEP = 0.05
_LOCKS: Dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def _lock_for(path: Path) -> threading.Lock:
    """Một khoá cho mỗi tệp sổ — kể cả khi nhiều đối tượng ``Ledger`` cùng trỏ vào nó (tools.py tạo mới mỗi lần đọc)."""
    key = os.path.normcase(os.path.abspath(path))
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(key, threading.Lock())


def _retry(action, *args):
    """``PermissionError`` (Windows: tệp đang bị tiến trình khác mở) → thử lại vài lần rồi mới ném."""
    for attempt in range(REPLACE_RETRIES):
        try:
            return action(*args)
        except PermissionError:
            if attempt == REPLACE_RETRIES - 1:
                raise
            time.sleep(REPLACE_SLEEP * (attempt + 1))


def vn_day(ts: Optional[float] = None) -> str:
    return datetime.fromtimestamp(time.time() if ts is None else ts, VN).strftime("%Y-%m-%d")


def usage_path() -> Path:
    explicit = os.getenv("ZALO_STUDIO_USAGE_FILE", "").strip()
    if explicit:
        return Path(explicit)
    try:
        from hermes_constants import get_hermes_home
        home = Path(get_hermes_home())
    except Exception:
        home = Path(os.getenv("HERMES_HOME") or Path.home() / ".hermes")
    return home / "zalo" / "studio-usage.json"


class Ledger:
    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path) if path else usage_path()
        self._lock = _lock_for(self.path)

    # ------------------------------------------------------------ tệp
    def _read(self) -> Dict[str, Any]:
        """Không đọc được vì lỗi hệ thống (khoá tệp, quyền) → ném ``OSError`` (bên gọi từ chối, KHÔNG cất sổ đi);
        chỉ nội dung hỏng mới cất sang ``.hong``."""
        try:
            raw = _retry(self.path.read_text, "utf-8-sig")
        except FileNotFoundError:
            return {"version": 1, "days": {}, "jobs": []}
        try:
            data = json.loads(raw)
            if isinstance(data, dict) and data.get("version") == 1:
                data.setdefault("days", {})
                data.setdefault("jobs", [])
                return data
        except Exception as exc:
            logger.warning("[zalo] sổ lượt xưởng %s hỏng — cất sang .hong, bắt đầu sổ mới: %s", self.path, exc)
            try:
                os.replace(self.path, self.path.with_name(f"{self.path.name}.hong-{int(time.time())}"))
            except OSError:
                pass
        return {"version": 1, "days": {}, "jobs": []}

    def _write(self, data: Dict[str, Any]) -> None:
        cutoff = vn_day(time.time() - KEEP_DAYS * 86400)
        data["days"] = {day: v for day, v in data["days"].items() if day >= cutoff}
        data["jobs"] = data["jobs"][-KEEP_JOBS:]
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(f"{self.path.name}.{os.getpid()}-{secrets.token_hex(4)}.tmp")
        try:
            tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            try:
                os.chmod(tmp, 0o600)
            except OSError:
                pass
            _retry(os.replace, tmp, self.path)
        except BaseException:
            try:
                tmp.unlink()
            except OSError:
                pass
            raise

    @staticmethod
    def _person(data: Dict[str, Any], day: str, uid: str, name: str) -> Dict[str, Any]:
        person = data["days"].setdefault(day, {}).setdefault(uid, {
            "name": "", "jobs": 0, "ok": 0, "failed": 0, "refunded": 0,
            "input_tokens": 0, "output_tokens": 0, "images": 0, "kinds": {}})
        if name:
            person["name"] = name[:80]
        return person

    # ------------------------------------------------------------ hạn mức
    def used_today(self, uid: str) -> int:
        """Chỉ để HIỂN THỊ số lượt còn (chặn thật nằm ở ``take``): đọc lỗi → ghi log, coi như 0."""
        try:
            with self._lock:
                person = self._read()["days"].get(vn_day(), {}).get(str(uid))
        except OSError as exc:
            logger.warning("[zalo] không đọc được sổ lượt xưởng %s: %s", self.path, exc)
            return 0
        return 0 if not person else person["jobs"] - person["refunded"]

    def take(self, *, job_id: str, uid: str, name: str, kind: str, thread_id: str, is_group: bool,
             quota: Optional[int]) -> Optional[int]:
        """Trừ một lượt và ghi việc ``queued``. Trả số lượt còn lại (None = không giới hạn); hết lượt → -1."""
        with self._lock:
            try:
                data = self._read()
                day = vn_day()
                person = self._person(data, day, str(uid), name)
                used = person["jobs"] - person["refunded"]
                if quota is not None and used >= quota:
                    return -1
                person["jobs"] += 1
                person["kinds"][kind] = person["kinds"].get(kind, 0) + 1
                data["jobs"].append({"id": job_id, "day": day, "uid": str(uid), "name": name[:80], "kind": kind,
                                     "thread": str(thread_id), "group": bool(is_group), "status": "queued",
                                     "at": int(time.time()), "input_tokens": 0, "output_tokens": 0, "images": 0,
                                     "quota": quota})
                self._write(data)
            except OSError as exc:
                logger.error("[zalo] không ghi được sổ lượt xưởng %s: %s — từ chối việc", self.path, exc)
                return -1
        return None if quota is None else quota - used - 1

    def finish(self, job_id: str, status: str, *, input_tokens: int = 0, output_tokens: int = 0,
               error: str = "", images: int = 0, capped: bool = True) -> Optional[str]:
        """``status``: ok | failed | refunded | running. Trả trạng thái đã ghi (None nếu không ghi được).

        ``refunded`` mà hôm nay người này đã được trả đủ ``quota`` lượt (quota ghi lúc ``take``) → ghi ``failed``
        (``refund_denied``). ``capped=False`` chỉ cho việc CHƯA chạy (hàng đầy ngay lúc nhận).
        ``input_tokens``/``output_tokens``/``images`` là TỔNG của việc (không phải phần tăng thêm): ghi lấy giá trị lớn
        hơn giữa số đã ghi dần (``progress``) và số truyền vào — gọi nhiều lần không đếm đôi."""
        with self._lock:
            try:
                data = self._read()
                job = next((j for j in reversed(data["jobs"]) if j.get("id") == job_id), None)
                if job is None:
                    return None
                previous = job.get("status")
                if status == "refunded" and capped and previous in OPEN_STATES:
                    cap = job.get("quota")
                    person = data["days"].get(job["day"], {}).get(job["uid"]) or {}
                    if isinstance(cap, int) and person.get("refunded", 0) >= cap:
                        status = "failed"
                        job["refund_denied"] = True
                job["status"] = status
                job["input_tokens"] = max(job.get("input_tokens", 0), int(input_tokens))
                job["output_tokens"] = max(job.get("output_tokens", 0), int(output_tokens))
                job["images"] = max(job.get("images", 0), int(images))
                if error:
                    job["error"] = error[:300]
                if status != "running" and previous in OPEN_STATES:
                    job["done"] = int(time.time())
                    person = self._person(data, job["day"], job["uid"], "")
                    person["input_tokens"] += job["input_tokens"]
                    person["output_tokens"] += job["output_tokens"]
                    person["images"] = person.get("images", 0) + job["images"]
                    if status == "ok":
                        person["ok"] += 1
                    elif status == "refunded":
                        person["refunded"] += 1
                    else:
                        person["failed"] += 1
                self._write(data)
                return status
            except OSError as exc:
                logger.error("[zalo] không ghi được sổ lượt xưởng %s: %s", self.path, exc)
                return None

    def progress(self, job_id: str, *, input_tokens: int = 0, output_tokens: int = 0, images: int = 0) -> None:
        """Ghi dần chi phí (tổng đến lúc này) của việc đang chạy, để ``sweep_lost`` biết việc đã tốn gì nếu gateway chết
        giữa chừng. Chỉ chạm việc còn mở; không đụng số liệu theo người (``finish`` làm khi kết thúc)."""
        with self._lock:
            try:
                data = self._read()
                job = next((j for j in reversed(data["jobs"]) if j.get("id") == job_id), None)
                if job is None or job.get("status") not in OPEN_STATES:
                    return
                job["input_tokens"] = max(job.get("input_tokens", 0), int(input_tokens))
                job["output_tokens"] = max(job.get("output_tokens", 0), int(output_tokens))
                job["images"] = max(job.get("images", 0), int(images))
                self._write(data)
            except OSError as exc:
                logger.warning("[zalo] không ghi được chi phí đang chạy vào sổ lượt xưởng %s: %s", self.path, exc)

    def sweep_lost(self) -> int:
        """Gateway khởi động lại giữa chừng: việc còn ``queued``/``running`` coi như mất.

        Việc chưa chạy (``queued``) hoặc đang chạy mà sổ ghi chưa tốn gì (không ảnh, token ≤ ``SPEND_TOKENS``) → trả
        lượt (vẫn chịu trần trả lượt mỗi ngày). Việc ``running`` đã tốn → ``failed``, tính lượt: nếu không, khởi động
        lại gateway đúng lúc là cách lấy việc tốn tiền miễn phí."""
        with self._lock:
            try:
                data = self._read()
            except OSError as exc:
                logger.error("[zalo] không đọc được sổ lượt xưởng %s: %s", self.path, exc)
                return 0
            lost = [dict(j) for j in data["jobs"] if j.get("status") in OPEN_STATES]
        for job in lost:
            spent = (job.get("images", 0) > 0
                     or job.get("input_tokens", 0) + job.get("output_tokens", 0) > SPEND_TOKENS)
            if job.get("status") == "running" and spent:
                self.finish(job["id"], "failed", error="gateway khởi động lại khi đang làm")
            else:
                self.finish(job["id"], "refunded", error="gateway khởi động lại khi đang làm")
        return len(lost)
