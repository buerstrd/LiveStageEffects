# LiveStage Effects

面向舞台灯光与实时视觉效果编排的浏览器工作台。

LiveStage Effects 将事件编排、预设曲线编辑、视频同步、时间线控制、BPM 分析和设备输出整合到一个多窗口界面中。用户可以基于本地视频在浏览器内完成效果设计，并通过配套的 LiveStage Client 将实时效果发送到硬件设备。

> 当前版本：`1.0 公开测试版`  
> 作者：`@buerstrd`

## 在线体验

访问 **[livestagestudio.com](https://livestagestudio.com/)**。

建议使用桌面版最新版 Chrome 或 Edge。Web Serial 等硬件能力需要浏览器的安全上下文支持，实际连接设备时请使用 HTTPS 或 `localhost` 环境。

GitHub 项目地址：[buerstrd/LiveStageEffects](https://github.com/buerstrd/LiveStageEffects)

## 功能概览

- **项目管理**：新建、打开和保存 `1.0` 格式 `.lseproj` 工程文件。工程使用 UTF-8 JSON，不提供旧格式兼容迁移。
- **事件编排**：使用开始时间和结束时间定义事件区间。新建事件默认时长为 3 分钟、包含 3 条轨道和 30 个事件私有预设；区间超出视频时长时会分别提示开始时间或结束时间异常。
- **预设与曲线**：每个事件拥有独立的预设空间，预设命名采用 `事件 ID-预设 ID`。每个曲线节点同时保存亮度与颜色，可编辑曲线、管理历史颜色并保存曲线模板。
- **时间线编辑**：以剪辑式轨道时间线为主视图，支持拖动添加、复制、批量复制、左右调整持续时间、多选和成组移动。时间线预设的实际播放位置与持续时间由时间线决定，而不是固定使用预设默认值。
- **复制与删除**：支持 `Ctrl/Cmd+C`、`Ctrl/Cmd+X`、`Ctrl/Cmd+V` 和 MD3 右键菜单，粘贴位置以鼠标位置为准。事件、预设和轨道预设均采用二次点击确认删除。
- **BPM 与节拍线**：在浏览器中分析视频音频，稳定读数后生成与真实节拍对应的 BPM 提示线。时间线拖动支持 BPM 吸附，预设时长大于节拍间隔时可按节拍自动对齐；节拍线支持手动重置。
- **视频与渲染**：支持本地视频播放、时间标尺、缩略图和音频 PCM 波形。缩略图与波形在事件区间变化或视图刷新时重新渲染，并提供渲染状态和剩余时间提示。
- **设备输出**：通过 Web Serial 连接 LiveStage Client，最高支持 `115200 bps`。时间线负责颜色采样并生成设备输出，支持全局亮度、RGB 校准、无线延迟补偿和兼容模式。
- **界面与设置**：采用 Material Design 3 风格的多窗口界面，支持窗口拖动、层叠和布局保存。开发设置提供“不保留缓存”选项，启用后会在程序启动时清理浏览器缓存。

## 推荐使用流程

1. 创建或打开一个 `.lseproj` 工程。
2. 在视频窗口加载本地视频文件。
3. 创建事件，并为其创建或编辑独立预设。
4. 在设计窗口的时间线中放置预设，调整轨道、开始位置和持续时间。
5. 播放视频，检查缩略图、PCM 波形、BPM 节拍线和时间线效果。
6. 连接 LiveStage Client，确认播放预览与设备输出一致后保存工程。

## 工程文件格式

`.lseproj` 是 UTF-8 编码的 JSON 文件。当前工程格式版本为 `1.0`，打开工程时会严格校验版本。

```json
{
  "format": "lseproj",
  "version": "1.0",
  "name": "示例工程",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "data": {
    "events": [],
    "windows": {},
    "video": {},
    "settings": {},
    "workspace": {}
  }
}
```

工程文件会保存以下内容：

- 事件、事件区间、轨道数量、预设触发点和预设持续时间。
- 每个事件的私有预设、曲线节点、重复参数和快捷键绑定。
- 窗口列表、窗口位置、尺寸、层级和焦点状态。
- 视频路径、文件名、当前播放时间、音量和静音状态。
- 输出亮度、RGB 校准、设备延迟补偿和兼容模式。
- 时间线缩放、滚动位置、当前事件与预设的选中 ID、历史颜色和曲线模板。
- 当前设置分类、预设视图滚动位置等界面工作区状态。

以下运行时数据不会写入工程文件：

- 视频文件本体。
- PCM 波形、时间线缩略图等派生缓存。
- 实时 BPM 分析状态和运行中的模型数据。
- 串口连接、设备在线状态和未发送完成的设备数据。
- 时间线多选范围、剪贴板、拖动状态以及渲染进度。

重新打开工程后，需要重新选择同一路径的本地视频，才能恢复视频相关功能。

## 技术栈

- [Nuxt 4](https://nuxt.com/)
- [Vue 3](https://vuejs.org/)
- TypeScript
- Material Design 3
- Web Serial API
- Web Audio API
- Web Workers
- Canvas
- 浏览器端神经网络节拍识别

## 本地开发

环境要求：

- Node.js 20 或更高版本
- pnpm

```bash
pnpm install
pnpm dev
```

开发服务器启动后，可通过 Nuxt 输出的本地地址访问。

## 构建与部署

```bash
# 生产构建
pnpm build

# 预览生产构建
pnpm preview

# 生成静态站点
pnpm generate
```

如需连接串行端口硬件，请使用支持 Web Serial 的 Chromium 浏览器，并确保部署环境满足 HTTPS 或 `localhost` 的安全上下文要求。

开发环境自签证书位于 `certs/`。该证书仅用于本地开发与测试，生产部署应替换为受信任 CA 签发的证书。

## 项目结构

```text
app/
├── assets/styles/    # Material Design 3 全局主题与样式
├── components/       # 多窗口、事件、预设、设计、设备和设置界面
├── composables/      # 工程、事件、预设、视频、BPM、渲染和设备状态
├── utils/            # 曲线、串行协议和浏览器缓存工具
└── workers/          # 时间线缩略图 Worker

public/
├── bpm/              # 浏览器 BPM 音频处理资源
├── models/           # 节拍识别模型
└── workers/          # 节拍识别运行时

certs/
├── livestage-dev.crt # 开发阶段自签证书
└── livestage-dev.key # 开发阶段私钥
```

## LiveStage Client

Web 端通过自定义 `LSP1` 串行帧与 LiveStage Client 通信：

```text
[LSP1][Type][Sequence][Length][Payload...][CRC8]
```

设备输出数据的最终编码、CRC 计算和发送由 LiveStage Client 完成。

## 浏览器兼容性

- 推荐使用桌面版 Chrome、Edge 或其他基于 Chromium 的浏览器。
- 不支持 Web Serial 的浏览器仍可使用工程编辑、视频、BPM 和时间线功能，但无法连接串行端口硬件。
- 移动端浏览器尚未针对多窗口布局和硬件连接进行完整适配。

## 第三方资源

BPM 运行时包含基于 BeatTrackerJS 和 madmom 的浏览器节拍识别实现。模型及其许可信息请参阅 [public/models/beattracker/NOTICE.md](public/models/beattracker/NOTICE.md)。

## 反馈

公开测试期间，如遇到问题或有功能建议，请通过 GitHub Issues 反馈。
