# -*- coding: utf-8 -*-
"""把 dlt_history.csv 转换为网站用的 data.js（window.DLT_DATA / window.DLT_META）。"""
import csv
import json
import os
import re
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))   # 本文件所在目录（data/）
base = os.path.dirname(HERE)                          # 项目根（data 的上一级）
data_dir = HERE
web_dir = os.path.join(base, "docs")
os.makedirs(web_dir, exist_ok=True)

rows = []
with open(os.path.join(data_dir, "dlt_history.csv"), encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        def gi(k):
            v = (r.get(k) or "").strip()
            return int(v) if v.isdigit() else None
        front = [gi(f"前区{i}") for i in range(1, 6)]
        back = [gi(f"后区{i}") for i in range(1, 3)]
        sale = (r.get("销售额") or "").strip()
        pool = (r.get("奖池滚存") or "").strip()
        rows.append({
            "issue": r["期号"],
            "date": r["开奖日期"],
            "front": front,
            "back": back,
            "sale": float(sale) if sale else None,
            "pool": float(pool) if pool else None,
        })

meta = {"count": len(rows), "first": rows[0]["issue"], "last": rows[-1]["issue"],
        "updated": datetime.now().strftime("%Y-%m-%d %H:%M")}
out = "// 自动生成，请勿手改。来源：中国体彩官网历史开奖接口\n"
out += "window.DLT_META = " + json.dumps(meta, ensure_ascii=False) + ";\n"
out += "window.DLT_DATA = " + json.dumps(rows, ensure_ascii=False) + ";\n"
data_js = os.path.join(web_dir, "data.js")
with open(data_js, "w", encoding="utf-8") as f:
    f.write(out)
# 给 index.html 里 data.js 的引用加版本号，避免浏览器缓存旧数据
idx = os.path.join(web_dir, "index.html")
if os.path.exists(idx):
    ts = int(datetime.now().timestamp())
    html = open(idx, encoding="utf-8").read()
    html2 = re.sub(r'src="data\.js(?:\?v=\d+)?"', 'src="data.js?v=%d"' % ts, html)
    if html2 != html:
        open(idx, "w", encoding="utf-8").write(html2)
print("生成", len(rows), "条 ->", data_js,
      "大小约", round(os.path.getsize(data_js) / 1024), "KB")
