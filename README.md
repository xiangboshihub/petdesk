# PetClaw Cat Typer

把 `PetClaw` 原版黑猫动画拆成透明帧后，做成一个透明悬浮小窗。

## 运行

```bash
cd /Users/xiangboshi/Documents/Playground/petclaw-cat-typer
./run.command
```

或者分两步：

```bash
cd /Users/xiangboshi/Documents/Playground/petclaw-cat-typer
./build.sh
npm start
```

第一次运行如果要监听你在别的软件里的打字，macOS 会请求“辅助功能”权限，允许后再重新打开一次程序即可。

## 说明

- `original_frames/static`：原版待机帧
- `original_frames/task_start`：原版开始打字帧
- `original_frames/task_loop`：原版持续打字帧
- 打字时先播起手，再播循环
- 窗口可直接拖动

动画资源来源于本机已安装的 `/Applications/PetClaw.app`，透明帧由本机 `ffmpeg` 转出。
