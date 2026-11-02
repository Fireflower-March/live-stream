# 第三方代码与素材说明

项目自身代码的许可见 [LICENSE](LICENSE)。本文件记录仓库中可核实的第三方代码信息与现有素材来源，不替换各组件的许可。

## Three.js

随附文件：

- `assets/three.module.js`：本地 `REVISION` 为 `170`；原文件头部保留 `Copyright 2010-2024 Three.js Authors` 和 `SPDX-License-Identifier: MIT`。
- `assets/OrbitControls.js`：Three.js 的相机控制辅助模块。
- `assets/Reflector.js`：Three.js 的反射辅助模块。

上游项目：[Three.js](https://github.com/mrdoob/three.js)。主库对应版本的许可：[r170 LICENSE](https://github.com/mrdoob/three.js/blob/r170/LICENSE)。上述文件中的原有版权与许可声明保持保留。

```text
The MIT License

Copyright © 2010-2024 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## 安装时获取的依赖

Python 桌面依赖通过 `requirements.txt` 安装，Node.js 与 WebView2 Runtime 由运行环境提供。它们的许可证和第三方声明以各自软件包或发行版附带文件为准；项目代码的 MIT 许可证不替代这些组件的许可。

## 头像打印示例素材

现有背景、纹理、头像、礼物图标和音频位于 `projects/avatar-printer/assets/`。

- 背景及纹理的生成提示词记录在 [PROMPTS.md](projects/avatar-printer/assets/generated/PROMPTS.md)。该记录描述了生成流程。
- 同一记录明确说明 `avatar-atlas.png` 使用了截图中的头像作为输入，并经过重建；它不构成对参考图片、人物肖像或其他输入内容的独立授权证明。
- 当前仓库未为礼物图标和机器音频提供单独的来源许可文件；这里保留其实际状态，不将它们标注为已完成独立授权核验。
- 运行时抓取的真实观众头像属于本机缓存，不作为仓库发布素材；相关缓存与登录配置已排除在 Git 跟踪之外。

新增或替换素材时，在所属项目目录保存来源、授权或生成记录。重新分发现有素材前，应依据其实际来源确认适用许可；本文件不为素材新增授权。
