// The one way to the AI server, for the panel and the settings check alike: the endpoint, headers, extra fields and time limit set in
// Settings. requestUrl has no CORS limits and works on mobile too; errors come back in words.
import { requestUrl } from "obsidian";
import type GanttPlugin from "./main";
import { chatBody, ChatMsg, endpoint, errorText, jsonObject, modelIds, readEmbeddings, readReply, requestHeaders, responsesBody } from "./ai";
import { t as tr } from "./i18n";
import { aiKey } from "./settings";

// GET (no body) or POST to a path under the server URL (or a full URL); the answer's JSON
export async function aiCall(plugin: GanttPlugin, path: string, body?: Record<string, unknown>): Promise<unknown> {
  const a = plugin.settings.ai;
  const extra = jsonObject(a.headers);
  if (typeof extra === "string") throw new Error(tr().aiBadJson(tr().setAiHeadersName, extra));
  const url = endpoint(a.url, path);
  // requestUrl has no time limit of its own; a server that never answers mustn't leave the panel thinking forever
  let timer = 0;
  const late = new Promise<never>((_, fail) => (timer = window.setTimeout(() => fail(new Error(tr().aiTimeout)), (a.timeout || 180) * 1000)));
  const res = await Promise.race([
    requestUrl({ url, method: body ? "POST" : "GET", contentType: body ? "application/json" : undefined, headers: requestHeaders(aiKey(plugin), extra), body: body && JSON.stringify(body), throw: false }),
    late,
  ]).finally(() => window.clearTimeout(timer));
  let json: unknown;
  try {
    json = res.json;
  } catch {
    json = undefined; // not JSON (an HTML error page, say)
  }
  if (res.status >= 400) throw new Error(errorText(json, res.status, url));
  return json;
}

// a chat request with the board's tools and the extra fields from Settings, in the API's shape (Responses calls max_tokens max_output_tokens)
export function chatRequest(plugin: GanttPlugin, messages: ChatMsg[], more: { max_tokens?: number } = {}): Record<string, unknown> {
  const a = plugin.settings.ai;
  const extra = jsonObject(a.body);
  if (typeof extra === "string") throw new Error(tr().aiBadJson(tr().setAiBodyName, extra));
  if (a.api !== "responses") return chatBody(a.model, messages, { ...extra, ...more });
  return responsesBody(a.model, messages, { ...extra, ...(more.max_tokens ? { max_output_tokens: more.max_tokens } : {}) });
}

// Settings' check: the models the server lists, a short chat with the tools, and the embeddings when a model is set; a line each
export async function checkAi(plugin: GanttPlugin): Promise<{ lines: { ok: boolean; text: string }[]; models: string[] }> {
  const a = plugin.settings.ai;
  const lines: { ok: boolean; text: string }[] = [];
  const say = (ok: boolean, text: string) => lines.push({ ok, text });
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
  let models: string[] = [];
  try {
    models = modelIds(await aiCall(plugin, "/models"));
    const listed = !a.model || !models.length || models.includes(a.model);
    say(listed, listed ? tr().aiCheckModels(models) : tr().aiCheckNoModel(a.model, models));
  } catch (e) {
    say(false, tr().aiCheckFailed(tr().aiCheckModelsWhat, why(e)));
  }
  if (a.model) {
    const t0 = Date.now();
    try {
      const reply = readReply(await aiCall(plugin, a.chatPath, chatRequest(plugin, [{ role: "user", content: "Reply with OK." }], { max_tokens: 64 })));
      say(!!reply, reply ? tr().aiCheckChat(a.model, (Date.now() - t0) / 1000) : tr().aiCheckFailed(tr().aiCheckChatWhat, tr().aiEmpty));
    } catch (e) {
      const msg = why(e);
      say(false, /tool/i.test(msg) && /support/i.test(msg) ? tr().aiNoTools : tr().aiCheckFailed(tr().aiCheckChatWhat, msg));
    }
  }
  if (a.embedModel) {
    try {
      const v = readEmbeddings(await aiCall(plugin, a.embedPath, { model: a.embedModel, input: ["test"] }));
      say(!!v?.[0]?.length, v?.[0]?.length ? tr().aiCheckEmbed(a.embedModel, v[0].length) : tr().aiCheckFailed(tr().aiCheckEmbedWhat, tr().aiEmpty));
    } catch (e) {
      say(false, tr().aiCheckFailed(tr().aiCheckEmbedWhat, why(e)));
    }
  }
  return { lines, models };
}
