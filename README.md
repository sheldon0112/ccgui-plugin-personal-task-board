# CC GUI 个人任务看板

本地管理个人任务，通过 CC GUI 原生会话执行，结果由人工验收。当前版本 **0.1.18**。

## 安装

在 CC GUI 中选择“插件 → 从本地目录安装”，选择本仓库的 **ccgui-plugin/** 目录（包含 manifest.json 的那一层）。这是手写单文件 ESM 插件，不需要构建，也不必安装开发依赖。

修改后重新安装同一目录即可热重载。更新前请先结束看板任务；插件页可禁用或卸载。

## 功能与权限

支持看板、列表、甘特、父子泳道、项目共享说明、原生会话执行与返工、人工验收、任务通知、讨论结论、选区引用和历史轮次重试。

宿主能力均经 PluginContext；权限在 ccgui-plugin/manifest.json 声明。任务和设置保存在本机插件隔离存储。附件保留原路径，AI 工具的文件与网络能力由宿主控制。

完整功能和使用限制见 [插件使用说明](ccgui-plugin/README.md)，规范核查见 [审计报告](docs/ccgui-plugin-compliance-audit.zh-CN.md)。

## 开发验证

开发依赖仅用于测试，不是插件运行依赖。以下命令适用于 macOS / Linux：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

测试脚本将 CCGUI_HOST_PACKAGE 指向本仓库 package.json，独立加载 React 和 jsdom，无需同级宿主开发仓库。Windows 可先将该环境变量设为本仓库 package.json 的绝对路径，再执行 node --test ccgui-plugin-tests/*.test.mjs。

测试使用假的会话接口，不调用真实模型。此仓库没有模板构建步骤，安装目录始终是 ccgui-plugin/。

## 目录

- ccgui-plugin/：可直接安装的插件。
- ccgui-plugin-tests/：控制器与 React 组件测试。
- docs/：开发、验收及规范核查记录，历史版本记录保留原项目中的路径供追溯。

本插件参考 Multica 的任务流程，未提取其原版界面或业务代码。
