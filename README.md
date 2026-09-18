# LiveStage Effects

面向舞台灯光与实时视觉效果编排的浏览器工作台。

LiveStage Effects 将预设曲线编辑、视频同步、事件时间线和设备输出整合到一个多窗口界面中。用户可以基于本地视频编排效果，并通过配套的 LiveStage Client 将实时效果发送到硬件设备。

> 当前版本：`1.0 公开测试版`  
> 作者：`@buerstrd`

## 在线体验

访问 **[LiveStage 团队官方网站](https://47.100.87.225)** 即可在线体验。

建议使用桌面版最新版 Chrome 或 Edge。在线地址可直接体验界面、项目编辑和时间线功能；Web Serial 等硬件能力需要安全上下文支持，实际连接设备时建议使用 `localhost` 或 HTTPS 部署环境。

> 当前项目仍处于开发阶段，在线站点使用自签 SSL 证书。浏览器首次访问时可能提示证书不受信任，需要手动确认后才能继续访问。

GitHub 项目地址：[buerstrd/LiveStageEffects](https://github.com/buerstrd/LiveStageEffects)

## 主要功能

- **项目管理**：新建、打开和保存 `.lseproj` 项目文件，可保存窗口布局、视频路径、预设、事件、系统设置和当前工作区状态。
- **预设编辑**：创建和编辑亮度、颜色曲线，支持颜色节点、历史颜色、快捷键绑定和预设缩放。
- **事件编排**：使用开始时间与终止时间定义事件区间，一个事件可包含多个预设触发点。
- **时间线编辑**：以剪辑软件风格的轨道时间线编排预设，支持拖动放置、复制、轨道缩放和播放头同步。
- **视频同步**：加载本地视频，显示缩略图、音频波形和播放进度，并根据视频时间触发事件与预设。
- **实时 BPM**：在浏览器中分析当前视频音频，提供实时 BPM、音乐概率、节拍提示和手动校正。
- **设备连接**：通过 Web Serial 连接 LiveStage Client，并采用自定义 `LSP1` 串行协议发送效果与设备数据。
- **输出控制**：支持输出亮度、RGB 色彩校准、兼容模式和设备输出延迟补偿。
- **界面体验**：基于 Material Design 3 视觉规范，支持多窗口拖动、吸附、四宫格布局和动画开关。

## 推荐使用流程

1. 启动程序并创建或打开一个 `.lseproj` 项目。
2. 在视频窗口加载本地视频文件。
3. 在预设窗口创建效果，并使用曲线编辑器调整亮度与颜色。
4. 在事件窗口设置事件区间，在时间线中放置一个或多个预设。
5. 播放视频，检查事件触发、缩略图、波形和 BPM 同步状态。
6. 使用串行端口连接 LiveStage Client，将实时效果输出到设备。

## 技术栈

- [Nuxt 4](https://nuxt.com/)
- [Vue 3](https://vuejs.org/)
- TypeScript
- Material Design 3 风格界面
- Web Serial API
- Web Audio API
- Web Workers
- Canvas
- 浏览器端神经网络节拍识别

## 本地运行

环境要求：

- Node.js 20 或更高版本
- pnpm

```bash
pnpm install
pnpm dev
```

开发服务器启动后，默认访问 `http://localhost:3000`。

## 构建与部署

```bash
# 生产构建
pnpm build

# 预览生产构建
pnpm preview

# 生成静态站点
pnpm generate
```

如需使用 Web Serial 连接硬件，请确保部署环境满足浏览器的安全上下文要求，并在支持 Web Serial 的 Chromium 浏览器中运行。

## HTTPS 开发证书

项目内提供开发阶段使用的自签证书：

- 证书：`certs/livestage-dev.crt`
- 私钥：`certs/livestage-dev.key`

证书包含以下访问地址：

- `https://47.100.87.225`
- `https://localhost`
- `https://127.0.0.1`

该证书仅用于开发与测试。由于自签证书不属于公共受信任 CA，浏览器会显示安全警告。生产环境发布前应替换为受信任 CA 签发的正式证书。

## 项目结构

```text
app/
├── assets/           # 全局样式与主题资源
├── components/       # 窗口、编辑器、设置与内容组件
├── composables/      # 项目、事件、预设、视频、设备和设置状态
├── utils/            # 串行协议等通用工具
└── workers/          # 时间线缩略图等 Worker

public/
├── bpm/              # 浏览器 BPM 音频处理资源
├── models/           # 节拍识别模型
└── workers/          # 节拍识别运行时

certs/
├── livestage-dev.crt # 开发阶段自签证书
└── livestage-dev.key # 开发阶段私钥
```

## LiveStage Client

Web 端不直接实现设备硬件协议，而是通过自定义 `LSP1` 串行帧与 LiveStage Client 通信：

```text
[LSP1][Type][Sequence][Length][Payload...][CRC8]
```

设备输出数据的最终编码、CRC 计算和发送由 LiveStage Client 完成。

## 浏览器兼容性

- 推荐：桌面版 Chrome、Edge 或其他基于 Chromium 的浏览器。
- 不支持 Web Serial 的浏览器仍可使用项目编辑、视频和时间线功能，但无法连接串行端口硬件。
- 移动端浏览器尚未针对窗口布局和硬件连接进行适配。

## 第三方资源

BPM 运行时包含基于 BeatTrackerJS 和 madmom 的浏览器节拍识别实现。模型及其许可信息请参阅 [public/models/beattracker/NOTICE.md](public/models/beattracker/NOTICE.md)。

## 反馈

公开测试期间，如遇到问题或有功能建议，请通过 GitHub Issues 反馈。
