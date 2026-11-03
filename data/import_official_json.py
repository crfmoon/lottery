# -*- coding: utf-8 -*-
"""
导入官方接口返回的 JSON —— 出口 IP 被 EdgeOne 拦截时的兜底通道。

用法：
    1. 在能正常访问的浏览器里打开：
       https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=85&provinceId=0&pageSize=100&pageNo=1&isVerify=1
    2. Ctrl+S 另存为 JSON（或新建文本文件粘贴返回内容），保存到本机
    3. 运行：
       python import_official_json.py 保存的文件.json [更多文件.json ...]

数据全程只来自官方接口，导入时与直连抓取共用同一套解析、合并、校验逻辑；
期号 / 日期 / 号码非法会直接报错且不覆盖原有 CSV。
"""
import json
import os
import subprocess
import sys

from gather_dlt import merge_and_write, to_row

HERE = os.path.dirname(os.path.abspath(__file__))


def load_items(path):
    """读取官方返回体，返回开奖记录 list。支持完整响应体或裸数组。"""
    if path == "-":
        raw = sys.stdin.read()
    else:
        with open(path, encoding="utf-8-sig") as f:
            raw = f.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"{path} 不是合法 JSON：{e}")
    if isinstance(data, list):
        return data
    if not data.get("success") or not data.get("value", {}).get("list"):
        raise ValueError(f"{path} 不是有效的官方开奖响应（success=false 或缺少 value.list）")
    return data["value"]["list"]


def main(argv=None, render_web=True):
    argv = list(sys.argv if argv is None else argv)
    paths = [p for p in argv[1:] if p]
    if not paths:
        print("用法：python import_official_json.py 官方返回体.json [更多.json ...]")
        return 2
    items = []
    for path in paths:
        loaded = load_items(path)
        print(f">>> {path}: {len(loaded)} 条")
        items.extend(loaded)
    rows = [to_row(it) for it in items]
    csv_path = os.path.join(HERE, "dlt_history.csv")
    xlsx_path = os.path.join(HERE, "dlt_history.xlsx")
    records, changed = merge_and_write(rows, csv_path, xlsx_path)
    print(f">>> 共 {len(records)} 条，最早={records[0]['期号']}({records[0]['开奖日期']}) "
          f"最新={records[-1]['期号']}({records[-1]['开奖日期']})")
    if not changed:
        print(">>> 数据没有变化，跳过网页数据重建")
        return 0
    if render_web:
        subprocess.run([sys.executable, os.path.join(HERE, "gen_data.py")], check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
