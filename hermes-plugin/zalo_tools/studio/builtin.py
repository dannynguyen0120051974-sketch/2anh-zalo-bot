"""Bộ dựng nằm ngay trong plugin cho loại không có bộ dựng cố định ở 2Anh Studio.

- Đề kiểm tra, SKKN: skill gốc bảo mô hình tự viết mã docx — không được với người ngoài. Ở đây
  mô hình chỉ viết Markdown, ``file_maker.build_docx`` (bộ dựng Word sẵn có của ``zalo_make_file``,
  trình bày Nghị định 30) dựng tệp.
- Trò chơi (trắc nghiệm, ghép đôi, ô chữ, vòng quay, thẻ lật, đếm ngược/trả lời nhanh — đúng 6 loại có khuôn
  của skill ``tro-choi-giao-duc``): skill gốc bảo mô hình tự viết cả trang HTML + JS — tức mã chạy trên máy
  học sinh. Ở đây trang là khuôn cố định ``games.html``; dữ liệu đi vào một khối JSON và được hiển thị bằng
  ``textContent`` — chữ của mô hình không bao giờ thành mã. "Trò chơi tự mô tả" của skill không có khuôn → không có.
- Văn bản Đoàn: xem ``doan_docx.py``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict

TEMPLATE = Path(__file__).with_name("games.html")


def title_of(markdown: str, fallback: str) -> str:
    for line in markdown.splitlines():
        match = re.match(r"^#\s+(.+)$", line.strip())
        if match:
            return match.group(1).strip()[:200]
    return fallback


def build_markdown_docx(markdown: str, fallback_title: str, out_path: Path) -> Path:
    from .. import file_maker

    title = title_of(markdown, fallback_title)
    body = "\n".join(line for line in markdown.splitlines() if line.strip() != f"# {title}")
    file_maker.build_docx(title, body, out_path)
    return out_path


def build_game_html(data: Dict[str, Any], out_path: Path) -> Path:
    """``data`` đã qua ``validate.check_game`` (có khoá ``type``)."""
    payload = json.dumps(data, ensure_ascii=False)
    # Trong <script type="application/json">, chỉ chuỗi "</" mới đóng được thẻ — thoát mọi "<".
    payload = payload.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    page = TEMPLATE.read_text(encoding="utf-8").replace("__GAME_DATA__", payload)
    out_path.write_text(page, encoding="utf-8")
    return out_path
