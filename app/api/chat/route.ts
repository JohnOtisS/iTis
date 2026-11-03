import {getUploadLimits} from "@/lib/upload-limits";
import {uploadError} from "@/lib/upload-policy";
import {localArtifactAction} from "@/lib/local-artifacts";
import {localArtifactIntent} from "@/lib/artifact-policy";
import {taskUsage,estimateModelCost,terminalProviderUsage} from "@/lib/task-usage";
import {documentMemoryRequest,documentMemoryOnly,documentMemoryNotice,uploadRememberedDocument,rememberDocument,retrieveDocumentMemory,type DocumentMemoryResult} from "@/lib/memory-documents";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { basename, extname } from "node:path";
import { getDb } from "@/db";
import { appSettings, conversations, messages, usageEvents } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { deleteChatFile, mimeFromName, readChatFile, saveChatFile, withChatFileCleanup, type ChatAttachment } from "@/lib/chat-files";
import { getAccountStorage, isStorageError, STORAGE_ERROR } from "@/lib/account-storage";
import { isCodeTask, LOCAL_AI_BASE_URL, LOCAL_AI_CODE_MODEL, LOCAL_AI_GENERAL_MODEL } from "@/lib/ai-providers";
import { formatMemoryContext, inferMemoryCandidate, retrieveUserMemories } from "@/lib/memory";
import { consolidateUserMemory, isExplicitMemoryRequest, memoryOnlyRequest } from "@/lib/memory-consolidation";
import { externalSafetyIdentifier } from "@/lib/privacy";
import { enforceRateLimit } from "@/lib/rate-limit";
import { buildChatContext } from "@/lib/chat-context";
import { documentCatalog, selectDocuments } from "@/lib/chat-documents";
import { fastWordMode, isDocumentEditFollowup, isImageGeneration, needsComputation, needsDocumentOutput } from "@/lib/chat-task-policy";
import { startChatJob } from "@/lib/chat-jobs";
import { assertContinuationBudget } from "@/lib/token-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OpenAiPayload = {
  status?: string;
  incomplete_details?: { reason?: string };
  output_text?: string;
  output?: Array<{
    type?: string;
    container_id?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{
        type?: string;
        container_id?: string;
        file_id?: string;
        filename?: string;
        url?: string;
        title?: string;
        start_index?: number;
        end_index?: number;
      }>;
    }>;
  }>;
  usage?: {
    input_tokens?: number; output_tokens?: number; total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
};
type LocalPayload = {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

function makeTitle(prompt: string, locale: "en" | "vi") {
  return prompt.replace(/\s+/g, " ").trim().slice(0, 72) || (locale === "vi" ? "Chat mới" : "New chat");
}
function isComplexTask(prompt: string) {
  return /excel|báo cáo|powerpoint|phân tích nhiều|nhiều file|reasoning|suy luận|chính xác cao|nghiên cứu|code|coding|lập trình|debug|kiến trúc|pháp lý|tài chính|y tế/i.test(prompt);
}

function isWebSearchTask(prompt: string) {
  return /https?:\/\/|\b(search|browse|look\s*up|latest|today|news|fact[ -]?check)\b|\b(on|from|using|search(?: the)?)\s+(the\s+)?(web|internet|online)\b|\bcurrent\s+(president|ceo|price|version|status|weather|law|rules?|regulations?)\b|tìm kiếm|tra cứu|tìm trên (mạng|web)|trên mạng|trên web|mới nhất|hiện tại|hôm nay|tin tức|(?:nguồn|dẫn chứng|kiểm chứng|xác minh).{0,25}(?:web|internet|trên mạng)|\b(?:sources?|verify)\b.{0,25}\b(?:web|internet|online)\b/i.test(prompt);
}

function preferredArtifactExtensions(prompt: string) {
  if (/powerpoint|pptx|slide|trình chiếu/i.test(prompt)) return new Set([".pptx"]);
  if (/word|docx/i.test(prompt)) return new Set([".docx"]);
  if (/excel|xlsx/i.test(prompt)) return new Set([".xlsx"]);
  if (/\bpdf\b/i.test(prompt)) return new Set([".pdf"]);
  return new Set([".pptx", ".docx", ".xlsx", ".pdf", ".csv", ".zip", ".png"]);
}

async function loadStoredAttachment(attachment: ChatAttachment) {
  const path = attachment.url.split("?")[0];
  const id = path.startsWith("/api/files/") ? path.slice("/api/files/".length) : "";
  if (!id) return null;
  const bytes = await readChatFile(id);
  if (!bytes) return null;
  return {
    name: attachment.name,
    type: attachment.type || mimeFromName(attachment.name),
    bytes: new Uint8Array(bytes),
  };
}

function isTextFile(file: File) {
  return file.type.startsWith("text/") || /\.(txt|md|json|html|xml|csv|tsv|js|ts|tsx|jsx|py|java|c|cpp|sql)$/i.test(file.name);
}

function prepareOpenAiHistory(items: Array<{ role: string; content: string | Array<Record<string, unknown>> }>) {
  // Only API fields belong in provider input. Local attachment metadata must
  // not leak into the message schema (OpenAI rejects unknown properties).
  return items.map(({ role, content }) => ({ role, content }));
}

async function readEventStream(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void,
) {
  if (!response.body) throw new Error("Upstream response has no stream body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let event:Record<string,unknown>;
      try { event=JSON.parse(payload) as Record<string,unknown>; } catch { continue; }
      onEvent(event);
    }
    if (done) break;
  }
  const last = buffer.trim();
  if (last.startsWith("data:")) {
    const payload = last.slice(5).trim();
    if (payload && payload !== "[DONE]") {
      let event:Record<string,unknown>|undefined;
      try { event=JSON.parse(payload) as Record<string,unknown>; } catch { /* ignore an incomplete JSON tail */ }
      if(event)onEvent(event);
    }
  }
}

export async function POST(request: Request) {
  try {
    const state:{memoryNotice?:string}={};
    const response=await withChatFileCleanup(() => handleChat(request,state));
    if(state.memoryNotice)response.headers.set("X-Itis-Memory-Notice",encodeURIComponent(Array.from(state.memoryNotice).slice(0,700).join("")));
    return response;
  } catch (error) {
    if (isStorageError(error)) return NextResponse.json({ code: "STORAGE_LIMIT", error: STORAGE_ERROR }, { status: 413 });
    throw error;
  }
}

async function handleChat(request: Request,state:{memoryNotice?:string}) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You need to sign in." }, { status: 401 });
  const t = (english: string, vietnamese: string) => user.locale === "vi" ? vietnamese : english;
  if (!(await enforceRateLimit(user.id))) return NextResponse.json({ error: t("You are sending requests too quickly. Please try again in one minute.", "Bạn gửi quá nhanh. Hãy thử lại sau một phút.") }, { status: 429 });

  const contentType = request.headers.get("content-type") ?? "";
  let promptValue: string | undefined;
  let conversationId: string | null = null;
  let attachments: File[] = [];
  let forceWebSearch = false;
  let regenerate = false;
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    promptValue = String(form.get("prompt") ?? "");
    conversationId = form.get("conversationId") ? String(form.get("conversationId")) : null;
    forceWebSearch = String(form.get("webSearch") ?? "") === "true";
    regenerate = String(form.get("regenerate") ?? "") === "true";
    const candidates = [...form.getAll("files"), form.get("file")];
    attachments = candidates.filter((candidate): candidate is File => candidate instanceof File && candidate.size > 0);
  } else {
    const body = await request.json() as { prompt?: string; conversationId?: string | null; webSearch?: boolean; regenerate?: boolean };
    promptValue = body.prompt;
    conversationId = body.conversationId ?? null;
    forceWebSearch = body.webSearch === true;
    regenerate = body.regenerate === true;
  }
  const prompt = promptValue?.trim();
  if (!prompt) return NextResponse.json({ error: t("Message content is required.", "Thiếu nội dung.") }, { status: 400 });
  const fileMemoryIntent=documentMemoryRequest(prompt);
  if(fileMemoryIntent&&!user.memoryEnabled)return NextResponse.json({error:t("Personal memory is disabled by your admin.","Admin đã tắt bộ nhớ cá nhân.")},{status:403});
  if (isImageGeneration(prompt)) return NextResponse.json({code:"USE_IMAGE_STUDIO",error:t("Open Image Studio to generate images. Chat handles documents and analysis.","Hãy mở Studio ảnh để tạo hình. Chat xử lý tài liệu và phân tích."),studioUrl:"/images"},{status:422});
  const uploadLimits=await getUploadLimits();
  const invalidUpload=uploadError(attachments,uploadLimits,user.locale==="vi");
  if(invalidUpload)return NextResponse.json({code:"UPLOAD_LIMIT",error:invalidUpload,uploadLimits},{status:413});
  // File delivery/export is deterministic and does not require an API key or AI quota.
  if(!attachments.length && !regenerate && localArtifactIntent(prompt)){
    if(!conversationId){const [created]=await getDb().insert(conversations).values({userId:user.id,title:makeTitle(prompt,user.locale)}).returning();conversationId=created.id;}
    try{return NextResponse.json(await localArtifactAction({userId:user.id,conversationId,prompt,locale:user.locale}));}
    catch(error){
      if(isStorageError(error))throw error;
      if(error instanceof Error&&error.message==="ARTIFACT_BUSY")return NextResponse.json({error:"Another file export is running in this chat. Please retry shortly."},{status:409});
      const missing=error instanceof Error&&error.message==="ARTIFACT_SOURCE_NOT_FOUND";
      return NextResponse.json({error:missing?t("Conversation not found.","Không tìm thấy phiên chat."):t("The saved source is unavailable or too large to export. Select another answer or file.","Nguồn đã lưu không còn hoặc vượt kích thước xuất hỗ trợ. Hãy chọn câu trả lời hoặc tệp khác.")},{status:missing?404:422});
    }
  }
  const totalAttachmentBytes = attachments.reduce((sum, file) => sum + file.size, 0);
  const storage = await getAccountStorage(user.id);
  // Leave a little room for the answer and message metadata before invoking AI.
  if (!fileMemoryIntent && storage.usedBytes + totalAttachmentBytes + Buffer.byteLength(prompt, "utf8") + 65536 > storage.limitBytes) {
    return NextResponse.json({ code: "STORAGE_LIMIT", error: STORAGE_ERROR }, { status: 413 });
  }
  const attachmentData = await Promise.all(attachments.map(async (file) => ({ file, bytes: new Uint8Array(await file.arrayBuffer()) })));
  const settingRows = await getDb().select({ key: appSettings.key, value: appSettings.value }).from(appSettings);
  const settings = Object.fromEntries(settingRows.map((item) => [item.key, item.value]));
  let relevantMemories = user.memoryEnabled ? await retrieveUserMemories(user.id, prompt, 4) : [];
  const preferredProvider = (settings.ai_environment as { provider?: "local" | "openai" } | undefined)?.provider === "local" ? "local" : "openai";
  const systemProvider: "local" | "openai" = preferredProvider;
  const webSearchTask = forceWebSearch || isWebSearchTask(prompt);
  if (systemProvider === "openai" && !process.env.OPENAI_API_KEY) {
    return NextResponse.json({
      code: "OPENAI_NOT_CONFIGURED",
      error: t("The system is set to OpenAI, but OPENAI_API_KEY is not configured on the server.", "Admin đã chuyển toàn hệ thống sang OpenAI nhưng server chưa có OPENAI_API_KEY."),
    }, { status: 503 });
  }
  if (systemProvider === "local" && !fileMemoryIntent && attachments.some((file) => !isTextFile(file))) {
    return NextResponse.json({
      code: "LOCAL_FILE_UNSUPPORTED",
      error: t("The local model currently reads text, code, CSV, and JSON files directly. Switch the system to OpenAI for PDF, Word, PowerPoint, or Excel files.", "Model Local hiện đọc trực tiếp file text, code, CSV và JSON. Với PDF, Word, PowerPoint hoặc Excel, hãy chuyển công tắc tổng sang OpenAI."),
    }, { status: 400 });
  }
  if (systemProvider === "local" && webSearchTask) {
    return NextResponse.json({
      code: "LOCAL_WEB_SEARCH_UNSUPPORTED",
      error: t("Web search requires the OpenAI environment. Ask an admin to switch the system to OpenAI, or turn off Web search for this message.", "Tìm kiếm web cần môi trường OpenAI. Hãy nhờ admin chuyển hệ thống sang OpenAI, hoặc tắt Web cho tin nhắn này."),
    }, { status: 400 });
  }

  const windowStart = new Date(Date.now() - user.resetWindowHours * 60 * 60 * 1000);
  const [total] = await getDb().select({ used: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)` })
    .from(usageEvents).where(and(eq(usageEvents.userId, user.id), gte(usageEvents.createdAt, windowStart)));
  const [lifetimeTotal] = await getDb().select({ used: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)` })
    .from(usageEvents).where(eq(usageEvents.userId, user.id));
  const usedTokens = Number(total?.used ?? 0);
  const lifetimeUsedTokens = Number(lifetimeTotal?.used ?? 0);
  if (!user.unlimited && usedTokens >= user.tokenLimit) {
    return NextResponse.json({ code: "CYCLE_TOKEN_LIMIT", error: t(`You have used all ${user.tokenLimit.toLocaleString("en-US")} tokens in the ${user.resetWindowHours}-hour cycle. Please wait for the next cycle.`, `Bạn đã dùng hết ${user.tokenLimit.toLocaleString("vi-VN")} token trong chu kỳ ${user.resetWindowHours} giờ. Hãy chờ chu kỳ tiếp theo.`) }, { status: 429 });
  }
  if (!user.totalUnlimited && lifetimeUsedTokens >= user.totalTokenLimit) {
    return NextResponse.json({ code: "TOTAL_TOKEN_LIMIT", error: t(`This account has used all ${user.totalTokenLimit.toLocaleString("en-US")} tokens allocated by the admin. Contact an admin for more.`, `Tài khoản đã dùng hết tổng ${user.totalTokenLimit.toLocaleString("vi-VN")} token được admin cấp. Hãy liên hệ admin để cấp thêm.`) }, { status: 429 });
  }

  let conversation: typeof conversations.$inferSelect | undefined;
  if (conversationId) {
    [conversation] = await getDb().select().from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.userId, user.id))).limit(1);
    if (!conversation) return NextResponse.json({error:"Conversation not found"},{status:404});
  }
  const maxContextTokens = Number((settings.conversation_limits as { maxContextTokens?: number } | undefined)?.maxContextTokens ?? 50_000);
  const routerEnabled = (settings.model_router as { enabled?: boolean } | undefined)?.enabled ?? true;
  const estimatedPromptTokens = Math.ceil(prompt.length / 3);
  if ((conversation?.contextTokens ?? 0) + estimatedPromptTokens >= maxContextTokens) {
    return NextResponse.json({
      code: "CONVERSATION_LIMIT_REACHED",
      error: t(`This conversation is near the ${maxContextTokens.toLocaleString("en-US")}-token limit. Select “New chat” to avoid resending deep, expensive context.`, `Cuộc trò chuyện này đã gần chạm giới hạn ${maxContextTokens.toLocaleString("vi-VN")} token. Hãy bấm “Chat mới” để tránh gửi lại context quá sâu và tốn thêm token.`),
      conversationId: conversation?.id ?? null, contextTokens: conversation?.contextTokens ?? 0, maxContextTokens,
    }, { status: 409 });
  }
  if (!conversation) [conversation] = await getDb().insert(conversations).values({ userId: user.id, title: makeTitle(prompt, user.locale) }).returning();

  if (regenerate && conversationId) {
    const [latest] = await getDb().select({ id: messages.id, role: messages.role, tokenCount: messages.tokenCount, attachments: messages.attachments })
      .from(messages).where(eq(messages.conversationId, conversation.id)).orderBy(desc(messages.createdAt)).limit(1);
    if (latest?.role === "assistant") {
      await getDb().delete(messages).where(eq(messages.id, latest.id));
      await Promise.all(latest.attachments.map((file) => deleteChatFile(file.url)));
      await getDb().update(conversations).set({
        contextTokens: sql`(select coalesce(sum(chat_messages.token_count), 0) from ${messages} chat_messages where chat_messages.conversation_id = ${conversation.id})`,
        updatedAt: new Date(),
      }).where(eq(conversations.id, conversation.id));
    }
  }

  const inputAttachments: ChatAttachment[] = [];
  const rememberedDocuments:DocumentMemoryResult[]=[];
  const documentMemoryErrors:string[]=[];
  try {
    for (const { file, bytes } of attachmentData) {
      if(fileMemoryIntent){
        try{const result=await uploadRememberedDocument(user.id,file,conversation.id);rememberedDocuments.push(result);inputAttachments.push(result.attachment);}
        catch(error){documentMemoryErrors.push(`${file.name}: ${error instanceof Error?error.message:"Unable to remember document"}`);if(!documentMemoryOnly(prompt))inputAttachments.push(await saveChatFile(bytes,file.name,file.type,"input",user.id));}
      }else inputAttachments.push(await saveChatFile(bytes, file.name, file.type, "input", user.id));
    }
    if(fileMemoryIntent&&!attachments.length){
      const prior=selectDocuments(await documentCatalog(conversation.id),prompt);
      for(const file of prior){try{rememberedDocuments.push(await rememberDocument({userId:user.id,name:file.name,type:file.type,fileUrl:file.url,conversationId:conversation.id}));}catch(error){documentMemoryErrors.push(`${file.name}: ${error instanceof Error?error.message:"Unable to remember document"}`);}}
      if(!prior.length)documentMemoryErrors.push(t("Attach a document to remember, or name one already attached in this chat.","Hãy đính kèm tài liệu cần ghi nhớ, hoặc nêu tên tệp đã gửi trong phiên này."));
    }
    if(fileMemoryIntent)state.memoryNotice=[documentMemoryNotice(rememberedDocuments,user.locale==="vi"),...documentMemoryErrors].filter(Boolean).join("\n");
  } catch (error) {
    await Promise.all(inputAttachments.map((file) => deleteChatFile(file.url)));
    throw error;
  }
  let sourceMessageId: string | null = null;
  if (!regenerate) {
    const [savedUserMessage] = await getDb().insert(messages).values({ conversationId: conversation.id, role: "user", content: prompt, tokenCount: estimatedPromptTokens, attachments: inputAttachments }).returning({ id: messages.id });
    sourceMessageId = savedUserMessage?.id ?? null;
    if(fileMemoryIntent){
      await getDb().update(messages).set({memoryNotice:state.memoryNotice}).where(eq(messages.id,sourceMessageId!));
      if(documentMemoryOnly(prompt)){
        const text=state.memoryNotice||t("No document was remembered.","Chưa ghi nhớ tài liệu nào.");
        await getDb().insert(messages).values({conversationId:conversation.id,role:"assistant",content:text,model:"iTis Memory",memoryNotice:rememberedDocuments.some(r=>r.status==="saved")?"saved":documentMemoryErrors.length?"failed":"unchanged"});
        await getDb().update(conversations).set({contextTokens:sql`(select coalesce(sum(token_count),0) from messages where conversation_id=${conversation.id})`,updatedAt:new Date()}).where(eq(conversations.id,conversation.id));
        return NextResponse.json({text,model:"iTis Memory",provider:systemProvider,conversationId:conversation.id,attachments:[],usage:{total_tokens:0},memory:{status:documentMemoryErrors.length?(rememberedDocuments.length?"partial":"failed"):rememberedDocuments.some(r=>r.status==="saved")?"saved":"unchanged",documents:rememberedDocuments.map(r=>({name:r.document.name,status:r.status}))}});
      }
    }
    const [previousMemoryReply]=await getDb().select({role:messages.role,model:messages.model,memoryNotice:messages.memoryNotice}).from(messages).where(and(eq(messages.conversationId,conversation.id),ne(messages.id,sourceMessageId!))).orderBy(desc(messages.createdAt),desc(messages.id)).limit(1);
    const confirmedFollowup=previousMemoryReply?.role==="assistant"&&previousMemoryReply.model==="iTis Memory"&&previousMemoryReply.memoryNotice==="conflict"&&/^(?:hãy\s+)?(?:thay|đổi|cập nhật|bổ sung|đúng|ok|yes|replace|change|update|add)\b/i.test(prompt);
    if (!fileMemoryIntent && (confirmedFollowup || isExplicitMemoryRequest(prompt) || (user.memoryEnabled && user.autoMemory && inferMemoryCandidate(prompt)))) {
      const memory=await consolidateUserMemory({userId:user.id,message:prompt,locale:user.locale,sourceConversationId:conversation.id,sourceMessageId,confirmedFollowup});
      state.memoryNotice=memory.notice;
      if(memory.notice)await getDb().update(messages).set({memoryNotice:memory.notice}).where(eq(messages.id,sourceMessageId!));
      if(memory.changed)relevantMemories=await retrieveUserMemories(user.id,prompt,4);
      if((memoryOnlyRequest(prompt)||confirmedFollowup)&&!attachments.length){
        const text=memory.notice||t("No durable information was saved.","Chưa có thông tin dài hạn để lưu.");
        await getDb().insert(messages).values({conversationId:conversation.id,role:"assistant",content:text,model:"iTis Memory",tokenCount:Math.ceil(text.length/3),memoryNotice:memory.status});
        await getDb().update(conversations).set({contextTokens:sql`(select coalesce(sum(token_count),0) from messages where conversation_id=${conversation.id})`,updatedAt:new Date()}).where(eq(conversations.id,conversation.id));
        return NextResponse.json({text,model:"iTis Memory",provider:systemProvider,conversationId:conversation.id,attachments:[],memory,usage:memory.usage??{total_tokens:0}});
      }
      if(memory.usage)try{await assertContinuationBudget(user.id);}catch{return NextResponse.json({code:"TOKEN_LIMIT_AFTER_MEMORY",error:t("Memory processing used the remaining token budget. Contact an admin or wait for the cycle reset before continuing.","Xử lý bộ nhớ đã dùng hết quota còn lại. Hãy liên hệ admin hoặc chờ chu kỳ mới để tiếp tục."),conversationId:conversation.id},{status:429});}
    }
  } else {
    const [source]=await getDb().select({id:messages.id}).from(messages).where(and(eq(messages.conversationId,conversation.id),eq(messages.role,"user"))).orderBy(desc(messages.createdAt)).limit(1);
    sourceMessageId=source?.id??null;
  }
  const context = await buildChatContext(conversation.id,prompt,maxContextTokens,{compact:needsDocumentOutput(prompt)||attachments.length>0||needsComputation(prompt,true)});
  const history = context.history.filter(item => item.role === "user" || item.role === "assistant");
  const rememberedContext=user.memoryEnabled?await retrieveDocumentMemory(user.id,prompt):{context:"",files:[] as ChatAttachment[]};
  const rememberedFileTask=needsDocumentOutput(prompt)||isDocumentEditFollowup(prompt,true)||needsComputation(prompt,true);
  const catalog = [...await documentCatalog(conversation.id),...(rememberedFileTask?rememberedContext.files:[])];
  const referencesFiles = /file|tệp|tài liệu|dữ liệu|bảng|sheet|cột|dòng|đối chiếu|so sánh|tổng|số liệu|excel|pdf|docx|pptx|csv|xlsx|word|document|data|table|row|column|compare|total|continue|tiếp tục|làm tiếp|sửa|chỉnh|đổi|thay/i.test(prompt) || catalog.some(file=>prompt.toLowerCase().includes(file.name.toLowerCase()));
  const selectedFiles = attachmentData.length ? [...inputAttachments,...selectDocuments(catalog.filter(file=>!inputAttachments.some(input=>input.url===file.url)),prompt).filter(file=>prompt.toLowerCase().includes(file.name.toLowerCase()))] : referencesFiles ? selectDocuments(catalog,prompt) : [];
  const shouldReuseFiles = attachmentData.length === 0 && selectedFiles.length > 0;
  const restoredAttachmentData = shouldReuseFiles
    ? (await Promise.all(selectedFiles.slice(0, 10).map(loadStoredAttachment))).filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];
  const openAiAttachmentData = attachmentData.length
    ? attachmentData.map(({ file, bytes }) => ({ name: file.name, type: file.type || mimeFromName(file.name), bytes }))
    : restoredAttachmentData;
  if (shouldReuseFiles && !restoredAttachmentData.length) {
    return NextResponse.json({
      code: "ATTACHMENT_CONTEXT_MISSING",
      error: t("The previous file references are still in the conversation, but the stored files are no longer available. Please attach them again.", "Lịch sử vẫn còn tham chiếu file trước đó nhưng file lưu trên server không còn. Hãy đính kèm lại file."),
      conversationId: conversation.id,
    }, { status: 410 });
  }
  const memoryCapability = "iTis has private, per-account persistent memory managed by a server service. Only report a successful save when its authoritative result confirms it. Do not claim that cross-chat memory is unavailable. If no save result is present, do not claim anything was saved. A saved reference/preference is not a stored copy of an entire document.";
  const memoryContext = memoryCapability + "\n" + rememberedContext.context + "\n" + formatMemoryContext(relevantMemories, user.locale)+(state.memoryNotice?`\nMemory service result (authoritative): ${state.memoryNotice}\nOnly claim a memory was saved when the service confirms it. If clarification is requested, ask it; do not claim that conflicting information was updated.`:"");
  const systemPrompt = (user.locale === "vi" ? `Bạn là iTis, trợ lý AI cao cấp, chính xác, thực tế và hữu ích.
- Trả lời bằng ngôn ngữ của người dùng; mặc định là tiếng Việt tự nhiên.
- Đi thẳng vào kết quả, chỉ trả lời đúng phần người dùng yêu cầu. Không mở đầu xã giao, không nhắc lại đề bài và không kết luận dư thừa.
- Ngắn gọn nhưng không bỏ sót dữ kiện quan trọng. Không chép lại toàn bộ nội dung file nếu người dùng chỉ hỏi một phần.
- Khi có từ 3 trường dữ liệu trở lên cần so sánh, dùng bảng Markdown GFM ngắn gọn; không dựng bảng cho nội dung một dòng.
- Không bịa dữ kiện, nội dung file, số liệu hay nguồn. Nếu thiếu dữ liệu, nói rõ điều còn thiếu.
- Với file: bám sát nội dung, nêu sheet/trang/mục khi có thể, giữ nguyên số liệu và phân biệt dữ kiện với suy luận.
- Với code: đưa giải pháp chạy được, lưu ý rủi ro và bước kiểm thử quan trọng.
- Duy trì mạch hội thoại hiện tại nhưng không lặp lại toàn bộ nội dung cũ.
- Trình bày Markdown gọn, dùng danh sách/bảng chỉ khi giúp dễ đọc.` : `You are iTis, a premium AI assistant that is accurate, practical, and helpful.
- Reply in the user's language; default to natural English.
- Lead with the result. Answer only what the user asked, without unnecessary greetings, repetition, or conclusions.
- Be concise without omitting important facts. Do not reproduce an entire file when the user asks about one part.
- When comparing three or more data fields, use a compact GFM Markdown table; do not use a table for a single line.
- Never invent facts, file contents, figures, or sources. Clearly state what information is missing.
- For files: stay grounded in the content, cite the sheet/page/section when possible, preserve figures, and separate facts from inference.
- For code: provide a runnable solution and mention important risks and verification steps.
- Maintain continuity in the current conversation without repeating all previous content.
- Keep Markdown compact; use lists and tables only when they improve readability.`) + (memoryContext ? `\n\n${memoryContext}\n- Never reveal that another user has memories. Treat these memories as belonging only to the signed-in user.` : "");

  const artifactTask = needsDocumentOutput(prompt) || isDocumentEditFollowup(prompt,selectedFiles.length>0);
  const computationTask = (selectedFiles.length>0 && /toàn bộ|tất cả|đầy đủ|full review|every (?:row|sheet|page)|exhaustive/i.test(prompt)) || needsComputation(prompt, selectedFiles.length>0) || (selectedFiles.some(file=>/\.(csv|xlsx|xls)$/i.test(file.name)) && /phân tích|analy|dữ liệu|data/i.test(prompt));
  const simpleWord=fastWordMode(prompt,selectedFiles,computationTask,webSearchTask);
  if (systemProvider === "openai" && (artifactTask || computationTask || selectedFiles.length>0 || webSearchTask)) {
    return startChatJob({userId:user.id,conversationId:conversation.id,sourceMessageId,prompt,systemPrompt:`${systemPrompt}\n\n${context.contextNote}`,history:history.map(({role,content})=>({role,content})),documents:selectedFiles,catalog,artifact:artifactTask,compute:computationTask,webSearch:webSearchTask,model:(!routerEnabled||(!simpleWord&&(artifactTask||computationTask||isComplexTask(prompt))))?"gpt-6.1-sol":"gpt-6-luna",locale:user.locale},Boolean(request.headers.get("accept")?.includes("application/x-ndjson")),request.signal);
  }
  const wantsStream = request.headers.get("accept")?.includes("application/x-ndjson") && !artifactTask && openAiAttachmentData.length === 0;
  if (wantsStream) {
    const model = systemProvider === "local"
      ? (isCodeTask(prompt) ? LOCAL_AI_CODE_MODEL : LOCAL_AI_GENERAL_MODEL)
      : routerEnabled && !isComplexTask(prompt) ? "gpt-6-luna" : "gpt-6.1-sol";
    const routerReason = systemProvider === "local"
      ? (isCodeTask(prompt) ? "local_code" : "local_general")
      : webSearchTask ? "openai_web_search" : model === "gpt-6.1-sol" ? "openai_complex" : "openai_efficient";
    const abortController = new AbortController();
    request.signal.addEventListener("abort", () => abortController.abort(), { once: true });
    let clientClosed = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (event: Record<string, unknown>) => {
          if (clientClosed) return;
          try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { clientClosed = true; }
        };
        void (async () => {
          let text = "";
          let input = 0;
          let output = 0;
          let cached = 0;
          let reasoning = 0;
          let cacheWrite=0;
          let usageAvailable=false;
          let messageId:string|undefined;
          let usageRecorded=false;
          let requestId: string | null = null;
          let estimatedCostUsd = 0;
          let completed = false;
          emit({
            type: "meta", model, provider: systemProvider,
            conversationId: conversation.id, conversationTitle: conversation.title,
            maxContextTokens, webSearchUsed: webSearchTask,
          });
          try {
            if (systemProvider === "local") {
              const response = await fetch(`${LOCAL_AI_BASE_URL}/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: abortController.signal,
                body: JSON.stringify({
                  model,
                  messages: [{ role: "system", content: systemPrompt }, ...history],
                  temperature: 0.35,
                  max_tokens: isComplexTask(prompt) ? 1800 : 900,
                  stream: true,
                  stream_options: { include_usage: true },
                }),
              });
              if (!response.ok) throw new Error(`LM Studio HTTP ${response.status}: ${await response.text()}`);
              await readEventStream(response, (event) => {
                const choices = event.choices as Array<{ delta?: { content?: string }; finish_reason?: string | null }> | undefined;
                const delta = choices?.[0]?.delta?.content ?? "";
                if (delta) { text += delta; emit({ type: "delta", delta }); }
                const usage = event.usage as LocalPayload["usage"] | undefined;
                if (usage) {
                  usageAvailable=true;
                  input = usage.prompt_tokens ?? input;
                  output = usage.completion_tokens ?? output;
                }
                if (choices?.[0]?.finish_reason) completed = true;
              });
              input ||= Math.ceil(history.reduce((sum, item) => sum + item.content.length, systemPrompt.length) / 3);
              output ||= Math.ceil(text.length / 3);
            } else {
              const tools = webSearchTask
                ? [{ type: "web_search", search_context_size: isComplexTask(prompt) ? "medium" : "low" }]
                : [];
              const webSearchInstruction = webSearchTask
                ? t("\n- Search the web first. Use one authoritative inline citation per important current claim. Do not add a Sources or References section. Keep the answer compact.", "\n- Hãy tìm kiếm web trước. Mỗi thông tin hiện thời quan trọng chỉ dùng một dẫn nguồn có thẩm quyền ngay cạnh nội dung. Không thêm mục Sources/Nguồn/Tham khảo. Trả lời gọn.")
                : "";
              const response = await fetch("https://api.openai.com/v1/responses", {
                method: "POST",
                headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
                signal: abortController.signal,
                body: JSON.stringify({
                  model, safety_identifier: externalSafetyIdentifier(user.id), store: false,
                  reasoning: { effort: model === "gpt-6.1-sol" ? "medium" : "low" },
                  text: { verbosity: "low" },
                  max_output_tokens: webSearchTask ? (model === "gpt-6.1-sol" ? 1400 : 800) : model === "gpt-6.1-sol" ? 2200 : 900,
                  ...(tools.length ? { tools, tool_choice: "required" } : {}),
                  stream: true,
                  input: prepareOpenAiHistory([{ role: "developer", content: systemPrompt + webSearchInstruction + `\n\n${context.contextNote}` }, ...history]),
                }),
              });
              if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}: ${await response.text()}`);
              requestId = response.headers.get("x-request-id");
              await readEventStream(response, (event) => {
                if (event.type === "response.output_text.delta") {
                  const delta = typeof event.delta === "string" ? event.delta : "";
                  if (delta) { text += delta; emit({ type: "delta", delta }); }
                }
                const terminal=terminalProviderUsage(event);
                if (terminal) {
                  const payload = event.response as OpenAiPayload | undefined;
                  const finalText = payload?.output_text ?? payload?.output?.flatMap((item) => item.content ?? [])
                    .filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("\n") ?? "";
                  if (finalText) text = finalText;
                  input = payload?.usage?.input_tokens ?? input;
                  cached = payload?.usage?.input_tokens_details?.cached_tokens ?? cached;
                  output = payload?.usage?.output_tokens ?? output;
                  reasoning = payload?.usage?.output_tokens_details?.reasoning_tokens ?? reasoning;
                  cacheWrite=payload?.usage?.input_tokens_details?.cache_write_tokens??0;
                  usageAvailable=Boolean(payload?.usage);
                  completed = terminal.completed;
                }
                if (event.type === "response.incomplete")throw new Error("OUTPUT_LIMIT");
                if (event.type === "response.failed" || event.type === "error") {
                  throw new Error(String(event.message ?? "OpenAI stream failed."));
                }
              });
              output ||= Math.ceil(text.length / 3);
              estimatedCostUsd=estimateModelCost(model,{input_tokens:input,output_tokens:output,input_tokens_details:{cached_tokens:cached,cache_write_tokens:cacheWrite}});
            }

            if (text.trim()) {
              await getDb().transaction(async (tx) => {
                const [answer]=await tx.insert(messages).values({ conversationId: conversation.id, role: "assistant", content: text.trim(), model, tokenCount: output, taskUsage:taskUsage({input_tokens:input,output_tokens:output,input_tokens_details:{cached_tokens:cached,cache_write_tokens:cacheWrite},output_tokens_details:{reasoning_tokens:reasoning}},{estimated_cost_usd:estimatedCostUsd,usage_complete:usageAvailable}), attachments: [] }).returning({id:messages.id});messageId=answer.id;
                await tx.insert(usageEvents).values({
                  userId: user.id, conversationId: conversation.id, requestId, model,
                  inputTokens: input, cachedTokens: cached, reasoningTokens: reasoning, outputTokens: output,
                  toolDetails:{usageAvailable,cacheWriteTokens:cacheWrite},estimatedCostUsd: estimatedCostUsd.toFixed(8), routerReason: completed ? routerReason : `${routerReason}_stopped`,
                });
                await tx.update(conversations).set({ contextTokens: sql`(select coalesce(sum(chat_messages.token_count), 0) from ${messages} chat_messages where chat_messages.conversation_id = ${conversation.id})`, updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
              });usageRecorded=true;
            }
            emit({
              type: "done", text: text.trim(), messageId, model, provider: systemProvider,
              conversationId: conversation.id, conversationTitle: conversation.title,
              usage: taskUsage({input_tokens:input,output_tokens:output,input_tokens_details:{cached_tokens:cached,cache_write_tokens:cacheWrite},output_tokens_details:{reasoning_tokens:reasoning}},{estimated_cost_usd:estimatedCostUsd,usage_complete:usageAvailable}),
              estimated_cost_usd: estimatedCostUsd, stopped: !completed,
              cycle: { used: usedTokens + input + output, limit: user.tokenLimit, unlimited: user.unlimited },
              total: { used: lifetimeUsedTokens + input + output, limit: user.totalTokenLimit, unlimited: user.totalUnlimited },
            });
          } catch (error) {
            if (abortController.signal.aborted) {
              estimatedCostUsd=systemProvider==="openai"?estimateModelCost(model,{input_tokens:input,output_tokens:output,input_tokens_details:{cached_tokens:cached,cache_write_tokens:cacheWrite}}):0;
              if (text.trim()) {
                output ||= Math.ceil(text.length / 3);
                await getDb().transaction(async (tx) => {
                  const [answer]=await tx.insert(messages).values({ conversationId: conversation.id, role: "assistant", content: text.trim(), model, tokenCount: output, taskUsage:taskUsage({input_tokens:input,output_tokens:output,input_tokens_details:{cached_tokens:cached,cache_write_tokens:cacheWrite},output_tokens_details:{reasoning_tokens:reasoning}},{estimated_cost_usd:estimatedCostUsd,usage_complete:usageAvailable}), attachments: [] }).returning({id:messages.id});messageId=answer.id;
                  await tx.insert(usageEvents).values({
                    userId: user.id, conversationId: conversation.id, requestId, model,
                    inputTokens: input, cachedTokens: cached, reasoningTokens: reasoning, outputTokens: output,
                    toolDetails:{usageAvailable,cacheWriteTokens:cacheWrite},estimatedCostUsd: estimatedCostUsd.toFixed(8), routerReason: `${routerReason}_stopped`,
                  });
                  await tx.update(conversations).set({ contextTokens: sql`(select coalesce(sum(chat_messages.token_count), 0) from ${messages} chat_messages where chat_messages.conversation_id = ${conversation.id})`, updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
                }).then(()=>{usageRecorded=true;}).catch(() => undefined);
              }
            } else {
              console.error("Streaming AI request failed", error);
              if (isStorageError(error)) {
                await getDb().insert(usageEvents).values({ userId: user.id, model, requestId, inputTokens: input, cachedTokens: cached, reasoningTokens: reasoning, outputTokens: output, estimatedCostUsd: estimatedCostUsd.toFixed(8), routerReason: `${routerReason}_storage_full` });usageRecorded=true;
              }
              emit({ type: "error", error: isStorageError(error) ? STORAGE_ERROR : error instanceof Error&&error.message==="OUTPUT_LIMIT"?t("Processing limit reached. Your message is saved; retry or split the task.","Đã chạm giới hạn xử lý. Tin nhắn được giữ; hãy thử lại hoặc chia nhỏ yêu cầu."):t("The AI service is unavailable. Your message was saved so you can retry.", "Dịch vụ AI không khả dụng. Tin nhắn đã được lưu để bạn thử lại.") });
            }
          } finally {
            // Terminal failures and incomplete streams can still have billable provider usage.
            // Missing usage is explicitly marked, never presented as confirmed zero cost.
            if(systemProvider==="openai"&&!usageRecorded&&(requestId||usageAvailable)){
              const cost=estimateModelCost(model,{input_tokens:input,output_tokens:output,input_tokens_details:{cached_tokens:cached,cache_write_tokens:cacheWrite}});
              await getDb().insert(usageEvents).values({userId:user.id,conversationId:conversation.id,requestId,model,inputTokens:input,outputTokens:output,cachedTokens:cached,reasoningTokens:reasoning,estimatedCostUsd:cost.toFixed(8),toolDetails:{usageAvailable,cacheWriteTokens:cacheWrite},routerReason:`${routerReason}_incomplete`}).catch(()=>undefined);
            }
            if (!clientClosed) {
              try { controller.close(); } catch { /* client already disconnected */ }
            }
          }
        })();
      },
      cancel() {
        clientClosed = true;
        abortController.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  }

  let model: string;
  let text: string;
  let input = 0;
  let output = 0;
  let cached = 0;
  let reasoning = 0;
  let cacheWrite=0;
  let requestId: string | null = null;
  let estimatedCostUsd = 0;
  let routerReason: string;
  const outputAttachments: ChatAttachment[] = [];

  if (systemProvider === "local") {
    const codeTask = isCodeTask(prompt);
    model = codeTask ? LOCAL_AI_CODE_MODEL : LOCAL_AI_GENERAL_MODEL;
    routerReason = codeTask ? "local_code" : "local_general";
    try {
      const localHistory = history.map((item) => ({ role: item.role, content: item.content }));
      if (attachments.length) {
        let remainingCharacters = 80_000;
        const sections: string[] = [];
        for (const file of attachments) {
          if (remainingCharacters <= 0) break;
          const fileText = (await file.text()).slice(0, remainingCharacters);
          sections.push(`--- ${t("File", "Tệp")} ${file.name} ---\n${fileText}`);
          remainingCharacters -= fileText.length;
        }
        const lastUser = [...localHistory].reverse().find((item) => item.role === "user");
        if (lastUser) lastUser.content = `${lastUser.content}\n\n${sections.join("\n\n")}`;
      }
      const response = await fetch(`${LOCAL_AI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(180_000),
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: systemPrompt }, ...localHistory],
          temperature: 0.35,
          max_tokens: isComplexTask(prompt) || attachments.length ? 2200 : 1000,
          stream: false,
        }),
      });
      if (!response.ok) throw new Error(`LM Studio HTTP ${response.status}: ${await response.text()}`);
      const data = await response.json() as LocalPayload;
      text = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) throw new Error("LM Studio không trả về nội dung.");
      input = data.usage?.prompt_tokens ?? Math.ceil(history.reduce((sum, item) => sum + item.content.length, systemPrompt.length) / 3);
      output = data.usage?.completion_tokens ?? Math.ceil(text.length / 3);
      model = data.model || model;
    } catch (error) {
      console.error("Local AI request failed", error);
      return NextResponse.json({
        code: "LOCAL_AI_UNAVAILABLE",
        error: t("Unable to connect to the local model in LM Studio. Check the Local Server and loaded model.", "Không kết nối được model local trong LM Studio. Hãy kiểm tra Local Server và model đang được load."),
        conversationId: conversation.id,
      }, { status: 502 });
    }
  } else {
    model = routerEnabled && openAiAttachmentData.length === 0 && !isComplexTask(prompt) ? "gpt-6-luna" : "gpt-6.1-sol";
    routerReason = webSearchTask ? "openai_web_search" : model === "gpt-6.1-sol" ? "openai_complex" : "openai_efficient";
    const openAiHistory: Array<{ role: string; content: string | Array<Record<string, unknown>> }> = history.map((item) => ({
      role: item.role,
      content: item.attachments?.length
        ? `${item.content}\n\n[${t("Files in this message", "Các file trong tin nhắn này")}: ${item.attachments.map((attachment) => attachment.name).join(", ")}]`
        : item.content,
    }));
    if (openAiAttachmentData.length) {
      const lastUser = [...openAiHistory].reverse().find((item) => item.role === "user");
      if (lastUser) {
        const content: Array<Record<string, unknown>> = [];
        for (const { name, type, bytes } of openAiAttachmentData) {
          const dataUrl = `data:${type || "application/octet-stream"};base64,${Buffer.from(bytes).toString("base64")}`;
          if (type.startsWith("image/")) {
            content.push({ type: "input_image", image_url: dataUrl, detail: "low" });
          } else {
            content.push({ type: "input_file", filename: name, file_data: dataUrl, ...(type === "application/pdf" ? { detail: "low" } : {}) });
          }
        }
        content.push({
          type: "input_text",
          text: restoredAttachmentData.length
            ? `${prompt}\n\n${t("Continue using the files restored from the most recent file message in this conversation. Do not ask the user to upload them again.", "Hãy tiếp tục dùng các file được lấy lại từ tin nhắn có file gần nhất trong cuộc trò chuyện này. Không yêu cầu người dùng tải lại.")}`
            : prompt,
        });
        lastUser.content = content;
      }
    }
    const tools: Array<Record<string, unknown>> = [];
    if (webSearchTask) tools.push({ type: "web_search", search_context_size: isComplexTask(prompt) ? "medium" : "low" });
    if (artifactTask) tools.push({ type: "code_interpreter", container: { type: "auto", memory_limit: "4g" } });
    const webSearchInstruction = webSearchTask
      ? t("\n- Use web search before answering this request. Prefer recent primary or authoritative sources, compare publication and event dates, and never invent citations. Cite only the most relevant source inline beside the supported claim. Do not add a Sources or References section and do not repeat links. Keep the answer compact.", "\n- Hãy tìm kiếm web trước khi trả lời yêu cầu này. Ưu tiên nguồn gốc hoặc nguồn có thẩm quyền và mới, đối chiếu ngày đăng với ngày xảy ra sự kiện và tuyệt đối không bịa nguồn. Chỉ dẫn nguồn phù hợp nhất ngay cạnh thông tin được hỗ trợ. Không thêm mục Sources/Nguồn/Tham khảo và không lặp lại link. Trả lời gọn.")
      : "";
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, safety_identifier: externalSafetyIdentifier(user.id), store: false,
        reasoning: { effort: artifactTask ? "low" : model === "gpt-6.1-sol" ? "medium" : "low" },
        text: { verbosity: "low" },
        max_output_tokens: artifactTask ? 16000 : webSearchTask ? (model === "gpt-6.1-sol" ? 1600 : 900) : model === "gpt-6.1-sol" ? 2500 : 1000,
        ...(tools.length ? { tools, tool_choice: "required" } : {}),
        input: prepareOpenAiHistory([{
          role: "developer",
          content: (artifactTask
            ? `${systemPrompt}\n${t("- The current request requires creating or editing a file. Immediately use the Python tool instead of explaining a plan. Create the complete output file with a meaningful name, verify that it exists in the container, then cite the exact file in the final response so it can be downloaded. Do not merely instruct the user to do it themselves.", "- Yêu cầu hiện tại cần tạo hoặc chỉnh sửa tệp. Hãy dùng Python tool ngay thay vì giải thích kế hoạch. Tạo file đầu ra hoàn chỉnh với tên có nghĩa, kiểm tra file thực sự tồn tại trong container, sau đó dẫn chính xác file đó trong câu trả lời cuối để người dùng tải xuống. Không chỉ hướng dẫn người dùng tự làm.")}`
            : systemPrompt) + webSearchInstruction + `\n\n${context.contextNote}`,
        }, ...openAiHistory]),
      }),
    });
    if (!response.ok) {
      console.error("OpenAI request failed", response.status, await response.text());
      return NextResponse.json({ error: t("The OpenAI API is unavailable. Your message was saved so you can try again.", "OpenAI API không khả dụng. Tin nhắn đã được lưu để bạn thử lại.") }, { status: 502 });
    }
    const data = await response.json() as OpenAiPayload;
    input = data.usage?.input_tokens ?? 0;
    cached = data.usage?.input_tokens_details?.cached_tokens ?? 0;
    cacheWrite=data.usage?.input_tokens_details?.cache_write_tokens??0;
    output = data.usage?.output_tokens ?? 0;
    reasoning = data.usage?.output_tokens_details?.reasoning_tokens ?? 0;
    estimatedCostUsd=estimateModelCost(model,data.usage??{});
    text = data.output_text ?? data.output?.flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("\n") ?? "";
    // Account for provider usage even if a generated file exceeds storage quota.
    requestId = response.headers.get("x-request-id");
    await getDb().insert(usageEvents).values({ userId: user.id, model, requestId, inputTokens: input, cachedTokens: cached, reasoningTokens: reasoning, outputTokens: output, estimatedCostUsd: estimatedCostUsd.toFixed(8), routerReason });
    if (artifactTask) {
      const downloadedFileIds = new Set<string>();
      const citations = (data.output ?? []).flatMap((item) => item.content ?? [])
        .flatMap((content) => content.annotations ?? [])
        .filter((annotation) => annotation.type === "container_file_citation" && annotation.container_id && annotation.file_id);
      for (const citation of citations) {
        const fileResponse = await fetch(`https://api.openai.com/v1/containers/${citation.container_id}/files/${citation.file_id}/content`, {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        });
        if (!fileResponse.ok) continue;
        const filename = citation.filename || `itis-output-${citation.file_id}`;
        outputAttachments.push(await saveChatFile(new Uint8Array(await fileResponse.arrayBuffer()), filename, mimeFromName(filename), "output", user.id));
        downloadedFileIds.add(citation.file_id!);
      }
      if (!outputAttachments.length) {
        const containerIds = [...new Set((data.output ?? [])
          .filter((item) => item.type === "code_interpreter_call" && item.container_id)
          .map((item) => item.container_id!))];
        const preferredExtensions = preferredArtifactExtensions(`${prompt} ${history.map((item) => item.content).join(" ")}`);
        for (const containerId of containerIds) {
          const listResponse = await fetch(`https://api.openai.com/v1/containers/${containerId}/files?limit=100&order=desc`, {
            headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          });
          if (!listResponse.ok) continue;
          const listed = await listResponse.json() as {
            data?: Array<{ id: string; path?: string; source?: string; bytes?: number }>;
          };
          const generated = (listed.data ?? []).filter((file) => {
            const extension = extname(file.path ?? "").toLowerCase();
            return file.source === "assistant" && preferredExtensions.has(extension) && !downloadedFileIds.has(file.id);
          }).slice(0, 3);
          for (const file of generated) {
            const fileResponse = await fetch(`https://api.openai.com/v1/containers/${containerId}/files/${file.id}/content`, {
              headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
            });
            if (!fileResponse.ok) continue;
            const filename = basename(file.path || `itis-output-${file.id}`);
            outputAttachments.push(await saveChatFile(new Uint8Array(await fileResponse.arrayBuffer()), filename, mimeFromName(filename), "output", user.id));
            downloadedFileIds.add(file.id);
          }
        }
      }
      text = text.replace(/\[[^\]]*\]\(sandbox:[^)]+\)/gi, t("The downloadable file is attached below.", "File tải xuống đã được đính kèm bên dưới."));
      if (outputAttachments.length && !text.trim()) text = t("The requested file is ready. Download it below.", "Đã tạo file theo yêu cầu. Bạn có thể tải xuống bên dưới.");
      if (!outputAttachments.length) {
        const hitLimit = data.status === "incomplete" && data.incomplete_details?.reason === "max_output_tokens";
        text = `${text.trim()}\n\n${hitLimit
          ? t("The file task reached its processing limit before the output could be finalized. Please try again; iTis will reuse the files from this conversation.", "Tác vụ đã chạm giới hạn xử lý trước khi hoàn tất file. Hãy bấm thử lại; iTis sẽ tự dùng lại các file trong cuộc trò chuyện này.")
          : t("I could not create the output file this time. Try again or specify the required format.", "Mình chưa tạo được file đầu ra trong lần này. Hãy thử lại hoặc mô tả rõ định dạng cần xuất.")}`.trim();
      }
    }
    requestId = response.headers.get("x-request-id");
  }

  let messageId:string|undefined;
  const finalUsage=taskUsage({input_tokens:input,output_tokens:output,input_tokens_details:{cached_tokens:cached,cache_write_tokens:cacheWrite},output_tokens_details:{reasoning_tokens:reasoning}},{estimated_cost_usd:estimatedCostUsd});
  await getDb().transaction(async (tx) => {
    const [answer]=await tx.insert(messages).values({ conversationId: conversation.id, role: "assistant", content: text, model, tokenCount: output, taskUsage:finalUsage, attachments: outputAttachments }).returning({id:messages.id});messageId=answer.id;
    if (systemProvider === "local") await tx.insert(usageEvents).values({
      userId: user.id, conversationId: conversation.id, requestId, model,
      inputTokens: input, cachedTokens: cached, reasoningTokens: reasoning, outputTokens: output,
      estimatedCostUsd: estimatedCostUsd.toFixed(8), routerReason,
    });
    await tx.update(conversations).set({ contextTokens: sql`(select coalesce(sum(chat_messages.token_count), 0) from ${messages} chat_messages where chat_messages.conversation_id = ${conversation.id})`, updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
  });

  return NextResponse.json({
    text, messageId, model, provider: systemProvider, webSearchUsed: webSearchTask, attachments: outputAttachments,
    conversationId: conversation.id, conversationTitle: conversation.title, maxContextTokens,
    usage: finalUsage,
    estimated_cost_usd: estimatedCostUsd,
    cycle: { used: usedTokens + input + output, limit: user.tokenLimit, unlimited: user.unlimited },
    total: { used: lifetimeUsedTokens + input + output, limit: user.totalTokenLimit, unlimited: user.totalUnlimited },
  });
}
