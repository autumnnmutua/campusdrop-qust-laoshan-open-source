# 第三方组件说明

本项目在浏览器端截图识别功能中自托管以下开源组件。构建时由 `scripts/ocr-assets.mjs` 从 `node_modules` 复制到站点的 `/ocr/<版本>/` 目录，并附带各自的许可证文件。

| 组件 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| [tesseract.js](https://github.com/naptha/tesseract.js) | 7.0.0 | Apache-2.0 | 浏览器端 OCR 识别线程与接口 |
| [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 7.0.0 | Apache-2.0 | Tesseract OCR 引擎的 WebAssembly 版本 |
| [@tesseract.js-data/eng](https://www.npmjs.com/package/@tesseract.js-data/eng) | 1.0.0 | MIT（npm 包标注） | 英文与数字识别模型（`4.0.0_best_int/eng.traineddata.gz`） |

## 字体

站点自托管以下字体（子集化后放在 `src/client/fonts/`，构建时打包进站点资源，不从外部字体服务加载）：

| 字体 | 许可证 | 用途 |
| --- | --- | --- |
| [Newsreader](https://github.com/productiontype/Newsreader)（Production Type） | SIL Open Font License 1.1，全文见 `src/client/fonts/OFL-Newsreader.txt` | 英文、数字与金额的显示字体（正体与斜体） |

## 数据

| 数据 | 许可证 | 用途 |
| --- | --- | --- |
| [Open-Meteo](https://open-meteo.com/) 天气预报接口（`api.open-meteo.com`） | 数据按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 授权；免费接口仅限非商业用途，每天少于 1 万次调用（见 [Open-Meteo 使用条款](https://open-meteo.com/en/terms)） | v3.0 天气联动：Worker 每 30 分钟读取一次校园位置的实时天气，并归类为“正常 / 雨雪 / 恶劣”。显示天气观测的页面均注明“天气数据：Open-Meteo.com”并链接许可证。若本站转为商业运营，需要改用 Open-Meteo 的付费接口或其他数据源 |

## 在线服务（可选）

| 服务 | 说明 |
| --- | --- |
| 大模型服务（默认：[阿里云百炼](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope) 的通义千问，OpenAI 兼容接口） | v3.5 智能助手与 AI 运营小结；v3.6 一句话下单（工具调用）与截图识别兜底（默认视觉模型 `qwen3-vl-plus`）。只有运营方设置 `AI_API_KEY` 后才会调用；调用内容与费用受该服务的条款约束。文字请求不含姓名、电话、房间号、取件码、收货码和备注；截图只在同学主动选择后发送且不保存。未设置时这些功能只在本站按规则处理 |

## 地图

校园地图底图为青岛科技大学崂山校区官方平面图（2012 年版）。v3.5 根据项目方提供的信息，把图上标注“待建”的建筑改为建成（去掉“待建”字样），并在图上标出南苑十号楼对面站点的示意位置；路线、楼栋热区和站点标记为本项目绘制。

其余运行时依赖见 `package.json`。
