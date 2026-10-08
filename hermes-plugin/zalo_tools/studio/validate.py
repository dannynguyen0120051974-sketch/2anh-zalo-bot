"""Kiểm nội dung mô hình viết TRƯỚC khi đưa vào bộ dựng.

Mỗi hàm chặn đúng lối mà bộ dựng tương ứng có thể chạy mã, đọc tệp hay ra mạng:

- thí nghiệm ảo ``mau: moi`` → thi_nghiem.py chạy ``mo-hinh.js`` bằng Node: chỉ nhận mẫu có sẵn;
- video: ảnh chỉ ở dạng XIN (``ve:`` mô tả / ``tim:`` từ khoá) — không tên tệp, không địa chỉ; nhạc nền tải về
  tắt; thời lượng ≤ 180 giây, độ phân giải ép 720;
- SVG của slide: không DOCTYPE/ENTITY, không script/foreignObject/a, không ``on*=``; ``href`` chỉ được ``#id``,
  ảnh ``data:`` nhúng sẵn, hoặc ``img:<mã>`` của ảnh plugin đã tải về thư mục việc (đổi thành đường dẫn tương đối);
- JSON văn bản (NĐ30, Đảng, Đoàn): đúng kiểu, đúng loại văn bản, bỏ khoá chọn nơi ghi tệp;
- trò chơi: 6 khuôn cố định, lược đồ đóng, chữ thuần (bản HTML hiển thị bằng textContent).

Lỗi là ``SourceError`` — câu ngắn tiếng Việt, đưa lại cho bước viết sửa một lần.
"""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

MAX_SOURCE_CHARS = 60_000
MAX_SVG_CHARS = 120_000
MAX_SVG_DATA_CHARS = 1_500_000
MAX_PAGES = 12
MAX_VIDEO_SECONDS = 180
MAX_QUIZ_QUESTIONS = 30


class SourceError(ValueError):
    """Nội dung mô hình viết không qua được kiểm tra."""


_FENCE = re.compile(r"^\s*```[a-zA-Z0-9_-]*\s*\n(.*?)\n```\s*$", re.S)


def clean_text(text: Any, limit: int = MAX_SOURCE_CHARS) -> str:
    """Bỏ khung ``` mô hình hay bọc, chặn ký tự NUL và độ dài."""
    value = str(text or "")
    match = _FENCE.match(value)
    if match:
        value = match.group(1)
    value = value.replace("\r\n", "\n").strip()
    if not value:
        raise SourceError("nội dung rỗng")
    if "\x00" in value:
        raise SourceError("nội dung có ký tự lạ")
    if len(value) > limit:
        raise SourceError(f"nội dung dài quá {limit} ký tự")
    return value + "\n"


_KEY_LINE = re.compile(r"^([a-z][a-z0-9-]*)\s*:\s*(.*)$")


def front_matter(text: str) -> Tuple[Dict[str, str], List[str], List[str]]:
    """``---`` khối đầu ``---`` → (khoá đầu, dòng khối đầu, dòng còn lại). Không có khối đầu → lỗi."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        raise SourceError("thiếu khối thông tin đầu (dòng đầu phải là ---)")
    for end in range(1, len(lines)):
        if lines[end].strip() == "---":
            meta = {}
            for line in lines[1:end]:
                match = _KEY_LINE.match(line.strip())
                if match:
                    meta[match.group(1)] = match.group(2).strip()
            return meta, lines[1:end], lines[end + 1:]
    raise SourceError("khối thông tin đầu chưa đóng bằng ---")


def library_ids(studio: Path) -> Set[str]:
    """Mã các mẫu thí nghiệm có sẵn (``tools/vi/thi_nghiem_parts/mo_hinh/*.json``)."""
    folder = studio / "tools" / "vi" / "thi_nghiem_parts" / "mo_hinh"
    return {p.stem for p in folder.glob("*.json")} if folder.is_dir() else set()


def check_thi_nghiem(text: str, library: Set[str]) -> str:
    text = clean_text(text)
    meta, _head, _body = front_matter(text)
    mau = meta.get("mau", "")
    if mau == "moi" or mau not in library:
        raise SourceError(f"`mau` phải là một mẫu có sẵn: {', '.join(sorted(library)) or '(máy chưa có mẫu nào)'}")
    return text


_VIDEO_META_BANNED = {"nhac-nen", "nguon-nhac"}
VIDEO_STYLES = ("viet-tay", "cat-dan", "vox")
_IMAGE_REQUEST = re.compile(r"^(ve|tim):\s*\S")
_PATHISH = re.compile(r"[\\/]|\.\.|https?:|file:|www\.", re.I)


def _image_request(key: str, value: str) -> None:
    """``anh:``/``nen:``/``nhan-vat:`` chỉ được XIN ảnh (``ve: mô tả`` hoặc ``tim: từ khoá``) — không tên tệp, không địa chỉ."""
    if not _IMAGE_REQUEST.match(value) or _PATHISH.search(value):
        raise SourceError(f"`{key}:` chỉ được `ve: <mô tả>` hoặc `tim: <từ khoá tiếng Anh>` — không tên tệp, không địa chỉ")


def check_video(text: str, library: Set[str], max_seconds: int = MAX_VIDEO_SECONDS) -> str:
    """Video viết tay / cắt dán / Vox; ảnh chỉ ở dạng xin; trả bản đã ép ``do-phan-giai: 720``."""
    text = clean_text(text)
    meta, head, body = front_matter(text)
    for key in _VIDEO_META_BANNED & set(meta):
        raise SourceError(f"xưởng chưa hỗ trợ `{key}` (nhạc nền) — bỏ dòng đó")
    style = meta.get("phong-cach", "viet-tay")
    if style not in VIDEO_STYLES:
        raise SourceError("`phong-cach` là viet-tay, cat-dan hoặc vox")
    character = meta.get("nhan-vat", "khong")
    if character not in ("khong", "nguoi-que"):
        _image_request("nhan-vat", character)
    seconds = meta.get("thoi-luong")
    if seconds is not None and not (seconds.isascii() and seconds.isdigit() and 15 <= int(seconds) <= max_seconds):
        raise SourceError(f"`thoi-luong` là số giây từ 15 đến {max_seconds}")
    for line in body:
        match = _KEY_LINE.match(line.strip())
        if not match:
            continue
        key, value = match.group(1), match.group(2).strip()
        if key in ("anh", "nen"):
            if style != "vox":
                raise SourceError(f"`{key}:` (ảnh) chỉ dùng với `phong-cach: vox`")
            if key == "anh" or value.startswith(("ve:", "tim:")):
                _image_request(key, value)
        if key == "nen-canh" and value not in ("ve", "khong"):
            raise SourceError("`nen-canh` chỉ được `ve` hoặc `khong`")
        if key == "mau" and (value == "moi" or value not in library):
            raise SourceError("cảnh thí nghiệm chỉ dùng mẫu có sẵn")
    head = [line for line in head if not line.strip().startswith("do-phan-giai")] + ["do-phan-giai: 720"]
    return "\n".join(["---", *head, "---", *body]).rstrip("\n") + "\n"


_SVG_BANNED_TAGS = {"script", "foreignobject", "iframe", "object", "embed", "a", "audio", "video", "handler", "listener"}
_DATA_IMAGE = re.compile(r"^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$")
_URL = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.I)


def _check_css(value: str) -> None:
    low = value.lower()
    if "@import" in low or "javascript:" in low or "expression(" in low:
        raise SourceError("SVG có CSS trỏ ra ngoài")
    for _q, target in _URL.findall(value):
        if not target.strip().startswith("#"):
            raise SourceError("SVG chỉ được url(#id), không trỏ ra tệp hay mạng")


_IMG_REF = re.compile(r"^img:([a-z0-9]{1,16})$")


def check_svg(text: str, images: Optional[Dict[str, str]] = None) -> str:
    """Kiểm một trang SVG. ``images``: mã → tên tệp (``../images/w1.jpg``) của ảnh plugin đã tải; ``href="img:w1"``
    được đổi thành đường dẫn đó, mọi tham chiếu khác ra ngoài trang bị từ chối. Ngoài phép đổi ấy, trả nguyên văn."""
    images = images or {}
    text = clean_text(text, MAX_SVG_CHARS + MAX_SVG_DATA_CHARS)
    if re.search(r"<!DOCTYPE|<!ENTITY|<\?xml-stylesheet", text, re.I):
        raise SourceError("SVG không được có DOCTYPE/ENTITY")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise SourceError(f"SVG hỏng: {exc}") from None
    if root.tag.split("}")[-1] != "svg" or not root.get("viewBox"):
        raise SourceError("trang phải là một thẻ <svg> có viewBox")
    data_chars = 0
    for el in root.iter():
        tag = str(el.tag).split("}")[-1].lower()
        if tag in _SVG_BANNED_TAGS:
            raise SourceError(f"SVG không được có thẻ <{tag}>")
        if tag == "style" and el.text:
            _check_css(el.text)
        for name, value in el.attrib.items():
            local = name.split("}")[-1].lower()
            if local.startswith("on"):
                raise SourceError("SVG không được có thuộc tính sự kiện (on…)")
            if "javascript:" in value.lower():
                raise SourceError("SVG không được có javascript:")
            if local == "href":
                ref = value.strip()
                if ref.startswith("#"):
                    continue
                if tag == "image" and _DATA_IMAGE.match(ref):
                    data_chars += len(ref)
                    continue
                found = _IMG_REF.match(ref)
                if tag == "image" and found and found.group(1) in images:
                    continue
                raise SourceError("SVG chỉ được dùng ảnh img:<mã> đã có trong danh sách, ảnh data: hoặc #id trong trang")
            if local == "style" or "url(" in value.lower():
                _check_css(value)
    if len(text) - data_chars > MAX_SVG_CHARS or data_chars > MAX_SVG_DATA_CHARS:
        raise SourceError("trang SVG quá lớn")
    for ref, path in images.items():
        text = re.sub(rf'(href\s*=\s*["\'])img:{ref}(["\'])', rf"\g<1>{path}\g<2>", text)
    return text


def _plain(value: Any, limit: int, what: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SourceError(f"thiếu {what}")
    if len(value) > limit:
        raise SourceError(f"{what} dài quá {limit} ký tự")
    return value.strip()


def check_engine_json(text: str, allowed: Iterable[str]) -> Dict[str, Any]:
    """JSON đầu vào bộ sinh văn bản: object, đúng loại, chỉ kiểu JSON thường, bỏ khoá đường dẫn ra."""
    text = clean_text(text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SourceError(f"JSON hỏng ở dòng {exc.lineno}: {exc.msg}") from None
    if not isinstance(data, dict):
        raise SourceError("JSON phải là một object")
    if data.get("loai_van_ban") not in set(allowed):
        raise SourceError("`loai_van_ban` không nằm trong danh sách hỗ trợ")

    def walk(value: Any, depth: int) -> None:
        if depth > 6:
            raise SourceError("JSON lồng quá sâu")
        if isinstance(value, dict):
            for key, item in value.items():
                walk(item, depth + 1)
        elif isinstance(value, list):
            for item in value:
                walk(item, depth + 1)
        elif not isinstance(value, (str, int, float, bool)) and value is not None:
            raise SourceError("JSON có kiểu dữ liệu lạ")

    walk(data, 0)
    for key in ("output_path", "output", "outputFile", "output_file"):
        data.pop(key, None)
    return data


def check_quiz(text: str) -> Dict[str, Any]:
    """Trò chơi trắc nghiệm: ``{title, subject, timePerQuestion, questions: [{question, options, correct, explanation?}]}``."""
    text = clean_text(text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SourceError(f"JSON hỏng ở dòng {exc.lineno}: {exc.msg}") from None
    if not isinstance(data, dict):
        raise SourceError("JSON phải là một object")
    seconds = data.get("timePerQuestion", 15)
    if not isinstance(seconds, int) or isinstance(seconds, bool) or not 5 <= seconds <= 120:
        raise SourceError("`timePerQuestion` là số giây từ 5 đến 120")
    questions = data.get("questions")
    if not isinstance(questions, list) or not 1 <= len(questions) <= MAX_QUIZ_QUESTIONS:
        raise SourceError(f"cần từ 1 đến {MAX_QUIZ_QUESTIONS} câu hỏi")
    out = []
    for index, q in enumerate(questions, 1):
        if not isinstance(q, dict):
            raise SourceError(f"câu {index} không hợp lệ")
        options = q.get("options")
        if not isinstance(options, list) or not 2 <= len(options) <= 4:
            raise SourceError(f"câu {index} cần 2–4 lựa chọn")
        correct = q.get("correct")
        if not isinstance(correct, int) or isinstance(correct, bool) or not 0 <= correct < len(options):
            raise SourceError(f"câu {index}: `correct` phải là số thứ tự lựa chọn đúng (từ 0)")
        item = {"question": _plain(q.get("question"), 500, f"câu hỏi {index}"),
                "options": [_plain(o, 200, f"lựa chọn của câu {index}") for o in options],
                "correct": correct}
        if q.get("explanation"):
            item["explanation"] = _plain(q.get("explanation"), 500, f"giải thích câu {index}")
        out.append(item)
    return {"title": _plain(data.get("title"), 120, "tên trò chơi"),
            "subject": _plain(data.get("subject") or "Ôn tập", 80, "môn học"),
            "timePerQuestion": seconds, "questions": out}


# ---------------------------------------------------------------- trò chơi (6 khuôn của tro-choi-giao-duc)
GAME_TYPES = ("quiz", "matching", "crossword", "spinwheel", "flashcard", "timer")


def fold(text: str) -> str:
    """Bỏ dấu, viết hoa, chỉ giữ A–Z/0–9 (so đáp án ô chữ, trả lời nhanh)."""
    import unicodedata
    value = unicodedata.normalize("NFD", str(text)).replace("đ", "d").replace("Đ", "D")
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn").upper()
    return re.sub(r"[^A-Z0-9]", "", value)


def _int(value: Any, low: int, high: int, what: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        raise SourceError(f"{what} là số nguyên từ {low} đến {high}")
    return value


def _list(value: Any, low: int, high: int, what: str) -> list:
    if not isinstance(value, list) or not low <= len(value) <= high:
        raise SourceError(f"{what} cần từ {low} đến {high} mục")
    return value


def _obj(value: Any, what: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise SourceError(f"{what} không hợp lệ")
    return value


def _question(q: Any, index: int) -> Dict[str, Any]:
    if not isinstance(q, dict):
        raise SourceError(f"câu {index} không hợp lệ")
    options = _list(q.get("options"), 2, 4, f"lựa chọn của câu {index}")
    correct = _int(q.get("correct"), 0, len(options) - 1, f"`correct` của câu {index}")
    item = {"question": _plain(q.get("question"), 500, f"câu hỏi {index}"),
            "options": [_plain(o, 200, f"lựa chọn của câu {index}") for o in options], "correct": correct}
    if q.get("explanation"):
        item["explanation"] = _plain(q.get("explanation"), 500, f"giải thích câu {index}")
    return item


def check_game(text: str, kind: str) -> Dict[str, Any]:
    """Dữ liệu cho khuôn ``games.html``; ``kind`` do plugin chọn từ ``options.loai`` — mô hình không đổi được khuôn."""
    if kind not in GAME_TYPES:
        raise SourceError("loại trò chơi không có khuôn")
    if kind == "quiz":
        return {"type": "quiz", **check_quiz(text)}
    text = clean_text(text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SourceError(f"JSON hỏng ở dòng {exc.lineno}: {exc.msg}") from None
    if not isinstance(data, dict):
        raise SourceError("JSON phải là một object")
    out: Dict[str, Any] = {"type": kind, "title": _plain(data.get("title"), 120, "tên trò chơi"),
                           "subject": _plain(data.get("subject") or "Ôn tập", 80, "môn học")}
    if kind == "matching":
        out["pairs"] = []
        for i, pair in enumerate(_list(data.get("pairs"), 2, 32, "các cặp ghép"), 1):
            pair = _obj(pair, f"cặp {i}")
            out["pairs"].append({"left": _plain(pair.get("left"), 150, f"vế trái cặp {i}"),
                                 "right": _plain(pair.get("right"), 200, f"vế phải cặp {i}")})
    elif kind == "crossword":
        keyword = _plain(data.get("keyword"), 40, "từ chìa khoá")
        key = fold(keyword)
        if not 3 <= len(key) <= 12:
            raise SourceError("từ chìa khoá có 3–12 chữ cái (không tính dấu, khoảng trắng)")
        rows = _list(data.get("rows"), len(key), len(key), "số hàng (bằng số chữ của từ chìa khoá)")
        placed, positions = [], []
        for i, row in enumerate(rows):
            if not isinstance(row, dict):
                raise SourceError(f"hàng {i + 1} không hợp lệ")
            display = _plain(row.get("displayAnswer") or row.get("answer"), 40, f"đáp án hàng {i + 1}")
            answer = fold(display)
            if not 2 <= len(answer) <= 16:
                raise SourceError(f"đáp án hàng {i + 1} có 2–16 chữ cái")
            if key[i] not in answer:
                raise SourceError(f"đáp án hàng {i + 1} phải chứa chữ {key[i]} của từ chìa khoá")
            positions.append(answer.index(key[i]))
            item = {"answer": answer, "display": display, "clue": _plain(row.get("clue"), 300, f"gợi ý hàng {i + 1}")}
            if row.get("clue2"):
                item["clue2"] = _plain(row.get("clue2"), 300, f"gợi ý thêm hàng {i + 1}")
            placed.append(item)
        column = max(positions)
        for item, pos in zip(placed, positions):
            item["startCol"] = column - pos
        out.update({"keywordDisplay": keyword, "keywordCol": column, "rows": placed,
                    "keywordClue": _plain(data.get("keywordClue"), 300, "gợi ý từ chìa khoá")})
    elif kind == "spinwheel":
        mode = data.get("mode") if data.get("mode") in ("quiz", "select") else "select"
        segments = _list(data.get("segments"), 2, 12, "số ô vòng quay")
        out["mode"] = mode
        out["segments"] = []
        for i, seg in enumerate(segments, 1):
            if not isinstance(seg, dict):
                raise SourceError(f"ô {i} không hợp lệ")
            item = {"label": _plain(seg.get("label"), 20, f"nhãn ô {i}")}
            if mode == "quiz":
                item.update(_question(seg, i))
            out["segments"].append(item)
    elif kind == "flashcard":
        cards = _list(data.get("cards"), 2, 60, "số thẻ")
        out["cards"] = []
        for i, card in enumerate(cards, 1):
            if not isinstance(card, dict):
                raise SourceError(f"thẻ {i} không hợp lệ")
            item = {"front": _plain(card.get("front"), 200, f"mặt trước thẻ {i}"),
                    "back": _plain(card.get("back"), 400, f"mặt sau thẻ {i}")}
            for key, limit in (("example", 300), ("phonetic", 60)):
                if card.get(key):
                    item[key] = _plain(card.get(key), limit, f"{key} thẻ {i}")
            out["cards"].append(item)
    elif kind == "timer":
        if data.get("mode") == "countdown":
            presets = _list(data.get("presets") or [60, 120, 300], 1, 6, "các mốc đếm ngược")
            out.update({"mode": "countdown", "presets": [_int(p, 10, 3600, "mốc đếm ngược (giây)") for p in presets]})
        else:
            questions = []
            for i, q in enumerate(_list(data.get("questions"), 3, 60, "số câu trả lời nhanh"), 1):
                q = _obj(q, f"câu {i}")
                questions.append({"q": _plain(q.get("q"), 200, f"câu {i}"), "a": _plain(q.get("a"), 80, f"đáp án câu {i}")})
            out.update({"mode": "speedquiz", "totalTime": _int(data.get("totalTime", 60), 30, 300, "`totalTime` (giây)"),
                        "questions": questions})
    return out


# ---------------------------------------------------------------- văn bản Đoàn (bộ sinh doan_docx.py)
DOAN_TYPES = ("ke_hoach", "thong_bao", "cong_van", "bao_cao", "trieu_tap", "huong_dan", "quyet_dinh")


def _line(value: Any, limit: int, what: str, *, required: bool = True) -> str:
    if value in (None, "") and not required:
        return ""
    text = " ".join(_plain(value, limit * 2, what).split())
    if len(text) > limit:
        raise SourceError(f"{what} dài quá {limit} ký tự")
    return text


def check_doan_json(text: str) -> Dict[str, Any]:
    """JSON văn bản Đoàn: các trường một dòng, thân là danh sách khối ``muc``/``doan``/``bang``."""
    text = clean_text(text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SourceError(f"JSON hỏng ở dòng {exc.lineno}: {exc.msg}") from None
    if not isinstance(data, dict):
        raise SourceError("JSON phải là một object")
    if data.get("loai") not in DOAN_TYPES:
        raise SourceError(f"`loai` là một trong: {', '.join(DOAN_TYPES)}")
    so = str(data.get("so") or "").strip()
    if so and not (so.isascii() and so.isdigit() and len(so) <= 4):
        raise SourceError("`so` là số văn bản (chỉ chữ số) hoặc để trống cho văn thư")
    out: Dict[str, Any] = {
        "loai": data["loai"], "so": so,
        "don_vi_cap_tren": _line(data.get("don_vi_cap_tren"), 60, "đơn vị cấp trên").upper(),
        "don_vi": _line(data.get("don_vi") or "BAN CHẤP HÀNH ĐOÀN TRƯỜNG", 60, "đơn vị ban hành").upper(),
        "dia_danh": _line(data.get("dia_danh"), 40, "địa danh"),
        "ngay": _line(data.get("ngay"), 30, "ngày"), "thang": _line(data.get("thang"), 30, "tháng"),
        "nam": _line(data.get("nam"), 30, "năm"),
        "trich_yeu": _line(data.get("trich_yeu"), 300, "trích yếu"),
        "quyen_han": _line(data.get("quyen_han") or "TM. BAN CHẤP HÀNH ĐOÀN TRƯỜNG", 80, "quyền hạn ký").upper(),
        "chuc_vu": _line(data.get("chuc_vu") or "Bí thư", 40, "chức vụ ký"),
        "nguoi_ky": _line(data.get("nguoi_ky"), 60, "người ký", required=False),
        "ket": _line(data.get("ket"), 300, "câu kết", required=False),
    }
    out["kinh_gui"] = [_line(x, 150, "nơi kính gửi") for x in _list(data.get("kinh_gui") or [], 0, 10, "nơi kính gửi")]
    out["noi_nhan"] = [_line(x, 150, "nơi nhận") for x in _list(data.get("noi_nhan"), 1, 15, "nơi nhận")]
    blocks = []
    for i, block in enumerate(_list(data.get("noi_dung"), 1, 300, "khối nội dung"), 1):
        if not isinstance(block, dict) or len(block) != 1 or next(iter(block)) not in ("muc", "doan", "bang"):
            raise SourceError(f"khối {i} phải có đúng một khoá muc, doan hoặc bang")
        key, value = next(iter(block.items()))
        if key == "bang":
            rows = _list(value, 2, 60, f"số dòng bảng ở khối {i}")
            if not all(isinstance(r, list) for r in rows) or len({len(r) for r in rows}) != 1 or not 1 <= len(rows[0]) <= 8:
                raise SourceError(f"bảng ở khối {i}: mọi dòng cùng số cột (1–8)")
            blocks.append({"bang": [[_line(c, 300, f"ô bảng khối {i}", required=False) for c in r] for r in rows]})
        else:
            blocks.append({key: _line(value, 3000, f"khối {i}")})
    out["noi_dung"] = blocks
    return out
