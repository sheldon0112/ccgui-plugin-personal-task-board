import test from "node:test";
import assert from "node:assert/strict";
import { createBoard, createViewStore, selectTasks, routesToAgent, childFromComment, isOverdue, resumeTarget, taskMetrics, taskAttachments, revealTaskView, taskNotices, taskTimeline, taskSwimlanes, stageNotices, selectTaskRange, sourceContext, taskHistory, commentAgentId } from "../ccgui-plugin/main.js";

const input = { title: "修复列表", description: "空列表显示占位", criteria: "空列表不抛异常", priority: "high", workspacePath: "/repo", engine: "codex", model: "model-a" };
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(options = {}) {
  let file = options.file || null;
  let revision = file ? 1 : 0;
  let listener;
  const calls = { starts: [], stops: [], opens: [], writes: 0, unsubscribed: false };
  const ctx = {
    pluginId: "personal-task-board",
    events: { on(topic, callback) { assert.equal(topic, "plugin-run://personal-task-board"); listener = callback; return () => { calls.unsubscribed = true; listener = null; }; } },
    models: {
      listEngines: async () => [{ id: "codex", available: true, enabled: true }],
      catalog: async () => ({ engines: [{ engine: { id: "codex" }, sources: [{ id: "codex:cli", kind: "cli", models: [{ id: "model-a", provider: "openai" }] }] }], errors: [] }),
    },
    workspaces: { list: async () => [{ name: "仓库", path: "/repo" }] },
    documentStorage: {
      async readText() { if (options.readError) throw new Error("读取失败"); return file === null ? null : { content: file, version: String(revision) }; },
      async writeTextAtomic(path, content, expected) {
        assert.equal(path, "tasks.json");
        if (options.failWrite) throw new Error("磁盘已满");
        if (expected !== (revision ? String(revision) : null)) throw new Error("版本冲突");
        calls.writes++; revision++; file = content;
        return { version: String(revision) };
      },
    },
    sessions: {
      async startRun(def) { calls.starts.push(def); return options.start ? options.start(def) : { runId: "r1", sessionId: "s1" }; },
      async interruptRun(def) { calls.stops.push(def); if (options.stopError) throw new Error("停止失败"); },
      async selectSession(...args) { calls.opens.push(args); },
    },
  };
  const board = createBoard(ctx);
  return { board, ctx, calls, options, file: () => file, conflict: () => revision++, emit: (patch) => listener?.({ engine: "codex", workspacePath: "/repo", runId: "r1", sessionId: "s1", ...patch }) };
}

test("创建、编辑、重载保留任务；空需求和非法优先级不能写入", async () => {
  const env = setup(); await env.board.ready;
  await assert.rejects(env.board.save({ ...input, criteria: " " }), /验收标准/);
  await assert.rejects(env.board.save({ ...input, priority: "urgent" }), /优先级/);
  assert.equal(env.calls.writes, 0);
  const id = await env.board.save(input);
  await env.board.save({ ...input, title: "修改标题" }, id);
  const other = setup({ file: env.file() }); await other.board.ready;
  assert.equal(other.board.getSnapshot().tasks[0].title, "修改标题");
  assert.equal(other.board.getSnapshot().tasks[0].priority, "high");
  env.board.dispose(); other.board.dispose();
});

test("读取失败或损坏文档不覆盖原文件", async () => {
  for (const options of [{ readError: true }, { file: "{broken" }, { file: '{"schemaVersion":2,"tasks":[]}' }]) {
    const env = setup(options); await env.board.ready;
    assert.equal(env.board.getSnapshot().ready, false);
    await assert.rejects(env.board.save(input), /尚未成功载入/);
    assert.equal(env.calls.writes, 0); env.board.dispose();
  }
});

test("先落盘再启动；磁盘失败不会启动会话", async () => {
  const env = setup(); await env.board.ready;
  const id = await env.board.save(input); env.options.failWrite = true;
  await assert.rejects(env.board.start(id), /磁盘已满/);
  assert.equal(env.calls.starts.length, 0);
  assert.equal(env.board.getSnapshot().tasks[0].status, "todo"); env.board.dispose();
});

test("启动传递工作区和模型；正常结束只进入待验收，人工确认后完成", async () => {
  const env = setup(); await env.board.ready;
  const id = await env.board.save(input);
  await assert.rejects(env.board.setStatus(id, "done"), /只有待验收/);
  await env.board.start(id);
  assert.deepEqual({ ...env.calls.starts[0], prompt: "" }, { engine: "codex", workspacePath: "/repo", model: "model-a", prompt: "" });
  assert.match(env.calls.starts[0].prompt, /空列表不抛异常/);
  assert.equal(env.board.getSnapshot().tasks[0].status, "running");
  env.emit({ kind: "done" }); await tick();
  assert.equal(env.board.getSnapshot().tasks[0].status, "review");
  await env.board.setStatus(id, "done");
  assert.equal(env.board.getSnapshot().tasks[0].status, "done"); env.board.dispose();
});

test("启动 Promise 返回前的 session/done 事件仍会关联并收敛", async () => {
  const handle = deferred(); const env = setup({ start: () => handle.promise }); await env.board.ready;
  const id = await env.board.save(input); const start = env.board.start(id); await tick();
  env.emit({ kind: "started", sessionId: null });
  env.emit({ kind: "session", sessionId: "late-session" });
  env.emit({ kind: "done", sessionId: "late-session" });
  handle.resolve({ runId: "r1", sessionId: null }); await start;
  const task = env.board.getSnapshot().tasks[0];
  assert.equal(task.status, "review"); assert.equal(task.runs[0].sessionId, "late-session");
  await env.board.open(task.runs[0]);
  assert.deepEqual(env.calls.opens, [["codex", "late-session", "/repo"]]); env.board.dispose();
});

test("重复点击和另一项任务不能同时启动", async () => {
  const handle = deferred(); const env = setup({ start: () => handle.promise }); await env.board.ready;
  const id = await env.board.save(input); const other = await env.board.save({ ...input, title: "另一个任务" });
  const start = env.board.start(id);
  await assert.rejects(env.board.start(id), /已有看板任务/);
  await assert.rejects(env.board.start(other), /已有看板任务/);
  await tick(); handle.resolve({ runId: "r1", sessionId: "s1" }); await start;
  await assert.rejects(env.board.start(other), /已有看板任务/);
  assert.equal(env.calls.starts.length, 1); env.board.dispose();
});

test("忽略其他运行和其他工作区的终态；延迟 session 标识可补齐", async () => {
  const env = setup({ start: async () => ({ runId: "r1", sessionId: null }) }); await env.board.ready;
  const id = await env.board.save(input); await env.board.start(id);
  env.emit({ kind: "done", runId: "foreign" }); env.emit({ kind: "done", workspacePath: "/other" }); await tick();
  assert.equal(env.board.getSnapshot().tasks[0].status, "running");
  env.emit({ kind: "session", sessionId: "s2" }); await tick();
  assert.equal(env.board.getSnapshot().tasks[0].runs[0].sessionId, "s2"); env.board.dispose();
});

test("启动失败和运行错误进入受阻；重试保留旧会话", async () => {
  const env = setup({ start: async () => { throw new Error("无法启动"); } }); await env.board.ready;
  const id = await env.board.save(input); await assert.rejects(env.board.start(id), /无法启动/);
  assert.equal(env.board.getSnapshot().tasks[0].status, "blocked");
  env.options.start = async () => ({ runId: "r1", sessionId: "s1" }); await env.board.start(id);
  env.emit({ kind: "error", error: "模型失败" }); await tick();
  assert.equal(env.board.getSnapshot().tasks[0].runs[1].error, "模型失败");
  env.options.start = async () => ({ runId: "r2", sessionId: "s2" }); await env.board.start(id);
  const task = env.board.getSnapshot().tasks[0];
  assert.equal(task.runs.length, 3); assert.equal(task.runs[1].sessionId, "s1");
  env.emit({ kind: "done", runId: "r1" }); await tick();
  assert.equal(env.board.getSnapshot().tasks[0].status, "running"); env.board.dispose();
});

test("停止针对本任务原会话；中断 done 不会自动完成", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input); await env.board.start(id);
  await env.board.stop(id);
  assert.deepEqual(env.calls.stops, [{ engine: "codex", workspacePath: "/repo", sessionId: "s1" }]);
  env.emit({ kind: "done" }); await tick();
  const task = env.board.getSnapshot().tasks[0]; assert.equal(task.status, "review"); assert.equal(task.runs[0].outcome, "stopped"); env.board.dispose();
});

test("停止失败清除停止请求并允许重试", async () => {
  const env = setup({ stopError: true }); await env.board.ready; const id = await env.board.save(input); await env.board.start(id);
  await assert.rejects(env.board.stop(id), /停止失败/);
  assert.equal(env.board.getSnapshot().tasks[0].runs[0].stopRequested, false);
  env.options.stopError = false; await env.board.stop(id); assert.equal(env.calls.stops.length, 2); env.board.dispose();
});

test("重启不自动重发；核对旧会话后才能解除占用", async () => {
  const original = setup(); await original.board.ready; const id = await original.board.save(input); await original.board.start(id);
  const env = setup({ file: original.file() }); await env.board.ready;
  assert.equal(env.board.getSnapshot().tasks[0].recovery, true);
  assert.equal(env.board.getSnapshot().tasks[0].runs[0].outcome, "unknown");
  await assert.rejects(env.board.start(id), /核对已有执行/);
  await assert.rejects(env.board.setStatus(id, "done"), /核对会话/);
  assert.equal(env.calls.starts.length, 0);
  await env.board.acknowledge(id); assert.equal(env.board.getSnapshot().tasks[0].status, "review");
  assert.equal(env.board.getSnapshot().tasks[0].runs[0].outcome, "ended");
  await env.board.setStatus(id, "done"); env.board.dispose(); original.board.dispose();
});

test("条件写入冲突不丢失内存任务，重新载入后可以保存", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input); env.conflict();
  await assert.rejects(env.board.save({ ...input, title: "冲突编辑" }, id), /版本冲突/);
  assert.equal(env.board.getSnapshot().tasks[0].title, input.title);
  await env.board.reload(); await env.board.save({ ...input, title: "成功编辑" }, id);
  assert.equal(env.board.getSnapshot().tasks[0].title, "成功编辑"); env.board.dispose();
});

test("已移除工作区或模型、不可用引擎不启动", async () => {
  for (const change of [
    (ctx) => { ctx.workspaces.list = async () => []; },
    (ctx) => { ctx.models.listEngines = async () => []; },
    (ctx) => { ctx.models.catalog = async () => ({ engines: [], errors: [] }); },
  ]) {
    const env = setup(); await env.board.ready; const id = await env.board.save(input); change(env.ctx);
    await assert.rejects(env.board.start(id), /重新选择/); assert.equal(env.calls.starts.length, 0); env.board.dispose();
  }
});

test("同名模型按渠道区分并传入对应 providerId", async () => {
  const env = setup(); await env.board.ready;
  env.ctx.models.catalog = async () => ({ engines: [{ engine: { id: "codex" }, sources: [
    { id: "channel-a", name: "渠道一", kind: "provider", models: [{ id: "shared-model" }] },
    { id: "channel-b", name: "渠道二", kind: "provider", models: [{ id: "shared-model" }] },
  ] }], errors: [] });
  const id = await env.board.save({ ...input, model: "shared-model", providerId: "channel-b" }); await env.board.start(id);
  assert.equal(env.calls.starts[0].providerId, "channel-b");
  assert.equal(env.calls.starts[0].model, "shared-model");
  env.board.dispose();
});

test("终态写入失败显示错误；重新载入进入待核对而非伪造完成", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input); await env.board.start(id);
  env.options.failWrite = true; env.emit({ kind: "done" }); await tick();
  assert.match(env.board.getSnapshot().error, /磁盘已满/);
  assert.equal(env.board.getSnapshot().tasks[0].status, "running");
  assert.equal(env.board.canReload(), true);
  env.options.failWrite = false; await env.board.reload();
  assert.equal(env.board.getSnapshot().tasks[0].recovery, true); env.board.dispose();
});

test("快速结束后会话关联保存失败仍可重新载入恢复", async () => {
  const handle = deferred(); const env = setup({ start: () => handle.promise }); await env.board.ready;
  const id = await env.board.save(input); const start = env.board.start(id); await tick();
  env.emit({ kind: "done" }); env.options.failWrite = true;
  handle.resolve({ runId: "r1", sessionId: "s1" });
  await assert.rejects(start, /磁盘已满/);
  assert.equal(env.board.canReload(), true);
  env.options.failWrite = false; await env.board.reload();
  assert.equal(env.board.getSnapshot().tasks[0].recovery, true); env.board.dispose();
});

test("停用清理事件订阅，不再接受操作", async () => {
  const env = setup(); await env.board.ready; env.board.dispose();
  assert.equal(env.calls.unsubscribed, true); await assert.rejects(env.board.save(input), /已停用/);
});

test("附件可代替需求和验收文字，分区保存并传入原生会话", async () => {
  const env = setup(); await env.board.ready;
  const descriptionFiles = [{ name: "需求 文档.pdf", path: "/files/需求 文档.pdf", grantId: "g1" }];
  const criteriaFiles = [{ name: "验收标准.xlsx", path: "/files/验收标准.xlsx", grantId: "g2" }];
  const id = await env.board.save({ ...input, description: "", criteria: "", descriptionFiles, criteriaFiles });
  await env.board.reload();
  assert.deepEqual(env.board.getSnapshot().tasks[0].descriptionFiles, descriptionFiles);
  assert.deepEqual(env.board.getSnapshot().tasks[0].criteriaFiles, criteriaFiles);
  await env.board.start(id);
  const prompt = env.calls.starts[0].prompt;
  assert.match(prompt.split("验收标准：")[0], /需求 文档\.pdf/);
  assert.match(prompt.split("验收标准：")[1], /验收标准\.xlsx/);
  assert.match(prompt, /不可读取或无法解析/);
  env.board.dispose();
});

test("附件记录损坏或缺失不能绕过必填校验", async () => {
  const env = setup(); await env.board.ready;
  await assert.rejects(env.board.save({ ...input, description: "", descriptionFiles: [] }), /输入文字或选择附件/);
  await assert.rejects(env.board.save({ ...input, criteriaFiles: [{ name: "x", path: "/x" }] }), /附件记录无效/);
  assert.equal(env.calls.writes, 0); env.board.dispose();
});

test("验收反馈独立追加；修正携带反馈，原任务及旧会话保留", async () => {
  const env = setup(); await env.board.ready;
  const id = await env.board.save(input); await env.board.start(id);
  env.emit({ kind: "done" }); await tick();
  const original = env.board.getSnapshot().tasks[0];
  await env.board.addFeedback(id, "验收项：占位图。实际偏差：未居中。修正要求：水平居中。", original.runs[0].id);
  const rejected = env.board.getSnapshot().tasks[0];
  assert.equal(rejected.status, "todo");
  for (const key of ["title", "description", "criteria"]) assert.equal(rejected[key], original[key]);
  assert.equal(rejected.feedbacks[0].afterRunId, original.runs[0].id);
  assert.equal(rejected.runs[0].reviewDecision, "rejected");
  assert.equal(env.calls.starts.length, 1);
  await env.board.reload();
  env.options.start = async () => ({ runId: "r2", sessionId: "s2" }); await env.board.start(id);
  assert.match(env.calls.starts[1].prompt, /修正要求：水平居中/);
  assert.match(env.calls.starts[1].prompt, /空列表显示占位/);
  assert.match(env.calls.starts[1].prompt, /空列表不抛异常/);
  assert.equal(env.board.getSnapshot().tasks[0].runs[0].sessionId, "s1");
  env.emit({ kind: "done", runId: "r2", sessionId: "s2" }); await tick();
  assert.equal(env.board.getSnapshot().tasks[0].status, "review");
  assert.equal(env.board.getSnapshot().tasks[0].pendingFeedbackIds.length, 1);
  await env.board.setStatus(id, "done");
  const accepted = env.board.getSnapshot().tasks[0];
  assert.equal(accepted.pendingFeedbackIds.length, 0);
  assert.ok(accepted.feedbacks[0].resolvedAt);
  assert.equal(accepted.runs[1].reviewDecision, "accepted");
  assert.equal(accepted.runs[1].sessionId, "s2"); env.board.dispose();
});

test("空反馈、执行中反馈和过期结果的反馈被拒绝", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  await env.board.start(id); const first = env.board.getSnapshot().tasks[0].runs[0];
  await assert.rejects(env.board.addFeedback(id, "偏差", first.id), /待验收/);
  env.emit({ kind: "done" }); await tick();
  await assert.rejects(env.board.addFeedback(id, "  ", first.id), /填写/);
  await assert.rejects(env.board.addFeedback(id, "偏差", "old-run"), /执行记录已变化/);
  assert.equal(env.board.getSnapshot().tasks[0].status, "review"); env.board.dispose();
});

test("反馈保存失败不改变验收状态；修正失败可重试且不丢反馈", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input); await env.board.start(id);
  env.emit({ kind: "done" }); await tick(); const first = env.board.getSnapshot().tasks[0].runs[0];
  env.options.failWrite = true;
  await assert.rejects(env.board.addFeedback(id, "按钮间距不正确", first.id), /磁盘已满/);
  assert.equal(env.board.getSnapshot().tasks[0].status, "review");
  env.options.failWrite = false; await env.board.addFeedback(id, "按钮间距不正确", first.id);
  env.options.start = async () => { throw new Error("启动失败"); };
  await assert.rejects(env.board.start(id), /启动失败/);
  assert.equal(env.board.getSnapshot().tasks[0].pendingFeedbackIds.length, 1);
  env.options.start = async () => ({ runId: "retry", sessionId: "retry-session" }); await env.board.start(id);
  assert.match(env.calls.starts.at(-1).prompt, /按钮间距不正确/); env.board.dispose();
});

test("多次返工携带所有未通过反馈，验收成功统一闭环", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input); await env.board.start(id);
  env.emit({ kind: "done" }); await tick(); let task = env.board.getSnapshot().tasks[0];
  await env.board.addFeedback(id, "偏差一", task.runs.at(-1).id);
  await env.board.addFeedback(id, "补充偏差二", task.runs.at(-1).id);
  env.options.start = async () => ({ runId: "r2", sessionId: "s2" }); await env.board.start(id);
  env.emit({ kind: "done", runId: "r2", sessionId: "s2" }); await tick(); task = env.board.getSnapshot().tasks[0];
  await env.board.addFeedback(id, "偏差一仍未满足", task.runs.at(-1).id);
  env.options.start = async () => ({ runId: "r3", sessionId: "s3" }); await env.board.start(id);
  for (const text of ["偏差一", "补充偏差二", "偏差一仍未满足"]) assert.ok(env.calls.starts.at(-1).prompt.includes(text));
  env.emit({ kind: "done", runId: "r3", sessionId: "s3" }); await tick(); await env.board.setStatus(id, "done");
  task = env.board.getSnapshot().tasks[0];
  assert.equal(task.feedbacks.length, 3); assert.equal(task.runs.length, 3);
  assert.ok(task.feedbacks.every((feedback) => feedback.resolvedAt));
  assert.equal(task.pendingFeedbackIds.length, 0); env.board.dispose();
});


test("快捷筛选可组合工作区和搜索，已完成反馈不进入待修正", () => {
  const tasks = [
    { ...input, id: "a", status: "review", pendingFeedbackIds: ["previous"] },
    { ...input, id: "b", status: "todo", pendingFeedbackIds: ["f"] },
    { ...input, id: "c", status: "done", pendingFeedbackIds: ["old"] },
    { ...input, id: "d", status: "blocked", workspacePath: "/other" },
  ].map((task) => ({ ...task, updatedAt: "2026-10-29" }));
  assert.deepEqual(selectTasks(tasks, { focus: "revision" }).map((t) => t.id), ["b"]);
  assert.deepEqual(selectTasks(tasks, { focus: "all", workspace: "/repo", search: " 空列表 " }).map((t) => t.id), ["a", "b", "c"]);
  assert.equal(selectTasks(tasks, { focus: "revision", workspace: "/other" }).length, 0);
});

test("视图持久保存并恢复，写入失败可见且后续可重试", async () => {
  let value; let fail = false;
  const ctx = { storage: { get: async () => value, set: async (key, next) => { assert.equal(key, "board-view"); if (fail) throw Error("磁盘失败"); value = next; } } };
  const view = createViewStore(ctx); await view.ready;
  await view.update({ workspace: "/repo", search: "关键词", focus: "revision", collapsed: ["done"] });
  const restored = createViewStore(ctx); await restored.ready;
  assert.equal(restored.getSnapshot().search, "关键词");
  assert.deepEqual(restored.getSnapshot().collapsed, ["done"]);
  fail = true; await view.update({ search: "失败后保留" });
  assert.match(view.getSnapshot().error, /磁盘失败/);
  fail = false; await view.update({ search: "重试" });
  assert.equal(value.search, "重试"); assert.equal(view.getSnapshot().error, "");
  view.dispose(); restored.dispose();
});

test("每轮输入快照与实际发送相同，编辑原任务不改历史输入", async () => {
  const env = setup(); await env.board.ready;
  const id = await env.board.save(input); await env.board.start(id);
  const original = env.board.getSnapshot().tasks[0].runs[0].input;
  assert.equal(original.prompt, env.calls.starts[0].prompt);
  env.emit({ kind: "done" }); await tick();
  await env.board.save({ ...input, description: "新的需求" }, id);
  assert.deepEqual(env.board.getSnapshot().tasks[0].runs[0].input, original);
  const restored = setup({ file: env.file() }); await restored.board.ready;
  assert.equal(restored.board.getSnapshot().tasks[0].runs[0].input.prompt, original.prompt);
  env.board.dispose(); restored.board.dispose();
});

test("反馈可仅附文件，重载和修正保留附件，非法附件不能写入", async () => {
  const env = setup(); await env.board.ready;
  const id = await env.board.save(input); await env.board.start(id);
  env.emit({ kind: "done" }); await tick();
  const run = env.board.getSnapshot().tasks[0].runs[0];
  await assert.rejects(env.board.addFeedback(id, "", run.id, [{ name: "坏文件" }]), /附件/);
  const files = [{ name: "偏差.png", path: "/tmp/偏差.png", grantId: "grant" }];
  await env.board.addFeedback(id, "", run.id, files);
  await env.board.reload();
  assert.deepEqual(env.board.getSnapshot().tasks[0].feedbacks[0].files, files);
  await env.board.start(id);
  assert.match(env.calls.starts[1].prompt, /本轮为验收返工/);
  assert.match(env.calls.starts[1].prompt, /\/tmp\/偏差.png/);
  assert.equal(env.board.getSnapshot().tasks[0].runs[1].input.prompt, env.calls.starts[1].prompt);
  env.board.dispose();
});


test("评论路由：回复 Agent、讨论继承及显式提及，备注不触发", () => {
  const task = { runs: [{ id: "r" }], comments: [{ id: "u", replyTo: "run:r", triggerAgent: true }, { id: "mention", replyTo: null, triggerAgent: true }] };
  assert.equal(routesToAgent(task, "第3条不通过", "run:r"), true);
  assert.equal(routesToAgent(task, "补充偏差", "u"), true);
  assert.equal(routesToAgent(task, "继续补充", "mention"), true);
  assert.equal(routesToAgent(task, "@Agent 请修正"), true);
  assert.equal(routesToAgent(task, "普通留言"), false);
  assert.equal(routesToAgent(task, "/note @Agent 备忘", "run:r"), false);
  assert.equal(routesToAgent(task, "@all 请查看", "run:r"), false);
  assert.equal(routesToAgent(task, "@Other 请查看", "run:r"), false);
});

test("评论先落盘，普通留言不启动；提及以该评论为重点并保留原任务", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  await env.board.addComment(id, { content: "讨论背景" }); assert.equal(env.calls.starts.length, 0);
  const result = await env.board.addComment(id, { content: "@Agent 第3条验收未通过，导出文件缺少金额列，请补齐并验证。" });
  assert.equal(result.deliveryError, ""); assert.equal(env.calls.starts.length, 1);
  const task = env.board.getSnapshot().tasks[0];
  assert.equal(task.description, input.description); assert.equal(task.comments.length, 2);
  assert.equal(task.runs[0].commentId, result.id);
  assert.match(env.calls.starts[0].prompt, /本轮重点评论：\n@Agent 第3条/);
  assert.match(env.calls.starts[0].prompt, /讨论背景/);
  assert.equal(task.runs[0].input.prompt, env.calls.starts[0].prompt);
  env.emit({ kind: "done" }); await tick();
  assert.equal(env.board.getSnapshot().tasks[0].status, "review");
  await env.board.setStatus(id, "done");
  assert.ok(env.board.getSnapshot().tasks[0].comments[1].resolvedAt);
  await env.board.reload(); assert.equal(env.board.getSnapshot().tasks[0].comments.length, 2);
  env.board.dispose();
});

test("回复历史 Agent 结果触发新会话；失败可重试且不丢评论", async () => {
  let fail = true;
  const env = setup({ start: async () => { if (fail) throw Error("引擎启动失败"); return { runId: "r1", sessionId: "s1" }; } });
  await env.board.ready; const id = await env.board.save(input);
  const result = await env.board.addComment(id, { content: "@Agent 修正金额列" });
  assert.match(result.deliveryError, /评论已保存/);
  fail = false; await env.board.start(id, result.id); env.emit({ kind: "done" }); await tick();
  const previous = env.board.getSnapshot().tasks[0].runs.at(-1);
  const reply = await env.board.addComment(id, { content: "金额列还需要两位小数", replyTo: `run:${previous.id}` });
  assert.equal(reply.deliveryError, "");
  assert.equal(env.board.getSnapshot().tasks[0].runs.at(-1).commentId, reply.id);
  assert.match(env.calls.starts.at(-1).prompt, /本轮重点评论：\n金额列还需要两位小数/);
  assert.equal(env.board.getSnapshot().tasks[0].comments.length, 2);
  env.board.dispose();
});

test("运行中触发评论保存为待处理，未处理不能通过验收", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  const first = await env.board.addComment(id, { content: "@Agent 处理A" });
  const second = await env.board.addComment(id, { content: "@Agent 处理B" });
  assert.match(second.deliveryError, /已有看板任务/); assert.equal(env.calls.starts.length, 1);
  env.emit({ kind: "done" }); await tick();
  await assert.rejects(env.board.setStatus(id, "done"), /还有评论/);
  await env.board.start(id, second.id); env.emit({ kind: "done" }); await tick();
  assert.deepEqual(env.board.getSnapshot().tasks[0].runs.at(-1).commentIds, [second.id]);
  await env.board.setStatus(id, "done");
  assert.ok(env.board.getSnapshot().tasks[0].comments.every((entry) => entry.resolvedAt));
  assert.notEqual(first.id, second.id); env.board.dispose();
});

test("评论写入失败保留任务且不启动；非法回复与损坏评论拒绝", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  await assert.rejects(env.board.addComment(id, { content: "反馈", replyTo: "missing" }), /不存在/);
  env.options.failWrite = true;
  await assert.rejects(env.board.addComment(id, { content: "@Agent 修正" }), /磁盘/);
  assert.equal(env.calls.starts.length, 0); assert.equal(env.board.getSnapshot().tasks[0].comments.length, 0);
  env.options.failWrite = false;
  await env.board.addComment(id, { content: "<script>纯文本</script>" });
  const doc = JSON.parse(env.file()); doc.tasks[0].comments[0].files = [{ name: "坏文件" }];
  const broken = setup({ file: JSON.stringify(doc) }); await broken.board.ready;
  assert.equal(broken.board.getSnapshot().ready, false); assert.equal(broken.calls.writes, 0);
  env.board.dispose(); broken.board.dispose();
});


test("标签去重、有效截止日期、逾期及标签搜索", async () => {
  const env = setup(); await env.board.ready;
  await assert.rejects(env.board.save({ ...input, dueDate: "2026-02-30" }), /截止日期/);
  const id = await env.board.save({ ...input, tags: "导出, 验收，导出", dueDate: "2026-01-01" });
  const task = env.board.getSnapshot().tasks[0]; assert.deepEqual(task.tags, ["导出", "验收"]);
  assert.equal(isOverdue(task, "2026-01-02"), true); assert.equal(isOverdue({ ...task, status: "done" }), false);
  assert.equal(selectTasks([task], { search: "导出", focus: "overdue" }).length, 1);
  assert.equal(selectTasks([task], { search: "其他" }).length, 0);
  await env.board.reload(); assert.equal(env.board.getSnapshot().tasks[0].id, id); env.board.dispose();
});

test("父子任务可独立推进；不存在父任务和关系循环拒绝保存", async () => {
  const env = setup(); await env.board.ready;
  const parent = await env.board.save(input); const child = await env.board.save({ ...input, title: "子任务", parentId: parent });
  await assert.rejects(env.board.save({ ...input, parentId: child }, parent), /循环/);
  await assert.rejects(env.board.save({ ...input, parentId: "missing" }), /不存在/);
  await env.board.setStatus(child, "cancelled");
  assert.equal(env.board.getSnapshot().tasks.find((task) => task.id === parent).status, "todo");
  await env.board.reload(); assert.equal(env.board.getSnapshot().tasks.find((task) => task.id === child).parentId, parent); env.board.dispose();
});

test("从评论拆子任务只截取当时讨论，编辑父任务不改变来源快照", async () => {
  const env = setup(); await env.board.ready; const parent = await env.board.save(input);
  const first = await env.board.addComment(parent, { content: "拆出金额列格式需求" });
  await env.board.addComment(parent, { content: "之后的讨论" });
  const draft = childFromComment(env.board.getSnapshot().tasks[0], first.id);
  const child = await env.board.save(draft); const before = env.board.getSnapshot().tasks.find((task) => task.id === child).sourceSnapshot;
  assert.match(before, /拆出金额列/); assert.doesNotMatch(before, /之后的讨论/);
  await env.board.save({ ...input, title: "父任务已修改" }, parent);
  await env.board.reload(); assert.equal(env.board.getSnapshot().tasks.find((task) => task.id === child).sourceSnapshot, before);
  assert.equal(env.calls.starts.length, 0); env.board.dispose();
});

test("排序支持优先级、截止日期、创建时间及最近更新", () => {
  const a = { ...input, id: "a", status: "todo", priority: "low", dueDate: "2026-01-01", createdAt: "2026-01-01", updatedAt: "2026-01-03" };
  const b = { ...input, id: "b", status: "todo", priority: "high", createdAt: "2026-01-02", updatedAt: "2026-01-02" };
  assert.equal(selectTasks([a, b])[0].id, "b");
  for (const sort of ["due", "updated"]) assert.equal(selectTasks([b, a], { sort })[0].id, "a");
  assert.equal(selectTasks([a, b], { sort: "created" })[0].id, "b");
});

test("命名视图、评论草稿及快捷操作能持久恢复", async () => {
  let stored; const ctx = { storage: { get: async () => stored, set: async (key, value) => { stored = value; } } };
  const view = createViewStore(ctx); await view.ready;
  await view.update({ project: "验收", sort: "due", savedViews: [{ id: "v", name: "我的验收", view: { project: "验收", sort: "due" } }], quickActions: [{ id: "q", name: "复验", content: "@Agent 请复验" }], drafts: { task: { content: "尚未发表", replyTo: "run:r", files: [] } } });
  const restored = createViewStore(ctx); await restored.ready; const state = restored.getSnapshot();
  assert.equal(state.savedViews[0].view.project, "验收"); assert.equal(state.quickActions[0].content, "@Agent 请复验"); assert.equal(state.drafts.task.content, "尚未发表");
  assert.equal(state.sort, "due"); view.dispose(); restored.dispose();
});

test("批量修改一次落盘，运行中任务让整批拒绝，不能绕过验收", async () => {
  const env = setup(); await env.board.ready; const a = await env.board.save(input); const b = await env.board.save({ ...input, title: "B" });
  const writes = env.calls.writes; await env.board.bulkUpdate([a, b], { priority: "low" }); assert.equal(env.calls.writes, writes + 1);
  assert.ok(env.board.getSnapshot().tasks.every((task) => task.priority === "low"));
  await assert.rejects(env.board.bulkUpdate([a, b], { status: "done" }), /逐项验收/);
  await env.board.start(a); await assert.rejects(env.board.bulkUpdate([a, b], { priority: "high" }), /未进行批量修改/);
  assert.equal(env.board.getSnapshot().tasks.find((task) => task.id === b).priority, "low"); env.board.dispose();
});

test("重复任务保留记录、阻止执行且可撤销；重复关系限制一层", async () => {
  const env = setup(); await env.board.ready; const original = await env.board.save(input); const duplicate = await env.board.save({ ...input, title: "重复" }); const third = await env.board.save({ ...input, title: "第三项" });
  await env.board.addComment(duplicate, { content: "保留的讨论" });
  await env.board.markDuplicate(duplicate, original);
  await assert.rejects(env.board.start(duplicate), /原任务/);
  await assert.rejects(env.board.addComment(duplicate, { content: "@Agent 执行" }), /重复任务/);
  await assert.rejects(env.board.markDuplicate(original, duplicate), /一层/);
  await assert.rejects(env.board.markDuplicate(third, duplicate), /一层/);
  await env.board.reload(); let task = env.board.getSnapshot().tasks.find((task) => task.id === duplicate); assert.equal(task.status, "cancelled"); assert.equal(task.comments[0].content, "保留的讨论");
  await env.board.markDuplicate(duplicate, null); task = env.board.getSnapshot().tasks.find((task) => task.id === duplicate); assert.equal(task.status, "todo"); assert.equal(task.duplicateOf, null); env.board.dispose();
});


test("新宿主评论续接原会话，旧宿主仍新建；配置改变不误用旧会话", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  await env.board.start(id); env.emit({ kind: "done" }); await tick();
  env.ctx.sessions.supportsResume = true;
  const result = await env.board.addComment(id, { content: "@Agent 修正金额列" });
  assert.equal(result.deliveryError, ""); assert.equal(env.calls.starts[1].sessionId, "s1");
  assert.equal(env.board.getSnapshot().tasks[0].runs[1].resumeSessionId, "s1");
  env.emit({ kind: "done" }); await tick();
  env.ctx.sessions.supportsResume = false;
  await env.board.addComment(id, { content: "@Agent 再复验" }); assert.equal(env.calls.starts[2].sessionId, undefined);
  const task = env.board.getSnapshot().tasks[0];
  assert.equal(resumeTarget({ ...task, workspacePath: "/changed" }, task.comments[0].id, true), null);
  assert.equal(resumeTarget({ ...task, model: "changed" }, task.comments[0].id, true), null);
  env.board.dispose();
});

test("回复特定旧轮次续接该会话；续接失败不静默新建替代会话", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  await env.board.start(id); env.emit({ kind: "done" }); await tick();
  const first = env.board.getSnapshot().tasks[0].runs[0];
  env.ctx.sessions.supportsResume = true;
  env.options.start = async () => { throw Error("session_busy"); };
  const result = await env.board.addComment(id, { content: "修正", replyTo: `run:${first.id}` });
  assert.match(result.deliveryError, /session_busy/); assert.equal(env.calls.starts.length, 2);
  assert.equal(env.calls.starts[1].sessionId, "s1"); assert.equal(env.board.getSnapshot().tasks[0].comments.length, 1);
  env.board.dispose();
});


test("损坏的标签、日期与父子关系不会覆盖任务文档", async () => {
  const env = setup(); await env.board.ready; await env.board.save(input); const original = JSON.parse(env.file());
  for (const patch of [{ tags: "非法文件字段" }, { dueDate: 0 }, { parentId: "missing" }]) {
    const document = structuredClone(original); Object.assign(document.tasks[0], patch);
    const corrupted = setup({ file: JSON.stringify(document) }); await corrupted.board.ready;
    assert.equal(corrupted.board.getSnapshot().ready, false); assert.equal(corrupted.calls.writes, 0); corrupted.board.dispose();
  }
  env.board.dispose();
});


test("项目筛选与搜索组合，子任务始终显示且视图可恢复", async () => {
  const env = setup(); await env.board.ready;
  const parent = await env.board.save({ ...input, project: "个人导出项目" });
  await env.board.save({ ...input, project: "个人导出项目", parentId: parent, stage: 2, priority: "low" });
  const tasks = env.board.getSnapshot().tasks;
  assert.equal(selectTasks(tasks, { project: "个人导出项目" }).length, 2);
  assert.equal(selectTasks(tasks, { project: "不存在" }).length, 0);
  assert.equal(selectTasks(tasks, { project: "个人导出项目", search: "列表" }).length, 2);
  let value; const ctx = { storage: { get: async () => value, set: async (key, next) => { value = next; } } };
  const view = createViewStore(ctx); await view.ready; await view.update({ project: "个人导出项目", priority: "low", showChildren: false, layout: "list" });
  const other = createViewStore(ctx); await other.ready; assert.equal(other.getSnapshot().layout, "list"); assert.equal(other.getSnapshot().showChildren, undefined); assert.equal(other.getSnapshot().project, "个人导出项目");
  view.dispose(); other.dispose(); env.board.dispose();
});

test("较早阶段未结束时不启动后续子任务，结束后可推进且不自动验收父任务", async () => {
  const env = setup(); await env.board.ready; const parent = await env.board.save(input);
  await assert.rejects(env.board.save({ ...input, parentId: parent, stage: 0 }), /阶段/);
  const first = await env.board.save({ ...input, parentId: parent, stage: 1 });
  const later = await env.board.save({ ...input, parentId: parent, stage: 2 });
  await assert.rejects(env.board.start(later), /较早阶段/); assert.equal(env.calls.starts.length, 0);
  await env.board.setStatus(first, "cancelled"); await env.board.start(later);
  assert.equal(env.calls.starts.length, 1); assert.equal(env.board.getSnapshot().tasks.find((task) => task.id === parent).status, "todo"); env.board.dispose();
});

test("解决讨论不改变验收，嵌套回复重新打开讨论；表情可撤销且不触发 Agent", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  const root = await env.board.addComment(id, { content: "金额列偏差" }); const reply = await env.board.addComment(id, { content: "已确认", replyTo: root.id });
  await env.board.resolveThread(id, reply.id, true); assert.deepEqual(env.board.getSnapshot().tasks[0].resolvedThreads, [root.id]);
  await env.board.reactToComment(id, root.id, "👍"); assert.deepEqual(env.board.getSnapshot().tasks[0].comments[0].reactions, ["👍"]);
  await env.board.reactToComment(id, root.id, "👍"); assert.deepEqual(env.board.getSnapshot().tasks[0].comments[0].reactions, []);
  await env.board.addComment(id, { content: "仍有问题", replyTo: reply.id }); assert.deepEqual(env.board.getSnapshot().tasks[0].resolvedThreads, []);
  assert.equal(env.board.getSnapshot().tasks[0].status, "todo"); assert.equal(env.calls.starts.length, 0); await env.board.reload(); assert.equal(env.board.getSnapshot().tasks[0].comments.length, 3); env.board.dispose();
});

test("引用只作为背景，触发由新正文决定，输入快照保留原引用", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  const source = await env.board.addComment(id, { content: "/note @Agent 历史片段" });
  await env.board.addComment(id, { content: "普通意见", quoteSourceId: source.id }); assert.equal(env.calls.starts.length, 0);
  await env.board.addComment(id, { content: "@Agent 仅修正金额列", quoteSourceId: source.id });
  const task = env.board.getSnapshot().tasks[0]; assert.equal(task.comments[2].quote.text, "/note @Agent 历史片段");
  assert.match(env.calls.starts[0].prompt, /引用原文（仅作背景）/); assert.match(env.calls.starts[0].prompt, /本轮重点评论/); env.board.dispose();
});

test("统计排除未启动尝试和恢复未知状态，不伪造缺失耗时", () => {
  const metrics = taskMetrics([{ runs: [
    { runId: "a", outcome: "ended", startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:00:10Z" },
    { runId: "b", outcome: "error", startedAt: "bad", endedAt: null },
    { runId: null, outcome: "error" }, { runId: "c", outcome: "running" }, { runId: "d", outcome: "unknown" },
  ] }]);
  assert.equal(metrics.runs, 2); assert.equal(metrics.errors, 1); assert.equal(metrics.errorRate, .5); assert.equal(metrics.durationMs, 10000); assert.equal(metrics.unmeasured, 1); assert.equal(metrics.unstarted, 1);
  assert.equal(taskMetrics([{ runs: [] }]).errorRate, null);
});

test("附件汇总保留来源并区分图片、文档、视频和其他文件", () => {
  const file = (name) => ({ name, path: `/tmp/${name}`, grantId: "g" });
  const items = taskAttachments({ descriptionFiles: [file("需求.md")], criteriaFiles: [file("验收.pdf")], comments: [{ createdAt: "2026-01-01", files: [file("偏差.PNG"), file("演示.mp4")] }], feedbacks: [{ createdAt: "2026-01-01", files: [file("诊断.zip")] }] });
  assert.deepEqual(items.map((entry) => entry.type), ["document", "document", "image", "video", "other"]); assert.match(items[2].source, /评论/); assert.match(items[4].source, /反馈/);
});


test("保存后仅清除会隐藏任务的筛选，并展开任务所在状态列", () => {
  const task = { ...input, project: "", tags: [], status: "todo", parentId: "parent", updatedAt: "2026-10-29" };
  const view = { workspace: "/other", project: "个人面板验收", priority: "low", tag: "其他", search: "找不到", focus: "review", showChildren: false, layout: "board", sort: "due", collapsed: ["todo", "done"] };
  assert.equal(selectTasks([task], view).length, 0);
  const visible = revealTaskView(view, task);
  assert.equal(selectTasks([task], visible).length, 1); assert.deepEqual(visible.collapsed, ["done"]); assert.equal(visible.sort, "due"); assert.equal(visible.showChildren, undefined);
  const matching = { ...view, workspace: "/repo", project: "", priority: "high", tag: "", search: "修复", focus: "all", showChildren: true, collapsed: ["done"] };
  const kept = revealTaskView(matching, task); assert.equal(kept.search, "修复"); assert.equal(kept.priority, undefined); assert.deepEqual(kept.collapsed, ["done"]);
});


test("旧筛选与命名视图移除隐藏条件，保留项目和有效快捷筛选", async () => {
  let stored = { project: "项目A", priority: "high", tag: "旧标签", showChildren: false, focus: "review", savedViews: [{ id: "old", name: "旧视图", view: { project: "项目A", tag: "旧标签", priority: "low", showChildren: false, focus: "blocked" } }] };
  const view = createViewStore({ storage: { get: async () => stored, set: async (key, value) => { stored = value; } } }); await view.ready;
  const state = view.getSnapshot(); assert.equal(state.project, "项目A"); assert.equal(state.focus, "all");
  for (const value of [state, state.savedViews[0].view]) for (const key of ["priority", "tag", "showChildren"]) assert.equal(Object.hasOwn(value, key), false);
  await view.update({ priority: "low", tag: "隐藏", showChildren: false, focus: "revision" });
  assert.equal(stored.focus, "revision"); assert.equal(Object.hasOwn(stored, "tag"), false);
  view.dispose();
});


test("快捷编辑只改允许字段，验证输入、失败回滚、运行锁与重载", async () => {
  const env = setup(); await env.board.ready;
  const id = await env.board.save({ ...input, tags: "回归", project: "项目" });
  await env.board.editFields(id, { title: "新标题", priority: "low", dueDate: "2026-12-01", description: "不允许覆盖" });
  let task = env.board.getSnapshot().tasks[0];
  assert.equal(task.title, "新标题"); assert.equal(task.description, input.description); assert.deepEqual(task.tags, ["回归"]);
  await assert.rejects(env.board.editFields(id, { title: " " }), /标题/);
  await assert.rejects(env.board.editFields(id, { dueDate: "2026-02-30" }), /日期/);
  await assert.rejects(env.board.editFields(id, { priority: "invalid" }), /优先级/);
  env.options.failWrite = true;
  await assert.rejects(env.board.editFields(id, { title: "不应保存" }), /磁盘/);
  assert.equal(env.board.getSnapshot().tasks[0].title, "新标题");
  env.options.failWrite = false; await env.board.reload();
  task = env.board.getSnapshot().tasks[0]; assert.equal(task.dueDate, "2026-12-01"); assert.equal(task.project, "项目");
  await env.board.start(id); await assert.rejects(env.board.editFields(id, { title: "运行中" }), /结束或核对/);
  env.board.dispose();
});


test("执行通知去重，已读归档持久保存且不改变验收状态", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  await env.board.start(id); env.emit({ kind: "done" }); await tick();
  let notices = taskNotices(env.board.getSnapshot().tasks); assert.equal(notices.length, 1); assert.equal(notices[0].read, false);
  env.emit({ kind: "done" }); await tick(); assert.equal(taskNotices(env.board.getSnapshot().tasks).length, 1);
  await env.board.updateNotice(id, notices[0].id, { read: true, archived: true }); await env.board.reload();
  notices = taskNotices(env.board.getSnapshot().tasks); assert.equal(notices[0].read, true); assert.equal(notices[0].archived, true); assert.equal(env.board.getSnapshot().tasks[0].status, "review");
  await env.board.updateNotice(id, notices[0].id, { archived: false });
  assert.equal(taskNotices(env.board.getSnapshot().tasks)[0].read, true);
  await assert.rejects(env.board.updateNotice(id, "missing", { read: true }), /不存在/);
  env.options.failWrite = true; await assert.rejects(env.board.updateNotice(id, notices[0].id, { read: false }), /磁盘/);
  assert.equal(taskNotices(env.board.getSnapshot().tasks)[0].read, true); env.board.dispose();
});


test("甘特时间轴按自然日跨月跨年，缺失日期单独处理", async () => {
  const tasks = [
    { id: "a", startDate: "2026-12-30", dueDate: "2027-01-02" },
    { id: "b", dueDate: "2027-01-02" }, { id: "c", startDate: "2026-12-30" }, { id: "d" },
  ];
  const timeline = taskTimeline(tasks);
  assert.equal(timeline.start, "2026-12-30"); assert.equal(timeline.end, "2027-01-02");
  assert.equal(timeline.rows[0].width, 100); assert.equal(timeline.rows[1].left, 75); assert.equal(timeline.rows[1].width, 25);
  assert.deepEqual(timeline.unscheduled.map((task) => task.id), ["d"]); assert.equal(timeline.rows[2].width, 25);
  assert.equal(taskTimeline([]).start, null);
  const env = setup(); await env.board.ready;
  await assert.rejects(env.board.save({ ...input, startDate: "2026-02-30" }), /开始日期/);
  await assert.rejects(env.board.save({ ...input, startDate: "2027-01-02", dueDate: "2026-12-30" }), /晚于/);
  const id = await env.board.save({ ...input, startDate: "2026-12-30", dueDate: "2027-01-02" });
  await assert.rejects(env.board.editFields(id, { dueDate: "2026-12-29" }), /晚于/);
  await env.board.reload(); assert.equal(env.board.getSnapshot().tasks[0].startDate, "2026-12-30"); env.board.dispose();
});


test("泳道按顶层父任务归组，筛选后仍保留归属且不带回隐藏任务", () => {
  const tasks = [{ id: "p", title: "父任务" }, { id: "c", parentId: "p" }, { id: "g", parentId: "c" }, { id: "solo" }];
  const lanes = taskSwimlanes(tasks);
  assert.deepEqual(lanes.map((lane) => [lane.id, lane.tasks.map((task) => task.id)]), [["p", ["p", "c", "g"]], ["ungrouped", ["solo"]]]);
  assert.deepEqual(taskSwimlanes([tasks[2]], tasks).map((lane) => [lane.parent.id, lane.tasks.map((task) => task.id)]), [["p", ["g"]]]);
  assert.deepEqual(taskSwimlanes([]), []);
});

test("卡片字段与泳道折叠随视图恢复，未知字段不进入设置", async () => {
  let data;
  const ctx = { storage: { get: async () => data, set: async (_, value) => { data = value; } } };
  const view = createViewStore(ctx); await view.ready;
  assert.equal(view.getSnapshot().cardFields.model, false);
  await view.update({ layout: "swimlane", cardFields: { model: true, priority: false, bogus: true }, collapsedLanes: ["p"] });
  const restored = createViewStore(ctx); await restored.ready;
  assert.equal(restored.getSnapshot().layout, "swimlane");
  assert.equal(restored.getSnapshot().cardFields.model, true);
  assert.equal(restored.getSnapshot().cardFields.priority, false);
  assert.equal(restored.getSnapshot().cardFields.bogus, undefined);
  assert.deepEqual(restored.getSnapshot().collapsedLanes, ["p"]);
  view.dispose(); restored.dispose();
});


test("项目说明隔离工作区、保存失败不修改、重载及每轮快照独立", async () => {
  const env = setup(); await env.board.ready;
  const id = await env.board.save({ ...input, project: "发布" });
  await env.board.saveProject("/other", "发布", "其他工作区说明");
  await env.board.saveProject("/repo", "发布", "采用既有接口，先运行测试");
  env.options.failWrite = true;
  await assert.rejects(env.board.saveProject("/repo", "发布", "失败的说明"), /磁盘/);
  assert.equal(env.board.getSnapshot().projects.find((p) => p.workspacePath === "/repo").description, "采用既有接口，先运行测试");
  env.options.failWrite = false;
  await env.board.start(id);
  const oldInput = env.board.getSnapshot().tasks[0].runs[0].input;
  assert.match(env.calls.starts[0].prompt, /项目共享说明：\n采用既有接口，先运行测试/);
  assert.doesNotMatch(env.calls.starts[0].prompt, /其他工作区说明/);
  assert.equal(oldInput.projectDescription, "采用既有接口，先运行测试");
  env.emit({ kind: "done" }); await tick();
  await env.board.saveProject("/repo", "发布", "新约定");
  await env.board.start(id); env.emit({ kind: "done" }); await tick();
  assert.equal(env.board.getSnapshot().tasks[0].runs[0].input.projectDescription, oldInput.projectDescription);
  assert.match(env.calls.starts[1].prompt, /新约定/);
  const restored = setup({ file: env.file() }); await restored.board.ready;
  assert.equal(restored.board.getSnapshot().projects.length, 2);
  await restored.board.saveProject("/repo", "发布", " ");
  assert.equal(restored.board.getSnapshot().projects.length, 1);
  env.board.dispose(); restored.board.dispose();
});

test("损坏项目说明不覆盖文档", async () => {
  for (const projects of [{}, [{ name: "项目", description: "说明" }], [{ workspacePath: "/repo", name: "项目", description: 1 }]]) {
    const env = setup({ file: JSON.stringify({ schemaVersion: 1, tasks: [], projects }) }); await env.board.ready;
    assert.equal(env.board.getSnapshot().ready, false); assert.match(env.board.getSnapshot().error, /项目说明/); assert.equal(env.calls.writes, 0); env.board.dispose();
  }
});

test("批量通知只修改收件箱标记，一次写入且失败完整回滚", async () => {
  const env = setup(); await env.board.ready;
  const a = await env.board.save(input); await env.board.start(a); env.emit({ kind: "done" }); await tick();
  const b = await env.board.save({ ...input, title: "已完成" }); await env.board.start(b); env.emit({ kind: "done" }); await tick(); await env.board.setStatus(b, "done");
  const before = structuredClone(env.board.getSnapshot().tasks);
  env.options.failWrite = true; await assert.rejects(env.board.bulkNotices("read"), /磁盘/); assert.deepEqual(env.board.getSnapshot().tasks, before); env.options.failWrite = false;
  const count = env.calls.writes; await env.board.bulkNotices("archive-completed"); assert.equal(env.calls.writes, count + 1);
  assert.equal(taskNotices(env.board.getSnapshot().tasks).find((n) => n.taskId === b).archived, true);
  await env.board.bulkNotices("read");
  const notices = taskNotices(env.board.getSnapshot().tasks);
  assert.equal(notices.find((n) => n.taskId === a).read, true); assert.equal(notices.find((n) => n.taskId === b).read, false);
  await env.board.bulkNotices("archive-read"); assert.equal(taskNotices(env.board.getSnapshot().tasks).every((n) => n.archived), true);
  const withoutNotices = (tasks) => tasks.map(({ noticeStates, ...task }) => task);
  assert.deepEqual(withoutNotices(env.board.getSnapshot().tasks), before);
  const restored = setup({ file: env.file() }); await restored.board.ready; assert.deepEqual(taskNotices(restored.board.getSnapshot().tasks), taskNotices(env.board.getSnapshot().tasks));
  await assert.rejects(env.board.bulkNotices("delete"), /无效/);
  env.board.dispose(); restored.board.dispose();
});

test("快捷操作失败保留旧版本，恢复归档并与草稿写入串行保存", async () => {
  let data; let fail = false;
  const ctx = { storage: { get: async () => data, set: async (_, value) => { if (fail) throw Error("写入失败"); data = structuredClone(value); } } };
  const view = createViewStore(ctx); await view.ready;
  const original = [{ id: "q", name: "审查", content: "@Agent 审查" }];
  await view.update({ quickActions: original }); fail = true;
  assert.equal(await view.update({ quickActions: [{ ...original[0], content: "新内容" }] }), false); assert.deepEqual(view.getSnapshot().quickActions, original);
  fail = false;
  await Promise.all([view.update({ quickActions: [{ ...original[0], archived: true }] }), view.update({ drafts: { task: { content: "草稿" } } })]);
  assert.equal(data.quickActions[0].archived, true); assert.equal(data.drafts.task.content, "草稿");
  const restored = createViewStore(ctx); await restored.ready; assert.equal(restored.getSnapshot().quickActions[0].archived, true);
  view.dispose(); restored.dispose();
});


test("阶段提醒遵守前序、区分取消、去重并保存已读归档", async () => {
  const env = setup(); await env.board.ready;
  const parent = await env.board.save(input);
  const first = await env.board.save({ ...input, title: "阶段一", parentId: parent, stage: 1 });
  const later = await env.board.save({ ...input, title: "阶段二", parentId: parent, stage: 2 });
  assert.deepEqual(stageNotices(env.board.getSnapshot().tasks), []);
  await env.board.setStatus(later, "cancelled"); assert.equal(stageNotices(env.board.getSnapshot().tasks).length, 0);
  await env.board.setStatus(later, "todo"); await env.board.setStatus(first, "cancelled");
  const notice = stageNotices(env.board.getSnapshot().tasks)[0]; assert.match(notice.summary, /阶段 1 已结束，阶段 2 可开始 · 0 项完成、1 项取消/);
  env.options.failWrite = true; await assert.rejects(env.board.updateNotice(parent, notice.id, { read: true }), /磁盘/); assert.equal(stageNotices(env.board.getSnapshot().tasks)[0].read, false); env.options.failWrite = false;
  await env.board.bulkNotices("read"); await env.board.bulkNotices("archive-read");
  await env.board.save({ ...input, title: "改标题", parentId: parent, stage: 1 }, first);
  assert.equal(stageNotices(env.board.getSnapshot().tasks)[0].id, notice.id); assert.equal(stageNotices(env.board.getSnapshot().tasks)[0].archived, true);
  const restored = setup({ file: env.file() }); await restored.board.ready; assert.equal(stageNotices(restored.board.getSnapshot().tasks)[0].archived, true);
  await env.board.setStatus(first, "todo"); assert.equal(stageNotices(env.board.getSnapshot().tasks).length, 0);
  await env.board.setStatus(first, "cancelled"); await env.board.setStatus(later, "cancelled");
  assert.match(stageNotices(env.board.getSnapshot().tasks).at(-1).summary, /全部子任务已结束 · 0 项完成、2 项取消/);
  assert.equal(env.board.getSnapshot().tasks.find((task) => task.id === parent).status, "todo"); assert.equal(env.calls.starts.length, 0);
  env.board.dispose(); restored.board.dispose();
});

test("讨论结论只允许同讨论回复，失败回滚、重载和回复重开不影响验收", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  const root = (await env.board.addComment(id, { content: "/note 问题" })).id;
  const reply = (await env.board.addComment(id, { content: "/note 结论", replyTo: root })).id;
  const other = (await env.board.addComment(id, { content: "/note 另一讨论" })).id;
  await assert.rejects(env.board.resolveThread(id, root, true, other), /结论/);
  await assert.rejects(env.board.resolveThread(id, root, true, root), /结论/);
  await assert.rejects(env.board.resolveThread(id, root, true, "missing"), /结论/);
  env.options.failWrite = true; await assert.rejects(env.board.resolveThread(id, reply, true, reply), /磁盘/); assert.equal(env.board.getSnapshot().tasks[0].threadConclusions?.[root], undefined); env.options.failWrite = false;
  await env.board.resolveThread(id, reply, true, reply);
  const restored = setup({ file: env.file() }); await restored.board.ready; assert.equal(restored.board.getSnapshot().tasks[0].threadConclusions[root], reply);
  await env.board.addComment(id, { content: "/note 继续讨论", replyTo: reply });
  assert.equal(env.board.getSnapshot().tasks[0].threadConclusions[root], undefined); assert.equal(env.board.getSnapshot().tasks[0].resolvedThreads.includes(root), false);
  assert.equal(env.board.getSnapshot().tasks[0].status, "todo"); assert.equal(env.calls.starts.length, 0);
  const document = JSON.parse(restored.file()); document.tasks[0].threadConclusions[root] = other;
  const bad = setup({ file: JSON.stringify(document) }); await bad.board.ready; assert.equal(bad.board.getSnapshot().ready, false); assert.match(bad.board.getSnapshot().error, /讨论结论/); assert.equal(bad.calls.writes, 0);
  env.board.dispose(); restored.board.dispose(); bad.board.dispose();
});


test("连续选择按可见顺序双向操作，跳过运行/待核对且锚点隐藏后只选目标", () => {
  const tasks = [{ id: "a", status: "todo" }, { id: "b", status: "running" }, { id: "c", recovery: true }, { id: "d", status: "review" }];
  assert.deepEqual(selectTaskRange(tasks, [], "a", "d", true), ["a", "d"]);
  assert.deepEqual(selectTaskRange(tasks, ["hidden", "a", "d"], "d", "a", false), ["hidden"]);
  assert.deepEqual(selectTaskRange([tasks[3]], [], "a", "d", true), ["d"]);
  assert.deepEqual(selectTaskRange(tasks, ["a"], "a", "missing", true), ["a"]);
});

test("列表列和打开偏好保存重载及命名视图，未知字段忽略", async () => {
  let data;
  const ctx = { storage: { get: async () => data, set: async (_, next) => { data = next; } } };
  const view = createViewStore(ctx); await view.ready; assert.equal(view.getSnapshot().openMode, "details"); assert.equal(view.getSnapshot().listFields.workspace, true);
  await view.update({ openMode: "preview", listFields: { workspace: false, bogus: true } });
  await view.update({ savedViews: [{ id: "v", name: "精简列表", view: view.getSnapshot() }] });
  const restored = createViewStore(ctx); await restored.ready;
  assert.equal(restored.getSnapshot().openMode, "preview"); assert.equal(restored.getSnapshot().listFields.workspace, false); assert.equal(restored.getSnapshot().listFields.priority, true); assert.equal(restored.getSnapshot().listFields.bogus, undefined);
  assert.equal(restored.getSnapshot().savedViews[0].view.openMode, "preview");
  view.dispose(); restored.dispose();
});

test("拆分来源可读对照不改快照，不根据新父任务猜来源，新增评论不算历史变动", () => {
  const parent = { ...input, id: "p", descriptionFiles: [], criteriaFiles: [], comments: [{ id: "c", content: "原评论", files: [] }] };
  const child = childFromComment(parent, "c"); const captured = child.sourceSnapshot;
  assert.equal(JSON.parse(captured).sourceTaskId, "p"); assert.deepEqual(sourceContext(child, [parent]).changes, []);
  const changed = { ...parent, title: "新标题", description: "新需求", comments: [{ ...parent.comments[0], content: "修改评论" }, { id: "new", content: "新评论" }] };
  assert.deepEqual(sourceContext({ ...child, parentId: "other" }, [changed]).changes, ["标题", "需求", "评论有更新：原评论"]);
  assert.equal(child.sourceSnapshot, captured);
  const old = JSON.parse(captured); delete old.sourceTaskId;
  assert.equal(sourceContext({ sourceSnapshot: JSON.stringify(old), parentId: "p" }, [parent]).source, null);
  assert.equal(sourceContext({ sourceSnapshot: "不是 JSON" }, []), null);
  assert.equal(sourceContext({ sourceSnapshot: JSON.stringify({ title: "缺字段" }) }, []), null);
  assert.equal(sourceContext(child, []).source, null);
});


test("历史重试使用指定轮次输入和配置，新会话保留旧记录与当前任务配置", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save({ ...input, project: "项目" });
  await env.board.saveProject("/repo", "项目", "原项目约束"); await env.board.start(id); env.emit({ kind: "error", error: "临时错误" }); await tick();
  const oldRun = structuredClone(env.board.getSnapshot().tasks[0].runs[0]);
  await env.board.save({ ...input, model: "", description: "后续新需求", project: "项目" }, id); await env.board.saveProject("/repo", "项目", "新约束");
  await env.board.start(id, null, oldRun.id);
  assert.equal(env.calls.starts[1].prompt, oldRun.input.prompt); assert.equal(env.calls.starts[1].model, "model-a"); assert.equal(env.calls.starts[1].sessionId, undefined);
  const current = env.board.getSnapshot().tasks[0]; assert.equal(current.model, ""); assert.equal(current.description, "后续新需求"); assert.deepEqual(current.runs[0], oldRun);
  assert.equal(current.runs[1].retryOf, oldRun.id); assert.equal(current.runs[1].model, "model-a"); assert.equal(current.runs[1].input.projectDescription, "原项目约束");
  env.emit({ kind: "done" }); await tick(); assert.equal(env.board.getSnapshot().tasks[0].status, "review");
  const restored = setup({ file: env.file() }); await restored.board.ready; assert.equal(restored.board.getSnapshot().tasks[0].runs[1].retryOf, oldRun.id);
  env.board.dispose(); restored.board.dispose();
});

test("历史重试保存失败或模型失效不启动，无快照/成功轮次不能重试", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input); await env.board.start(id); env.emit({ kind: "error", error: "失败" }); await tick();
  const oldRun = env.board.getSnapshot().tasks[0].runs[0];
  env.options.failWrite = true; await assert.rejects(env.board.start(id, null, oldRun.id), /磁盘/); assert.equal(env.calls.starts.length, 1); assert.equal(env.board.getSnapshot().tasks[0].runs.length, 1); env.options.failWrite = false;
  const catalog = env.ctx.models.catalog; env.ctx.models.catalog = async () => ({ engines: [], errors: [] }); await assert.rejects(env.board.start(id, null, oldRun.id), /模型/); assert.equal(env.calls.starts.length, 1); env.ctx.models.catalog = catalog;
  await assert.rejects(env.board.start(id, null, "missing"), /失败或中断/);
  const doc = JSON.parse(env.file()); delete doc.tasks[0].runs[0].input;
  const missing = setup({ file: JSON.stringify(doc) }); await missing.board.ready; await assert.rejects(missing.board.start(id, null, oldRun.id), /输入快照/); assert.equal(missing.calls.starts.length, 0);
  await env.board.start(id, null, oldRun.id); env.emit({ kind: "done" }); await tick(); const success = env.board.getSnapshot().tasks[0].runs[1]; await assert.rejects(env.board.start(id, null, success.id), /失败或中断/);
  env.board.dispose(); missing.board.dispose();
});

test("历史重试不把后加反馈标记为已执行，仍需当前反馈验收", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input); await env.board.start(id); await env.board.stop(id); env.emit({ kind: "done" }); await tick();
  const run = env.board.getSnapshot().tasks[0].runs[0]; assert.equal(run.outcome, "stopped");
  await env.board.addFeedback(id, "后来新增反馈", run.id); await env.board.start(id, null, run.id); env.emit({ kind: "done" }); await tick();
  assert.deepEqual(env.board.getSnapshot().tasks[0].runs[1].feedbackIds, []);
  await assert.rejects(env.board.setStatus(id, "done"), /修正意见尚未执行/); env.board.dispose();
});


test("选区引用保留文字快照，原文更新不改引用，引用中的提及不触发", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save({ ...input, description: "@Agent 原文指令" });
  await env.board.addComment(id, { content: "只讨论偏差", quoteSnapshot: { kind: "description", sourceId: id, text: "@Agent 原文" } });
  assert.equal(env.calls.starts.length, 0);
  const quote = structuredClone(env.board.getSnapshot().tasks[0].comments[0].quote);
  await env.board.save({ ...input, description: "原文已变更" }, id);
  const restored = setup({ file: env.file() }); await restored.board.ready;
  assert.deepEqual(restored.board.getSnapshot().tasks[0].comments[0].quote, quote);
  env.options.failWrite = true; await assert.rejects(env.board.addComment(id, { content: "失败意见", quoteSnapshot: { kind: "criteria", sourceId: id, text: "历史验收选区" } }), /磁盘/); assert.equal(env.board.getSnapshot().tasks[0].comments.length, 1); env.options.failWrite = false;
  await env.board.addComment(id, { content: "@Agent 请按这条偏差修正", quoteSnapshot: quote });
  assert.equal(env.calls.starts.length, 1); assert.match(env.calls.starts[0].prompt, /引用原文（仅作背景）："@Agent 原文"/); assert.match(env.calls.starts[0].prompt, /本轮重点评论/);
  env.board.dispose(); restored.board.dispose();
});

test("选区引用拒绝非法来源、空白、超长和未知类型，损坏引用不覆盖文档", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  for (const quoteSnapshot of [{ kind: "description", sourceId: "other", text: "文字" }, { kind: "comment", sourceId: "missing", text: "文字" }, { kind: "description", sourceId: id, text: " " }, { kind: "criteria", sourceId: id, text: "a".repeat(4001) }, { kind: "unknown", sourceId: id, text: "文字" }]) await assert.rejects(env.board.addComment(id, { content: "意见", quoteSnapshot }), /引用/);
  assert.equal(env.board.getSnapshot().tasks[0].comments.length, 0);
  await env.board.addComment(id, { content: "意见", quoteSnapshot: { kind: "criteria", sourceId: id, text: "验收片段" } });
  const doc = JSON.parse(env.file()); doc.tasks[0].comments[0].quote.kind = "unknown";
  const bad = setup({ file: JSON.stringify(doc) }); await bad.board.ready; assert.equal(bad.board.getSnapshot().ready, false); assert.match(bad.board.getSnapshot().error, /引用/); assert.equal(bad.calls.writes, 0);
  env.board.dispose(); bad.board.dispose();
});


test("交付物批量登记原子写入、来源校验、失败回滚、重载和移除不触发执行", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  const file = { name: "成果.txt", path: "/repo/result.txt", grantId: "g" };
  const comment = await env.board.addComment(id, { content: "/note 成果", files: [file] });
  const commentId = env.board.getSnapshot().tasks[0].comments[0].id;
  await assert.rejects(env.board.addDeliverables(id, [{ file, commentId: "missing" }]), /来源评论/);
  await assert.rejects(env.board.addDeliverables(id, [{ file, runId: "missing" }]), /关联运行/);
  const before = env.file(); env.options.failWrite = true;
  await assert.rejects(env.board.addDeliverables(id, [{ file, commentId }, { file: { ...file, path: "/other/result.txt" } }]), /磁盘/);
  assert.equal(env.file(), before); assert.equal(env.board.getSnapshot().tasks[0].deliverables, undefined);
  env.options.failWrite = false; const writes = env.calls.writes;
  await env.board.addDeliverables(id, [{ file, commentId }, { file: { ...file, path: "/other/result.txt" } }]);
  assert.equal(env.calls.writes, writes + 1); await env.board.reload();
  assert.equal(env.board.getSnapshot().tasks[0].deliverables.length, 2);
  assert.equal(env.board.getSnapshot().tasks[0].deliverables[0].commentId, commentId);
  await env.board.removeDeliverable(id, env.board.getSnapshot().tasks[0].deliverables[0].id);
  assert.equal(env.board.getSnapshot().tasks[0].deliverables.length, 1); assert.equal(env.calls.starts.length, 0);
});

test("时间线按发生时间和同刻事件顺序组织，不补造旧运行结束时间", () => {
  const at = "2026-10-29T01:00:00.000Z";
  const task = { createdAt: at, comments: [{ id: "c", createdAt: at }], feedbacks: [{ id: "f", createdAt: at, afterRunId: "r" }], deliverables: [{ id: "d", createdAt: at, file: { name: "成果" } }], runs: [{ id: "r", startedAt: at, endedAt: at, outcome: "ended", reviewDecision: "accepted", reviewedAt: at }, { id: "old", startedAt: at, outcome: "unknown" }] };
  const before = JSON.stringify(task); const events = taskHistory(task);
  assert.equal(events[0].id, "created"); assert.ok(events.findIndex((entry) => entry.id === "start:r") < events.findIndex((entry) => entry.id === "end:r"));
  assert.equal(events.filter((entry) => entry.id === "end:old").length, 0); assert.equal(events.filter((entry) => entry.label === "验收不通过").length, 1);
  assert.equal(events.find((entry) => entry.id === "feedback:f").runId, "r"); assert.equal(JSON.stringify(task), before); assert.deepEqual(taskHistory(task), events);
});

test("项目资源按工作区隔离，每轮清单快照不随资源修改变化，非法资源和失败保存不覆盖", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save({ ...input, project: "项目" });
  const resources = { links: ["https://example.com/spec"], files: [{ name: "接口.md", path: "/repo/api.md", grantId: "g" }] };
  await env.board.saveProject("/other", "项目", "其他说明", { links: ["https://other.example.com"], files: [] });
  await env.board.saveProject("/repo", "项目", "当前说明", resources);
  const before = env.file(); await assert.rejects(env.board.saveProject("/repo", "项目", "", { links: ["javascript:alert(1)"], files: [] }), /HTTP/); assert.equal(env.file(), before);
  env.options.failWrite = true; await assert.rejects(env.board.saveProject("/repo", "项目", "", { links: [], files: [] }), /磁盘/); assert.equal(env.file(), before); env.options.failWrite = false;
  await env.board.start(id); assert.match(env.calls.starts[0].prompt, /https:\/\/example.com\/spec/); assert.doesNotMatch(env.calls.starts[0].prompt, /other.example/);
  const old = structuredClone(env.board.getSnapshot().tasks[0].runs[0].input); assert.deepEqual(old.projectResources, resources);
  env.emit({ kind: "done" }); await tick(); await env.board.saveProject("/repo", "项目", "新说明", { links: [], files: [] });
  assert.deepEqual(env.board.getSnapshot().tasks[0].runs[0].input, old); await env.board.reload(); assert.deepEqual(env.board.getSnapshot().tasks[0].runs[0].input, old);
  await env.board.start(id); assert.doesNotMatch(env.calls.starts[1].prompt, /example.com/);
});

test("编辑对照读取最新文档后保持就绪，基线冲突被拒绝，只应用编辑字段并保留新评论", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input); const baseline = env.board.getSnapshot().tasks[0];
  await env.board.editFields(id, { title: "另一编辑器标题" });
  await assert.rejects(env.board.save({ ...baseline, title: "本地标题" }, id, baseline), /编辑冲突/);
  await env.board.addComment(id, { content: "/note 新评论" });
  const latest = await env.board.refreshForEdit(id); assert.equal(env.board.getSnapshot().ready, true); assert.equal(latest.title, "另一编辑器标题");
  await env.board.save({ ...baseline, title: "本地标题" }, id, latest);
  assert.equal(env.board.getSnapshot().tasks[0].title, "本地标题"); assert.equal(env.board.getSnapshot().tasks[0].comments.length, 1);
  env.conflict(); await assert.rejects(env.board.save({ ...latest, title: "第二次输入" }, id, env.board.getSnapshot().tasks[0]), /版本冲突/);
  assert.equal(env.board.getSnapshot().tasks[0].title, "本地标题");
});

test("手动交接隔离模型配置和输入，保存失败不启动，审查需前序结果，结束仍待验收", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  const config = { step: "implement", engine: "codex", model: "", providerId: "", instruction: "先实现并验证" };
  await assert.rejects(env.board.start(id, null, null, { ...config, step: "review" }), /先完成/);
  env.options.failWrite = true; await assert.rejects(env.board.start(id, null, null, config), /磁盘/); assert.equal(env.calls.starts.length, 0); env.options.failWrite = false;
  await env.board.start(id, null, null, config); let task = env.board.getSnapshot().tasks[0];
  assert.equal(task.model, "model-a"); assert.equal(task.runs[0].model, ""); assert.equal(task.runs[0].step, "implement"); assert.deepEqual(task.stepConfigs.implement, config);
  assert.match(env.calls.starts[0].prompt, /本轮处理步骤：实现/); assert.equal(task.runs[0].input.prompt, env.calls.starts[0].prompt);
  await assert.rejects(env.board.start(id, null, null, config), /已有看板/);
  env.emit({ kind: "done" }); await tick(); assert.equal(env.board.getSnapshot().tasks[0].status, "review");
  const review = { ...config, step: "review", model: "model-a", instruction: "独立核对成果" };
  await env.board.start(id, null, null, review); task = env.board.getSnapshot().tasks[0];
  assert.equal(task.runs[1].previousRunId, task.runs[0].id); assert.equal(task.runs[1].step, "review"); assert.equal(env.calls.starts[1].sessionId, undefined);
  assert.match(env.calls.starts[1].prompt, /独立核对成果/); env.emit({ kind: "done" }); await tick();
  assert.equal(env.board.getSnapshot().tasks[0].status, "review"); await env.board.reload(); assert.equal(env.board.getSnapshot().tasks[0].stepConfigs.review.instruction, "独立核对成果");
});

test("损坏的新功能记录拒绝载入并保留原文件", async () => {
  const seed = setup(); await seed.board.ready; await seed.board.save(input);
  for (const patch of [{ deliverables: [{}] }, { stepConfigs: { review: { step: "implement" } } }]) {
    const data = JSON.parse(seed.file()); Object.assign(data.tasks[0], patch); const file = JSON.stringify(data); const env = setup({ file }); await env.board.ready;
    assert.equal(env.board.getSnapshot().ready, false); assert.equal(env.file(), file); assert.equal(env.calls.writes, 0);
  }
});


test("审查来源与成果快照保留，审查拒绝后的具体反馈复用返工机制", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  await env.board.start(id); env.emit({ kind: "done" }); await tick();
  await env.board.addDeliverables(id, [{ file: { name: "报告.md", path: "/repo/report.md", grantId: "g" } }]);
  const previous = env.board.getSnapshot().tasks[0].runs.at(-1).id;
  await env.board.start(id, null, null, { step: "review", engine: "codex", model: "", providerId: "", instruction: "核对金额列" });
  let task = env.board.getSnapshot().tasks[0]; const review = task.runs.at(-1);
  assert.equal(review.previousRunId, previous); assert.equal(review.sourceDeliverables[0].file.path, "/repo/report.md");
  assert.equal(taskHistory(task).find((entry) => entry.id === `start:${review.id}`).previousRunId, previous);
  env.emit({ kind: "done" }); await tick(); await env.board.removeDeliverable(id, task.deliverables[0].id);
  await env.board.addFeedback(id, "金额列缺失，请补齐并验证", review.id); await env.board.start(id);
  assert.match(env.calls.starts.at(-1).prompt, /金额列缺失，请补齐并验证/);
  task = env.board.getSnapshot().tasks[0]; assert.equal(task.runs.find((entry) => entry.id === review.id).sourceDeliverables.length, 1); assert.equal(task.runs.find((entry) => entry.id === review.id).reviewDecision, "rejected");
  env.emit({ kind: "done" }); await tick(); assert.equal(env.board.getSnapshot().tasks[0].status, "review");
});


test("审查历史输入重试保留原前序运行与成果快照，不取当前登记", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  await env.board.start(id); env.emit({ kind: "done" }); await tick();
  await env.board.addDeliverables(id, [{ file: { name: "旧成果.md", path: "/repo/old.md", grantId: "g" } }]);
  await env.board.start(id, null, null, { step: "review", engine: "codex", model: "", providerId: "", instruction: "审查旧成果" });
  env.emit({ kind: "error", error: "模拟失败" }); await tick();
  const review = env.board.getSnapshot().tasks[0].runs.at(-1);
  await env.board.removeDeliverable(id, review.sourceDeliverables[0].id);
  await env.board.start(id, null, review.id); const retry = env.board.getSnapshot().tasks[0].runs.at(-1);
  assert.deepEqual(retry.sourceDeliverables, review.sourceDeliverables); assert.equal(retry.previousRunId, review.previousRunId); assert.equal(retry.step, "review"); assert.equal(retry.input.prompt, review.input.prompt);
  env.emit({ kind: "done" }); await tick(); await env.board.reload(); assert.deepEqual(env.board.getSnapshot().tasks[0].runs.at(-1).sourceDeliverables, review.sourceDeliverables);
});


test("Agent 指派手动执行、配置隔离与历史快照，归档和工作区门禁", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input);
  const config = { name: "实现同事", instruction: "逐条验证", engine: "codex", model: "", providerId: "", workspacePath: "/repo" };
  const agentId = await env.board.saveAgent(config); await env.board.assignAgent(id, agentId); assert.equal(env.calls.starts.length, 0);
  await env.board.start(id); let task = env.board.getSnapshot().tasks[0]; assert.equal(task.model, "model-a"); assert.equal(task.runs[0].model, ""); assert.equal(task.runs[0].agentSnapshot.id, agentId); assert.match(env.calls.starts[0].prompt, /实现同事/);
  env.emit({ kind: "done" }); await tick(); await env.board.saveAgent({ ...config, name: "新名称", instruction: "新说明", archived: true }, agentId);
  assert.equal(env.board.getSnapshot().tasks[0].runs[0].agentSnapshot.name, "实现同事"); await assert.rejects(env.board.start(id), /归档/);
  await env.board.saveAgent({ ...config, workspacePath: "/other" }, agentId); await assert.rejects(env.board.start(id), /工作区/);
  await env.board.reload(); assert.equal(env.board.getSnapshot().agents[0].id, agentId); await env.board.assignAgent(id, null); assert.equal(env.board.getSnapshot().tasks[0].assigneeId, null);
});

test("Agent 保存失败保持原数据，损坏身份记录拒绝载入", async () => {
  const env = setup(); await env.board.ready; env.options.failWrite = true;
  await assert.rejects(env.board.saveAgent({ name: "审查", instruction: "审查", engine: "codex" }), /磁盘/); assert.equal(env.board.getSnapshot().agents.length, 0);
  const bad = setup({ file: JSON.stringify({ schemaVersion: 1, tasks: [], agents: [{ id: "a", name: "" }] }) }); await bad.board.ready; assert.equal(bad.board.getSnapshot().ready, false); assert.equal(bad.calls.writes, 0);
});


const collaborator = (name) => ({ name, instruction: `${name}负责验证`, engine: "codex", model: "", providerId: "", workspacePath: "/repo" });

test("定向提及按稳定ID路由，不改变负责人；改名后回复仍沿原Agent，归档目标拒绝", async () => {
  const env = setup(); await env.board.ready; const taskId = await env.board.save(input);
  const ownerId = await env.board.saveAgent(collaborator("负责人")), targetId = await env.board.saveAgent(collaborator("同名"));
  await env.board.assignAgent(taskId, ownerId);
  await env.board.addComment(taskId, { content: "请核对金额", targetAgentId: targetId });
  let task = env.board.getSnapshot().tasks[0]; assert.equal(task.assigneeId, ownerId); assert.equal(task.runs.at(-1).agentSnapshot.id, targetId); const runId = task.runs.at(-1).id;
  env.emit({ kind: "done" }); await tick(); await env.board.saveAgent(collaborator("改名同事"), targetId);
  await env.board.addComment(taskId, { content: "请继续核对", replyTo: `run:${runId}` }); task = env.board.getSnapshot().tasks[0]; assert.equal(task.runs.at(-1).agentSnapshot.id, targetId); assert.match(env.calls.starts.at(-1).prompt, /改名同事/);
  env.emit({ kind: "done" }); await tick(); const count = env.calls.starts.length;
  await env.board.addComment(taskId, { content: "/note 不启动", targetAgentId: targetId }); assert.equal(env.calls.starts.length, count);
  await env.board.saveAgent({ ...collaborator("归档"), archived: true }, targetId); const before = env.file();
  await assert.rejects(env.board.addComment(taskId, { content: "继续", targetAgentId: targetId }), /归档/); assert.equal(env.file(), before);
  await assert.rejects(env.board.addComment(taskId, { content: "继续", targetAgentId: "missing" }), /不存在/);
});

test("共享方法绑定多个Agent，修改和停用只影响后续运行，快照与历史重试独立", async () => {
  const env = setup(); await env.board.ready; const taskId = await env.board.save(input);
  const methodId = await env.board.saveMethod({ name: "金额检查", content: "核对金额字段" });
  const agentId = await env.board.saveAgent({ ...collaborator("检查员"), methodIds: [methodId] });
  const second = await env.board.saveAgent({ ...collaborator("第二位"), methodIds: [methodId] });
  await env.board.assignAgent(taskId, agentId); await env.board.start(taskId);
  const first = structuredClone(env.board.getSnapshot().tasks[0].runs.at(-1)); assert.match(first.input.prompt, /核对金额字段/); assert.equal(first.methodSnapshots[0].id, methodId);
  env.emit({ kind: "error", error: "模拟错误" }); await tick(); await env.board.saveMethod({ name: "新金额检查", content: "新步骤", archived: true }, methodId);
  await env.board.start(taskId, null, first.id); assert.equal(env.board.getSnapshot().tasks[0].runs.at(-1).methodSnapshots[0].content, "核对金额字段");
  env.emit({ kind: "done" }); await tick(); await env.board.assignAgent(taskId, second); await env.board.start(taskId); assert.equal(env.board.getSnapshot().tasks[0].runs.at(-1).methodSnapshots.length, 0);
  assert.doesNotMatch(env.calls.starts.at(-1).prompt, /核对金额字段/); env.emit({ kind: "done" }); await tick(); await env.board.reload(); assert.equal(env.board.getSnapshot().methods[0].archived, true);
});

test("小队队长建议与人工派活串行闭环，来源受控且重复确认不二次启动", async () => {
  const env = setup(); await env.board.ready; const taskId = await env.board.save(input);
  const leaderId = await env.board.saveAgent(collaborator("队长")), memberId = await env.board.saveAgent(collaborator("成员"));
  const squadId = await env.board.saveSquad({ name: "交付小队", leaderId, memberIds: [leaderId, memberId], instruction: "先验证再交付" });
  await env.board.startSquadLeader(taskId, squadId); assert.equal(env.calls.starts.length, 1); assert.match(env.calls.starts[0].prompt, /只提出派活建议/);
  const leaderRunId = env.board.getSnapshot().tasks[0].runs.at(-1).id;
  await assert.rejects(env.board.saveProposal(taskId, squadId, leaderRunId, memberId, "实现"), /先完成/);
  env.emit({ kind: "done" }); await tick(); const count = env.calls.starts.length;
  await assert.rejects(env.board.saveProposal(taskId, squadId, leaderRunId, "outsider", "实现"), /有效成员/);
  const proposalId = await env.board.saveProposal(taskId, squadId, leaderRunId, memberId, "补齐金额列并验证"); assert.equal(env.calls.starts.length, count);
  env.options.failWrite = true; await assert.rejects(env.board.dispatchProposal(taskId, proposalId), /磁盘/); assert.equal(env.board.getSnapshot().tasks[0].proposals[0].status, "pending"); env.options.failWrite = false;
  await env.board.dispatchProposal(taskId, proposalId); await assert.rejects(env.board.dispatchProposal(taskId, proposalId), /已执行|已有/);
  const task = env.board.getSnapshot().tasks[0]; assert.equal(task.assigneeId, undefined); assert.equal(task.runs.at(-1).agentSnapshot.id, memberId); assert.equal(task.runs.at(-1).coordination.leaderRunId, leaderRunId); assert.match(env.calls.starts.at(-1).prompt, /补齐金额列并验证/);
  env.emit({ kind: "done" }); await tick(); assert.equal(env.board.getSnapshot().tasks[0].status, "review"); await env.board.reload(); assert.equal(env.board.getSnapshot().squads[0].id, squadId);
});

test("宿主日志过滤其他运行、去重、未知状态保留、重载和订阅清理", async () => {
  const env = setup(); let hooks; let cleaned = false;
  env.board.dispose(); env.ctx.hooks = { registerTurnHooks: (value) => { hooks = value; return () => { cleaned = true; }; } };
  const board = createBoard(env.ctx); await board.ready; const taskId = await board.save(input); await board.start(taskId);
  const event = { eventId: "e1", runId: "r1", turnId: "t1", engine: "codex", workspacePath: "/repo", occurredAt: "2026-10-29T01:00:00Z", kind: "command-finished", command: "echo test", cwd: "/repo", status: "unknown", exitCode: null };
  hooks.onRuntimeEvent({ ...event, runId: "foreign" }); hooks.onRuntimeEvent({ ...event, workspacePath: "/other" }); hooks.onRuntimeEvent(event); hooks.onRuntimeEvent(event); await tick(); await tick();
  const run = board.getSnapshot().tasks[0].runs.at(-1); assert.equal(run.runtimeEvents.length, 1); assert.equal(run.runtimeEvents[0].status, "unknown"); assert.equal(run.logCapability, "observing");
  env.emit({ kind: "done" }); await tick(); await board.reload(); assert.equal(board.getSnapshot().tasks[0].runs.at(-1).runtimeEvents.length, 1); board.dispose(); assert.equal(cleaned, true);
});


test("队长历史重试保留小队来源，未知显式提及不继承历史身份，损坏提案不载入", async () => {
  const env = setup(); await env.board.ready; const id = await env.board.save(input); const leaderId = await env.board.saveAgent(collaborator("队长"));
  const squadId = await env.board.saveSquad({ name: "小队", leaderId, memberIds: [leaderId], instruction: "协调" });
  await env.board.startSquadLeader(id, squadId); const old = env.board.getSnapshot().tasks[0].runs.at(-1); env.emit({ kind: "error", error: "故障" }); await tick();
  await env.board.start(id, null, old.id); env.emit({ kind: "done" }); await tick(); const task = env.board.getSnapshot().tasks[0]; assert.equal(task.runs.at(-1).coordination.kind, "leader");
  await env.board.saveProposal(id, squadId, task.runs.at(-1).id, leaderId, "下一步");
  assert.equal(commentAgentId(task, "@someone 请看", `run:${old.id}`), null);
  const data = JSON.parse(env.file()); data.tasks[0].proposals = {}; const bad = setup({ file: JSON.stringify(data) }); await bad.board.ready; assert.equal(bad.board.getSnapshot().ready, false); assert.equal(bad.calls.writes, 0);
});


test("日志采集早于启动返回仍关联本插件运行，保存失败可见且未知退出码不伪造", async () => {
  const env = setup(); env.board.dispose(); let hooks;
  env.ctx.hooks = { registerTurnHooks: (value) => { hooks = value; return () => {}; } };
  env.ctx.sessions.startRun = async () => {
    hooks.onRuntimeEvent({ eventId: "early", runId: "early-run", engine: "codex", workspacePath: "/repo", kind: "command-finished", occurredAt: "2026-10-29T00:00:00Z", command: "false", status: "unknown", exitCode: null });
    return { runId: "early-run", sessionId: "s" };
  };
  const board = createBoard(env.ctx); await board.ready; const id = await board.save(input); await board.start(id); await tick();
  assert.equal(board.getSnapshot().tasks[0].runs[0].runtimeEvents[0].exitCode, null);
  env.options.failWrite = true; hooks.onRuntimeEvent({ eventId: "failure", runId: "early-run", engine: "codex", workspacePath: "/repo", kind: "tool-finished", occurredAt: "2026-10-29T00:00:01Z", toolName: "shell", status: "failed" }); await tick(); assert.match(board.getSnapshot().error, /磁盘/); assert.equal(board.getSnapshot().tasks[0].runs[0].runtimeEvents.length, 1); board.dispose();
});


test("Agent 头像分别保存，旧成员默认头像，修改不改历史快照且非法头像不落盘", async () => {
  const env = setup(); await env.board.ready; const taskId = await env.board.save(input);
  const first = await env.board.saveAgent({ ...collaborator("狐狸成员"), avatar: "fox" });
  const second = await env.board.saveAgent(collaborator("旧成员"));
  assert.equal(env.board.getSnapshot().agents.find((agent) => agent.id === second).avatar, "robot");
  await env.board.assignAgent(taskId, first); await env.board.start(taskId);
  assert.equal(env.board.getSnapshot().tasks[0].runs[0].agentSnapshot.avatar, "fox");
  env.emit({ kind: "done" }); await tick();
  await env.board.saveAgent({ ...collaborator("狐狸成员"), avatar: "owl" }, first);
  await env.board.reload();
  assert.equal(env.board.getSnapshot().agents.find((agent) => agent.id === first).avatar, "owl");
  assert.equal(env.board.getSnapshot().tasks[0].runs[0].agentSnapshot.avatar, "fox");
  const before = env.file();
  for (const avatar of ["https://example.com/avatar.png", "__proto__", ["fox"], 2]) await assert.rejects(env.board.saveAgent({ ...collaborator("非法"), avatar }), /头像/);
  assert.equal(env.file(), before);
});
