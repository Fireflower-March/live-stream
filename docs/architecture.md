# 直播互动项目框架

本仓库把直播基础能力和玩法拆开维护。根目录的 `index.html` 是项目中心，实际玩法放在 `projects/` 下，每个文件夹有自己的页面、代码、规则和素材。内置头像打印示例和可运行的互动模板，新玩法通过独立目录扩展。

## 目录职责

```text
live-stream/
├─ launch.py                         桌面窗口、本地 HTTP 服务、进程管理
├─ douyin-bridge.mjs                 抖音事件采集与头像解析
├─ bridge-ws.mjs                     共享本机 WebSocket 数据桥
├─ scene_relay.py                    本机输出信令中转
├─ framework/
│  ├─ project_registry.py            项目发现、清单校验、入口及小窗地址
│  └─ web/
│     ├─ project-context.mjs          项目上下文与项目级存储
│     ├─ desktop-client.mjs           项目调用桌面宿主与浏览器控制端点
│     ├─ live-client.mjs              直播连接、发现与重连
│     ├─ scene-channel.mjs            按项目隔离的小窗通信
│     ├─ project-session.mjs          同一项目多个页面的主实例选举
│     ├─ output-stream.mjs            通用画面发送、帧率与连接生命周期
│     ├─ live-view.html               通用纯画面接收窗口
│     ├─ scene-output.mjs             Three.js 输出尺寸及抗锯齿
│     ├─ render-budget.mjs            渲染精细度预算
│     └─ project-hub.mjs / .css       项目中心
├─ projects/
│  ├─ avatar-printer/
│  │  ├─ project.json                打印项目注册信息
│  │  ├─ index.html / index-en.html   独立中英文前端
│  │  ├─ demo-rules.mjs               打印任务规则
│  │  ├─ print-settings.mjs           打印规则面板
│  │  ├─ printer-audio.mjs            机器声音
│  │  ├─ gift-speech*.mjs             打印项目播报
│  │  └─ assets/                     该项目的头像、背景、图标和音频
│  └─ starter/
│     ├─ project.json                可复制的独立项目配置
│     └─ index.html                  2D 互动示例页面
├─ assets/                           共享 Three.js 及辅助库
├─ index.html                        项目中心
├─ start.bat / setup.bat              启动与依赖安装
└─ docs/                             使用与开发说明
```

`framework/` 不依赖头像打印的任务大小、机械臂、礼物张数等业务规则。新玩法负责消费直播事件、维护自身状态并生成输出画面。Three.js 是可选的画面实现；2D、视频素材或其他项目可以使用自己的绘制逻辑。

## 启动与切换

- 双击 `start.bat`：进入项目中心，动态列出每个项目的页面入口。
- `start.bat --project avatar-printer`：直接进入指定项目。
- `.\.venv\Scripts\python.exe launch.py --list-projects`：在终端列出已发现的项目。
- `.\.venv\Scripts\python.exe launch.py --server-only`：只启动本地服务，按日志中的实际地址访问项目中心。

桌面项目中心通过 `window.pywebview.api.open_project(id)` 切换项目，然后在同一主窗口导航到该项目入口。切换前会关闭旧项目的输出小窗；直播间登录窗口与共享数据桥可继续工作。各项目可提供返回项目中心的按钮，避免保留两个主项目同时消费互动并播放声音。切换会离开原页面，进行中的玩法状态由项目自行决定是否保存。

浏览器模式使用同一标签页导航。手动另开多个标签页属于多个运行实例；项目隔离不等同于替用户关闭其他标签页。

## 新增独立项目

复制 `projects/starter/` 为一个新目录，例如 `projects/my-show/`，修改目录内的 `project.json`：

```json
{
  "id": "my-show",
  "name": "我的互动项目",
  "description": "在这里描述该项目的画面与玩法。",
  "entry": "index.html",
  "entries": {
    "zh": "index.html",
    "en": "index-en.html"
  },
  "viewerTitle": "直播小窗 · 我的互动项目",
  "output": {
    "mode": "mirror",
    "camera": false
  }
}
```

只保留真实存在的页面；如果没有英文页，删除 `en` 配置。`id` 必须与目录名一致，仅使用小写字母、数字、短横线或下划线。入口必须是项目目录内存在的 HTML 文件，不能填写外部 URL 或跳出目录的路径。

将玩法页面、脚本、规则与素材放在这个目录下。页面声明自己的项目 id，并接入公共运行时；复制模板时同时更新模板中声明的 id，保证存储和小窗通信归属于新项目。无需修改头像打印项目或手写中心卡片。刷新项目中心后，新项目会被自动发现；配置错误会在中心显示，其他合法项目仍可使用。

模板页面使用 `<meta name="live-project-id" content="starter">` 声明项目，脚本也显式传入 `projectId`。复制时把这两处与 `project.json` 的 `id` 一起改为新目录名。脚本通过 `createProjectStorage(projectId)` 保存设置，`LiveClient` 接收直播事件，`DesktopClient` 调用打开直播间、抓取和输出小窗能力，`SceneChannel` 与 `OutputStream` 配合完成画面传输。保留这些公共接入，只替换项目的规则与绘制内容即可。

`entries` 可以登记不同语言或不同页面，每个页面都属于同一个项目。只有不同玩法才需要建立新的项目目录。

## 共享事件与独立规则

```text
直播间登录窗口
       ↓
共享数据桥（评论 / 点赞 / 礼物 / 关注 / 进场）
       ↓
当前项目的公共直播客户端
       ↓
项目自己的规则、队列与状态
       ↓
项目输出画面与声音
       ↓
公共直播小窗 → 直播伴侣 → 观众
```

数据桥传递用户昵称、头像、事件类型、礼物名称和数量等数据；具体触发什么表现由项目决定。头像打印把事件转换为打印任务，新项目可以把同样的事件转换为计数、动作或场景变化。不要把新项目的动作映射继续加入打印专用的 `demo-rules.mjs`。

真实直播数据接入是共享能力，各项目连接同一数据桥；演示按钮与演示数据由各项目自行提供。`starter` 用于验证独立页面、事件接收及输出接入，不代表已经实现任何真人表演素材。

## 设置与输出隔离

项目通过公共项目存储接口读写自己的设置，避免直接使用未区分项目的全局存储键。镜头、音量、玩法规则等应随项目 id 隔离；全局的直播数据桥、登录进程及捕获兼容环境仍由桌面宿主管理。已有打印设置的迁移由运行时保留兼容处理。

公共直播小窗地址为 `/framework/web/live-view.html?project=<项目id>`。信令的本地广播和 HTTP 中转都携带项目 id，避免一个项目的小窗接到另一项目的画面或操作。`output.camera` 表示项目是否提供镜头交互：打印项目可启用，普通 2D/视频项目可关闭。不要将某个项目的相机逻辑写死在公共项目中心。

`ProjectSession` 负责同一项目多个控制页面之间的主实例选举，输出模块的 `isActive` 使用 `session.isLeader()`。这避免同一项目被重复打开时多个页面争抢同一个小窗。页面离开时关闭直播客户端、输出、选主和信道；浏览器从页面缓存返回时重新加载，恢复完整连接。

小窗只接收项目输出画面，声音由主项目播放。项目应把希望直播伴侣采集的内容纳入同一个输出源：例如后续人物视频、字幕、礼物特效要完成合成，不能只在主控制台上叠元素后假定镜像会自动包含它们。

## 验证建议

改公共框架时，检查项目发现、非法配置隔离、项目设置与信令隔离、直播重连和切换时旧小窗清理。改打印项目时，运行打印规则、机械臂、空闲补位及礼物抢占测试。原生输出验收需要额外验证横竖屏、持续出帧、镜头交互，以及关闭小窗后主页面恢复；测试脚本应访问实际项目入口，不能把根目录的项目中心当成打印页面。

在直播伴侣中采集各项目 `viewerTitle` 对应的窗口。切换到其他项目后重新选择对应小窗；结束时先在直播伴侣停止直播，再关闭桌面框架。完整开播步骤见根目录 [使用教程](../guide.html)。

自动验证命令：

```powershell
python -m unittest test_project_registry test_launch_ports test_scene_relay
node --test framework-runtime.test.mjs output-stream.test.mjs project-session.test.mjs
python -m unittest test_project_http
node test_framework_browser.mjs
```

最后一项使用独立本机服务、临时浏览器配置和无界面 Chromium，检查项目中心、中英文打印、二维模板、镜头交互与输出隔离；不会使用生产登录配置或启动真实数据抓取。报告与截图保存在 `.runtime-tmp/framework-browser-*/`。原生 WebView2 与直播伴侣仍可按开播教程手动验收。

## 通用化与发布内容

项目页面、说明和素材应使用玩法本身的名称，宣传入口不属于公共运行时。新增内容放在所属项目目录，避免把个人联系方式、商业广告或特定维护者品牌写入框架。

发布时保留 [LICENSE](../LICENSE) 与 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)，并排除登录配置、缓存、日志及本地依赖环境。项目代码许可和素材来源记录分别维护；添加第三方素材时同步记录来源和适用许可。
