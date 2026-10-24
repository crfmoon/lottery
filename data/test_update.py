import csv
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("gather", Path(__file__).with_name("gather_dlt.py"))
gather = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gather)


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


if __name__ == "__main__":
    unittest.main()
