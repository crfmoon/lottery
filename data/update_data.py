# -*- coding: utf-8 -*-
"""
一键更新大乐透数据并刷新网站。
步骤：1) 抓取官网最新开奖数据 -> data/dlt_history.csv(.xlsx)
      2) 重新生成 docs/data.js（网站加载的静态数据）
运行：python update_data.py
时机：大乐透每周一、三、六晚开奖，开奖当晚或次日跑一次即可。
注意：脚本会清空失效的本地代理环境变量后直连官网（见 gather_dlt.py）。

无论成功失败，都会把结果写进 docs/update-status.json：
    {"checked_at": "...", "ok": true}
    {"checked_at": "...", "ok": false, "error": {"type": "waf_blocked", "http_status": 567, ...}}
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone, timedelta

base = os.path.dirname(os.path.abspath(__file__))
if base not in sys.path:
    sys.path.insert(0, base)

import gather_dlt  # noqa: E402  （导入时顺带清空失效的代理环境变量）

STATUS_PATH = os.path.join(os.path.normpath(os.path.join(base, "..")), "docs", "update-status.json")


def _write_status(status):
    os.makedirs(os.path.dirname(STATUS_PATH), exist_ok=True)
    with open(STATUS_PATH + ".tmp", "w", encoding="utf-8") as f:
        json.dump(status, f, ensure_ascii=False)
    os.replace(STATUS_PATH + ".tmp", STATUS_PATH)


def main():
    status = {"checked_at": datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")}
    try:
        print("\n===== 抓取官方开奖数据 =====")
        gather_dlt.main()
        print("\n===== 生成网站数据 =====")
        subprocess.run([sys.executable, os.path.join(base, "gen_data.py")], check=True)
        status["ok"] = True
    except gather_dlt.WafBlockedError as e:
        status["ok"] = False
        status["error"] = {"type": "waf_blocked", "http_status": e.status,
                           "message": str(e), "hint": e.hint}
        raise
    except gather_dlt.FetchError as e:
        status["ok"] = False
        status["error"] = {"type": "network", "message": str(e),
                           "hint": "检查网络，或设置 SPORTTERY_PROXY 后重试"}
        raise
    except subprocess.CalledProcessError as e:
        status["ok"] = False
        status["error"] = {"type": "render_failed",
                           "message": f"gen_data.py 退出码 {e.returncode}",
                           "hint": "查看终端输出定位 data.js 生成失败原因"}
        raise
    except ValueError as e:
        status["ok"] = False
        status["error"] = {"type": "invalid_data", "message": str(e)[:300],
                           "hint": "官方数据校验未通过，已保留原有 CSV"}
        raise
    except Exception as e:
        status["ok"] = False
        status["error"] = {"type": "unknown", "message": str(e)[:300]}
        raise
    finally:
        try:
            status["last_issue"] = gather_dlt.latest_local(os.path.join(base, "dlt_history.csv"))
        except Exception:
            status["last_issue"] = None
        _write_status(status)
    print("\n>>> 更新完成。在浏览器刷新网站即可看到最新数据"
          "（若用本地服务器，请按 Ctrl+F5 强制刷新）。")


if __name__ == "__main__":
    main()
