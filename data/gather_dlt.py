# -*- coding: utf-8 -*-
"""
抓取超级大乐透（gameNo=85）自开售以来全部历史开奖数据。
数据源：中国体彩官网内部接口 webapi.sporttery.cn（无 API Key，低频直连）。
输出：data/dlt_history.csv 与 data/dlt_history.xlsx
"""
import csv
import json
import os
import time
import urllib.request
import io
from datetime import date

# 1. 绕过失效的本地代理（否则所有外网请求都会失败）
for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
    os.environ.pop(k, None)

API = ("https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry"
       "?gameNo=85&provinceId=0&pageSize=100&pageNo={page}&isVerify=1")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Referer": "https://www.lottery.gov.cn/kj/kjlb.html?dlt",
    "Accept": "application/json, text/plain, */*",
}

# 基础7个奖级（不含追加），group 编码 -> 列名
PRIZE_GROUPS = [
    ("101", "一等奖"), ("301", "二等奖"), ("501", "三等奖"),
    ("601", "四等奖"), ("701", "五等奖"), ("801", "六等奖"), ("901", "七等奖"),
]


def fetch_page(page):
    url = API.format(page=page)
    req = urllib.request.Request(url, headers=HEADERS)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read()
            try:
                data = json.loads(raw.decode("utf-8-sig"))
            except UnicodeDecodeError:
                data = json.loads(raw.decode("gbk"))
            if not data.get("success") or not data.get("value", {}).get("list"):
                raise ValueError("官方接口返回失败或空数据")
            return data
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(1.5)


def to_num(v):
    """去千分位逗号转数值；空或 '---' 返回空串。"""
    if v in (None, "", "---"):
        return ""
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return ""


def parse_prize(prize_list):
    """返回 {group: (stakeCount, stakeAmount)}，金额已转数值。"""
    out = {}
    for p in prize_list:
        g = p.get("group")
        cnt = p.get("stakeCount", "0") or "0"
        amt = p.get("stakeAmount", "") or ""
        try:
            cnt = int(str(cnt).replace(",", ""))
        except ValueError:
            cnt = 0
        out[g] = (cnt, to_num(amt))
    return out


def latest_local():
    """读取本地 CSV 中最新一期期号（CSV 按日期升序，末行为最新）。"""
    csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dlt_history.csv")
    if not os.path.exists(csv_path):
        return None
    import csv as _csv
    with open(csv_path, encoding="utf-8-sig") as f:
        rows = list(_csv.reader(f))
    if len(rows) < 2:
        return None
    return rows[-1][0].strip()


def main():
    print(">>> 获取总页数 ...")
    first = fetch_page(1)
    total = first["value"]["total"]
    pages = first["value"]["pages"]
    lst = first["value"].get("list", [])
    remote_latest = max((it.get("lotteryDrawNum", "") for it in lst), default="")
    local = latest_local()
    base = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(base, "dlt_history.csv")
    previous = []
    if os.path.exists(csv_path):
        with open(csv_path, encoding="utf-8-sig", newline="") as f:
            previous = list(csv.DictReader(f))
    # 至少回查最近五期；断更较久时继续翻页，直到覆盖本地最新五期。
    cutoff = previous[-5]["期号"] if len(previous) >= 5 else None
    if local and remote_latest < local:
        raise ValueError("官方接口最新期号落后于本地，保留现有数据")
    print(f"    总记录数={total}, 总页数={pages}")

    records = []
    for page in range(1, pages + 1):
        data = fetch_page(page) if page > 1 else first
        lst = data["value"].get("list", [])
        for it in lst:
            res = it.get("lotteryDrawResult", "")
            nums = res.split()
            if len(nums) != 7:
                raise ValueError(f"开奖号码数量无效：{it.get('lotteryDrawNum')}")
            front = nums[:5]
            back = nums[5:7] if len(nums) >= 7 else []
            prize = parse_prize(it.get("prizeLevelList", []))

            def sale(v):
                try:
                    return float(str(v).replace(",", "")) if v else ""
                except ValueError:
                    return ""

            row = {
                "期号": it.get("lotteryDrawNum", ""),
                "开奖日期": it.get("lotteryDrawTime", ""),
                "前区1": front[0] if len(front) > 0 else "",
                "前区2": front[1] if len(front) > 1 else "",
                "前区3": front[2] if len(front) > 2 else "",
                "前区4": front[3] if len(front) > 3 else "",
                "前区5": front[4] if len(front) > 4 else "",
                "后区1": back[0] if len(back) > 0 else "",
                "后区2": back[1] if len(back) > 1 else "",
                "开奖结果(原始)": res,
                "销售额": sale(it.get("totalSaleAmount")),
                "奖池滚存": sale(it.get("poolBalanceAfterdraw")),
            }
            for g, name in PRIZE_GROUPS:
                cnt, amt = prize.get(g, (0, ""))
                row[f"{name}注数"] = cnt
                row[f"{name}单注奖金"] = amt
            records.append(row)
        print(f"    已抓第 {page}/{pages} 页，累计 {len(records)} 条")
        if cutoff and any(r["期号"] <= cutoff for r in records):
            break
        time.sleep(0.4)

    # 按开奖日期升序（最早 -> 最新）
    validate_records(records)
    merged = {r["期号"]: r for r in previous}
    for row in records:
        old = merged.get(row["期号"], {})
        # 官方暂缺的金额不要覆盖已入库的完整值。
        merged[row["期号"]] = {k: old.get(k, "") if v == "" else v for k, v in row.items()}
    records = sorted(merged.values(), key=lambda r: (r["开奖日期"], r["期号"]))
    validate_records(records)
    print(f">>> 共抓取 {len(records)} 条，最早={records[0]['期号']}({records[0]['开奖日期']}) "
          f"最新={records[-1]['期号']}({records[-1]['开奖日期']})")

    # 列顺序
    fields = ["期号", "开奖日期", "前区1", "前区2", "前区3", "前区4", "前区5",
              "后区1", "后区2", "开奖结果(原始)", "销售额", "奖池滚存"]
    for g, name in PRIZE_GROUPS:
        fields += [f"{name}注数", f"{name}单注奖金"]

    base = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(base, "dlt_history.csv")
    output = io.StringIO(newline="")
    w = csv.DictWriter(output, fieldnames=fields)
    w.writeheader()
    w.writerows(records)
    content = output.getvalue().encode("utf-8-sig")
    if os.path.exists(csv_path):
        with open(csv_path, "rb") as f:
            if f.read() == content:
                print("SKIP_NO_NEW")
                return
    temporary = csv_path + ".tmp"
    with open(temporary, "wb") as f:
        f.write(content)
    os.replace(temporary, csv_path)
    print(f">>> 已写出 CSV: {csv_path}")

    # 尝试写出 Excel
    try:
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "大乐透历史"
        ws.append(fields)
        for r in records:
            ws.append([r.get(c, "") for c in fields])
        xlsx_path = os.path.join(base, "dlt_history.xlsx")
        wb.save(xlsx_path)
        print(f">>> 已写出 Excel: {xlsx_path}")
    except ImportError:
        print(">>> 未安装 openpyxl，跳过 Excel 输出（CSV 已可用，可直接用 Excel 打开）。")
    except Exception as e:
        print(f">>> 写出 Excel 失败（已忽略，不影响网站用 CSV）：{e}")


def validate_records(records):
    if not records:
        raise ValueError("没有有效开奖数据")
    seen = set()
    for row in records:
        issue = row["期号"]
        if not issue.isdigit() or len(issue) != 5 or issue in seen:
            raise ValueError(f"期号无效或重复：{issue}")
        seen.add(issue)
        date.fromisoformat(row["开奖日期"])
        for zone, count, upper in (("前区", 5, 35), ("后区", 2, 12)):
            nums = [int(row[f"{zone}{i}"]) for i in range(1, count + 1)]
            if len(set(nums)) != count or any(n < 1 or n > upper for n in nums):
                raise ValueError(f"{issue} {zone}号码无效")


if __name__ == "__main__":
    main()
