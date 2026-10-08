"""Tóm tắt chủ đề nhóm cho dashboard (spec §18.5): hàng đợi tệp, trần lượt, đầu ra đã kiểm."""

import json
import os
import shutil
import sys
import tempfile
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

    def test_worker_can_be_disabled(self):
        with patch.dict(os.environ, {"ZALO_INSIGHT_AI": "off"}):
            self.assertFalse(insight_ai.start_insight_worker(lambda: None))


if __name__ == "__main__":
    unittest.main()
