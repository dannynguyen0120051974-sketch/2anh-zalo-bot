"""Sổ lượt xưởng: đếm lượt theo người theo ngày (giờ Việt Nam), token và số ảnh (AI + web) đã dùng, 200 việc gần nhất.

Một tệp ``<HERMES_HOME>/zalo/studio-usage.json`` (quyền 600), plugin ghi, dashboard chỉ đọc
(mục "Xưởng tạo sản phẩm" ở Sức khoẻ máy chủ). Giữ 30 ngày. Tệp hỏng → đổi tên thành
``.hong-<giờ>`` rồi bắt đầu sổ mới (lượt hôm nay đếm lại từ 0 — nút bật/tắt vẫn quyết ai được
dùng). Không GHI được sổ → từ chối việc (không trừ được lượt thì không nhận việc).

Lượt trừ NGAY khi nhận việc (``take``), trong cùng một khoá với việc đếm — hai tin gửi cùng lúc
không lách được hạn mức. Việc hỏng vì máy (thiếu bộ dựng, quá giờ, gateway khởi động lại, gửi
không được) được trả lượt; việc hỏng vì nội dung không dựng được vẫn tính lượt.
"""

from __future__ import annotations

import json
import logging
import os
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
        self._lock = threading.Lock()

    # ------------------------------------------------------------ tệp
    def _read(self) -> Dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8-sig"))
            if isinstance(data, dict) and data.get("version") == 1:
                data.setdefault("days", {})
                data.setdefault("jobs", [])
                return data
        except FileNotFoundError:
            pass
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
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, self.path)

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
        with self._lock:
            person = self._read()["days"].get(vn_day(), {}).get(str(uid))
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
                                     "at": int(time.time()), "input_tokens": 0, "output_tokens": 0, "images": 0})
                self._write(data)
            except OSError as exc:
                logger.error("[zalo] không ghi được sổ lượt xưởng %s: %s — từ chối việc", self.path, exc)
                return -1
        return None if quota is None else quota - used - 1

    def finish(self, job_id: str, status: str, *, input_tokens: int = 0, output_tokens: int = 0,
               error: str = "", images: int = 0) -> None:
        """``status``: ok | failed | refunded | running."""
        with self._lock:
            try:
                data = self._read()
                job = next((j for j in reversed(data["jobs"]) if j.get("id") == job_id), None)
                if job is None:
                    return
                previous = job.get("status")
                job["status"] = status
                job["input_tokens"] = job.get("input_tokens", 0) + int(input_tokens)
                job["output_tokens"] = job.get("output_tokens", 0) + int(output_tokens)
                job["images"] = job.get("images", 0) + int(images)
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
            except OSError as exc:
                logger.error("[zalo] không ghi được sổ lượt xưởng %s: %s", self.path, exc)

    def sweep_lost(self) -> int:
        """Gateway khởi động lại giữa chừng: việc còn ``queued``/``running`` coi như mất, trả lượt."""
        with self._lock:
            data = self._read()
            lost = [j for j in data["jobs"] if j.get("status") in OPEN_STATES]
        for job in lost:
            self.finish(job["id"], "refunded", error="gateway khởi động lại khi đang làm")
        return len(lost)
