import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import activate from "../ccgui-plugin/main.js";

const require = createRequire(process.env.CCGUI_HOST_PACKAGE || new URL("../../personal_desktop-cc-gui/package.json", import.meta.url));
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
const { Simulate } = require("react-dom/test-utils");
const button = (text, root = document) => [...root.querySelectorAll("button")].find((node) => node.textContent === text || node.getAttribute("aria-label") === text);
const field = (text) => [...document.querySelectorAll("label")].find((node) => node.querySelector("span")?.textContent === text).querySelector("input,textarea,select");
async function settle() { await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); }
async function click(text, scope = document) { await act(async () => { Simulate.click(button(text, scope)); }); await settle(); }
async function change(text, value) { await act(async () => { Simulate.change(field(text), { target: { value } }); }); await settle(); }

async function switchLayout(layout, scope = document) {
  const name = { board: "看板", list: "列表", gantt: "甘特", swimlane: "泳道" }[layout];
  await act(async () => Simulate.click(scope.querySelector(`[aria-label="切换${name}布局"]`)));
  await settle();
}

test("首页布局切换持久保存，列表跨状态连选和预览遵循显示顺序且不写任务", async () => {
  const host = createTabHost(); const prefs = new Map(); let writes = 0;
  const base = { description: "需求", criteria: "验收", workspacePath: "/repo", engine: "codex", model: "", recovery: false, runs: [], createdAt: "2026-10-30", updatedAt: "2026-10-30" };
  const tasks = [{ ...base, id: "done", title: "高优先级已完成", priority: "high", status: "done" }, { ...base, id: "todo", title: "低优先级待办", priority: "low", status: "todo" }, { ...base, id: "review", title: "中优先级待验收", priority: "medium", status: "review" }];
  const ctx = { pluginId: "personal-task-board", host: { isWeb: false }, react: React, ui: host.ui, storage: { get: async (key) => prefs.get(key), set: async (key, value) => prefs.set(key, value) }, events: { on: () => () => {} }, documentStorage: { readText: async () => ({ content: JSON.stringify({ schemaVersion: 1, tasks }), version: "1" }), writeTextAtomic: async () => { writes++; throw Error("不应修改任务"); } }, workspaces: { list: async () => [] }, models: { listEngines: async () => [], catalog: async () => ({ engines: [], errors: [] }) }, sessions: {} };
  const dispose = activate(ctx); const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(host.Component))); await settle();
    assert.equal(container.querySelector(".ptb-notice-badge"), null);
    await switchLayout("list", container);
    assert.equal(prefs.get("board-view").layout, "list");
    assert.equal(container.querySelector('[aria-label="切换列表布局"]').getAttribute("aria-pressed"), "true");
    assert.deepEqual([...container.querySelectorAll(".ptb-task-row .ptb-task-title")].map((node) => node.textContent), ["低优先级待办", "中优先级待验收", "高优先级已完成"]);
    assert.deepEqual([...container.querySelectorAll(".ptb-list-group")].map((node) => node.textContent), ["待办 · 1", "待验收 · 1", "已完成 · 1"]);
    await act(async () => Simulate.change(container.querySelector('[aria-label="选择任务 低优先级待办"]'), { target: { checked: true } })); await settle();
    await act(async () => Simulate.change(container.querySelector('[aria-label="选择任务 高优先级已完成"]'), { target: { checked: true }, nativeEvent: { shiftKey: true } })); await settle();
    assert.equal(container.querySelectorAll(".ptb-task-row input:checked").length, 3);
    await act(async () => Simulate.click(container.querySelector('[aria-label="预览任务 低优先级待办"]'))); await settle();
    assert.equal(container.querySelector(".ptb-preview h1").textContent, "低优先级待办");
    await click("下一项", container.querySelector(".ptb-preview"));
    assert.equal(container.querySelector(".ptb-preview h1").textContent, "中优先级待验收");
    assert.equal(container.querySelector(".ptb-row-selected .ptb-task-title").textContent, "中优先级待验收");
    await click("关闭预览");
    await switchLayout("swimlane", container); assert.ok(container.querySelector(".ptb-lane"));
    await switchLayout("gantt", container); assert.ok(container.querySelector(".ptb-gantt"));
    await switchLayout("board", container); assert.ok(container.querySelector(".ptb-columns"));
    assert.equal(writes, 0);
  } finally { await act(async () => root.unmount()); dispose(); container.remove(); }
});

function createTabHost() {
  const tabs = new Map();
  const listeners = new Set();
  let active = "board";
  return {
    active: () => active,
    ui: {
      registerCenterTab(def) { tabs.set(def.key, def.component); },
      registerSidebarNav(def) { assert.equal(def.label(), "个人任务看板"); },
      openCenterTab(key) { assert.ok(tabs.has(key)); active = key; for (const listener of listeners) listener(); },
    },
    Component() {
      const key = React.useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => active);
      return React.createElement(tabs.get(key));
    },
  };
}

test("真实 React 挂载：填写任务、启动、查看结果、验收，并保留需求文本", async () => {
  const host = createTabHost();
  let eventHandler;
  let stored = null;
  let revision = 0;
  const starts = [];
  const opens = [];
  const ctx = {
    pluginId: "personal-task-board", host: { isWeb: false }, react: React,
    storage: { get: async () => null, set: async () => {} },
    ui: host.ui,
    events: { on(topic, listener) { eventHandler = listener; return () => {}; } },
    documentStorage: {
      async readText() { return stored ? { content: stored, version: String(revision) } : null; },
      async writeTextAtomic(path, content, version) { assert.equal(version, revision ? String(revision) : null); stored = content; return { version: String(++revision) }; },
    },
    workspaces: { list: async () => [{ path: "/repo", name: "测试工作区" }] },
    models: { listEngines: async () => [{ id: "codex", enabled: true, available: true }], catalog: async () => ({ engines: [{ engine: { id: "codex" }, sources: [{ id: "codex:cli", kind: "cli", models: [{ id: "model-a", name: "测试模型" }] }] }], errors: [] }) },
    sessions: { startRun: async (def) => { starts.push(def); return { runId: `r${starts.length}`, sessionId: `s${starts.length}` }; }, selectSession: async (...args) => opens.push(args) },
  };
  const dispose = activate(ctx);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(host.Component))); await settle();
    assert.equal(button("创建第一项任务").disabled, false);
    await click("创建第一项任务");
    assert.equal(host.active(), "task-editor");
    assert.equal(document.querySelector('.ptb-root[aria-label="个人任务看板"]'), null);
    assert.equal(document.querySelector(".ptb-columns"), null);
    await change("标题", "验收 <script> 标签显示");
    await change("需求", "中文与 emoji 🧩\n<script>不作为 HTML</script>");
    await change("验收标准", "内容完整保留");
    assert.ok([...field("模型").options].some((node) => node.textContent === "测试模型"));
    await change("模型", JSON.stringify(["", "model-a"]));
    const write = ctx.documentStorage.writeTextAtomic;
    ctx.documentStorage.writeTextAtomic = async () => { throw new Error("保存失败测试"); };
    await act(async () => Simulate.submit(document.querySelector("form"))); await settle();
    assert.equal(host.active(), "task-editor");
    assert.equal(field("标题").value, "验收 <script> 标签显示");
    assert.match(document.querySelector('[role="alert"]').textContent, /保存失败测试/);
    ctx.documentStorage.writeTextAtomic = write;
    await act(async () => Simulate.submit(document.querySelector("form"))); await settle();
    assert.equal(host.active(), "board");
    assert.equal(document.querySelector("form"), null);
    assert.equal(window.getComputedStyle(document.querySelector(".ptb-columns")).alignItems, "stretch");
    assert.equal(window.getComputedStyle(document.querySelector(".ptb-board")).overflow, "hidden");
    for (const column of document.querySelectorAll(".ptb-column")) {
      assert.equal(window.getComputedStyle(column).minHeight, "0");
      assert.equal(window.getComputedStyle(column.querySelector(".ptb-column-content")).overflowY, "auto");
    }
    await act(async () => Simulate.click(document.querySelector('button[aria-label="折叠待办"]'))); await settle();
    assert.equal(document.querySelector('button[aria-label="展开待办"]').getAttribute("aria-expanded"), "false");
    assert.equal(document.querySelector('section[aria-label="待办"] .ptb-column-content').hidden, true);
    assert.ok(document.querySelector('section[aria-label="执行中"] .ptb-column-content'));
    await act(async () => Simulate.click(document.querySelector('button[aria-label="展开待办"]'))); await settle();
    assert.equal(document.querySelector('section[aria-label="待办"] .ptb-column-content').hidden, false);
    let card = document.querySelector("article");
    assert.equal(card.getAttribute("aria-label"), "验收 <script> 标签显示");
    await click("任务面板配置"); await click("视图偏好");
    await act(async () => Simulate.change([...container.querySelectorAll(".ptb-card-fields label")].find((node) => node.textContent === "需求与验收").querySelector("input"), { target: { checked: true } })); await settle();
    await click("返回任务面板");
    card = document.querySelector("article");
    assert.ok(card.textContent.includes("中文与 emoji 🧩\n<script>不作为 HTML</script>"));
    assert.equal(document.querySelector("script"), null);
    await click("开始执行", card);
    assert.equal(starts.length, 1);
    assert.equal(button("停止执行").disabled, false);
    await act(async () => { eventHandler({ engine: "codex", workspacePath: "/repo", runId: "r1", sessionId: "s1", kind: "done", error: null }); });
    await settle();
    assert.ok(button("验收通过"));
    card = document.querySelector("article");
    await click("查看结果", card);
    assert.deepEqual(opens, [["codex", "s1", "/repo"]]);
    await click("验收不通过", card);
    assert.equal(host.active(), "task-feedback");
    await change("具体偏差与修正要求", "占位图未居中，请水平居中并保持中文内容完整。");
    await click("取消");
    assert.equal(JSON.parse(stored).tasks[0].feedbacks.length, 0);
    await click("验收不通过");
    await change("具体偏差与修正要求", "占位图未居中，请水平居中并保持中文内容完整。");
    await act(async () => Simulate.submit(document.querySelector("form"))); await settle();
    assert.equal(host.active(), "board");
    assert.equal(JSON.parse(stored).tasks[0].description, "中文与 emoji 🧩\n<script>不作为 HTML</script>");
    assert.equal(JSON.parse(stored).tasks[0].criteria, "内容完整保留");
    assert.equal(JSON.parse(stored).tasks[0].status, "todo");
    assert.ok(button("补充反馈"));
    ctx.assets = { grantFile: async () => ({ path: "/tmp", relativePath: "反馈截图.png", grantId: "feedback-grant" }) };
    await click("补充反馈");
    await act(async () => Simulate.click(document.querySelector('button[aria-label="上传验收反馈附件"]'))); await settle();
    assert.equal(field("具体偏差与修正要求").required, false);
    await act(async () => Simulate.submit(document.querySelector("form"))); await settle();
    assert.equal(JSON.parse(stored).tasks[0].feedbacks[1].files[0].path, "/tmp/反馈截图.png");
    await click("执行修正");
    assert.equal(starts.length, 2);
    assert.match(starts[1].prompt, /占位图未居中/);
    assert.match(starts[1].prompt, /反馈截图.png/);
    await act(async () => { eventHandler({ engine: "codex", workspacePath: "/repo", runId: "r2", sessionId: "s2", kind: "done", error: null }); }); await settle();
    assert.equal(JSON.parse(stored).tasks[0].status, "review");
    card = document.querySelector("article");
    await click("验收通过", card);
    assert.equal(JSON.parse(stored).tasks[0].status, "done");
    assert.ok(document.querySelector('section[aria-label="已完成"] article'));
    assert.equal(document.querySelector('section[aria-label="已完成"] article').textContent.includes("等待验收"), false);
    assert.equal(JSON.parse(stored).tasks[0].model, "model-a");
    assert.equal(JSON.parse(stored).tasks[0].runs.length, 2);
    assert.ok(JSON.parse(stored).tasks[0].feedbacks[0].resolvedAt);
    assert.equal(JSON.parse(stored).tasks[0].runs[0].sessionId, "s1");
    await act(async () => Simulate.change(document.querySelector('[aria-label="搜索任务"]'), { target: { value: "验收" } })); await settle();
    await act(async () => Simulate.click(document.querySelector('[aria-label="折叠待办"]'))); await settle();
    await act(async () => Simulate.click(document.querySelector(".ptb-task-title"))); await settle();
    assert.equal(host.active(), "task-details");
    assert.ok(document.querySelector(".ptb-detail-body").textContent.includes("历次执行与输入"));
    assert.equal(document.querySelectorAll("pre").length, 2);
    assert.ok(document.querySelector(".ptb-detail-body").textContent.includes("反馈截图.png"));
    await click("打开本轮会话");
    assert.equal(opens.at(-1)[1], "s2");
    await change("评论内容", "普通讨论 <script>安全文本</script>");
    const beforeComments = ctx.documentStorage.writeTextAtomic;
    ctx.documentStorage.writeTextAtomic = async () => { throw Error("评论保存失败"); };
    await act(async () => Simulate.submit(document.querySelector(".ptb-comments form"))); await settle();
    assert.equal(field("评论内容").value, "普通讨论 <script>安全文本</script>");
    assert.match(document.querySelector('[role="alert"]').textContent, /评论保存失败/);
    ctx.documentStorage.writeTextAtomic = beforeComments;
    await act(async () => Simulate.submit(document.querySelector(".ptb-comments form"))); await settle();
    assert.equal(starts.length, 2);
    assert.equal(JSON.parse(stored).tasks[0].comments.length, 1);
    assert.equal(document.querySelector("script"), null);
    await click("回复 Agent");
    await change("评论内容", "第3条验收未通过，导出文件缺少金额列，请补齐并验证。");
    assert.ok(button("发送并交给 Agent"));
    await act(async () => Simulate.submit(document.querySelector(".ptb-comments form"))); await settle();
    assert.equal(starts.length, 3);
    assert.match(starts[2].prompt, /本轮重点评论：\n第3条验收未通过/);
    assert.equal(field("评论内容").value, "");
    assert.ok(document.querySelector(".ptb-comments").textContent.includes("Agent 处理中"));
    await act(async () => eventHandler({ engine: "codex", workspacePath: "/repo", runId: "r3", sessionId: "s3", kind: "done" })); await settle();
    assert.ok(document.querySelector(".ptb-comments").textContent.includes("处理结束，待验收"));
    await click("返回看板");
    await click("验收通过");
    assert.equal(document.querySelector('[aria-label="搜索任务"]').value, "验收");
    assert.ok(document.querySelector('[aria-label="展开待办"]'));
    await act(async () => Simulate.click(document.querySelector('[aria-label="筛选待修正"]'))); await settle();
    assert.equal(document.querySelectorAll("article").length, 0);
    await act(async () => Simulate.click(document.querySelector('[aria-label="筛选全部"]'))); await settle();
    let finishCatalog;
    ctx.models.catalog = () => new Promise((resolve) => { finishCatalog = resolve; });
    await click("编辑");
    assert.equal(host.active(), "task-editor");
    assert.equal(field("模型").selectedOptions[0].textContent, "model-a（正在读取…）");
    await act(async () => finishCatalog({ engines: [{ engine: { id: "codex" }, sources: [{ id: "codex:cli", kind: "cli", models: [{ id: "model-a", name: "测试模型" }] }] }], errors: [] })); await settle();
    assert.equal(field("模型").selectedOptions[0].textContent, "测试模型");
    await click("取消");
    assert.equal(host.active(), "board");
    await click("＋ 新建任务");
    assert.equal(field("标题").value, "");
    await click("取消");
  } finally { await act(async () => root.unmount()); container.remove(); dispose(); }
});

test("附件 UI：分区选择、去重、移除、取消、错误、保存后重新编辑", async () => {
  const host = createTabHost();
  let stored = null;
  let revision = 0;
  let pick = null;
  let reveal = null;
  let choose;
  const ctx = {
    pluginId: "personal-task-board", host: { isWeb: false }, react: React,
    storage: { get: async () => null, set: async () => {} },
    ui: host.ui,
    events: { on() { return () => {}; } },
    documentStorage: {
      async readText() { return stored ? { content: stored, version: String(revision) } : null; },
      async writeTextAtomic(path, content, version) { assert.equal(version, revision ? String(revision) : null); stored = content; return { version: String(++revision) }; },
    },
    assets: { async grantFile(options) { choose = options; if (pick instanceof Error) throw pick; return pick; } },
    shell: { async revealPath(path) { reveal = path; } },
    workspaces: { list: async () => [{ path: "/repo", name: "测试工作区" }] },
    models: { listEngines: async () => [{ id: "codex", enabled: true, available: true }], catalog: async () => ({ engines: [], errors: [] }) },
  };
  const dispose = activate(ctx);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const upload = async (label) => { await act(async () => { Simulate.click(document.querySelector(`button[aria-label="上传${label}附件"]`)); }); await settle(); };
  const list = (label) => document.querySelector(`ul[aria-label="${label}附件"]`);
  try {
    await act(async () => root.render(React.createElement(host.Component))); await settle();
    await click("任务面板配置");
    await act(async () => Simulate.change([...container.querySelectorAll(".ptb-card-fields label")].find((node) => node.textContent === "需求与验收").querySelector("input"), { target: { checked: true } })); await settle();
    await click("返回任务面板");
    const select = document.querySelector(".ptb-toolbar select");
    const search = document.querySelector('.ptb-toolbar input[type="search"]');
    assert.equal(window.getComputedStyle(select).height, "36px");
    assert.equal(window.getComputedStyle(search).height, "36px");
    for (const label of document.querySelectorAll('.ptb-tools .ptb-actions>label')) {
      const style = window.getComputedStyle(label); assert.equal(style.display, "inline-flex"); assert.equal(style.alignItems, "center"); assert.equal(style.marginTop, "0px");
    }

    assert.equal(window.getComputedStyle(select.parentElement).display, "flex");
    const computed = window.getComputedStyle(select);
    const properties = ["height", "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderRadius", "borderTopWidth", "borderTopColor", "backgroundColor", "fontSize"];
    const expected = Object.fromEntries(properties.map((property) => [property, computed[property]]));
    await click("创建第一项任务");
    for (const label of ["工作区", "优先级", "引擎", "模型"]) {
      const actual = window.getComputedStyle(field(label));
      for (const property of properties) {
        assert.equal(actual[property], expected[property], `${label} 的 ${property} 应与列表控件一致`);
      }
    }
    await change("标题", "仅附件任务");
    pick = { path: "/files", relativePath: "需求 🧩.pdf", grantId: "g1" };
    await upload("需求");
    assert.equal(choose.title, "选择需求附件");
    assert.equal(list("需求").children.length, 1);
    assert.equal(list("验收标准").children.length, 0);
    assert.equal(field("需求").required, false);
    assert.equal(field("验收标准").required, true);
    await upload("需求");
    assert.equal(list("需求").children.length, 1);
    pick = null; await upload("需求");
    assert.equal(list("需求").children.length, 1);
    pick = new Error("选取失败"); await upload("验收标准");
    assert.match(document.querySelector('[role="alert"]').textContent, /选取失败/);
    assert.equal(button("保存任务").disabled, false);
    pick = { path: "/files", relativePath: "验收标准.xlsx", grantId: "g2" }; await upload("验收标准");
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.equal(field("验收标准").required, false);
    await act(async () => Simulate.click(document.querySelector('button[aria-label="移除需求附件 需求 🧩.pdf"]'))); await settle();
    assert.equal(list("需求").children.length, 0);
    assert.equal(field("需求").required, true);
    pick = { path: "/files", relativePath: "需求 🧩.pdf", grantId: "g1" }; await upload("需求");
    await act(async () => Simulate.submit(document.querySelector("form"))); await settle();
    const task = JSON.parse(stored).tasks[0];
    assert.equal(task.descriptionFiles[0].path, "/files/需求 🧩.pdf");
    assert.equal(task.criteriaFiles[0].path, "/files/验收标准.xlsx");
    await click("需求 🧩.pdf"); assert.equal(reveal, "/files/需求 🧩.pdf");
    await click("编辑");
    assert.equal(list("需求").children.length, 1);
    assert.equal(list("验收标准").children.length, 1);
    await click("取消"); await click("重新载入");
    assert.equal(JSON.parse(stored).tasks[0].descriptionFiles[0].name, "需求 🧩.pdf");
  } finally { await act(async () => root.unmount()); container.remove(); dispose(); }
});

test("十项扩展 UI：字段、命名视图、批量、草稿、快捷操作、评论拆分与重复恢复", async () => {
  const host = createTabHost(); let stored = null; let revision = 0; const preferences = new Map(); const starts = [];
  const ctx = {
    pluginId: "personal-task-board", host: { isWeb: false }, react: React, ui: host.ui, sessions: {},
    storage: { get: async (key) => preferences.get(key), set: async (key, value) => { preferences.set(key, structuredClone(value)); } },
    events: { on() { return () => {}; } },
    documentStorage: { readText: async () => stored ? { content: stored, version: String(revision) } : null, writeTextAtomic: async (path, content, expected) => { assert.equal(expected, revision ? String(revision) : null); stored = content; return { version: String(++revision) }; } },
    workspaces: { list: async () => [{ path: "/repo", name: "测试工作区" }] },
    models: { listEngines: async () => [{ id: "codex", available: true, enabled: true }], catalog: async () => ({ engines: [], errors: [] }) },
    sessions: { startRun: async (def) => { starts.push(def); return { runId: "r", sessionId: "s" }; } },
  };
  const dispose = activate(ctx); const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const value = async (label, next) => { await act(async () => Simulate.change(document.querySelector(`[aria-label="${label}"]`), { target: { value: next } })); await settle(); };
  try {
    await act(async () => root.render(React.createElement(host.Component))); await settle(); await click("创建第一项任务");
    await change("标题", "扩展父任务"); await change("项目", "导出项目"); await change("需求", "导出金额列"); await change("验收标准", "金额列完整"); await change("标签（逗号分隔）", "导出,验收"); await change("截止日期", "2026-01-01");
    await act(async () => Simulate.submit(document.querySelector("form"))); await settle();
    const parent = JSON.parse(stored).tasks[0]; assert.equal(parent.dueDate, "2026-01-01");
    await value("任务排序", "due"); await click("任务面板配置"); await click("视图偏好"); await value("视图名称", "我的导出"); await click("保存当前视图"); await click("返回任务面板");
    assert.equal(preferences.get("board-view").savedViews[0].name, "我的导出");
    await click("选择筛选结果"); await value("批量优先级", "low"); await click("应用优先级"); assert.equal(JSON.parse(stored).tasks[0].priority, "low");
    await click("批量取消"); assert.equal(JSON.parse(stored).tasks[0].status, "cancelled"); await click("批量移回待办");
    await act(async () => Simulate.click(document.querySelector(".ptb-task-title"))); await settle();
    await change("评论内容", "/note 拆出格式校验"); await change("快捷操作名称", "格式备注"); await click("将当前评论保存为快捷操作");
    await click("返回看板"); await act(async () => Simulate.click(document.querySelector(".ptb-task-title"))); await settle();
    assert.equal(field("评论内容").value, "/note 拆出格式校验");
    await change("评论内容", ""); await click("格式备注"); assert.equal(field("评论内容").value, "/note 拆出格式校验");
    await act(async () => Simulate.submit(document.querySelector(".ptb-comments form"))); await settle(); assert.equal(starts.length, 0);
    await click("👍"); assert.equal(JSON.parse(stored).tasks[0].comments[0].reactions[0], "👍");
    await click("解决讨论"); assert.ok(document.querySelector(".ptb-resolved"));
    await act(async () => document.querySelector(".ptb-resolved>summary").click()); await settle();
    await click("重新打开讨论"); assert.equal(document.querySelector(".ptb-resolved"), null);
    await click("引用评论"); await change("评论内容", "/note 引用说明：仅金额列格式存在偏差");
    ctx.assets = { grantFile: async () => ({ path: "/tmp", relativePath: "证据.png", grantId: "evidence" }) };
    await act(async () => Simulate.click(document.querySelector('[aria-label="上传评论附件"]'))); await settle();
    await act(async () => Simulate.submit(document.querySelector(".ptb-comments form"))); await settle();
    assert.equal(JSON.parse(stored).tasks[0].comments[1].quote.text, "/note 拆出格式校验"); assert.equal(starts.length, 0);
    await value("附件类型", "image"); assert.ok(document.querySelector(".ptb-file-summary").textContent.includes("证据.png"));
    await click("拆为子任务"); assert.equal(host.active(), "task-editor"); assert.equal(field("父任务").value, parent.id);
    await change("标题", "扩展子任务"); await change("子任务阶段", "2"); await act(async () => Simulate.submit(document.querySelector("form"))); await settle();
    const child = JSON.parse(stored).tasks.find((task) => task.title === "扩展子任务"); assert.ok(child.sourceSnapshot);
    await click("扩展子任务"); assert.equal(host.active(), "task-details"); assert.ok(document.querySelector('[aria-label="任务关系"]').textContent.includes("查看拆分来源快照"));
    await value("原始任务", parent.id); await click("标记为重复"); assert.equal(JSON.parse(stored).tasks.find((task) => task.id === child.id).duplicateOf, parent.id);
    await click("不是重复"); assert.equal(JSON.parse(stored).tasks.find((task) => task.id === child.id).status, "todo");
    await click("返回看板"); await value("筛选项目", "其他"); assert.equal(document.querySelectorAll(".ptb-card").length, 0);
    const saved = preferences.get("board-view").savedViews[0]; await value("已保存视图", saved.id); assert.equal(document.querySelectorAll(".ptb-card").length, 2);
    await switchLayout("list"); assert.equal(document.querySelector(".ptb-columns"), null); assert.equal(document.querySelectorAll('[aria-label="任务列表"] tbody tr.ptb-task-row').length, 2);
    for (const label of ["显示子任务", "筛选优先级", "筛选标签", "筛选待验收", "筛选异常"]) assert.equal(document.querySelector(`[aria-label="${label}"]`), null);
    assert.ok(document.querySelector('.ptb-toolbar [aria-label="筛选项目"]'));
    await value("筛选项目", "导出项目"); assert.equal(document.querySelectorAll('[aria-label="任务列表"] tbody tr.ptb-task-row').length, 2);
    assert.ok(document.querySelector('[aria-label="执行统计"]').textContent.includes("0 次已结束运行"));
    await switchLayout("board");
    await act(async () => Simulate.click(document.querySelector('[aria-label="折叠待办"]'))); await settle();
    await act(async () => Simulate.click(document.querySelector('[aria-label="筛选待修正"]'))); await settle();
    await click("＋ 新建任务"); assert.equal(field("项目").value, "导出项目"); assert.equal(field("优先级").value, "medium"); assert.equal(field("标签（逗号分隔）").value, "");
    await change("标题", "筛选回归任务"); await change("需求", "应在待办可见并可执行"); await change("验收标准", "保存后可点击开始执行"); await change("项目", "新项目");
    await act(async () => Simulate.submit(document.querySelector("form"))); await settle();
    const createdCard = [...document.querySelectorAll('.ptb-card')].find((node) => node.getAttribute("aria-label") === "筛选回归任务"); assert.ok(createdCard);
    assert.equal(createdCard.closest('.ptb-column-content').hidden, false); assert.equal(button("开始执行", createdCard).disabled, false);
    assert.equal(preferences.get("board-view").project, ""); assert.equal(preferences.get("board-view").priority, undefined);
    await click("开始执行", createdCard); assert.equal(starts.length, 1);


  } finally { await act(async () => root.unmount()); container.remove(); dispose(); }
});

test.after(() => dom.window.close());

test("列表快捷编辑保存取消与失败保留；侧边预览导航、键盘和焦点恢复", async () => {
  const host = createTabHost(); let stored = null; let revision = 0; let fail = false;
  const ctx = {
    pluginId: "personal-task-board", host: { isWeb: false }, react: React, ui: host.ui, sessions: {},
    storage: { get: async () => null, set: async () => {} }, events: { on: () => () => {} },
    documentStorage: { readText: async () => stored ? { content: stored, version: String(revision) } : null, writeTextAtomic: async (_, content) => { if (fail) throw Error("磁盘失败"); stored = content; return { version: String(++revision) }; } },
    workspaces: { list: async () => [{ path: "/repo", name: "仓库" }] },
    models: { listEngines: async () => [{ id: "codex", enabled: true, available: true }], catalog: async () => ({ engines: [], errors: [] }) },
  };
  const dispose = activate(ctx); const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const byLabel = (label) => container.querySelector(`[aria-label="${label}"]`);
  try {
    await act(async () => root.render(React.createElement(host.Component))); await settle();
    for (const title of ["第一项", "第二项"]) {
      await click(title === "第一项" ? "创建第一项任务" : "＋ 新建任务");
      await change("标题", title); await change("需求", "需求内容"); await change("验收标准", "验收内容");
      await act(async () => Simulate.submit(container.querySelector("form"))); await settle();
    }
    await switchLayout("list", container);
    await act(async () => Simulate.click(byLabel("编辑第一项的标题"))); await settle();
    await act(async () => Simulate.change(byLabel("修改标题"), { target: { value: "新标题" } }));
    const form = byLabel("修改标题").closest("form"); fail = true;
    await act(async () => Simulate.submit(form)); await settle();
    assert.equal(byLabel("修改标题").value, "新标题"); assert.match(form.textContent, /磁盘失败/);
    fail = false; await act(async () => Simulate.submit(form)); await settle();
    assert.equal(JSON.parse(stored).tasks[0].title, "新标题");
    await act(async () => Simulate.click(byLabel("编辑新标题的标题"))); await settle();
    await act(async () => Simulate.change(byLabel("修改标题"), { target: { value: "取消内容" } }));
    await act(async () => Simulate.keyDown(byLabel("修改标题"), { key: "Escape" })); await settle();
    assert.equal(byLabel("修改标题"), null); assert.equal(JSON.parse(stored).tasks[0].title, "新标题");
    const opener = byLabel("预览任务 新标题"); opener.focus();
    await act(async () => Simulate.click(opener)); await settle();
    const panel = byLabel("任务侧边预览"); assert.ok(panel); assert.ok(byLabel("任务列表")); assert.equal(host.active(), "board");
    const previous = button("上一项", panel); const next = button("下一项", panel);
    assert.equal(previous.disabled || next.disabled, true);
    await act(async () => Simulate.click(previous.disabled ? next : previous)); await settle();
    assert.equal(panel.querySelector("h1").textContent, "第二项");
    await act(async () => Simulate.keyDown(panel, { key: "Escape" })); await settle();
    assert.equal(byLabel("任务侧边预览"), null); assert.equal(document.activeElement, opener);
  } finally { await act(async () => root.unmount()); dispose(); container.remove(); }
});

test("通知已读归档与恢复；甘特与列表共用数据，未排期任务可预览", async () => {
  const host = createTabHost(); let revision = 1;
  const task = { id: "timeline", title: "跨年任务", description: "需求", criteria: "验收", priority: "high", workspacePath: "/repo", engine: "codex", model: "", createdAt: "2026-10-29", updatedAt: "2026-10-29", recovery: false, status: "review", startDate: "2026-12-30", dueDate: "2027-01-02", runs: [{ id: "run", engine: "codex", model: "", workspacePath: "/repo", startedAt: "2026-10-29T01:00:00Z", endedAt: "2026-10-29T01:01:00Z", outcome: "ended", runId: "run", sessionId: "session" }] };
  let stored = JSON.stringify({ schemaVersion: 1, tasks: [task, { ...task, id: "unscheduled", title: "未排期任务", startDate: "", dueDate: "", runs: [] }] });
  const ctx = {
    pluginId: "personal-task-board", host: { isWeb: false }, react: React, ui: host.ui, sessions: {},
    storage: { get: async () => null, set: async () => {} }, events: { on: () => () => {} },
    documentStorage: { readText: async () => ({ content: stored, version: String(revision) }), writeTextAtomic: async (_, content) => { stored = content; return { version: String(++revision) }; } },
    workspaces: { list: async () => [{ path: "/repo", name: "仓库" }] }, models: { listEngines: async () => [], catalog: async () => ({ engines: [], errors: [] }) },
  };
  const dispose = activate(ctx); const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(host.Component))); await settle();
    const notices = container.querySelector(".ptb-notices"); assert.match(notices.querySelector("summary").textContent, /1 条未读/);
    await click("标为已读", notices); assert.match(notices.querySelector("summary").textContent, /0 条未读/);
    await click("归档通知", notices); assert.match(notices.textContent, /暂无通知/);
    await click("查看已归档通知", notices); await click("恢复通知", notices); await click("查看收件箱", notices);
    assert.equal(button("标为未读", notices).disabled, false); assert.equal(JSON.parse(stored).tasks[0].status, "review");
    await click("查看任务", notices); assert.ok(container.querySelector('[aria-label="任务侧边预览"]')); await click("关闭预览");
    await switchLayout("gantt", container);
    const gantt = container.querySelector('[aria-label="甘特时间轴"]'); assert.ok(gantt); assert.match(gantt.textContent, /2026-12-30/); assert.match(gantt.textContent, /2027-01-02/); assert.match(gantt.textContent, /未排期任务/);
    await click("跨年任务", gantt); assert.equal(container.querySelector('[aria-label="任务侧边预览"] h1').textContent, "跨年任务"); await click("关闭预览");
    await switchLayout("list", container);
    assert.equal(container.querySelectorAll("tbody tr.ptb-task-row").length, 2);
  } finally { await act(async () => root.unmount()); dispose(); container.remove(); }
});


test("精简卡片、快捷键输入隔离和父子泳道共用任务且不触发执行", async () => {
  const host = createTabHost(); const prefs = new Map(); let writes = 0;
  const base = { description: "需求正文", criteria: "验收正文", priority: "high", workspacePath: "/repo", engine: "codex", model: "model-a", createdAt: "2026-10-29", updatedAt: "2026-10-29", status: "todo", recovery: false, runs: [], project: "独立项目" };
  const tasks = [{ ...base, id: "p", title: "父任务" }, { ...base, id: "c", title: "子任务", parentId: "p" }, { ...base, id: "g", title: "孙任务", parentId: "c" }, { ...base, id: "s", title: "独立事项" }];
  const ctx = {
    pluginId: "personal-task-board", host: { isWeb: false }, react: React, ui: host.ui,
    storage: { get: async (key) => prefs.get(key), set: async (key, value) => prefs.set(key, value) }, events: { on: () => () => {} },
    sessions: { startRun: async () => { throw Error("不应启动模型"); } },
    documentStorage: { readText: async () => ({ content: JSON.stringify({ schemaVersion: 1, tasks }), version: "1" }), writeTextAtomic: async () => { writes++; throw Error("不应写入任务"); } },
    workspaces: { list: async () => [{ path: "/repo", name: "仓库" }] },
    models: { listEngines: async () => [{ id: "codex", enabled: true, available: true }], catalog: async () => ({ engines: [], errors: [] }) },
  };
  const dispose = activate(ctx); const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const label = (name) => container.querySelector(`[aria-label="${name}"]`);
  const key = async (target, value, props = {}) => { await act(async () => Simulate.keyDown(target, { key: value, ...props })); await settle(); };
  const value = async (name, text) => { await act(async () => Simulate.change(label(name), { target: { value: text } })); await settle(); };
  try {
    await act(async () => root.render(React.createElement(host.Component))); await settle();
    const card = label("父任务"); assert.equal(card.querySelector(".ptb-engine"), null); assert.equal(card.querySelector(".ptb-path"), null); assert.match(card.textContent, /项目 独立项目/); assert.doesNotMatch(card.textContent, /需求正文/);
    await click("任务面板配置");
    const model = [...container.querySelectorAll(".ptb-card-fields label")].find((node) => node.textContent === "模型").querySelector("input");
    await act(async () => Simulate.change(model, { target: { checked: true } })); await settle(); await click("返回任务面板"); assert.match(label("父任务").textContent, /model-a/); assert.equal(prefs.get("board-view").cardFields.model, true);
    await key(label("个人任务看板"), "/"); assert.equal(document.activeElement, label("搜索任务"));
    await key(label("搜索任务"), "c"); assert.equal(host.active(), "board");
    await key(label("个人任务看板"), "c", { isComposing: true }); await key(label("个人任务看板"), "c", { ctrlKey: true }); assert.equal(host.active(), "board");
    await act(async () => Simulate.click(label("查看任务详情 父任务"), { shiftKey: true })); await settle();
    assert.ok(label("任务侧边预览")); await key(label("任务侧边预览"), "j"); assert.equal(label("任务侧边预览").querySelector("h1").textContent, "子任务");
    await key(label("任务侧边预览"), "k"); assert.equal(label("任务侧边预览").querySelector("h1").textContent, "父任务"); await key(label("任务侧边预览"), "Escape");
    await switchLayout("swimlane"); assert.equal(container.querySelectorAll(".ptb-lane").length, 2); assert.equal(container.querySelectorAll(".ptb-swimlanes .ptb-card").length, 4);
    await act(async () => Simulate.click(label("折叠泳道 父任务"))); await settle(); assert.equal(container.querySelectorAll(".ptb-swimlanes .ptb-card").length, 1); assert.deepEqual(prefs.get("board-view").collapsedLanes, ["p"]);
    await act(async () => Simulate.click(label("展开泳道 父任务"))); await settle();
    await value("搜索任务", "孙任务"); assert.equal(container.querySelectorAll(".ptb-lane").length, 1); assert.equal(container.querySelectorAll(".ptb-swimlanes .ptb-card").length, 1); assert.ok(label("泳道 父任务"));
    await click("查看父任务"); assert.equal(label("任务侧边预览").querySelector("h1").textContent, "父任务"); await key(label("任务侧边预览"), "Escape");
    await key(label("个人任务看板"), "c"); assert.equal(host.active(), "task-editor"); await click("取消"); assert.equal(host.active(), "board"); assert.equal(writes, 0);
  } finally { await act(async () => root.unmount()); dispose(); container.remove(); }
});


test("项目说明与快捷操作编辑失败保留输入，通知批量处理不改变任务", async () => {
  const host = createTabHost(); const preferences = new Map([["board-view", { quickActions: [{ id: "q", name: "旧操作", content: "旧正文" }] }]]);
  const task = { id: "task", title: "管理验收", project: "验收项目", description: "需求", criteria: "验收", priority: "medium", workspacePath: "/repo", engine: "codex", model: "", createdAt: "2026-10-29", updatedAt: "2026-10-29", status: "done", recovery: false, runs: [{ id: "run", runId: "run", sessionId: "session", engine: "codex", model: "", workspacePath: "/repo", startedAt: "2026-10-29", outcome: "ended" }] };
  let stored = JSON.stringify({ schemaVersion: 1, tasks: [task] }); let revision = 1; let failTask = false; let failPrefs = false; let starts = 0;
  const ctx = {
    pluginId: "personal-task-board", host: { isWeb: false }, react: React, ui: host.ui,
    storage: { get: async (key) => preferences.get(key), set: async (key, value) => { if (failPrefs) throw Error("设置写入失败"); preferences.set(key, structuredClone(value)); } }, events: { on: () => () => {} },
    documentStorage: { readText: async () => ({ content: stored, version: String(revision) }), writeTextAtomic: async (_, content) => { if (failTask) throw Error("任务写入失败"); stored = content; return { version: String(++revision) }; } },
    workspaces: { list: async () => [{ path: "/repo", name: "仓库" }] }, models: { listEngines: async () => [], catalog: async () => ({ engines: [], errors: [] }) }, sessions: { startRun: async () => { starts++; } },
  };
  const dispose = activate(ctx); const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const byLabel = (name) => container.querySelector(`[aria-label="${name}"]`);
  try {
    await act(async () => root.render(React.createElement(host.Component))); await settle();
    await click("任务面板配置"); await click("项目说明与资源");
    await change("项目共享说明", "共享约束"); failTask = true; await click("保存项目说明"); assert.equal(field("项目共享说明").value, "共享约束"); assert.match(container.textContent, /任务写入失败/);
    failTask = false; await click("保存项目说明"); assert.equal(JSON.parse(stored).projects[0].description, "共享约束");
    await click("返回任务面板"); await click("全部标为已读"); assert.equal(JSON.parse(stored).tasks[0].noticeStates.run.read, true);
    await click("归档已读通知"); assert.equal(JSON.parse(stored).tasks[0].noticeStates.run.archived, true); await click("查看已归档通知"); await click("恢复通知"); await click("查看收件箱");
    await click("归档已结束任务通知"); assert.equal(JSON.parse(stored).tasks[0].status, "done");
    await act(async () => Simulate.click(byLabel("查看任务详情 管理验收"))); await settle();
    await act(async () => Simulate.click(byLabel("编辑快捷操作 旧操作"))); await settle();
    await change("编辑操作名称", "新操作"); await change("编辑操作正文", "@Agent 新正文"); failPrefs = true;
    await click("保存快捷操作"); assert.equal(field("编辑操作正文").value, "@Agent 新正文"); assert.equal(preferences.get("board-view").quickActions[0].name, "旧操作"); assert.match(container.textContent, /设置写入失败/);
    failPrefs = false; await click("保存快捷操作"); assert.equal(preferences.get("board-view").quickActions[0].name, "新操作");
    await act(async () => Simulate.click(byLabel("归档快捷操作 新操作"))); await settle(); assert.equal(button("新操作", container), undefined);
    await click("查看已归档操作"); assert.ok(byLabel("恢复快捷操作 新操作"));
    await act(async () => Simulate.click(byLabel("恢复快捷操作 新操作"))); await settle(); await click("查看可用操作"); await click("新操作"); assert.equal(field("评论内容").value, "@Agent 新正文");
    assert.equal(starts, 0); assert.equal(JSON.parse(stored).tasks[0].comments, undefined); assert.equal(JSON.parse(stored).tasks[0].status, "done");
  } finally { await act(async () => root.unmount()); dispose(); container.remove(); }
});


test("讨论结论保留问题和结论，导航展开中间回复并聚焦，回复重开", async () => {
  const host = createTabHost(); let revision = 1; let starts = 0;
  const comments = [{ id: "root", content: "/note 原问题", replyTo: null }, { id: "middle", content: "/note 中间过程", replyTo: "root" }, { id: "answer", content: "/note 最终结论", replyTo: "middle" }].map((entry, index) => ({ ...entry, files: [], triggerAgent: false, createdAt: `2026-10-29T01:00:0${index}Z` }));
  let stored = JSON.stringify({ schemaVersion: 1, tasks: [{ id: "t", title: "讨论导航验收", description: "需求", criteria: "验收", priority: "medium", workspacePath: "/repo", engine: "codex", model: "", status: "todo", recovery: false, createdAt: "2026-10-29", updatedAt: "2026-10-29", runs: [], comments }] });
  const prefs = new Map();
  const ctx = { pluginId: "personal-task-board", host: { isWeb: false }, react: React, ui: host.ui, storage: { get: async (key) => prefs.get(key), set: async (key, value) => prefs.set(key, value) }, events: { on: () => () => {} },
    documentStorage: { readText: async () => ({ content: stored, version: String(revision) }), writeTextAtomic: async (_, content) => { stored = content; return { version: String(++revision) }; } }, workspaces: { list: async () => [] }, models: { listEngines: async () => [], catalog: async () => ({ engines: [], errors: [] }) }, sessions: { startRun: async () => { starts++; } } };
  const dispose = activate(ctx); const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(host.Component))); await settle();
    await act(async () => Simulate.click(container.querySelector('[aria-label="查看任务详情 讨论导航验收"]'))); await settle();
    const entry = (id) => container.querySelector(`[data-comment-id="${id}"]`);
    await click("以此回复作为结论", entry("answer"));
    assert.equal(JSON.parse(stored).tasks[0].threadConclusions.root, "answer"); assert.match(entry("answer").textContent, /讨论结论/);
    const folded = entry("middle").closest("details"); assert.equal(folded.open, false); assert.equal(entry("root").closest("details"), null); assert.equal(entry("answer").closest("details"), null);
    await act(async () => Simulate.change(container.querySelector('[aria-label="跳转到评论"]'), { target: { value: "middle" } })); await settle(); assert.equal(folded.open, true); assert.equal(document.activeElement, entry("middle"));
    await click("回复评论", entry("answer")); await change("评论内容", "/note 新意见"); await act(async () => Simulate.submit(field("评论内容").closest("form"))); await settle();
    assert.equal(JSON.parse(stored).tasks[0].threadConclusions.root, undefined); assert.equal(container.querySelector(".ptb-thread-concluded"), null); assert.equal(starts, 0); assert.equal(JSON.parse(stored).tasks[0].status, "todo");
  } finally { await act(async () => root.unmount()); dispose(); container.remove(); }
});


test("阶段通知显示取消数量并支持已读归档，查看父任务不启动执行", async () => {
  const host = createTabHost(); let revision = 1;
  const base = { description: "需求", criteria: "验收", priority: "medium", workspacePath: "/repo", engine: "codex", model: "", recovery: false, createdAt: "2026-10-29", updatedAt: "2026-10-29", runs: [] };
  let stored = JSON.stringify({ schemaVersion: 1, tasks: [{ ...base, id: "parent", title: "父任务阶段验收", status: "todo" }, { ...base, id: "one", title: "阶段一", parentId: "parent", stage: 1, status: "cancelled" }, { ...base, id: "two", title: "阶段二", parentId: "parent", stage: 2, status: "todo" }] });
  const ctx = { pluginId: "personal-task-board", host: { isWeb: false }, react: React, ui: host.ui, storage: { get: async () => null, set: async () => {} }, events: { on: () => () => {} }, documentStorage: { readText: async () => ({ content: stored, version: String(revision) }), writeTextAtomic: async (_, content) => { stored = content; return { version: String(++revision) }; } }, workspaces: { list: async () => [] }, models: { listEngines: async () => [], catalog: async () => ({ engines: [], errors: [] }) }, sessions: {} };
  const dispose = activate(ctx); const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(host.Component))); await settle(); const notices = container.querySelector(".ptb-notices");
    assert.match(notices.textContent, /阶段 1 已结束，阶段 2 可开始 · 0 项完成、1 项取消/); assert.doesNotMatch(notices.textContent, /undefined/);
    await click("查看任务", notices); assert.equal(container.querySelector('[aria-label="任务侧边预览"] h1').textContent, "父任务阶段验收"); await click("关闭预览");
    await click("归档通知", notices); assert.match(notices.textContent, /暂无通知/); await click("查看已归档通知", notices); assert.match(notices.textContent, /阶段 1 已结束/);
    assert.deepEqual(JSON.parse(stored).tasks.map((task) => task.status), ["todo", "cancelled", "todo"]);
  } finally { await act(async () => root.unmount()); dispose(); container.remove(); }
});


test("列表列隐藏、Shift 连选与预览偏好共用任务，设置恢复且不写任务", async () => {
  const host = createTabHost(); const prefs = new Map(); let writes = 0;
  const tasks = ["甲", "乙", "丙"].map((title, index) => ({ id: String(index), title, description: "需求", criteria: "验收", priority: "medium", workspacePath: "/repo", engine: "codex", model: "", status: "todo", recovery: false, createdAt: "2026-10-29", updatedAt: `2026-10-29T01:00:0${2-index}Z`, runs: [] }));
  const ctx = { pluginId: "personal-task-board", host: { isWeb: false }, react: React, ui: host.ui, storage: { get: async (key) => prefs.get(key), set: async (key, value) => prefs.set(key, value) }, events: { on: () => () => {} }, documentStorage: { readText: async () => ({ content: JSON.stringify({ schemaVersion: 1, tasks }), version: "1" }), writeTextAtomic: async () => { writes++; throw Error("不应修改任务"); } }, workspaces: { list: async () => [] }, models: { listEngines: async () => [], catalog: async () => ({ engines: [], errors: [] }) }, sessions: {} };
  const dispose = activate(ctx); const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const label = (name) => container.querySelector(`[aria-label="${name}"]`);
  const value = async (name, text) => { await act(async () => Simulate.change(label(name), { target: { value: text } })); await settle(); };
  try {
    await act(async () => root.render(React.createElement(host.Component))); await settle(); await switchLayout("list");
    assert.equal(container.querySelectorAll("thead th").length, 7);
    await click("任务面板配置");
    const fieldset = [...container.querySelectorAll("fieldset")].find((node) => node.querySelector("legend").textContent === "列表显示列");
    const workspace = [...fieldset.querySelectorAll("label")].find((node) => node.textContent === "工作区").querySelector("input");
    await act(async () => Simulate.change(workspace, { target: { checked: false } })); await settle(); await click("返回任务面板"); assert.equal(container.querySelectorAll("thead th").length, 6); assert.equal(container.querySelector("tbody tr.ptb-task-row").children.length, 6);
    await act(async () => Simulate.change(label("选择任务 甲"), { target: { checked: true } })); await settle();
    await act(async () => Simulate.change(label("选择任务 丙"), { target: { checked: true }, nativeEvent: { shiftKey: true } })); await settle();
    assert.equal(container.querySelectorAll("tbody input:checked").length, 3);
    await click("清空选择"); await click("任务面板配置"); await value("默认打开任务", "preview"); await click("返回任务面板");
    await click("甲", container.querySelector("tbody")); assert.ok(label("任务侧边预览")); assert.equal(host.active(), "board"); await click("关闭预览");
    await act(async () => Simulate.click(button("甲", container.querySelector("tbody")), { shiftKey: true })); await settle(); assert.equal(host.active(), "task-details"); await click("返回看板");
    await click("任务面板配置"); assert.equal(label("默认打开任务").value, "preview"); assert.equal(prefs.get("board-view").listFields.workspace, false); assert.equal(writes, 0);
  } finally { await act(async () => root.unmount()); dispose(); container.remove(); }
});


test("来源快照按内容分区展示更新提示，保留历史文字及打开来源入口", async () => {
  const host = createTabHost();
  const base = { criteria: "旧验收", priority: "medium", workspacePath: "/repo", engine: "codex", model: "", status: "todo", recovery: false, createdAt: "2026-10-29", updatedAt: "2026-10-29", runs: [] };
  const snapshot = JSON.stringify({ sourceTaskId: "parent", title: "原标题", description: "原需求", criteria: "旧验收", comments: [{ id: "c", content: "原讨论", files: [] }] });
  const tasks = [{ ...base, id: "parent", title: "新标题", description: "新需求", comments: [{ id: "c", content: "原讨论", files: [], replyTo: null, triggerAgent: false, createdAt: "2026-10-29" }] }, { ...base, id: "child", title: "拆分任务", description: "独立需求", parentId: "parent", sourceSnapshot: snapshot }];
  const ctx = { pluginId: "personal-task-board", host: { isWeb: false }, react: React, ui: host.ui, storage: { get: async () => null, set: async () => {} }, events: { on: () => () => {} }, documentStorage: { readText: async () => ({ content: JSON.stringify({ schemaVersion: 1, tasks }), version: "1" }), writeTextAtomic: async () => { throw Error("不应保存"); } }, workspaces: { list: async () => [] }, models: { listEngines: async () => [], catalog: async () => ({ engines: [], errors: [] }) }, sessions: {} };
  const dispose = activate(ctx); const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(host.Component))); await settle();
    await act(async () => Simulate.click(container.querySelector('[aria-label="查看任务详情 拆分任务"]'))); await settle();
    const source = container.querySelector(".ptb-source"); assert.ok(source); assert.match(source.textContent, /来源有更新/); assert.match(source.textContent, /当时的需求原需求/); assert.match(source.textContent, /当时的讨论原讨论/); assert.equal(source.querySelector("pre"), null);
    await click("打开来源任务", source); assert.equal(container.querySelector("h1").textContent, "新标题"); assert.equal(tasks[1].sourceSnapshot, snapshot);
  } finally { await act(async () => root.unmount()); dispose(); container.remove(); }
});


test("通知铃铛位于新建任务左侧，历史重试先展示快照且确认后才执行", async () => {
  const host = createTabHost(); let revision = 1; const starts = []; let listener;
  const prompt = "历史输入，只按此轮核对";
  const run = { id: "old", runId: "old", sessionId: "old-session", engine: "codex", model: "", providerId: "", workspacePath: "/repo", startedAt: "2026-10-29", endedAt: "2026-10-29", outcome: "error", input: { prompt, engine: "codex", model: "", providerId: "", workspacePath: "/repo" } };
  let stored = JSON.stringify({ schemaVersion: 1, tasks: [{ id: "t", title: "重试界面验收", description: "新需求", criteria: "验收", priority: "medium", workspacePath: "/repo", engine: "codex", model: "", status: "blocked", recovery: false, createdAt: "2026-10-29", updatedAt: "2026-10-29", runs: [run] }] });
  const ctx = { pluginId: "personal-task-board", host: { isWeb: false }, react: React, ui: host.ui, storage: { get: async () => null, set: async () => {} }, events: { on: (_, callback) => { listener = callback; return () => {}; } }, documentStorage: { readText: async () => ({ content: stored, version: String(revision) }), writeTextAtomic: async (_, content) => { stored = content; return { version: String(++revision) }; } }, workspaces: { list: async () => [{ path: "/repo", name: "仓库" }] }, models: { listEngines: async () => [{ id: "codex", available: true, enabled: true }], catalog: async () => ({ engines: [], errors: [] }) }, sessions: { startRun: async (def) => { starts.push(def); return { runId: "new", sessionId: "new-session" }; } } };
  const dispose = activate(ctx); const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(host.Component))); await settle();
    const toolbar = container.querySelector(".ptb-toolbar"), focus = container.querySelector(".ptb-focus"), notices = container.querySelector(".ptb-notices");
    assert.ok(notices.closest(".ptb-board-header"));
    assert.equal(notices.nextElementSibling.textContent, "＋ 新建任务");
    assert.ok(toolbar.compareDocumentPosition(focus) & window.Node.DOCUMENT_POSITION_FOLLOWING);
    notices.open = true;
    await act(async () => Simulate.keyDown(notices.querySelector("summary"), { key: "Escape" })); await settle();
    assert.equal(notices.open, false); assert.equal(document.activeElement, notices.querySelector("summary"));
    await click("视图设置", container); assert.equal(container.querySelector(".ptb-tools").open, true);
    await click("视图设置", container); assert.equal(container.querySelector(".ptb-tools").open, false);
    await act(async () => Simulate.click(container.querySelector('[aria-label="查看任务详情 重试界面验收"]'))); await settle();
    const retry = container.querySelector('[aria-label="历史轮次重试"]'); assert.ok(retry); assert.match(retry.textContent, /历史输入，只按此轮核对/); assert.match(retry.textContent, /不包含之后新增/); assert.equal(starts.length, 0);
    await click("确认按历史输入重试", retry); assert.equal(starts.length, 1); assert.equal(starts[0].prompt, prompt); assert.equal(starts[0].sessionId, undefined); assert.equal(JSON.parse(stored).tasks[0].runs[1].retryOf, "old");
    await act(async () => listener({ kind: "done", runId: "new", sessionId: "new-session", engine: "codex", workspacePath: "/repo" })); await settle(); assert.equal(JSON.parse(stored).tasks[0].status, "review");
  } finally { await act(async () => root.unmount()); dispose(); container.remove(); }
});


test("真实选区引用保留草稿、替换来源、聚焦评论，越界选区拒绝且普通发送不触发", async () => {
  const host = createTabHost(); const prefs = new Map(); let revision = 1; let fail = false; let starts = 0;
  let stored = JSON.stringify({ schemaVersion: 1, tasks: [{ id: "t", title: "选区批注验收", description: "说明 @Agent 原始要求需要核对", criteria: "验收金额必须一致", priority: "medium", workspacePath: "/repo", engine: "codex", model: "", status: "todo", recovery: false, createdAt: "2026-10-29", updatedAt: "2026-10-29", runs: [], comments: [{ id: "c", content: "讨论金额差异", files: [], triggerAgent: false, createdAt: "2026-10-29", replyTo: null }] }] });
  const ctx = { pluginId: "personal-task-board", host: { isWeb: false }, react: React, ui: host.ui, storage: { get: async (key) => prefs.get(key), set: async (key, value) => prefs.set(key, structuredClone(value)) }, events: { on: () => () => {} }, documentStorage: { readText: async () => ({ content: stored, version: String(revision) }), writeTextAtomic: async (_, content) => { if (fail) throw Error("写入失败"); stored = content; return { version: String(++revision) }; } }, workspaces: { list: async () => [] }, models: { listEngines: async () => [], catalog: async () => ({ engines: [], errors: [] }) }, sessions: { startRun: async () => { starts++; } } };
  const dispose = activate(ctx); const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const select = async (kind, start, end) => {
    const paragraph = container.querySelector(`[data-quote-kind="${kind}"]`); const range = document.createRange(); range.setStart(paragraph.firstChild, start); range.setEnd(paragraph.firstChild, end); window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    await act(async () => Simulate.mouseUp(paragraph)); await settle();
  };
  try {
    await act(async () => root.render(React.createElement(host.Component))); await settle(); await act(async () => Simulate.click(container.querySelector('[aria-label="查看任务详情 选区批注验收"]'))); await settle();
    await change("评论内容", "金额偏差请核对"); await select("description", 3, 9); await click("加入评论引用");
    assert.equal(prefs.get("board-view").drafts.t.quoteSnapshot.text, "@Agent"); assert.equal(field("评论内容").value, "金额偏差请核对"); assert.equal(document.activeElement, field("评论内容")); assert.equal(starts, 0);
    await select("criteria", 0, 4); assert.ok(button("替换评论引用")); await click("替换评论引用"); assert.equal(prefs.get("board-view").drafts.t.quoteSnapshot.kind, "criteria"); assert.equal(prefs.get("board-view").drafts.t.replyTo, null);
    const paragraph = container.querySelector('[data-quote-kind="criteria"]'), other = container.querySelector('[data-quote-kind="description"]'); const range = document.createRange(); range.setStart(other.firstChild, 0); range.setEnd(paragraph.firstChild, 2); window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    await act(async () => Simulate.mouseUp(paragraph)); await settle(); assert.equal(button("替换评论引用"), undefined);
    await click("返回看板"); await act(async () => Simulate.click(container.querySelector('[aria-label="查看任务详情 选区批注验收"]'))); await settle(); assert.match(container.querySelector('.ptb-form .ptb-quote').textContent, /引用验收标准验收金额/);
    fail = true; await act(async () => Simulate.submit(field("评论内容").closest("form"))); await settle(); assert.equal(field("评论内容").value, "金额偏差请核对"); assert.equal(prefs.get("board-view").drafts.t.quoteSnapshot.kind, "criteria");
    fail = false; await act(async () => Simulate.submit(field("评论内容").closest("form"))); await settle(); const comment = JSON.parse(stored).tasks[0].comments.at(-1); assert.equal(comment.quote.text, "验收金额"); assert.equal(comment.quote.kind, "criteria"); assert.equal(comment.triggerAgent, false); assert.equal(starts, 0); assert.equal(prefs.get("board-view").drafts.t.quoteSnapshot, null);
    await click("查看引用来源", container.querySelector('[data-comment-id="' + comment.id + '"]')); assert.equal(document.activeElement.dataset.quoteKind, "criteria");
  } finally { window.getSelection().removeAllRanges(); await act(async () => root.unmount()); dispose(); container.remove(); }
});


test("任务内查找跨区域、展开讨论、精确高亮且保留草稿引用，预览切换清理", async () => {
  const host = createTabHost(); const prefs = new Map(); let writes = 0; let starts = 0;
  const base = { description: "金额 金额 İx", criteria: "金额 [x]", priority: "medium", workspacePath: "/repo", engine: "codex", model: "", status: "todo", recovery: false, createdAt: "2026-10-29", updatedAt: "2026-10-29", runs: [], comments: [] };
  const task = { ...base, id: "t", title: "全文查找", resolvedThreads: ["c"], comments: [{ id: "c", content: "金额讨论", files: [], triggerAgent: false, createdAt: "2026-10-29", replyTo: null }] };
  const stored = JSON.stringify({ schemaVersion: 1, tasks: [task, { ...base, id: "other", title: "另一任务", description: "其他需求", criteria: "其他验收" }] });
  const ctx = { pluginId: "personal-task-board", host: { isWeb: false }, react: React, ui: host.ui, storage: { get: async (key) => prefs.get(key), set: async (key, value) => prefs.set(key, structuredClone(value)) }, events: { on: () => () => {} }, documentStorage: { readText: async () => ({ content: stored, version: "1" }), writeTextAtomic: async () => { writes++; throw Error("查找不应写入"); } }, workspaces: { list: async () => [] }, models: { listEngines: async () => [], catalog: async () => ({ engines: [], errors: [] }) }, sessions: { startRun: async () => { starts++; } } };
  const previousCSS = window.CSS, previousHighlight = window.Highlight;
  const highlights = new Map(); window.CSS = { highlights }; window.Highlight = class { constructor(range) { this.range = range; } };
  const dispose = activate(ctx); const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const search = () => container.querySelector('[aria-label="查找任务内容"]');
  const query = async (value) => { await act(async () => Simulate.change(search(), { target: { value } })); await settle(); };
  const status = () => container.querySelector('[aria-label="任务内搜索"] [role="status"]').textContent;
  try {
    await act(async () => root.render(React.createElement(host.Component))); await settle();
    await act(async () => Simulate.click(container.querySelector('[aria-label="查看任务详情 全文查找"]'))); await settle();
    await change("评论内容", "保留草稿");
    await query("金额"); assert.equal(status(), "1 / 4"); assert.equal(highlights.size, 1); assert.equal([...highlights.values()][0].range.toString(), "金额");
    await click("下一个匹配"); assert.equal(status(), "2 / 4"); assert.equal([...highlights.values()][0].range.startOffset, 3);
    await act(async () => Simulate.keyDown(search(), { key: "Enter" })); await settle(); assert.equal(status(), "3 / 4");
    await click("下一个匹配"); assert.equal(status(), "4 / 4"); assert.equal(container.querySelector('[data-comment-id="c"]').closest("details").open, true);
    await click("下一个匹配"); assert.equal(status(), "1 / 4");
    await act(async () => Simulate.keyDown(search(), { key: "Enter", shiftKey: true })); await settle(); assert.equal(status(), "4 / 4");
    await query("[x]"); assert.equal(status(), "1 / 1"); assert.equal([...highlights.values()][0].range.toString(), "[x]");
    await query("x"); assert.equal(status(), "1 / 2"); assert.equal([...highlights.values()][0].range.toString(), "x");
    await query("不存在"); assert.equal(status(), "无匹配结果"); assert.equal(button("下一个匹配").disabled, true); assert.equal(highlights.size, 0);
    await query("金额"); const paragraph = container.querySelector('[data-quote-kind="description"]'); const range = document.createRange(); range.setStart(paragraph.firstChild, 0); range.setEnd(paragraph.firstChild, 2); window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    await act(async () => Simulate.mouseUp(paragraph)); await settle(); await click("加入评论引用"); assert.equal(field("评论内容").value, "保留草稿"); assert.equal(prefs.get("board-view").drafts.t.quoteSnapshot.text, "金额");
    await act(async () => Simulate.keyDown(search(), { key: "Escape" })); await settle(); assert.equal(search().value, ""); assert.equal(highlights.size, 0); assert.equal(document.activeElement, search());
    await query("金额"); await click("返回看板"); assert.equal(highlights.size, 0);
    await act(async () => Simulate.click(container.querySelector('[aria-label="预览任务 全文查找"]'))); await settle();
    await query("金额"); await act(async () => Simulate.keyDown(search(), { key: "Escape" })); await settle(); assert.ok(container.querySelector('[aria-label="任务侧边预览"]'));
    await query("金额"); await click("下一项"); assert.equal(search().value, ""); assert.equal(highlights.size, 0); assert.equal(writes, 0); assert.equal(starts, 0);
  } finally { window.getSelection().removeAllRanges(); await act(async () => root.unmount()); dispose(); container.remove(); window.CSS = previousCSS; window.Highlight = previousHighlight; }
});


const featureBase = { id: "feature", title: "移植功能验收", description: "原需求", criteria: "原验收", priority: "medium", workspacePath: "/repo", engine: "codex", model: "model-a", providerId: "", status: "review", recovery: false, createdAt: "2026-10-29T01:00:00Z", updatedAt: "2026-10-29T01:00:00Z", runs: [{ id: "prior", runId: "r0", sessionId: "s0", engine: "codex", model: "model-a", workspacePath: "/repo", startedAt: "2026-10-29T01:00:00Z", endedAt: "2026-10-29T01:01:00Z", outcome: "ended" }], comments: [] };
async function featureHost(task = featureBase, projects = [], extras = {}) {
  const host = createTabHost(); let stored = JSON.stringify({ schemaVersion: 1, tasks: [task], projects, ...extras }); let version = 1; let fail = false; const starts = [], opens = []; let callback;
  const ctx = { pluginId: "personal-task-board", host: { isWeb: false }, react: React, ui: host.ui, storage: { get: async () => null, set: async () => {} }, events: { on: (_, listener) => { callback = listener; return () => {}; } }, documentStorage: { readText: async () => ({ content: stored, version: String(version) }), writeTextAtomic: async (_, value, expected) => { if (fail) throw Error("模拟保存失败"); if (expected !== String(version)) throw Error("版本冲突"); stored = value; return { version: String(++version) }; } }, workspaces: { list: async () => [{ path: "/repo", name: "仓库" }] }, models: { listEngines: async () => [{ id: "codex", available: true, enabled: true }], catalog: async () => ({ engines: [{ engine: { id: "codex" }, sources: [{ id: "cli", kind: "cli", models: [{ id: "model-a", name: "模型 A" }] }] }], errors: [] }) }, sessions: { startRun: async (input) => { starts.push(input); return { runId: "new-run", sessionId: "new-session" }; }, selectSession: async (...args) => opens.push(args) }, shell: { revealPath: async (path) => opens.push(path) }, assets: { grantFile: async () => null } };
  const dispose = activate(ctx); const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(React.createElement(host.Component))); await settle();
  return { container, starts, opens, data: () => JSON.parse(stored), fail: (value) => { fail = value; }, external: (transform) => { const data = JSON.parse(stored); transform(data); stored = JSON.stringify(data); version++; }, emit: async () => { await act(async () => callback({ runId: "new-run", sessionId: "new-session", engine: "codex", workspacePath: "/repo", kind: "done" })); await settle(); }, details: async () => { await act(async () => Simulate.click(container.querySelector('[aria-label="查看任务详情 移植功能验收"]'))); await settle(); }, close: async () => { await act(async () => root.unmount()); dispose(); container.remove(); } };
}

test("文档详情标签保留讨论草稿，键盘可导航，全文查找自动展开目标分区", async () => {
  const env = await featureHost({ ...featureBase, comments: [{ id: "c", content: "仅讨论区有的定位文字", files: [], triggerAgent: false, createdAt: "2026-10-29T01:02:00Z", replyTo: null }] });
  const pane = (key) => env.container.querySelector(`[data-detail-pane="${key}"]`);
  try {
    await env.details();
    assert.equal(pane("requirements").hidden, false); assert.equal(pane("comments").hidden, true);
    assert.ok(env.container.querySelector('[aria-label="任务属性与关联"]'));
    assert.match(env.container.querySelector('[aria-label="执行与验收"]').textContent, /等待你的验收/);
    await click("讨论 · 1"); await change("评论内容", "切换后保留的草稿");
    await click("执行记录 · 1"); await click("讨论 · 1");
    assert.equal(field("评论内容").value, "切换后保留的草稿");
    const tab = env.container.querySelector('[role="tab"][aria-selected="true"]');
    await act(async () => Simulate.keyDown(tab, { key: "Home" })); await settle();
    assert.equal(pane("requirements").hidden, false);
    const search = env.container.querySelector('[aria-label="查找任务内容"]'); search.focus();
    await act(async () => Simulate.change(search, { target: { value: "仅讨论区有的定位文字" } })); await settle();
    assert.equal(pane("comments").hidden, false); assert.equal(pane("requirements").hidden, true);
    assert.equal(document.activeElement, search);
    assert.equal(env.starts.length, 0); assert.equal(env.data().tasks[0].status, "review");
  } finally { await env.close(); }
});

test("详情验收区沿用落盘校验，失败保留待验收，成功后隐藏验收操作", async () => {
  const env = await featureHost();
  try {
    await env.details(); env.fail(true); await click("验收通过");
    assert.equal(env.data().tasks[0].status, "review");
    assert.match(env.container.querySelector('[role="alert"]').textContent, /模拟保存失败/);
    env.fail(false); await click("验收通过");
    assert.equal(env.data().tasks[0].status, "done");
    assert.equal(button("验收通过", env.container), undefined); assert.equal(env.starts.length, 0);
  } finally { await env.close(); }
});

test("交付物 UI 保存失败保留选择、登记后定位评论运行，时间线链接不启动执行", async () => {
  const file = { name: "成果.txt", path: "/repo/result.txt", grantId: "g" };
  const env = await featureHost({ ...featureBase, resolvedThreads: ["c"], comments: [{ id: "c", content: "/note 成果说明", files: [file], triggerAgent: false, createdAt: "2026-10-29T01:02:00Z", replyTo: null }] });
  try {
    await env.details(); const select = env.container.querySelector('[aria-label="已有附件登记为成果"]');
    await act(async () => Simulate.change(select, { target: { value: "0" } })); await settle();
    await act(async () => Simulate.change(env.container.querySelector('[aria-label="交付物关联运行"]'), { target: { value: "prior" } })); await settle();
    env.fail(true); await click("登记交付物"); assert.equal(select.value, "0"); assert.equal(env.data().tasks[0].deliverables, undefined);
    env.fail(false); await click("登记交付物"); assert.equal(env.data().tasks[0].deliverables[0].commentId, "c"); assert.equal(env.container.querySelector('[aria-label="已有附件登记为成果"]').value, "");
    await click("定位来源评论"); assert.equal(document.activeElement.dataset.commentId, "c"); assert.equal(document.activeElement.closest("details").open, true);
    assert.equal(env.container.querySelector('[data-detail-pane="comments"]').hidden, false);
    await click("需求与验收");
    await click("定位关联运行"); assert.equal(document.activeElement.dataset.runId, "prior");
    assert.equal(env.container.querySelector('[data-detail-pane="runs"]').hidden, false);
    await click("查看交付物"); assert.ok(document.activeElement.dataset.deliverableId); await click("成果.txt", env.container.querySelector('[data-deliverable-id]')); assert.equal(env.opens.at(-1), file.path);
    await click("移除登记"); assert.equal(env.data().tasks[0].deliverables.length, 0); assert.equal(env.starts.length, 0);
  } finally { await env.close(); }
});

test("项目公共资源 UI 恢复链接文件，失败保留编辑并在下一轮上下文中展示", async () => {
  const resources = { links: ["https://example.com/old"], files: [{ name: "公共规范.md", path: "/repo/rules.md", grantId: "g" }] };
  const env = await featureHost({ ...featureBase, project: "项目" }, [{ workspacePath: "/repo", name: "项目", description: "共享说明", resources }]);
  try {
    await click("任务面板配置");
    assert.equal(field("项目资源链接（每行一个）").value, "https://example.com/old"); assert.match(env.container.querySelector('[aria-label="项目公共资源附件"]').textContent, /公共规范/);
    await change("项目资源链接（每行一个）", "https://example.com/new"); env.fail(true); await click("保存项目说明"); assert.equal(field("项目资源链接（每行一个）").value, "https://example.com/new"); assert.equal(env.data().projects[0].resources.links[0], "https://example.com/old");
    env.fail(false); await click("保存项目说明"); assert.equal(env.data().projects[0].resources.links[0], "https://example.com/new");
    await click("返回任务面板"); await env.details(); assert.match([...env.container.querySelectorAll("details")].find((node) => node.querySelector("summary")?.textContent === "下一轮项目上下文").textContent, /example.com\/new/); assert.equal(env.starts.length, 0);
  } finally { await env.close(); }
});

test("任务编辑冲突 UI 保留输入、按字段对照并采用最新标题，保存不覆盖外部评论", async () => {
  const env = await featureHost({ ...featureBase, status: "todo" });
  try {
    await env.details(); await click("编辑任务"); await change("标题", "本地标题"); await change("需求", "本地新需求");
    env.external((data) => { data.tasks[0].title = "外部最新标题"; data.tasks[0].comments.push({ id: "external", content: "/note 外部评论", files: [], triggerAgent: false, createdAt: "2026-10-29T02:00:00Z", replyTo: null }); });
    await act(async () => Simulate.submit(env.container.querySelector("form"))); await settle(); assert.equal(field("标题").value, "本地标题"); assert.match(env.container.textContent, /版本冲突/);
    await click("读取最新版本并对照"); assert.equal(field("需求").value, "本地新需求"); const compare = env.container.querySelector('[aria-label="编辑版本对照"]'); assert.match(compare.textContent, /外部最新标题/);
    await click("采用此字段最新内容", [...compare.children].find((node) => node.querySelector("strong")?.textContent === "标题")); assert.equal(field("标题").value, "外部最新标题");
    await click("核对完成，保留当前输入"); await act(async () => Simulate.submit(env.container.querySelector("form"))); await settle();
    assert.equal(env.data().tasks[0].title, "外部最新标题"); assert.equal(env.data().tasks[0].description, "本地新需求"); assert.equal(env.data().tasks[0].comments[0].id, "external"); assert.equal(env.starts.length, 0);
  } finally { await env.close(); }
});

test("手动审查 UI 先预览可取消，确认后配置独立且提示词一致，结束待人工验收", async () => {
  const env = await featureHost();
  try {
    await env.details(); await change("处理步骤", "review"); await change("步骤模型", ""); await change("步骤说明", "  \n独立核对每一项验收\n  ");
    await click("预览交接"); assert.equal(env.starts.length, 0); await click("取消交接"); assert.equal(env.starts.length, 0); assert.equal(env.container.querySelector('[aria-label="交接确认"]'), null);
    await click("预览交接"); const preview = env.container.querySelector('[aria-label="交接确认"] pre').textContent;
    env.fail(true); await click("确认开始此步骤"); assert.equal(env.starts.length, 0); assert.ok(env.container.querySelector('[aria-label="交接确认"]'));
    env.fail(false); await click("确认开始此步骤"); assert.equal(env.starts.length, 1); assert.equal(env.starts[0].prompt, preview); assert.equal(env.starts[0].model, null); assert.equal(env.data().tasks[0].model, "model-a"); assert.equal(env.data().tasks[0].runs.at(-1).step, "review");
    await env.emit(); assert.equal(env.data().tasks[0].status, "review"); assert.match(env.container.textContent, /审查/);
  } finally { await env.close(); }
});


test("编辑器再次冲突保留三项草稿，文档其他部分变化明确提示，取消需确认", async () => {
  const env = await featureHost({ ...featureBase, status: "todo" });
  try {
    await env.details(); await click("编辑任务"); await change("标题", "本地标题"); await change("需求", "本地需求"); await change("验收标准", "本地验收");
    env.external((data) => { data.projects.push({ workspacePath: "/other", name: "另一个项目", description: "新说明" }); });
    const submit = async () => { await act(async () => Simulate.submit(env.container.querySelector("form"))); await settle(); };
    await submit(); await click("读取最新版本并对照"); assert.match(env.container.textContent, /当前任务的可编辑内容未变/);
    await click("核对完成，保留当前输入");
    env.external((data) => { data.tasks[0].criteria = "外部再次修改验收"; });
    await submit(); assert.equal(field("标题").value, "本地标题"); assert.equal(field("需求").value, "本地需求"); assert.equal(field("验收标准").value, "本地验收");
    await click("读取最新版本并对照"); assert.match(env.container.querySelector('[aria-label="编辑版本对照"]').textContent, /外部再次修改验收/);
    await click("取消"); assert.ok(env.container.querySelector('[aria-label="放弃编辑确认"]')); await click("继续编辑"); assert.equal(field("需求").value, "本地需求");
    await click("重新载入此任务内容"); assert.equal(field("标题").value, featureBase.title); assert.equal(field("验收标准").value, "外部再次修改验收");
    await click("取消"); await click("确认放弃编辑"); assert.ok(env.container.querySelector('[aria-label="个人任务看板"]')); assert.equal(env.starts.length, 0);
  } finally { await env.close(); }
});

test("项目资源执行前可核对，取消文件选择不产生记录，移除资源不改历史", async () => {
  const file = { name: "失效规范.md", path: "/missing/spec.md", grantId: "g" };
  const env = await featureHost({ ...featureBase, project: "资源项目" }, [{ workspacePath: "/repo", name: "资源项目", description: "共享约束", resources: { links: ["https://example.com/spec"], files: [file] } }]);
  try {
    const context = env.container.querySelector('.ptb-execution-context'); assert.equal(context.open, false); assert.match(context.textContent, /共享约束/); assert.match(context.textContent, /missing\/spec.md/); assert.ok(button("重新执行", context)); assert.equal(env.starts.length, 0);
    await click("任务面板配置");
    await act(async () => Simulate.click(env.container.querySelector('[aria-label="上传项目公共资源附件"]'))); await settle(); assert.equal(env.data().projects[0].resources.files.length, 1);
    await act(async () => Simulate.click(env.container.querySelector('[aria-label="移除项目公共资源附件 失效规范.md"]'))); await settle(); await change("项目资源链接（每行一个）", ""); await click("保存项目说明"); assert.deepEqual(env.data().projects[0].resources, { links: [], files: [] }); assert.equal(env.data().tasks[0].deliverables, undefined);
  } finally { await env.close(); }
});


test("交给审查快捷入口不启动，切换步骤保留各自未保存的配置", async () => {
  const env = await featureHost();
  try {
    await env.details(); await change("步骤说明", "实现专用说明"); await change("步骤模型", "");
    await click("交给审查"); assert.equal(field("处理步骤").value, "review"); assert.equal(field("处理步骤").closest("details").open, true); assert.equal(env.starts.length, 0);
    await change("步骤说明", "审查专用说明"); await change("处理步骤", "implement"); assert.equal(field("步骤说明").value, "实现专用说明"); assert.equal(field("步骤模型").value, "");
    await change("处理步骤", "review"); assert.equal(field("步骤说明").value, "审查专用说明"); assert.notEqual(field("步骤模型").value, "");
    await click("预览交接"); await click("取消交接"); assert.equal(env.starts.length, 0);
  } finally { await env.close(); }
});


test("Agent 成员可保存和指派，步骤确认含身份指令且与实际发送一致", async () => {
  const env = await featureHost();
  try {
    await click("任务面板配置");
    await change("Agent 名称", "审查同事"); await change("Agent 执行指令", "检查边界与测试证据"); await click("保存 Agent");
    const agent = env.data().agents[0]; assert.equal(agent.name, "审查同事"); assert.equal(env.starts.length, 0);
    await click("返回任务面板"); await env.details(); await act(async () => Simulate.change(env.container.querySelector('[aria-label="任务负责人"]'), { target: { value: agent.id } })); await settle();
    assert.equal(env.data().tasks[0].assigneeId, agent.id); await click("交给审查"); await click("预览交接");
    const prompt = env.container.querySelector('[aria-label="交接确认"] pre').textContent; assert.match(prompt, /检查边界与测试证据/);
    await click("确认开始此步骤"); assert.equal(env.starts[0].prompt, prompt); const run = env.data().tasks[0].runs.at(-1); assert.equal(run.agentSnapshot.id, agent.id); assert.equal(run.agentSnapshot.model, run.model);
  } finally { await env.close(); }
});


test("完整协作路线UI：方法绑定、定向提及、日志入口、队长提案及确认派活", async () => {
  const agents = [{ id: "leader", name: "队长", instruction: "协调", engine: "codex", model: "", providerId: "", workspacePath: "/repo", methodIds: ["m"] }, { id: "worker", name: "实现员", instruction: "实现并验证", engine: "codex", model: "model-a", providerId: "", workspacePath: "/repo", methodIds: ["m"] }];
  const env = await featureHost({ ...featureBase, status: "todo" }, [], { agents, methods: [{ id: "m", name: "统一验收", content: "逐项报告验证证据" }], squads: [{ id: "s", name: "交付组", leaderId: "leader", memberIds: ["leader", "worker"], instruction: "先验证" }] });
  const select = async (label, value) => { await act(async () => Simulate.change(env.container.querySelector(`[aria-label="${label}"]`), { target: { value } })); await settle(); };
  try {
    assert.equal(env.container.querySelector('[aria-label="Agent 名称"]'), null); await env.details();
    await select("定向提及 Agent", "worker"); await change("评论内容", "核对金额列"); await act(async () => Simulate.submit(field("评论内容").closest("form"))); await settle();
    assert.equal(env.data().tasks[0].runs.at(-1).agentSnapshot.id, "worker"); assert.equal(env.data().tasks[0].assigneeId, undefined); assert.match(env.starts[0].prompt, /逐项报告验证证据/);
    await env.emit(); assert.match(env.container.textContent, /此轮未启用宿主事件采集/);
    await select("协调小队", "s"); await click("预览队长协调"); assert.equal(env.starts.length, 1); await click("取消小队执行"); assert.equal(env.starts.length, 1);
    await click("预览队长协调"); let preview = env.container.querySelector('[aria-label="小队派活确认"] pre').textContent; await click("确认小队执行"); assert.equal(env.starts.at(-1).prompt, preview); await env.emit();
    await select("派活成员", "worker"); await change("核对后的派活说明", "补充金额列的测试"); await click("登记派活提案"); assert.equal(env.starts.length, 2);
    await click("预览并确认派活"); preview = env.container.querySelector('[aria-label="小队派活确认"] pre').textContent; await click("确认小队执行"); assert.equal(env.starts.at(-1).prompt, preview);
    await env.emit(); assert.equal(env.data().tasks[0].status, "review"); assert.equal(env.data().tasks[0].proposals[0].status, "dispatched"); assert.equal(env.data().tasks[0].runs.at(-1).coordination.kind, "member");
  } finally { await env.close(); }
});


test("共享方法库UI可保存、停用并保留Agent绑定，分类切换保留草稿", async () => {
  const env = await featureHost();
  try {
    await click("任务面板配置"); await click("共享方法库");
    await change("方法名称", "验收方法"); await change("方法正文", "按步骤收集证据"); await click("保存共享方法"); await click("Agent 成员");
    await change("Agent 名称", "执行员"); await change("Agent 执行指令", "执行测试");
    const bind = [...env.container.querySelectorAll("fieldset")].find((node) => node.querySelector("legend")?.textContent === "绑定共享方法").querySelector('input');
    await act(async () => Simulate.change(bind, { target: { checked: true } })); await settle(); await click("保存 Agent");
    assert.equal(env.data().agents[0].methodIds[0], env.data().methods[0].id);
    await click("共享方法库"); await click("验收方法"); const archived = [...env.container.querySelectorAll("label")].find((node) => node.textContent === "停用方法").querySelector("input");
    await act(async () => Simulate.change(archived, { target: { checked: true } })); await settle(); await click("保存共享方法");
    await click("Agent 成员"); await click("执行员"); await change("Agent 名称", "执行员改名"); await click("保存 Agent"); assert.equal(env.data().agents[0].name, "执行员改名"); assert.equal(env.data().agents[0].methodIds.length, 1);
    await change("Agent 执行指令", "未保存的成员草稿");
    for (const label of ["共享方法库", "手动协调小队", "项目说明与资源", "视图偏好", "Agent 成员"]) {
      await click(label);
      assert.equal(env.container.querySelector('.ptb-settings-nav button[aria-current="page"]').getAttribute("aria-label"), label);
      const visible = [...env.container.querySelectorAll(".ptb-settings-panel")].filter((node) => !node.hidden);
      assert.equal(visible.length, 1); assert.equal(visible[0].getAttribute("aria-label"), label);
    }
    assert.equal(field("Agent 执行指令").value, "未保存的成员草稿");
    assert.equal(env.data().agents[0].instruction, "执行测试"); assert.equal(env.starts.length, 0);
  } finally { await env.close(); }
});


test("配置分类侧栏：默认选中成员、切换对象与新建、保存失败保留输入且不改任务", async () => {
  const agents = [{ id: "a", name: "开发助手", instruction: "实现", engine: "codex", model: "", providerId: "", workspacePath: "", methodIds: [] }, { id: "b", name: "审查助手", instruction: "审查", engine: "codex", model: "", providerId: "", workspacePath: "", methodIds: [] }];
  const env = await featureHost(featureBase, [], { agents });
  try {
    const tasks = structuredClone(env.data().tasks);
    assert.equal(env.container.querySelector(".ptb-settings-layout"), null);
    await click("任务面板配置");
    assert.equal(field("Agent 名称").value, "开发助手");
    assert.equal(env.container.querySelector('.ptb-settings-list button[aria-pressed="true"]').getAttribute("aria-label"), "开发助手");
    await click("审查助手"); assert.equal(field("Agent 执行指令").value, "审查");
    await change("Agent 名称", "审查助手更新"); await change("Agent 执行指令", ""); await click("保存 Agent");
    assert.match(env.container.querySelector('[role="alert"]').textContent, /指令/);
    assert.equal(field("Agent 名称").value, "审查助手更新"); assert.equal(env.data().agents[1].name, "审查助手");
    await change("Agent 执行指令", "审查更新"); env.fail(true); await click("保存 Agent");
    assert.match(env.container.querySelector('[role="alert"]').textContent, /模拟保存失败/); assert.equal(field("Agent 名称").value, "审查助手更新");
    env.fail(false); await click("保存 Agent");
    assert.equal(env.data().agents[1].instruction, "审查更新"); assert.equal(env.data().agents[1].summary, undefined);
    await click("新建 Agent"); assert.equal(field("Agent 名称").value, "");
    await click("共享方法库"); await change("方法名称", "方法草稿"); await click("手动协调小队"); await change("小队名称", "小队草稿");
    await click("共享方法库"); assert.equal(field("方法名称").value, "方法草稿");
    await click("手动协调小队"); assert.equal(field("小队名称").value, "小队草稿");
    assert.deepEqual(env.data().tasks, tasks); assert.equal(env.starts.length, 0);
  } finally { await env.close(); }
});


test("成员头像选择预览与保存，切换保留草稿并在负责人、评论和执行历史展示", async () => {
  const agents = [{ id: "fox", name: "开发助手", instruction: "实现", engine: "codex", model: "", providerId: "", workspacePath: "", methodIds: [], avatar: "fox" }, { id: "legacy", name: "旧成员", instruction: "审查", engine: "codex", model: "", providerId: "", workspacePath: "", methodIds: [] }];
  const env = await featureHost({ ...featureBase, assigneeId: "fox", status: "todo" }, [], { agents });
  try {
    assert.equal(env.container.querySelector('.ptb-card-assignee [data-avatar="fox"]').textContent, "🦊");
    await click("任务面板配置");
    assert.equal(button("开发助手").querySelector("[data-avatar]").textContent, "🦊");
    assert.equal(button("旧成员").querySelector("[data-avatar]").textContent, "🤖");
    await click("头像：猫头鹰");
    assert.equal(button("头像：猫头鹰").getAttribute("aria-pressed"), "true");
    await click("共享方法库"); await click("Agent 成员");
    assert.equal(button("头像：猫头鹰").getAttribute("aria-pressed"), "true");
    assert.equal(env.data().agents[0].avatar, "fox");
    env.fail(true); await click("保存 Agent"); assert.equal(button("头像：猫头鹰").getAttribute("aria-pressed"), "true"); env.fail(false);
    await click("保存 Agent"); assert.equal(env.data().agents[0].avatar, "owl");
    assert.equal(env.data().agents[1].avatar, undefined);
    assert.equal(button("开发助手").querySelector("[data-avatar]").textContent, "🦉");
    await click("返回任务面板"); await env.details();
    assert.equal(env.container.querySelector('.ptb-assignee-field').parentElement.querySelector('[data-avatar]').textContent, "🦉");
    await click("交给审查"); await click("预览交接"); await click("确认开始此步骤"); await env.emit();
    assert.equal(env.data().tasks[0].runs.at(-1).agentSnapshot.avatar, "owl");
    assert.equal(env.container.querySelector('.ptb-comment-meta [data-avatar]').textContent, "🦉");
    assert.ok([...env.container.querySelectorAll('.ptb-agent-identity')].some((node) => node.textContent.includes("执行 Agent：开发助手") && node.querySelector('[data-avatar="owl"]')));
  } finally { await env.close(); }
});
