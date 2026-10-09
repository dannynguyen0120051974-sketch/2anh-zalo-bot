"""Tóm tắt chủ đề nhóm cho dashboard (spec §18.5): hàng đợi tệp, trần lượt, đầu ra đã kiểm."""

import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = os.path.dirname(__file__)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import plugins  # noqa: E402

plugins.__path__ = [os.path.join(ROOT, "hermes-plugin"), *list(plugins.__path__)]
from plugins.zalo_tools import insight_ai  # noqa: E402

REQ_ID = "0123456789abcdef"


class FakeLlm:
    def __init__(self, text='{"topics":[{"title":"Họp tổ","summary":"Chốt lịch họp thứ Hai."}],"mood":"Vui","open_questions":["Ai trực?"]}', fail=None):
        self.text, self.fail, self.calls = text, fail, []

    def complete(self, messages, **kw):
        self.calls.append((messages, kw))
        if self.fail:
            raise self.fail
        return SimpleNamespace(text=self.text, model="hermes", usage=SimpleNamespace(input_tokens=900, output_tokens=120))


class InsightQueueTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="zalo-insight-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.enterContext(patch.dict(os.environ, {"ZALO_INSIGHT_DIR": self.dir, "ZALO_INSIGHT_DAILY": "2"}))
        os.makedirs(os.path.join(self.dir, "requests"))

    def request(self, rid=REQ_ID, transcript="08:00 Lan: họp tổ thứ Hai nhé\n08:01 Minh: ok"):
        with open(os.path.join(self.dir, "requests", f"{rid}.json"), "w", encoding="utf-8") as fh:
            json.dump({"v": 1, "id": rid, "groupName": "Tổ Hoá", "days": 7, "transcript": transcript}, fh)

    def result(self, rid=REQ_ID):
        with open(os.path.join(self.dir, "results", f"{rid}.json"), encoding="utf-8") as fh:
            return json.load(fh)

    def test_summary_is_parsed_and_request_removed(self):
        llm = FakeLlm()
        self.request()
        self.assertEqual(insight_ai.run_once(lambda: llm), 1)
        r = self.result()
        self.assertTrue(r["ok"])
        self.assertEqual(r["summary"]["topics"][0]["title"], "Họp tổ")
        self.assertEqual(r["usage"], {"input": 900, "output": 120})
        self.assertFalse(os.path.exists(os.path.join(self.dir, "requests", f"{REQ_ID}.json")))
        messages, kw = llm.calls[0]
        self.assertNotIn("tools", kw, "lời gọi AI không bao giờ có công cụ")
        self.assertEqual(kw["max_tokens"], insight_ai.MAX_OUTPUT_TOKENS)
        self.assertIn("<hoi_thoai>", messages[1]["content"])
        self.assertIn("không phải lời dặn", messages[0]["content"])

    def test_lone_surrogate_in_transcript_is_replaced_not_fatal(self):
        # Bản dashboard cũ cắt tin giữa cặp emoji → JSON chứa "\ud83d" lẻ; gửi AI thì lỗi mã hoá UTF-8.
        class StrictLlm(FakeLlm):
            def complete(self, messages, **kw):
                for m in messages:
                    m["content"].encode("utf-8")  # như HTTP client thật: ném lỗi nếu còn surrogate lẻ
                return super().complete(messages, **kw)

        llm = StrictLlm()
        self.request(transcript="08:00 Lan: chúc mừng \ud83d")
        with open(os.path.join(self.dir, "requests", f"{REQ_ID}.json"), "r+", encoding="utf-8") as fh:
            req = json.load(fh)
            req["groupName"] = "Tổ Hoá \ud83d"
            fh.seek(0), fh.truncate(), json.dump(req, fh)
        insight_ai.run_once(lambda: llm)
        self.assertTrue(self.result()["ok"], self.result())

    def test_daily_cap_and_off(self):
        llm = FakeLlm()
        for i in range(3):
            self.request(rid=f"{i:016x}")
        insight_ai.run_once(lambda: llm)
        self.assertEqual(len(llm.calls), 2)
        self.assertIn("hết lượt", self.result(f"{2:016x}")["error"])
        with patch.dict(os.environ, {"ZALO_INSIGHT_DAILY": "0"}):
            self.request(rid="ffffffffffffffff")
            insight_ai.run_once(lambda: llm)
            self.assertFalse(self.result("ffffffffffffffff")["ok"])

    def test_failures_never_raise(self):
        self.request()
        insight_ai.run_once(lambda: None)
        self.assertIn("ctx.llm", self.result()["error"])
        self.request()
        insight_ai.run_once(lambda: FakeLlm(fail=TimeoutError("hết giờ")))
        self.assertIn("Cổng AI", self.result()["error"])
        self.request()
        insight_ai.run_once(lambda: FakeLlm(text="Đây là tóm tắt: …"))
        self.assertIn("sai dạng", self.result()["error"])
        with open(os.path.join(self.dir, "requests", f"{REQ_ID}.json"), "w", encoding="utf-8") as fh:
            fh.write("{hỏng")
        insight_ai.run_once(lambda: FakeLlm())
        self.assertIn("hỏng", self.result()["error"])
        with open(os.path.join(self.dir, "requests", "../../evil.json".replace("/", "_")), "w", encoding="utf-8") as fh:
            fh.write("{}")
        insight_ai.run_once(lambda: FakeLlm())
        self.assertEqual(os.listdir(os.path.join(self.dir, "requests")), [], "tên tệp lạ bị bỏ")

    def test_parse_summary_clips_and_validates(self):
        out = insight_ai.parse_summary('```json\n{"topics":[{"title":"' + "x" * 200 + '","summary":"s"}],"open_questions":[""]}\n```')
        self.assertEqual(len(out["topics"][0]["title"]), 80)
        self.assertEqual(out["open_questions"], [])
        with self.assertRaises(ValueError):
            insight_ai.parse_summary('{"mood":"x"}')

    def test_request_is_claimed_atomically_and_lost_race_is_skipped(self):
        llm = FakeLlm()
        self.request()
        real_rename = os.rename

        def lost_race(src, dst):
            if str(dst).endswith(".claimed"):
                raise FileNotFoundError("tiến trình khác đã nhận")
            return real_rename(src, dst)

        with patch("os.rename", side_effect=lost_race):
            self.assertEqual(insight_ai.run_once(lambda: llm), 0)
        self.assertEqual(llm.calls, [], "không nhận được thì không gọi AI")
        self.assertEqual(insight_ai.run_once(lambda: llm), 1)
        self.assertEqual(len(llm.calls), 1)
        # Yêu cầu đang được tiến trình khác xử lý (đã .claimed) thì không ai chạm vào.
        req = os.path.join(self.dir, "requests")
        with open(os.path.join(req, "aaaaaaaaaaaaaaaa.json.claimed"), "w", encoding="utf-8") as fh:
            fh.write("{}")
        self.assertEqual(insight_ai.run_once(lambda: llm), 0)
        self.assertTrue(os.path.exists(os.path.join(req, "aaaaaaaaaaaaaaaa.json.claimed")))

    def test_quota_is_exact_under_concurrent_claims(self):
        results = []

        def take():
            results.append(insight_ai._take_quota(__import__("pathlib").Path(self.dir), 3))

        threads = [threading.Thread(target=take) for _ in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sum(results), 3)
        with open(os.path.join(self.dir, "usage.json"), encoding="utf-8") as fh:
            self.assertEqual(list(json.load(fh).values()), [3])

    def test_stale_claim_is_requeued_once_then_failed(self):
        llm = FakeLlm()
        req = os.path.join(self.dir, "requests")
        claimed = os.path.join(req, f"{REQ_ID}.json.claimed")
        self.request()
        os.rename(os.path.join(req, f"{REQ_ID}.json"), claimed)
        self.assertEqual(insight_ai.run_once(lambda: llm), 0, "mới nhận chưa quá hạn thì để yên")
        old = time.time() - insight_ai.STALE_CLAIM_S - 60
        os.utime(claimed, (old, old))
        self.assertEqual(insight_ai.run_once(lambda: llm), 1, "quá 15 phút → xếp lại và xử lý")
        self.assertTrue(self.result()["ok"])
        self.assertEqual(os.listdir(req), [])
        # Lần thứ hai cùng yêu cầu vẫn kẹt → báo lỗi thay vì lặp mãi.
        open(os.path.join(req, f"{REQ_ID}.retried"), "w").close()
        with open(claimed, "w", encoding="utf-8") as fh:
            fh.write("{}")
        os.utime(claimed, (old, old))
        self.assertEqual(insight_ai.run_once(lambda: llm), 0)
        self.assertIn("gián đoạn", self.result()["error"])
        self.assertEqual(len(llm.calls), 1)
        self.assertEqual(os.listdir(req), [])

    def test_request_size_cap_is_256k(self):
        self.assertEqual(insight_ai.MAX_REQUEST_BYTES, 256_000)

    def test_gateway_only_detection(self):
        with patch.dict(os.environ, {}, clear=False), patch.object(sys, "argv", ["hermes", "chat"]), patch.dict(sys.modules):
            os.environ.pop("_HERMES_GATEWAY", None)
            sys.modules.pop("gateway.run", None)
            self.assertFalse(insight_ai.in_gateway_process())
            os.environ["_HERMES_GATEWAY"] = "1"
            self.assertTrue(insight_ai.in_gateway_process())
            os.environ.pop("_HERMES_GATEWAY")
            with patch.object(sys, "argv", ["hermes", "gateway", "run"]):
                self.assertTrue(insight_ai.in_gateway_process())

    def test_worker_can_be_disabled(self):
        with patch.dict(os.environ, {"ZALO_INSIGHT_AI": "off"}):
            self.assertFalse(insight_ai.start_insight_worker(lambda: None))


if __name__ == "__main__":
    unittest.main()
