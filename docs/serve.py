# -*- coding: utf-8 -*-
"""
本地网站服务 + 自动更新接口。
启动：python serve.py  然后浏览器访问 http://localhost:8000
- 打开网页时，前端会自动请求 /api/update：
    后端抓取体彩官网最新数据并重新生成 data.js；
    若无新期则秒回（只比对最新一期），不会每次全量抓取。
- 静态文件（index.html / data.js / app.js / echarts.min.js）由本服务一并托管。
仅用于本机访问，请勿暴露到公网。
"""
import http.server
import json
import os
import socketserver
import subprocess
import sys
from urllib.parse import urlparse

WEB = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.path.join(WEB, "..", "data"))


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        p = urlparse(self.path).path
        if p == "/api/update":
            self.handle_update()
            return
        super().do_GET()

    def handle_update(self):
        try:
            py = sys.executable
            r1 = subprocess.run([py, os.path.join(DATA_DIR, "update_data.py")],
                                capture_output=True, text=True, cwd=DATA_DIR)
            changed = "SKIP_NO_NEW" not in r1.stdout
            if r1.returncode != 0:
                self.send_json(500, {"ok": False, "error": r1.stderr[-500:]})
                return
            self.send_json(200, {"ok": True, "changed": changed})
        except Exception as e:
            self.send_json(500, {"ok": False, "error": str(e)})

    def send_json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def end_headers(self):
        # 禁止缓存，确保更新后前端能立刻拿到新文件
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass  # 静默静态请求日志


if __name__ == "__main__":
    port = 8000
    os.chdir(WEB)
    with socketserver.TCPServer(("", port), Handler) as httpd:
        print(f"大乐透网站已启动： http://localhost:{port}")
        print("（Ctrl+C 停止；打开网页会自动检查并更新数据）")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止。")
