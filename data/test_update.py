import csv
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gather = _load("gather", "gather_dlt.py")
import_official_json = _load("import_official_json", "import_official_json.py")
update_data = _load("update_data", "update_data.py")


def official_item(issue="26121", day="2026-10-24", result="01 02 03 04 05 06 07",
                  sale="100", pool="200"):
    """构造官方接口单条记录。"""
    return {"lotteryDrawNum": issue, "lotteryDrawTime": day, "lotteryDrawResult": result,
            "totalSaleAmount": sale, "poolBalanceAfterdraw": pool, "prizeLevelList": []}


def csv_row(issue, day, front, back=(6, 7)):
    """构造合法 CSV 行（用于预置本地历史）。"""
    row = {k: "" for k in gather.FIELDS}
    row.update({"期号": issue, "开奖日期": day,
                "开奖结果(原始)": " ".join(f"{n:02d}" for n in list(front) + list(back))})
    for i, n in enumerate(front, 1):
        row[f"前区{i}"] = str(n)
    for i, n in enumerate(back, 1):
        row[f"后区{i}"] = str(n)
    for _g, name in gather.PRIZE_GROUPS:
        row[f"{name}注数"] = "0"
    return row


class FetchTests(unittest.TestCase):
    def test_waf_blocked_fails_fast_without_retry(self):
        with patch.object(gather, "http_get", return_value=(567, b"<html>blocked</html>")) as mocked, \
             patch.object(gather.time, "sleep") as slept:
            with self.assertRaises(gather.WafBlockedError) as ctx:
                gather.fetch_page(1)
        self.assertEqual(mocked.call_count, 1)
        self.assertEqual(ctx.exception.status, 567)
        self.assertTrue(ctx.exception.hint)
        slept.assert_not_called()

    def test_network_error_retries_then_raises(self):
        with patch.object(gather, "http_get", return_value=(503, b"busy")) as mocked, \
             patch.object(gather.time, "sleep"):
            with self.assertRaises(gather.FetchError):
                gather.fetch_page(1)
        self.assertEqual(mocked.call_count, gather.MAX_RETRIES + 1)

    def test_first_page_covers_local_issue_stops_paging(self):
        with tempfile.TemporaryDirectory() as folder:
            csv_path = Path(folder) / "dlt_history.csv"
            rows = [csv_row(f"261{n:02d}", f"2026-10-0{n}", (1, 2, 3, 4, 5))
                    for n in range(1, 6)]
            with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=gather.FIELDS)
                writer.writeheader()
                writer.writerows(rows)
            page1 = [official_item(f"261{n:02d}", f"2026-10-0{n}") for n in range(1, 7)]
            response = {"value": {"total": 6, "pages": 3, "list": list(reversed(page1))}}
            with patch.object(gather, "__file__", str(Path(folder) / "gather_dlt.py")), \
                 patch.object(gather, "fetch_page", return_value=response) as mocked, \
                 patch.object(gather.time, "sleep"):
                gather.main()
            self.assertEqual(mocked.call_count, 1)


class UpdateTests(unittest.TestCase):
    def test_same_issue_corrections_and_no_change(self):
        with tempfile.TemporaryDirectory() as folder:
            item = {"lotteryDrawNum": "26120", "lotteryDrawTime": "2026-10-21",
                    "lotteryDrawResult": "01 06 10 15 32 03 04",
                    "totalSaleAmount": "100", "poolBalanceAfterdraw": "200"}
            response = {"value": {"total": 1, "pages": 1, "list": [item]}}
            with patch.object(gather, "__file__", str(Path(folder) / "gather_dlt.py")), \
                 patch.object(gather, "fetch_page", return_value=response), \
                 patch.object(gather.time, "sleep"):
                gather.main()
                path = Path(folder) / "dlt_history.csv"
                item["totalSaleAmount"] = "150"
                gather.main()
                with path.open(encoding="utf-8-sig") as f:
                    self.assertEqual(next(csv.DictReader(f))["销售额"], "150.0")
                before = path.stat().st_mtime_ns
                gather.main()
                self.assertEqual(before, path.stat().st_mtime_ns)
                original = path.read_bytes()
                item["lotteryDrawResult"] = "01 01 10 15 32 03 04"
                with self.assertRaises(ValueError):
                    gather.main()
                self.assertEqual(original, path.read_bytes())

    def test_duplicate_and_empty_records(self):
        row = {"期号": "26120", "开奖日期": "2026-10-21",
               **{f"前区{i}": str(i) for i in range(1, 6)},
               "后区1": "1", "后区2": "2"}
        for records in ([], [row, row]):
            with self.assertRaises(ValueError):
                gather.validate_records(records)


class StatusTests(unittest.TestCase):
    def test_status_file_records_waf_error(self):
        waf_cls = update_data.gather_dlt.WafBlockedError
        with tempfile.TemporaryDirectory() as folder:
            status_path = Path(folder) / "update-status.json"
            with patch.object(update_data, "STATUS_PATH", str(status_path)), \
                 patch.object(update_data.gather_dlt, "main", side_effect=waf_cls(567)):
                with self.assertRaises(waf_cls):
                    update_data.main()
            data = json.loads(status_path.read_text(encoding="utf-8"))
        self.assertFalse(data["ok"])
        self.assertEqual(data["error"]["type"], "waf_blocked")
        self.assertEqual(data["error"]["http_status"], 567)
        self.assertTrue(data["error"]["hint"])
        self.assertIn("checked_at", data)


class ImportTests(unittest.TestCase):
    def test_import_matches_direct_pipeline(self):
        item = official_item()
        with tempfile.TemporaryDirectory() as folder:
            direct = Path(folder) / "direct"
            direct.mkdir()
            gather.merge_and_write([gather.to_row(item)], str(direct / "dlt_history.csv"),
                                   str(direct / "dlt_history.xlsx"))
            payload = Path(folder) / "resp.json"
            payload.write_text(json.dumps({"success": True, "value": {"list": [item]}}),
                               encoding="utf-8")
            imported = Path(folder) / "imported"
            imported.mkdir()
            with patch.object(import_official_json, "HERE", str(imported)):
                import_official_json.main(["import_official_json.py", str(payload)],
                                          render_web=False)
            self.assertEqual((direct / "dlt_history.csv").read_bytes(),
                             (imported / "dlt_history.csv").read_bytes())

    def test_import_rejects_invalid_numbers_without_overwrite(self):
        item = official_item(result="01 01 03 04 05 06 07")
        with tempfile.TemporaryDirectory() as folder:
            csv_path = Path(folder) / "dlt_history.csv"
            with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=gather.FIELDS)
                writer.writeheader()
                writer.writerows([csv_row("26120", "2026-10-21", (1, 2, 3, 4, 5))])
            original = csv_path.read_bytes()
            payload = Path(folder) / "bad.json"
            payload.write_text(json.dumps({"success": True, "value": {"list": [item]}}),
                               encoding="utf-8")
            with patch.object(import_official_json, "HERE", folder):
                with self.assertRaises(ValueError):
                    import_official_json.main(["import_official_json.py", str(payload)],
                                              render_web=False)
            self.assertEqual(original, csv_path.read_bytes())


if __name__ == "__main__":
    unittest.main()
