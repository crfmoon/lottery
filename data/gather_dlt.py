# -*- coding: utf-8 -*-
"""
抓取超级大乐透（gameNo=85）自开售以来全部历史开奖数据。
数据源：中国体彩官网内部接口 webapi.sporttery.cn（无 API Key，低频直连）。
输出：data/dlt_history.csv 与 data/dlt_history.xlsx

官方站点前置了腾讯云 EdgeOne 安全防护，请求可能被拦截（HTTP 567 / 403 或返回拦截页）。
被拦截时不再重试（重试只会加重风控），直接抛出 WafBlockedError，由 update_data.py 写进状态文件。

可选环境变量：
    SPORTTERY_COOKIE        浏览器里能正常访问官方接口时，把 Cookie 带进来复用
    SPORTTERY_PROXY         需要代理才能访问时的代理地址，如 http://127.0.0.1:7890
    SPORTTERY_MIN_INTERVAL  翻页间隔秒数（默认 1.5 秒，另加最多 0.5 秒随机抖动）
"""
import csv
import io
import json
import os
import random
import time
import urllib.error
import urllib.request
from datetime import date

# 1. 绕过失效的本地代理（否则所有外网请求都会失败）；需要代理请用 SPORTTERY_PROXY 显式指定
for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
    os.environ.pop(k, None)

API = ("https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry"
       "?gameNo=85&provinceId=0&pageSize=100&pageNo={page}&isVerify=1")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Referer": "https://www.lottery.gov.cn/kj/kjlb.html?dlt",
    "Origin": "https://www.lottery.gov.cn",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Connection": "keep-alive",
}

# 基础7个奖级（不含追加），group 编码 -> 列名
PRIZE_GROUPS = [
    ("101", "一等奖"), ("301", "二等奖"), ("501", "三等奖"),
    ("601", "四等奖"), ("701", "五等奖"), ("801", "六等奖"), ("901", "七等奖"),
]

FIELDS = ["期号", "开奖日期", "前区1", "前区2", "前区3", "前区4", "前区5",
          "后区1", "后区2", "开奖结果(原始)", "销售额", "奖池滚存"]
for _g, _name in PRIZE_GROUPS:
    FIELDS += [f"{_name}注数", f"{_name}单注奖金"]

# 站点安全策略拦截的响应码（腾讯云 EdgeOne 用 567 表示"请求已被安全策略拦截"）
WAF_STATUSES = (403, 567)
BLOCK_MARKERS = ("安全策略", "EdgeOne", "Access Restricted", "请求已被拦截", "Restricted Access")
MAX_RETRIES = 2          # 首次请求 + 最多 2 次重试
BACKOFF_BASE = 1.0       # 重试退避基数：1s、3s（另加抖动）
MIN_INTERVAL = 1.5       # 翻页最小间隔
WAF_HINT = ("官方站点（腾讯云 EdgeOne）拦截了本次请求。可换网络出口（如手机热点）后重试；"
            "或在浏览器能正常打开官方接口时，另存返回的 JSON 后运行 import_official_json.py 导入")


class FetchError(RuntimeError):
    """网络/接口层错误。retryable=False 表示重试没有意义。"""
    type = "network"

    def __init__(self, message, retryable=True):
        super().__init__(message)
        self.retryable = retryable


class WafBlockedError(FetchError):
    """官方站点安全策略拦截（HTTP 567/403 或返回 EdgeOne 拦截页）。"""
    type = "waf_blocked"

    def __init__(self, status=567, message=None):
        super().__init__(message or f"官方接口返回 HTTP {status}，请求被站点安全策略（EdgeOne）拦截",
                         retryable=False)
        self.status = status
        self.hint = WAF_HINT


_OPENER = None
_CURL_SESSION = None
_CURL_CHECKED = False


def _proxy_url():
    proxy = os.environ.get("SPORTTERY_PROXY", "").strip()
    return proxy or None


def _build_opener():
    global _OPENER
    if _OPENER is None:
        proxy = _proxy_url()
        handlers = [urllib.request.ProxyHandler({"http": proxy, "https": proxy})] if proxy \
            else [urllib.request.ProxyHandler({})]
        _OPENER = urllib.request.build_opener(*handlers)
    return _OPENER


def _curl_session():
    """可选依赖 curl_cffi：装了就用 Chrome TLS 指纹，没装回退标准库。"""
    global _CURL_SESSION, _CURL_CHECKED
    if not _CURL_CHECKED:
        _CURL_CHECKED = True
        try:
            from curl_cffi import requests as curl_requests
            _CURL_SESSION = curl_requests.Session(impersonate="chrome")
        except Exception:
            _CURL_SESSION = None
    return _CURL_SESSION


def http_get(url, headers, timeout=20):
    """返回 (status_code, body_bytes)；HTTP 错误码不抛异常，统一由调用方判断。"""
    session = _curl_session()
    if session is not None:
        proxy = _proxy_url()
        proxies = {"http": proxy, "https": proxy} if proxy else None
        r = session.get(url, headers=headers, timeout=timeout, proxies=proxies)
        return r.status_code, r.content
    req = urllib.request.Request(url, headers=headers)
    try:
        with _build_opener().open(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _decode_json(raw):
    try:
        return json.loads(raw.decode("utf-8-sig"))
    except UnicodeDecodeError:
        return json.loads(raw.decode("gbk"))


def _looks_blocked(raw):
    text = raw.decode("utf-8", "ignore")
    return any(m in text for m in BLOCK_MARKERS)


def _fetch_once(url, headers):
    try:
        status, raw = http_get(url, headers)
    except Exception as e:
        # 超时、连接重置、DNS 失败等，可重试
        raise FetchError(f"网络请求失败：{e}") from e
    if status in WAF_STATUSES or _looks_blocked(raw):
        raise WafBlockedError(status)
    if status == 429:
        raise FetchError("官方接口返回 HTTP 429（请求过于频繁）")
    if 400 <= status < 500:
        raise FetchError(f"官方接口返回 HTTP {status}", retryable=False)
    if status >= 500:
        # 服务端临时故障，值得退避重试
        raise FetchError(f"官方接口返回 HTTP {status}")
    try:
        data = _decode_json(raw)
    except Exception as e:
        raise FetchError("官方接口返回内容无法解析为 JSON", retryable=False) from e
    if not data.get("success") or not data.get("value", {}).get("list"):
        raise FetchError("官方接口返回失败或空数据", retryable=False)
    return data


def fetch_page(page):
    """拉取一页。被 WAF 拦截时立即失败不重试；网络抖动/5xx 指数退避重试。"""
    url = API.format(page=page)
    headers = dict(HEADERS)
    cookie = os.environ.get("SPORTTERY_COOKIE", "").strip()
    if cookie:
        headers["Cookie"] = cookie
    for attempt in range(MAX_RETRIES + 1):
        try:
            return _fetch_once(url, headers)
        except WafBlockedError:
            raise
        except FetchError as e:
            if not e.retryable or attempt == MAX_RETRIES:
                raise
            time.sleep(BACKOFF_BASE * (3 ** attempt) + random.uniform(0, 0.3))


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


def to_row(it):
    """官方接口单条记录 -> CSV 行。"""
    res = it.get("lotteryDrawResult", "")
    nums = res.split()
    if len(nums) != 7:
        raise ValueError(f"开奖号码数量无效：{it.get('lotteryDrawNum')}")
    front = nums[:5]
    back = nums[5:7]
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
    return row


def _read_rows(csv_path):
    if not os.path.exists(csv_path):
        return []
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def latest_local(csv_path=None):
    """读取本地 CSV 中最新一期期号（CSV 按日期升序，末行为最新）。"""
    if csv_path is None:
        csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dlt_history.csv")
    rows = _read_rows(csv_path)
    if not rows:
        return None
    return rows[-1]["期号"].strip()


def _page_interval():
    try:
        base = float(os.environ.get("SPORTTERY_MIN_INTERVAL", MIN_INTERVAL))
    except ValueError:
        base = MIN_INTERVAL
    return max(0.5, base) + random.uniform(0, 0.5)


def merge_and_write(records, csv_path, xlsx_path=None):
    """合并旧数据 -> 排序 -> 校验 -> 写 CSV/Excel。内容没变则保留原文件并返回 changed=False。"""
    validate_records(records)
    previous = _read_rows(csv_path)
    merged = {r["期号"]: r for r in previous}
    for row in records:
        old = merged.get(row["期号"], {})
        # 官方暂缺的金额不要覆盖已入库的完整值。
        merged[row["期号"]] = {k: old.get(k, "") if v == "" else v for k, v in row.items()}
    records = sorted(merged.values(), key=lambda r: (r["开奖日期"], r["期号"]))
    validate_records(records)

    output = io.StringIO(newline="")
    w = csv.DictWriter(output, fieldnames=FIELDS)
    w.writeheader()
    w.writerows(records)
    content = output.getvalue().encode("utf-8-sig")
    if os.path.exists(csv_path):
        with open(csv_path, "rb") as f:
            if f.read() == content:
                print("SKIP_NO_NEW")
                return records, False
    temporary = csv_path + ".tmp"
    with open(temporary, "wb") as f:
        f.write(content)
    os.replace(temporary, csv_path)
    print(f">>> 已写出 CSV: {csv_path}")

    if xlsx_path is None:
        xlsx_path = os.path.join(os.path.dirname(csv_path), "dlt_history.xlsx")
    _write_excel(records, xlsx_path)
    return records, True


def _write_excel(records, xlsx_path):
    try:
        from openpyxl import Workbook
    except ImportError:
        print(">>> 未安装 openpyxl，跳过 Excel 输出（CSV 已可用，可直接用 Excel 打开）。")
        return
    try:
        wb = Workbook()
        ws = wb.active
        ws.title = "大乐透历史"
        ws.append(FIELDS)
        for r in records:
            ws.append([r.get(c, "") for c in FIELDS])
        wb.save(xlsx_path)
        print(f">>> 已写出 Excel: {xlsx_path}")
    except Exception as e:
        print(f">>> 写出 Excel 失败（已忽略，不影响网站用 CSV）：{e}")


def main():
    print(">>> 获取总页数 ...")
    first = fetch_page(1)
    total = first["value"]["total"]
    pages = first["value"]["pages"]
    lst = first["value"].get("list", [])
    remote_latest = max((it.get("lotteryDrawNum", "") for it in lst), default="")
    base = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(base, "dlt_history.csv")
    xlsx_path = os.path.join(base, "dlt_history.xlsx")
    local = latest_local(csv_path)
    if local and remote_latest and remote_latest < local:
        raise ValueError("官方接口最新期号落后于本地，保留现有数据")
    previous = _read_rows(csv_path)
    # 至少回查最近五期；断更较久时才继续翻页。
    cutoff = previous[-5]["期号"] if len(previous) >= 5 else None
    print(f"    总记录数={total}, 总页数={pages}")

    interval = _page_interval()
    records = []
    page = 1
    while True:
        data = first if page == 1 else fetch_page(page)
        for it in data["value"].get("list", []):
            records.append(to_row(it))
        print(f"    已抓第 {page}/{pages} 页，累计 {len(records)} 条")
        if cutoff is None:
            # 首次初始化：全量抓完
            if page >= pages:
                break
        elif any(r["期号"] <= cutoff for r in records):
            # 已经覆盖本地倒数第五期，无需继续翻页
            break
        page += 1
        if page > pages:
            break
        time.sleep(interval)

    records, changed = merge_and_write(records, csv_path, xlsx_path)
    print(f">>> 共抓取 {len(records)} 条，最早={records[0]['期号']}({records[0]['开奖日期']}) "
          f"最新={records[-1]['期号']}({records[-1]['开奖日期']})")
    return changed


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
