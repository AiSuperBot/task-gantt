// Tests for the plan assistant's tools: finding, reading and proposing changes (with the cascade they set off)
import { chatBody, cosine, endpoint, errorText, jsonObject, modelIds, planChanges, readEmbeddings, readReply, requestHeaders, requestFacts, requestNote, responsesBody, runTool, systemPrompt } from "./ai.mjs";
import { dayIndex } from "./timeline.mjs";

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log("  ok  -", name);
  } else {
    fail++;
    console.error("FAIL  -", name);
  }
}

const task = (o) => ({ path: `Team/${o.groups?.[0] ?? "Ops"}/${o.name}.md`, groups: ["Ops"], deps: [], milestone: false, tags: [], assignees: [], kind: "note", custom: {}, ...o });
const STATUSES = [
  { id: "todo", label: "To do", color: "#888", group: "active" },
  { id: "in-progress", label: "In progress", color: "#00f", group: "active" },
  { id: "blocked", label: "Blocked", color: "#f00", group: "deferred" },
  { id: "done", label: "Done", color: "#0a0", group: "completed" },
];
// a Sunday-to-Thursday week; 2026-11-15 is a Sunday
const A = task({ name: "Adapter", assignees: ["Dana"], status: "in-progress", start: "2026-11-15", end: "2026-11-19" });
const B = task({ name: "Migration", assignees: ["Eli"], status: "todo", start: "2026-11-22", end: "2026-11-26", deps: [{ path: A.path, type: "FS" }] });
const C = task({ name: "Limits", groups: ["Portal"], assignees: ["Eli"], status: "blocked", blocker: "security review", start: "2026-11-18", end: "2026-11-25" });
const D = task({ name: "Limits", groups: ["Ops"], path: "Team/Ops/Limits.md", status: "todo" });
const board = (tasks) => ({
  tasks,
  statuses: STATUSES,
  opts: { cal: { off: [5, 6] }, fs: true },
  today: dayIndex("2026-11-24"),
  folder: "Team",
  me: "Dana",
  attention: (t) => (t.status === "blocked" ? ["blocked"] : []),
  read: async () => "---\nstatus: todo\n---\nCompare staging and production.",
});
const B1 = board([A, B, C]);

// ── proposals ──
const shifted = planChanges(B1, [{ task: "adapter", shift_workdays: 2 }]);
const a = shifted.edits.find((e) => e.name === "Adapter");
const b = shifted.edits.find((e) => e.name === "Migration");
check("shift: moves by workdays and keeps the length (5 workdays: Tue 17 → Mon 23)", a && !a.cascaded && a.after.start === "2026-11-17" && a.after.end === "2026-11-23");
check("shift: the finish-to-start successor is pushed past the weekend, keeping its length", b && b.cascaded && b.after.start === "2026-11-24" && b.after.end === "2026-11-30");
check("a new start alone keeps the length", planChanges(B1, [{ task: "Migration", start: "2026-11-29" }]).edits[0]?.after.end === "2026-12-03");
const st = planChanges(B1, [{ task: "Migration", status: "in progress", assignees: ["Eli", "Noa"] }]);
check("status by label in any case, people replaced", st.edits[0]?.after.status === "in-progress" && st.edits[0]?.after.assignees.join() === "Eli,Noa" && st.edits.length === 1);
check("an unknown status is an error naming the allowed ones", planChanges(B1, [{ task: "Migration", status: "Shipped" }]).errors[0]?.includes("To do, In progress, Blocked, Done"));
check("a bad date is an error", planChanges(B1, [{ task: "Migration", end: "next week" }]).errors.length === 1);
check("a change that changes nothing is said so", planChanges(B1, [{ task: "Migration", status: "To do" }]).errors[0]?.includes("as it is"));
const amb = planChanges(board([A, C, D]), [{ task: "Limits", status: "Done" }]);
check("a repeated name asks for project/name", amb.errors[0]?.includes("Portal/Limits") && amb.errors[0]?.includes("Ops/Limits"));
check("project/name picks one", planChanges(board([A, C, D]), [{ task: "Portal/Limits", status: "Done" }]).edits[0]?.path === C.path);
check("an unknown task suggests near names", planChanges(B1, [{ task: "Migr" }]).errors[0]?.includes("Migration"));

// ── tools ──
const found = await runTool("find_tasks", JSON.stringify({ assignee: "eli", attention: true }), B1);
check("find: filters combine (Eli's tasks needing attention)", found.content.includes('"task":"Limits"') && !found.content.includes("Migration"));
const all = (await runTool("find_tasks", {}, B1)).content;
check("find: dates come with when, in words (today is Tue 24 Nov)", all.includes('"when":"started 2 days ago (Sun); ends in 2 days (Thu)"') && all.includes('"when":"started 9 days ago (Sun); was due 5 days ago (Thu)"'));
check("find: a finished task ended, a milestone is due", (await runTool("find_tasks", {}, board([task({ name: "Done one", status: "done", start: "2026-11-22", end: "2026-11-23" }), task({ name: "Gate", milestone: true, start: "2026-11-25", end: "2026-11-25" })]))).content.includes('ended yesterday (Mon)') && (await runTool("find_tasks", {}, board([task({ name: "Gate", milestone: true, start: "2026-11-25", end: "2026-11-25" })]))).content.includes('"when":"due tomorrow (Wed)"'));
check("find: nothing found says so, and how to list everything after a search by words", (await runTool("find_tasks", { text: "zzz" }, B1)).content.startsWith("No tasks match: no task name has these words. Search without text") && (await runTool("find_tasks", { assignee: "Nobody" }, B1)).content === "No tasks match.");
const got = JSON.parse((await runTool("get_task", { task: "Adapter" }, B1)).content);
check("get: what waits on it, and the note's text without its frontmatter", got.waited_on_by.join() === "Migration" && got.note === "Compare staging and production.");
const prop = await runTool("propose_changes", { changes: [{ task: "Adapter", shift_workdays: 2 }] }, B1);
check("propose: returns the edits for approval and says so to the model", prop.proposal?.length === 2 && prop.content.startsWith("Proposed"));
check("propose: the model gets the dates with their weekdays, in Hebrew for a Hebrew request", prop.content.includes("start Sun 2026-11-15 → Tue 2026-11-17") && (await runTool("propose_changes", { changes: [{ task: "Adapter", shift_workdays: 2 }] }, { ...B1, hebrew: true })).content.includes("start יום א׳ 2026-11-15 → יום ג׳ 2026-11-17"));
check("bad JSON arguments are an error, not a crash", (await runTool("get_task", "{oops", B1)).content.startsWith("Error"));
const sp = systemPrompt({ ...B1, sprint: { name: "Sprint 14", from: dayIndex("2026-11-15"), to: dayIndex("2026-11-26") } }, "Ops is the infrastructure team.");
check("the system prompt names today, the work week and the person", ["Tue 2026-11-24", "Sunday, Monday, Tuesday, Wednesday, Thursday; a week is 5 workdays", "Dana"].every((x) => sp.includes(x)));
check("the system prompt lists the coming workdays as dates, past the weekend", sp.includes("Wed 2026-11-25, Thu 2026-11-26, Sun 2026-11-29, Mon 2026-11-30"));
check("the system prompt names the sprint and its workday", sp.includes('"Sprint 14", Sun 2026-11-15 to Thu 2026-11-26, workday 8 of 10'));
check("the system prompt names the people and projects", sp.includes("People: Dana, Eli.") && sp.includes("Projects: Ops, Portal."));
check("the team's instructions come last; without them, nothing is added", sp.endsWith("The team's own instructions:\nOps is the infrastructure team.") && !systemPrompt(B1).includes("own instructions"));

// ── small models' shapes of a proposal ──
check("propose: one change without the list is taken as the list", (await runTool("propose_changes", { task: "Adapter", shift_workdays: 2 }, B1)).proposal?.length === 2);
check("propose: the list sent as a JSON string is read", (await runTool("propose_changes", { changes: JSON.stringify([{ task: "Adapter", shift_workdays: 2 }]) }, B1)).proposal?.length === 2);

// ── search by meaning (embeddings) ──
const meaning = { ...B1, similar: async (q, texts) => texts.map((t) => (t === "Migration" ? 0.82 : t === "Limits" ? 0.31 : 0.1)) };
const near = (await runTool("find_tasks", { text: "העברת נתונים" }, meaning)).content;
check("find by meaning: no name has the words, so the closest tasks come, marked and ranked", near.startsWith("No task name has these words") && near.indexOf("Migration") < near.indexOf("Limits") && !near.includes('"task":"Adapter"') && near.includes('"similarity":0.82'));
let asked = false;
await runTool("find_tasks", { text: "adapt" }, { ...B1, similar: async () => ((asked = true), []) });
check("find by meaning: not asked when a name has the words", !asked);
check("find by meaning: a failing server falls back to no match", (await runTool("find_tasks", { text: "zzz" }, { ...B1, similar: async () => { throw new Error("501"); } })).content.startsWith("No tasks match"));

// ── blocking asks what the task waits for ──
const noWhy = planChanges(B1, [{ task: "Migration", status: "Blocked" }]);
check("blocking without what it waits for proposes nothing and tells the model to ask", !noWhy.edits.length && noWhy.errors[0]?.includes("what it waits for") && noWhy.errors[0]?.includes("ask them"));
const withWhy = planChanges(B1, [{ task: "Migration", status: "Blocked", blocker: "the DB adapter" }]);
check("blocking with a reason is proposed, status and reason together", withWhy.edits[0]?.after.status === "blocked" && withWhy.edits[0]?.after.blocker === "the DB adapter");
check("a task that already says what it waits for can be blocked again as is", planChanges(board([{ ...C, status: "todo" }]), [{ task: "Limits", status: "Blocked" }]).edits[0]?.after.status === "blocked");

// ── the wire ──
check("endpoint: a path joins the server URL, a full URL stands", endpoint("http://h:1/v1/", "/chat/completions") === "http://h:1/v1/chat/completions" && endpoint("http://h:1/v1", "chat/completions") === "http://h:1/v1/chat/completions" && endpoint("http://h:1/v1", "http://h:2/api/chat") === "http://h:2/api/chat");
check("JSON settings: empty is none, an object passes, anything else is explained", JSON.stringify(jsonObject(" ")) === "{}" && jsonObject('{"a":1}').a === 1 && typeof jsonObject("[1]") === "string" && typeof jsonObject("{oops") === "string");
check("headers: the key as a bearer token by default", requestHeaders("local", {}).Authorization === "Bearer local" && !("Authorization" in requestHeaders("", {})));
const h = requestHeaders("s3cret", { "api-key": "{key}", "X-Team": "ops" });
check("headers: {key} places the key, and then no bearer token is added", h["api-key"] === "s3cret" && h["X-Team"] === "ops" && !("Authorization" in h));
const cb = chatBody("m", [{ role: "user", content: "hi" }], { temperature: 0.7, max_tokens: 99, messages: [], tools: [], model: "x" });
check("chat body: extra fields can change the sampling, not the model, conversation or tools", cb.temperature === 0.7 && cb.max_tokens === 99 && cb.model === "m" && cb.messages.length === 1 && cb.tools.length === 3 && cb.stream === false);
check("chat body: temperature 0.2 by default", chatBody("m", [], {}).temperature === 0.2);
check("reply: OpenAI shape", readReply({ choices: [{ message: { content: "hi", tool_calls: [{ id: "1", type: "function", function: { name: "find_tasks", arguments: "{}" } }] } }] }).tool_calls[0].function.name === "find_tasks");
check("reply: Ollama's own shape, and text in parts", readReply({ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }).content === "ab");
const qwen = readReply({ choices: [{ message: { content: 'Looking.\n<tool_call>\n{"name": "get_task", "arguments": {"task": "Adapter"}}\n</tool_call>' } }] });
check("reply: a <tool_call> left in the text becomes a tool call, and leaves the text", qwen.tool_calls?.[0]?.function.name === "get_task" && qwen.tool_calls[0].function.arguments.task === "Adapter" && qwen.content === "Looking.");
check("reply: the old single function_call", readReply({ choices: [{ message: { content: null, function_call: { name: "find_tasks", arguments: "{}" } } }] }).tool_calls?.[0]?.function.name === "find_tasks");
check("reply: no message is null", readReply({ choices: [] }) === null && readReply(undefined) === null);
check("errors in words: OpenAI, plain, FastAPI shapes, else the status and URL", errorText({ error: { message: "bad" } }, 400, "u") === "bad" && errorText({ error: "worse" }, 500, "u") === "worse" && errorText({ detail: "nope" }, 422, "u") === "nope" && errorText(undefined, 404, "http://h/x") === "HTTP 404 from http://h/x");
check("embeddings: OpenAI's (in index order) and Ollama's shapes", readEmbeddings({ data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }] }).join() === "1,2" && readEmbeddings({ embeddings: [[3]] })[0][0] === 3 && readEmbeddings({}) === null);
check("models: OpenAI's and Ollama's lists, once each", modelIds({ data: [{ id: "a" }], models: [{ name: "a" }, { name: "b" }] }).join() === "a,b");
// ── guidance: always in the system prompt (measured: no fewer right answers than sent on demand, and faster) ──
const plainPrompt = systemPrompt(B1);
check("the system prompt carries the guidance for every kind of request, with the work week in workdays", ["Summaries and reports:", "Moving dates:", "Changing status or people:", "People and workload:", "Risks and attention:", "a week is 5 workdays); \"to\" a day"].every((x) => plainPrompt.includes(x)));
check("the system prompt is the same whatever is asked, so a server can reuse its work on it", systemPrompt(B1) === plainPrompt && systemPrompt({ ...B1, hebrew: true }) === plainPrompt);

// ── what the plugin reads in a request and says outright, on the request ──
const ASK = "names no amount, day or date";
const noAmount = ["Delay Search endpoint", "Postpone the DB Adapter", "תדחה את Search endpoint", "אפשר להקדים את Data migration?"];
const amount = ["Delay Search endpoint by 3 workdays", "Push the login task back a week", "Delay it until Thursday", "Postpone Data migration to 2026-12-07", "תדחה את Login page redesign ביומיים", "תדחה את Search endpoint בשלושה ימי עבודה", "תדחה את זה לשבוע הבא", "להזיז את Data migration ליום ראשון"];
check("request note: a delay with no amount, day or date is told outright to ask how far (English and Hebrew)", noAmount.every((q) => requestNote(q, B1).includes(ASK)));
check("request note: a delay that says how far is not", amount.every((q) => !requestNote(q, B1).includes(ASK)));
check("request note: handing a task to someone is not a delay, so no such question", !requestNote("תעביר את Accessibility audit לנועה", B1).includes(ASK) && !requestNote("Assign Accessibility audit to Noa", B1).includes(ASK));
check("request note: wrapped as guidance; nothing for a plain English request", requestNote("Delay Search endpoint", B1) === `<guidance>\n- This request ${ASK}: ask how far to move it, and propose nothing yet.\n</guidance>` && requestNote("When is DB Adapter due?", B1) === "" && requestNote("Summarize this sprint for my manager", B1) === "");

// ── Hebrew: status words named, today's weekday, dates in words in Hebrew ──
const heBlock = requestNote("סמן את Data migration כחסומה", B1);
check("Hebrew status word: the feminine כחסומה is named as the board's Blocked", heBlock.includes('In this request, "כחסומה" is the status Blocked.'));
check("Hebrew status words: done and waiting forms, one line per status group", requestNote("סמן את Limits כבוצעה", B1).includes('"כבוצעה" is the status Done') && requestNote("תסמן את Limits בהמתנה, ממתינים לאישור", B1).split("is the status Blocked").length === 2);
check("Hebrew status words: only when the request changes a status (to finish today is no status change)", !requestNote("מה צריך להסתיים היום?", B1).includes("is the status") && !requestNote("Mark Limits as blocked", B1).includes("In this request"));
check("Hebrew request: today's weekday is given in Hebrew (2026-11-24 is a Tuesday), an English one gets none", requestFacts("מה צריך להסתיים היום?", B1).join() === "- Today is יום ג׳." && !requestNote("What is due today?", B1));
const heRows = (await runTool("find_tasks", {}, { ...B1, hebrew: true })).content;
check("Hebrew request: dates in words come in Hebrew", heRows.includes('"when":"התחילה לפני יומיים (יום א׳); מסתיימת בעוד יומיים (יום ה׳)"') && heRows.includes("הייתה אמורה להסתיים לפני 5 ימים (יום ה׳)"));

// ── the Responses API ──
const rb = responsesBody("m", [
  { role: "system", content: "rules" },
  { role: "user", content: "Delay Adapter" },
  { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "find_tasks", arguments: { text: "Adapter" } } }] },
  { role: "tool", tool_call_id: "c1", content: "rows" },
], { max_output_tokens: 9 });
check("responses: the system prompt as instructions, tool calls and their answers as items", rb.instructions === "rules" && rb.input.length === 3 && rb.input[0].role === "user" && rb.input[1].type === "function_call" && rb.input[1].call_id === "c1" && rb.input[1].arguments === '{"text":"Adapter"}' && rb.input[2].type === "function_call_output" && rb.input[2].output === "rows");
const said = responsesBody("m", [{ role: "user", content: "hi" }, { role: "assistant", content: "Hello." }, { role: "user", content: "again" }], {}).input;
check("responses: an earlier answer goes back as a message item with output_text parts, a question as plain role and content", said[1].type === "message" && said[1].role === "assistant" && said[1].content[0].type === "output_text" && said[1].content[0].text === "Hello." && said[0].content === "hi" && !("type" in said[0]));
check("responses: flat tools, not stored, extra fields kept", rb.tools.length === 3 && rb.tools[0].name === "find_tasks" && rb.tools[0].parameters && rb.store === false && rb.max_output_tokens === 9);
const rr = readReply({ output: [{ type: "reasoning", summary: [] }, { type: "function_call", call_id: "fc_1", name: "find_tasks", arguments: '{"assignee":"Dana"}' }] });
check("responses: a function_call item becomes a tool call", rr.tool_calls?.[0]?.id === "fc_1" && rr.tool_calls[0].function.name === "find_tasks" && rr.content === null);
check("responses: message items give the text", readReply({ output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Dana is on " }, { type: "output_text", text: "DB Adapter." }] }] }).content === "Dana is on DB Adapter.");
check("cosine: same direction 1, opposite -1, empty 0", Math.abs(cosine([1, 2], [2, 4]) - 1) < 1e-9 && Math.abs(cosine([1, 0], [-1, 0]) + 1) < 1e-9 && cosine([], [1]) === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
