# 海克斯推荐悬浮条（augment-overlay）设计文档

日期：2026-10-02　分支：`feat/augment-overlay`　方案：B（伴随式推荐条）

> **v1.1 调整（实测反馈后）**：原设计"对局进行中自动悬浮展示"在实测中严重遮挡游戏
> （长列表居中常驻、鼠标穿透无法关闭）。调整为：**去掉对局自动展示，长按快捷键呼出、
> 松开自动隐藏**；UI 由三档 Top5 长列表改为**三行紧凑条**（每档一行：档位标签 +
> Top3 图标+等级徽章，约 200×100px）；默认位置改为主屏幕右侧居中；App.vue 增加
> setSize 尺寸守卫防 resize 循环。海克斯选择阶段的自动检测（弹出/消失）留待
> 二期探测脚本验证 API 后实现。

## 背景与痛点

在斗魂竞技场（CHERRY）和海克斯大乱斗（KIWI）中，游戏内会弹出 3 张海克斯卡片供选择。
目前用户需要切屏到 OP.GG 窗口查看推荐排序，再回到游戏逐一对照，体验割裂。

第一期目标：把当前英雄的推荐海克斯以**悬浮条**形式显示在游戏画面上（无边框/窗口化模式），
用户拿 3 张卡对照即可，无需切屏。每条推荐带**等级标注（S/A/B/C）+ 胜率**，KIWI 模式附带简述。

## 总体架构

新增第 6 个渲染窗口 `augment-overlay-window`，完全复用 CD 计时器窗口的成熟模式。

```
主进程 window-manager（新窗口类 AkariAugmentOverlayWindow）
  ├─ 显隐: gameflow.session.phase === 'InProgress' && gameMode ∈ {CHERRY, KIWI}
  ├─ 窗口属性: 透明/无边框/置顶/screen-saver 层级/skipTaskbar/不可聚焦
  ├─ 快捷键: keyboard-shortcuts（按住呼出可拖动，复用对局面板 fakeShow 模式）
  └─ 位置记忆: rememberPosition=true

渲染进程 src-augment-overlay-window
  ├─ 当前英雄: gameflow.session.gameData.playerChampionSelections
  │    按 puuid === summoner.me.puuid 匹配 → championId
  ├─ 推荐数据: champion-data shard
  │    CHERRY → mode='arena'；KIWI → mode='aram_mayhem'
  │    loadDetails(query, championId) → sections.augments: ChampionAugment[]
  └─ 展示: AugmentRecommendationBar（复用 AugmentDisplay 图标组件）
```

## 等级标注规则

`ChampionAugment` 自带 `rank` / `performanceScore` / `performance.winRate`。
同一档位内（tier 1=银 / 4=金 / 8=棱彩）按 `performanceScore ?? performance.winRate` 降序排名：

| 等级 | 分位    | 颜色 |
| ---- | ------- | ---- |
| S    | 前 15%  | 金色 |
| A    | 15%~35% | 绿色 |
| B    | 35%~60% | 蓝色 |
| C    | 其余    | 灰色 |

每档位显示 Top 5。纯函数实现于 `src/shared/data-adapter/champion-data/augment-grades.ts`，表驱动单测。

## 简述来源

- KIWI：GTIMG `kiwi_augments.json` 的中文 `tooltip`（已接入 `resources.augments`，零成本）
- CHERRY：实现时核查 cherry-augments.json 原始字段；无则第一期不显示描述，不阻塞

## UI 设计

- 悬浮条：三档位纵向紧凑排列（档位标题 + 行：图标 AugmentDisplay / 名称 / 等级徽章 / 胜率）
- 半透明深色底 `bg-[#1a1a1da0]`、圆角、`text-xs`，默认整体 `opacity-90`
- 默认鼠标穿透（`setIgnoreMouseEvents(true)`）；按住快捷键临时可交互（拖动位置），松开恢复
- 窗口尺寸随内容自适应（cd-timer 的 `useElementSize` + `wm.setSize` 模式）
- 主题：跟随 app-common 主题（`useColorThemeAttr`），Naive UI provider 完整包装

## 设置项（settings key）

| key            | 类型         | 默认  | 说明                                          |
| -------------- | ------------ | ----- | --------------------------------------------- |
| `enabled`      | boolean      | false | 总开关（无原生输入时强制 false，同 cd-timer） |
| `showShortcut` | string\|null | null  | 按住呼出/拖动位置的热键                       |

设置 UI 加入主窗口 `MultiWindowSettings.vue`（新 section），复用 `ShortcutSelector.vue`。

## 错误处理

- 推荐数据加载失败 → 显示"暂无推荐数据"（可交互模式下提供重试按钮）
- 无当前英雄 / 数据源无该英雄数据 → 同上
- 非 CHERRY/KIWI 模式 → 窗口整体隐藏（不显示空条）
- 原生输入不可用 → enabled 强制 false（restore/transform 钩子，同 cd-timer）
- 数据每次对局取一次，游戏期间不轮询刷新（数据是赛前统计，无需实时）

## 测试策略

- 单元测试：`augment-grades.ts` 分档映射（表驱动：边界 15%/35%/60%、同分并列、空数据）
- 不测实现字符串/结构（遵循 AGENTS.md 测试原则）
- 运行时验证：`yarn dev` + 真实 CHERRY/KIWI 对局冒烟（悬浮显隐、数据展示、快捷键拖动）
- Storybook：AugmentRecommendationBar 以 mock 数据出 story（后续补）

## 风险与二期（方案 A 预研）

- 风险：CHERRY 描述字段缺失（已设计降级）；OP.GG/QQ101 对国服 patch 覆盖延迟
- 二期预研：`scripts/probe-liveclientdata.mjs` 轮询 2999 端口 `allgamedata`/`eventdata`
  并落盘 JSONL，用户在对局中跑一次，验证能否拿到"当前 3 张卡的 augmentId"。
  若可行，二期升级为逐卡标注（复用本期的数据管线与等级计算）。

## 涉及文件清单

主进程：`window-manager/augment-overlay-window/{state,window}.ts`、`window-manager/index.ts`、
`window-manager/lifecycle-controller.ts`
渲染共享：`shards/window-manager/{context,store,windows,index}.ts`
新窗口：`src/renderer/augment-overlay-window.html`、`src/renderer/src-augment-overlay-window/*`
组件：`renderer-shared/components/augment-recommendation/*`
共享：`shared/data-adapter/champion-data/augment-grades.ts(+test)`
配置：`electron.vite.config.ts`、`tsconfig.web.json`
i18n：`shared/i18n/{en,zh-CN}/renderer/augment-overlay.yaml`、`renderer-shared/i18n/index.ts`
设置 UI：`main-window/components/settings-modal/MultiWindowSettings.vue`
脚本：`scripts/probe-liveclientdata.mjs`
