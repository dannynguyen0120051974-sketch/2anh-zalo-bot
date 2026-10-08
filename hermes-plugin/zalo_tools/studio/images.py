"""Ảnh cho xưởng: chỉ mã cố định của plugin vẽ ảnh AI hay tải ảnh web — chạy ở tiến trình cha, ngoài hộp cát.

AI chỉ được XIN ảnh: một câu mô tả (ảnh AI) hoặc một cụm từ tìm (ảnh web). Ở đây:

- Ảnh AI: gọi ``<ZALO_STUDIO_IMAGE_URL>/images/generations`` (mặc định 9router như đường Vox của 2Anh Studio),
  khoá ``ANH_AI_KEY`` của chủ bot — khoá không bao giờ vào hộp cát. Nhận ``b64_json`` (hoặc ``url`` → tải an toàn).
- Ảnh web: tìm qua API Openverse (ảnh giấy phép mở, có tác giả/giấy phép để ghi nguồn), rồi tải ``url`` kết quả.
- Mọi lần tải ra Internet đi qua ``fetch``: chỉ https, phân giải tên rồi kiểm MỌI địa chỉ là địa chỉ công cộng
  (chặn 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, ::1, fc00::/7, fe80::/10, đa hướng…), kết nối
  thẳng tới đúng IP đã kiểm (chống đổi DNS giữa lúc kiểm và lúc nối) với SNI/chứng chỉ của tên gốc, tự đi theo tối
  đa 3 lần chuyển hướng và kiểm lại từng chặng, giới hạn cỡ và thời gian, Content-Type phải là ảnh.
- Ảnh nhận về phải đúng PNG hoặc JPEG theo byte đầu (không tin Content-Type), ≤ 8 MB, rồi mới ghi vào thư mục việc
  dưới tên do plugin đặt. Số ảnh mỗi việc có trần (``MAX_AI_IMAGES``, ``MAX_WEB_IMAGES``).
"""

from __future__ import annotations

import asyncio
import base64
import ipaddress
import json
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_AI_IMAGES = 12
MAX_WEB_IMAGES = 8
FETCH_TIMEOUT = 30
GENERATE_TIMEOUT = 150
MAX_REDIRECTS = 3
USER_AGENT = "2anh-zalo-studio/1.0 (+https://github.com/luonghaianh1208/2anh-zalo-bot)"
OPENVERSE_HOST = "api.openverse.org"
DEFAULT_IMAGE_URL = "http://127.0.0.1:20128/v1"
DEFAULT_IMAGE_MODEL = "ag/gemini-3.1-flash-image"


class ImageError(Exception):
    """Không có được ảnh (mạng, nhà cung cấp, dữ liệu không phải ảnh, địa chỉ bị chặn)."""


def sniff(data: bytes) -> Optional[str]:
    """Đuôi tệp theo byte đầu: ``png`` | ``jpg`` | None."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    return None


def is_public(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast and not ip.is_reserved


Resolver = Callable[[str, int], List[str]]


def system_resolver(host: str, port: int) -> List[str]:
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return sorted({info[4][0] for info in infos}, key=lambda a: ":" in a)  # IPv4 trước


def check_url(url: str, resolver: Resolver = system_resolver) -> Tuple[str, str, int, str]:
    """Kiểm một địa chỉ: https, không user:pass, tên phân giải ra TOÀN địa chỉ công cộng. Trả (host, ip, port, path)."""
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        raise ImageError("chỉ tải ảnh qua https từ địa chỉ công khai")
    host = parts.hostname.lower().rstrip(".")
    port = parts.port or 443
    if host in ("localhost",) or host.endswith((".localhost", ".local", ".internal", ".lan", ".home.arpa")):
        raise ImageError("không tải ảnh từ máy nội bộ")
    try:
        addresses = [host] if _is_ip(host) else resolver(host, port)
    except OSError:
        raise ImageError("không tìm thấy máy chủ ảnh") from None
    if not addresses or not all(is_public(a) for a in addresses):
        raise ImageError("không tải ảnh từ địa chỉ nội bộ")
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    return host, addresses[0], port, path


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


async def fetch(url: str, *, max_bytes: int, accept: Tuple[str, ...], client: Any = None,
                resolver: Resolver = system_resolver, timeout: float = FETCH_TIMEOUT) -> Tuple[bytes, str]:
    """GET an toàn (xem đầu tệp). Trả (nội dung, Content-Type)."""
    import httpx

    async def run(c) -> Tuple[bytes, str]:
        current = url
        for _hop in range(MAX_REDIRECTS + 1):
            host, ip, port, path = check_url(current, resolver)
            netloc = f"[{ip}]" if ":" in ip else ip
            request = c.build_request("GET", f"https://{netloc}:{port}{path}",
                                      headers={"Host": host if port == 443 else f"{host}:{port}", "User-Agent": USER_AGENT,
                                               "Accept": ", ".join(accept) or "*/*"},
                                      extensions={"sni_hostname": host})
            response = await c.send(request, stream=True)
            try:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location", "")
                    current = str(httpx.URL(current).join(location))
                    continue
                if response.status_code != 200:
                    raise ImageError(f"máy chủ ảnh trả mã {response.status_code}")
                kind = response.headers.get("content-type", "").split(";")[0].strip().lower()
                if accept and not kind.startswith(accept):
                    raise ImageError("địa chỉ không trả về đúng loại dữ liệu")
                length = response.headers.get("content-length")
                if length and length.isdigit() and int(length) > max_bytes:
                    raise ImageError("ảnh quá lớn")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body += chunk
                    if len(body) > max_bytes:
                        raise ImageError("ảnh quá lớn")
                return bytes(body), kind
            finally:
                await response.aclose()
        raise ImageError("chuyển hướng quá nhiều lần")

    try:
        if client is not None:
            return await asyncio.wait_for(run(client), timeout)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False) as c:
            return await asyncio.wait_for(run(c), timeout)
    except ImageError:
        raise
    except asyncio.TimeoutError:
        raise ImageError("tải ảnh quá lâu") from None
    except Exception as exc:  # lỗi mạng/TLS: gọn, không lộ chi tiết
        raise ImageError(f"không tải được ảnh ({type(exc).__name__})") from None


@dataclass
class Picture:
    data: bytes
    ext: str                 # png | jpg
    author: str = ""
    license: str = ""
    provider: str = ""
    source_url: str = ""


def _image(data: bytes) -> Picture:
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageError("ảnh quá lớn")
    ext = sniff(data)
    if ext is None:
        raise ImageError("dữ liệu nhận về không phải ảnh PNG/JPEG")
    return Picture(data=data, ext=ext)


@dataclass(frozen=True)
class ImageConfig:
    url: str
    key: str
    model: str


def image_config() -> ImageConfig:
    from .recipes import _setting
    return ImageConfig(url=(_setting("ZALO_STUDIO_IMAGE_URL") or _setting("ANH_AI_URL") or DEFAULT_IMAGE_URL).rstrip("/"),
                       key=_setting("ANH_AI_KEY"),
                       model=_setting("ZALO_STUDIO_IMAGE_MODEL") or _setting("ANH_AI_MO_HINH") or DEFAULT_IMAGE_MODEL)


async def generate(prompt: str, size: str, *, config: Optional[ImageConfig] = None, client: Any = None) -> Picture:
    """Vẽ một ảnh AI. Địa chỉ cổng ảnh là cấu hình của chủ bot (được phép là 127.0.0.1); câu mô tả là dữ liệu."""
    import httpx

    cfg = config or image_config()
    text = " ".join(str(prompt or "").split())[:1500]
    if not text:
        raise ImageError("mô tả ảnh rỗng")
    headers = {"Content-Type": "application/json"}
    if cfg.key:
        headers["Authorization"] = f"Bearer {cfg.key}"
    body = {"model": cfg.model, "prompt": text, "size": size, "n": 1}

    async def run(c) -> Picture:
        r = await c.post(f"{cfg.url}/images/generations", json=body, headers=headers)
        if r.status_code != 200:
            raise ImageError(f"cổng vẽ ảnh báo lỗi {r.status_code}")
        if len(r.content) > MAX_IMAGE_BYTES * 2:
            raise ImageError("ảnh quá lớn")
        try:
            item = r.json()["data"][0]
        except (ValueError, KeyError, IndexError, TypeError):
            raise ImageError("cổng vẽ ảnh không trả ảnh") from None
        if isinstance(item, dict) and item.get("b64_json"):
            try:
                return _image(base64.b64decode(item["b64_json"], validate=False))
            except (ValueError, TypeError):
                raise ImageError("cổng vẽ ảnh trả dữ liệu hỏng") from None
        if isinstance(item, dict) and item.get("url"):
            data, _kind = await fetch(str(item["url"]), max_bytes=MAX_IMAGE_BYTES, accept=("image/",))
            return _image(data)
        raise ImageError("cổng vẽ ảnh không trả ảnh")

    try:
        if client is not None:
            return await asyncio.wait_for(run(client), GENERATE_TIMEOUT)
        async with httpx.AsyncClient(timeout=GENERATE_TIMEOUT, trust_env=False) as c:
            return await asyncio.wait_for(run(c), GENERATE_TIMEOUT)
    except ImageError:
        raise
    except asyncio.TimeoutError:
        raise ImageError("vẽ ảnh quá lâu") from None
    except Exception as exc:
        raise ImageError(f"không gọi được cổng vẽ ảnh ({type(exc).__name__})") from None


async def search_web(query: str, orientation: str = "landscape", *, client: Any = None,
                     resolver: Resolver = system_resolver, tries: int = 4) -> Picture:
    """Tìm một ảnh giấy phép mở trên Openverse rồi tải an toàn; thử tối đa ``tries`` kết quả."""
    from urllib.parse import urlencode

    q = " ".join(str(query or "").split())[:120]
    if not q:
        raise ImageError("từ khoá tìm ảnh rỗng")
    params = urlencode({"q": q, "page_size": 10, "license": "by,by-sa,cc0,pdm", "extension": "jpg,png",
                        "aspect_ratio": {"landscape": "wide", "portrait": "tall"}.get(orientation, "square")})
    raw, _kind = await fetch(f"https://{OPENVERSE_HOST}/v1/images/?{params}", max_bytes=MAX_JSON_BYTES,
                             accept=("application/json",), client=client, resolver=resolver)
    try:
        results = json.loads(raw.decode("utf-8")).get("results") or []
    except (ValueError, AttributeError):
        raise ImageError("trang tìm ảnh trả dữ liệu hỏng") from None
    last: Optional[ImageError] = None
    for item in results[:tries]:
        if not isinstance(item, dict) or not str(item.get("url") or "").startswith("https://"):
            continue
        try:
            data, _kind = await fetch(str(item["url"]), max_bytes=MAX_IMAGE_BYTES, accept=("image/",),
                                      client=client, resolver=resolver)
            picture = _image(data)
        except ImageError as exc:
            last = exc
            continue
        license_name = " ".join(str(x) for x in (item.get("license") or "", item.get("license_version") or "") if x).upper()
        picture.author = str(item.get("creator") or "")[:120]
        picture.license = f"CC {license_name}".strip() if license_name not in ("PDM", "CC0") else license_name
        picture.provider = f"Openverse/{item.get('source') or item.get('provider') or ''}".rstrip("/")[:60]
        picture.source_url = str(item.get("foreign_landing_url") or "")[:300]
        return picture
    raise last or ImageError(f"không tìm được ảnh cho \"{q}\"")


def save(picture: Picture, folder: Path, name: str) -> Path:
    """Ghi ảnh vào thư mục việc dưới tên do plugin đặt (``name`` không có đuôi, chỉ chữ/số/gạch)."""
    if not name.replace("-", "").replace("_", "").isalnum():
        raise ImageError("tên ảnh không hợp lệ")
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{name}.{picture.ext}"
    path.write_bytes(picture.data)
    return path


def sources_manifest(entries: List[Dict[str, str]], path: Path) -> None:
    """``image_sources.json`` theo dạng 2Anh Studio đọc: ``{"items": [{filename, author, license_name, provider}]}``."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"items": entries}, ensure_ascii=False, indent=2), encoding="utf-8")
