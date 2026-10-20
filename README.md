# 大乐透历史数据分析

一个纯前端的大乐透（超级大乐透，gameNo=85）历史数据分析网站。数据来自中国体彩官网历史开奖接口，全部在浏览器本地渲染，无后端数据库。

## 功能

- **总览**：总期数、起止期、最新开奖号码、最大销售额/奖池
- **号码走势**：传统彩票走势表（每期一行、号码为列、显示遗漏；1/2/3 分区；30 期一组翻页）；可切「走势线」视图
- **和值 / 012路 / 奇偶大小 / 重号**：数字连线走势表（30 期一组翻页）+ 历史分布图
- **遗漏冷热**、**奖池/销售额**走势
- 遗漏表数字连线（每个号码列把开出点纵向串起）

## 目录结构

```
.
├── data/                  # 数据抓取与生成脚本
│   ├── gather_dlt.py      # 抓取体彩官网历史开奖 -> dlt_history.csv(.xlsx)
│   ├── gen_data.py        # CSV -> ../dlt-web/data.js（网站加载的数据）
│   ├── update_data.py     # 一键更新：抓取 + 生成
│   └── update.bat         # Windows 双击更新
└── dlt-web/               # 网站（静态）
    ├── index.html
    ├── app.js
    ├── data.js            # ★ 网站实际加载的数据（window.DLT_DATA）
    ├── echarts.min.js     # 本地图表库
    ├── serve.py           # 本地后端：托管网页 + 打开即更新接口
    └── 启动网站.bat        # Windows 双击启动
```

## 本地运行

方式一（推荐，打开即更新数据）：
> 双击 `dlt-web/启动网站.bat`，自动起服务并打开 `http://localhost:8000`。
> 打开网页时后端会自动检查/拉取最新开奖数据（无新期则秒回）。

方式二（手动起服务）：
```bash
cd dlt-web
python serve.py
# 浏览器访问 http://localhost:8000
```

方式三（纯静态，不自动更新）：
直接双击 `dlt-web/index.html` 用浏览器打开，使用的是当前 `data.js` 已有数据。

## 更新数据

大乐透每周一、三、六晚开奖，开奖后更新一次即可：
```bash
cd data
python update_data.py      # = gather_dlt.py + gen_data.py
```
或双击 `data/update.bat`。`gen_data.py` 会顺带给 `index.html` 里 `data.js` 的引用加版本号，避免浏览器缓存旧数据。

## 部署到公网

### 纯静态（GitHub Pages / Vercel / Nginx 等）
只需部署 `dlt-web/` 下的 4 个前端文件（`index.html`、`app.js`、`data.js`、`echarts.min.js`）。
部署后「打开即更新」功能不可用（无后端），需重新生成 `data.js` 再发布。

- **Vercel**：导入仓库，本仓库已含 `vercel.json`（输出目录 `dlt-web`），直接 Deploy。
- **GitHub Pages + 自动更新**：开启 Pages（Source 选 `main` 分支、目录 `/dlt-web`）；本仓库已含
  `.github/workflows/update.yml`，会在每周一/三/六自动抓取数据并提交，Pages 随之自动更新，**完全免服务器**。
  （注：抓取脚本从 GitHub 境外 runner 访问国内体彩接口可能偏慢，若失败可改为本地跑 `update_data.py` 后 push。）

### 带后端（VPS）
在云服务器用 Gunicorn + Nginx 托管 `serve.py`，并把「打开即更新」改为服务端定时更新 + 限流 + HTTPS，适合对外提供服务。

## 合规声明

数据来源于中国体彩官网公开历史开奖接口，仅用于个人娱乐与研究参考；历史统计不能预测未来开奖。
公网大规模提供请注意官网接口使用条款及频率限制。
