const STATUSES = { todo: "待办", running: "执行中", review: "待验收", blocked: "受阻", done: "已完成", cancelled: "已取消" };
const PRIORITIES = { high: "高", medium: "中", low: "低" };
const OUTCOMES = { running: "执行中", ended: "执行结束", error: "执行出错", stopped: "已请求停止，执行已结束", unknown: "运行状态待核对" };
const FILE = "tasks.json";
const AGENT_AVATARS = { robot: ["🤖", "机器人"], fox: ["🦊", "狐狸"], cat: ["🐱", "猫咪"], owl: ["🦉", "猫头鹰"], panda: ["🐼", "熊猫"], penguin: ["🐧", "企鹅"], lion: ["🦁", "狮子"], rabbit: ["🐰", "兔子"], rocket: ["🚀", "火箭"], star: ["⭐", "星星"], bulb: ["💡", "灯泡"], compass: ["🧭", "指南针"] };
const avatarSymbol = (agent) => (AGENT_AVATARS[agent?.avatar] || AGENT_AVATARS.robot)[0];
const message = (error) => error instanceof Error ? error.message : String(error);
const timestamp = () => new Date().toISOString();
const uid = () => globalThis.crypto.randomUUID();

const LAYOUTS = { board: "看板", list: "列表", gantt: "甘特", swimlane: "泳道" };
const FOCUSES = { all: "全部", revision: "待修正", overdue: "已逾期" };
const CARD_FIELDS = { priority: "优先级", updated: "更新时间", workspace: "工作区", project: "项目", tags: "标签", dueDate: "截止日期", parent: "父任务", model: "模型", requirements: "需求与验收" };
const LIST_FIELDS = { priority: "优先级", project: "项目", dueDate: "截止日期", workspace: "工作区" };
const CARD_DEFAULTS = { priority: true, updated: false, workspace: false, project: true, tags: false, dueDate: true, parent: true, model: false, requirements: false };
const SORTS = { priority: "优先级", updated: "最近更新", created: "创建时间", due: "截止日期" };
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const isOverdue = (task, today = localDate()) => Boolean(task.dueDate && task.dueDate < today && !["done", "cancelled"].includes(task.status));
export function selectTasks(tasks, { workspace = "", search = "", focus = "all", sort = "priority", project = "" } = {}) {
  return tasks.filter((task) => (!workspace || task.workspacePath === workspace) && (!project || task.project === project) &&
    `${task.title}\n${task.description}\n${task.criteria}\n${(task.tags || []).join(" ")}\n${task.project || ""}`.toLowerCase().includes(search.trim().toLowerCase()) &&
    (focus === "revision" ? (Boolean(task.pendingFeedbackIds?.length) || task.comments?.some((entry) => entry.triggerAgent && !entry.resolvedAt)) && ["todo", "blocked"].includes(task.status) : focus === "overdue" ? isOverdue(task) : true))
    .sort((a, b) => (sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : sort === "created" ? (b.createdAt || "").localeCompare(a.createdAt || "") : sort === "due" ? (a.dueDate || "9999").localeCompare(b.dueDate || "9999") : Object.keys(PRIORITIES).indexOf(a.priority) - Object.keys(PRIORITIES).indexOf(b.priority)) || b.updatedAt.localeCompare(a.updatedAt));
}
const viewFields = (value) => ({ openMode: value?.openMode === "preview" ? "preview" : "details", listFields: Object.fromEntries(Object.keys(LIST_FIELDS).map((key) => [key, value?.listFields?.[key] !== false])), layout: ["list", "gantt", "swimlane"].includes(value?.layout) ? value.layout : "board", cardFields: Object.fromEntries(Object.keys(CARD_FIELDS).map((key) => [key, typeof value?.cardFields?.[key] === "boolean" ? value.cardFields[key] : CARD_DEFAULTS[key]])), collapsedLanes: Array.isArray(value?.collapsedLanes) ? value.collapsedLanes.filter((key) => typeof key === "string") : [], project: typeof value?.project === "string" ? value.project : "", workspace: typeof value?.workspace === "string" ? value.workspace : "", search: typeof value?.search === "string" ? value.search : "", focus: Object.hasOwn(FOCUSES, value?.focus) ? value.focus : "all", sort: Object.hasOwn(SORTS, value?.sort) ? value.sort : "priority", collapsed: Array.isArray(value?.collapsed) ? value.collapsed.filter((key) => Object.hasOwn(STATUSES, key)) : [] });

export function selectTaskRange(tasks, selected, anchorId, targetId, checked) {
  const target = tasks.findIndex((task) => task.id === targetId);
  const anchor = tasks.findIndex((task) => task.id === anchorId);
  const range = target < 0 ? [] : tasks.slice(anchor < 0 ? target : Math.min(anchor, target), anchor < 0 ? target + 1 : Math.max(anchor, target) + 1).filter((task) => task.status !== "running" && !task.recovery).map((task) => task.id);
  return checked ? [...new Set([...selected, ...range])] : selected.filter((id) => !range.includes(id));
}

export function sourceContext(task, tasks) {
  let snapshot;
  try { snapshot = JSON.parse(task.sourceSnapshot); } catch { return null; }
  if (!snapshot || typeof snapshot.title !== "string" || typeof snapshot.description !== "string" || typeof snapshot.criteria !== "string" || !Array.isArray(snapshot.comments) || snapshot.comments.some((entry) => !entry || typeof entry.id !== "string" || typeof entry.content !== "string")) return null;
  const source = typeof snapshot.sourceTaskId === "string" ? (tasks.find((entry) => entry.id === snapshot.sourceTaskId) || null) : null;
  const changes = [];
  if (source) {
    for (const [key, label] of [["title", "标题"], ["description", "需求"], ["criteria", "验收标准"], ["descriptionFiles", "需求附件关联"], ["criteriaFiles", "验收附件关联"]]) {
      if (JSON.stringify(source[key] ?? (key.endsWith("Files") ? [] : "")) !== JSON.stringify(snapshot[key] ?? (key.endsWith("Files") ? [] : ""))) changes.push(label);
    }
    for (const comment of snapshot.comments) {
      const current = source.comments?.find((entry) => entry.id === comment.id);
      if (!current) changes.push(`评论已移除：${comment.content.slice(0, 40)}`);
      else if (current.content !== comment.content || JSON.stringify(current.files || []) !== JSON.stringify(comment.files || [])) changes.push(`评论有更新：${comment.content.slice(0, 40)}`);
    }
  }
  return { snapshot, source, changes };
}

export function taskSwimlanes(tasks, allTasks = tasks) {
  const byId = new Map(allTasks.map((task) => [task.id, task]));
  const groups = new Map();
  for (const task of tasks) {
    let root = task;
    while (root.parentId && byId.has(root.parentId)) root = byId.get(root.parentId);
    const family = root.id !== task.id || allTasks.some((entry) => entry.parentId === root.id);
    const id = family ? root.id : "ungrouped";
    if (!groups.has(id)) groups.set(id, { id, parent: family ? root : null, tasks: [] });
    groups.get(id).tasks.push(task);
  }
  return [...groups.values()];
}

const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export function taskTimeline(tasks) {
  const scheduled = tasks.filter((task) => validDate(task.startDate) || validDate(task.dueDate));
  const dates = scheduled.flatMap((task) => [task.startDate, task.dueDate].filter(validDate)).sort();
  if (!dates.length) return { start: null, end: null, rows: [], unscheduled: tasks };
  const start = dates[0], end = dates.at(-1);
  const day = (value) => Date.parse(`${value}T00:00:00Z`) / 86400000;
  const span = day(end) - day(start) + 1;
  return { start, end, rows: scheduled.map((task) => {
    const first = validDate(task.startDate) ? task.startDate : task.dueDate;
    const last = validDate(task.dueDate) ? task.dueDate : first;
    return { task, left: (day(first) - day(start)) / span * 100, width: Math.max(1, day(last) - day(first) + 1) / span * 100 };
  }), unscheduled: tasks.filter((task) => !scheduled.includes(task)) };
}

export function stageNotices(tasks) {
  return tasks.filter((parent) => !["done", "cancelled"].includes(parent.status)).flatMap((parent) => {
    const children = tasks.filter((task) => task.parentId === parent.id);
    const stages = [...new Set(children.map((task) => task.stage || 1))].sort((a, b) => a - b);
    const notices = [];
    for (let index = 0; index < stages.length; index++) {
      const stage = stages[index];
      const closed = children.filter((task) => (task.stage || 1) <= stage);
      if (closed.some((task) => !["done", "cancelled"].includes(task.status))) break;
      const cancelled = closed.filter((task) => task.status === "cancelled").length;
      const id = `stage:${JSON.stringify(closed.map((task) => [task.id, task.stage || 1, task.status]).sort((a, b) => a[0].localeCompare(b[0])))}`;
      notices.push({ id, taskId: parent.id, title: parent.title,
        summary: `${index === stages.length - 1 ? "全部子任务已结束" : `阶段 ${stage} 已结束，阶段 ${stages[index + 1]} 可开始`} · ${closed.length - cancelled} 项完成、${cancelled} 项取消`,
        createdAt: closed.map((task) => task.updatedAt).sort().at(-1), read: parent.noticeStates?.[id]?.read === true, archived: parent.noticeStates?.[id]?.archived === true });
    }
    return notices.slice(-1);
  });
}

export function taskNotices(tasks) {
  return [...stageNotices(tasks), ...tasks.flatMap((task) => task.runs.filter((run) => ["ended", "error", "stopped", "unknown"].includes(run.outcome)).map((run) => ({
    id: run.id, taskId: task.id, title: task.title, outcome: run.outcome,
    createdAt: run.endedAt || run.startedAt, read: task.noticeStates?.[run.id]?.read === true,
    archived: task.noticeStates?.[run.id]?.archived === true,
  })))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function taskMetrics(tasks) {
  const attempts = tasks.flatMap((task) => task.runs).filter((run) => ["ended", "error", "stopped"].includes(run.outcome));
  const ended = attempts.filter((run) => run.runId);
  const errors = ended.filter((run) => run.outcome === "error").length;
  const durations = ended.map((run) => Date.parse(run.endedAt) - Date.parse(run.startedAt)).filter((value) => Number.isFinite(value) && value >= 0);
  return { unstarted: attempts.length - ended.length, runs: ended.length, errors, errorRate: ended.length ? errors / ended.length : null, durationMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) : null, unmeasured: ended.length - durations.length };
}
export function taskAttachments(task) {
  const items = [];
  const add = (files, source, commentId = null) => { for (const file of files || []) {
    const type = /\.(png|jpe?g|gif|webp|svg|heic)$/i.test(file.name) ? "image" : /\.(mp4|mov|webm)$/i.test(file.name) ? "video" : /\.(md|txt|pdf|docx?|xlsx?|csv|pptx?|json)$/i.test(file.name) ? "document" : "other";
    items.push({ ...file, source, type, ...(commentId ? { commentId } : {}) });
  } };
  add(task.descriptionFiles, "需求"); add(task.criteriaFiles, "验收标准");
  for (const entry of task.comments || []) add(entry.files, `评论 ${new Date(entry.createdAt).toLocaleString("zh-CN")}`, entry.id);
  for (const entry of task.feedbacks || []) add(entry.files, `反馈 ${new Date(entry.createdAt).toLocaleString("zh-CN")}`);
  return items;
}
export function taskHistory(task) {
  const events = [{ id: "created", at: task.createdAt, label: "创建任务" }];
  for (const entry of task.comments || []) events.push({ id: `comment:${entry.id}`, at: entry.createdAt, label: "发表评论", commentId: entry.id });
  for (const entry of task.feedbacks || []) events.push({ id: `feedback:${entry.id}`, at: entry.createdAt, label: "验收不通过", feedbackId: entry.id, runId: entry.afterRunId });
  for (const run of task.runs) {
    events.push({ id: `start:${run.id}`, at: run.startedAt, label: `${run.step === "review" ? "审查 · " : run.step === "implement" ? "实现 · " : ""}${run.retryOf ? "历史输入重试" : run.resumeSessionId ? "原会话续接" : run.commentId ? "评论触发执行" : run.feedbackIds?.length ? "执行修正" : "开始执行"}`, runId: run.id, previousRunId: run.previousRunId });
    if (run.endedAt) events.push({ id: `end:${run.id}`, at: run.endedAt, label: OUTCOMES[run.outcome], runId: run.id });
    if (run.reviewDecision === "accepted" && run.reviewedAt) events.push({ id: `accepted:${run.id}`, at: run.reviewedAt, label: "人工验收通过", runId: run.id });
  }
  for (const entry of task.deliverables || []) events.push({ id: `deliverable:${entry.id}`, at: entry.createdAt, label: `登记交付物：${entry.file.name}`, deliverableId: entry.id, runId: entry.runId });
  const order = { created: 0, start: 1, end: 2, comment: 3, deliverable: 4, feedback: 5, accepted: 6 };
  return events.sort((a, b) => a.at.localeCompare(b.at) || order[a.id.split(":")[0]] - order[b.id.split(":")[0]] || a.id.localeCompare(b.id));
}

export function commentAgentId(task, content, replyTo, explicitId = null) {
  if (/^\s*\/note(?:\s|$)/i.test(content) || /@all\b/i.test(content)) return null;
  if (explicitId) return explicitId;
  if (/(^|\s)@(?!Agent(?=\s|[，。,:：！!?？]|$))\S+/i.test(content)) return null;
  const visited = new Set();
  while (replyTo && !visited.has(replyTo)) {
    visited.add(replyTo);
    const run = task.runs.find((run) => `run:${run.id}` === replyTo);
    if (run) return run.agentSnapshot?.id || null;
    const comment = (task.comments || []).find((entry) => entry.id === replyTo);
    if (!comment) return null;
    if (comment.targetAgentId) return comment.targetAgentId;
    replyTo = comment.replyTo;
  }
  return null;
}

function squadCoordination(state, squadId) {
  const squad = state.squads.find((entry) => entry.id === squadId);
  if (!squad) throw new Error("小队不存在。");
  const roster = squad.memberIds.map((id) => state.agents.find((agent) => agent.id === id)).filter((agent) => agent && !agent.archived);
  if (!roster.some((agent) => agent.id === squad.leaderId)) throw new Error("队长不可用。");
  return { kind: "leader", squadId, agentId: squad.leaderId, squadSnapshot: structuredClone(squad), prompt: `\n\n小队协调模式：只提出派活建议，不执行成员工作、不自动启动其他 Agent。结果交给用户确认。\n小队：${squad.name}\n规则：${squad.instruction}\n花名册：${JSON.stringify(roster.map(({ id, name, instruction }) => ({ id, name, instruction })))}\n请给出一个成员ID和具体工作说明，用户核对后手动登记提案。` };
}

function memberCoordination(proposal) {
  return { kind: "member", squadId: proposal.squadId, agentId: proposal.agentId, proposalId: proposal.id, leaderRunId: proposal.leaderRunId, prompt: `\n\n用户已核对队长建议并确认派活：\n${proposal.instruction}\n完成后等待人工验收，不自动派给其他成员。` };
}

function coordinationPreview(state, task, coordination) {
  const agent = state.agents.find((entry) => entry.id === coordination.agentId);
  if (!agent || agent.archived) throw new Error("执行 Agent 不可用。");
  const project = state.projects.find((entry) => entry.workspacePath === task.workspacePath && entry.name === task.project);
  const commentId = (task.comments || []).filter((entry) => entry.triggerAgent && !entry.resolvedAt).at(-1)?.id || null;
  const methods = state.methods.filter((entry) => !entry.archived && agent.methodIds?.includes(entry.id));
  return { config: `${agent.name} · ${agent.engine} · ${agent.model || "宿主默认模型"} · ${agent.providerId || "宿主默认渠道"} · ${task.workspacePath}`, prompt: buildPrompt(task, commentId, project?.description || "") + resourcePrompt(normalizeProjectResources(project?.resources)) + agentPrompt(agent) + methodContext(methods) + coordination.prompt };
}

function validateSquad(squad, agents) {
  if (!squad || typeof squad.id !== "string" || !squad.id || typeof squad.name !== "string" || !squad.name.trim() || typeof squad.instruction !== "string" || !Array.isArray(squad.memberIds) || new Set(squad.memberIds).size !== squad.memberIds.length || !squad.memberIds.includes(squad.leaderId) || squad.memberIds.some((id) => !agents.some((agent) => agent.id === id))) throw new Error("小队名称、队长或成员无效。");
}

function normalizeMethod(input) {
  if (!input || typeof input.name !== "string" || !input.name.trim() || typeof input.content !== "string" || !input.content.trim()) throw new Error("请填写方法名称与正文。");
  return { name: input.name.trim(), content: input.content.trim(), archived: input.archived === true };
}

function methodContext(methods) {
  return methods.length ? `\n\n共享方法（本轮内容快照）：\n${methods.map((method) => `## ${method.name}\n${method.content}`).join("\n\n")}` : "";
}

const agentPrompt = (agent) => agent ? `\n\n执行 Agent：${agent.name}\nAgent 指令：\n${agent.instruction}` : "";

function normalizeAgent(input) {
  const agent = Object.fromEntries(["name", "instruction", "engine", "model", "providerId", "workspacePath"].map((key) => [key, typeof input?.[key] === "string" ? input[key].trim() : ""]));
  if (!agent.name || !agent.instruction || !agent.engine) throw new Error("请填写 Agent 名称、执行指令和引擎。");
  if (input.methodIds != null && (!Array.isArray(input.methodIds) || input.methodIds.some((id) => typeof id !== "string") || new Set(input.methodIds).size !== input.methodIds.length)) throw new Error("方法绑定无效。");
  if (input.avatar != null && (typeof input.avatar !== "string" || !Object.hasOwn(AGENT_AVATARS, input.avatar))) throw new Error("请选择有效的 Agent 头像。");
  return { ...agent, avatar: input.avatar || "robot", methodIds: [...(input.methodIds || [])], archived: input.archived === true };
}

function normalizeStep(input) {
  if (!input || !["implement", "review"].includes(input.step) || typeof input.engine !== "string" || !input.engine || typeof input.model !== "string" || typeof input.providerId !== "string" || typeof input.instruction !== "string" || !input.instruction.trim()) throw new Error("请选择处理步骤、引擎并填写步骤说明。");
  return { step: input.step, engine: input.engine, model: input.model, providerId: input.providerId, instruction: input.instruction.trim() };
}

export function stepPrompt(task, config) {
  return `\n\n本轮处理步骤：${config.step === "review" ? "审查" : "实现"}\n${config.instruction}\n\n前序运行（完整结果请查看对应原生会话，不假定已读取）：\n${JSON.stringify(task.runs.map(({ id, sessionId, outcome, step }) => ({ id, sessionId, outcome, step })))}\n\n已登记交付物（本地路径当前内容）：${fileList((task.deliverables || []).map((entry) => entry.file))}\n本轮结束后等待人工验收，不自动完成任务或推进下一步。`;
}

function normalizeProjectResources(resources = { links: [], files: [] }) {
  if (!resources || !Array.isArray(resources.links) || resources.links.some((url) => typeof url !== "string" || !/^https?:\/\//i.test(url) || (() => { try { new URL(url); return false; } catch { return true; } })())) throw new Error("项目资源链接必须是有效的 HTTP 或 HTTPS 地址。");
  return { links: [...new Set(resources.links.map((url) => url.trim()))], files: normalizeFiles(resources.files) };
}

function resourcePrompt(resources) {
  return resources.links.length || resources.files.length ? `\n\n项目公共资源（请按需读取；此清单不证明内容已读取）：\n${resources.links.join("\n")}${fileList(resources.files)}` : "";
}

function validateDeliverables(entries = []) {
  if (!Array.isArray(entries) || new Set(entries.map((entry) => entry?.id)).size !== entries.length || entries.some((entry) => !entry || typeof entry.id !== "string" || !entry.id || typeof entry.createdAt !== "string" || (entry.commentId != null && typeof entry.commentId !== "string") || (entry.runId != null && typeof entry.runId !== "string"))) throw new Error("交付物记录无效，原文件已保留。");
  for (const entry of entries) normalizeFiles([entry.file]);
}

const activeStage = (tasks, parentId) => Math.min(...tasks.filter((task) => task.parentId === parentId && !["done", "cancelled"].includes(task.status)).map((task) => task.stage || 1));
const threadRoot = (task, commentId) => {
  let id = commentId; const visited = new Set();
  while (id && !visited.has(id)) { visited.add(id); const origin = task.runs.find((run) => `run:${run.id}` === id)?.commentId; if (origin) { id = origin; continue; } const replyTo = (task.comments || []).find((entry) => entry.id === id)?.replyTo; if (!replyTo) return id; id = replyTo; }
  return id;
};

export function childFromComment(task, commentId) {
  const index = (task.comments || []).findIndex((entry) => entry.id === commentId);
  if (index < 0) throw new Error("只能从已发布的个人评论创建子任务。");
  const entry = task.comments[index];
  return { ...validateTask(task), title: `跟进：${entry.content.slice(0, 70) || entry.files[0]?.name || task.title}`, description: entry.content, descriptionFiles: entry.files || [], parentId: task.id,
    sourceSnapshot: JSON.stringify({ sourceTaskId: task.id, title: task.title, description: task.description, criteria: task.criteria, descriptionFiles: task.descriptionFiles, criteriaFiles: task.criteriaFiles, comments: task.comments.slice(0, index + 1), capturedAt: timestamp() }, null, 2) };
}

export function revealTaskView(view, task) {
  const next = viewFields(view);
  if (next.workspace && next.workspace !== task.workspacePath) next.workspace = "";
  if (next.project && next.project !== (task.project || "")) next.project = "";
  if (!selectTasks([task], { ...next, focus: "all" }).length) next.search = "";
  if (!selectTasks([task], next).length) next.focus = "all";
  next.collapsedLanes = [];
  next.collapsed = next.collapsed.filter((status) => status !== task.status);
  return next;
}

export function createViewStore(ctx) {
  let state = { ...viewFields(null), savedViews: [], quickActions: [], drafts: {}, ready: false, error: "" };
  let tail = Promise.resolve();
  const listeners = new Set();
  const publish = (patch) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const store = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    update(patch) {
      const fields = { ...viewFields({ ...state, ...patch }),
        savedViews: (patch.savedViews ?? state.savedViews).map((entry) => ({ ...entry, view: viewFields(entry.view) })),
        drafts: patch.drafts ?? state.drafts };
      publish({ ...fields, error: "" });
      tail = tail.catch(() => {}).then(async () => {
        const next = { ...viewFields(state), savedViews: state.savedViews, drafts: state.drafts, quickActions: patch.quickActions ?? state.quickActions };
        await ctx.storage.set("board-view", next);
        publish({ ...(patch.quickActions ? { quickActions: patch.quickActions } : {}), error: "" });
        return true;
      }).catch((error) => { publish({ error: `视图保存失败：${message(error)}` }); return false; });
      return tail;
    },
    dispose() { listeners.clear(); },
  };
  store.ready = Promise.resolve().then(() => ctx.storage.get("board-view")).then((value) => {
    if (value) publish({ ...viewFields(value),
      savedViews: Array.isArray(value.savedViews) ? value.savedViews.filter((entry) => entry && typeof entry.id === "string" && typeof entry.name === "string").map((entry) => ({ id: entry.id, name: entry.name, view: viewFields(entry.view) })) : [],
      quickActions: Array.isArray(value.quickActions) ? value.quickActions.filter((entry) => entry && typeof entry.id === "string" && typeof entry.name === "string" && typeof entry.content === "string") : [],
      drafts: value.drafts && typeof value.drafts === "object" && !Array.isArray(value.drafts) ? value.drafts : {},
    });
  }).catch((error) => publish({ error: `视图读取失败：${message(error)}` })).finally(() => publish({ ready: true }));
  return store;
}

function normalizeQuote(task, quote) {
  if (!quote || !["comment", "description", "criteria"].includes(quote.kind) || typeof quote.sourceId !== "string" || typeof quote.text !== "string" || !quote.text.trim() || quote.text.length > 4000) throw new Error("引用无效，请重新选择最多 4000 个字符。");
  if (quote.kind === "comment" ? !(task.comments || []).some((entry) => entry.id === quote.sourceId) : quote.sourceId !== task.id) throw new Error("引用来源不存在，请重新选择。");
  return { kind: quote.kind, sourceId: quote.sourceId, text: quote.text };
}

function normalizeFiles(files = []) {
  if (!Array.isArray(files) || files.some((file) => !file || typeof file.name !== "string" || !file.name || typeof file.path !== "string" || !file.path || typeof file.grantId !== "string" || !file.grantId)) throw new Error("附件记录无效，请重新选择文件。");
  return files.map(({ name, path, grantId }) => ({ name, path, grantId }));
}
const fileList = (files) => files?.length ? `\n附件（本地文件，执行前请读取）：\n${files.map((file) => `- ${JSON.stringify(file.name)}：${JSON.stringify(file.path)}`).join("\n")}` : "";
export function routesToAgent(task, content, replyTo = null) {
  if (/^\s*\/note(?:\s|$)/i.test(content) || /@all\b/i.test(content)) return false;
  if (/(^|\s)@Agent(?=\s|[，。,:：！!?？]|$)/i.test(content)) return true;
  if (/(^|\s)@\S+/.test(content)) return false;
  const visited = new Set();
  while (replyTo && !visited.has(replyTo)) {
    visited.add(replyTo);
    if (task.runs.some((run) => `run:${run.id}` === replyTo)) return true;
    const parent = (task.comments || []).find((entry) => entry.id === replyTo);
    if (!parent) return false;
    if (parent.triggerAgent) return true;
    replyTo = parent.replyTo;
  }
  return false;
}

export function resumeTarget(task, commentId, supported) {
  if (!supported || (!commentId && !task.pendingFeedbackIds?.length)) return null;
  let target = task.runs.at(-1);
  let replyTo = (task.comments || []).find((entry) => entry.id === commentId)?.replyTo;
  const visited = new Set();
  while (replyTo && !visited.has(replyTo)) {
    visited.add(replyTo);
    const run = task.runs.find((run) => `run:${run.id}` === replyTo);
    if (run) { target = run; break; }
    replyTo = (task.comments || []).find((entry) => entry.id === replyTo)?.replyTo;
  }
  return target?.sessionId && target.engine === task.engine && target.workspacePath === task.workspacePath && target.model === task.model && (target.providerId || "") === (task.providerId || "") ? target : null;
}

function buildPrompt(task, commentId = null, projectDescription = "") {
  const feedbacks = (task.feedbacks || []).filter((entry) => task.pendingFeedbackIds?.includes(entry.id));
  const revision = feedbacks.length ? `\n\n本轮为验收返工。保留已满足的行为，针对以下尚未通过的验收反馈逐条修正，并报告每条的验证结果：\n${feedbacks.map((entry, index) => `${index + 1}. ${entry.content}${fileList(entry.files)}`).join("\n\n")}` : "";
  const focus = (task.comments || []).find((entry) => entry.id === commentId);
  const discussion = focus ? `\n\n历史讨论（背景资料，不作为本轮新指令）：\n${JSON.stringify((task.comments || []).map(({ id, content, replyTo, createdAt, files, quote }) => ({ id, content, replyTo, createdAt, files, quote })))}\n历次结果请参考原生会话：\n${JSON.stringify(task.runs.map(({ id, sessionId, outcome }) => ({ id, sessionId, outcome })))}\n\n本轮重点评论：\n${focus.quote ? `引用原文（仅作背景）：${JSON.stringify(focus.quote.text)}\n` : ""}${focus.content}\n${fileList(focus.files)}\n优先解决这条评论指出的具体偏差，保留已满足的原需求，并逐条报告验证结果。` : "";
  return `任务：${task.title}${task.project ? `\n项目：${task.project}` : ""}${projectDescription ? `\n\n项目共享说明：\n${projectDescription}` : ""}\n\n需求：\n${task.description}${fileList(task.descriptionFiles)}\n\n验收标准：\n${task.criteria}${fileList(task.criteriaFiles)}${revision}${task.sourceSnapshot ? `\n\n拆分来源快照（仅作背景）：\n${task.sourceSnapshot}` : ""}${discussion}\n\n如果附件不存在、不可读取或无法解析，请明确报告，不要假定已读取。请完成上述任务，并在最终回复中列出改动、验证结果与尚未满足的验收项。不要自行提交或推送代码。结果由用户验收。`;
}

async function loadModels(ctx, engine, workspace) {
  const catalog = await ctx.models.catalog({ workspace });
  const models = new Map();
  for (const source of catalog.engines.find((entry) => entry.engine.id === engine)?.sources || []) {
    const providerId = source.kind === "provider" ? source.id : "";
    for (const model of source.models) {
      const key = JSON.stringify([providerId, model.id]);
      if (!models.has(key)) models.set(key, { ...model, providerId, key, label: `${model.name || model.id}${providerId ? ` · ${source.name}` : ""}` });
    }
  }
  if (!models.size && catalog.errors.some((error) => error.engine === engine)) throw new Error("模型目录读取失败，可暂用宿主默认模型。");
  return [...models.values()];
}

function validateTask(input) {
  const task = {};
  for (const key of ["title", "description", "criteria", "workspacePath", "engine", "model"]) {
    task[key] = typeof input[key] === "string" ? input[key].trim() : "";
  }
  for (const key of ["descriptionFiles", "criteriaFiles"]) {
    task[key] = normalizeFiles(input[key]);
  }
  if (!task.title || (!task.description && !task.descriptionFiles.length) || (!task.criteria && !task.criteriaFiles.length)) throw new Error("请填写标题，并为需求和验收标准输入文字或选择附件。");
  if (!task.workspacePath || !task.engine) throw new Error("请选择工作区和引擎。");
  if (!Object.hasOwn(PRIORITIES, input.priority)) throw new Error("请选择有效的优先级。");
  const tags = typeof input.tags === "string" ? input.tags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean) : input.tags ?? [];
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || !tag.trim())) throw new Error("标签格式无效。");
  task.tags = [...new Set(tags.map((tag) => tag.trim()))];
  for (const [key, label] of [["startDate", "开始日期"], ["dueDate", "截止日期"]]) {
    task[key] = input[key] || "";
    if (task[key] && !validDate(task[key])) throw new Error(`请选择有效的${label}。`);
  }
  if (task.startDate && task.dueDate && task.startDate > task.dueDate) throw new Error("开始日期不能晚于截止日期。");
  task.project = typeof input.project === "string" ? input.project.trim() : "";
  task.stage = input.stage === "" || input.stage == null ? null : Number(input.stage);
  if (task.stage !== null && (!Number.isInteger(task.stage) || task.stage < 1 || task.stage > 999)) throw new Error("阶段应为 1 至 999 的整数。");
  task.parentId = input.parentId || null;
  if (task.parentId !== null && typeof task.parentId !== "string") throw new Error("父任务无效。");
  return { ...task, priority: input.priority, providerId: typeof input.providerId === "string" ? input.providerId : "" };
}

function parseDocument(content) {
  const data = JSON.parse(content);
  if (data.schemaVersion !== 1 || !Array.isArray(data.tasks)) throw new Error("任务文件格式不支持，原文件已保留。");
  const ids = new Set();
  for (const task of data.tasks) {
    validateTask(task);
    validateDeliverables(task.deliverables);
    if (task.stepConfigs != null) {
      if (!task.stepConfigs || typeof task.stepConfigs !== "object" || Array.isArray(task.stepConfigs) || Object.keys(task.stepConfigs).some((key) => !["implement", "review"].includes(key))) throw new Error("步骤配置无效，原文件已保留。");
      for (const [key, config] of Object.entries(task.stepConfigs)) if (normalizeStep(config).step !== key) throw new Error("步骤配置无效，原文件已保留。");
    }
    if (task.noticeStates != null && (typeof task.noticeStates !== "object" || Array.isArray(task.noticeStates) || Object.values(task.noticeStates).some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry) || Object.entries(entry).some(([key, value]) => !["read", "archived"].includes(key) || typeof value !== "boolean")))) throw new Error("通知记录无效，原文件已保留。");
    if ((task.project != null && typeof task.project !== "string") || (task.stage != null && (typeof task.stage !== "number" || !Number.isInteger(task.stage) || task.stage < 1)) || (task.tags != null && !Array.isArray(task.tags)) || (task.dueDate != null && typeof task.dueDate !== "string") || (task.startDate != null && (typeof task.startDate !== "string" || (task.startDate && !validDate(task.startDate)) || (task.dueDate && task.startDate > task.dueDate)))) throw new Error("任务标签或日期记录无效，原文件已保留。");
    if (typeof task.id !== "string" || !task.id || ids.has(task.id) || !Object.hasOwn(STATUSES, task.status) ||
        typeof task.createdAt !== "string" || typeof task.updatedAt !== "string" || typeof task.recovery !== "boolean" || !Array.isArray(task.runs)) {
      throw new Error("任务文件包含无效记录，原文件已保留。");
    }
    ids.add(task.id);
    const feedbacks = task.feedbacks ?? [];
    const pending = task.pendingFeedbackIds ?? [];
    if (!Array.isArray(feedbacks) || feedbacks.some((entry) => !entry || typeof entry.id !== "string" || typeof entry.content !== "string" || (!entry.content.trim() && !entry.files?.length) || typeof entry.createdAt !== "string" || !task.runs.some((run) => run.id === entry.afterRunId) || (entry.resolvedAt != null && typeof entry.resolvedAt !== "string")) ||
        !Array.isArray(pending) || pending.some((id) => !feedbacks.some((entry) => entry.id === id)) || new Set(feedbacks.map((entry) => entry.id)).size !== feedbacks.length) throw new Error("验收反馈记录无效，原文件已保留。");
    const comments = task.comments ?? [];
    if (!Array.isArray(comments) || new Set(comments.map((entry) => entry?.id)).size !== comments.length || comments.some((entry) => !entry || typeof entry.id !== "string" || !entry.id || typeof entry.content !== "string" || (!entry.content.trim() && !entry.files?.length) || typeof entry.createdAt !== "string" || typeof entry.triggerAgent !== "boolean" || (entry.resolvedAt != null && typeof entry.resolvedAt !== "string") || (entry.replyTo != null && !comments.some((parent) => parent.id === entry.replyTo) && !task.runs.some((run) => `run:${run.id}` === entry.replyTo)))) throw new Error("任务评论记录无效，原文件已保留。");
    for (const entry of comments) {
      normalizeFiles(entry.files);
      if (entry.reactions != null && (!Array.isArray(entry.reactions) || entry.reactions.some((value) => !["👍", "✅", "👀"].includes(value)))) throw new Error("评论表情记录无效，原文件已保留。");
      if (entry.quote?.kind != null) normalizeQuote(task, entry.quote);
      else if (entry.quote != null && (typeof entry.quote.sourceId !== "string" || !comments.some((source) => source.id === entry.quote.sourceId) || typeof entry.quote.text !== "string")) throw new Error("评论引用记录无效，原文件已保留。");
    }
    if (task.resolvedThreads != null && (!Array.isArray(task.resolvedThreads) || task.resolvedThreads.some((id) => !comments.some((entry) => entry.id === id) && !task.runs.some((run) => `run:${run.id}` === id)))) throw new Error("讨论状态记录无效，原文件已保留。");
    if (task.threadConclusions != null && (typeof task.threadConclusions !== "object" || Array.isArray(task.threadConclusions) || Object.entries(task.threadConclusions).some(([root, id]) => typeof id !== "string" || !(task.resolvedThreads || []).includes(root) || root === id || threadRoot(task, id) !== root || (!comments.some((entry) => entry.id === id) && !task.runs.some((run) => `run:${run.id}` === id && run.outcome !== "running"))))) throw new Error("讨论结论记录无效，原文件已保留。");
    for (const entry of feedbacks) normalizeFiles(entry.files);
    for (const run of task.runs) {
      if (run.sourceDeliverables != null) validateDeliverables(run.sourceDeliverables);
      if (run.previousRunId != null && (typeof run.previousRunId !== "string" || run.previousRunId === run.id || !task.runs.some((entry) => entry.id === run.previousRunId))) throw new Error("前序运行来源无效，原文件已保留。");
      if (run.step != null && !["implement", "review"].includes(run.step)) throw new Error("运行步骤无效，原文件已保留。");
      if (run.input?.projectResources != null) normalizeProjectResources(run.input.projectResources);
      if (run.retryOf != null && (typeof run.retryOf !== "string" || run.retryOf === run.id || !task.runs.some((entry) => entry.id === run.retryOf))) throw new Error("重试来源记录无效，原文件已保留。");
      if (run.input != null && (!run.input || (run.input.projectDescription != null && typeof run.input.projectDescription !== "string") || typeof run.input.prompt !== "string" || typeof run.input.engine !== "string" || typeof run.input.workspacePath !== "string" || typeof run.input.model !== "string" || typeof run.input.providerId !== "string")) throw new Error("执行输入快照无效，原文件已保留。");
      if (typeof run.id !== "string" || typeof run.engine !== "string" || typeof run.workspacePath !== "string" ||
          typeof run.model !== "string" || typeof run.startedAt !== "string" || !Object.hasOwn(OUTCOMES, run.outcome) ||
          (run.runId !== null && typeof run.runId !== "string") || (run.sessionId !== null && typeof run.sessionId !== "string")) {
        throw new Error("执行记录格式无效，原文件已保留。");
      }
    }
  }
  for (const task of data.tasks) {
    const visited = new Set([task.id]); let parentId = task.parentId;
    while (parentId) { const parent = data.tasks.find((entry) => entry.id === parentId); if (!parent || visited.has(parentId)) throw new Error("父子任务关系无效，原文件已保留。"); visited.add(parentId); parentId = parent.parentId; }
    if (task.duplicateOf && (!data.tasks.some((entry) => entry.id === task.duplicateOf && !entry.duplicateOf) || task.duplicateOf === task.id || task.status !== "cancelled")) throw new Error("重复任务关系无效，原文件已保留。");
    if (task.sourceSnapshot != null && typeof task.sourceSnapshot !== "string") throw new Error("来源快照无效，原文件已保留。");
  }
  const projects = data.projects ?? [];
  if (!Array.isArray(projects) || projects.some((entry) => !entry || typeof entry.workspacePath !== "string" || !entry.workspacePath || typeof entry.name !== "string" || !entry.name.trim() || typeof entry.description !== "string") || new Set(projects.map((entry) => JSON.stringify([entry.workspacePath, entry.name]))).size !== projects.length) throw new Error("项目说明记录无效，原文件已保留。");
  for (const project of projects) if (project.resources != null) normalizeProjectResources(project.resources);
  const agents = data.agents ?? [];
  if (!Array.isArray(agents) || new Set(agents.map((agent) => agent?.id)).size !== agents.length) throw new Error("Agent 记录无效，原文件已保留。");
  for (const agent of agents) { if (typeof agent?.id !== "string" || !agent.id) throw new Error("Agent 标识无效。"); normalizeAgent(agent); }
  for (const task of data.tasks) {
    if (task.assigneeId != null && !agents.some((agent) => agent.id === task.assigneeId)) throw new Error("任务负责人不存在，原文件已保留。");
    for (const run of task.runs) if (run.agentSnapshot != null) { normalizeAgent(run.agentSnapshot); if (typeof run.agentSnapshot.id !== "string") throw new Error("Agent 快照无效。"); }
  }
  const methods = data.methods ?? [], squads = data.squads ?? [];
  if (!Array.isArray(methods) || new Set(methods.map((entry) => entry?.id)).size !== methods.length) throw new Error("方法记录无效。");
  for (const method of methods) { normalizeMethod(method); if (typeof method.id !== "string" || !method.id) throw new Error("方法标识无效。"); }
  for (const agent of agents) if ((agent.methodIds || []).some((id) => !methods.some((method) => method.id === id))) throw new Error("Agent 方法绑定不存在。");
  if (!Array.isArray(squads) || new Set(squads.map((entry) => entry?.id)).size !== squads.length) throw new Error("小队记录无效。");
  for (const squad of squads) validateSquad(squad, agents);
  for (const task of data.tasks) {
    const proposals = task.proposals ?? [];
    if (!Array.isArray(proposals) || new Set(proposals.map((entry) => entry?.id)).size !== proposals.length) throw new Error("派活提案格式无效。");
    for (const entry of proposals) {
      if (!entry || typeof entry.id !== "string" || !entry.id || typeof entry.instruction !== "string" || !entry.instruction.trim() || typeof entry.createdAt !== "string" || !["pending", "dispatched"].includes(entry.status) || !squads.some((squad) => squad.id === entry.squadId) || !agents.some((agent) => agent.id === entry.agentId) || !task.runs.some((run) => run.id === entry.leaderRunId && run.coordination?.kind === "leader" && run.coordination.squadId === entry.squadId)) throw new Error("派活提案来源无效。");
    }
    for (const run of task.runs) if (run.coordination != null) {
      const info = run.coordination;
      if (!info || !["leader", "member"].includes(info.kind) || typeof info.prompt !== "string" || !squads.some((squad) => squad.id === info.squadId) || !agents.some((agent) => agent.id === info.agentId) || (info.kind === "member" && !proposals.some((entry) => entry.id === info.proposalId && entry.leaderRunId === info.leaderRunId))) throw new Error("小队运行来源无效。");
    }
    for (const comment of task.comments || []) if (comment.targetAgentId != null && !agents.some((agent) => agent.id === comment.targetAgentId)) throw new Error("评论目标 Agent 不存在。");
    for (const run of task.runs) {
      if (run.methodSnapshots != null) { if (!Array.isArray(run.methodSnapshots)) throw new Error("方法快照无效。"); for (const method of run.methodSnapshots) normalizeMethod(method); }
      if (run.runtimeEvents != null && (!Array.isArray(run.runtimeEvents) || run.runtimeEvents.some((event) => !event || typeof event.eventId !== "string" || typeof event.kind !== "string" || typeof event.occurredAt !== "string"))) throw new Error("运行日志无效。");
    }
  }
  return { tasks: data.tasks, projects, agents, methods, squads };
}

export function createBoard(ctx) {
  let state = { tasks: [], projects: [], agents: [], methods: [], squads: [], ready: false, busy: false, error: "" };
  let version = null;
  let disposed = false;
  let active = null;
  let pendingEvents = [];
  let tail = Promise.resolve();
  const listeners = new Set();
  const publish = (patch) => {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const enqueue = (operation) => {
    const result = tail.then(() => {
      if (disposed) throw new Error("插件已停用。");
      return operation();
    });
    tail = result.catch(() => {});
    return result;
  };
  const persist = async (tasks, projects = state.projects, agents = state.agents, methods = state.methods, squads = state.squads) => {
    const result = await ctx.documentStorage.writeTextAtomic(FILE, JSON.stringify({ schemaVersion: 1, tasks, projects, agents, methods, squads }, null, 2), version);
    version = result.version;
    publish({ tasks, projects, agents, methods, squads });
  };
  const requireReady = () => {
    if (!state.ready) throw new Error("任务尚未成功载入，请先重新载入。");
  };
  const findTask = (id) => {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) throw new Error("任务不存在，请重新载入。");
    return task;
  };
  const replaceTask = (id, transform) => persist(state.tasks.map((task) => task.id === id ? { ...transform(task), updatedAt: timestamp() } : task));
  const report = (error) => publish({ error: message(error) });

  async function load() {
    if (active) throw new Error("请先结束当前看板任务，再重新载入。");
    publish({ ready: false, error: "" });
    const document = await ctx.documentStorage.readText(FILE);
    const { tasks, projects, agents, methods, squads } = document ? parseDocument(document.content) : { tasks: [], projects: [], agents: [], methods: [], squads: [] };
    version = document?.version ?? null;
    const recovered = tasks.map((task) => task.status !== "running" ? task : {
      ...task, status: "blocked", recovery: true,
      runs: task.runs.map((run) => run.outcome === "running" ? { ...run, outcome: "unknown" } : run),
    });
    if (tasks.some((task) => task.status === "running")) await persist(recovered, projects, agents, methods, squads);
    publish({ tasks: recovered, projects, agents, methods, squads, ready: true });
  }

  async function applyEvent(event, owner) {
    const task = state.tasks.find((item) => item.id === owner.taskId);
    const run = task?.runs.find((item) => item.id === owner.attemptId);
    if (!run) return;
    const terminal = event.kind === "done" || event.kind === "error";
    if (!terminal && event.kind !== "session" && event.kind !== "started") return;
    await replaceTask(task.id, (current) => ({
      ...current,
      status: terminal ? (event.kind === "error" ? "blocked" : "review") : current.status,
      runs: current.runs.map((item) => item.id !== run.id ? item : {
        ...item, runId: event.runId, sessionId: event.sessionId || item.sessionId,
        ...(terminal ? {
          endedAt: timestamp(), outcome: event.kind === "error" ? "error" : item.stopRequested ? "stopped" : "ended",
          error: event.error ? message(event.error) : "",
        } : {}),
      }),
    }));
  }

  const unsubscribe = ctx.events.on(`plugin-run://${ctx.pluginId}`, (event) => {
    if (!active || !event || typeof event.runId !== "string" || event.engine !== active.engine || event.workspacePath !== active.workspacePath) return;
    if (!active.runId) {
      pendingEvents.push(event);
      return;
    }
    if (event.runId !== active.runId) return;
    const owner = active;
    if (event.kind === "done" || event.kind === "error") active = null;
    void enqueue(() => applyEvent(event, owner)).catch(report);
  });

  const logOwners = new Map();
  let unhookLogs = () => {};
  let logCapability = "unavailable";
  const pendingLogs = [];
  const recordRuntimeEvent = (event) => {
    const owner = logOwners.get(event?.runId);
    if (!owner || event.engine !== owner.engine || event.workspacePath !== owner.workspacePath || typeof event.eventId !== "string" || typeof event.kind !== "string" || typeof event.occurredAt !== "string") return;
    const allowed = ["file-changed", "command-started", "command-finished", "tool-finished", "permission-requested", "assistant-completed"];
    if (!allowed.includes(event.kind)) return;
    const clean = Object.fromEntries(["eventId", "runId", "turnId", "engine", "sessionId", "workspacePath", "occurredAt", "kind", "command", "cwd", "exitCode", "status", "toolName", "path", "change", "startedAt", "finishedAt"].filter((key) => (event[key] != null && ["string", "number"].includes(typeof event[key]) || key === "exitCode" && event[key] === null)).map((key) => [key, typeof event[key] === "string" ? event[key].slice(0, 16000) : event[key]]));
    void enqueue(async () => {
      const task = findTask(owner.taskId);
      const run = task.runs.find((entry) => entry.id === owner.attemptId);
      if (!run || (run.runtimeEvents || []).some((entry) => entry.eventId === clean.eventId)) return;
      if ((run.runtimeEvents || []).length >= 2000) {
        if (!run.logTruncated) await replaceTask(task.id, (current) => ({ ...current, runs: current.runs.map((entry) => entry.id === run.id ? { ...entry, logTruncated: true } : entry) }));
        return;
      }
      await replaceTask(task.id, (current) => ({ ...current, runs: current.runs.map((entry) => entry.id === run.id ? { ...entry, runtimeEvents: [...(entry.runtimeEvents || []), clean] } : entry) }));
    }).catch(report);
  };
  try {
    if (ctx.hooks?.registerTurnHooks) {
      unhookLogs = ctx.hooks.registerTurnHooks({ onRuntimeEvent(event) {
        if (logOwners.has(event?.runId)) recordRuntimeEvent(event);
        else if (active && !active.runId && pendingLogs.length < 100) pendingLogs.push(structuredClone(event));
      } });
      logCapability = "observing";
    }
  } catch { logCapability = "unavailable"; }

  const controller = {
    getSnapshot: () => state,
    canReload: () => !active && !state.busy,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    reload: () => enqueue(load),
    clearError: () => publish({ error: "" }),
    async refreshForEdit(id) {
      return enqueue(async () => {
        requireReady();
        if (active || state.busy) throw new Error("请先结束当前执行，再读取最新任务。");
        const document = await ctx.documentStorage.readText(FILE);
        if (!document) throw new Error("任务文档已不存在，本地输入已保留。");
        const data = parseDocument(document.content);
        if (data.tasks.some((task) => task.status === "running" || task.recovery)) throw new Error("最新文档存在执行中或待核对任务，请先返回看板核对；本地输入已保留。");
        const latest = data.tasks.find((task) => task.id === id);
        if (!latest) throw new Error("任务已不存在，本地输入已保留。");
        version = document.version; publish(data); return latest;
      });
    },
    async save(input, id, baseline = null) {
      return enqueue(async () => {
        requireReady();
        const fields = validateTask(input);
        const visited = new Set(id ? [id] : []); let parentId = fields.parentId;
        while (parentId) { if (visited.has(parentId)) throw new Error("父子任务不能形成循环。"); visited.add(parentId); parentId = findTask(parentId).parentId; }
        if (id) {
          const task = findTask(id);
          if (baseline && JSON.stringify(validateTask(task)) !== JSON.stringify(validateTask(baseline))) throw new Error("任务编辑冲突，请读取最新版本并对照；本地输入已保留。");
          if (task.status === "running" || task.recovery) throw new Error("请先结束或核对这项任务的执行，再编辑。");
          await replaceTask(id, (current) => ({ ...current, ...fields }));
          return id;
        }
        const newId = uid();
        await persist([...state.tasks, { ...fields, ...(typeof input.sourceSnapshot === "string" ? { sourceSnapshot: input.sourceSnapshot } : {}), id: newId, status: "todo", recovery: false, runs: [], feedbacks: [], pendingFeedbackIds: [], comments: [], createdAt: timestamp(), updatedAt: timestamp() }]);
        return newId;
      });
    },
    async saveMethod(input, id = null) {
      return enqueue(async () => {
        requireReady(); const fields = normalizeMethod(input);
        if (id && !state.methods.some((entry) => entry.id === id)) throw new Error("方法不存在。");
        const methodId = id || uid();
        await persist(state.tasks, state.projects, state.agents, id ? state.methods.map((entry) => entry.id === id ? { ...fields, id } : entry) : [...state.methods, { ...fields, id: methodId }]);
        return methodId;
      });
    },
    async saveSquad(input, id = null) {
      return enqueue(async () => {
        requireReady(); const squad = { id: id || uid(), name: input.name?.trim(), leaderId: input.leaderId, memberIds: [...new Set(input.memberIds || [])], instruction: input.instruction || "" };
        validateSquad(squad, state.agents);
        if (id && !state.squads.some((entry) => entry.id === id)) throw new Error("小队不存在。");
        await persist(state.tasks, state.projects, state.agents, state.methods, id ? state.squads.map((entry) => entry.id === id ? squad : entry) : [...state.squads, squad]); return squad.id;
      });
    },
    async startSquadLeader(taskId, squadId) {
      return controller.start(taskId, null, null, null, squadCoordination(state, squadId));
    },
    async saveProposal(taskId, squadId, leaderRunId, agentId, instruction) {
      return enqueue(async () => {
        requireReady(); const task = findTask(taskId), squad = state.squads.find((entry) => entry.id === squadId);
        const leader = task.runs.find((run) => run.id === leaderRunId && run.coordination?.kind === "leader" && run.coordination.squadId === squadId && run.outcome === "ended");
        if (task.status !== "review" || task.recovery || !leader || task.runs.at(-1)?.id !== leaderRunId) throw new Error("请先完成并核对当前小队队长的运行结果。");
        if (!squad || !squad.memberIds.includes(agentId) || !state.agents.some((agent) => agent.id === agentId && !agent.archived) || typeof instruction !== "string" || !instruction.trim()) throw new Error("请选择小队有效成员并填写派活说明。");
        const proposal = { id: uid(), squadId, leaderRunId, agentId, instruction: instruction.trim(), createdAt: timestamp(), status: "pending" };
        await replaceTask(taskId, (current) => ({ ...current, proposals: [...(current.proposals || []), proposal] })); return proposal.id;
      });
    },
    async dispatchProposal(taskId, proposalId) {
      const task = findTask(taskId), proposal = task.proposals?.find((entry) => entry.id === proposalId);
      if (!proposal || proposal.status !== "pending") throw new Error("提案已执行或不存在。");
      const squad = state.squads.find((entry) => entry.id === proposal.squadId);
      if (!squad?.memberIds.includes(proposal.agentId)) throw new Error("成员已不属于小队。");
      return controller.start(taskId, null, null, null, memberCoordination(proposal));
    },
    async saveAgent(input, id = null) {
      return enqueue(async () => {
        requireReady(); const fields = normalizeAgent(input);
        if (fields.methodIds.some((id) => !state.methods.some((entry) => entry.id === id))) throw new Error("请选择有效的共享方法。");
        if (id && !state.agents.some((agent) => agent.id === id)) throw new Error("Agent 不存在。");
        const agentId = id || uid();
        await persist(state.tasks, state.projects, id ? state.agents.map((agent) => agent.id === id ? { ...fields, id } : agent) : [...state.agents, { ...fields, id: agentId }]);
        return agentId;
      });
    },
    async assignAgent(id, agentId) {
      return enqueue(async () => {
        requireReady(); const task = findTask(id);
        if (task.status === "running" || task.recovery) throw new Error("请先结束或核对运行，再修改负责人。");
        if (agentId && !state.agents.some((agent) => agent.id === agentId && !agent.archived)) throw new Error("Agent 不存在或已归档。");
        await replaceTask(id, (current) => ({ ...current, assigneeId: agentId || null }));
      });
    },
    async saveProject(workspacePath, name, description, resourceInput) {
      return enqueue(async () => {
        requireReady();
        if (typeof workspacePath !== "string" || !workspacePath || typeof name !== "string" || !name.trim() || typeof description !== "string") throw new Error("请选择工作区和项目，并填写有效说明。");
        const projects = state.projects.filter((entry) => entry.workspacePath !== workspacePath || entry.name !== name.trim());
        const previous = state.projects.find((entry) => entry.workspacePath === workspacePath && entry.name === name.trim());
        const resources = normalizeProjectResources(resourceInput ?? previous?.resources);
        if (description.trim() || resources.links.length || resources.files.length) projects.push({ workspacePath, name: name.trim(), description: description.trim(), ...(resourceInput != null || previous?.resources ? { resources } : {}) });
        await persist(state.tasks, projects);
      });
    },
    async addDeliverables(id, inputs) {
      return enqueue(async () => {
        requireReady(); const task = findTask(id);
        if (!Array.isArray(inputs) || !inputs.length) throw new Error("请选择交付物文件。");
        const entries = inputs.map((input) => {
          const file = normalizeFiles([input.file])[0];
          if (input.commentId && !(task.comments || []).some((entry) => entry.id === input.commentId && (entry.files || []).some((item) => item.path === file.path))) throw new Error("交付物来源评论无效。");
          if (input.runId && !task.runs.some((run) => run.id === input.runId)) throw new Error("关联运行不存在。");
          return { id: uid(), file, createdAt: timestamp(), commentId: input.commentId || null, runId: input.runId || null };
        });
        await replaceTask(id, (current) => ({ ...current, deliverables: [...(current.deliverables || []), ...entries] }));
      });
    },
    async removeDeliverable(id, entryId) {
      return enqueue(async () => {
        requireReady(); findTask(id);
        await replaceTask(id, (current) => ({ ...current, deliverables: (current.deliverables || []).filter((entry) => entry.id !== entryId) }));
      });
    },
    async bulkNotices(action) {
      return enqueue(async () => {
        requireReady();
        if (!["read", "archive-read", "archive-completed"].includes(action)) throw new Error("通知批量操作无效。");
        const tasks = state.tasks.map((task) => {
          const notices = taskNotices(state.tasks).filter((entry) => entry.taskId === task.id && !entry.archived && (action === "read" ? !entry.read : action === "archive-read" ? entry.read : ["done", "cancelled"].includes(task.status)));
          if (!notices.length) return task;
          return { ...task, noticeStates: { ...task.noticeStates, ...Object.fromEntries(notices.map((entry) => [entry.id, { ...task.noticeStates?.[entry.id], [action === "read" ? "read" : "archived"]: true }])) } };
        });
        if (tasks.some((task, index) => task !== state.tasks[index])) await persist(tasks);
      });
    },
    async updateNotice(taskId, runId, patch) {
      return enqueue(async () => {
        requireReady();
        const task = findTask(taskId);
        if (!taskNotices(state.tasks).some((entry) => entry.taskId === task.id && entry.id === runId)) throw new Error("通知不存在，请重新载入。");
        const fields = Object.fromEntries(["read", "archived"].filter((key) => typeof patch[key] === "boolean").map((key) => [key, patch[key]]));
        await replaceTask(taskId, (current) => ({ ...current, noticeStates: { ...current.noticeStates, [runId]: { ...current.noticeStates?.[runId], ...fields } } }));
      });
    },
    async editFields(id, patch) {
      return enqueue(async () => {
        requireReady();
        const task = findTask(id);
        if (task.status === "running" || task.recovery) throw new Error("请先结束或核对这项任务的执行，再编辑。");
        const fields = Object.fromEntries(["title", "priority", "dueDate"].filter((key) => Object.hasOwn(patch, key)).map((key) => [key, patch[key]]));
        const validated = validateTask({ ...task, tags: (task.tags || []).join(", "), ...fields });
        await replaceTask(id, (current) => ({ ...current, ...validated }));
      });
    },
    async bulkUpdate(ids, patch) {
      return enqueue(async () => {
        requireReady();
        if (!Array.isArray(ids) || !ids.length) throw new Error("请先选择任务。");
        const fields = {};
        if (Object.hasOwn(patch, "priority")) { if (!Object.hasOwn(PRIORITIES, patch.priority)) throw new Error("优先级无效。"); fields.priority = patch.priority; }
        if (Object.hasOwn(patch, "status")) { if (!["todo", "cancelled"].includes(patch.status)) throw new Error("批量状态仅支持待办或取消，完成仍需逐项验收。"); fields.status = patch.status; fields.duplicateOf = null; }
        if (!Object.keys(fields).length) throw new Error("没有可修改的字段。");
        for (const id of ids) { const task = findTask(id); if (task.status === "running" || task.recovery) throw new Error("所选任务含执行中或待核对任务，未进行批量修改。"); }
        await persist(state.tasks.map((task) => ids.includes(task.id) ? { ...task, ...fields, updatedAt: timestamp() } : task));
      });
    },
    async markDuplicate(id, originalId) {
      return enqueue(async () => {
        requireReady(); const task = findTask(id);
        if (task.status === "running" || task.recovery) throw new Error("请先结束或核对执行。");
        if (originalId) {
          const original = findTask(originalId);
          if (id === originalId || original.duplicateOf || state.tasks.some((entry) => entry.duplicateOf === id)) throw new Error("重复关系只能保留一层，原任务和重复任务不能相同。");
        }
        await replaceTask(id, (current) => ({ ...current, duplicateOf: originalId || null, status: originalId ? "cancelled" : "todo" }));
      });
    },
    async resolveThread(id, commentId, resolved, conclusionId = null) {
      return enqueue(async () => {
        requireReady(); const task = findTask(id);
        if (!(task.comments || []).some((entry) => entry.id === commentId) && !task.runs.some((run) => `run:${run.id}` === commentId)) throw new Error("讨论不存在。");
        const root = threadRoot(task, commentId);
        if (conclusionId && (!resolved || conclusionId === root || threadRoot(task, conclusionId) !== root || (!(task.comments || []).some((entry) => entry.id === conclusionId) && !task.runs.some((run) => `run:${run.id}` === conclusionId && run.outcome !== "running")))) throw new Error("结论必须是当前讨论中的回复。");
        await replaceTask(id, (current) => ({ ...current, threadConclusions: { ...Object.fromEntries(Object.entries(current.threadConclusions || {}).filter(([key]) => key !== root)), ...(conclusionId ? { [root]: conclusionId } : {}) }, resolvedThreads: resolved ? [...new Set([...(current.resolvedThreads || []), root])] : (current.resolvedThreads || []).filter((value) => value !== root) }));
      });
    },
    async reactToComment(id, commentId, emoji) {
      return enqueue(async () => {
        requireReady(); const task = findTask(id);
        if (!["👍", "✅", "👀"].includes(emoji) || !(task.comments || []).some((entry) => entry.id === commentId)) throw new Error("评论或表情无效。");
        await replaceTask(id, (current) => ({ ...current, comments: current.comments.map((entry) => entry.id !== commentId ? entry : { ...entry, reactions: (entry.reactions || []).includes(emoji) ? entry.reactions.filter((value) => value !== emoji) : [...(entry.reactions || []), emoji] }) }));
      });
    },
    async addComment(id, { content, replyTo = null, files = [], quoteSourceId = null, quoteSnapshot = null, targetAgentId = null }) {
      const saved = await enqueue(async () => {
        requireReady();
        const task = findTask(id);
        files = normalizeFiles(files);
        if (typeof content !== "string" || (!content.trim() && !files.length)) throw new Error("请填写评论或选择附件。");
        if (replyTo && !(task.comments || []).some((entry) => entry.id === replyTo) && !task.runs.some((run) => `run:${run.id}` === replyTo)) throw new Error("回复的评论不存在，请重新选择。");
        const targetId = commentAgentId(task, content, replyTo, targetAgentId);
        if (targetId && !state.agents.some((agent) => agent.id === targetId && !agent.archived)) throw new Error("提及目标不存在或已归档。");
        const triggerAgent = Boolean(targetId) || routesToAgent(task, content, replyTo);
        if (task.duplicateOf && triggerAgent) throw new Error("重复任务不能触发执行，请打开原任务，或先撤销重复标记。");
        const quoted = quoteSourceId ? (task.comments || []).find((entry) => entry.id === quoteSourceId) : null;
        if (quoteSourceId && !quoted) throw new Error("引用的评论不存在。");
        const quote = quoteSnapshot ? normalizeQuote(task, quoteSnapshot) : quoted ? { sourceId: quoted.id, text: quoted.content.slice(0, 4000) } : null;
        const comment = { id: uid(), quote, content: content.trim(), files, replyTo, targetAgentId: targetId, triggerAgent, createdAt: timestamp(), resolvedAt: null };
        await replaceTask(id, (current) => ({ ...current, comments: [...(current.comments || []), comment], threadConclusions: Object.fromEntries(Object.entries(current.threadConclusions || {}).filter(([root]) => root !== threadRoot(current, replyTo))), resolvedThreads: (current.resolvedThreads || []).filter((root) => root !== threadRoot(current, replyTo)), ...(comment.triggerAgent && current.status !== "running" && !current.recovery ? { status: "todo" } : {}) }));
        return comment;
      });
      if (saved.triggerAgent) {
        try { await controller.start(id, saved.id); }
        catch (error) { return { id: saved.id, deliveryError: `评论已保存，尚未交付 Agent：${message(error)}` }; }
      }
      return { id: saved.id, deliveryError: "" };
    },
    async addFeedback(id, content, afterRunId, files = []) {
      return enqueue(async () => {
        requireReady();
        const task = findTask(id);
        if (task.recovery || (task.status !== "review" && !(task.status === "todo" && task.pendingFeedbackIds?.length))) throw new Error("请从待验收任务提交反馈，或为待修正任务补充反馈。");
        const latest = task.runs.at(-1);
        if (!latest || latest.id !== afterRunId) throw new Error("执行记录已变化，请重新打开验收反馈。");
        files = normalizeFiles(files);
        if (typeof content !== "string" || (!content.trim() && !files.length)) throw new Error("请填写具体偏差和修正要求。");
        const feedback = { id: uid(), content: content.trim(), files, afterRunId, createdAt: timestamp(), resolvedAt: null };
        await replaceTask(id, (current) => ({ ...current, status: "todo", feedbacks: [...(current.feedbacks || []), feedback], pendingFeedbackIds: [...(current.pendingFeedbackIds || []), feedback.id],
          runs: current.runs.map((run) => run.id === afterRunId ? { ...run, reviewDecision: "rejected", reviewedAt: feedback.createdAt } : run),
        }));
      });
    },
    async setStatus(id, status) {
      return enqueue(async () => {
        requireReady();
        const task = findTask(id);
        if (task.status === "running" || task.recovery) throw new Error("请先结束或核对会话。");
        if (!["todo", "cancelled", "done"].includes(status)) throw new Error("无效的状态操作。");
        if (status === "done" && task.status !== "review") throw new Error("只有待验收任务可以确认完成。");
        const pending = task.pendingFeedbackIds || [];
        const latest = task.runs.at(-1);
        const pendingComments = (task.comments || []).filter((entry) => entry.triggerAgent && !entry.resolvedAt);
        const handledComments = task.runs.filter((run) => ["ended", "stopped"].includes(run.outcome)).flatMap((run) => run.commentIds || []);
        if (status === "done" && pendingComments.some((entry) => !handledComments.includes(entry.id))) throw new Error("还有评论未交给 Agent 处理，不能验收通过。");
        if (status === "done" && pending.some((id) => !latest?.feedbackIds?.includes(id))) throw new Error("修正意见尚未执行，不能验收通过。");
        const reviewedAt = timestamp();
        await replaceTask(id, (current) => ({ ...current, status, ...(status !== "cancelled" ? { duplicateOf: null } : {}), ...(status === "done" ? {
          comments: (current.comments || []).map((entry) => handledComments.includes(entry.id) ? { ...entry, resolvedAt: reviewedAt } : entry),
          pendingFeedbackIds: [], feedbacks: (current.feedbacks || []).map((entry) => pending.includes(entry.id) ? { ...entry, resolvedAt: reviewedAt } : entry),
          runs: current.runs.map((run) => run.id === latest?.id ? { ...run, reviewDecision: "accepted", reviewedAt } : run),
        } : {}) }));
      });
    },
    async acknowledge(id) {
      return enqueue(async () => {
        requireReady();
        const task = findTask(id);
        if (!task.recovery) return;
        await replaceTask(id, (current) => ({ ...current, recovery: false, status: "review", runs: current.runs.map((run) => run.outcome === "unknown" ? { ...run, outcome: run.stopRequested ? "stopped" : "ended" } : run) }));
      });
    },
    async start(id, commentId = null, retryRunId = null, stepInput = null, coordination = null) {
      let prompt;
      let resume;
      if (state.busy || active) throw new Error("已有看板任务正在启动或执行。");
      publish({ busy: true, error: "" });
      let owner;
      let spawned = false;
      try {
        const task = await enqueue(async () => {
          requireReady();
          if (state.tasks.some((item) => item.status === "running" || item.recovery)) throw new Error("请先结束或核对已有执行。");
          const original = findTask(id);
          if (coordination?.proposalId && !original.proposals?.some((entry) => entry.id === coordination.proposalId && entry.status === "pending" && entry.leaderRunId === original.runs.at(-1)?.id)) throw new Error("派活提案已执行或运行来源已变化，请重新核对。");
          const stepConfig = stepInput ? normalizeStep(stepInput) : null;
          if (stepConfig && retryRunId) throw new Error("步骤交接和历史输入重试需分别执行。");
          if (stepConfig?.step === "review" && original.runs.at(-1)?.outcome !== "ended") throw new Error("请先完成一轮实现并核对结果，再交给审查。");
          const retry = retryRunId ? original.runs.find((run) => run.id === retryRunId) : null;
          if (retryRunId && (!retry || !["error", "stopped"].includes(retry.outcome) || !retry.input)) throw new Error("只有保留输入快照的失败或中断轮次可以重试。");
          if (!retry) commentId ||= (original.comments || []).filter((entry) => entry.triggerAgent && !entry.resolvedAt).at(-1)?.id || null;
          const targetAgentId = !retry && commentId ? original.comments?.find((entry) => entry.id === commentId)?.targetAgentId : null;
          const selectedAgentId = coordination?.agentId || targetAgentId || original.assigneeId;
          const assignedAgent = !retry && selectedAgentId ? state.agents.find((agent) => agent.id === selectedAgentId) : null;
          if (!retry && selectedAgentId && !assignedAgent) throw new Error("目标 Agent 不存在。");
          if (assignedAgent?.archived) throw new Error("负责人 Agent 已归档，请重新指派。");
          if (assignedAgent?.workspacePath && assignedAgent.workspacePath !== original.workspacePath) throw new Error("任务工作区与 Agent 执行工作区不一致，请核对后修改。");
          const current = retry ? { ...original, engine: retry.input.engine, model: retry.input.model, providerId: retry.input.providerId, workspacePath: retry.input.workspacePath } : stepConfig ? { ...original, engine: stepConfig.engine, model: stepConfig.model, providerId: stepConfig.providerId } : assignedAgent ? { ...original, engine: assignedAgent.engine, model: assignedAgent.model, providerId: assignedAgent.providerId } : original;
          if (current.parentId && (current.stage || 1) > activeStage(state.tasks, current.parentId)) throw new Error("较早阶段的子任务尚未结束，请先完成或取消前一阶段。");
          if (current.duplicateOf) throw new Error("请在原任务执行，或先撤销重复标记。");
          if (retry) commentId = retry.commentId || null;
          else commentId ||= (current.comments || []).filter((entry) => entry.triggerAgent && !entry.resolvedAt).at(-1)?.id || null;
          if (!retry && commentId && !(current.comments || []).some((entry) => entry.id === commentId && entry.triggerAgent && !entry.resolvedAt)) throw new Error("这条评论已处理或不触发 Agent。");
          if (!["todo", "blocked", "review"].includes(current.status)) throw new Error("请先将任务移回待办。");
          const engines = await ctx.models.listEngines();
          if (!engines.some((engine) => engine.id === current.engine && engine.available && engine.enabled)) throw new Error("所选引擎当前不可用，请编辑任务重新选择。");
          const workspaces = await ctx.workspaces.list();
          if (!workspaces.some((workspace) => workspace.path === current.workspacePath)) throw new Error("工作区已移除，请编辑任务重新选择。");
          if (current.model) {
            const models = await loadModels(ctx, current.engine, current.workspacePath);
            if (!models.some((model) => model.id === current.model && model.providerId === (current.providerId || ""))) throw new Error("所选模型或渠道已不在当前列表中，请重新选择。");
          }
          resume = retry || stepConfig || assignedAgent ? null : resumeTarget(current, commentId, ctx.sessions.supportsResume === true);
          const projectDescription = retry ? retry.input.projectDescription || "" : state.projects.find((entry) => entry.workspacePath === current.workspacePath && entry.name === current.project)?.description || "";
          const projectResources = retry ? normalizeProjectResources(retry.input.projectResources) : normalizeProjectResources(state.projects.find((entry) => entry.workspacePath === current.workspacePath && entry.name === current.project)?.resources);
          const methodSnapshots = retry ? structuredClone(retry.methodSnapshots || []) : structuredClone(state.methods.filter((method) => !method.archived && assignedAgent?.methodIds?.includes(method.id)));
          prompt = retry ? retry.input.prompt : buildPrompt(current, commentId, projectDescription) + resourcePrompt(projectResources) + (stepConfig ? stepPrompt(current, stepConfig) : "") + agentPrompt(assignedAgent) + methodContext(methodSnapshots) + (coordination?.prompt || "");
          owner = { taskId: id, attemptId: uid(), runId: null, engine: current.engine, workspacePath: current.workspacePath };
          await replaceTask(id, (item) => ({ ...item, ...(stepConfig ? { stepConfigs: { ...item.stepConfigs, [stepConfig.step]: stepConfig } } : {}), status: "running", ...(coordination?.proposalId ? { proposals: item.proposals.map((entry) => entry.id === coordination.proposalId ? { ...entry, status: "dispatched" } : entry) } : {}), runs: [...item.runs, {
            methodSnapshots, ...(coordination ? { coordination: structuredClone(coordination) } : retry?.coordination ? { coordination: structuredClone(retry.coordination) } : {}),
            id: owner.attemptId, runId: null, sessionId: null, engine: current.engine, model: current.model, providerId: current.providerId || "", workspacePath: current.workspacePath,
            ...(assignedAgent ? { agentSnapshot: structuredClone({ ...assignedAgent, engine: current.engine, model: current.model, providerId: current.providerId || "" }) } : retry?.agentSnapshot ? { agentSnapshot: structuredClone(retry.agentSnapshot) } : {}),
            ...(stepConfig ? { sourceDeliverables: structuredClone(item.deliverables || []) } : retry?.sourceDeliverables ? { sourceDeliverables: structuredClone(retry.sourceDeliverables) } : {}),
            ...(retry ? { retryOf: retry.id, ...(retry.step ? { step: retry.step, previousRunId: retry.previousRunId || null } : {}) } : stepConfig ? { step: stepConfig.step, previousRunId: original.runs.at(-1)?.id || null } : {}),
            startedAt: timestamp(), endedAt: null, outcome: "running", logCapability, runtimeEvents: [], error: "", stopRequested: false,
            feedbackIds: [...(retry ? retry.feedbackIds || [] : item.pendingFeedbackIds || [])],
            resumeSessionId: resume?.sessionId || null,
            commentId, commentIds: retry ? [...(retry.commentIds || [])] : commentId ? [commentId] : [],
            input: { prompt, projectDescription, projectResources, ...(stepConfig ? { stepConfig } : retry?.input.stepConfig ? { stepConfig: retry.input.stepConfig } : {}), sessionId: resume?.sessionId || null, engine: current.engine, model: current.model, providerId: current.providerId || "", workspacePath: current.workspacePath },
          }] }));
          active = owner;
          pendingEvents = [];
          return current;
        });
        const handle = await ctx.sessions.startRun({ ...(resume ? { sessionId: resume.sessionId } : {}), engine: task.engine, workspacePath: task.workspacePath, prompt, model: task.model || null, ...(task.providerId ? { providerId: task.providerId } : {}) });
        spawned = true;
        owner.runId = handle.runId;
        logOwners.set(handle.runId, { ...owner });
        for (const event of pendingLogs.splice(0)) if (event.runId === handle.runId) recordRuntimeEvent(event);
        const buffered = pendingEvents;
        pendingEvents = [];
        if (buffered.some((event) => event.runId === handle.runId && ["done", "error"].includes(event.kind))) active = null;
        await enqueue(async () => {
          await replaceTask(id, (item) => ({ ...item, runs: item.runs.map((run) => run.id !== owner.attemptId ? run : { ...run, runId: handle.runId, sessionId: handle.sessionId || resume?.sessionId || run.sessionId }) }));
          for (const event of buffered) {
            if (event.runId !== handle.runId) continue;
            await applyEvent(event, owner);
            if (event.kind === "done" || event.kind === "error") {
              if (active === owner) active = null;
              break;
            }
          }
        });
      } catch (error) {
        if (!spawned && owner) {
          active = null;
          pendingEvents = [];
          try {
            await enqueue(() => replaceTask(id, (task) => ({ ...task, status: "blocked", runs: task.runs.map((run) => run.id !== owner.attemptId ? run : { ...run, outcome: "error", error: message(error), endedAt: timestamp() }) })));
          } catch (saveError) { throw new Error(`${message(error)}；记录保存失败：${message(saveError)}`); }
        }
        throw error;
      } finally {
        publish({ busy: false });
      }
    },
    async stop(id) {
      if (state.busy) throw new Error("正在启动，请稍后停止。");
      const owner = active;
      if (!owner || owner.taskId !== id) throw new Error("无法确认运行归属，请打开会话核对。");
      await enqueue(() => replaceTask(id, (task) => ({ ...task, runs: task.runs.map((run) => run.id !== owner.attemptId ? run : { ...run, stopRequested: true }) })));
      const run = findTask(id).runs.find((item) => item.id === owner.attemptId);
      try {
        await ctx.sessions.interruptRun({ engine: run.engine, workspacePath: run.workspacePath, sessionId: run.sessionId });
      } catch (error) {
        await enqueue(() => replaceTask(id, (task) => ({ ...task, runs: task.runs.map((item) => item.id !== run.id ? item : { ...item, stopRequested: false }) })));
        throw error;
      }
    },
    async open(run) {
      if (!run.sessionId) throw new Error("会话标识尚未返回。");
      await ctx.sessions.selectSession(run.engine, run.sessionId, run.workspacePath);
    },
    dispose() { disposed = true; unsubscribe(); unhookLogs(); logOwners.clear(); listeners.clear(); },
  };
  controller.ready = controller.reload().catch(report);
  return controller;
}

export default function activate(ctx) {
  if (ctx.host.isWeb) throw new Error("个人任务看板需要 CC GUI 桌面客户端。");
  const { createElement: h, useState, useEffect, useRef, useSyncExternalStore } = ctx.react;
  const board = createBoard(ctx);
  const viewStore = createViewStore(ctx);
  let editorRequest = { task: null, key: uid() };
  const editorListeners = new Set();
  const editorStore = {
    getSnapshot: () => editorRequest,
    subscribe(listener) { editorListeners.add(listener); return () => editorListeners.delete(listener); },
    select(task) {
      editorRequest = { task, key: uid() };
      for (const listener of editorListeners) listener();
    },
  };
  const openEditor = (task = null) => { editorStore.select(task); ctx.ui.openCenterTab("task-editor"); };
  let feedbackRequest = null;
  const feedbackListeners = new Set();
  const feedbackStore = {
    getSnapshot: () => feedbackRequest,
    subscribe(listener) { feedbackListeners.add(listener); return () => feedbackListeners.delete(listener); },
    select(request) { feedbackRequest = request; for (const listener of feedbackListeners) listener(); },
  };
  const openFeedback = (task) => {
    feedbackStore.select({ taskId: task.id, afterRunId: task.runs.at(-1)?.id, key: uid() });
    ctx.ui.openCenterTab("task-feedback");
  };
  let detailRequest = null;
  const detailListeners = new Set();
  const detailStore = { getSnapshot: () => detailRequest, subscribe(listener) { detailListeners.add(listener); return () => detailListeners.delete(listener); } };
  const openDetails = (task, runId = null) => { detailRequest = { taskId: task.id, runId }; for (const listener of detailListeners) listener(); ctx.ui.openCenterTab("task-details"); };
  const button = (label, onClick, props = {}) => h("button", { type: "button", onClick, ...props }, label);
  const icon = ({ className }) => h("svg", { className, width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, "aria-hidden": true },
    h("rect", { x: 3, y: 4, width: 18, height: 16, rx: 3 }), h("path", { d: "M9 4v16M15 4v16M6 8v4M12 8v7M18 8v3" }));

  function AttachmentPicker({ files, onChange, disabled, label, onBusy }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    async function choose() {
      if (busy || disabled) return;
      setBusy(true); onBusy(true); setError("");
      try {
        const file = await ctx.assets.grantFile({ title: `选择${label}附件` });
        if (!file || !mounted.current) return;
        const path = `${file.path.replace(/[\\/]+$/, "")}/${file.relativePath}`;
        if (!files.some((entry) => entry.path === path)) onChange([...files, { name: file.relativePath, path, grantId: file.grantId }]);
      } catch (error) { if (mounted.current) setError(`附件选择失败：${message(error)}`); }
      finally { if (mounted.current) { setBusy(false); onBusy(false); } }
    }
    return h("div", { className: "ptb-wide" },
      h("div", { className: "ptb-attachment-controls" }, button(busy ? "正在选择…" : "选择文件", () => void choose(), { disabled: disabled || busy, "aria-label": `上传${label}附件` }), h("span", { className: "ptb-muted" }, "可多次选择；保留原文件，执行时读取。")),
      h("ul", { className: "ptb-attachments", "aria-label": `${label}附件` }, ...files.map((file) => h("li", { key: file.path }, h("span", { title: file.path }, file.name), button("移除", () => onChange(files.filter((entry) => entry.path !== file.path)), { disabled: disabled || busy, "aria-label": `移除${label}附件 ${file.name}` })))),
      error && h("p", { className: "ptb-error", role: "alert" }, error));
  }

  function TaskForm({ task, tasks, workspaces, engines, onSaved, onCancel, act }) {
    const [draft, setDraft] = useState(() => task ? { ...task, tags: (task.tags || []).join(", "), dueDate: task.dueDate || "", startDate: task.startDate || "", parentId: task.parentId || "", project: task.project || "", stage: task.stage ?? "" } : {
      title: "", description: "", criteria: "", tags: "", dueDate: "", startDate: "", parentId: "", project: viewStore.getSnapshot().project, stage: "", descriptionFiles: [], criteriaFiles: [], priority: "medium", workspacePath: viewStore.getSnapshot().workspace || workspaces[0]?.path || "", engine: engines[0]?.id || "", model: "", providerId: "",
    });
    const initialDraft = useRef(JSON.stringify(draft));
    const [baseline, setBaseline] = useState(task);
    const [discarding, setDiscarding] = useState(false);
    const [latest, setLatest] = useState(null);
    const [saveError, setSaveError] = useState("");
    const [catalog, setCatalog] = useState({ models: [], loading: true, error: "" });
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState("");
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const formBusy = saving || Boolean(uploading);
    const fileField = (label, name, key) => h("div", { className: "ptb-wide ptb-attachment-field" }, field(label, name, "textarea"),
      h(AttachmentPicker, { label, files: draft[key] || [], disabled: formBusy, onBusy: (busy) => setUploading(busy ? key : ""), onChange: (files) => setDraft((current) => ({ ...current, [key]: files })) }));
    useEffect(() => {
      let alive = true;
      setCatalog({ models: [], loading: true, error: "" });
      if (!draft.engine || !draft.workspacePath) {
        setCatalog({ models: [], loading: false, error: "" });
        return () => { alive = false; };
      }
      loadModels(ctx, draft.engine, draft.workspacePath).then(
        (models) => { if (alive) setCatalog({ models, loading: false, error: "" }); },
        (error) => { if (alive) setCatalog({ models: [], loading: false, error: message(error) }); },
      );
      return () => { alive = false; };
    }, [draft.engine, draft.workspacePath]);
    const modelKey = draft.model ? JSON.stringify([draft.providerId || "", draft.model]) : "";
    const change = (name) => (event) => {
      const value = event.target.value;
      if (name === "model") {
        const [providerId, model] = value ? JSON.parse(value) : ["", ""];
        setDraft((current) => ({ ...current, providerId, model }));
      } else setDraft((current) => ({ ...current, [name]: value, ...(["engine", "workspacePath"].includes(name) ? { model: "", providerId: "" } : {}) }));
    };
    const field = (label, name, type, options) => h("label", { className: `ptb-field ${type === "textarea" ? "ptb-wide" : ""}` },
      h("span", null, label),
      type === "select" ? h("select", { value: name === "model" ? modelKey : draft[name], onChange: change(name), required: !["model", "parentId"].includes(name), disabled: formBusy || (name === "model" && catalog.loading) }, options) :
        h(type === "textarea" ? "textarea" : "input", { value: draft[name], onChange: change(name), type: ["date", "number"].includes(type) ? type : undefined, ...(type === "number" ? { min: 1, max: 999 } : {}), required: name === "title" || (["description", "criteria"].includes(name) && !(draft[name === "description" ? "descriptionFiles" : "criteriaFiles"] || []).length), disabled: formBusy, rows: 4, ...(name === "title" ? { autoFocus: true, maxLength: 180 } : {}) }));
    const option = (value, label) => h("option", { key: value, value }, label);
    return h("form", { className: "ptb-form", onSubmit: (event) => {
      event.preventDefault();
      if (formBusy || latest) return;
      setSaving(true);
      setSaveError("");
      void board.save(draft, task?.id, baseline).then(onSaved, (error) => { if (mounted.current) setSaveError(message(error)); }).finally(() => { if (mounted.current) setSaving(false); });
    } },
    saveError && h("div", { className: "ptb-wide", role: "alert" }, saveError, task && button("读取最新版本并对照", async () => {
      setSaving(true);
      try { setLatest(await board.refreshForEdit(task.id)); } catch (error) { setSaveError(message(error)); } finally { if (mounted.current) setSaving(false); }
    }, { disabled: formBusy })),
    latest && h("section", { className: "ptb-wide", "aria-label": "编辑版本对照" },
      h("p", null, "逐字段核对后可采用最新内容，或保留本地输入并再次保存。运行、评论和验收记录始终沿用最新版本。"),
      JSON.stringify(validateTask(latest)) === JSON.stringify(validateTask(baseline)) && h("p", { role: "status" }, "任务文档其他部分已变化，当前任务的可编辑内容未变；核对完成后可继续保存本地输入。"),
      button("重新载入此任务内容", () => { setDraft({ ...latest, tags: (latest.tags || []).join(", "), dueDate: latest.dueDate || "", startDate: latest.startDate || "", parentId: latest.parentId || "", project: latest.project || "", stage: latest.stage ?? "" }); setBaseline(latest); setLatest(null); setSaveError(""); }),
      ...Object.keys(validateTask(latest)).filter((key) => JSON.stringify(draft[key] ?? "") !== JSON.stringify(key === "tags" ? (latest.tags || []).join(", ") : latest[key] ?? "")).map((key) => h("div", { key }, h("strong", null, ({ title: "标题", description: "需求", criteria: "验收标准", project: "项目", tags: "标签", descriptionFiles: "需求附件", criteriaFiles: "验收附件", priority: "优先级", workspacePath: "工作区", engine: "引擎", model: "模型", providerId: "渠道", dueDate: "截止日期", startDate: "开始日期", parentId: "父任务", stage: "阶段" })[key]),
        h("div", { className: "ptb-compare" }, h("div", null, "最新内容", h("pre", { className: "ptb-content" }, JSON.stringify(validateTask(latest)[key], null, 2)), button("采用此字段最新内容", () => setDraft((current) => ({ ...current, [key]: key === "tags" ? (latest.tags || []).join(", ") : latest[key] ?? "" })))), h("div", null, "本地输入", h("pre", { className: "ptb-content" }, JSON.stringify(draft[key] ?? "", null, 2)))))),
      button("核对完成，保留当前输入", () => { setBaseline(latest); setLatest(null); setSaveError(""); }, { disabled: formBusy })),
    h("div", { className: "ptb-wide" }, field("标题", "title", "input")),
    fileField("需求", "description", "descriptionFiles"), fileField("验收标准", "criteria", "criteriaFiles"),
    field("工作区", "workspacePath", "select", [option("", "选择工作区"), ...workspaces.map((item) => option(item.path, `${item.name} · ${item.path}`)), ...(draft.workspacePath && !workspaces.some((item) => item.path === draft.workspacePath) ? [option(draft.workspacePath, `已移除：${draft.workspacePath}`)] : [])]),
    field("项目", "project", "input"),
    draft.parentId && field("子任务阶段", "stage", "number"),
    field("标签（逗号分隔）", "tags", "input"),
    field("开始日期", "startDate", "date"),
    field("截止日期", "dueDate", "date"),
    field("父任务", "parentId", "select", [option("", "无父任务"), ...tasks.filter((entry) => entry.id !== task?.id).map((entry) => option(entry.id, entry.title))]),
    field("优先级", "priority", "select", Object.entries(PRIORITIES).map(([value, label]) => option(value, label))),
    field("引擎", "engine", "select", [option("", "选择引擎"), ...engines.map((item) => option(item.id, item.id)), ...(draft.engine && !engines.some((item) => item.id === draft.engine) ? [option(draft.engine, `${draft.engine}（不可用）`)] : [])]),
    field("模型", "model", "select", [option("", catalog.loading ? "正在读取模型…" : "使用宿主默认模型"), ...catalog.models.map((item) => option(item.key, item.label)), ...(draft.model && !catalog.models.some((item) => item.key === modelKey) ? [option(modelKey, `${draft.model}${catalog.loading ? "（正在读取…）" : "（未在列表中）"}`)] : [])]),
    catalog.error && h("p", { role: "alert", className: "ptb-wide ptb-error" }, `模型列表读取失败：${catalog.error}`),
    h("div", { className: "ptb-wide ptb-actions" }, h("button", { type: "submit", className: "ptb-primary", disabled: formBusy || catalog.loading || Boolean(latest) }, saving ? "保存中…" : "保存任务"), button("取消", () => { if (JSON.stringify(draft) === initialDraft.current) onCancel(); else setDiscarding(true); }, { disabled: formBusy })),
    discarding && h("div", { className: "ptb-wide", role: "alert", "aria-label": "放弃编辑确认" }, "放弃未保存的本地输入？", button("继续编辑", () => setDiscarding(false)), button("确认放弃编辑", onCancel, { disabled: formBusy })));
  }

  function useResources(reloadKey) {
    const [resources, setResources] = useState({ workspaces: [], engines: [], error: "", loading: true });
    useEffect(() => {
      let alive = true;
      setResources((current) => ({ ...current, loading: true, error: "" }));
      Promise.all([ctx.workspaces.list(), ctx.models.listEngines()]).then(
        ([workspaces, engines]) => { if (alive) setResources({ workspaces, engines: engines.filter((engine) => engine.enabled && engine.available), loading: false, error: "" }); },
        (error) => { if (alive) setResources({ workspaces: [], engines: [], loading: false, error: message(error) }); },
      );
      return () => { alive = false; };
    }, [reloadKey]);
    return resources;
  }

  function TaskEditor() {
    const state = useSyncExternalStore(board.subscribe, board.getSnapshot);
    const request = useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot);
    const [reloadKey, setReloadKey] = useState(0);
    const resources = useResources(reloadKey);
    const [error, setError] = useState("");
    useEffect(() => { setError(""); }, [request]);
    async function act(operation) {
      setError("");
      try { await operation(); } catch (error) { setError(message(error)); }
    }
    function finish(savedId) {
      if (editorRequest !== request) return;
      const saved = typeof savedId === "string" && board.getSnapshot().tasks.find((task) => task.id === savedId);
      if (saved) void viewStore.update(revealTaskView(viewStore.getSnapshot(), saved));
      editorStore.select(null);
      ctx.ui.openCenterTab("board");
    }
    return h("section", { className: "ptb-root ptb-editor", "aria-label": "任务编辑" }, h("style", null, CSS),
      h("header", { className: "ptb-header" }, h("div", null, h("div", { className: "ptb-eyebrow" }, "个人工作台"), h("h1", null, request?.task?.id ? "编辑任务" : "新建任务"))),
      (error || resources.error || state.error) && h("div", { className: "ptb-banner ptb-error", role: "alert" }, error || resources.error || state.error),
      !request ? button("返回看板", finish) : !state.ready || resources.loading ? h("p", { role: "status" }, "正在载入工作区与引擎…") :
        resources.error || !resources.workspaces.length || !resources.engines.length ? h("div", { className: "ptb-banner" }, h("p", null, "请先添加工作区并启用可用的 AI 引擎。"), button("重新读取", () => setReloadKey((key) => key + 1)), button("返回看板", finish)) :
          h(TaskForm, { key: request.key, task: request.task, tasks: state.tasks, ...resources, act, onSaved: finish, onCancel: finish }));
  }

  function FeedbackForm({ task, request, onFinish }) {
    const [content, setContent] = useState("");
    const [files, setFiles] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    async function submit(event) {
      event.preventDefault();
      if (saving || uploading) return;
      setSaving(true); setError("");
      try { await board.addFeedback(task.id, content, request.afterRunId, files); onFinish(); }
      catch (error) { if (mounted.current) setError(message(error)); }
      finally { if (mounted.current) setSaving(false); }
    }
    return h("form", { className: "ptb-form", onSubmit: (event) => void submit(event) },
      h("p", { className: "ptb-wide" }, task.title),
      h("details", { className: "ptb-wide" }, h("summary", null, "查看原需求与验收标准"), h("h3", null, "需求"), h("p", { className: "ptb-content" }, task.description || "见需求附件"), h("h3", null, "验收标准"), h("p", { className: "ptb-content" }, task.criteria || "见验收附件")),
      h("label", { className: "ptb-field ptb-wide" }, h("span", null, "具体偏差与修正要求"), h("textarea", { rows: 7, autoFocus: true, required: !files.length, disabled: saving || uploading, value: content, placeholder: "未通过的验收项：\n实际偏差：\n期望结果与修正要求：", onChange: (event) => setContent(event.target.value) })),
      h(AttachmentPicker, { label: "验收反馈", files, onChange: setFiles, disabled: saving || uploading, onBusy: setUploading }),
      h("p", { className: "ptb-wide ptb-muted" }, ctx.sessions.supportsResume === true ? "保存后回到待办，点击“执行修正”返工。配置一致时续接原会话，并携带原需求和未通过反馈。" : "保存后回到待办，点击“执行修正”开始返工。当前宿主会创建新会话，携带原需求、验收标准和未通过反馈。"),
      error && h("p", { className: "ptb-wide ptb-error", role: "alert" }, error),
      h("div", { className: "ptb-wide ptb-actions" }, h("button", { type: "submit", className: "ptb-primary", disabled: saving || uploading }, saving ? "保存中…" : "保存反馈"), button("取消", onFinish, { disabled: saving || uploading })));
  }

  function FeedbackPage() {
    const request = useSyncExternalStore(feedbackStore.subscribe, feedbackStore.getSnapshot);
    const state = useSyncExternalStore(board.subscribe, board.getSnapshot);
    const task = state.tasks.find((task) => task.id === request?.taskId);
    const finish = () => {
      if (feedbackRequest !== request) return;
      feedbackStore.select(null); ctx.ui.openCenterTab("board");
    };
    return h("section", { className: "ptb-root ptb-editor", "aria-label": "验收反馈" }, h("style", null, CSS),
      h("header", { className: "ptb-header" }, h("div", null, h("div", { className: "ptb-eyebrow" }, "个人工作台"), h("h1", null, "验收反馈"))),
      task ? h(FeedbackForm, { key: request.key, task, request, onFinish: finish }) : h("div", { className: "ptb-banner" }, h("p", null, "请从待验收任务打开反馈入口。"), button("返回看板", finish)));
  }

  function revealQuote(event, quote) {
    const body = event.currentTarget.closest(".ptb-detail-body");
    const source = [...(body?.querySelectorAll("[data-quote-kind]") || [])].find((node) => node.dataset.quoteKind === (quote.kind || "comment") && node.dataset.quoteSource === quote.sourceId);
    if (!source) throw new Error("引用来源不可用，引用快照仍保留。");
    let parent = source.parentElement;
    while (parent && parent !== body) { if (parent.tagName === "DETAILS") parent.open = true; parent = parent.parentElement; }
    source.dispatchEvent(new window.Event("ptb-reveal", { bubbles: true }));
    source.scrollIntoView?.({ block: "center" }); source.focus();
    if (!source.textContent.includes(quote.text)) throw new Error("原文已变化，请对照引用快照核验。");
  }

  function SelectableText({ task, kind, sourceId, text, disabled = false }) {
    const paragraph = useRef(null);
    const [selectedText, setSelectedText] = useState("");
    useEffect(() => { setSelectedText(""); }, [task.id, sourceId, text]);
    const preferences = useSyncExternalStore(viewStore.subscribe, viewStore.getSnapshot);
    const draft = preferences.drafts[task.id] || {};
    function capture() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount !== 1) { setSelectedText(""); return; }
      const range = selection.getRangeAt(0);
      setSelectedText(paragraph.current?.contains(range.startContainer) && paragraph.current?.contains(range.endContainer) ? selection.toString() : "");
    }
    const tooLong = selectedText.length > 4000;
    return h("div", { className: "ptb-selectable" },
      h("p", { ref: paragraph, tabIndex: -1, className: "ptb-content", onMouseUp: capture, onKeyUp: capture, "data-task-search": "", "data-quote-kind": kind, "data-quote-source": sourceId }, text),
      selectedText.trim() && h("div", { className: "ptb-selection-actions" },
        button(draft.quoteSnapshot || draft.quoteSourceId ? "替换评论引用" : "加入评论引用", (event) => {
          void viewStore.update({ drafts: { ...viewStore.getSnapshot().drafts, [task.id]: { ...viewStore.getSnapshot().drafts[task.id], quoteSourceId: null, quoteSnapshot: { kind, sourceId, text: selectedText }, replyTo: kind === "comment" ? sourceId : null } } });
          const composer = event.currentTarget.closest(".ptb-detail-body")?.querySelector(".ptb-comment-composer");
          composer?.dispatchEvent(new window.Event("ptb-reveal", { bubbles: true }));
          composer?.focus(); composer?.scrollIntoView?.({ block: "center" }); setSelectedText(""); window.getSelection()?.removeAllRanges();
        }, { disabled: tooLong || !preferences.ready || disabled }),
        tooLong && h("span", { role: "alert", className: "ptb-error" }, "最多引用 4000 个字符，请缩小选区。")));
  }

  function TaskComments({ task, occupied }) {
    const preferences = useSyncExternalStore(viewStore.subscribe, viewStore.getSnapshot);
    const draft = preferences.drafts[task.id] || {};
    const content = typeof draft.content === "string" ? draft.content : "";
    const replyTo = draft.replyTo || null;
    const quoteSourceId = draft.quoteSourceId || null;
    const quoteSnapshot = draft.quoteSnapshot || null;
    const targetAgentId = draft.targetAgentId || "";
    const agents = useSyncExternalStore(board.subscribe, board.getSnapshot).agents;
    const quoteSource = (task.comments || []).find((entry) => entry.id === quoteSourceId);
    const files = Array.isArray(draft.files) ? draft.files : [];
    const updateDraft = (patch) => viewStore.update({ drafts: { ...viewStore.getSnapshot().drafts, [task.id]: { ...viewStore.getSnapshot().drafts[task.id], ...patch } } });
    const setContent = (content) => updateDraft({ content });
    const setReplyTo = (replyTo) => updateDraft({ replyTo });
    const setFiles = (files) => updateDraft({ files });
    const [actionName, setActionName] = useState("");
    const [actionEdit, setActionEdit] = useState(null);
    const [showArchivedActions, setShowArchivedActions] = useState(false);
    const [savingAction, setSavingAction] = useState(false);
    async function saveActions(actions) {
      setSavingAction(true);
      try { return await viewStore.update({ quickActions: actions }); } finally { setSavingAction(false); }
    }
    const [uploading, setUploading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const commentNodes = useRef(new Map());
    const jumpToComment = (id) => {
      const node = commentNodes.current.get(id);
      if (!node) return;
      let parent = node.parentElement;
      while (parent && parent !== node.closest(".ptb-comments")) { if (parent.tagName === "DETAILS") parent.open = true; parent = parent.parentElement; }
      node.dispatchEvent(new window.Event("ptb-reveal", { bubbles: true }));
    node.scrollIntoView?.({ block: "center" }); node.focus();
    };
    const comments = task.comments || [];
    const trigger = Boolean(commentAgentId(task, content, replyTo, targetAgentId)) || routesToAgent(task, content, replyTo);
    const previewTask = { ...task, comments: [...(task.comments || []), { id: "preview", replyTo }] };
    const willResume = resumeTarget(previewTask, "preview", ctx.sessions.supportsResume === true);
    const entries = [...comments.map((entry) => ({ ...entry, author: "我" })), ...task.runs.filter((run) => run.outcome !== "running").map((run) => ({ id: `run:${run.id}`, author: "Agent", createdAt: run.endedAt || run.startedAt, content: `${OUTCOMES[run.outcome]}。完整输出请打开本轮会话查看。`, run }))].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const reply = entries.find((entry) => entry.id === replyTo);
    const runFor = (entry) => task.runs.filter((run) => run.commentId === entry.id).at(-1);
    async function submit(event) {
      event.preventDefault();
      if (sending || uploading || !preferences.ready) return;
      setSending(true); setError("");
      try {
        const result = await board.addComment(task.id, { content, replyTo, files, quoteSourceId, quoteSnapshot, targetAgentId });
        if (mounted.current) { void updateDraft({ content: "", replyTo: null, files: [], quoteSourceId: null, quoteSnapshot: null, targetAgentId: "" }); setError(result.deliveryError); }
      } catch (error) { if (mounted.current) setError(message(error)); }
      finally { if (mounted.current) setSending(false); }
    }
    async function retry(entry) {
      setSending(true); setError("");
      try { await board.start(task.id, entry.id); }
      catch (error) { if (mounted.current) setError(message(error)); }
      finally { if (mounted.current) setSending(false); }
    }
    return h("section", { className: "ptb-comments", "aria-label": "任务评论" }, h("h2", null, "任务评论"),
      preferences.error && h("p", { role: "alert", className: "ptb-error" }, preferences.error),
      !entries.length && h("p", { className: "ptb-muted" }, "暂无评论"),
      entries.length > 1 && h("nav", { className: "ptb-discussion-nav", "aria-label": "讨论导航" },
        h("label", null, "跳转到评论 ", h("select", { "aria-label": "跳转到评论", value: "", onChange: (event) => jumpToComment(event.target.value) }, h("option", { value: "" }, "选择讨论或回复"), ...entries.map((entry) => h("option", { key: entry.id, value: entry.id }, `${task.threadConclusions?.[threadRoot(task, entry.id)] === entry.id ? "结论 · " : ""}${entry.author} · ${entry.content.slice(0, 60)}`))))),
      ...[...new Set(entries.map((entry) => threadRoot(task, entry.id)))].map((root) => {
        const members = entries.filter((entry) => threadRoot(task, entry.id) === root);
        const articles = members.map((entry) => {
        const run = runFor(entry);
        const article = h("article", { ref: (node) => { if (node) commentNodes.current.set(entry.id, node); else commentNodes.current.delete(entry.id); }, tabIndex: -1, "data-comment-id": entry.id, className: "ptb-comment", key: entry.id, "aria-label": `${entry.author}的评论` },
          h("div", { className: "ptb-comment-meta" }, entry.run?.agentSnapshot && h(AgentAvatar, { agent: entry.run.agentSnapshot }), h("strong", null, entry.run?.agentSnapshot?.name || entry.author), h("time", null, new Date(entry.createdAt).toLocaleString("zh-CN"))),
          task.threadConclusions?.[root] === entry.id && h("span", { className: "ptb-conclusion", role: "status" }, "讨论结论"),
          entry.targetAgentId && h("p", { className: "ptb-muted" }, `@${agents.find((agent) => agent.id === entry.targetAgentId)?.name || "历史 Agent"}`),
          entry.replyTo && h("p", { className: "ptb-muted" }, `回复${entries.find((parent) => parent.id === entry.replyTo)?.author || "历史评论"}`),
          entry.quote && h("blockquote", { className: "ptb-quote" }, h("span", { className: "ptb-quote-source" }, entry.quote.kind === "description" ? "引用需求" : entry.quote.kind === "criteria" ? "引用验收标准" : "引用评论"), entry.quote.text, button("查看引用来源", (event) => { setError(""); try { revealQuote(event, entry.quote); } catch (error) { setError(message(error)); } })),
          entry.run ? h("p", { className: "ptb-content" }, entry.content) : h(SelectableText, { task, kind: "comment", sourceId: entry.id, text: entry.content, disabled: sending || uploading }),
          h("ul", { className: "ptb-attachments" }, ...(entry.files || []).map((file) => h("li", { key: file.path }, button(file.name, () => { void ctx.shell.revealPath(file.path).catch((error) => setError(message(error))); }, { title: file.path })))),
          entry.triggerAgent && h("p", { className: "ptb-muted", role: "status" }, entry.resolvedAt ? "已通过验收" : run?.outcome === "running" ? "Agent 处理中" : run?.outcome === "ended" || run?.outcome === "stopped" ? "处理结束，待验收" : "待 Agent 处理"),
          h("div", { className: "ptb-actions" }, button(entry.author === "Agent" ? "回复 Agent" : "回复评论", () => setReplyTo(entry.id), { disabled: sending || uploading }),
            !entry.run && button("引用评论", () => void updateDraft({ quoteSourceId: entry.id, quoteSnapshot: null, replyTo: entry.id }), { disabled: sending || uploading }),
            button((task.resolvedThreads || []).includes(threadRoot(task, entry.id)) ? "重新打开讨论" : "解决讨论", () => { void board.resolveThread(task.id, entry.id, !(task.resolvedThreads || []).includes(threadRoot(task, entry.id))).catch((error) => setError(message(error))); }, { disabled: sending }),
            entry.id !== root && button("以此回复作为结论", () => { void board.resolveThread(task.id, entry.id, true, entry.id).catch((error) => setError(message(error))); }, { disabled: sending }),
            !entry.run && h("span", { className: "ptb-actions" }, ...["👍", "✅", "👀"].map((emoji) => button(emoji, () => { void board.reactToComment(task.id, entry.id, emoji).catch((error) => setError(message(error))); }, { key: emoji, "aria-label": `表情 ${emoji}`, "aria-pressed": entry.reactions?.includes(emoji) || false, disabled: sending }))),
            !entry.run && button("拆为子任务", () => openEditor(childFromComment(task, entry.id)), { disabled: sending || uploading }),
            entry.run && button("查看 Agent 结果", () => { void board.open(entry.run).catch((error) => setError(message(error))); }, { disabled: !entry.run.sessionId }),
            entry.triggerAgent && !entry.resolvedAt && (!run || ["error", "unknown"].includes(run.outcome)) && button("交给 Agent 处理", () => void retry(entry), { disabled: sending || occupied || task.recovery })));
        return article;
        });
        const conclusionIndex = members.findIndex((entry) => entry.id === task.threadConclusions?.[root]);
        if (conclusionIndex >= 0 && (task.resolvedThreads || []).includes(root)) return h("div", { key: root, className: "ptb-thread ptb-thread-concluded" }, articles[0],
          articles.length > 2 && h("details", { className: "ptb-resolved" }, h("summary", null, `展开讨论过程 · ${articles.length - 2} 条`), ...articles.filter((_, index) => index !== 0 && index !== conclusionIndex)), articles[conclusionIndex]);
        return (task.resolvedThreads || []).includes(root) ? h("details", { key: root, className: "ptb-resolved" }, h("summary", null, `已解决讨论 · ${members.length} 条 · ${members[0].content.slice(0, 60)}`), ...articles) : h("div", { key: root, className: "ptb-thread" }, ...articles);
      }),
      h("form", { className: "ptb-form", onSubmit: (event) => void submit(event) },
        h("details", { className: "ptb-wide" }, h("summary", null, "评论快捷操作"),
          button(showArchivedActions ? "查看可用操作" : "查看已归档操作", () => setShowArchivedActions(!showArchivedActions)),
          h("div", { className: "ptb-quick-actions" }, ...preferences.quickActions.filter((action) => (action.archived === true) === showArchivedActions).map((action) => h("div", { key: action.id, className: "ptb-actions" },
            action.archived ? h("span", null, action.name) : button(action.name, () => setContent(action.content), { disabled: sending || uploading || !preferences.ready }),
            button("编辑", () => setActionEdit({ ...action }), { "aria-label": `编辑快捷操作 ${action.name}`, disabled: savingAction }),
            button(action.archived ? "恢复" : "归档", () => void saveActions(preferences.quickActions.map((entry) => entry.id === action.id ? { ...entry, archived: !action.archived } : entry)), { "aria-label": `${action.archived ? "恢复" : "归档"}快捷操作 ${action.name}`, disabled: savingAction }),
            button("移除", () => void saveActions(preferences.quickActions.filter((entry) => entry.id !== action.id)), { "aria-label": `移除快捷操作 ${action.name}`, disabled: sending || savingAction || !preferences.ready })))),
          actionEdit && h("div", { className: "ptb-quick-edit" },
            h("label", { className: "ptb-field" }, h("span", null, "编辑操作名称"), h("input", { value: actionEdit.name, disabled: savingAction, onChange: (event) => setActionEdit({ ...actionEdit, name: event.target.value }) })),
            h("label", { className: "ptb-field" }, h("span", null, "编辑操作正文"), h("textarea", { rows: 3, value: actionEdit.content, disabled: savingAction, onChange: (event) => setActionEdit({ ...actionEdit, content: event.target.value }) })),
            button("保存快捷操作", async () => {
              if (!actionEdit.name.trim() || !actionEdit.content.trim()) { setError("请填写快捷操作名称及正文。"); return; }
              if (await saveActions(preferences.quickActions.map((entry) => entry.id === actionEdit.id ? { ...entry, name: actionEdit.name.trim(), content: actionEdit.content.trim() } : entry))) setActionEdit(null);
            }, { disabled: savingAction }), button("取消编辑", () => setActionEdit(null), { disabled: savingAction })),
          h("label", { className: "ptb-field" }, h("span", null, "快捷操作名称"), h("input", { value: actionName, onChange: (event) => setActionName(event.target.value), disabled: sending || !preferences.ready })),
          button("将当前评论保存为快捷操作", async () => { const name = actionName.trim(); if (!name || !content.trim()) { setError("请填写快捷操作名称及评论内容。"); return; } if (await saveActions([...preferences.quickActions, { id: uid(), name, content }])) setActionName(""); }, { disabled: sending || savingAction || !preferences.ready })),
        (quoteSnapshot || quoteSource) && h("div", { className: "ptb-wide" }, h("blockquote", { className: "ptb-quote" }, h("span", { className: "ptb-quote-source" }, quoteSnapshot?.kind === "description" ? "引用需求" : quoteSnapshot?.kind === "criteria" ? "引用验收标准" : "引用评论"), quoteSnapshot?.text || quoteSource?.content.slice(0, 4000) || ""), button("取消引用", () => void updateDraft({ quoteSourceId: null, quoteSnapshot: null }), { disabled: sending || uploading })),
        reply && h("div", { className: "ptb-wide ptb-reply" }, h("span", null, `回复 ${reply.author}：${reply.content.slice(0, 100)}`), button("取消回复", () => setReplyTo(null), { disabled: sending || uploading }),
          reply.run && button("打开原会话继续", () => { void board.open(reply.run).catch((error) => setError(message(error))); }, { disabled: !reply.run.sessionId })),
        h("label", { className: "ptb-field ptb-wide" }, h("span", null, "定向 @"), h("select", { "aria-label": "定向提及 Agent", value: targetAgentId, disabled: sending || uploading, onChange: (event) => void updateDraft({ targetAgentId: event.target.value }) }, h("option", { value: "" }, "按正文或回复路由"), ...agents.filter((agent) => !agent.archived || agent.id === targetAgentId).map((agent) => h("option", { key: agent.id, value: agent.id }, `${avatarSymbol(agent)} @${agent.name}${agent.archived ? "（已归档）" : ""}`)))),
        h("label", { className: "ptb-field ptb-wide" }, h("span", null, "评论内容"), h("textarea", { className: "ptb-comment-composer", "aria-label": "评论内容", rows: 4, value: content, required: !files.length, disabled: sending || uploading || !preferences.ready, placeholder: "@Agent 第 3 条验收未通过，导出文件缺少金额列，请补齐并验证。", onChange: (event) => setContent(event.target.value) })),
        h(AttachmentPicker, { label: "评论", files, onChange: setFiles, disabled: sending || uploading, onBusy: setUploading }),
        h("p", { className: "ptb-wide ptb-muted", role: "status" }, trigger ? occupied ? "将交给 Agent；当前有运行，先保存为待处理评论，结束后可重试。" : (willResume ? "将交给 Agent，以这条评论为本轮重点，续接原生会话。" : "将交给 Agent，以这条评论为本轮重点，创建新的原生会话。") : "仅保存留言。回复 Agent 或输入 @Agent 可触发处理；/note 开头只记备注。"),
        error && h("p", { className: "ptb-wide ptb-error", role: "alert" }, error),
        h("div", { className: "ptb-wide ptb-actions" }, h("button", { type: "submit", className: "ptb-primary", disabled: sending || uploading || !preferences.ready }, sending ? "发送中…" : trigger ? "发送并交给 Agent" : "发表评论"))));
  }

  function SourceContext({ task, tasks }) {
    const context = sourceContext(task, tasks);
    if (!context) return h("details", null, h("summary", null, "查看拆分来源快照"), h("p", null, "无法解析来源快照，保留原文供核对。"), h("pre", { className: "ptb-content" }, task.sourceSnapshot));
    const { snapshot, source, changes } = context;
    const files = (items) => Array.isArray(items) && items.length > 0 && h("ul", null, ...items.map((file, index) => h("li", { key: index }, `${file?.name || "附件"} · ${file?.path || ""}`)));
    return h("details", { className: "ptb-source" }, h("summary", null, "查看拆分来源快照"),
      h("p", { role: "status" }, !snapshot.sourceTaskId ? "旧快照未记录来源标识，无法比较更新。" : !source ? "来源任务不可用，历史快照仍保留。" : changes.length ? "来源有更新" : "已捕获内容未变化"),
      changes.length > 0 && h("ul", null, ...changes.map((change, index) => h("li", { key: index }, change))),
      source && button("打开来源任务", () => openDetails(source)),
      h("h3", null, snapshot.title), h("h4", null, "当时的需求"), h("p", { className: "ptb-content" }, snapshot.description), files(snapshot.descriptionFiles),
      h("h4", null, "当时的验收标准"), h("p", { className: "ptb-content" }, snapshot.criteria), files(snapshot.criteriaFiles),
      h("h4", null, "当时的讨论"), ...snapshot.comments.map((entry) => h("article", { key: entry.id }, h("p", { className: "ptb-content" }, entry.content), files(entry.files))),
      h("p", { className: "ptb-muted" }, "对照仅包含已捕获文字和附件关联，不比较文件内容。"));
  }

  function TaskRelations({ task, tasks, act }) {
    const [originalId, setOriginalId] = useState("");
    const parent = tasks.find((entry) => entry.id === task.parentId);
    const original = tasks.find((entry) => entry.id === task.duplicateOf);
    const children = tasks.filter((entry) => entry.parentId === task.id);
    const duplicates = tasks.filter((entry) => entry.duplicateOf === task.id);
    return h("section", { "aria-label": "任务关系" },
      h("h2", null, "任务关系"),
      parent && h("p", null, "父任务：", button(parent.title, () => openDetails(parent))),
      h("div", { className: "ptb-actions" }, button("新建子任务", () => openEditor({ ...validateTask(task), title: "", description: "", descriptionFiles: [], parentId: task.id }))),
      h("p", { className: "ptb-muted" }, `子任务 ${children.filter((entry) => ["done", "cancelled"].includes(entry.status)).length}/${children.length} 已结束；各自独立验收。`),
      children.length > 0 && h("p", { className: "ptb-muted" }, Number.isFinite(activeStage(tasks, task.id)) ? `当前推进阶段 ${activeStage(tasks, task.id)}` : "全部阶段已结束"),
      ...children.map((child) => h("p", { key: child.id }, button(`${child.title} · 阶段 ${child.stage || 1} · ${STATUSES[child.status]}`, () => openDetails(child)))),
      task.sourceSnapshot && h(SourceContext, { task, tasks }),
      original ? h("div", { className: "ptb-banner" }, h("p", null, "重复于：", button(original.title, () => openDetails(original))), button("不是重复", () => void act(() => board.markDuplicate(task.id, null)))) :
        h("details", null, h("summary", null, "标记为重复任务"), h("div", { className: "ptb-actions" }, h("select", { "aria-label": "原始任务", value: originalId, onChange: (event) => setOriginalId(event.target.value) }, h("option", { value: "" }, "选择原始任务"), ...tasks.filter((entry) => entry.id !== task.id && !entry.duplicateOf).map((entry) => h("option", { key: entry.id, value: entry.id }, entry.title))), button("标记为重复", () => void act(() => board.markDuplicate(task.id, originalId)), { disabled: !originalId || task.status === "running" || task.recovery }))),
      ...duplicates.map((entry) => h("p", { key: entry.id }, "重复项：", button(entry.title, () => openDetails(entry)))));
  }

  function AttachmentSummary({ task, act }) {
    const [type, setType] = useState("");
    const items = taskAttachments(task);
    return h("details", { className: "ptb-file-summary" }, h("summary", null, `附件汇总 · ${items.length}`),
      h("select", { "aria-label": "附件类型", value: type, onChange: (event) => setType(event.target.value) }, ...[["", "全部类型"], ["image", "图片"], ["document", "文档"], ["video", "视频"], ["other", "其他"]].map(([value, label]) => h("option", { key: value, value }, label))),
      h("ul", { className: "ptb-attachments" }, ...items.filter((entry) => !type || entry.type === type).map((entry, index) => h("li", { key: `${entry.source}:${entry.path}:${index}` }, button(entry.name, () => void act(() => ctx.shell.revealPath(entry.path)), { title: entry.path }), h("span", { className: "ptb-muted" }, entry.source)))),
      h("p", { className: "ptb-muted" }, "按关联记录汇总本地文件；不保存历史文件内容，不推断 AI 未上传的产物。"));
  }

  function revealInTask(body, attribute, id) {
    const node = [...(body?.querySelectorAll(`[${attribute}]`) || [])].find((item) => item.getAttribute(attribute) === id);
    if (!node) throw new Error("来源不可用，原有记录已保留。");
    let parent = node.parentElement;
    while (parent && parent !== body) { if (parent.tagName === "DETAILS") parent.open = true; parent = parent.parentElement; }
    node.dispatchEvent(new window.Event("ptb-reveal", { bubbles: true }));
    requestAnimationFrame(() => { node.scrollIntoView?.({ block: "center" }); node.focus(); });
  }

  function StepHandoff({ task, projects, agents, disabled, act }) {
    const resources = useResources(task.id);
    const defaults = (step) => ({ step, engine: task.engine, model: task.model, providerId: task.providerId || "", instruction: step === "review" ? "审查前序成果，逐条核对验收标准，报告问题和验证依据。" : "完成需求中的修改并逐条验证验收标准。" });
    const [config, setConfig] = useState(task.stepConfigs?.implement || defaults("implement"));
    const stepDrafts = useRef({ ...task.stepConfigs });
    const panel = useRef(null);
    const chooseStep = (step) => { stepDrafts.current[config.step] = config; setConfig(stepDrafts.current[step] || defaults(step)); };
    const [catalog, setCatalog] = useState({ models: [], loading: true, error: "" });
    const [confirming, setConfirming] = useState(false);
    const [starting, setStarting] = useState(false);
    useEffect(() => {
      let alive = true;
      setCatalog({ models: [], loading: true, error: "" });
      loadModels(ctx, config.engine, task.workspacePath).then((models) => { if (alive) setCatalog({ models, loading: false, error: "" }); }, (error) => { if (alive) setCatalog({ models: [], loading: false, error: message(error) }); });
      return () => { alive = false; };
    }, [config.engine, task.workspacePath]);
    useEffect(() => { setConfirming(false); }, [task, projects, config]);
    const project = projects.find((entry) => entry.workspacePath === task.workspacePath && entry.name === task.project);
    const pendingComment = (task.comments || []).filter((entry) => entry.triggerAgent && !entry.resolvedAt).at(-1)?.id || null;
    const previewConfig = { ...config, instruction: config.instruction.trim() };
    const preview = buildPrompt({ ...task, ...previewConfig }, pendingComment, project?.description || "") + resourcePrompt(normalizeProjectResources(project?.resources)) + stepPrompt(task, previewConfig) + agentPrompt(agents.find((agent) => agent.id === (task.comments?.find((entry) => entry.id === pendingComment)?.targetAgentId || task.assigneeId))) + methodContext(board.getSnapshot().methods.filter((method) => !method.archived && agents.find((agent) => agent.id === (task.comments?.find((entry) => entry.id === pendingComment)?.targetAgentId || task.assigneeId))?.methodIds?.includes(method.id)));
    const locked = disabled || starting;
    return h("section", { "aria-label": "手动分步交接" },
      button("交给审查", () => { chooseStep("review"); if (panel.current) panel.current.open = true; }, { disabled: locked || !["todo", "blocked", "review"].includes(task.status) || task.runs.at(-1)?.outcome !== "ended" }),
      h("details", { ref: panel }, h("summary", null, "分步处理"),
      h("label", { className: "ptb-field" }, h("span", null, "处理步骤"), h("select", { value: config.step, disabled: locked, onChange: (event) => chooseStep(event.target.value) }, h("option", { value: "implement" }, "实现"), h("option", { value: "review" }, "审查"))),
      h("label", { className: "ptb-field" }, h("span", null, "步骤引擎"), h("select", { value: config.engine, disabled: locked || resources.loading, onChange: (event) => setConfig({ ...config, engine: event.target.value, model: "", providerId: "" }) }, ...resources.engines.map((entry) => h("option", { key: entry.id, value: entry.id }, entry.id)), !resources.engines.some((entry) => entry.id === config.engine) && h("option", { value: config.engine }, `${config.engine}（不可用）`))),
      h("label", { className: "ptb-field" }, h("span", null, "步骤模型"), h("select", { value: config.model ? JSON.stringify([config.providerId, config.model]) : "", disabled: locked || catalog.loading, onChange: (event) => { const [providerId, model] = event.target.value ? JSON.parse(event.target.value) : ["", ""]; setConfig({ ...config, providerId, model }); } }, h("option", { value: "" }, "使用宿主默认模型"), ...catalog.models.map((entry) => h("option", { key: entry.key, value: entry.key }, entry.label)), config.model && !catalog.models.some((entry) => entry.id === config.model && entry.providerId === config.providerId) && h("option", { value: JSON.stringify([config.providerId, config.model]) }, `${config.model}（未在列表中）`))),
      h("label", { className: "ptb-field" }, h("span", null, "步骤说明"), h("textarea", { value: config.instruction, rows: 3, disabled: locked, onChange: (event) => setConfig({ ...config, instruction: event.target.value }) })),
      (catalog.error || resources.error) && h("p", { role: "alert" }, catalog.error || resources.error),
      button("预览交接", () => setConfirming(true), { disabled: locked || catalog.loading || !config.instruction.trim() || !["todo", "blocked", "review"].includes(task.status) || (config.step === "review" && task.runs.at(-1)?.outcome !== "ended") }),
      confirming && h("section", { "aria-label": "交接确认" }, h("p", null, `${config.step === "review" ? "审查" : "实现"} · ${config.engine} · ${config.model || "宿主默认模型"} · ${task.workspacePath}`), h("pre", { className: "ptb-content" }, preview),
        button("确认开始此步骤", () => void act(async () => { setStarting(true); try { await board.start(task.id, null, null, config); setConfirming(false); } finally { setStarting(false); } }), { disabled: locked }), button("取消交接", () => setConfirming(false), { disabled: starting }))));
  }

  function Deliverables({ task, body, act, disabled }) {
    const [files, setFiles] = useState([]);
    const [existing, setExisting] = useState("");
    const [runId, setRunId] = useState("");
    const [busy, setBusy] = useState(false);
    const items = taskAttachments(task);
    return h("details", { open: true }, h("summary", null, `交付物 · ${(task.deliverables || []).length}`),
      h("p", { className: "ptb-muted" }, "登记本地文件关联，不保存历史文件内容；移除登记不删除文件。"),
      ...(task.deliverables || []).map((entry) => h("article", { key: entry.id, tabIndex: -1, "data-deliverable-id": entry.id, className: "ptb-run" },
        button(entry.file.name, () => void act(() => ctx.shell.revealPath(entry.file.path)), { title: entry.file.path }),
        h("time", null, new Date(entry.createdAt).toLocaleString("zh-CN")),
        entry.commentId && button("定位来源评论", () => void act(() => revealInTask(body.current, "data-comment-id", entry.commentId))),
        entry.runId && button("定位关联运行", () => void act(() => revealInTask(body.current, "data-run-id", entry.runId))),
        button("移除登记", () => void act(() => board.removeDeliverable(task.id, entry.id)), { disabled: disabled || busy }))),
      h("select", { "aria-label": "已有附件登记为成果", value: existing, disabled: disabled || busy, onChange: (event) => { setExisting(event.target.value); setFiles([]); } }, h("option", { value: "" }, "选择已有附件"), ...items.map((file, index) => h("option", { key: index, value: String(index) }, `${file.source} · ${file.name} · ${file.path}`))),
      h(AttachmentPicker, { label: "交付物", files, disabled: disabled || busy, onBusy: setBusy, onChange: (next) => { setFiles(next); setExisting(""); } }),
      h("select", { "aria-label": "交付物关联运行", value: runId, disabled: disabled || busy, onChange: (event) => setRunId(event.target.value) }, h("option", { value: "" }, "不关联运行"), ...task.runs.map((run) => h("option", { key: run.id, value: run.id }, `${new Date(run.startedAt).toLocaleString("zh-CN")} · ${OUTCOMES[run.outcome]}`))),
      button("登记交付物", () => void act(async () => {
        setBusy(true);
        try {
          await board.addDeliverables(task.id, (existing !== "" ? [items[Number(existing)]] : files).map((file) => ({ file, runId, commentId: existing !== "" ? file.commentId : null })));
          setExisting(""); setFiles([]); setRunId("");
        } finally { setBusy(false); }
      }), { disabled: disabled || busy || (existing === "" && !files.length) }));
  }

  function TaskHistory({ task, body, act }) {
    return h("details", null, h("summary", null, "执行与验收时间线"), h("ol", null, ...taskHistory(task).map((entry) => h("li", { key: entry.id },
      h("time", null, new Date(entry.at).toLocaleString("zh-CN")), " · ", entry.label, " ",
      entry.commentId && button("查看评论", () => void act(() => revealInTask(body.current, "data-comment-id", entry.commentId))),
      entry.feedbackId && button("查看反馈", () => void act(() => revealInTask(body.current, "data-feedback-id", entry.feedbackId))),
      entry.deliverableId && button("查看交付物", () => void act(() => revealInTask(body.current, "data-deliverable-id", entry.deliverableId))),
      entry.previousRunId && button("查看前序运行", () => void act(() => revealInTask(body.current, "data-run-id", entry.previousRunId))),
      entry.runId && button("查看运行", () => void act(() => revealInTask(body.current, "data-run-id", entry.runId)))))));
  }

  function TaskFind({ task, body }) {
    const [query, setQuery] = useState("");
    const [index, setIndex] = useState(0);
    const [matches, setMatches] = useState([]);
    const input = useRef(null);
    const highlightName = useRef(`ptb-find-${uid()}`).current;
    useEffect(() => {
      const term = query.trim();
      const found = [];
      if (term) for (const node of body.current?.querySelectorAll("[data-task-search]") || []) {
        const pattern = new RegExp([...term].map((char) => "^$\\.*+?()[]{}|".includes(char) ? `\\${char}` : char).join(""), "giu");
        for (const match of node.textContent.matchAll(pattern)) found.push({ node, offset: match.index, length: match[0].length });
      }
      setMatches(found); setIndex(0);
    }, [query, task]);
    useEffect(() => {
      const match = matches[index];
      if (!match) return;
      let parent = match.node.parentElement;
      while (parent && parent !== body.current) { if (parent.tagName === "DETAILS") parent.open = true; parent = parent.parentElement; }
      match.node.dispatchEvent(new window.CustomEvent("ptb-reveal", { bubbles: true, detail: { focus: false } }));
      match.node.scrollIntoView?.({ block: "center" });
      match.node.setAttribute("data-find-active", "true");
      const registry = window.CSS?.highlights;
      if (registry && window.Highlight && match.node.firstChild?.nodeType === 3) {
        const range = document.createRange();
        range.setStart(match.node.firstChild, match.offset); range.setEnd(match.node.firstChild, match.offset + match.length);
        registry.set(highlightName, new window.Highlight(range));
        const rect = range.getBoundingClientRect?.();
        if (rect?.height) {
          let scroller = match.node.parentElement;
          while (scroller && body.current.closest(".ptb-root")?.contains(scroller)) {
            const overflow = window.getComputedStyle(scroller).overflowY;
            if (["auto", "scroll"].includes(overflow) && scroller.scrollHeight > scroller.clientHeight) {
              const bounds = scroller.getBoundingClientRect();
              scroller.scrollTop += rect.top + rect.height / 2 - bounds.top - scroller.clientHeight / 2;
              break;
            }
            scroller = scroller.parentElement;
          }
        }
      }
      return () => { match.node.removeAttribute("data-find-active"); registry?.delete(highlightName); };
    }, [matches, index, highlightName]);
    const move = (delta) => { if (matches.length) setIndex((current) => (current + delta + matches.length) % matches.length); };
    return h("div", { className: "ptb-actions", role: "search", "aria-label": "任务内搜索", onKeyDown: (event) => {
      if (event.isComposing || event.nativeEvent?.isComposing) return;
      if (event.key === "Escape") { event.stopPropagation(); setQuery(""); input.current?.focus(); }
      if (event.key === "Enter" && event.target === input.current) { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
    } },
      h("style", null, `::highlight(${highlightName}) { background: #ffe08a; color: #242424; }`),
      h("input", { ref: input, type: "search", "aria-label": "查找任务内容", placeholder: "查找需求、评论和反馈", value: query, onChange: (event) => setQuery(event.target.value) }),
      h("span", { role: "status", "aria-live": "polite" }, query.trim() ? matches.length ? `${index + 1} / ${matches.length}` : "无匹配结果" : ""),
      button("上一个匹配", () => move(-1), { disabled: !matches.length }),
      button("下一个匹配", () => move(1), { disabled: !matches.length }),
      button("清除查找", () => { setQuery(""); input.current?.focus(); }, { disabled: !query }));
  }

  function TaskDetails({ taskId = null, onClose = null } = {}) {
    const state = useSyncExternalStore(board.subscribe, board.getSnapshot);
    const request = useSyncExternalStore(detailStore.subscribe, detailStore.getSnapshot);
    const body = useRef(null);
    const task = state.tasks.find((entry) => entry.id === (taskId || request?.taskId));
    const [activeTab, setActiveTab] = useState("requirements");
    const revealTarget = useRef(null);
    const tabPrefix = useRef(`ptb-detail-${uid()}`).current;
    useEffect(() => { setActiveTab(request?.runId && !taskId ? "runs" : "requirements"); }, [task?.id, request?.runId, taskId]);
    useEffect(() => {
      const element = body.current;
      const reveal = (event) => {
        const pane = event.target.closest("[data-detail-pane]");
        if (!pane) return;
        revealTarget.current = pane.hidden ? { node: event.target, focus: event.detail?.focus !== false } : null;
        pane.hidden = false;
        setActiveTab(pane.dataset.detailPane);
      };
      element?.addEventListener("ptb-reveal", reveal);
      return () => element?.removeEventListener("ptb-reveal", reveal);
    }, [task?.id]);
    useEffect(() => {
      const target = revealTarget.current;
      if (target) { target.node.scrollIntoView?.({ block: "center" }); if (target.focus) target.node.focus(); revealTarget.current = null; }
    }, [activeTab]);
    const latest = task?.runs.at(-1);
    const locked = state.busy || !state.ready;
    const pane = (key, label) => ({ id: `${tabPrefix}-${key}`, role: "tabpanel", "aria-label": label, "aria-labelledby": `${tabPrefix}-tab-${key}`, "data-detail-pane": key, hidden: activeTab !== key });
    const [error, setError] = useState("");
    const act = async (operation) => { setError(""); try { await operation(); } catch (error) { setError(message(error)); } };
    const files = (items) => h("ul", { className: "ptb-attachments" }, ...(items || []).map((file) => h("li", { key: file.path }, button(file.name, () => void act(() => ctx.shell.revealPath(file.path)), { title: file.path }))));
    return h("section", { className: "ptb-root ptb-detail", "aria-label": "任务详情" }, h("style", null, CSS),
      h("header", { className: "ptb-header" }, h("h1", null, task?.title || "任务详情"), onClose ? button("关闭预览", onClose) : button("返回看板", () => ctx.ui.openCenterTab("board"))),
      error && h("p", { role: "alert", className: "ptb-error" }, error),
      !task ? h("p", null, "请从任务卡片打开详情。") : h("div", { ref: body, className: "ptb-detail-body" },
        h(TaskFind, { key: `find:${task.id}`, task, body }),
        h("div", { className: "ptb-detail-summary" },
          h("div", { className: "ptb-actions" }, h("span", { className: "ptb-status-pill" }, STATUSES[task.status]), h("span", null, `${PRIORITIES[task.priority]}优先级`), task.project && h("span", null, task.project)),
          task.tags?.length > 0 && h("p", { className: "ptb-muted" }, task.tags.join(" · "))),
        h("section", { className: "ptb-review-hub", "aria-label": "执行与验收" },
          h("div", null, h("h2", null, task.recovery ? "请先核对会话状态" : task.status === "review" ? "本轮已结束，等待你的验收" : STATUSES[task.status]),
            latest && h("p", { className: "ptb-muted" }, `${latest.engine} · ${latest.model || "宿主默认模型"} · ${OUTCOMES[latest.outcome]}`),
            task.recovery && h("p", null, "打开原生会话核对运行状态后，再解除占用。")),
          h("div", { className: "ptb-actions" },
            latest && button("打开本轮会话", () => void act(() => board.open(latest)), { disabled: locked || !latest.sessionId }),
            task.status === "review" && !task.recovery && button("验收通过", () => void act(() => board.setStatus(task.id, "done")), { disabled: locked, className: "ptb-primary" }),
            !task.recovery && (task.status === "review" || (task.status === "todo" && task.pendingFeedbackIds?.length > 0)) && button(task.status === "review" ? "验收不通过" : "补充反馈", () => openFeedback(task), { disabled: locked }),
            task.status === "running" && button(latest?.stopRequested ? "已请求停止" : "停止执行", () => void act(() => board.stop(task.id)), { disabled: locked || latest?.stopRequested }),
            task.recovery && button("已核对会话结束", () => void act(() => board.acknowledge(task.id)), { disabled: locked }))),
        h("div", { className: "ptb-detail-layout" },
          h("main", { className: "ptb-detail-main" },
            h("div", { className: "ptb-detail-tabs", role: "tablist", "aria-label": "详情分区", onKeyDown: (event) => {
              const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
              const index = tabs.indexOf(event.target);
              if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = tabs[event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
              next.click(); next.focus();
            } }, ...[["requirements", "需求与验收"], ["comments", `讨论 · ${task.comments?.length || 0}`], ["runs", `执行记录 · ${task.runs.length}`]].map(([key, label]) => button(label, () => setActiveTab(key), { key, role: "tab", id: `${tabPrefix}-tab-${key}`, "aria-controls": `${tabPrefix}-${key}`, "aria-selected": activeTab === key, tabIndex: activeTab === key ? 0 : -1 }))),
            h("section", pane("requirements", "需求与验收"),
        h("h2", null, "原始任务清单"), button("编辑任务", () => openEditor(task), { disabled: task.status === "running" || task.recovery }),
        h("h3", null, "需求"), h(SelectableText, { task, kind: "description", sourceId: task.id, text: task.description }), files(task.descriptionFiles),
        h("h3", null, "验收标准"), h(SelectableText, { task, kind: "criteria", sourceId: task.id, text: task.criteria }), files(task.criteriaFiles),

              h(Deliverables, { key: `deliverables:${task.id}`, task, body, act, disabled: state.busy })),
            h("section", pane("comments", "讨论"),
        h(TaskComments, { key: `comments:${task.id}`, task, occupied: state.busy || state.tasks.some((entry) => entry.status === "running" || entry.recovery) })),
            h("section", pane("runs", "执行记录"),
        h("h2", null, "验收反馈"), !(task.feedbacks || []).length && h("p", null, "暂无反馈"), ...(task.feedbacks || []).map((entry) => h("article", { className: "ptb-run", key: entry.id, tabIndex: -1, "data-feedback-id": entry.id }, h("p", null, `${new Date(entry.createdAt).toLocaleString("zh-CN")} · ${entry.resolvedAt ? "已通过复验" : "未通过"}`), h("p", { className: "ptb-content", tabIndex: -1, "data-task-search": "" }, entry.content), files(entry.files))),

        h("h2", null, "历次执行与输入"), !task.runs.length && h("p", null, "暂无执行"), ...task.runs.slice().reverse().map((run) => h("article", { className: "ptb-run", key: run.id, tabIndex: -1, "data-run-id": run.id },
          h("h3", null, `${new Date(run.startedAt).toLocaleString("zh-CN")} · ${OUTCOMES[run.outcome]}`),
          h("p", null, `${run.step === "review" ? "审查 · " : run.step === "implement" ? "实现 · " : ""}${run.engine} · ${run.model || "宿主默认模型"}${run.providerId ? ` · 渠道 ${run.providerId}` : ""} · ${run.workspacePath}`),
          run.agentSnapshot && h("p", { className: "ptb-muted ptb-agent-identity" }, h(AgentAvatar, { agent: run.agentSnapshot }), `执行 Agent：${run.agentSnapshot.name}`),
          run.retryOf && h("p", { className: "ptb-muted" }, "历史输入重试 · 新会话"),
          run.previousRunId && button("查看前序运行", () => void act(() => revealInTask(body.current, "data-run-id", run.previousRunId))),
          run.sourceDeliverables?.length > 0 && h("details", null, h("summary", null, `交接时的成果清单 · ${run.sourceDeliverables.length}`), files(run.sourceDeliverables.map((entry) => entry.file))),
          ["error", "stopped"].includes(run.outcome) && h("details", { className: "ptb-retry", "aria-label": "历史轮次重试" }, h("summary", null, "按此轮输入重试"),
            run.input ? h("div", null,
              h("p", null, "使用本轮记录的输入、工作区、引擎、模型和渠道创建新会话，不包含之后新增的需求或反馈。附件按原路径读取当前文件；模型留空时使用宿主当前默认模型。"),
              h("pre", { className: "ptb-content" }, run.input.prompt),
              button("确认按历史输入重试", () => void act(() => board.start(task.id, null, run.id)), { disabled: state.busy || state.tasks.some((entry) => entry.status === "running" || entry.recovery) || !["todo", "blocked", "review"].includes(task.status) || Boolean(task.duplicateOf) })) : h("p", null, "旧轮次缺少输入快照，无法按历史输入重试。")),
          button("打开本轮会话", () => void act(() => board.open(run)), { disabled: !run.sessionId }),
          h("details", { "aria-label": "执行日志" }, h("summary", null, `执行日志 · ${(run.runtimeEvents || []).length}`), h("p", { className: "ptb-muted" }, run.logCapability === "observing" ? "仅回放宿主已捕获事件，不重新执行命令；不保证完整工具输入输出，重启或断连期间可能缺失。" : "此轮未启用宿主事件采集；请打开原生会话查看。"), run.logTruncated && h("p", { role: "status" }, "日志达到2000条上限，后续事件未保存。"), ...[...(run.runtimeEvents || [])].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((event) => h("pre", { key: event.eventId, className: "ptb-content" }, JSON.stringify(event, null, 2)))),
          run.methodSnapshots?.length > 0 && h("details", null, h("summary", null, "当轮共享方法"), h("pre", { className: "ptb-content" }, methodContext(run.methodSnapshots))),
          run.error && h("p", { className: "ptb-error" }, run.error),
          h("details", { open: request?.runId === run.id }, h("summary", null, "查看本轮执行输入"), run.input ? h("pre", { className: "ptb-content" }, run.input.prompt) : h("p", null, "旧轮次未记录输入快照。")))))),
          h("aside", { className: "ptb-detail-sidebar", "aria-label": "任务属性与关联" },
            h("h2", null, "任务属性"),
        h("div", { className: "ptb-agent-identity" }, task.assigneeId && h(AgentAvatar, { agent: state.agents.find((agent) => agent.id === task.assigneeId) }),
        h("label", { className: "ptb-field ptb-assignee-field" }, h("span", null, "任务负责人"), h("select", { "aria-label": "任务负责人", value: task.assigneeId || "", disabled: task.status === "running" || task.recovery, onChange: (event) => void act(() => board.assignAgent(task.id, event.target.value)) }, h("option", { value: "" }, "我"), ...state.agents.filter((agent) => !agent.archived || agent.id === task.assigneeId).map((agent) => h("option", { key: agent.id, value: agent.id }, `${avatarSymbol(agent)} ${agent.name}${agent.archived ? "（已归档）" : ""}`))))),

            h("dl", { className: "ptb-detail-properties" }, ...[["工作区", task.workspacePath], ["项目", task.project], ["执行引擎", task.engine], ["模型", task.model || "宿主默认模型"], ["开始日期", task.startDate], ["截止日期", task.dueDate ? `${task.dueDate}${isOverdue(task) ? "（已逾期）" : ""}` : ""]].filter(([, value]) => value).map(([label, value]) => h("div", { key: label }, h("dt", null, label), h("dd", null, value)))),
        h(TaskRelations, { key: `relations:${task.id}`, task, tasks: state.tasks, act }),

        h(AttachmentSummary, { key: `files:${task.id}`, task, act }),
        h(TaskHistory, { task, body, act }),
        h(SquadDispatch, { key: `squad:${task.id}`, task, squads: state.squads, agents: state.agents, act, disabled: state.busy || state.tasks.some((entry) => entry.status === "running" || entry.recovery) || !["todo", "review", "blocked"].includes(task.status) || Boolean(task.duplicateOf) }),
        h(StepHandoff, { key: `step:${task.id}`, task, projects: state.projects, agents: state.agents, act, disabled: state.busy || state.tasks.some((entry) => entry.status === "running" || entry.recovery) || Boolean(task.duplicateOf) }),
        task.project && h("details", null, h("summary", null, "下一轮项目上下文"), h("pre", { className: "ptb-content" }, (() => { const project = state.projects.find((entry) => entry.workspacePath === task.workspacePath && entry.name === task.project); return (project?.description || "") + resourcePrompt(normalizeProjectResources(project?.resources)); })()))))));
  }

  function TaskPreview({ task, tasks, onSelect, onClose }) {
    const panel = useRef(null);
    const opener = useRef(null);
    const index = tasks.findIndex((entry) => entry.id === task.id);
    useEffect(() => {
      opener.current = document.activeElement;
      panel.current?.focus();
      return () => { if (opener.current?.isConnected) opener.current.focus(); };
    }, []);
    return h("aside", { ref: panel, tabIndex: -1, className: "ptb-preview", "aria-label": "任务侧边预览", onKeyDown: (event) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
      if (event.isComposing || event.nativeEvent?.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.target.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])")) return;
      const next = ["ArrowUp", "k", "K"].includes(event.key) ? index - 1 : ["ArrowDown", "j", "J"].includes(event.key) ? index + 1 : -1;
      if (next >= 0 && next < tasks.length) { event.preventDefault(); onSelect(tasks[next].id); }
    } },
      h("div", { className: "ptb-actions ptb-preview-nav" }, button("上一项", () => onSelect(tasks[index - 1].id), { disabled: index <= 0 }), button("下一项", () => onSelect(tasks[index + 1].id), { disabled: index < 0 || index >= tasks.length - 1 }), button("完整详情", () => openDetails(task))),
      h(TaskDetails, { key: task.id, taskId: task.id, onClose }));
  }

  function InlineField({ task, field, disabled }) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const label = { title: "标题", priority: "优先级", dueDate: "截止日期" }[field];
    if (!editing) return button(field === "title" ? "改标题" : field === "priority" ? PRIORITIES[task[field]] : task[field] || "—", () => { setValue(task[field] || ""); setError(""); setEditing(true); }, { disabled, className: "ptb-inline-trigger", "aria-label": `编辑${task.title}的${label}` });
    async function save(event) {
      event.preventDefault();
      if (saving) return;
      setSaving(true); setError("");
      try { await board.editFields(task.id, { [field]: value }); setEditing(false); }
      catch (error) { setError(message(error)); }
      finally { setSaving(false); }
    }
    const props = { "aria-label": `修改${label}`, value, disabled: saving || disabled, autoFocus: true, onChange: (event) => setValue(event.target.value) };
    return h("form", { className: "ptb-inline-form", onSubmit: save, onKeyDown: (event) => { if (event.key === "Escape" && !saving) { event.stopPropagation(); setEditing(false); } } },
      field === "priority" ? h("select", props, ...Object.entries(PRIORITIES).map(([key, text]) => h("option", { key, value: key }, text))) : h("input", { ...props, type: field === "dueDate" ? "date" : "text" }),
      h("button", { type: "submit", disabled: saving || disabled }, saving ? "保存中…" : "保存"),
      button("取消", () => setEditing(false), { type: "button", disabled: saving }),
      error && h("span", { role: "alert", className: "ptb-error" }, error));
  }

  function AgentAvatar({ agent }) {
    return h("span", { className: "ptb-agent-avatar", "aria-hidden": true, "data-avatar": agent?.avatar || "robot" }, avatarSymbol(agent));
  }

  function SettingsCollection({ title, entries, selectedId, onSelect, onCreate, createLabel, saving, avatars = false, children }) {
    return h("div", { className: "ptb-settings-collection" },
      h("aside", { className: "ptb-settings-list", "aria-label": `${title}列表` },
        h("header", null, h("h2", null, `${title} (${entries.length})`), button(createLabel, onCreate, { disabled: saving })),
        h("div", { className: "ptb-settings-items" }, ...entries.map((entry) => button(h("span", { className: "ptb-settings-item-content" }, avatars && h(AgentAvatar, { agent: entry }), h("span", null, h("strong", null, entry.name), entry.summary && h("small", null, entry.summary))), () => onSelect(entry), { key: entry.id, disabled: saving, className: "ptb-settings-item", "aria-label": entry.name, "aria-pressed": selectedId === entry.id })),
          !entries.length && h("p", { className: "ptb-settings-empty" }, "暂无配置，点击上方按钮新建。"))),
      h("section", { className: "ptb-settings-editor", "aria-label": `${title}编辑` }, children));
  }

  function MethodManager({ methods, disabled }) {
    const [draft, setDraft] = useState(methods[0] || { name: "", content: "", archived: false });
    const [id, setId] = useState(methods[0]?.id || null), [error, setError] = useState(""), [saving, setSaving] = useState(false);
    return h(SettingsCollection, { title: "共享方法", entries: methods.map((entry) => ({ ...entry, summary: entry.archived ? "已停用" : "可供 Agent 绑定" })), selectedId: id, saving,
      onSelect: (entry) => { setDraft(methods.find((method) => method.id === entry.id)); setId(entry.id); setError(""); }, onCreate: () => { setDraft({ name: "", content: "", archived: false }); setId(null); setError(""); }, createLabel: "新建共享方法" },
      h("header", { className: "ptb-settings-editor-heading" }, h("h2", null, id ? "编辑共享方法" : "新建共享方法")),
      h("div", { className: "ptb-settings-fields" },
      h("label", { className: "ptb-field" }, h("span", null, "方法名称"), h("input", { value: draft.name, disabled: saving, onChange: (event) => setDraft({ ...draft, name: event.target.value }) })),
      h("label", { className: "ptb-field ptb-wide" }, h("span", null, "方法正文"), h("textarea", { value: draft.content, rows: 6, disabled: saving, onChange: (event) => setDraft({ ...draft, content: event.target.value }) })),
      h("label", { className: "ptb-settings-check ptb-wide" }, h("input", { type: "checkbox", checked: draft.archived === true, disabled: saving, onChange: (event) => setDraft({ ...draft, archived: event.target.checked }) }), "停用方法"),
      h("p", { className: "ptb-muted ptb-wide" }, "文本方法绑定后随执行注入，不安装原生技能包或自动运行脚本。")),
      h("footer", { className: "ptb-settings-save" },
      button("保存共享方法", async () => { setSaving(true); setError(""); try { await board.saveMethod(draft, id); setDraft({ name: "", content: "", archived: false }); setId(null); } catch (error) { setError(message(error)); } finally { setSaving(false); } }, { disabled: disabled || saving, className: "ptb-primary" })), error && h("p", { role: "alert", className: "ptb-error" }, error));
  }

  function SquadManager({ agents, squads, disabled }) {
    const empty = { name: "", leaderId: "", memberIds: [], instruction: "" };
    const [draft, setDraft] = useState(squads[0] || empty), [id, setId] = useState(squads[0]?.id || null), [error, setError] = useState(""), [saving, setSaving] = useState(false);
    return h(SettingsCollection, { title: "小队", entries: squads.map((entry) => ({ ...entry, summary: `${entry.memberIds.length} 位成员 · ${agents.find((agent) => agent.id === entry.leaderId)?.name || "队长不可用"}` })), selectedId: id, saving,
      onSelect: (entry) => { setDraft(squads.find((squad) => squad.id === entry.id)); setId(entry.id); setError(""); }, onCreate: () => { setDraft(empty); setId(null); setError(""); }, createLabel: "新建小队" },
      h("header", { className: "ptb-settings-editor-heading" }, h("h2", null, id ? "编辑小队" : "新建小队")),
      h("div", { className: "ptb-settings-fields" },
      h("label", { className: "ptb-field" }, h("span", null, "小队名称"), h("input", { value: draft.name, disabled: saving, onChange: (event) => setDraft({ ...draft, name: event.target.value }) })),
      h("label", { className: "ptb-field" }, h("span", null, "小队队长"), h("select", { value: draft.leaderId, disabled: saving, onChange: (event) => setDraft({ ...draft, leaderId: event.target.value, memberIds: [...new Set([...draft.memberIds, event.target.value])].filter(Boolean) }) }, h("option", { value: "" }, "选择队长"), ...agents.filter((agent) => !agent.archived).map((agent) => h("option", { key: agent.id, value: agent.id }, agent.name)))),
      h("fieldset", { className: "ptb-settings-options ptb-wide" }, h("legend", null, "小队成员"), ...agents.filter((agent) => !agent.archived).map((agent) => h("label", { key: agent.id }, h("input", { type: "checkbox", checked: draft.memberIds.includes(agent.id), disabled: saving || draft.leaderId === agent.id, onChange: (event) => setDraft({ ...draft, memberIds: event.target.checked ? [...draft.memberIds, agent.id] : draft.memberIds.filter((id) => id !== agent.id) }) }), agent.name))),
      h("label", { className: "ptb-field ptb-wide" }, h("span", null, "小队指令"), h("textarea", { value: draft.instruction, disabled: saving, onChange: (event) => setDraft({ ...draft, instruction: event.target.value }) }))),
      h("footer", { className: "ptb-settings-save" }, button("保存小队", async () => { setSaving(true); setError(""); try { await board.saveSquad(draft, id); setDraft(empty); setId(null); } catch (error) { setError(message(error)); } finally { setSaving(false); } }, { disabled: disabled || saving, className: "ptb-primary" })), error && h("p", { role: "alert", className: "ptb-error" }, error));
  }

  function SquadDispatch({ task, squads, agents, disabled, act }) {
    const [squadId, setSquadId] = useState(""), [agentId, setAgentId] = useState(""), [instruction, setInstruction] = useState(""), [confirm, setConfirm] = useState(null), [busy, setBusy] = useState(false);
    const squad = squads.find((entry) => entry.id === squadId);
    const leader = task.runs.at(-1);
    useEffect(() => { setConfirm(null); }, [task, squadId, instruction, agentId]);
    const perform = (operation) => void act(async () => { setBusy(true); try { await operation(); setConfirm(null); } finally { setBusy(false); } });
    return h("details", null, h("summary", null, "小队派活"),
      h("p", { className: "ptb-muted" }, "先让队长提出建议，再从原生会话核对并登记提案；每项派活须人工确认，不自动读取或执行模型建议。"),
      h("select", { "aria-label": "协调小队", value: squadId, disabled: disabled || busy, onChange: (event) => { setSquadId(event.target.value); setAgentId(""); } }, h("option", { value: "" }, "选择小队"), ...squads.map((entry) => h("option", { key: entry.id, value: entry.id }, entry.name))),
      button("预览队长协调", () => setConfirm({ kind: "leader" }), { disabled: disabled || busy || !squad }),
      h("select", { "aria-label": "派活成员", value: agentId, disabled: disabled || busy, onChange: (event) => setAgentId(event.target.value) }, h("option", { value: "" }, "选择成员"), ...agents.filter((agent) => !agent.archived && squad?.memberIds.includes(agent.id)).map((agent) => h("option", { key: agent.id, value: agent.id }, agent.name))),
      h("label", { className: "ptb-field" }, h("span", null, "核对后的派活说明"), h("textarea", { value: instruction, disabled: disabled || busy, onChange: (event) => setInstruction(event.target.value) })),
      button("登记派活提案", () => perform(async () => { await board.saveProposal(task.id, squadId, leader?.id, agentId, instruction); setInstruction(""); }), { disabled: disabled || busy || !agentId || !instruction.trim() || leader?.coordination?.kind !== "leader" || leader?.outcome !== "ended" || leader?.coordination?.squadId !== squadId }),
      ...(task.proposals || []).map((proposal) => h("article", { key: proposal.id, className: "ptb-run" }, h("p", null, `${agents.find((agent) => agent.id === proposal.agentId)?.name || "历史成员"} · ${proposal.status === "pending" ? "待确认" : "已派活"}`), h("p", { className: "ptb-content" }, proposal.instruction), button("预览并确认派活", () => setConfirm({ kind: "member", proposal }), { disabled: disabled || busy || proposal.status !== "pending" || task.runs.at(-1)?.id !== proposal.leaderRunId }))),
      confirm && h("section", { "aria-label": "小队派活确认" }, (() => { try { const preview = coordinationPreview(board.getSnapshot(), task, confirm.kind === "leader" ? squadCoordination(board.getSnapshot(), squadId) : memberCoordination(confirm.proposal)); return h("div", null, h("p", null, preview.config), h("pre", { className: "ptb-content" }, preview.prompt)); } catch (error) { return h("p", { role: "alert" }, message(error)); } })(),
        button("确认小队执行", () => perform(() => confirm.kind === "leader" ? board.startSquadLeader(task.id, squadId) : board.dispatchProposal(task.id, confirm.proposal.id)), { disabled: disabled || busy }), button("取消小队执行", () => setConfirm(null), { disabled: busy })));
  }

  function AgentManager({ agents, methods, disabled }) {
    const empty = { name: "", instruction: "", engine: "codex", model: "", providerId: "", workspacePath: "", methodIds: [], archived: false, avatar: "robot" };
    const [draft, setDraft] = useState(agents[0] || empty);
    const [id, setId] = useState(agents[0]?.id || null);
    const resources = useResources(0);
    const [models, setModels] = useState([]);
    useEffect(() => { let alive = true; loadModels(ctx, draft.engine, draft.workspacePath || resources.workspaces[0]?.path || "").then((items) => { if (alive) setModels(items); }, () => { if (alive) setModels([]); }); return () => { alive = false; }; }, [draft.engine, draft.workspacePath, resources.workspaces]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    return h(SettingsCollection, { title: "Agent", avatars: true, entries: agents.map((agent) => ({ ...agent, summary: agent.archived ? "已归档" : `${agent.engine} · ${agent.model || "宿主默认模型"}` })), selectedId: id, saving,
      onSelect: (agent) => { setDraft(agents.find((entry) => entry.id === agent.id)); setId(agent.id); setError(""); }, onCreate: () => { setDraft(empty); setId(null); setError(""); }, createLabel: "新建 Agent" },
      h("header", { className: "ptb-settings-editor-heading" }, h("div", { className: "ptb-agent-identity" }, h(AgentAvatar, { agent: draft }), h("h2", null, id ? "编辑 Agent" : "新建 Agent"))),
      h("div", { className: "ptb-settings-fields" },
      h("fieldset", { className: "ptb-avatar-picker ptb-wide" }, h("legend", null, "成员头像"), ...Object.entries(AGENT_AVATARS).map(([key, [symbol, label]]) => button(symbol, () => setDraft({ ...draft, avatar: key }), { key, disabled: disabled || saving, "aria-label": `头像：${label}`, "aria-pressed": (draft.avatar || "robot") === key, title: label }))),
      h("label", { className: "ptb-field" }, h("span", null, "Agent 名称"), h("input", { value: draft.name, disabled: disabled || saving, onChange: (event) => setDraft({ ...draft, name: event.target.value }) })),
      h("label", { className: "ptb-field" }, h("span", null, "Agent 引擎"), h("select", { value: draft.engine, disabled: saving, onChange: (event) => setDraft({ ...draft, engine: event.target.value, model: "", providerId: "" }) }, ...[...new Set([draft.engine, ...resources.engines.map((engine) => engine.id)])].map((engine) => h("option", { key: engine, value: engine }, engine)))),
      h("label", { className: "ptb-field" }, h("span", null, "Agent 工作区"), h("select", { value: draft.workspacePath, disabled: saving, onChange: (event) => setDraft({ ...draft, workspacePath: event.target.value, model: "", providerId: "" }) }, h("option", { value: "" }, "跟随任务工作区"), ...resources.workspaces.map((workspace) => h("option", { key: workspace.path, value: workspace.path }, `${workspace.name} · ${workspace.path}`)), draft.workspacePath && !resources.workspaces.some((workspace) => workspace.path === draft.workspacePath) && h("option", { value: draft.workspacePath }, `${draft.workspacePath}（已移除）`))),
      h("label", { className: "ptb-field" }, h("span", null, "Agent 模型与渠道"), h("select", { value: draft.model ? JSON.stringify([draft.providerId, draft.model]) : "", disabled: saving, onChange: (event) => { const [providerId, model] = event.target.value ? JSON.parse(event.target.value) : ["", ""]; setDraft({ ...draft, providerId, model }); } }, h("option", { value: "" }, "宿主默认模型"), ...models.map((model) => h("option", { key: model.key, value: model.key }, model.label)), draft.model && !models.some((model) => model.id === draft.model && model.providerId === draft.providerId) && h("option", { value: JSON.stringify([draft.providerId, draft.model]) }, `${draft.model}（未在列表中）`))),
      h("label", { className: "ptb-field ptb-wide" }, h("span", null, "Agent 执行指令"), h("textarea", { rows: 6, value: draft.instruction, disabled: disabled || saving, onChange: (event) => setDraft({ ...draft, instruction: event.target.value }) })),
      h("label", { className: "ptb-settings-check ptb-wide" }, h("input", { type: "checkbox", checked: draft.archived === true, disabled: saving, onChange: (event) => setDraft({ ...draft, archived: event.target.checked }) }), "归档 Agent"),
      h("p", { className: "ptb-muted ptb-wide" }, "指定工作区须与任务工作区一致。指派不会自动执行。"),
      h("fieldset", { className: "ptb-settings-options ptb-wide" }, h("legend", null, "绑定共享方法"), ...methods.filter((method) => !method.archived || draft.methodIds?.includes(method.id)).map((method) => h("label", { key: method.id }, h("input", { type: "checkbox", checked: draft.methodIds?.includes(method.id) || false, disabled: saving, onChange: (event) => setDraft({ ...draft, methodIds: event.target.checked ? [...(draft.methodIds || []), method.id] : (draft.methodIds || []).filter((id) => id !== method.id) }) }), `${method.name}${method.archived ? "（已停用，执行时跳过）" : ""}`)), !methods.length && h("p", { className: "ptb-muted" }, "先在共享方法库中添加方法。"))),
      h("footer", { className: "ptb-settings-save" },
      button("保存 Agent", async () => { setSaving(true); setError(""); try { await board.saveAgent(draft, id); setDraft(empty); setId(null); } catch (error) { setError(message(error)); } finally { setSaving(false); } }, { disabled: disabled || saving, className: "ptb-primary" })), error && h("p", { role: "alert", className: "ptb-error" }, error));
  }

  function ProjectInstructions({ workspacePath, name, description, resources, disabled }) {
    const [value, setValue] = useState(description);
    const [links, setLinks] = useState((resources?.links || []).join("\n"));
    const [files, setFiles] = useState(resources?.files || []);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [saved, setSaved] = useState(false);
    return h("div", { className: "ptb-project-instructions" },
      h("p", { className: "ptb-muted" }, "说明会随下一轮执行发送给 AI；清空并保存可移除。"),
      h("label", { className: "ptb-field" }, h("span", null, "项目共享说明"), h("textarea", { rows: 4, value, disabled: disabled || saving, onChange: (event) => { setValue(event.target.value); setSaved(false); } })),
      h("label", { className: "ptb-field" }, h("span", null, "项目资源链接（每行一个）"), h("textarea", { rows: 3, value: links, disabled: disabled || saving || uploading, onChange: (event) => { setLinks(event.target.value); setSaved(false); } })),
      h(AttachmentPicker, { label: "项目公共资源", files, onChange: (next) => { setFiles(next); setSaved(false); }, onBusy: setUploading, disabled: disabled || saving }),
      button(saving ? "保存中…" : "保存项目说明", async () => {
        setSaving(true); setError(""); setSaved(false);
        try { await board.saveProject(workspacePath, name, value, { links: links.split("\n").map((url) => url.trim()).filter(Boolean), files }); setSaved(true); } catch (error) { setError(message(error)); } finally { setSaving(false); }
      }, { disabled: disabled || saving || uploading }),
      error && h("p", { role: "alert", className: "ptb-error" }, error), saved && h("p", { role: "status" }, "项目说明已保存"));
  }

  function BoardSettings() {
    const state = useSyncExternalStore(board.subscribe, board.getSnapshot);
    const view = useSyncExternalStore(viewStore.subscribe, viewStore.getSnapshot);
    const resources = useResources(0);
    const [category, setCategory] = useState("agents");
    const [viewName, setViewName] = useState("");
    const [error, setError] = useState("");
    const locked = state.busy || state.tasks.some((task) => task.status === "running" || task.recovery);
    const categories = [
      { id: "agents", label: "Agent 成员", count: state.agents.length, path: "M8 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M14 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 8v6M1 11h6" },
      { id: "squads", label: "手动协调小队", count: state.squads.length, path: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
      { id: "methods", label: "共享方法库", count: state.methods.length, path: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6" },
      { id: "projects", label: "项目说明与资源", path: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" },
      { id: "views", label: "视图偏好", path: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" },
    ];
    const active = categories.find((entry) => entry.id === category);
    const panel = (id, content) => h("div", { className: "ptb-settings-panel", hidden: category !== id, key: id, "aria-label": categories.find((entry) => entry.id === id).label }, content);
    return h("section", { className: "ptb-root ptb-settings", "aria-label": "任务面板配置" }, h("style", null, CSS),
      h("header", { className: "ptb-header" }, h("h1", null, "任务面板配置"), button("返回任务面板", () => ctx.ui.openCenterTab("board"))),
      (state.error || view.error || error) && h("p", { role: "alert", className: "ptb-error" }, state.error || view.error || error),
      h("div", { className: "ptb-settings-layout" },
        h("nav", { className: "ptb-settings-nav", "aria-label": "配置分类" }, h("h2", null, "配置分类"), ...categories.map((entry) => button([
          h("svg", { key: "icon", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, h("path", { d: entry.path })),
          h("span", { key: "label" }, entry.label), entry.count !== undefined && h("span", { key: "count", className: "ptb-settings-count", "aria-hidden": true }, entry.count),
        ], () => setCategory(entry.id), { key: entry.id, "aria-label": entry.label, "aria-current": category === entry.id ? "page" : undefined }))),
        h("main", { className: "ptb-settings-main" },
          h("p", { className: "ptb-settings-breadcrumb" }, `${["projects", "views"].includes(category) ? "项目与显示" : "协作配置"} / ${active.label}`),
          state.ready && panel("agents", h(AgentManager, { agents: state.agents, methods: state.methods, disabled: locked })),
          state.ready && panel("squads", h(SquadManager, { agents: state.agents, squads: state.squads, disabled: locked })),
          state.ready && panel("methods", h(MethodManager, { methods: state.methods, disabled: locked })),
          panel("views", h("section", { className: "ptb-settings-card" }, h("h2", null, "视图偏好"),
      h("div", { className: "ptb-actions" }, h("input", { "aria-label": "视图名称", value: viewName, placeholder: "视图名称", disabled: !view.ready, onChange: (event) => setViewName(event.target.value) }),
      button("保存当前视图", () => { if (!viewName.trim()) { setError("请填写视图名称。"); return; } void viewStore.update({ savedViews: [...view.savedViews, { id: uid(), name: viewName.trim(), view: viewFields(view) }] }); setViewName(""); }, { disabled: !view.ready })),
      h("div", { className: "ptb-actions" }, ...view.savedViews.map((entry) => button(`移除视图 ${entry.name}`, () => void viewStore.update({ savedViews: view.savedViews.filter((item) => item.id !== entry.id) }), { key: entry.id, disabled: !view.ready }))),
        h("label", { className: "ptb-open-mode" }, "点击任务标题 ", h("select", { "aria-label": "默认打开任务", value: view.openMode, disabled: !view.ready, onChange: (event) => void viewStore.update({ openMode: event.target.value }) }, h("option", { value: "details" }, "完整详情"), h("option", { value: "preview" }, "侧边预览"))),
        h("fieldset", { className: "ptb-card-fields" }, h("legend", null, "列表显示列"), ...Object.entries(LIST_FIELDS).map(([key, label]) => h("label", { key }, h("input", { type: "checkbox", checked: view.listFields[key], disabled: !view.ready, onChange: (event) => void viewStore.update({ listFields: { ...view.listFields, [key]: event.target.checked } }) }), label))),
        h("fieldset", { className: "ptb-card-fields" }, h("legend", null, "卡片显示字段"), ...Object.entries(CARD_FIELDS).map(([key, label]) => h("label", { key }, h("input", { type: "checkbox", checked: view.cardFields[key], disabled: !view.ready, onChange: (event) => void viewStore.update({ cardFields: { ...view.cardFields, [key]: event.target.checked } }) }), label))))),
        panel("projects", h("section", { className: "ptb-settings-card" }, h("h2", null, "项目说明与资源"),
          ...[...new Set(state.tasks.filter((task) => task.project).map((task) => JSON.stringify([task.workspacePath, task.project])))].map((key) => {
            const [workspacePath, name] = JSON.parse(key);
            const description = state.projects.find((entry) => entry.workspacePath === workspacePath && entry.name === name)?.description || "";
            return h("details", { key }, h("summary", null, `${name} · ${resources.workspaces.find((entry) => entry.path === workspacePath)?.name || workspacePath}`), h(ProjectInstructions, { workspacePath, name, description, resources: state.projects.find((entry) => entry.workspacePath === workspacePath && entry.name === name)?.resources, disabled: locked || !state.ready }));
          }), !state.tasks.some((task) => task.project) && h("p", null, "先为任务填写项目名称。"))))));
  }

  function Board() {
    const state = useSyncExternalStore(board.subscribe, board.getSnapshot);
    const [reloadKey, setReloadKey] = useState(0);
    const resources = useResources(reloadKey);
    const view = useSyncExternalStore(viewStore.subscribe, viewStore.getSnapshot);
    const { workspace: filter, search, collapsed } = view;
    const setFilter = (workspace) => viewStore.update({ workspace });
    const setSearch = (search) => viewStore.update({ search });
    const setCollapsed = (update) => viewStore.update({ collapsed: update(collapsed) });
    const [localError, setLocalError] = useState("");
    const [pending, setPending] = useState(false);
    const [selected, setSelected] = useState([]);
    const [batchPriority, setBatchPriority] = useState("medium");
    const [previewId, setPreviewId] = useState(null);
    const searchInput = useRef(null);
    const selectionAnchor = useRef(null);
    const [archivedNotices, setArchivedNotices] = useState(false);
    const toolsPanel = useRef(null);
    const selectedVisible = selected.filter((id) => selectTasks(state.tasks, view).some((task) => task.id === id));
    async function act(operation) {
      setLocalError(""); board.clearError(); setPending(true);
      try { await operation(); } catch (error) { setLocalError(message(error)); }
      finally { setPending(false); }
    }
    const locked = state.busy || pending;
    const occupied = state.tasks.some((task) => task.status === "running" || task.recovery);
    const filteredTasks = selectTasks(state.tasks, view);
    const tasks = view.layout === "list" ? Object.keys(STATUSES).flatMap((status) => filteredTasks.filter((task) => task.status === status)) : filteredTasks;
    const canCreate = state.ready && !resources.loading && resources.engines.length > 0 && resources.workspaces.length > 0;
    const error = localError || state.error || resources.error || view.error;
    const notices = taskNotices(state.tasks);
    const unreadNotices = notices.filter((entry) => !entry.read && !entry.archived).length;

    function openTask(event, task, preview = false) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((preview || view.openMode === "preview") !== Boolean(event.shiftKey)) setPreviewId(task.id); else openDetails(task);
    }
    function selectTask(event, task) {
      const checked = event.target.checked;
      const shift = event.shiftKey || event.nativeEvent?.shiftKey;
      setSelected((current) => selectTaskRange(tasks, current, shift ? selectionAnchor.current : null, task.id, checked));
      if (!shift) selectionAnchor.current = task.id;
    }
    function handleKey(event) {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.nativeEvent?.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.target.closest("input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox]")) return;
      if (event.key.toLowerCase() === "c" && !previewId && canCreate && !locked) { event.preventDefault(); event.stopPropagation(); openEditor(); }
      if (event.key === "/" && !previewId && view.ready) { event.preventDefault(); event.stopPropagation(); searchInput.current?.focus(); }
    }
    function card(task) {
      const latest = task.runs.at(-1);
      const needsRevision = Boolean(task.pendingFeedbackIds?.length) || task.comments?.some((entry) => entry.triggerAgent && !entry.resolvedAt);
      const workspace = resources.workspaces.find((item) => item.path === task.workspacePath);
      const metadata = [view.cardFields.project && task.project && `项目 ${task.project}`, view.cardFields.tags && task.tags?.join(" · "), view.cardFields.dueDate && task.dueDate && `截止 ${task.dueDate}${isOverdue(task) ? "（已逾期）" : ""}`].filter(Boolean);
      return h("article", { key: task.id, className: "ptb-card", "aria-label": task.title },
        h("div", { className: "ptb-card-meta" }, h("input", { type: "checkbox", "aria-label": `选择任务 ${task.title}`, checked: selectedVisible.includes(task.id), disabled: locked || task.status === "running" || task.recovery, onChange: (event) => setSelected((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id)) }), view.cardFields.priority && h("span", { className: `ptb-priority ptb-${task.priority}` }, `${PRIORITIES[task.priority]}优先级`), view.cardFields.updated && h("span", null, new Date(task.updatedAt).toLocaleDateString("zh-CN"))),
        h("div", { className: "ptb-card-heading" },
          h("h3", null, button(task.title, (event) => openTask(event, task), { className: "ptb-task-title", "aria-label": `查看任务详情 ${task.title}` })),
          button("预览", (event) => openTask(event, task, true), { className: "ptb-card-preview", "aria-label": `预览任务 ${task.title}` })),
        task.assigneeId && h("p", { className: "ptb-agent-identity ptb-card-assignee" }, h(AgentAvatar, { agent: state.agents.find((agent) => agent.id === task.assigneeId) }), state.agents.find((agent) => agent.id === task.assigneeId)?.name),
        view.cardFields.workspace && h("p", { className: "ptb-path", title: task.workspacePath }, workspace?.name || task.workspacePath.split(/[\\/]/).pop()),
        metadata.length > 0 && h("p", { className: view.cardFields.dueDate && isOverdue(task) ? "ptb-error" : "ptb-muted" }, metadata.join(" · ")),
        view.cardFields.parent && task.parentId && h("p", { className: "ptb-muted" }, `子任务 · ${state.tasks.find((entry) => entry.id === task.parentId)?.title || "父任务"}`),
        task.duplicateOf && button("查看原始任务", () => openDetails(state.tasks.find((entry) => entry.id === task.duplicateOf))),
        view.cardFields.model && h("p", { className: "ptb-engine" }, `${task.engine} · ${task.model || "宿主默认模型"}`),
        view.cardFields.requirements && h("details", null, h("summary", null, "需求与验收"), h("h4", null, "需求"), h("p", { className: "ptb-content" }, task.description), fileLinks(task.descriptionFiles), h("h4", null, "验收标准"), h("p", { className: "ptb-content" }, task.criteria), fileLinks(task.criteriaFiles)),
        latest && h("p", { className: latest.outcome === "error" ? "ptb-error" : "ptb-muted" }, task.status === "done" ? "已验收 · 执行记录已保留" : task.status === "todo" && needsRevision ? "验收未通过 · 待修正" : task.status === "review" && latest.outcome === "ended" ? "执行结束，等待验收" : OUTCOMES[latest.outcome]),
        latest?.error && h("p", { className: "ptb-error ptb-content", role: "alert" }, latest.error),
        task.recovery && h("div", { className: "ptb-recovery" }, h("p", null, "应用重载后无法确认运行状态。请先打开会话，必要时在聊天中停止，再解除占用。"), button("已核对会话结束", () => void act(() => board.acknowledge(task.id)), { disabled: locked })),
        h("div", { className: "ptb-actions" },
          button(`评论 · ${task.comments?.length || 0}`, () => openDetails(task)),
          !task.recovery && ["todo", "blocked", "review"].includes(task.status) && (() => {
            const project = state.projects.find((entry) => entry.workspacePath === task.workspacePath && entry.name === task.project);
            const resources = normalizeProjectResources(project?.resources);
            const start = button(needsRevision ? "执行修正" : task.runs.length ? "重新执行" : "开始执行", () => void act(() => board.start(task.id)), { disabled: locked || occupied, className: "ptb-primary" });
            return project?.description || resources.links.length || resources.files.length ? h("details", { className: "ptb-execution-context" }, h("summary", null, "核对项目上下文并执行"), h("pre", { className: "ptb-content" }, (project?.description || "") + resourcePrompt(resources)), start) : start;
          })(),
          task.status === "running" && button(latest?.stopRequested ? "已请求停止" : "停止执行", () => void act(() => board.stop(task.id)), { disabled: locked || latest?.stopRequested }),
          latest && button("查看结果", () => void act(() => board.open(latest)), { disabled: locked || !latest.sessionId, title: latest.sessionId ? "在原生聊天中查看结果" : "等待引擎返回会话标识" }),
          task.status === "review" && button("验收通过", () => void act(() => board.setStatus(task.id, "done")), { disabled: locked }),
          !task.recovery && (task.status === "review" || (task.status === "todo" && Boolean(task.pendingFeedbackIds?.length))) && button(task.status === "review" ? "验收不通过" : "补充反馈", () => openFeedback(task), { disabled: locked }),
          !task.recovery && task.status !== "running" && h("details", { className: "ptb-card-more" }, h("summary", null, "更多操作"), h("div", { className: "ptb-actions" }, button("编辑", () => openEditor(task), { disabled: locked }),
          !task.recovery && ["done", "cancelled", "review", "blocked"].includes(task.status) && button("移回待办", () => void act(() => board.setStatus(task.id, "todo")), { disabled: locked }),
          !task.recovery && ["todo", "blocked", "review"].includes(task.status) && button("取消任务", () => void act(() => board.setStatus(task.id, "cancelled")), { disabled: locked })))),
        task.feedbacks?.length > 0 && h("details", { className: "ptb-history" }, h("summary", null, `验收反馈 · ${task.feedbacks.length}`), ...task.feedbacks.slice().reverse().map((entry) => h("div", { key: entry.id, className: "ptb-run" },
          h("p", { className: "ptb-muted" }, `${new Date(entry.createdAt).toLocaleString("zh-CN")} · ${entry.resolvedAt ? "已通过复验" : "未通过"}`), h("p", { className: "ptb-content" }, entry.content), fileLinks(entry.files),
          button("查看对应结果", () => void act(() => board.open(task.runs.find((run) => run.id === entry.afterRunId))), { disabled: locked || !task.runs.find((run) => run.id === entry.afterRunId)?.sessionId })))),
        task.runs.length > 0 && h("details", { className: "ptb-history" }, h("summary", null, `执行记录 · ${task.runs.length}`), ...task.runs.slice().reverse().map((run) => h("div", { key: run.id, className: "ptb-run" },
          h("span", null, `${new Date(run.startedAt).toLocaleString("zh-CN")} · ${OUTCOMES[run.outcome]}`),
          h("p", null, `${run.commentId ? "评论触发" : run.feedbackIds?.length ? "修正执行" : "任务执行"}${run.resumeSessionId ? " · 原会话续接" : ""}${run.reviewDecision === "rejected" ? " · 验收未通过" : run.reviewDecision === "accepted" ? " · 验收通过" : ""}`),
          button("查看输入", () => openDetails(task, run.id)),
          button("查看结果", () => void act(() => board.open(run)), { disabled: locked || !run.sessionId }), h("details", { "aria-label": "执行日志" }, h("summary", null, `执行日志 · ${(run.runtimeEvents || []).length}`), h("p", { className: "ptb-muted" }, run.logCapability === "observing" ? "仅回放宿主已捕获事件，不重新执行命令；不保证完整工具输入输出，重启或断连期间可能缺失。" : "此轮未启用宿主事件采集；请打开原生会话查看。"), run.logTruncated && h("p", { role: "status" }, "日志达到2000条上限，后续事件未保存。"), ...[...(run.runtimeEvents || [])].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((event) => h("pre", { key: event.eventId, className: "ptb-content" }, JSON.stringify(event, null, 2)))),
          run.methodSnapshots?.length > 0 && h("details", null, h("summary", null, "当轮共享方法"), h("pre", { className: "ptb-content" }, methodContext(run.methodSnapshots))),
          run.error && h("p", { className: "ptb-error" }, run.error)))));
    }

    function fileLinks(files) {
      return files?.length ? h("ul", { className: "ptb-attachments" }, ...files.map((file) => h("li", { key: file.path }, button(file.name, () => void act(() => ctx.shell.revealPath(file.path)), { title: `显示原文件：${file.path}`, disabled: locked })))) : null;
    }

    return h("section", { className: `ptb-root ptb-board ptb-layout-${view.layout}`, tabIndex: -1, onKeyDown: handleKey, "aria-label": "个人任务看板" },
      h("style", null, CSS),
      h("header", { className: "ptb-header ptb-board-header" }, h("div", { className: "ptb-board-title" }, h("h1", null, "个人任务面板"), h("span", { className: "ptb-muted" }, "个人工作台")),
        h("div", { className: "ptb-actions" }, h("details", { className: "ptb-notices", onKeyDown: (event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary").focus(); } } },
          h("summary", { "aria-label": `任务通知 · ${unreadNotices} 条未读`, title: "任务通知" },
            h("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, "aria-hidden": true }, h("path", { d: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" })),
            h("span", { className: "ptb-sr" }, `任务通知 · ${unreadNotices} 条未读`),
            unreadNotices > 0 && h("span", { className: "ptb-notice-badge", "aria-hidden": true }, unreadNotices)),
          h("section", { className: "ptb-notice-popover", "aria-label": "任务通知收件箱" },
          h("div", { className: "ptb-notice-header" }, h("h2", null, "任务通知"), button("关闭", (event) => { const details = event.currentTarget.closest("details.ptb-notices"); details.open = false; details.querySelector("summary").focus(); }, { "aria-label": "关闭通知" })),
        button(archivedNotices ? "查看收件箱" : "查看已归档通知", () => setArchivedNotices(!archivedNotices)),
        !archivedNotices && h("div", { className: "ptb-actions" },
          button("全部标为已读", () => void act(() => board.bulkNotices("read")), { disabled: locked || !state.ready }),
          button("归档已读通知", () => void act(() => board.bulkNotices("archive-read")), { disabled: locked || !state.ready }),
          button("归档已结束任务通知", () => void act(() => board.bulkNotices("archive-completed")), { disabled: locked || !state.ready })),
        ...notices.filter((entry) => entry.archived === archivedNotices).map((entry) => h("div", { key: entry.id, className: `ptb-notice${entry.read ? "" : " ptb-notice-unread"}` },
          h("div", { className: "ptb-notice-content" }, h("span", { className: "ptb-notice-title" }, entry.title), h("span", { className: "ptb-notice-meta" }, `${entry.read ? "" : "未读 · "}${entry.summary || OUTCOMES[entry.outcome]} · ${new Date(entry.createdAt).toLocaleString("zh-CN")}`)),
          h("div", { className: "ptb-actions ptb-notice-actions" },
          button("查看任务", (event) => { event.currentTarget.closest("details.ptb-notices").open = false; setPreviewId(entry.taskId); void act(() => board.updateNotice(entry.taskId, entry.id, { read: true })); }),
          button(entry.read ? "标为未读" : "标为已读", () => void act(() => board.updateNotice(entry.taskId, entry.id, { read: !entry.read })), { disabled: locked }),
          button(entry.archived ? "恢复通知" : "归档通知", () => void act(() => board.updateNotice(entry.taskId, entry.id, { archived: !entry.archived })), { disabled: locked })))),
        !notices.some((entry) => entry.archived === archivedNotices) && h("p", null, "暂无通知"))), button("＋ 新建任务", () => openEditor(), { disabled: locked || !canCreate, className: "ptb-primary" }))),
      error && h("div", { className: "ptb-banner ptb-error", role: "alert" }, error),
      state.busy && h("p", { className: "ptb-banner", role: "status" }, "正在检查模型并启动原生会话…"),
      !state.ready && h("p", { role: "status" }, error ? "任务未载入，修复问题后请重新载入。" : "正在载入任务…"),
      !resources.loading && (!resources.engines.length || !resources.workspaces.length) && h("p", { className: "ptb-banner" }, "请先在 CC GUI 中添加工作区并启用可用的 AI 引擎，再点击重新载入。"),
      h("div", { className: "ptb-toolbar" }, h("label", null, h("span", null, "工作区"), h("select", { disabled: !view.ready, value: filter, onChange: (event) => setFilter(event.target.value) }, h("option", { value: "" }, "全部工作区"), ...[...new Set([...resources.workspaces.map((item) => item.path), ...state.tasks.map((item) => item.workspacePath)])].map((path) => h("option", { key: path, value: path }, resources.workspaces.find((item) => item.path === path)?.name || path)))),
        h("label", null, "项目 ", h("select", { "aria-label": "筛选项目", value: view.project, disabled: !view.ready, onChange: (event) => void viewStore.update({ project: event.target.value }) }, h("option", { value: "" }, "全部项目"), ...[...new Set(state.tasks.map((task) => task.project).filter(Boolean))].map((project) => h("option", { key: project, value: project }, project)))),
        h("input", { ref: searchInput, type: "search", "aria-label": "搜索任务", placeholder: "搜索任务…", disabled: !view.ready, value: search, onChange: (event) => setSearch(event.target.value) }), button("清除筛选", () => void viewStore.update({ workspace: "", project: "", search: "", focus: "all" }), { disabled: !view.ready }), h("span", { className: "ptb-muted", role: "status" }, `${tasks.length} / ${state.tasks.length} 项任务${occupied ? " · 有执行待结束或核对" : ""}`)),
      h("div", { className: "ptb-viewbar" },
        h("div", { className: "ptb-focus ptb-actions", "aria-label": "任务快捷筛选" }, ...Object.entries(FOCUSES).map(([focus, label]) => button(`${label} ${selectTasks(state.tasks, { ...view, focus }).length}`, () => void viewStore.update({ focus }), { key: focus, disabled: !view.ready, "aria-label": `筛选${label}`, "aria-pressed": view.focus === focus }))),
        h("div", { className: "ptb-layout-actions" }, h("div", { className: "ptb-layout-switch", role: "group", "aria-label": "任务布局" }, ...Object.entries(LAYOUTS).map(([layout, label]) => button(label, () => void viewStore.update({ layout }), { key: layout, "aria-label": `切换${label}布局`, "aria-pressed": view.layout === layout, disabled: !view.ready }))),
          button("视图设置", () => { toolsPanel.current.open = !toolsPanel.current.open; toolsPanel.current.querySelector("summary").focus(); }, { "aria-controls": "ptb-view-tools" }))),
      state.ready && state.tasks.length > 0 && !tasks.length && h("p", { className: "ptb-banner", role: "status" }, "当前筛选隐藏了所有任务，点击“清除筛选”查看。"),
      h("details", { ref: toolsPanel, id: "ptb-view-tools", className: "ptb-tools" }, h("summary", null, "视图与批量操作"),
        h("div", { className: "ptb-actions" },
          button("重新载入", () => void act(async () => { await board.reload(); setReloadKey((key) => key + 1); }), { disabled: locked || !board.canReload() }),
          h("label", null, "排序 ", h("select", { "aria-label": "任务排序", disabled: !view.ready, value: view.sort, onChange: (event) => void viewStore.update({ sort: event.target.value }) }, ...Object.entries(SORTS).map(([key, label]) => h("option", { key, value: key }, label)))),
          h("select", { "aria-label": "已保存视图", value: "", disabled: !view.ready, onChange: (event) => { const saved = view.savedViews.find((entry) => entry.id === event.target.value); if (saved) void viewStore.update(saved.view); } }, h("option", { value: "" }, "选择已保存视图"), ...view.savedViews.map((entry) => h("option", { key: entry.id, value: entry.id }, entry.name))),
        ),
        h("p", { className: "ptb-muted" }, "快捷键：C 新建 · / 搜索 · 预览内 J/K 切换 · Esc 关闭 · Shift 点击切换预览与详情"),
        h("div", { className: "ptb-actions ptb-batch" },
          h("span", null, `已选择 ${selectedVisible.length} 项`),
          button("选择筛选结果", () => setSelected(tasks.filter((task) => task.status !== "running" && !task.recovery).map((task) => task.id)), { disabled: locked }), button("清空选择", () => { setSelected([]); selectionAnchor.current = null; }),
          h("select", { "aria-label": "批量优先级", value: batchPriority, onChange: (event) => setBatchPriority(event.target.value) }, ...Object.entries(PRIORITIES).map(([value, label]) => h("option", { key: value, value }, label))),
          button("应用优先级", () => void act(() => board.bulkUpdate(selectedVisible, { priority: batchPriority })), { disabled: locked || !selectedVisible.length }),
          button("批量移回待办", () => void act(() => board.bulkUpdate(selectedVisible, { status: "todo" })), { disabled: locked || !selectedVisible.length }),
          button("批量取消", () => void act(() => board.bulkUpdate(selectedVisible, { status: "cancelled" })), { disabled: locked || !selectedVisible.length })),
        h("details", null, h("summary", null, "项目进度"), ...[...new Set(state.tasks.filter((task) => (!filter || task.workspacePath === filter) && task.project).map((task) => task.project))].map((project) => {
          const projectTasks = state.tasks.filter((task) => task.project === project && (!filter || task.workspacePath === filter));
          const ended = projectTasks.filter((task) => ["done", "cancelled"].includes(task.status)).length;
          return h("p", { key: project }, button(project, () => void viewStore.update({ project })), ` ${ended}/${projectTasks.length} 已结束 · ${Math.round(ended / projectTasks.length * 100)}%`);
        })),
        h("details", { "aria-label": "执行统计" }, h("summary", null, "执行统计（当前筛选）"), (() => {
          const metrics = taskMetrics(tasks);
          return h("p", null, `${metrics.runs} 次已结束运行 · ${metrics.errors} 次失败 · 失败率 ${metrics.errorRate == null ? "—" : `${(metrics.errorRate * 100).toFixed(1)}%`} · 执行耗时 ${metrics.durationMs == null ? "未记录" : `${(metrics.durationMs / 1000).toFixed(1)} 秒`}${metrics.unmeasured ? ` · ${metrics.unmeasured} 次未记录耗时` : ""}${metrics.unstarted ? ` · 另有 ${metrics.unstarted} 次启动未成功，不计入运行统计` : ""}`);
        })())),
      state.ready && !state.tasks.length && h("div", { className: "ptb-empty" }, icon({}), h("h2", null, "从一项具体任务开始"), h("p", null, "写清需求和验收标准，选择工作区与模型，再开始执行。"), button("创建第一项任务", () => openEditor(), { disabled: !canCreate, className: "ptb-primary" })),
      state.ready && state.tasks.length > 0 && view.layout === "list" && h("div", { className: "ptb-list" }, h("table", { "aria-label": "任务列表" },
        h("thead", null, h("tr", null, ...["选择", "任务", "状态", ...Object.entries(LIST_FIELDS).filter(([key]) => view.listFields[key]).map(([, label]) => label)].map((label) => h("th", { key: label, scope: "col" }, label)))),
        h("tbody", null, ...tasks.flatMap((task, index) => [
          (index === 0 || tasks[index - 1].status !== task.status) && h("tr", { key: `group-${task.status}`, className: `ptb-list-group ptb-status-${task.status}` }, h("th", { colSpan: 3 + Object.values(view.listFields).filter(Boolean).length }, h("span", { className: "ptb-dot", "aria-hidden": true }), `${STATUSES[task.status]} · ${tasks.filter((entry) => entry.status === task.status).length}`)),
          h("tr", { key: task.id, className: `ptb-task-row${previewId === task.id ? " ptb-row-selected" : ""}` },
          h("td", null, h("input", { type: "checkbox", "aria-label": `选择任务 ${task.title}`, checked: selectedVisible.includes(task.id), disabled: locked || task.status === "running" || task.recovery, onChange: (event) => selectTask(event, task) })),
          h("td", null, h("div", { className: "ptb-list-task" }, button(task.title, (event) => openTask(event, task), { className: "ptb-task-title" }), h("div", { className: "ptb-actions ptb-list-task-actions" }, button("预览", (event) => openTask(event, task, true), { "aria-label": `预览任务 ${task.title}` }), h(InlineField, { task, field: "title", disabled: locked || task.status === "running" || task.recovery }))), task.parentId && h("span", { className: "ptb-muted" }, `子任务/阶段 ${task.stage || 1}`)),
          h("td", null, h("span", { className: `ptb-status-label ptb-status-${task.status}` }, STATUSES[task.status])), view.listFields.priority && h("td", null, h(InlineField, { task, field: "priority", disabled: locked || task.status === "running" || task.recovery })), view.listFields.project && h("td", null, task.project || "—"), view.listFields.dueDate && h("td", { className: isOverdue(task) ? "ptb-error" : "" }, h(InlineField, { task, field: "dueDate", disabled: locked || task.status === "running" || task.recovery })), view.listFields.workspace && h("td", null, resources.workspaces.find((entry) => entry.path === task.workspacePath)?.name || task.workspacePath))]),
          !tasks.length && h("tr", null, h("td", { colSpan: 3 + Object.values(view.listFields).filter(Boolean).length }, "没有符合筛选的任务"))))),
      state.ready && state.tasks.length > 0 && view.layout === "gantt" && (() => {
        const timeline = taskTimeline(tasks);
        return h("div", { className: "ptb-gantt", "aria-label": "甘特时间轴" },
          timeline.start && h("div", { className: "ptb-gantt-range" }, h("span", null, timeline.start), h("span", null, timeline.end)),
          ...timeline.rows.map(({ task, left, width }) => h("div", { key: task.id, className: `ptb-gantt-row ptb-status-${task.status}` },
            button(task.title, () => setPreviewId(task.id), { title: task.title, className: "ptb-gantt-name" }),
            h("div", { className: "ptb-gantt-track" }, button(`${task.startDate || "未设开始"} → ${task.dueDate || "未设截止"}`, () => setPreviewId(task.id), { className: `ptb-gantt-bar${!task.startDate || !task.dueDate ? " ptb-gantt-point" : ""}`, style: { left: `${left}%`, width: `${width}%` }, title: `${task.title}：${task.startDate || "未设开始日期"} → ${task.dueDate || "未设截止日期"}`, "aria-label": `预览任务 ${task.title}` })))),
          timeline.unscheduled.length > 0 && h("div", { className: "ptb-gantt-unscheduled" }, h("h2", null, "未排期"), ...timeline.unscheduled.map((task) => h("p", { key: task.id }, button(task.title, () => setPreviewId(task.id))))),
          !tasks.length && h("p", null, "没有符合筛选的任务"));
      })(),
      state.ready && state.tasks.length > 0 && view.layout === "board" && h("div", { className: "ptb-columns" }, ...Object.entries(STATUSES).map(([status, label]) => {
        const items = tasks.filter((task) => task.status === status);
        const folded = collapsed.includes(status);
        return h("section", { key: status, className: `ptb-column ptb-status-${status}${folded ? " ptb-column-collapsed" : ""}`, "aria-label": label },
          h("h2", null, button([h("span", { key: "dot", className: "ptb-dot" }), h("span", { key: "label", className: "ptb-column-label" }, label), h("span", { key: "count", className: "ptb-count" }, items.length), h("span", { key: "arrow", className: "ptb-chevron", "aria-hidden": true }, folded ? "▸" : "▾")], () => setCollapsed((current) => current.includes(status) ? current.filter((key) => key !== status) : [...current, status]), {
            disabled: !view.ready, className: "ptb-column-toggle", "aria-label": `${folded ? "展开" : "折叠"}${label}`, "aria-expanded": !folded, "aria-controls": `ptb-column-${status}`,
          })),
          h("div", { id: `ptb-column-${status}`, className: "ptb-column-content", hidden: folded }, ...items.map(card), !items.length && h("p", { className: "ptb-column-empty" }, "暂无任务")));
      })),
      state.ready && state.tasks.length > 0 && view.layout === "swimlane" && h("div", { className: "ptb-swimlanes", "aria-label": "父子任务泳道" }, ...taskSwimlanes(tasks, state.tasks).map((lane) => {
        const folded = view.collapsedLanes.includes(lane.id);
        const title = lane.parent?.title || "独立任务";
        return h("section", { key: lane.id, className: "ptb-lane", "aria-label": `泳道 ${title}` },
          h("h2", null, button(`${folded ? "▸" : "▾"} ${title} · ${lane.tasks.length}`, () => void viewStore.update({ collapsedLanes: folded ? view.collapsedLanes.filter((id) => id !== lane.id) : [...view.collapsedLanes, lane.id] }), { "aria-expanded": !folded, "aria-label": `${folded ? "展开" : "折叠"}泳道 ${title}`, disabled: !view.ready }), lane.parent && h("span", { className: "ptb-muted ptb-lane-progress" }, `${lane.tasks.filter((task) => task.status === "done").length}/${lane.tasks.length} 已完成`), lane.parent && button("查看父任务", () => setPreviewId(lane.parent.id))),
          !folded && h("div", { className: "ptb-lane-columns" }, ...Object.entries(STATUSES).map(([status, label]) => h("section", { key: status, className: `ptb-column ptb-status-${status}`, "aria-label": label }, h("h3", null, `${label} · ${lane.tasks.filter((task) => task.status === status).length}`), ...lane.tasks.filter((task) => task.status === status).map(card)))));
      }), !tasks.length && h("p", null, "没有符合筛选的任务")),
      previewId && state.tasks.some((task) => task.id === previewId) && h(TaskPreview, { task: state.tasks.find((task) => task.id === previewId), tasks, onSelect: setPreviewId, onClose: () => setPreviewId(null) }),
      h("footer", { className: "ptb-footer ptb-board-footer" }, h("span", null, "任务保存在本机 · 执行输出在原生会话中查看 · AI 结束后需人工验收"), button("任务面板配置", () => ctx.ui.openCenterTab("board-settings"))));
  }

  ctx.ui.registerCenterTab({ key: "board", title: () => "个人任务看板", icon, component: Board });
  ctx.ui.registerCenterTab({ key: "board-settings", title: () => "任务面板配置", icon, component: BoardSettings });
  ctx.ui.registerCenterTab({ key: "task-editor", title: () => "任务编辑", icon, component: TaskEditor });
  ctx.ui.registerCenterTab({ key: "task-details", title: () => "任务详情", icon, component: TaskDetails });
  ctx.ui.registerCenterTab({ key: "task-feedback", title: () => "验收反馈", icon, component: FeedbackPage });
  ctx.ui.registerSidebarNav({ key: "board", label: () => "个人任务看板", icon, onOpen: () => ctx.ui.openCenterTab("board") });
  return () => { board.dispose(); viewStore.dispose(); editorListeners.clear(); feedbackListeners.clear(); detailListeners.clear(); };
}

const CSS = `
.ptb-root.ptb-detail{container-type:inline-size;padding:24px 28px}.ptb-detail .ptb-header{margin-bottom:18px}.ptb-detail .ptb-header h1{font-size:24px;line-height:1.4;overflow-wrap:anywhere}.ptb-detail .ptb-detail-body{max-width:1200px;width:100%;margin:0 auto}.ptb-detail-summary{margin:16px 0}.ptb-detail-summary .ptb-actions{font-size:12px;color:var(--ptb-muted)}.ptb-status-pill{padding:3px 9px;border-radius:6px;background:var(--ptb-soft);color:var(--ptb-text)}.ptb-review-hub{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding:20px 22px;margin:18px 0 24px;background:var(--ptb-soft);border-radius:10px}.ptb-detail .ptb-review-hub h2{margin:0;font-size:16px}.ptb-review-hub p{margin:6px 0 0}.ptb-detail-layout{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:28px}.ptb-detail-main{min-width:0}.ptb-detail-tabs{display:flex;gap:22px;border-bottom:1px solid var(--ptb-border);margin-bottom:24px;flex-wrap:wrap}.ptb-root .ptb-detail-tabs button{border:0;border-radius:0;background:transparent;padding:10px 0;color:var(--ptb-muted)}.ptb-root .ptb-detail-tabs button[aria-selected="true"]{color:var(--ptb-text);box-shadow:inset 0 -2px var(--accent-primary-default,#7970e8)}.ptb-detail [data-detail-pane][hidden]{display:none!important}.ptb-detail-sidebar{min-width:0;border-left:1px solid var(--ptb-border);padding:0 0 20px 24px}.ptb-detail .ptb-detail-sidebar h2{font-size:14px;margin:0 0 18px}.ptb-detail-properties{margin:18px 0}.ptb-detail-properties>div{margin:0 0 16px}.ptb-detail-properties dt{font-size:12px;color:var(--ptb-muted);margin-bottom:4px}.ptb-detail-properties dd{margin:0;overflow-wrap:anywhere;font-size:13px}.ptb-detail-sidebar .ptb-agent-identity{align-items:flex-start;flex-wrap:wrap}.ptb-detail-sidebar select{max-width:100%}.ptb-detail-sidebar .ptb-field{min-width:0;width:100%}.ptb-detail-sidebar pre{max-height:260px;overflow:auto}.ptb-detail-sidebar summary{overflow-wrap:anywhere}.ptb-detail .ptb-detail-main h2{font-size:17px;margin:24px 0 12px}.ptb-detail .ptb-detail-main [role="tabpanel"]>h2:first-child{margin-top:0}.ptb-detail-main .ptb-content{overflow-wrap:anywhere}.ptb-detail [role="search"]{gap:6px}.ptb-detail [role="search"] input{min-width:100px;flex:1}.ptb-detail [role="search"] button{font-size:11px;padding:4px 8px}
@container(max-width:740px){.ptb-detail-layout{grid-template-columns:1fr;gap:24px}.ptb-detail-sidebar{border-left:0;border-top:1px solid var(--ptb-border);padding:20px 0}.ptb-detail-properties{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ptb-detail .ptb-review-hub{padding:16px}.ptb-detail-tabs{gap:16px}.ptb-detail .ptb-header h1{font-size:20px}}

.ptb-board-footer { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }

.ptb-compare { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.ptb-root [data-find-active] { outline: 2px solid var(--accent-primary-default, #7676e8); outline-offset: 3px; }

.ptb-selection-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0 10px}.ptb-selection-actions button{font-size:12px}.ptb-quote-source{display:block;font-size:11px;color:var(--ptb-muted);margin-bottom:4px}.ptb-selectable{min-width:0}.ptb-selectable>p:focus{outline:2px solid #8078ec;outline-offset:3px}.ptb-quote button{display:block;margin-top:8px;font-size:11px}
.ptb-board>.ptb-toolbar{margin-bottom:12px}.ptb-board>.ptb-focus{margin-bottom:12px}.ptb-retry{padding:8px 0}.ptb-retry pre{max-height:280px;overflow:auto}.ptb-retry p{font-size:12px;line-height:1.6}
.ptb-open-mode{display:flex;align-items:center;gap:8px;margin:10px 0;font-size:12px}.ptb-source{padding:10px 0}.ptb-source h3,.ptb-source h4{margin:12px 0 6px}.ptb-source ul{padding-left:20px;overflow-wrap:anywhere}
.ptb-discussion-nav{position:sticky;top:0;z-index:1;background:var(--ptb-bg);padding:8px 0}.ptb-discussion-nav label{display:flex;gap:8px;align-items:center;font-size:12px}.ptb-discussion-nav select{min-width:0;flex:1;max-width:520px}.ptb-conclusion{display:inline-block;padding:3px 7px;border-radius:5px;background:var(--ptb-soft);color:#28795d;font-size:11px}.ptb-comment:focus{outline:2px solid #8078ec;outline-offset:2px}
.ptb-project-instructions,.ptb-quick-edit{display:grid;gap:10px;margin:10px 0}.ptb-quick-actions{display:grid;gap:8px;margin:10px 0}.ptb-project-instructions textarea,.ptb-quick-edit textarea{min-height:90px;resize:vertical}
.ptb-card-fields{display:flex;flex-wrap:wrap;gap:10px 16px;border:0;padding:8px 0;margin:8px 0}.ptb-card-fields label{display:flex;align-items:center;gap:6px;font-size:12px}.ptb-card-fields legend{font-size:12px}.ptb-swimlanes{flex:1;min-height:0;overflow:auto}.ptb-lane{margin-bottom:16px;min-width:0}.ptb-lane>h2{display:flex;align-items:center;gap:8px;font-size:13px;margin:0 0 8px}.ptb-lane>h2>button:first-child{white-space:normal;text-align:left;overflow-wrap:anywhere}.ptb-lane-columns{display:flex;gap:12px;align-items:stretch;overflow-x:auto;padding-bottom:8px}.ptb-lane-columns>.ptb-column{flex:1 0 264px}.ptb-lane-columns h3{font-size:12px;margin:0 0 10px}

.ptb-card-heading{display:flex;align-items:flex-start;gap:8px;margin:9px 0}.ptb-card .ptb-card-heading>h3{flex:1;min-width:0;margin:0}.ptb-card-heading .ptb-task-title{overflow-wrap:anywhere}.ptb-card .ptb-card-preview{flex-shrink:0;margin-left:auto;min-height:28px;line-height:18px;padding:4px 8px}

.ptb-notices{max-height:25vh;overflow:auto;flex-shrink:0;margin-bottom:12px}.ptb-notices>summary{cursor:pointer;color:var(--ptb-muted);padding:4px 0}.ptb-notices>button{margin:8px 0}.ptb-notice{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px;border-radius:8px}.ptb-notice+.ptb-notice{margin-top:4px}.ptb-notice-unread{background:var(--ptb-soft)}.ptb-notice-content{display:grid;gap:3px;min-width:0}.ptb-notice-title{font-size:13px;font-weight:550;overflow-wrap:anywhere}.ptb-notice-meta{font-size:11px;color:var(--ptb-muted)}.ptb-root .ptb-notice-actions{flex-shrink:0;gap:6px}
.ptb-root :is(.ptb-list-task-actions,.ptb-notice-actions,.ptb-preview-nav) button,.ptb-root .ptb-inline-trigger,.ptb-root .ptb-inline-form :is(button,input,select){min-height:30px;height:30px;padding:4px 9px;font-size:12px;line-height:20px;border-radius:6px;margin:0}.ptb-inline-form{display:flex;align-items:center;flex-wrap:wrap;gap:6px}.ptb-inline-form input{min-width:120px;max-width:220px}.ptb-inline-form .ptb-error{flex-basis:100%;font-size:12px}.ptb-list-task{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}.ptb-root .ptb-list-task-actions{gap:6px}.ptb-list-task>.ptb-task-title{overflow-wrap:anywhere;flex:1;min-width:160px}.ptb-list td{vertical-align:middle}
.ptb-gantt{min-height:0;flex:1;overflow:auto;padding:12px 0}.ptb-gantt-range{display:flex;justify-content:space-between;margin-left:220px;min-width:600px;font-size:11px;color:var(--ptb-muted);padding:0 0 10px}.ptb-gantt-row{display:flex;align-items:center;gap:12px;min-width:840px;padding:10px 0;border-top:1px solid var(--ptb-border);--ptb-status:var(--ptb-muted)}.ptb-root .ptb-gantt-name{width:208px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;text-align:left;background:transparent;border-color:transparent;padding:4px 8px;font-size:12px}.ptb-gantt-track{position:relative;height:30px;flex:1;min-width:600px;border-radius:6px;background:repeating-linear-gradient(to right,transparent 0,transparent calc(25% - 1px),var(--ptb-border) calc(25% - 1px),var(--ptb-border) 25%),var(--ptb-soft)}.ptb-root .ptb-gantt-bar{position:absolute;top:3px;height:24px;min-height:24px;overflow:hidden;text-overflow:ellipsis;background:var(--ptb-bg);border:1px solid var(--ptb-status);border-left-width:4px;color:var(--ptb-text);min-width:4px;padding:1px 8px;border-radius:5px;font-size:11px;line-height:20px;text-align:left;box-shadow:0 1px 2px #00000008}.ptb-root .ptb-gantt-bar:hover{background:var(--ptb-bg);outline:1px solid var(--ptb-status)}.ptb-root .ptb-gantt-point{border-left-width:4px;border-style:dashed;border-left-style:solid}.ptb-root .ptb-gantt-unscheduled h2{font-size:12px;font-weight:600;color:var(--ptb-muted);margin:20px 0 8px}.ptb-root .ptb-gantt-unscheduled p{display:inline-flex;margin:0 6px 6px 0}.ptb-gantt-unscheduled button{font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis}
.ptb-board{position:relative}.ptb-preview{position:absolute;right:0;top:0;bottom:0;width:min(600px,100%);z-index:10;background:var(--ptb-bg);border-left:1px solid var(--ptb-border);display:flex;flex-direction:column;overflow:hidden;box-shadow:-8px 0 24px #0002}.ptb-preview-nav{flex-shrink:0;padding:12px 20px;border-bottom:1px solid var(--ptb-border);background:var(--ptb-soft)}.ptb-preview-nav button:last-child{margin-left:auto}.ptb-preview .ptb-detail{padding:20px;flex:1;min-height:0;height:auto;overflow:auto}.ptb-preview .ptb-header{align-items:flex-start;gap:12px;margin-bottom:16px}.ptb-preview .ptb-header h1{font-size:18px;line-height:1.5;font-weight:650;letter-spacing:0;overflow-wrap:anywhere;min-width:0}.ptb-preview .ptb-header>button{flex-shrink:0;font-size:12px;min-height:30px;padding:4px 9px}.ptb-preview .ptb-detail-body h2{font-size:14px;line-height:1.5;font-weight:650;margin:24px 0 10px}.ptb-preview .ptb-detail-body h3{font-size:12px;line-height:1.5;font-weight:600;color:var(--ptb-muted);margin:16px 0 6px}.ptb-preview .ptb-detail-body>p.ptb-muted{font-size:12px;overflow-wrap:anywhere}.ptb-preview .ptb-detail-body>p.ptb-muted+p.ptb-muted{margin-top:4px}
@media(max-width:900px){.ptb-notice{align-items:flex-start;flex-direction:column;gap:8px}.ptb-root .ptb-notice-actions{flex-shrink:1}.ptb-preview-nav{padding-inline:16px}.ptb-preview .ptb-detail{padding:16px}}

.ptb-list{flex:1;min-height:0;overflow:auto}.ptb-list table{width:100%;border-collapse:collapse;text-align:left}.ptb-list th,.ptb-list td{padding:10px;border-bottom:1px solid var(--ptb-border);vertical-align:middle}.ptb-list th{position:sticky;top:0;background:var(--ptb-soft);z-index:1}.ptb-list td{min-width:80px}.ptb-list td:nth-child(2){min-width:220px}.ptb-quote{margin:8px 0;padding:8px 12px;border-left:3px solid #8078ec;background:var(--ptb-soft);white-space:pre-wrap;overflow-wrap:anywhere}.ptb-root button[aria-pressed="true"]{border-color:#5852cc}.ptb-resolved{margin:12px 0;padding:8px;background:var(--ptb-soft);border-radius:6px}.ptb-resolved>summary{cursor:pointer}.ptb-file-summary{margin-top:18px}.ptb-file-summary>summary{cursor:pointer;margin-bottom:8px}

.ptb-tools{flex-shrink:0;margin-bottom:14px;max-height:28vh;overflow:auto}.ptb-tools>summary{cursor:pointer;color:var(--ptb-muted);padding:4px 0}.ptb-tools .ptb-actions{margin-top:8px}.ptb-tools input{max-width:160px}.ptb-root input[type="checkbox"]{height:14px;width:14px;flex-shrink:0;padding:0;accent-color:#5852cc}.ptb-batch{padding-top:8px;border-top:1px solid var(--ptb-border)}

.ptb-comment{padding:14px 0;border-bottom:1px solid var(--ptb-border);font-size:13px}.ptb-comment-meta{display:flex;gap:12px;align-items:center;margin-bottom:6px}.ptb-comment-meta time{color:var(--ptb-muted);font-size:11px}.ptb-comment .ptb-actions{margin-top:10px}.ptb-comments>.ptb-form{margin-top:18px;max-width:none}.ptb-reply{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:8px;background:var(--ptb-soft)}

.ptb-focus{flex-shrink:0;margin-bottom:16px}.ptb-root .ptb-focus button[aria-pressed="true"]{background:#5852cc;color:#fff;border-color:#5852cc}.ptb-root .ptb-task-title{border:0;background:none;padding:0;font:inherit;text-align:left;white-space:normal}.ptb-detail-body{max-width:900px;margin:auto}.ptb-detail-body h2{font-size:18px;margin:24px 0 12px}.ptb-detail-body h3{margin:12px 0 6px}.ptb-detail pre{padding:12px;background:var(--ptb-soft);font:inherit}.ptb-detail summary{cursor:pointer}

.ptb-root{--ptb-bg:var(--color-background-primary-default,#fff);--ptb-soft:var(--color-background-secondary-default,#f4f5f7);--ptb-text:var(--color-text-primary,#222);--ptb-muted:var(--color-text-secondary,#697386);--ptb-border:var(--color-border-button-default,#dfe3e8);box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:28px;color:var(--ptb-text);background:var(--ptb-bg);font-size:13px;line-height:1.6}
.ptb-root *{box-sizing:border-box}.ptb-root h1,.ptb-root h2,.ptb-root h3,.ptb-root h4,.ptb-root p{margin:0}.ptb-root h1{font-size:25px;letter-spacing:-.5px;font-weight:650}.ptb-header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}.ptb-header p,.ptb-muted,.ptb-path,.ptb-engine,.ptb-footer{color:var(--ptb-muted)}.ptb-eyebrow{font-size:10px;font-weight:650;letter-spacing:2px;color:var(--ptb-muted);margin-bottom:7px}.ptb-actions{display:flex;flex-wrap:wrap;gap:7px;align-items:center}
.ptb-root button,.ptb-root input,.ptb-root select,.ptb-root textarea{font:inherit;color:inherit;border:1px solid var(--ptb-border);border-radius:7px;background:var(--ptb-bg);padding:7px 10px}.ptb-root button{cursor:pointer;white-space:nowrap;font-weight:500}.ptb-root button:hover:not(:disabled){background:var(--ptb-soft)}.ptb-root button:disabled{opacity:.45;cursor:not-allowed}.ptb-root .ptb-primary{background:#5852cc;color:#fff;border-color:#5852cc}.ptb-root .ptb-primary:hover:not(:disabled){background:#4842b6}.ptb-root :is(button,input,select,textarea,summary):focus-visible{outline:2px solid #8078ec;outline-offset:2px}.ptb-root select{max-width:100%}.ptb-toolbar{display:flex;align-items:center;gap:12px;margin-bottom:22px;flex-wrap:wrap}.ptb-toolbar select{max-width:300px}.ptb-toolbar input{width:220px}.ptb-toolbar>span{margin-left:auto}.ptb-banner{padding:12px;border:1px solid var(--ptb-border);border-radius:8px;margin-bottom:16px}.ptb-root .ptb-error{color:#cf4848;overflow-wrap:anywhere}.ptb-columns{display:flex;gap:16px;align-items:stretch;overflow-x:auto;min-height:0;padding-bottom:12px}.ptb-column{flex:1 0 264px;max-width:380px;min-width:264px;min-height:0;background:var(--ptb-soft);border-radius:10px;padding:12px;--ptb-status:#8a8f9e}.ptb-column>h2{font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;margin-bottom:14px}.ptb-dot{width:8px;height:8px;border-radius:50%;background:var(--ptb-status)}.ptb-status-running{--ptb-status:#7264dc}.ptb-status-review{--ptb-status:#d39928}.ptb-status-blocked{--ptb-status:#d45b5b}.ptb-status-done{--ptb-status:#369776}.ptb-count{margin-left:auto;font-size:11px;color:var(--ptb-muted)}.ptb-card{background:var(--ptb-bg);border:1px solid var(--ptb-border);border-radius:8px;padding:14px;margin-bottom:10px;box-shadow:0 1px 2px #00000005;overflow-wrap:anywhere}.ptb-card h3{font-size:14px;line-height:1.6;margin:9px 0;font-weight:600}.ptb-card-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:var(--ptb-muted)}.ptb-priority{padding:1px 6px;border-radius:4px;background:var(--ptb-soft)}.ptb-high{color:#cb5941}.ptb-medium{color:#a67720}.ptb-low{color:#568c78}.ptb-path{white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:11px}.ptb-engine{font-size:11px;margin:3px 0 10px!important}.ptb-card summary{cursor:pointer;color:var(--ptb-muted);font-size:11px;padding:5px 0}.ptb-card h4{font-size:11px;margin-top:8px}.ptb-content{white-space:pre-wrap;overflow-wrap:anywhere}.ptb-card .ptb-actions{margin-top:12px}.ptb-card button{font-size:11px;padding:4px 8px}.ptb-card>.ptb-muted,.ptb-card>.ptb-error{font-size:11px;margin-top:9px}.ptb-column-empty{padding:20px 0;text-align:center;color:var(--ptb-muted);font-size:11px}.ptb-run{font-size:10px;padding:8px 0;border-top:1px solid var(--ptb-border)}.ptb-run button{display:block;margin-top:5px}.ptb-history{margin-top:10px}.ptb-recovery{background:var(--ptb-soft);padding:9px;border-radius:5px;font-size:11px;margin-top:10px}.ptb-recovery button{margin-top:7px}.ptb-footer{font-size:10px;margin-top:20px}.ptb-form{display:grid;grid-template-columns:1fr 1fr;gap:14px;border:1px solid var(--ptb-border);border-radius:10px;padding:20px;margin-bottom:24px;max-width:850px}.ptb-field{display:flex;flex-direction:column;gap:6px;min-width:0}.ptb-field>span{font-size:12px;font-weight:550}.ptb-field textarea{resize:vertical;min-height:90px}.ptb-wide{grid-column:1/-1}.ptb-empty{text-align:center;padding:60px 20px}.ptb-empty>svg{width:38px;height:38px;color:#7264dc}.ptb-empty h2{font-size:19px;margin:15px 0 6px}.ptb-empty p{color:var(--ptb-muted);margin-bottom:20px}.ptb-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
@media(max-width:700px){.ptb-root{padding:18px}.ptb-header{align-items:flex-start;flex-direction:column}.ptb-form{grid-template-columns:1fr}.ptb-toolbar>span{margin-left:0}.ptb-toolbar input{width:100%}}
.ptb-empty>svg{margin-inline:auto}
.ptb-editor>.ptb-header,.ptb-editor>.ptb-banner{max-width:850px;margin-inline:auto}.ptb-editor>.ptb-form{margin-inline:auto;margin-bottom:0}
.ptb-board{display:flex;flex-direction:column;overflow:hidden}.ptb-board>.ptb-header,.ptb-board>.ptb-toolbar,.ptb-board>.ptb-banner,.ptb-board>.ptb-footer{flex-shrink:0}.ptb-board>.ptb-footer{margin-top:12px}.ptb-board>.ptb-columns{flex:1;min-height:0}.ptb-column{display:flex;flex-direction:column}.ptb-column>h2{flex-shrink:0}.ptb-column-content{flex:1;min-height:0;overflow-y:auto;scrollbar-gutter:stable}.ptb-root .ptb-column-toggle{display:flex;align-items:center;gap:8px;width:100%;padding:0;border:0;border-radius:4px;background:transparent;text-align:left;font:inherit}.ptb-column-toggle .ptb-dot{flex-shrink:0}.ptb-chevron{font-size:10px;color:var(--ptb-muted)}.ptb-column.ptb-column-collapsed{flex:0 0 48px;min-width:48px;max-width:48px;padding:12px 8px}.ptb-column-collapsed>h2{margin-bottom:0}.ptb-column-collapsed .ptb-column-toggle{flex-direction:column;gap:12px}.ptb-column-collapsed .ptb-column-label{writing-mode:vertical-rl;letter-spacing:3px}.ptb-column-collapsed .ptb-count{margin:0}
.ptb-toolbar>label{display:flex;align-items:center;min-width:0}.ptb-root select,.ptb-root input{height:36px;line-height:20px;margin:0;padding:7px 10px;vertical-align:middle}.ptb-field select,.ptb-field input{width:100%}.ptb-attachment-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px}.ptb-attachment-controls>span{font-size:11px}.ptb-attachments{list-style:none;padding:0;margin:8px 0 0;display:grid;gap:6px}.ptb-attachments li{display:flex;align-items:center;gap:8px;min-width:0}.ptb-attachments li>span{overflow-wrap:anywhere;flex:1;min-width:0}.ptb-attachments button{font-size:11px}.ptb-attachment-field{min-width:0}
.ptb-tools .ptb-actions>label{display:inline-flex;align-items:center;gap:6px;min-height:36px;line-height:20px;white-space:nowrap;margin:0}.ptb-tools .ptb-actions>label.ptb-actions{margin-top:0}.ptb-tools .ptb-actions>input,.ptb-tools .ptb-actions>select,.ptb-tools .ptb-actions>button{height:36px;line-height:20px}.ptb-tools .ptb-actions>label>select{margin:0}.ptb-tools .ptb-actions>label>input[type="checkbox"]{margin:0;vertical-align:middle}
.ptb-toolbar>label{gap:6px;white-space:nowrap}

.ptb-settings{display:flex;flex-direction:column;overflow:hidden;padding-bottom:0}
.ptb-settings>.ptb-header{flex-shrink:0;padding-bottom:20px;margin-bottom:0;border-bottom:1px solid var(--ptb-border)}
.ptb-settings-layout{display:grid;grid-template-columns:198px minmax(0,1fr);flex:1;min-height:0}
.ptb-settings-nav{border-right:1px solid var(--ptb-border);padding:22px 14px 20px 0;overflow-y:auto}
.ptb-settings-nav>h2{font-size:12px;color:var(--ptb-muted);padding:0 12px;margin-bottom:14px}
.ptb-root .ptb-settings-nav>button{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;border-left:3px solid transparent;border-radius:6px;padding:12px 10px;margin-bottom:7px;white-space:normal;font-size:12px;min-height:44px}
.ptb-settings-nav svg{width:19px;height:19px;flex-shrink:0}
.ptb-root .ptb-settings-nav>button[aria-current="page"]{background:color-mix(in srgb,#6254ce 9%,var(--ptb-bg));color:#6254ce;border-left-color:#6254ce;font-weight:600}
.ptb-root .ptb-settings-nav>button[aria-current="page"]:hover{background:var(--ptb-soft);color:#6254ce}
.ptb-settings-count{margin-left:auto;padding:1px 7px;background:var(--ptb-bg);border-radius:12px;color:var(--ptb-muted);font-size:11px}
.ptb-settings-main{min-width:0;min-height:0;overflow:auto;padding:22px 0 24px 22px}
.ptb-settings-breadcrumb{font-size:12px;color:var(--ptb-muted);margin-bottom:18px!important}
.ptb-settings-panel[hidden]{display:none}
.ptb-settings-collection{display:grid;grid-template-columns:minmax(180px, .7fr) minmax(0,1.5fr);gap:18px;align-items:start}
.ptb-settings-list,.ptb-settings-editor,.ptb-settings-card{min-width:0;border:1px solid var(--ptb-border);border-radius:9px;background:var(--ptb-bg);overflow:hidden}
.ptb-settings-list>header,.ptb-settings-editor-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px;border-bottom:1px solid var(--ptb-border)}
.ptb-settings h2{font-size:14px;font-weight:600}
.ptb-settings-list>header{flex-wrap:wrap}
.ptb-settings-list>header>button{font-size:11px;padding:5px 9px;color:#6254ce}
.ptb-settings-items{padding:8px;max-height:65vh;overflow:auto}
.ptb-root .ptb-settings-item{display:block;text-align:left;width:100%;white-space:normal;border:1px solid transparent;padding:14px 10px;margin-bottom:4px}
.ptb-settings-item strong,.ptb-settings-item small{display:block;overflow-wrap:anywhere}
.ptb-settings-item strong{font-size:13px;font-weight:600}.ptb-settings-item small{font-size:11px;color:var(--ptb-muted);margin-top:4px}
.ptb-root .ptb-settings-item[aria-pressed="true"]{background:color-mix(in srgb,#6254ce 7%,var(--ptb-bg));border-color:#8078ec}
.ptb-settings-empty{padding:16px 8px;color:var(--ptb-muted);font-size:12px}
.ptb-settings-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px 16px;padding:20px}
.ptb-settings-check{display:flex;align-items:center;gap:8px;font-size:12px}
.ptb-settings-options{margin:0;border:1px solid var(--ptb-border);border-radius:7px;padding:12px;display:flex;flex-wrap:wrap;gap:10px 18px;min-width:0}
.ptb-settings-options legend{padding:0 4px;font-size:12px;font-weight:550}
.ptb-settings-options label{display:flex;align-items:center;gap:7px;overflow-wrap:anywhere;min-width:0}
.ptb-settings-options label input{flex-shrink:0}
.ptb-settings-save{display:flex;justify-content:flex-end;gap:10px;padding:16px 20px;border-top:1px solid var(--ptb-border)}
.ptb-settings-editor>.ptb-error{padding:0 20px 16px}
.ptb-settings-card{padding:20px}.ptb-settings-card>h2{margin-bottom:20px}
.ptb-settings-card>details{border-top:1px solid var(--ptb-border);padding:14px 0}
.ptb-settings-card>details>summary{cursor:pointer;overflow-wrap:anywhere}
.ptb-settings-card>.ptb-actions{margin-bottom:14px}
@media(max-width:1100px){.ptb-settings-collection{grid-template-columns:minmax(150px,.65fr) minmax(0,1.5fr)}.ptb-settings-layout{grid-template-columns:172px minmax(0,1fr)}.ptb-settings-fields{grid-template-columns:minmax(0,1fr)}.ptb-settings-nav{padding-right:10px}.ptb-settings-main{padding-left:16px}.ptb-settings-list>header{padding:12px}}
@media(max-width:760px){.ptb-settings{overflow:auto}.ptb-settings-layout{grid-template-columns:minmax(0,1fr);min-height:auto}.ptb-settings-nav{display:flex;gap:6px;border-right:0;border-bottom:1px solid var(--ptb-border);padding:14px 0;overflow-x:auto}.ptb-settings-nav>h2{display:none}.ptb-root .ptb-settings-nav>button{flex:0 0 auto;width:auto;margin:0;white-space:nowrap;padding:8px}.ptb-settings-main{overflow:visible;padding:16px 0}.ptb-settings-collection{grid-template-columns:minmax(0,1fr)}.ptb-settings-items{max-height:200px}.ptb-settings>.ptb-header{flex-direction:row;align-items:center}.ptb-settings h1{font-size:20px}.ptb-settings-fields{padding:16px}.ptb-settings-nav svg{width:16px;height:16px}}

.ptb-agent-avatar{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex-shrink:0;border:1px solid var(--ptb-border);border-radius:9px;background:var(--ptb-soft);font-family:"Apple Color Emoji","Segoe UI Emoji",sans-serif;font-size:20px;line-height:1}
.ptb-agent-identity{display:flex;align-items:center;gap:9px;min-width:0;overflow-wrap:anywhere}
.ptb-assignee-field{flex:1}.ptb-card-assignee{font-size:11px;color:var(--ptb-muted);margin-bottom:8px!important}
.ptb-card-assignee .ptb-agent-avatar,.ptb-comment-meta .ptb-agent-avatar{width:25px;height:25px;border-radius:7px;font-size:16px}
.ptb-settings-item-content{display:flex;align-items:center;gap:10px;min-width:0}.ptb-settings-item-content>span:last-child{min-width:0}
.ptb-avatar-picker{display:flex;flex-wrap:wrap;gap:8px;border:0;padding:0;margin:0;min-width:0}
.ptb-avatar-picker legend{font-size:12px;font-weight:550;margin-bottom:10px}
.ptb-root .ptb-avatar-picker button{width:38px;height:38px;padding:0;display:inline-flex;align-items:center;justify-content:center;font-size:23px;line-height:1;font-family:"Apple Color Emoji","Segoe UI Emoji",sans-serif}
.ptb-root .ptb-avatar-picker button[aria-pressed="true"]{border-color:#6254ce;background:color-mix(in srgb,#6254ce 12%,var(--ptb-bg));outline:1px solid #6254ce}
.ptb-board{container-type:inline-size}
.ptb-board-header{margin-bottom:24px;flex-wrap:wrap}.ptb-board-title{display:flex;align-items:center;gap:18px;flex-wrap:wrap}.ptb-board-title>span{font-size:13px}.ptb-board-header>.ptb-actions{margin-left:auto;flex-wrap:nowrap;gap:16px}
.ptb-board>.ptb-toolbar{padding-bottom:18px;margin-bottom:0}.ptb-board>.ptb-toolbar>input{flex:1;min-width:180px}.ptb-board>.ptb-toolbar>label{gap:10px}
.ptb-viewbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;flex-shrink:0;margin-bottom:20px}.ptb-viewbar .ptb-focus{margin:0;gap:6px}.ptb-root .ptb-focus button{border-color:transparent;background:transparent;font-size:14px;padding:7px 12px}.ptb-root .ptb-focus button[aria-pressed="true"]{color:color-mix(in srgb,#8078ec 70%,var(--ptb-text));background:var(--ptb-soft);border-color:transparent}.ptb-root .ptb-focus button:hover:not(:disabled){background:var(--ptb-soft)}
.ptb-layout-actions{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-left:auto}.ptb-layout-switch{display:flex;align-items:center;gap:2px}.ptb-root .ptb-layout-switch button{border:0;background:transparent;color:var(--ptb-muted);padding:7px 5px;font-size:14px}.ptb-root .ptb-layout-switch button[aria-pressed="true"]{color:var(--ptb-text);font-weight:650}.ptb-root .ptb-layout-switch button:hover:not(:disabled){background:var(--ptb-soft);color:var(--ptb-text)}
.ptb-board .ptb-notices{position:relative;overflow:visible;max-height:none;margin:0;flex-shrink:0}.ptb-board .ptb-notices>summary{display:flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;color:var(--ptb-text);border-radius:7px;list-style:none;position:relative}.ptb-notices>summary::-webkit-details-marker{display:none}.ptb-board .ptb-notices>summary:hover{background:var(--ptb-soft)}.ptb-notice-badge{position:absolute;top:-3px;right:-4px;min-width:17px;padding:0 4px;border-radius:12px;background:#cf4848;color:#fff;font-size:10px;line-height:17px;text-align:center}
.ptb-notice-popover{position:absolute;right:0;top:calc(100% + 12px);width:min(580px,calc(100cqw - 32px));max-height:min(480px,65vh);overflow:auto;padding:18px;background:var(--ptb-bg);border:1px solid var(--ptb-border);border-radius:12px;box-shadow:0 12px 36px #0002;z-index:12}.ptb-notice-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.ptb-notice-header h2{font-size:16px}.ptb-notice-popover>.ptb-actions{margin:12px 0}.ptb-notice-popover>.ptb-notice{align-items:flex-start;flex-direction:column;gap:10px}.ptb-notice-popover>.ptb-notice>div{max-width:100%}.ptb-notice-popover button{white-space:normal}
.ptb-board>.ptb-tools:not([open]){display:none}.ptb-board>.ptb-tools[open]{padding:14px 18px;border:1px solid var(--ptb-border);border-radius:10px;background:var(--ptb-soft);margin-bottom:18px}.ptb-board>.ptb-tools>summary{color:var(--ptb-text)}
.ptb-board>.ptb-columns{gap:16px}.ptb-board .ptb-column{padding:16px;max-width:none;flex-basis:250px;min-width:250px}.ptb-board .ptb-column>h2{margin-bottom:18px}.ptb-board .ptb-card{padding:16px;margin-bottom:14px;border-radius:10px;box-shadow:0 2px 5px #00000006}.ptb-board .ptb-card h3{margin:12px 0;font-size:15px}.ptb-board .ptb-card-meta{font-size:12px}.ptb-board .ptb-card>.ptb-muted,.ptb-board .ptb-card>.ptb-error{font-size:12px}.ptb-board .ptb-card .ptb-actions{gap:6px}.ptb-card-more{flex-basis:100%}.ptb-card-more>.ptb-actions{margin-top:6px}.ptb-board .ptb-card-more>summary{font-size:12px}.ptb-board .ptb-column.ptb-column-collapsed{flex:0 0 48px;min-width:48px;max-width:48px;padding:12px 8px}
.ptb-board .ptb-list th,.ptb-board .ptb-list td{padding:15px 12px}.ptb-board .ptb-list thead th{font-size:12px;font-weight:500;color:var(--ptb-muted)}.ptb-board .ptb-list .ptb-list-group th{position:static;background:var(--ptb-soft);padding:10px 12px;font-size:12px;font-weight:600}.ptb-list-group .ptb-dot{display:inline-block;margin-right:8px}.ptb-status-label{white-space:nowrap;display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:6px;background:var(--ptb-soft);font-size:12px}.ptb-status-label::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ptb-status,#8a8f9e)}.ptb-list tr.ptb-row-selected{background:var(--ptb-soft)}.ptb-list-task .ptb-task-title{font-weight:550}
.ptb-layout-list>.ptb-preview{position:relative;right:auto;top:auto;bottom:auto;flex:0 1 45%;min-height:180px;width:100%;margin-top:16px;border:1px solid var(--ptb-border);border-radius:10px;box-shadow:none}.ptb-layout-list>.ptb-preview .ptb-detail-body{max-width:none}.ptb-layout-list>.ptb-preview .ptb-detail{padding:18px 24px}
.ptb-swimlanes .ptb-lane{border:1px solid var(--ptb-border);border-radius:10px;overflow:hidden;margin-bottom:18px;width:max-content;min-width:100%}.ptb-swimlanes .ptb-lane>h2{padding:12px 16px;background:var(--ptb-soft);margin:0;gap:14px;flex-wrap:wrap}.ptb-root .ptb-lane>h2>button:first-child{background:transparent;border:0;padding:0;font-weight:600;font-size:14px}.ptb-lane-progress{font-size:12px;font-weight:400}.ptb-swimlanes .ptb-lane-columns{gap:0;padding:0;overflow:visible}.ptb-swimlanes .ptb-lane-columns>.ptb-column{border-radius:0;background:transparent;border-right:1px solid var(--ptb-border);flex:0 0 280px;min-width:280px;padding:16px}.ptb-swimlanes .ptb-lane-columns>.ptb-column:last-child{border-right:0}.ptb-swimlanes .ptb-lane-columns h3{color:var(--ptb-muted);font-weight:500}.ptb-swimlanes .ptb-card h3{color:var(--ptb-text);font-weight:600}
@media(max-width:700px){.ptb-board-header{flex-direction:row;align-items:center;gap:16px}.ptb-board-header>.ptb-actions{margin-left:0}.ptb-board-title{gap:4px 12px}.ptb-board-title h1{font-size:22px}.ptb-layout-actions{margin-left:0}.ptb-board .ptb-notices{position:static}.ptb-notice-popover{top:112px;left:16px;right:16px;width:auto;max-height:55vh}.ptb-viewbar{gap:10px;margin-bottom:14px}.ptb-layout-list>.ptb-preview{flex-basis:50%}}

`;
