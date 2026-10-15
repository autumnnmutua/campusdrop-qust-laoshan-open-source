# 第三方组件说明

本项目在浏览器端截图识别功能中自托管以下开源组件。构建时由 `scripts/ocr-assets.mjs` 从 `node_modules` 复制到站点的 `/ocr/<版本>/` 目录，并附带各自的许可证文件。

| 组件 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| [tesseract.js](https://github.com/naptha/tesseract.js) | 7.0.0 | Apache-2.0 | 浏览器端 OCR 识别线程与接口 |
| [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 7.0.0 | Apache-2.0 | Tesseract OCR 引擎的 WebAssembly 版本 |
| [@tesseract.js-data/eng](https://www.npmjs.com/package/@tesseract.js-data/eng) | 1.0.0 | MIT（npm 包标注） | 英文与数字识别模型（`4.0.0_best_int/eng.traineddata.gz`） |

其余运行时依赖见 `package.json`。
