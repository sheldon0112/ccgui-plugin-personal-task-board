# 个人任务面板首页重构验收

日期：2026-10-30（Asia/Shanghai）。版本：0.1.30。

## 改动范围

按确认的三张设计图调整现有看板、列表和父子泳道，保留甘特。通知铃铛位于新建任务左侧，显示未读数量并展开收件箱；视图在快捷筛选右侧使用横排文字切换。“视图设置”集中排序、命名视图、批量操作和重新载入。

看板优化卡片与分栏，次要操作折叠，执行与人工验收继续直接显示。列表增加状态分组及下方预览，选中行高亮；跨分组连续选择与预览上下项按显示顺序处理。泳道调整状态列对齐、分组边界和当前筛选范围的完成数量。

正式客户端原为独立插件仓库的 0.1.29。本轮在该版本上移植首页改动，保留成员头像、共享方法、小队、项目公共资源、执行日志及配置页；没有用 Multica 工作区的 0.1.20 覆盖正式客户端。

## 验证

- `node --check ccgui-plugin/main.js` 通过。
- `CCGUI_HOST_PACKAGE=/Users/daichen/github/ccgui-plugin-personal-task-board/package.json node --test ccgui-plugin-tests/*.test.mjs`：113 项通过，0 失败、0 跳过。环境没有可用的 pnpm 命令，直接执行 package.json 中等价的测试命令。
- 新增首页回归验证布局保存、状态分组顺序、跨状态 Shift 连选、预览上下项与选中行一致；覆盖铃铛位置、Esc 关闭恢复焦点和视图设置开关。现有通知读归档、编辑、人工验收及协作测试继续通过。
- 隔离浏览器样例检查了浅色、480px 深色和通知浮层边界；正式 CC GUI 实测浅色桌面下的看板、通知浮层、列表下方预览及父子泳道。未切换正式客户端主题或单独调整正式窗口大小。
- 安装前后均显示 10 项任务及 13 条未读通知。仅切换视图和打开关闭预览与收件箱，没有创建、编辑或执行任务，没有改变验收与通知已读状态。结束恢复看板，通知、设置及预览关闭。
- 没有运行真实模型测试；未修改宿主客户端。仅插件改动，未运行 Multica 前后端或移动端测试。没有提交、推送或发布 Release。

## 交付与回滚

- 正式源码及安装入口：`/Users/daichen/github/ccgui-plugin-personal-task-board/ccgui-plugin/`。
- 同步安装来源：`/Users/daichen/ccgui-plugins/personal-task-board/`。
- 正式安装目录：`/Users/daichen/.ccgui-next/plugins/personal-task-board/`。
- 三处的 `main.js`、`manifest.json` 和 `README.md` 已逐字节核对一致。
- 已通过 CC GUI“插件 → 从本地目录安装”更新并验证生效。以后选择上述源码或同步安装来源可热重载，插件页可禁用或卸载。
- 更新前独立仓库文件备份在 `/Users/daichen/ccgui-plugins/backups/personal-task-board-before-home-redesign-0.1.29/`；其中 `ccgui-plugin/` 可重新安装以回滚。备份不包含任务文档，本轮没有改变其数据格式。
