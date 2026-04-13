# PetClaw Cat Typer

把 `PetClaw` 原版黑猫桌宠整理成一个透明 Electron 悬浮窗，并接入 macOS 全局键盘监听，再加上一个低调的头顶行情小屏。

## 说明

`PetClaw` 官方版本请优先前往 [petclaw.ai](https://petclaw.ai/) 体验。

本仓库仅用于个人测试、学习和开发验证，不作为官方替代品，也不用于商业分发。

如相关内容涉及侵权，请联系处理，仓库会立即删除。

这是一个偏个人效率风格的桌宠工具：

- 平时就是会跟着打字状态变化的小黑猫
- 需要时可以显示股票行情、分时线、持仓盈亏和提醒
- 不想暴露行情时，可以一键切到工作模式

## 适合谁

- 想要一个常驻桌面的轻量桌宠
- 想看盘，但不想一直开着完整行情软件
- 想快速盯住成本价、止损价、止盈价

## 下载

仓库里目前有两种本地打包产物：

- `.app` 包：适合直接在 Apple Silicon Mac 上解压后运行
- 便携包：适合保留源码、脚本和依赖，自己继续改

如果你是从源码运行，直接看下面的“运行”部分即可。

## 功能

- 透明背景、无边框、始终置顶
- 只在小猫不透明区域拦截鼠标，周围区域可直接点穿
- 全局监听键盘输入，联动待机、倾听、打字、收尾、睡觉几段动画
- 可拖动位置
- 新增头顶行情小屏幕，跟随小猫一起移动
- 支持按股票成本价、止损价、止盈价做盘中提醒
- 支持自动按日线前低 + ATR 计算止损，按 `R` 倍数计算止盈
- 支持多只股票轮播监控
- 支持极简分时图
- 支持显示相对成本价的持仓盈亏幅度
- 支持 `行情模式 / 工作模式`
- A 股配色习惯：上涨红色、下跌绿色，价格和涨跌幅同步联动

## 环境

- macOS
- `clang`
- `npm`

## 运行

### 从源码运行

```bash
git clone https://github.com/xiangboshihub/petdesk.git
cd petdesk
./run.command
```

首次运行会自动执行两件事：

1. 编译 `build/key-monitor`
2. 通过 `npm start` 启动 Electron

也可以分开执行：

```bash
cd petdesk
./build.sh
npm start
```

### 从 `.app` 运行

如果你已经拿到打好的 `.app` 包：

1. 解压下载包
2. 打开 `PetDesk.app`
3. 首次如果被 macOS 拦截，右键 `打开` 一次

如果要让全局打字监听正常工作，还需要按下面的权限说明授权。

## 行情小屏

头顶小屏默认会显示：

- 当前价格
- 简单分时图
- 今日涨跌幅
- 相对成本价的持仓盈亏
- 提醒状态

模式说明：

- `行情模式`：显示价格、分时图、盈亏和提醒
- `工作模式`：隐藏行情数字，只保留低调的专注状态

颜色说明：

- 涨：红色
- 跌：绿色
- 持仓盈利：红色
- 持仓亏损：绿色

行情配置在：

- `market-config.json`

现在支持两种配置写法。

最推荐的是超简写法，只写股票名和价位：

```json
[
  {
    "name": "东阳光",
    "cost": 31.16,
    "strategy": "均衡"
  },
  {
    "name": "平安银行",
    "cost": 11.20,
    "stop": 10.80,
    "take": 12.30
  }
]
```

程序启动后会自动把它补成完整结构并回写到 `market-config.json`。

如果你不想自己算止损和止盈，最简单就是只写：

- `name`
- `cost`
- `strategy`

其中 `strategy` 支持：

- `保守`
- `均衡`
- `激进`

自动计算规则是轻量版：

- 止损：最近一段日线前低下方，加一层 `ATR` 缓冲
- 止盈：按止损风险算 `1.5R / 2R / 3R`

默认建议直接用：

```json
[
  {
    "name": "东阳光",
    "cost": 31.16,
    "strategy": "均衡"
  }
]
```

说明：

- 如果你手动写了 `stop`，程序优先用你手动的止损价
- 如果你手动写了 `take`，程序优先用你手动的止盈价
- 如果你只写了 `stop` 没写 `take`，程序会按当前止损自动补止盈价
- 程序会把算出来的价格和计算依据一起回写到 `market-config.json`

如果你需要，也仍然支持完整写法：

```json
{
  "pollIntervalMs": 20000,
  "fireOnBoot": false,
  "activeSymbolId": "dongyangguang",
  "symbols": [
    {
      "id": "dongyangguang",
      "enabled": true,
      "name": "东阳光",
      "code": "600673",
      "market": "SH",
      "levels": {
        "costPrice": 31.16,
        "stopLossPrice": 29.68,
        "takeProfitPrice": null
      },
      "strategy": {
        "mode": "auto",
        "profile": "balanced",
        "autoStopLoss": true,
        "autoTakeProfit": true
      }
    }
  ]
}
```

默认已经写入一只超简配置：

- 东阳光 `600673`
- 成本价 `31.16`
- 自动策略 `均衡`

当前示例也可以直接扩成多只：

```json
[
  {
    "name": "东阳光",
    "cost": 31.16,
    "strategy": "均衡"
  },
  {
    "name": "华康洁净",
    "cost": 51.89,
    "strategy": "激进"
  }
]
```

如果要改成别的股票，通常你只需要改每一项里的 `name`。程序会自动搜索并补齐：

- `code`
- `market`
- `id`

然后自动回写到 `market-config.json`。

支持：

- 多只股票一起保存
- `activeSymbolId` 指定当前显示/监控哪一只
- 保存文件后自动热重载并自动补全字段

快捷键：

- `Cmd/Ctrl + Shift + [`：切换上一只股票
- `Cmd/Ctrl + Shift + ]`：切换下一只股票
- `Cmd/Ctrl + Shift + R`：手动重载 `market-config.json`

气泡控制：

- 双击小猫：在 `行情模式` 和 `工作模式` 之间切换
- 右键小猫：隐藏 / 显示头顶气泡
- `Cmd/Ctrl + Shift + M`：切换 `行情模式` / `工作模式`
- `Cmd/Ctrl + Shift + B`：隐藏 / 显示头顶气泡

说明：

- `工作模式` 不显示价格数字，只显示“专注中 / 空闲中”等低调状态
- 当前只检测是否在打字，不读取你实际输入内容，所以“打字摘要”做成了专注状态提示，而不是内容摘要
- `行情模式` 下，小屏会按当天涨跌自动切换红绿氛围，符合 A 股习惯
- 分时图是轻量版展示，只用于快速扫一眼盘中走势，不替代完整交易软件

## 权限

如果要监听你在其他应用里的键盘输入，需要在 macOS 里给终端或 Electron 打开“辅助功能”权限。授权后建议完全退出再重开一次程序。

如果你使用 `.app` 包，通常需要给 `PetDesk.app` 授权。
如果你使用源码运行，通常需要给你启动它的终端授权。

## 目录

- `electron/main.js`：窗口创建、置顶、点穿、启动键盘监听进程
- `electron/preload.js`：渲染层桥接
- `electron/renderer/cat.html`：动画状态机与双视频切换逻辑
- `electron/renderer/market-bubble.html`：头顶行情小屏幕
- `market-config.json`：股票、轮询间隔和成本/止损/止盈价配置
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
