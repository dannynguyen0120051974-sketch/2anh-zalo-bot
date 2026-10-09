"""Kho khoá dự phòng (key_pool): đồng bộ khoá vào os.environ, tự đổi khoá kế khi công cụ báo lỗi khoá / hết lượt."""

import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "hermes-plugin"))
from zalo_tools import key_pool  # noqa: E402

K1 = "tvly-first-aaaaaaaaaaaa1111"
K2 = "tvly-second-bbbbbbbbbbb2222"
K3 = "tvly-third-cccccccccccc3333"


class KeyPoolTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="zalo-keypool-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.pool = os.path.join(self.dir, "key-pool.json")
        self.env = os.path.join(self.dir, ".env")
        with open(self.env, "w", encoding="utf-8") as fh:
            fh.write(f"OTHER=1\nexport TAVILY_API_KEY={K1}\n")
        self.enterContext(patch.dict(os.environ, {"ZALO_KEY_POOL_FILE": self.pool, "ZALO_HERMES_ENV_FILE": self.env, "TAVILY_API_KEY": K1}))
        key_pool._state.update(mtime=None, data=None, last_rotate={})
        self.write({"TAVILY_API_KEY": {"active": "k1", "list": [
            {"id": "k1", "value": K1}, {"id": "k2", "value": K2}, {"id": "k3", "value": K3}]}})

    def write(self, keys):
        with open(self.pool, "w", encoding="utf-8") as fh:
            json.dump({"version": 1, "keys": keys}, fh)
        key_pool._state.update(mtime=None, data=None)

    def read_pool(self):
        with open(self.pool, encoding="utf-8") as fh:
            return json.load(fh)["keys"]["TAVILY_API_KEY"]

    def test_sync_applies_active_key_without_restart(self):
        data = json.load(open(self.pool, encoding="utf-8"))
        data["keys"]["TAVILY_API_KEY"]["active"] = "k2"
        self.write(data["keys"])
        self.assertEqual(key_pool.sync(), 1)
        self.assertEqual(os.environ["TAVILY_API_KEY"], K2)
        self.assertEqual(key_pool.sync(), 0, "không đổi thì không làm gì")

    def test_quota_error_rotates_to_next_key_and_asks_model_to_retry(self):
        result = json.dumps({"success": False, "error": "Tavily API error 432: This request exceeds your plan's set usage limit"})
        out = key_pool.on_tool_result(tool_name="web_search", result=result, status="error")
        self.assertIsNotNone(out)
        obj = json.loads(out)
        self.assertIn("gọi lại", obj["he_thong"])
        self.assertNotIn(K1, out)
        self.assertNotIn(K2, out, "không bao giờ đưa khoá cho model")
        self.assertEqual(os.environ["TAVILY_API_KEY"], K2)
        pool = self.read_pool()
        self.assertEqual(pool["active"], "k2")
        self.assertGreater(pool["list"][0]["cool_until"], 0)
        self.assertIn(f"export TAVILY_API_KEY={K2}", open(self.env, encoding="utf-8").read(), "lần khởi động sau vẫn dùng khoá mới")
        events = [json.loads(line) for line in open(key_pool.events_path(), encoding="utf-8")]
        self.assertEqual([(e["key"], e["from"], e["to"]) for e in events], [("TAVILY_API_KEY", "k1", "k2")])

    def test_cooling_keys_are_skipped_and_all_exhausted_returns_none(self):
        now = 1_800_000_000
        self.assertEqual(key_pool.rotate("TAVILY_API_KEY", "429", now=now)["to"], "k2")
        self.assertEqual(key_pool.rotate("TAVILY_API_KEY", "429", now=now + 60)["to"], "k3")
        self.assertIsNone(key_pool.rotate("TAVILY_API_KEY", "429", now=now + 120), "k1, k2 đang nghỉ → hết khoá")
        self.assertEqual(key_pool.rotate("TAVILY_API_KEY", "429", now=now + 3700)["to"], "k1", "hết thời gian nghỉ thì dùng lại")
        self.assertIsNone(key_pool.rotate("TAVILY_API_KEY", "429", now=now + 3710), "đổi dồn trong 30 giây chỉ một lần")

    def test_invalid_key_rests_one_day_quota_one_hour(self):
        now = 1_800_000_000
        key_pool.rotate("TAVILY_API_KEY", "401 Unauthorized", now=now)
        self.assertEqual(self.read_pool()["list"][0]["cool_until"], now + key_pool.COOL_INVALID_SECONDS)
        key_pool.rotate("TAVILY_API_KEY", "rate limit", now=now + 60)
        self.assertEqual(self.read_pool()["list"][1]["cool_until"], now + 60 + key_pool.COOL_QUOTA_SECONDS)

    def test_no_key_error_or_no_pool_leaves_result_alone(self):
        self.assertIsNone(key_pool.on_tool_result(tool_name="web_search", result='{"results": []}'))
        self.assertIsNone(key_pool.on_tool_result(tool_name="terminal", result="Apify error 402 payment required"), "Apify chưa có kho ≥ 2 khoá")
        self.assertIsNone(key_pool.on_tool_result(tool_name="read_file", result="File not found (429 lines)"), "không nêu dịch vụ, công cụ không gắn khoá")
        self.assertEqual(os.environ["TAVILY_API_KEY"], K1)

    def test_tool_name_fallback_when_error_does_not_name_the_service(self):
        out = key_pool.on_tool_result(tool_name="web_extract", result="HTTP 429 Too Many Requests")
        self.assertIn("gọi lại", out)
        self.assertEqual(os.environ["TAVILY_API_KEY"], K2)


if __name__ == "__main__":
    unittest.main()
