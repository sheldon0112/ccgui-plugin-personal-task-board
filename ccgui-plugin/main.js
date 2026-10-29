const STATUSES = { todo: "待办", running: "执行中", review: "待验收", blocked: "受阻", done: "已完成", cancelled: "已取消" };
const PRIORITIES = { high: "高", medium: "中", low: "低" };
const OUTCOMES = { running: "执行中", ended: "执行结束", error: "执行出错", stopped: "已请求停止，执行已结束", unknown: "运行状态待核对" };
const FILE = "tasks.json";
const message = (error) => error instanceof Error ? error.message : String(error);
const timestamp = () => new Date().toISOString();
const uid = () => globalThis.crypto.randomUUID();

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
  const add = (files, source) => { for (const file of files || []) {
    const type = /\.(png|jpe?g|gif|webp|svg|heic)$/i.test(file.name) ? "image" : /\.(mp4|mov|webm)$/i.test(file.name) ? "video" : /\.(md|txt|pdf|docx?|xlsx?|csv|pptx?|json)$/i.test(file.name) ? "document" : "other";
    items.push({ ...file, source, type });
  } };
  add(task.descriptionFiles, "需求"); add(task.criteriaFiles, "验收标准");
  for (const entry of task.comments || []) add(entry.files, `评论 ${new Date(entry.createdAt).toLocaleString("zh-CN")}`);
  for (const entry of task.feedbacks || []) add(entry.files, `反馈 ${new Date(entry.createdAt).toLocaleString("zh-CN")}`);
  return items;
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
  return { tasks: data.tasks, projects };
}

export function createBoard(ctx) {
  let state = { tasks: [], projects: [], ready: false, busy: false, error: "" };
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
  const persist = async (tasks, projects = state.projects) => {
    const result = await ctx.documentStorage.writeTextAtomic(FILE, JSON.stringify({ schemaVersion: 1, tasks, projects }, null, 2), version);
    version = result.version;
    publish({ tasks, projects });
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
    const { tasks, projects } = document ? parseDocument(document.content) : { tasks: [], projects: [] };
    version = document?.version ?? null;
    const recovered = tasks.map((task) => task.status !== "running" ? task : {
      ...task, status: "blocked", recovery: true,
      runs: task.runs.map((run) => run.outcome === "running" ? { ...run, outcome: "unknown" } : run),
    });
    if (tasks.some((task) => task.status === "running")) await persist(recovered, projects);
    publish({ tasks: recovered, projects, ready: true });
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

  const controller = {
    getSnapshot: () => state,
    canReload: () => !active && !state.busy,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    reload: () => enqueue(load),
    clearError: () => publish({ error: "" }),
    async save(input, id) {
      return enqueue(async () => {
        requireReady();
        const fields = validateTask(input);
        const visited = new Set(id ? [id] : []); let parentId = fields.parentId;
        while (parentId) { if (visited.has(parentId)) throw new Error("父子任务不能形成循环。"); visited.add(parentId); parentId = findTask(parentId).parentId; }
        if (id) {
          const task = findTask(id);
          if (task.status === "running" || task.recovery) throw new Error("请先结束或核对这项任务的执行，再编辑。");
          await replaceTask(id, (current) => ({ ...current, ...fields }));
          return id;
        }
        const newId = uid();
        await persist([...state.tasks, { ...fields, ...(typeof input.sourceSnapshot === "string" ? { sourceSnapshot: input.sourceSnapshot } : {}), id: newId, status: "todo", recovery: false, runs: [], feedbacks: [], pendingFeedbackIds: [], comments: [], createdAt: timestamp(), updatedAt: timestamp() }]);
        return newId;
      });
    },
    async saveProject(workspacePath, name, description) {
      return enqueue(async () => {
        requireReady();
        if (typeof workspacePath !== "string" || !workspacePath || typeof name !== "string" || !name.trim() || typeof description !== "string") throw new Error("请选择工作区和项目，并填写有效说明。");
        const projects = state.projects.filter((entry) => entry.workspacePath !== workspacePath || entry.name !== name.trim());
        if (description.trim()) projects.push({ workspacePath, name: name.trim(), description: description.trim() });
        await persist(state.tasks, projects);
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
    async addComment(id, { content, replyTo = null, files = [], quoteSourceId = null, quoteSnapshot = null }) {
      const saved = await enqueue(async () => {
        requireReady();
        const task = findTask(id);
        files = normalizeFiles(files);
        if (typeof content !== "string" || (!content.trim() && !files.length)) throw new Error("请填写评论或选择附件。");
        if (replyTo && !(task.comments || []).some((entry) => entry.id === replyTo) && !task.runs.some((run) => `run:${run.id}` === replyTo)) throw new Error("回复的评论不存在，请重新选择。");
        if (task.duplicateOf && routesToAgent(task, content, replyTo)) throw new Error("重复任务不能触发执行，请打开原任务，或先撤销重复标记。");
        const quoted = quoteSourceId ? (task.comments || []).find((entry) => entry.id === quoteSourceId) : null;
        if (quoteSourceId && !quoted) throw new Error("引用的评论不存在。");
        const quote = quoteSnapshot ? normalizeQuote(task, quoteSnapshot) : quoted ? { sourceId: quoted.id, text: quoted.content.slice(0, 4000) } : null;
        const comment = { id: uid(), quote, content: content.trim(), files, replyTo, triggerAgent: routesToAgent(task, content, replyTo), createdAt: timestamp(), resolvedAt: null };
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
    async start(id, commentId = null, retryRunId = null) {
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
          const retry = retryRunId ? original.runs.find((run) => run.id === retryRunId) : null;
          if (retryRunId && (!retry || !["error", "stopped"].includes(retry.outcome) || !retry.input)) throw new Error("只有保留输入快照的失败或中断轮次可以重试。");
          const current = retry ? { ...original, engine: retry.input.engine, model: retry.input.model, providerId: retry.input.providerId, workspacePath: retry.input.workspacePath } : original;
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
          resume = retry ? null : resumeTarget(current, commentId, ctx.sessions.supportsResume === true);
          const projectDescription = retry ? retry.input.projectDescription || "" : state.projects.find((entry) => entry.workspacePath === current.workspacePath && entry.name === current.project)?.description || "";
          prompt = retry ? retry.input.prompt : buildPrompt(current, commentId, projectDescription);
          owner = { taskId: id, attemptId: uid(), runId: null, engine: current.engine, workspacePath: current.workspacePath };
          await replaceTask(id, (item) => ({ ...item, status: "running", runs: [...item.runs, {
            id: owner.attemptId, runId: null, sessionId: null, engine: current.engine, model: current.model, providerId: current.providerId || "", workspacePath: current.workspacePath,
            ...(retry ? { retryOf: retry.id } : {}),
            startedAt: timestamp(), endedAt: null, outcome: "running", error: "", stopRequested: false,
            feedbackIds: [...(retry ? retry.feedbackIds || [] : item.pendingFeedbackIds || [])],
            resumeSessionId: resume?.sessionId || null,
            commentId, commentIds: retry ? [...(retry.commentIds || [])] : commentId ? [commentId] : [],
            input: { prompt, projectDescription, sessionId: resume?.sessionId || null, engine: current.engine, model: current.model, providerId: current.providerId || "", workspacePath: current.workspacePath },
          }] }));
          active = owner;
          pendingEvents = [];
          return current;
        });
        const handle = await ctx.sessions.startRun({ ...(resume ? { sessionId: resume.sessionId } : {}), engine: task.engine, workspacePath: task.workspacePath, prompt, model: task.model || null, ...(task.providerId ? { providerId: task.providerId } : {}) });
        spawned = true;
        owner.runId = handle.runId;
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
    dispose() { disposed = true; unsubscribe(); listeners.clear(); },
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
      if (formBusy) return;
      setSaving(true);
      void act(async () => { const id = await board.save(draft, task?.id); onSaved(id); }).finally(() => { if (mounted.current) setSaving(false); });
    } },
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
    h("div", { className: "ptb-wide ptb-actions" }, h("button", { type: "submit", className: "ptb-primary", disabled: formBusy || catalog.loading }, saving ? "保存中…" : "保存任务"), button("取消", onCancel, { disabled: formBusy })));
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
      h("p", { ref: paragraph, tabIndex: -1, className: "ptb-content", onMouseUp: capture, onKeyUp: capture, "data-quote-kind": kind, "data-quote-source": sourceId }, text),
      selectedText.trim() && h("div", { className: "ptb-selection-actions" },
        button(draft.quoteSnapshot || draft.quoteSourceId ? "替换评论引用" : "加入评论引用", (event) => {
          void viewStore.update({ drafts: { ...viewStore.getSnapshot().drafts, [task.id]: { ...viewStore.getSnapshot().drafts[task.id], quoteSourceId: null, quoteSnapshot: { kind, sourceId, text: selectedText }, replyTo: kind === "comment" ? sourceId : null } } });
          const composer = event.currentTarget.closest(".ptb-detail-body")?.querySelector(".ptb-comment-composer");
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
      node.scrollIntoView?.({ block: "center" }); node.focus();
    };
    const comments = task.comments || [];
    const trigger = routesToAgent(task, content, replyTo);
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
        const result = await board.addComment(task.id, { content, replyTo, files, quoteSourceId, quoteSnapshot });
        if (mounted.current) { void updateDraft({ content: "", replyTo: null, files: [], quoteSourceId: null, quoteSnapshot: null }); setError(result.deliveryError); }
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
          h("div", { className: "ptb-comment-meta" }, h("strong", null, entry.author), h("time", null, new Date(entry.createdAt).toLocaleString("zh-CN"))),
          task.threadConclusions?.[root] === entry.id && h("span", { className: "ptb-conclusion", role: "status" }, "讨论结论"),
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

  function TaskDetails({ taskId = null, onClose = null } = {}) {
    const state = useSyncExternalStore(board.subscribe, board.getSnapshot);
    const request = useSyncExternalStore(detailStore.subscribe, detailStore.getSnapshot);
    const task = state.tasks.find((entry) => entry.id === (taskId || request?.taskId));
    const [error, setError] = useState("");
    const act = async (operation) => { setError(""); try { await operation(); } catch (error) { setError(message(error)); } };
    const files = (items) => h("ul", { className: "ptb-attachments" }, ...(items || []).map((file) => h("li", { key: file.path }, button(file.name, () => void act(() => ctx.shell.revealPath(file.path)), { title: file.path }))));
    return h("section", { className: "ptb-root ptb-detail", "aria-label": "任务详情" }, h("style", null, CSS),
      h("header", { className: "ptb-header" }, h("h1", null, task?.title || "任务详情"), onClose ? button("关闭预览", onClose) : button("返回看板", () => ctx.ui.openCenterTab("board"))),
      error && h("p", { role: "alert", className: "ptb-error" }, error),
      !task ? h("p", null, "请从任务卡片打开详情。") : h("div", { className: "ptb-detail-body" },
        h("p", { className: "ptb-muted" }, `${STATUSES[task.status]} · ${PRIORITIES[task.priority]}优先级 · ${task.workspacePath}`),
        h("p", { className: "ptb-muted" }, `${task.project ? `项目 ${task.project} · ` : ""}${(task.tags || []).join(" · ")}${task.dueDate ? ` · 截止 ${task.dueDate}${isOverdue(task) ? "（已逾期）" : ""}` : ""}`),
        h(TaskRelations, { key: `relations:${task.id}`, task, tasks: state.tasks, act }),
        h("h2", null, "原始任务清单"), button("编辑任务", () => openEditor(task), { disabled: task.status === "running" || task.recovery }),
        h("h3", null, "需求"), h(SelectableText, { task, kind: "description", sourceId: task.id, text: task.description }), files(task.descriptionFiles),
        h("h3", null, "验收标准"), h(SelectableText, { task, kind: "criteria", sourceId: task.id, text: task.criteria }), files(task.criteriaFiles),
        h(AttachmentSummary, { key: `files:${task.id}`, task, act }),
        h(TaskComments, { key: `comments:${task.id}`, task, occupied: state.busy || state.tasks.some((entry) => entry.status === "running" || entry.recovery) }),
        h("h2", null, "验收反馈"), !(task.feedbacks || []).length && h("p", null, "暂无反馈"), ...(task.feedbacks || []).map((entry) => h("article", { className: "ptb-run", key: entry.id }, h("p", null, `${new Date(entry.createdAt).toLocaleString("zh-CN")} · ${entry.resolvedAt ? "已通过复验" : "未通过"}`), h("p", { className: "ptb-content" }, entry.content), files(entry.files))),
        h("h2", null, "历次执行与输入"), !task.runs.length && h("p", null, "暂无执行"), ...task.runs.slice().reverse().map((run) => h("article", { className: "ptb-run", key: run.id },
          h("h3", null, `${new Date(run.startedAt).toLocaleString("zh-CN")} · ${OUTCOMES[run.outcome]}`),
          h("p", null, `${run.engine} · ${run.model || "宿主默认模型"}${run.providerId ? ` · 渠道 ${run.providerId}` : ""} · ${run.workspacePath}`),
          run.retryOf && h("p", { className: "ptb-muted" }, "历史输入重试 · 新会话"),
          ["error", "stopped"].includes(run.outcome) && h("details", { className: "ptb-retry", "aria-label": "历史轮次重试" }, h("summary", null, "按此轮输入重试"),
            run.input ? h("div", null,
              h("p", null, "使用本轮记录的输入、工作区、引擎、模型和渠道创建新会话，不包含之后新增的需求或反馈。附件按原路径读取当前文件；模型留空时使用宿主当前默认模型。"),
              h("pre", { className: "ptb-content" }, run.input.prompt),
              button("确认按历史输入重试", () => void act(() => board.start(task.id, null, run.id)), { disabled: state.busy || state.tasks.some((entry) => entry.status === "running" || entry.recovery) || !["todo", "blocked", "review"].includes(task.status) || Boolean(task.duplicateOf) })) : h("p", null, "旧轮次缺少输入快照，无法按历史输入重试。")),
          button("打开本轮会话", () => void act(() => board.open(run)), { disabled: !run.sessionId }),
          run.error && h("p", { className: "ptb-error" }, run.error),
          h("details", { open: request?.runId === run.id }, h("summary", null, "查看本轮执行输入"), run.input ? h("pre", { className: "ptb-content" }, run.input.prompt) : h("p", null, "旧轮次未记录输入快照。"))))));
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

  function ProjectInstructions({ workspacePath, name, description, disabled }) {
    const [value, setValue] = useState(description);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [saved, setSaved] = useState(false);
    return h("div", { className: "ptb-project-instructions" },
      h("p", { className: "ptb-muted" }, "说明会随下一轮执行发送给 AI；清空并保存可移除。"),
      h("label", { className: "ptb-field" }, h("span", null, "项目共享说明"), h("textarea", { rows: 4, value, disabled: disabled || saving, onChange: (event) => { setValue(event.target.value); setSaved(false); } })),
      button(saving ? "保存中…" : "保存项目说明", async () => {
        setSaving(true); setError(""); setSaved(false);
        try { await board.saveProject(workspacePath, name, value); setSaved(true); } catch (error) { setError(message(error)); } finally { setSaving(false); }
      }, { disabled: disabled || saving }),
      error && h("p", { role: "alert", className: "ptb-error" }, error), saved && h("p", { role: "status" }, "项目说明已保存"));
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
    const [viewName, setViewName] = useState("");
    const [previewId, setPreviewId] = useState(null);
    const searchInput = useRef(null);
    const selectionAnchor = useRef(null);
    const [archivedNotices, setArchivedNotices] = useState(false);
    const selectedVisible = selected.filter((id) => selectTasks(state.tasks, view).some((task) => task.id === id));
    async function act(operation) {
      setLocalError(""); board.clearError(); setPending(true);
      try { await operation(); } catch (error) { setLocalError(message(error)); }
      finally { setPending(false); }
    }
    const locked = state.busy || pending;
    const occupied = state.tasks.some((task) => task.status === "running" || task.recovery);
    const tasks = selectTasks(state.tasks, view);
    const canCreate = state.ready && !resources.loading && resources.engines.length > 0 && resources.workspaces.length > 0;
    const error = localError || state.error || resources.error || view.error;

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
          !task.recovery && ["todo", "blocked", "review"].includes(task.status) && button(needsRevision ? "执行修正" : task.runs.length ? "重新执行" : "开始执行", () => void act(() => board.start(task.id)), { disabled: locked || occupied, className: "ptb-primary" }),
          task.status === "running" && button(latest?.stopRequested ? "已请求停止" : "停止执行", () => void act(() => board.stop(task.id)), { disabled: locked || latest?.stopRequested }),
          latest && button("打开会话", () => void act(() => board.open(latest)), { disabled: locked || !latest.sessionId, title: latest.sessionId ? "在原生聊天中查看结果" : "等待引擎返回会话标识" }),
          task.status === "review" && button("验收通过", () => void act(() => board.setStatus(task.id, "done")), { disabled: locked }),
          !task.recovery && (task.status === "review" || (task.status === "todo" && Boolean(task.pendingFeedbackIds?.length))) && button(task.status === "review" ? "验收不通过" : "补充反馈", () => openFeedback(task), { disabled: locked }),
          !task.recovery && task.status !== "running" && button("编辑", () => openEditor(task), { disabled: locked }),
          !task.recovery && ["done", "cancelled", "review", "blocked"].includes(task.status) && button("移回待办", () => void act(() => board.setStatus(task.id, "todo")), { disabled: locked }),
          !task.recovery && ["todo", "blocked", "review"].includes(task.status) && button("取消任务", () => void act(() => board.setStatus(task.id, "cancelled")), { disabled: locked })),
        task.feedbacks?.length > 0 && h("details", { className: "ptb-history" }, h("summary", null, `验收反馈 · ${task.feedbacks.length}`), ...task.feedbacks.slice().reverse().map((entry) => h("div", { key: entry.id, className: "ptb-run" },
          h("p", { className: "ptb-muted" }, `${new Date(entry.createdAt).toLocaleString("zh-CN")} · ${entry.resolvedAt ? "已通过复验" : "未通过"}`), h("p", { className: "ptb-content" }, entry.content), fileLinks(entry.files),
          button("查看对应结果", () => void act(() => board.open(task.runs.find((run) => run.id === entry.afterRunId))), { disabled: locked || !task.runs.find((run) => run.id === entry.afterRunId)?.sessionId })))),
        task.runs.length > 0 && h("details", { className: "ptb-history" }, h("summary", null, `执行记录 · ${task.runs.length}`), ...task.runs.slice().reverse().map((run) => h("div", { key: run.id, className: "ptb-run" },
          h("span", null, `${new Date(run.startedAt).toLocaleString("zh-CN")} · ${OUTCOMES[run.outcome]}`),
          h("p", null, `${run.commentId ? "评论触发" : run.feedbackIds?.length ? "修正执行" : "任务执行"}${run.resumeSessionId ? " · 原会话续接" : ""}${run.reviewDecision === "rejected" ? " · 验收未通过" : run.reviewDecision === "accepted" ? " · 验收通过" : ""}`),
          button("查看输入", () => openDetails(task, run.id)),
          button("查看结果", () => void act(() => board.open(run)), { disabled: locked || !run.sessionId }), run.error && h("p", { className: "ptb-error" }, run.error)))));
    }

    function fileLinks(files) {
      return files?.length ? h("ul", { className: "ptb-attachments" }, ...files.map((file) => h("li", { key: file.path }, button(file.name, () => void act(() => ctx.shell.revealPath(file.path)), { title: `显示原文件：${file.path}`, disabled: locked })))) : null;
    }

    return h("section", { className: "ptb-root ptb-board", tabIndex: -1, onKeyDown: handleKey, "aria-label": "个人任务看板" },
      h("style", null, CSS),
      h("header", { className: "ptb-header" }, h("div", null, h("div", { className: "ptb-eyebrow" }, "个人工作台"), h("h1", null, "个人任务看板"), h("p", null, "把需求交给 AI，把验收留给自己。")),
        h("div", { className: "ptb-actions" }, button("重新载入", () => void act(async () => { await board.reload(); setReloadKey((key) => key + 1); }), { disabled: locked || !board.canReload() }), button("＋ 新建任务", () => openEditor(), { disabled: locked || !canCreate, className: "ptb-primary" }))),
      error && h("div", { className: "ptb-banner ptb-error", role: "alert" }, error),
      state.busy && h("p", { className: "ptb-banner", role: "status" }, "正在检查模型并启动原生会话…"),
      !state.ready && h("p", { role: "status" }, error ? "任务未载入，修复问题后请重新载入。" : "正在载入任务…"),
      !resources.loading && (!resources.engines.length || !resources.workspaces.length) && h("p", { className: "ptb-banner" }, "请先在 CC GUI 中添加工作区并启用可用的 AI 引擎，再点击重新载入。"),
      h("div", { className: "ptb-toolbar" }, h("label", null, h("span", { className: "ptb-sr" }, "筛选工作区"), h("select", { disabled: !view.ready, value: filter, onChange: (event) => setFilter(event.target.value) }, h("option", { value: "" }, "全部工作区"), ...[...new Set([...resources.workspaces.map((item) => item.path), ...state.tasks.map((item) => item.workspacePath)])].map((path) => h("option", { key: path, value: path }, resources.workspaces.find((item) => item.path === path)?.name || path)))),
        h("label", null, "项目 ", h("select", { "aria-label": "筛选项目", value: view.project, disabled: !view.ready, onChange: (event) => void viewStore.update({ project: event.target.value }) }, h("option", { value: "" }, "全部项目"), ...[...new Set(state.tasks.map((task) => task.project).filter(Boolean))].map((project) => h("option", { key: project, value: project }, project)))),
        h("input", { ref: searchInput, type: "search", "aria-label": "搜索任务", placeholder: "搜索任务…", disabled: !view.ready, value: search, onChange: (event) => setSearch(event.target.value) }), button("清除筛选", () => void viewStore.update({ workspace: "", project: "", search: "", focus: "all" }), { disabled: !view.ready }), h("span", { className: "ptb-muted", role: "status" }, `${tasks.length} / ${state.tasks.length} 项任务${occupied ? " · 有执行待结束或核对" : ""}`)),
      h("div", { className: "ptb-focus ptb-actions", "aria-label": "任务快捷筛选" }, ...Object.entries(FOCUSES).map(([focus, label]) => button(`${label} · ${selectTasks(state.tasks, { ...view, focus }).length}`, () => void viewStore.update({ focus }), { key: focus, disabled: !view.ready, "aria-label": `筛选${label}`, "aria-pressed": view.focus === focus }))),
      h("details", { className: "ptb-notices" }, h("summary", null, `任务通知 · ${taskNotices(state.tasks).filter((entry) => !entry.read && !entry.archived).length} 条未读`),
        button(archivedNotices ? "查看收件箱" : "查看已归档通知", () => setArchivedNotices(!archivedNotices)),
        !archivedNotices && h("div", { className: "ptb-actions" },
          button("全部标为已读", () => void act(() => board.bulkNotices("read")), { disabled: locked || !state.ready }),
          button("归档已读通知", () => void act(() => board.bulkNotices("archive-read")), { disabled: locked || !state.ready }),
          button("归档已结束任务通知", () => void act(() => board.bulkNotices("archive-completed")), { disabled: locked || !state.ready })),
        ...taskNotices(state.tasks).filter((entry) => entry.archived === archivedNotices).map((entry) => h("div", { key: entry.id, className: `ptb-notice${entry.read ? "" : " ptb-notice-unread"}` },
          h("div", { className: "ptb-notice-content" }, h("span", { className: "ptb-notice-title" }, entry.title), h("span", { className: "ptb-notice-meta" }, `${entry.read ? "" : "未读 · "}${entry.summary || OUTCOMES[entry.outcome]} · ${new Date(entry.createdAt).toLocaleString("zh-CN")}`)),
          h("div", { className: "ptb-actions ptb-notice-actions" },
          button("查看任务", () => { setPreviewId(entry.taskId); void act(() => board.updateNotice(entry.taskId, entry.id, { read: true })); }),
          button(entry.read ? "标为未读" : "标为已读", () => void act(() => board.updateNotice(entry.taskId, entry.id, { read: !entry.read })), { disabled: locked }),
          button(entry.archived ? "恢复通知" : "归档通知", () => void act(() => board.updateNotice(entry.taskId, entry.id, { archived: !entry.archived })), { disabled: locked })))),
        !taskNotices(state.tasks).some((entry) => entry.archived === archivedNotices) && h("p", null, "暂无通知")),
      state.ready && state.tasks.length > 0 && !tasks.length && h("p", { className: "ptb-banner", role: "status" }, "当前筛选隐藏了所有任务，点击“清除筛选”查看。"),
      h("details", { className: "ptb-tools" }, h("summary", null, "视图与批量操作"),
        h("div", { className: "ptb-actions" },
          h("label", null, "布局 ", h("select", { "aria-label": "任务布局", value: view.layout, disabled: !view.ready, onChange: (event) => void viewStore.update({ layout: event.target.value }) }, h("option", { value: "board" }, "看板"), h("option", { value: "list" }, "列表"), h("option", { value: "gantt" }, "甘特时间轴"), h("option", { value: "swimlane" }, "父子任务泳道"))),

          h("label", null, "排序 ", h("select", { "aria-label": "任务排序", disabled: !view.ready, value: view.sort, onChange: (event) => void viewStore.update({ sort: event.target.value }) }, ...Object.entries(SORTS).map(([key, label]) => h("option", { key, value: key }, label)))),
          h("select", { "aria-label": "已保存视图", value: "", disabled: !view.ready, onChange: (event) => { const saved = view.savedViews.find((entry) => entry.id === event.target.value); if (saved) void viewStore.update(saved.view); } }, h("option", { value: "" }, "选择已保存视图"), ...view.savedViews.map((entry) => h("option", { key: entry.id, value: entry.id }, entry.name))),
          h("input", { "aria-label": "视图名称", value: viewName, placeholder: "视图名称", disabled: !view.ready, onChange: (event) => setViewName(event.target.value) }),
          button("保存当前视图", () => { if (!viewName.trim()) { setLocalError("请填写视图名称。"); return; } void viewStore.update({ savedViews: [...view.savedViews, { id: uid(), name: viewName.trim(), view: viewFields(view) }] }); setViewName(""); }, { disabled: !view.ready })),
        h("div", { className: "ptb-actions" }, ...view.savedViews.map((entry) => button(`移除视图 ${entry.name}`, () => void viewStore.update({ savedViews: view.savedViews.filter((item) => item.id !== entry.id) }), { key: entry.id, disabled: !view.ready }))),
        h("label", { className: "ptb-open-mode" }, "点击任务标题 ", h("select", { "aria-label": "默认打开任务", value: view.openMode, disabled: !view.ready, onChange: (event) => void viewStore.update({ openMode: event.target.value }) }, h("option", { value: "details" }, "完整详情"), h("option", { value: "preview" }, "侧边预览"))),
        h("fieldset", { className: "ptb-card-fields" }, h("legend", null, "列表显示列"), ...Object.entries(LIST_FIELDS).map(([key, label]) => h("label", { key }, h("input", { type: "checkbox", checked: view.listFields[key], disabled: !view.ready, onChange: (event) => void viewStore.update({ listFields: { ...view.listFields, [key]: event.target.checked } }) }), label))),
        h("fieldset", { className: "ptb-card-fields" }, h("legend", null, "卡片显示字段"), ...Object.entries(CARD_FIELDS).map(([key, label]) => h("label", { key }, h("input", { type: "checkbox", checked: view.cardFields[key], disabled: !view.ready, onChange: (event) => void viewStore.update({ cardFields: { ...view.cardFields, [key]: event.target.checked } }) }), label))),
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
        h("details", null, h("summary", null, "项目共享说明"),
          ...[...new Set(state.tasks.filter((task) => task.project).map((task) => JSON.stringify([task.workspacePath, task.project])))].map((key) => {
            const [workspacePath, name] = JSON.parse(key);
            const description = state.projects.find((entry) => entry.workspacePath === workspacePath && entry.name === name)?.description || "";
            return h("details", { key }, h("summary", null, `${name} · ${resources.workspaces.find((entry) => entry.path === workspacePath)?.name || workspacePath}`), h(ProjectInstructions, { workspacePath, name, description, disabled: locked || !state.ready }));
          }), !state.tasks.some((task) => task.project) && h("p", null, "先为任务填写项目名称。")),
        h("details", { "aria-label": "执行统计" }, h("summary", null, "执行统计（当前筛选）"), (() => {
          const metrics = taskMetrics(tasks);
          return h("p", null, `${metrics.runs} 次已结束运行 · ${metrics.errors} 次失败 · 失败率 ${metrics.errorRate == null ? "—" : `${(metrics.errorRate * 100).toFixed(1)}%`} · 执行耗时 ${metrics.durationMs == null ? "未记录" : `${(metrics.durationMs / 1000).toFixed(1)} 秒`}${metrics.unmeasured ? ` · ${metrics.unmeasured} 次未记录耗时` : ""}${metrics.unstarted ? ` · 另有 ${metrics.unstarted} 次启动未成功，不计入运行统计` : ""}`);
        })())),
      state.ready && !state.tasks.length && h("div", { className: "ptb-empty" }, icon({}), h("h2", null, "从一项具体任务开始"), h("p", null, "写清需求和验收标准，选择工作区与模型，再开始执行。"), button("创建第一项任务", () => openEditor(), { disabled: !canCreate, className: "ptb-primary" })),
      state.ready && state.tasks.length > 0 && view.layout === "list" && h("div", { className: "ptb-list" }, h("table", { "aria-label": "任务列表" },
        h("thead", null, h("tr", null, ...["选择", "任务", "状态", ...Object.entries(LIST_FIELDS).filter(([key]) => view.listFields[key]).map(([, label]) => label)].map((label) => h("th", { key: label, scope: "col" }, label)))),
        h("tbody", null, ...tasks.map((task) => h("tr", { key: task.id },
          h("td", null, h("input", { type: "checkbox", "aria-label": `选择任务 ${task.title}`, checked: selectedVisible.includes(task.id), disabled: locked || task.status === "running" || task.recovery, onChange: (event) => selectTask(event, task) })),
          h("td", null, h("div", { className: "ptb-list-task" }, button(task.title, (event) => openTask(event, task), { className: "ptb-task-title" }), h("div", { className: "ptb-actions ptb-list-task-actions" }, button("预览", (event) => openTask(event, task, true), { "aria-label": `预览任务 ${task.title}` }), h(InlineField, { task, field: "title", disabled: locked || task.status === "running" || task.recovery }))), task.parentId && h("span", { className: "ptb-muted" }, `子任务/阶段 ${task.stage || 1}`)),
          h("td", null, STATUSES[task.status]), view.listFields.priority && h("td", null, h(InlineField, { task, field: "priority", disabled: locked || task.status === "running" || task.recovery })), view.listFields.project && h("td", null, task.project || "—"), view.listFields.dueDate && h("td", { className: isOverdue(task) ? "ptb-error" : "" }, h(InlineField, { task, field: "dueDate", disabled: locked || task.status === "running" || task.recovery })), view.listFields.workspace && h("td", null, resources.workspaces.find((entry) => entry.path === task.workspacePath)?.name || task.workspacePath))),
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
          h("h2", null, button(`${folded ? "▸" : "▾"} ${title} · ${lane.tasks.length}`, () => void viewStore.update({ collapsedLanes: folded ? view.collapsedLanes.filter((id) => id !== lane.id) : [...view.collapsedLanes, lane.id] }), { "aria-expanded": !folded, "aria-label": `${folded ? "展开" : "折叠"}泳道 ${title}`, disabled: !view.ready }), lane.parent && button("查看父任务", () => setPreviewId(lane.parent.id))),
          !folded && h("div", { className: "ptb-lane-columns" }, ...Object.entries(STATUSES).map(([status, label]) => h("section", { key: status, className: `ptb-column ptb-status-${status}`, "aria-label": label }, h("h3", null, `${label} · ${lane.tasks.filter((task) => task.status === status).length}`), ...lane.tasks.filter((task) => task.status === status).map(card)))));
      }), !tasks.length && h("p", null, "没有符合筛选的任务")),
      previewId && state.tasks.some((task) => task.id === previewId) && h(TaskPreview, { task: state.tasks.find((task) => task.id === previewId), tasks, onSelect: setPreviewId, onClose: () => setPreviewId(null) }),
      h("footer", { className: "ptb-footer" }, "任务保存在本机 · 执行输出在原生会话中查看 · AI 结束后需人工验收"));
  }

  ctx.ui.registerCenterTab({ key: "board", title: () => "个人任务看板", icon, component: Board });
  ctx.ui.registerCenterTab({ key: "task-editor", title: () => "任务编辑", icon, component: TaskEditor });
  ctx.ui.registerCenterTab({ key: "task-details", title: () => "任务详情", icon, component: TaskDetails });
  ctx.ui.registerCenterTab({ key: "task-feedback", title: () => "验收反馈", icon, component: FeedbackPage });
  ctx.ui.registerSidebarNav({ key: "board", label: () => "个人任务看板", icon, onOpen: () => ctx.ui.openCenterTab("board") });
  return () => { board.dispose(); viewStore.dispose(); editorListeners.clear(); feedbackListeners.clear(); detailListeners.clear(); };
}

const CSS = `
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
`;
