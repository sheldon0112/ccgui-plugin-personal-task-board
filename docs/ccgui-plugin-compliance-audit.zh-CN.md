# 个人任务看板插件规范核查

核查日期：2026-10-29（Asia/Shanghai）

核查版本：personal-task-board 0.1.18

范围：PluginContext 能力边界、权限、交付和本地安装。仅审计，未修改或重新安装插件。

## 结论

在本次核查范围内符合要求，未发现直接网络、进程、私有宿主接口或浏览器存储调用。当前为手写单文件 ESM，无需引入模板构建。交付中没有独立 styles.css，样式由插件组件的 style 元素承载；这是交付形式差异，不是缺失必需文件。宿主加载器明确允许 styles.css 不存在。

## 示例仓库核实

参考仓库：https://github.com/zhukunpenglinyutong/ccgui-plugin-react-doctor

- 当前 package.json 版本 0.3.1，提供 validate 和 build 脚本。
- vite.config.ts 使用 outDir: "."，将 main.js 和 styles.css 输出到仓库根目录，与已有 manifest.json 同层；该示例当前不是 dist/ 安装。
- README 明确从仓库根安装。其他模板是否安装 dist/ 应以其实际输出目录为准，原则始终是选择包含 manifest.json 的交付目录。
- src/main.tsx 通过 ctx.ui.registerPanelTab 注册面板；进程出口 src/caps.ts 使用 ctx.bridge.invoke("plugin_exec_run", ...)；manifest 声明 exec:npx 和 exec:node；KV 通过 ctx.storage。
- 本次只读取示例源码，没有安装依赖、构建或执行下载的示例代码。

## 能力与权限对应

| 当前插件能力 | 调用入口 | manifest 权限 | 结果 |
| --- | --- | --- | --- |
| 中央页签、打开页签 | ctx.ui.registerCenterTab / openCenterTab | ui:center-tab | 符合 |
| 侧边栏入口 | ctx.ui.registerSidebarNav | ui:sidebar-entry | 符合 |
| KV 视图、草稿和快捷操作 | ctx.storage.get / set | storage | 符合 |
| 任务和项目文档 | ctx.documentStorage.readText / writeTextAtomic | plugin.storage | 符合，使用条件写入版本 |
| 选择与授权附件 | ctx.assets.grantFile | assets:directory | 符合，由用户操作触发 |
| 定位文件 | ctx.shell.revealPath | plugin.storage 或 assets:directory | 符合，宿主验证路径授权 |
| 工作区列表 | ctx.workspaces.list | host:workspace | 符合 |
| 引擎和模型目录 | ctx.models.listEngines / catalog | host:models | 符合 |
| 原生会话开始、停止、打开 | ctx.sessions.startRun / interruptRun / selectSession | host:session | 符合，使用专用宿主出口 |
| 运行回执 | ctx.events.on | events | 符合，订阅插件自身主题 |

九项权限均存在于当前 SDK 权限目录，且能对应实际使用。插件没有注册命令或状态栏，因此无需声明 ui:command / ui:status-bar。未使用通用网络或外部命令，所以无需添加 network:* / exec:*。

会话执行会由宿主启动 AI 工具，可能由该工具访问网络；它经过 host:session 授权，不等于插件直接执行任意命令或直接出网。用户在原生会话中的工具权限仍由宿主控制，不能把本结论解读为 AI 执行没有网络或文件能力。

## 普通浏览器 API 与样式

- ctx.react 提供组件和 hooks；main.js 无外部模块导入、JSX、eval 或 new Function。
- globalThis.crypto.randomUUID 用于本地标识；window.getSelection 用于插件文本选区；document.activeElement 用于预览焦点恢复。这些是普通渲染能力，不是宿主特权调用。
- querySelector/closest 从当前插件组件元素及 detail-body 内查找，不读取宿主 store、私有 Tauri 对象或其他插件数据。
- 内嵌 CSS 未发现远程 @import 或 HTTP(S) url 引用。当前组件渲染 style 元素，不调用 ctx.theme.injectCss，故无需声明 theme 权限。
- 若将来需要宿主全局主题修改或特权操作，仍需对应 PluginContext API 和权限；不能以普通 DOM 作为绕过宿主的出口。

## 交付、安装和清理

- 交付目录：~/ccgui-plugins/personal-task-board/，包含 manifest.json、main.js 和 README.md。
- main.js 默认导出 activate(ctx)，manifest tier=js，id/version 合法，sdkVersion=>=0.3.19。
- 样式文件为可选；“三件套”是模板常见产物，不是当前手写插件必须构建才能具备的格式。
- 从“插件 → 从本地目录安装”选择上述目录，修改后安装相同 ID 触发热重载。当前 README 已说明该流程。
- 注册入口由宿主追踪 disposer；activate 返回清理函数，清理控制器、视图和内部监听；运行回执订阅在 dispose 中取消。
- 源码、安装来源目录与实际安装目录中的 main.js、manifest.json、README.md 已逐字节核对一致；各交付文件均小于 16 MiB。

## 验证结果与限制

- manifest 语法、九项权限、入口、文件大小和交付一致性检查通过。
- 静态检查未发现 fetch/XMLHttpRequest/WebSocket、Node 文件/进程模块、私有 Tauri、localStorage/sessionStorage、动态代码执行和远程样式引用。
- node --check ccgui-plugin/main.js 通过。
- node --test ccgui-plugin-tests/board.test.mjs ccgui-plugin-tests/ui.test.mjs：82 项通过，0 失败、0 跳过，未调用真实模型。
- 不适用：插件没有自己的模板 package.json 或构建流程，因此未执行 pnpm validate / pnpm build；没有为满足模板形式而添加空 styles.css。
- 这是针对所列规范的代码与交付审计，不代替独立的全面安全评估，也未验证所有旧版本宿主的运行兼容性。

## 原始依据

- [React Doctor README](https://github.com/zhukunpenglinyutong/ccgui-plugin-react-doctor/blob/main/README.md)
- [示例构建配置](https://github.com/zhukunpenglinyutong/ccgui-plugin-react-doctor/blob/main/vite.config.ts)
- [示例授权进程出口](https://github.com/zhukunpenglinyutong/ccgui-plugin-react-doctor/blob/main/src/caps.ts)
- 本地宿主 packages/plugin-sdk/src/context.ts、spec/permissions.json。
- 本地宿主 src/features/plugins/runtime/context.ts 的 requirePermission 门禁，以及 loader.ts 对可选 styles.css、入口与清理的处理。
