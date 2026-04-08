# PetClaw Cat Typer

把 `PetClaw` 原版黑猫桌宠整理成一个透明 Electron 悬浮窗，并接入 macOS 全局键盘监听。

## 功能

- 透明背景、无边框、始终置顶
- 只在小猫不透明区域拦截鼠标，周围区域可直接点穿
- 全局监听键盘输入，联动待机、倾听、打字、收尾、睡觉几段动画
- 可拖动位置

## 环境

- macOS
- `clang`
- `npm`

## 运行

```bash
cd /Users/xiangboshi/Documents/Playground/petclaw-cat-typer
./run.command
```

首次运行会自动执行两件事：

1. 编译 `build/key-monitor`
2. 通过 `npm start` 启动 Electron

也可以分开执行：

```bash
cd /Users/xiangboshi/Documents/Playground/petclaw-cat-typer
./build.sh
npm start
```

## 权限

如果要监听你在其他应用里的键盘输入，需要在 macOS 里给终端或 Electron 打开“辅助功能”权限。授权后建议完全退出再重开一次程序。

## 目录

- `electron/main.js`：窗口创建、置顶、点穿、启动键盘监听进程
- `electron/preload.js`：渲染层桥接
- `electron/renderer/cat.html`：动画状态机与双视频切换逻辑
- `Sources/PetClawCatTyper/key-monitor.m`：macOS 全局键盘监听 helper
- `Resources/*.webm`：运行时实际使用的透明动画资源
- `video-preview.html`：本地逐个查看视频素材的预览页

## 资源说明

仓库只保留运行必需的 `.webm` 动画资源。

原始拆帧 PNG 体积较大，默认不再提交到 Git；如果本机已有 `Resources/original_frames/`，仍可继续本地保留用于分析或重新导出素材。

## 开发说明

- `build/` 和 `node_modules/` 都是可重建内容，不纳入版本控制
- `npm start` 使用 `npx electron .`，即使全局没有安装 `electron` 也能启动

动画资源来源于本机已安装的 `/Applications/PetClaw.app`，透明素材由本机处理生成。
