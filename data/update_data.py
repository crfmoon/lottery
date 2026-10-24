# -*- coding: utf-8 -*-
"""
一键更新大乐透数据并刷新网站。
步骤：1) 抓取官网最新全量开奖数据 -> data/dlt_history.csv(.xlsx)
      2) 重新生成 docs/data.js（网站加载的静态数据）
运行：python update_data.py
时机：大乐透每周一、三、六晚开奖，开奖当晚或次日跑一次即可。
注意：脚本会清空失效的本地代理环境变量后直连官网（见 gather_dlt.py）。
"""
import subprocess
import sys
import os
import json
from datetime import datetime, timezone, timedelta

base = os.path.dirname(os.path.abspath(__file__))


def step(name):
    print("\n===== 运行 {} =====".format(name))
    subprocess.run([sys.executable, os.path.join(base, name)], check=True)


def main():
    status = {"checked_at": datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")}
    try:
        step("gather_dlt.py")
        step("gen_data.py")
        status["ok"] = True
    except Exception:
        status["ok"] = False
        raise
    finally:
        path = os.path.join(base, "..", "docs", "update-status.json")
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(status, f, ensure_ascii=False)
        os.replace(path + ".tmp", path)
    print("\n>>> 更新完成。在浏览器刷新网站即可看到最新数据"
          "（若用本地服务器，请按 Ctrl+F5 强制刷新）。")


if __name__ == "__main__":
    main()
