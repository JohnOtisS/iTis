"use client";

import { isBlockedArtifactSource } from "@/lib/artifact-policy";
import {upsertReply} from "@/lib/provider-events";
import {readChatEvents} from "@/lib/chat-stream";
import {taskFailureText} from "@/lib/task-failure";

/* Native img is intentional for authenticated files, blob previews, and user-uploaded assets. */
/* eslint-disable @next/next/no-img-element */

import {defaultUploadLimits,uploadError,validUploadLimits,type UploadLimits} from "@/lib/upload-policy";
import {MemoryDocuments} from "@/components/memory-documents";
import {AccountSecurity,AccountNotifications} from "@/components/account-security";
import {AdminNotifications,AdminResetPassword} from "@/components/admin-notifications";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { defaultRoleLimits } from "@/lib/quota-plans";
import {
  Activity,
  ArrowUp,
  BrainCircuit,
  Check,
  CircleGauge,
  Clock3,
  Coins,
  Copy,
  Cpu,
  Download,
  FileArchive,
  FileSpreadsheet,
  GitBranch,
  Image as ImageIcon,
  Infinity as InfinityIcon,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  MessageSquareText,
  Mic,
  MicOff,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Progress } from "@/components/ui/progress";
import {Popover,PopoverTrigger,PopoverContent} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { BrandLogo } from "@/components/itis-logo";

type User = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
  locale: "en" | "vi";
  role: "admin" | "plus" | "standard";
  imageProvider: "openai" | "comfyui" | "disabled";
  memoryEnabled: boolean;
  autoMemory: boolean;
};
type View = "chat" | "images" | "usage" | "account" | "admin";
type ChatAttachment = {
  version?: number;
  family?: string;
  sourceUrls?: string[];
  name: string;
  url?: string;
  type?: string;
  size?: number;
  kind?: "input" | "output";
};
type Msg = {
  taskUsage?: Partial<import("@/lib/task-usage").TaskUsage> | null;
  memoryNotice?: string | null;
  id?: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  tokens?: number;
  attachments?: ChatAttachment[];
  createdAt?: string;
};
type Account = {
  user: {
    id: string;
    name: string;
    email: string;
    locale: "en" | "vi";
    avatarUrl: string | null;
    role: "admin" | "plus" | "standard";
    tokenLimit: number;
    unlimited: boolean;
    totalTokenLimit: number;
    totalUnlimited: boolean;
    resetWindowHours: number;
    aiProvider: "openai" | "local";
    imageProvider: "openai" | "comfyui" | "disabled";
    memoryEnabled: boolean;
    autoMemory: boolean;
  };
  system: {
    openaiConfigured: boolean;
    localAiConnected: boolean;
    localModels: string[];
    localGeneralModel: string;
    localCodeModel: string;
    comfyUiConnected: boolean;
    database: string;
    cache: string;
    aiEnvironment: "local" | "openai";
    localStatusChecked: boolean;
    maxContextTokens: number;
    uploadLimits:UploadLimits;
    branding: Branding;
  };
  usage: {
    used: number;
    remaining: number | null;
    limit: number;
    unlimited: boolean;
    requests: number;
    resetsAt: string;
    totalUsed: number;
    totalRemaining: number | null;
    totalLimit: number;
    totalUnlimited: boolean;
    lifetimeRequests: number;
    byModel: Array<{ model: string; tokens: number }>;
    daily: Array<{ day: string; tokens: number }>;
  };
  memory: { count: number };
  storage: { limitBytes: number; historyBytes: number; fileBytes: number; usedBytes: number };
};
type UserMemory = {
  canUndo?: boolean;
  id: string;
  kind: "profile" | "preference" | "knowledge" | "instruction";
  content: string;
  confidence: number;
  sourceConversationId: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type Member = {
  allowMultipleSessions: boolean;
  lastSeenAt: string | null;
  accessExpiresAt: string | null;
  accessExpired: boolean;
  activeSeconds: number;
  storageLimitBytes: number;
  storageUsedBytes: number;
  id: string;
  name: string;
  email: string;
  role: "admin" | "plus" | "standard";
  usedTokens: number;
  costUsd: number;
  unlimited: boolean;
  tokenLimit: number;
  totalTokenLimit: number;
  totalUnlimited: boolean;
  resetWindowHours: number;
  isActive: boolean;
  avatarUrl: string | null;
  aiProvider: "openai" | "local";
  imageProvider: "openai" | "comfyui" | "disabled";
  memoryEnabled: boolean;
  autoMemory: boolean;
};
type GeneratedImage = {
  id: string;
  prompt: string;
  provider: "openai" | "comfyui";
  model: string;
  status: "processing" | "completed" | "failed" | "canceled";
  progress: number;
  stage: string;
  url: string | null;
  size: string;
  quality: string;
  background: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  error: string | null;
  createdAt: string;
};
type Conversation = {
  id: string;
  title: string;
  contextTokens: number;
  createdAt: string;
  updatedAt: string;
};
type Settings = {
  aiEnvironment: { provider: "local" | "openai" };
  roleLimits: {
    standard: RolePlan;
    plus: RolePlan;
    admin: RolePlan;
  };
  tokenReset: { windowHours: number };
  modelRouter: { lunaPercent: number; solPercent: number; enabled: boolean };
  chatLimits: { maxContextTokens: number };
  uploadLimits:UploadLimits;
  branding: Branding;
};
type Branding = {
  systemLogoUrl: string | null;
  chatLogoUrl: string | null;
};

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      0: { transcript: string };
    };
  };
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
};
type RolePlan = {
  cycleTokens: number;
  cycleUnlimited: boolean;
  totalTokens: number;
  totalUnlimited: boolean;
};

type AppLocale = "en" | "vi";
const LocaleContext = createContext<AppLocale>("en");

function useLanguage() {
  const locale = useContext(LocaleContext);
  return {
    locale,
    t: (english: string, vietnamese: string) =>
      locale === "vi" ? vietnamese : english,
    numberLocale: locale === "vi" ? "vi-VN" : "en-US",
  };
}

const defaultSettings: Settings = {
  aiEnvironment: { provider: "openai" },
  roleLimits: defaultRoleLimits,
  tokenReset: { windowHours: 5 },
  modelRouter: { lunaPercent: 80, solPercent: 20, enabled: true },
  chatLimits: { maxContextTokens: 50000 },
  uploadLimits:defaultUploadLimits,
  branding: { systemLogoUrl: null, chatLogoUrl: null },
};

const workspaceCache: {
  userId?: string;
  account?: Account;
  conversations?: Conversation[];
  members?: Member[];
  settings?: Settings;
  generatedImages?: GeneratedImage[];
} = {};

export function ItisWorkspace({
  user,
  initialView,
  initialConversationId,
  initialSidebarOpen,
}: {
  user: User;
  initialView: View;
  initialConversationId: string | null;
  initialSidebarOpen: boolean;
}) {
  const router = useRouter();
  const cachedWorkspace =
    workspaceCache.userId === user.userId ? workspaceCache : {};
  const [view, setView] = useState<View>(initialView);
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId,
  );
  const [conversations, setConversations] = useState<Conversation[]>(
    () => cachedWorkspace.conversations ?? [],
  );
  const [messages, setMessages] = useState<Msg[]>([]);
  const [account, setAccount] = useState<Account | null>(
    () => cachedWorkspace.account ?? null,
  );
  const [members, setMembers] = useState<Member[]>(
    () => cachedWorkspace.members ?? [],
  );
  const [settings, setSettings] = useState<Settings>(
    () => cachedWorkspace.settings ?? defaultSettings,
  );
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>(
    () => cachedWorkspace.generatedImages ?? [],
  );
  const [dataError, setDataError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [taskStage, setTaskStage] = useState("");
  const [taskFailure,setTaskFailure]=useState<{conversationId:string;message:string}|null>(null);
  const [retryableTask, setRetryableTask] = useState<{prompt:string;conversationId:string}|null>(null);
  const activeJobRef = useRef<string | null>(null);
  const streamMessageRef=useRef<string|null>(null);
  const deliveredJobRef=useRef<string|null>(null);
  const liveConversationRef=useRef<string|null>(null);
  const conversationRef=useRef(conversationId);conversationRef.current=conversationId;
  const [taskElapsed,setTaskElapsed]=useState(0);
  useEffect(()=>{if(!sending)return;const timer=setInterval(()=>setTaskElapsed(n=>n+1),1000);return ()=>clearInterval(timer);},[sending]);
  const [loggingOut, setLoggingOut] = useState(false);
  const [deletingConversationId, setDeletingConversationId] = useState<
    string | null
  >(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historySearchResults, setHistorySearchResults] = useState<Conversation[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  useEffect(()=>()=>{requestAbortRef.current?.abort();},[]);

  const displayName = account?.user.name ?? user.displayName;
  const locale: AppLocale = account?.user.locale ?? user.locale ?? "en";
  const t = (english: string, vietnamese: string) =>
    locale === "vi" ? vietnamese : english;
  const avatarUrl = account?.user.avatarUrl ?? null;
  const systemLogoUrl = settings.branding.systemLogoUrl;
  const chatLogoUrl = settings.branding.chatLogoUrl;
  const firstName = displayName.split(" ").at(-1) || t("there", "bạn");
  const selectedModel = !account
    ? t("Loading configuration…", "Đang tải cấu hình…")
    : account.user.aiProvider === "local"
      ? "Local · Qwen / DeepSeek"
      : "OpenAI · Smart Router";
  const textProviderReady = account
    ? account.user.aiProvider === "local"
      ? account.system.localAiConnected
      : account.system.openaiConfigured
    : null;
  const signedInUserId = account?.user.id;
  useEffect(() => {
    if (!signedInUserId) return;
    let lastInteraction = Date.now();
    let lastPing = 0;
    let disposed = false;
    function ping() {
      const now = Date.now();
      if (document.visibilityState !== "visible" || !document.hasFocus() ||
        now - lastInteraction > 5 * 60_000 || now - lastPing < 55_000) return;
      lastPing = now;
      void fetch("/api/account/activity", { method: "POST" })
        .then(response => {
          if (!disposed && response.status === 401) window.location.replace("/login");
        })
        .catch(() => {});
    }
    function interact() {
      lastInteraction = Date.now();
      ping();
    }
    const events = ["pointerdown", "keydown", "scroll", "focus"] as const;
    for (const event of events) window.addEventListener(event, interact, { capture: true, passive: true });
    const timer = window.setInterval(ping, 60_000);
    ping();
    return () => {
      disposed = true;
      window.clearInterval(timer);
      for (const event of events) window.removeEventListener(event, interact, true);
    };
  }, [signedInUserId]);
  const activeProviderLabel = !account
    ? t("Connecting", "Đang kết nối")
    : view === "images"
      ? account?.user.imageProvider === "comfyui"
        ? "ComfyUI"
        : account?.user.imageProvider === "disabled"
          ? t("Image generation disabled", "Tạo ảnh đã tắt")
          : "OpenAI Image"
      : account?.user.aiProvider === "local"
        ? "Local AI"
        : "OpenAI";
  const activeProviderReady = !account
    ? null
    : view === "images"
      ? account?.user.imageProvider === "comfyui"
        ? account?.system.comfyUiConnected
        : account?.user.imageProvider === "openai"
          ? account?.system.openaiConfigured
          : false
      : textProviderReady;
  const activeConversation = conversations.find(
    (item) => item.id === conversationId,
  );
  const contextLimit = settings.chatLimits.maxContextTokens;
  const contextPercent = Math.min(
    100,
    Math.round(
      ((activeConversation?.contextTokens ?? 0) / Math.max(1, contextLimit)) *
        100,
    ),
  );
  const filteredConversations = useMemo(
    () => historyQuery.trim()
      ? historySearchResults ?? conversations.filter((item) =>
          item.title.toLowerCase().includes(historyQuery.toLowerCase()),
        )
      : conversations,
    [conversations, historyQuery, historySearchResults],
  );

  useEffect(() => {
    const query = historyQuery.trim();
    if (!query) {
      setHistorySearchResults(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/conversations?q=${encodeURIComponent(query)}`, {
        cache: "no-store",
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) return;
        const data = await response.json() as { conversations?: Conversation[] };
        setHistorySearchResults(data.conversations ?? []);
      }).catch(() => undefined);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [historyQuery]);

  async function loadData() {
    setDataError("");
    try {
      const [accountRes, conversationsRes] = await Promise.all([
        fetch("/api/account", { cache: "no-store" }),
        fetch("/api/conversations", { cache: "no-store" }),
      ]);
      if(accountRes.status===401||conversationsRes.status===401){window.location.replace("/login?session=ended");return;}
      if (!accountRes.ok || !conversationsRes.ok)
        throw new Error(t("Unable to load account data.", "Không tải được dữ liệu tài khoản."));
      const nextAccount = (await accountRes.json()) as Account;
      const nextConversations = (await conversationsRes.json()) as {
        conversations: Conversation[];
      };
      workspaceCache.userId = user.userId;
      workspaceCache.account = nextAccount;
      workspaceCache.conversations = nextConversations.conversations;
      setAccount(nextAccount);
      const publicSettings = {
        ...(workspaceCache.settings ?? settings),
        aiEnvironment: { provider: nextAccount.system.aiEnvironment },
        chatLimits: { maxContextTokens: nextAccount.system.maxContextTokens },
        uploadLimits:nextAccount.system.uploadLimits??defaultUploadLimits,
        branding: nextAccount.system.branding,
      } satisfies Settings;
      workspaceCache.settings = publicSettings;
      setSettings((current) => ({
        ...current,
        aiEnvironment: { provider: nextAccount.system.aiEnvironment },
        chatLimits: { maxContextTokens: nextAccount.system.maxContextTokens },
        uploadLimits:nextAccount.system.uploadLimits??defaultUploadLimits,
        branding: nextAccount.system.branding,
      }));
      setConversations(nextConversations.conversations);
      let nextImages: GeneratedImage[] = [];
      if (nextAccount.user.imageProvider !== "disabled") {
        const imagesRes = await fetch("/api/images", { cache: "no-store" });
        if (!imagesRes.ok) throw new Error(t("Unable to load image library.", "Không tải được thư viện ảnh."));
        nextImages = ((await imagesRes.json()) as { images: GeneratedImage[] })
          .images;
      }
      workspaceCache.generatedImages = nextImages;
      setGeneratedImages(nextImages);

      if (nextAccount.user.role === "admin") {
        const [usersRes, settingsRes] = await Promise.all([
          fetch("/api/admin/users", { cache: "no-store" }),
          fetch("/api/admin/settings", { cache: "no-store" }),
        ]);
        if (!usersRes.ok || !settingsRes.ok)
          throw new Error(t("Unable to load admin data.", "Không tải được dữ liệu quản trị."));
        const nextMembers = ((await usersRes.json()) as { users: Member[] })
          .users;
        const nextSettings = (
          (await settingsRes.json()) as { settings: Settings }
        ).settings;
        workspaceCache.members = nextMembers;
        workspaceCache.settings = nextSettings;
        setMembers(nextMembers);
        setSettings(nextSettings);
      }
    } catch (error) {
      setDataError(
        error instanceof Error
          ? error.message
          : t("Data is temporarily unavailable.", "Dữ liệu tạm thời không khả dụng."),
      );
    }
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setDataError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(t("Unable to sign out.", "Không thể đăng xuất."));
      workspaceCache.userId = undefined;
      workspaceCache.account = undefined;
      workspaceCache.conversations = undefined;
      workspaceCache.members = undefined;
      workspaceCache.settings = undefined;
      workspaceCache.generatedImages = undefined;
      router.replace("/login");
      router.refresh();
    } catch (logoutError) {
      setDataError(
        logoutError instanceof Error
          ? logoutError.message
          : t("Unable to sign out.", "Không thể đăng xuất."),
      );
      setLoggingOut(false);
    }
  }

  async function exportAnswer(messageId:string){
    if(!conversationId)return;
    const response=await fetch(`/api/conversations/${conversationId}/export`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sourceMessageId:messageId,format:"docx"})});
    const result=await response.json() as {error?:string};
    if(!response.ok)throw new Error(result.error||t("Unable to export answer.","Không thể xuất câu trả lời."));
    await loadConversation(conversationId,false);
    void loadData();
  }

  async function loadConversation(id: string, navigate = true) {
    if(navigate&&id!==conversationRef.current){requestAbortRef.current?.abort();requestAbortRef.current=null;activeJobRef.current=null;streamMessageRef.current=null;liveConversationRef.current=null;setSending(false);}

    setLoadingConversation(true);
    try {
      const response = await fetch(`/api/conversations/${id}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        error?: string;
        conversation?: Conversation;
        messages?: Array<{
          id: string;
          role: string;
          content: string;
          model: string | null;
          tokenCount: number;
          taskUsage?: Partial<import("@/lib/task-usage").TaskUsage> | null;
          attachments?: ChatAttachment[];
          memoryNotice?: string | null;
          createdAt: string;
        }>;
      };
      if (!response.ok || !data.conversation)
        throw new Error(data.error || t("Unable to load conversation history.", "Không tải được lịch sử."));
      if(requestAbortRef.current&&liveConversationRef.current===id)return;
      setConversationId(id);
      setMessages(
        (data.messages ?? [])
          .filter((item) => item.role === "user" || item.role === "assistant")
          .map((item) => ({
            id: item.id,
            role: item.role as "user" | "assistant",
            content: item.content,
            model:
              item.role === "assistant"
                ? shortModelLabel(item.model)
                : undefined,
            tokens: item.taskUsage?.total_tokens??item.tokenCount,
            taskUsage:item.taskUsage,
            attachments: item.attachments ?? [],
            memoryNotice: item.memoryNotice,
            createdAt: item.createdAt,
          })),
      );
      setView("chat");
      if (navigate) router.push(`/chat/${id}`);
    } catch (error) {
      setDataError(
        error instanceof Error ? error.message : t("Unable to load conversation history.", "Không tải được lịch sử."),
      );
    } finally {
      setLoadingConversation(false);
    }
  }

  function startNewChat() {
    requestAbortRef.current?.abort();requestAbortRef.current=null;activeJobRef.current=null;streamMessageRef.current=null;liveConversationRef.current=null;setSending(false);
    setConversationId(null);
    setMessages([]);
    setPrompt("");
    setView("chat");
    router.push("/chat");
  }

  async function deleteConversation(id: string) {
    const chat = conversations.find((item) => item.id === id);
    if (
      !window.confirm(
        locale === "vi"
          ? `Xóa cuộc trò chuyện “${chat?.title || "Chat"}”? Tin nhắn và tệp đính kèm của phiên này sẽ bị xóa khỏi máy chủ.`
          : `Delete “${chat?.title || "Chat"}”? Its messages and attachments will be removed from the server.`,
      )
    )
      return;
    setDeletingConversationId(id);
    const response = await fetch(`/api/conversations/${id}`, {
      method: "DELETE",
    });
    setDeletingConversationId(null);
    if (!response.ok) {
      setDataError(t("Unable to delete the conversation.", "Không thể xóa cuộc trò chuyện."));
      return;
    }
    const nextConversations = conversations.filter((item) => item.id !== id);
    workspaceCache.conversations = nextConversations;
    setConversations(nextConversations);
    if (conversationId === id) startNewChat();
    await loadData();
  }

  async function clearConversationHistory() {
    if (!conversations.length) return;
    if (
      !window.confirm(
        locale === "vi"
          ? `Xóa toàn bộ ${conversations.length} cuộc trò chuyện? Tin nhắn và tệp đính kèm của tài khoản này sẽ bị xóa vĩnh viễn.`
          : `Delete all ${conversations.length} conversations? This account's messages and attachments will be permanently removed.`,
      )
    )
      return;
    const response = await fetch("/api/conversations", { method: "DELETE" });
    if (!response.ok) throw new Error(t("Unable to clear conversation history.", "Không thể xóa toàn bộ lịch sử."));
    workspaceCache.conversations = [];
    setConversations([]);
    startNewChat();
    await loadData();
  }

  function navigate(viewName: View) {
    setView(viewName);
    router.push(
      viewName === "chat"
        ? conversationId
          ? `/chat/${conversationId}`
          : "/chat"
        : `/${viewName}`,
    );
  }

  useEffect(() => {
    router.prefetch("/chat");
    router.prefetch("/images");
    router.prefetch("/usage");
    router.prefetch("/account");
    if (user.role === "admin") router.prefetch("/admin");
  }, [router, user.role]);

  useEffect(() => {
    let active = true;
    async function refreshQuota() {
      const response = await fetch("/api/account", { cache: "no-store" }).catch(
        () => null,
      );
      if (!active) return;
      if(response?.status===401){window.location.replace("/login?session=ended");return;}
      if (!response?.ok) return;
      const nextAccount = (await response.json()) as Account;
      workspaceCache.account = nextAccount;
      setAccount(nextAccount);
    }
    const onFocus = () => void refreshQuota();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void refreshQuota(), 20_000);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [user.userId]);

  useEffect(() => {
    if (view === "images" && account?.user.imageProvider === "disabled") {
      setView("chat");
      router.replace("/chat");
    }
  }, [account?.user.imageProvider, router, view]);

  useEffect(() => {
    if(requestAbortRef.current&&liveConversationRef.current===initialConversationId)return;
    setView(initialView);
    setConversationId(initialConversationId);
    void loadData();
    if (initialConversationId)
      void loadConversation(initialConversationId, false);
    else if (initialView === "chat") setMessages([]);
    // Initial route props are the navigation source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialView, initialConversationId]);

  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options?: { signal?: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: "start_new_chat",
          title: t("Start a new chat", "Bắt đầu chat mới"),
          description: t("Open a new iTis conversation.", "Mở một phiên trò chuyện iTis mới."),
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false },
          execute: () => {
            startNewChat();
            return { status: "ready" };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);
    return () => lifecycle.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopGenerating() {
    if (activeJobRef.current) void fetch(`/api/chat/jobs/${activeJobRef.current}`,{method:"POST"});
    requestAbortRef.current?.abort();
  }

  // Watch the durable task even while SSE is healthy. Completion must not depend on one connection.
  useEffect(() => {
    if(!conversationId)return;
    const chatId=conversationId,controller=new AbortController();let disposed=false;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const schedule=()=>{if(!disposed)timer=setTimeout(()=>void poll(),1500);};
    const get=async(path:string)=>{
      const response=await fetch(path,{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
      if(!response.ok)throw new Error("Task status unavailable");return response.json();
    };
    type Job={id:string;conversationId?:string;status:string;stage:string;error?:string|null;sourcePrompt?:string|null;result?:{previewText?:string;text?:string;messageId?:string;model?:string;attachments?:ChatAttachment[];usage?:Partial<import("@/lib/task-usage").TaskUsage>}|null};
    async function poll(){
      try{
        let job:Job|undefined;
        if(activeJobRef.current)job=((await get(`/api/chat/jobs/${activeJobRef.current}`)) as {job?:Job}).job;
        if(job?.conversationId&&job.conversationId!==chatId){job=undefined;activeJobRef.current=null;streamMessageRef.current=null;}
        if(!job){
          const list=(await get(`/api/chat/jobs?conversationId=${chatId}`)) as {jobs:Job[]};
          job=list.jobs.find(j=>j.status==="running");
          if(!job&&requestAbortRef.current){schedule();return;} // POST may still be saving the task.
          job??=list.jobs[0];
        }
        if(disposed||conversationRef.current!==chatId)return;
        if(!job){setTaskFailure(null);setRetryableTask(null);return;}
        if(job.status==="running"){
          activeJobRef.current=job.id;setSending(true);setTaskStage(job.stage);
          const text=job.result?.previewText;
          if(text){const id=streamMessageRef.current??`stream-${job.id}`;streamMessageRef.current=id;
            setMessages(items=>{const old=items.find(m=>m.id===id);if(old&&old.content.length>text.length)return items;
              return upsertReply(items,{...old,id,role:"assistant",model:old?.model??"OpenAI",content:text,tokens:0,createdAt:old?.createdAt??new Date().toISOString()} as Msg,id);});}
          schedule();return;
        }
        if(job.status==="completed"&&deliveredJobRef.current===job.id)return;
        const result=job.result;
        if(job.status==="completed"&&result?.messageId){
          deliveredJobRef.current=job.id;
          const id=streamMessageRef.current??`stream-${job.id}`;
          setMessages(items=>upsertReply(items,{id:result.messageId,role:"assistant",model:shortModelLabel(result.model),content:result.text??"",attachments:result.attachments??[],tokens:result.usage?.total_tokens??0,taskUsage:result.usage,createdAt:new Date().toISOString()} as Msg,id));
          setTaskFailure(null);setRetryableTask(null);
        }else if(["failed","cancelled"].includes(job.status)){
          setTaskFailure({conversationId:chatId,message:taskFailureText(job.error||t("Task stopped.","Tác vụ đã dừng."),locale==="vi")});
          if(job.sourcePrompt)setRetryableTask({prompt:job.sourcePrompt,conversationId:chatId});
        }
        activeJobRef.current=null;requestAbortRef.current?.abort();requestAbortRef.current=null;
        setSending(false);setTaskStage("");
        await loadConversation(chatId,false);void loadData();
      }catch{schedule();}
    }
    void poll();
    return ()=>{disposed=true;controller.abort();if(timer)clearTimeout(timer);};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[conversationId,sending]);

  async function send(text = prompt, options: { displayUser?: boolean; regenerate?: boolean; conversationIdOverride?: string; ignoreAttachment?: boolean } = {}) {
    const clean = text.trim() || (attachedFiles.length && !options.ignoreAttachment
      ? t("Analyze the attached files.", "Phân tích các tệp đính kèm.")
      : "");
    if (!clean || sending) return;
    const invalidUpload=uploadError(options.ignoreAttachment?[]:attachedFiles,account?.system.uploadLimits??defaultUploadLimits,locale==="vi");
    if(invalidUpload){setDataError(invalidUpload);return;}
    setTaskStage("");setTaskElapsed(0);streamMessageRef.current=null;
    setRetryableTask(null);setTaskFailure(null);
    const displayUser = options.displayUser !== false;
    const pendingAttachments = options.ignoreAttachment ? [] : attachedFiles.map((file) => ({
      name: file.name,
      type: file.type,
      size: file.size,
      kind: "input" as const,
    }));
    if (displayUser) {
      setMessages((current) => [
        ...current,
        {
          role: "user",
          content: clean,
          attachments: pendingAttachments,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
    setPrompt("");
    setSending(true);
    const abortController = new AbortController();
    requestAbortRef.current = abortController;
    let streamedMessageId: string | null = null;
    let retryConversationId=options.conversationIdOverride??conversationId;
    liveConversationRef.current=retryConversationId;
    try {
      const form = new FormData();
      form.set("prompt", clean);
      const targetConversationId = options.conversationIdOverride ?? conversationId;
      if (targetConversationId) form.set("conversationId", targetConversationId);
      if (!options.ignoreAttachment) attachedFiles.forEach((file) => form.append("files", file));
      if (options.regenerate) form.set("regenerate", "true");
      const response = await fetch("/api/chat", {
        method: "POST",
        body: form,
        signal: abortController.signal,
        headers: { Accept: "application/x-ndjson, application/json" },
      });
      const responseType = response.headers.get("content-type") ?? "";
      const noticeHeader=response.headers.get("X-Itis-Memory-Notice");
      if(noticeHeader){
        const notice=decodeURIComponent(noticeHeader);
        setMessages(current=>{const last=current.findLastIndex(item=>item.role==="user");return current.map((item,index)=>index===last?{...item,memoryNotice:notice}:item);});
      }
      if (response.ok && responseType.includes("application/x-ndjson") && response.body) {
        const temporaryId = `stream-${crypto.randomUUID()}`;
        streamedMessageId = temporaryId;streamMessageRef.current=temporaryId;
        setMessages((current) => [...current, {
          id: temporaryId,
          role: "assistant",
          model: account?.user.aiProvider === "local" ? "Local" : "OpenAI",
          tokens: 0,
          content: "",
          createdAt: new Date().toISOString(),
        }]);
        type ChatEvent = {
              type: "meta" | "delta" | "done" | "error" | "progress" | "snapshot" | "heartbeat";
              jobId?: string;
              stage?: string;
              attachments?: ChatAttachment[];
              delta?: string;
              text?: string;
              error?: string;
              model?: string;
              conversationId?: string;
              usage?: Partial<import("@/lib/task-usage").TaskUsage>;
              messageId?:string;
        };

        for await (const event of readChatEvents<ChatEvent>(response.body)) {
            if (event.jobId) activeJobRef.current=event.jobId;
            if (event.type === "meta" && event.model) setMessages(current=>current.map(item=>item.id===temporaryId?{...item,model:shortModelLabel(event.model)}:item));
            if (event.conversationId){retryConversationId=event.conversationId;liveConversationRef.current=event.conversationId;}
            if(event.type==="snapshot")setMessages(items=>upsertReply(items,{id:temporaryId,role:"assistant",content:event.text??"",model:shortModelLabel(event.model),tokens:0,createdAt:new Date().toISOString()} as Msg,temporaryId));
            if (event.type === "progress" && event.stage) setTaskStage(event.stage);
            if (event.type === "meta" && event.conversationId && event.conversationId !== conversationId) {
              setConversationId(event.conversationId);
              window.history.replaceState(window.history.state, "", `/chat/${event.conversationId}`);
            }
            if (event.type === "delta" && event.delta) {
              setMessages((current) => current.map((item) => item.id === temporaryId
                ? { ...item, content: item.content + event.delta }
                : item));
            }
            if (event.type === "done") {
              if(event.jobId)deliveredJobRef.current=event.jobId;
              setMessages(items=>upsertReply(items,{id:event.messageId??temporaryId,role:"assistant",content:event.text??items.find(m=>m.id===temporaryId)?.content??"",model:shortModelLabel(event.model),tokens:event.usage?.total_tokens??0,taskUsage:event.usage,attachments:event.attachments??[],createdAt:new Date().toISOString()} as Msg,temporaryId));
              if (event.conversationId && event.conversationId !== conversationId) {
                router.replace(`/chat/${event.conversationId}`);
              }
            }
            if (event.type === "error") throw new Error(event.error || t("The AI service is unavailable.", "Dịch vụ AI không khả dụng."));
        }
        setAttachedFiles([]);
        return;
      }
      const data = (await response.json()) as {
        text?: string;
        error?: string;
        code?: string;
        conversationId?: string;
        usage?: Partial<import("@/lib/task-usage").TaskUsage>;
              messageId?:string;
        model?: string;
        provider?: "openai" | "local";
        attachments?: ChatAttachment[];
      };
      if (!response.ok) {
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            model: account?.user.aiProvider === "local" ? "Local" : "OpenAI",
            content: data.error || t("Unable to send your request.", "Không thể gửi yêu cầu."),
            tokens: 0,
            createdAt: new Date().toISOString(),
          },
        ]);
        return;
      }
      if (data.conversationId && data.conversationId !== conversationId) {
        setConversationId(data.conversationId);
        router.replace(`/chat/${data.conversationId}`);
      }
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          model: shortModelLabel(data.model),
          id:data.messageId,
          taskUsage:data.usage,
          tokens: data.usage?.total_tokens ?? 0,
          content: data.text ?? t("iTis did not receive a response.", "iTis chưa nhận được nội dung trả lời."),
          attachments: data.attachments ?? [],
          createdAt: new Date().toISOString(),
        },
      ]);
      setAttachedFiles([]);
    } catch (error) {
      if(activeJobRef.current && retryConversationId)setRetryableTask({prompt:clean,conversationId:retryConversationId});
      if (error instanceof DOMException && error.name === "AbortError") {
        if (streamedMessageId) {
          setMessages((current) => current.filter((item) => item.id !== streamedMessageId || Boolean(item.content)));
        }
        return;
      }
      if(retryConversationId)setTaskFailure({conversationId:retryConversationId,message:taskFailureText(error instanceof Error?error.message:t("Request failed.","Gửi yêu cầu thất bại."),locale==="vi")});
      if(streamedMessageId)setMessages(current=>current.filter(item=>item.id!==streamedMessageId||Boolean(item.content)));
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          model: selectedModel,
          tokens: 0,
          content: error instanceof Error ? error.message : t("The connection is busy. Your message has been preserved.", "Kết nối đang bận. Nội dung của bạn vẫn được giữ lại."),
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      if(requestAbortRef.current===abortController){
        requestAbortRef.current=null;liveConversationRef.current=null;activeJobRef.current=null;
        setTaskStage("");setSending(false);
      }
      await loadData();
    }
  }

  async function branchFromMessage(messageId: string, messageIndex: number, content: string) {
    if (!conversationId || sending || !content.trim()) return;
    try {
      const response = await fetch(`/api/conversations/${conversationId}/branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const data = await response.json() as { conversation?: Conversation; error?: string };
      if (!response.ok || !data.conversation) throw new Error(data.error || t("Unable to create a branch.", "Không thể tạo nhánh hội thoại."));
      const branchId = data.conversation.id;
      setConversationId(branchId);
      setMessages((current) => current.slice(0, messageIndex));
      setAttachedFiles([]);
      window.history.pushState(window.history.state, "", `/chat/${branchId}`);
      await send(content.trim(), { conversationIdOverride: branchId, ignoreAttachment: true });
      router.replace(`/chat/${branchId}`);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : t("Unable to create a branch.", "Không thể tạo nhánh hội thoại."));
    }
  }

  return (
    <LocaleContext.Provider value={account?.user.locale ?? user.locale ?? "en"}>
    <SidebarProvider
      defaultOpen={initialSidebarOpen}
      className="itis-workspace-shell"
      style={
        {
          "--sidebar-width": "17rem",
          "--sidebar-width-icon": "4rem",
        } as React.CSSProperties
      }
    >
      <AutoExpandSidebar>
        <SidebarHeader className="relative px-3 pb-3 pt-5">
          <SidebarTrigger
            className="itis-sidebar-label absolute right-3 top-5 z-10 hidden size-8 rounded-lg border border-white/10 bg-white/[.035] hover:bg-white/[.08] md:inline-flex"
            title={t("Collapse sidebar", "Thu gọn thanh bên")}
          />
          <div className="flex items-center gap-3">
            <BrandLogo src={systemLogoUrl} size={40} className="shrink-0" />
            <div className="itis-sidebar-label whitespace-nowrap">
              <div className="text-[17px] font-semibold tracking-tight">
                iTis
              </div>
              <div className="text-xs text-muted-foreground">
                Intelligence workspace
              </div>
            </div>
          </div>
          <button
            onClick={startNewChat}
            title={t("New chat", "Chat mới")}
            className="mt-5 flex h-10 w-full items-center gap-2 overflow-hidden rounded-xl bg-primary px-3 font-semibold text-primary-foreground hover:bg-[#c7ff8e]"
          >
            <Plus className="size-4 shrink-0" />
            <span className="itis-sidebar-label whitespace-nowrap">
              {t("New chat", "Chat mới")}
            </span>
          </button>
        </SidebarHeader>
        <SidebarContent className="no-scrollbar px-3">
          <div className="itis-sidebar-reveal itis-sidebar-label">
            <div className="min-h-0 overflow-hidden">
              <label className="mb-3 flex items-center gap-2 rounded-xl border border-white/8 bg-white/[.025] px-3 py-2.5 text-sm text-muted-foreground">
                <Search className="size-4" />
                <input
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                  placeholder={t("Search history", "Tìm lịch sử")}
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                />
              </label>
            </div>
          </div>
          <SidebarMenu>
            <NavItem
              active={view === "chat"}
              onClick={() => navigate("chat")}
              icon={MessageSquareText}
              label={t("Chat", "Trò chuyện")}
            />
            {(account?.user.imageProvider ?? user.imageProvider) !==
              "disabled" && (
              <NavItem
                active={view === "images"}
                onClick={() => navigate("images")}
                icon={ImageIcon}
                label={t("Image Studio", "Studio ảnh")}
              />
            )}
            {account?.user.role === "admin" && (
              <NavItem
                active={view === "admin"}
                onClick={() => navigate("admin")}
                icon={LayoutDashboard}
                label="Admin Console"
              />
            )}
          </SidebarMenu>
          <div className="itis-sidebar-label mb-2 mt-7 px-2 text-[11px] font-semibold uppercase tracking-[.16em] text-muted-foreground">
            {t("Recent", "Gần đây")}
          </div>
          <div className="itis-sidebar-label space-y-1">
            {filteredConversations.map((chat) => (
              <div
                key={chat.id}
                className={`group flex w-full items-center rounded-xl pr-1 hover:bg-white/[.045] ${conversationId === chat.id ? "bg-white/[.055]" : ""}`}
              >
                <button
                  onClick={() => void loadConversation(chat.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2.5 text-left"
                >
                  <MessageSquareText className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-[#cdd7d4]">
                      {chat.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatRelative(chat.updatedAt, locale)}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => void deleteConversation(chat.id)}
                  disabled={deletingConversationId === chat.id}
                  aria-label={t(`Delete ${chat.title}`, `Xóa ${chat.title}`)}
                  title={t("Delete conversation", "Xóa cuộc trò chuyện")}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground opacity-0 hover:bg-red-400/10 hover:text-red-300 focus:opacity-100 disabled:opacity-40 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            {!filteredConversations.length && (
              <div className="px-2 py-4 text-xs leading-5 text-muted-foreground">
                {historyQuery
                  ? t("No conversations found.", "Không tìm thấy cuộc trò chuyện.")
                  : t("No history yet. Your first message will create a new chat.", "Chưa có lịch sử. Tin nhắn đầu tiên sẽ tạo một phiên chat mới.")}
              </div>
            )}
          </div>
        </SidebarContent>
        <SidebarFooter className="p-3">
          <div className="rounded-2xl border border-white/8 bg-white/[.025] group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent">
            <div className="itis-sidebar-reveal itis-sidebar-label">
              <div className="min-h-0 overflow-hidden">
                <div className="px-3 pb-2 pt-3">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {t("Cycle", "Chu kỳ")} {account?.user.resetWindowHours ?? 5} {t("hours", "giờ")}
                    </span>
                    <span className="font-mono text-primary">
                      {account?.usage.unlimited
                        ? "∞"
                        : (account?.usage.remaining ?? 0).toLocaleString("vi-VN")}
                    </span>
                  </div>
                  <Progress
                    value={
                      account?.usage.unlimited
                        ? 0
                        : Math.min(
                            100,
                            ((account?.usage.used ?? 0) /
                              Math.max(1, account?.usage.limit ?? 1)) *
                              100,
                          )
                    }
                    className="h-1.5 bg-white/8 [&>div]:bg-primary"
                  />
                  {conversationId && (
                    <div className="mt-3">
                      <div className="mb-1.5 flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">{t("Chat context", "Context chat")}</span>
                        <span
                          className={`font-mono ${contextPercent >= 90 ? "text-amber-300" : "text-foreground"}`}
                        >
                          {(activeConversation?.contextTokens ?? 0).toLocaleString(
                            "vi-VN",
                          )}{" "}
                          / {contextLimit.toLocaleString("vi-VN")}
                        </span>
                      </div>
                      <Progress
                        value={contextPercent}
                        className={`h-1.5 bg-white/8 ${contextPercent >= 90 ? "[&>div]:bg-amber-400" : "[&>div]:bg-[#7aa2ff]"}`}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={() => navigate("account")}
              className="flex w-full items-center gap-2 overflow-hidden rounded-xl px-[3px] py-1 text-left hover:bg-white/[.045]"
              title={t("My account", "Tài khoản của tôi")}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="size-8 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#b8ff6b] to-[#4dd7c3] text-xs font-bold text-[#091005]">
                  {initials(displayName)}
                </div>
              )}
              <div className="itis-sidebar-label min-w-0 flex-1 whitespace-nowrap">
                <div className="truncate text-sm font-medium">
                  {displayName}
                </div>
                <div className="text-xs capitalize text-muted-foreground">
                  {account?.user.role ?? user.role} ·{" "}
                  {account
                    ? account.usage.unlimited
                      ? "Unlimited"
                      : t("Quota enabled", "Có quota")
                    : t("Loading", "Đang tải")}
                </div>
              </div>
              <Settings2 className="itis-sidebar-label mr-2 size-4 shrink-0 text-muted-foreground" />
            </button>
          </div>
        </SidebarFooter>
      </AutoExpandSidebar>

      <SidebarInset className="h-svh min-h-0 overflow-hidden bg-background">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center border-b border-white/8 bg-background/95 px-4 backdrop-blur md:px-6">
          <SidebarTrigger className="mr-3 md:hidden" title={t("Open sidebar", "Mở thanh bên")} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold">
                {view === "chat"
                  ? activeConversation?.title || t("New chat", "Chat mới")
                  : view === "images"
                    ? t("Image Studio", "Studio ảnh")
                    : view === "account"
                      ? t("My account", "Tài khoản của tôi")
                      : view === "usage"
                        ? t("Token usage", "Mức sử dụng token")
                        : "Admin Console"}
              </h1>
              <span className="rounded-full border border-[#b8ff6b]/20 bg-[#b8ff6b]/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                {account?.user.role ?? "…"}
              </span>
            </div>
            <p className="hidden text-xs text-muted-foreground sm:block">
              {view === "chat"
                ? t("Each chat has its own URL and history", "Mỗi phiên có URL và lịch sử riêng")
                : view === "images"
                  ? t("Create, edit, and save images privately for this account", "Tạo, chỉnh sửa và lưu ảnh riêng theo tài khoản")
                  : view === "account"
                    ? t("Profile and token usage", "Hồ sơ và mức sử dụng token")
                    : view === "usage"
                      ? t("Real usage data for this account", "Dữ liệu usage thật của tài khoản")
                      : t("Configuration is stored in PostgreSQL", "Cấu hình được lưu trong PostgreSQL")}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[.025] px-3 py-2 text-xs">
            <span
              className={`size-2 rounded-full ${activeProviderReady === null ? "animate-pulse bg-amber-300" : activeProviderReady ? "bg-primary" : "bg-red-400"}`}
            />
            <span className="hidden text-muted-foreground sm:inline">
              {activeProviderLabel}
            </span>
            <span
              className={
                activeProviderReady === null
                  ? "font-medium text-amber-200"
                  : activeProviderReady
                    ? "font-medium text-primary"
                    : "font-medium text-red-300"
              }
            >
              {activeProviderReady === null
                ? t("Loading", "Đang tải")
                : activeProviderReady
                  ? t("Connected", "Đã kết nối")
                  : t("Not ready", "Chưa sẵn sàng")}
            </span>
          </div>
          <button
            onClick={() => void logout()}
            disabled={loggingOut}
            title={t("Sign out", "Đăng xuất")}
            aria-label={t("Sign out", "Đăng xuất")}
            className="ml-2 flex h-10 shrink-0 items-center gap-2 rounded-xl border border-red-300/15 bg-red-400/[.035] px-3 text-xs font-medium text-red-200 hover:border-red-300/25 hover:bg-red-400/10 disabled:opacity-50"
          >
            <LogOut className="size-4" />
            <span className="hidden lg:inline">
              {loggingOut ? t("Signing out…", "Đang thoát…") : t("Sign out", "Đăng xuất")}
            </span>
          </button>
        </header>

        {dataError && (
          <div className="mx-4 mt-3 rounded-xl border border-red-400/20 bg-red-400/8 px-4 py-3 text-sm text-red-300">
            {dataError}{" "}
            <button onClick={() => void loadData()} className="ml-2 underline">
              {t("Try again", "Thử lại")}
            </button>
          </div>
        )}
        {view === "chat" && (
          <ChatView
            uploadLimits={account?.system.uploadLimits??defaultUploadLimits}
            firstName={firstName}
            messages={messages}
            prompt={prompt}
            setPrompt={setPrompt}
            send={send}
            sending={sending || loadingConversation}
            taskStage={taskStage+(sending&&taskElapsed>2?` · ${taskElapsed}s`:"")}
            taskFailure={taskFailure?.conversationId===conversationId?taskFailure.message:undefined}
            retryTask={retryableTask && retryableTask.conversationId===conversationId ? ()=>void send(retryableTask.prompt,{displayUser:false,regenerate:true,conversationIdOverride:retryableTask.conversationId,ignoreAttachment:true}) : undefined}
            stopGenerating={stopGenerating}
            exportAnswer={exportAnswer}
            branchFromMessage={branchFromMessage}
            truncateMessages={(index) => setMessages((current) => current.slice(0, index))}
            selectedModel={selectedModel}
            attachedFiles={attachedFiles}
            setAttachedFiles={setAttachedFiles}
            fileRef={fileRef}
            chatLogoUrl={chatLogoUrl}
          />
        )}
        {view === "images" && (
          <ImageStudio
            account={account}
            images={generatedImages}
            reload={loadData}
          />
        )}
        {view === "account" && (
          <AccountView
            key={account?.user.id ?? "loading-account"}
            account={account}
            reload={loadData}
            historyCount={conversations.length}
            clearHistory={clearConversationHistory}
          />
        )}
        {view === "usage" && <UsageView account={account} />}
        {view === "admin" && account?.user.role === "admin" && (
          <AdminView
            members={members}
            settings={settings}
            account={account}
            reload={loadData}
            setSettings={setSettings}
          />
        )}
      </SidebarInset>
    </SidebarProvider>
    </LocaleContext.Provider>
  );
}

function NavItem({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Activity;
  label: string;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        onClick={onClick}
        tooltip={label}
        className="itis-sidebar-nav h-10 rounded-xl px-3 group-data-[collapsible=icon]:h-10! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:p-3!"
      >
        <Icon />
        <span className="itis-sidebar-label">{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AutoExpandSidebar({ children }: { children: React.ReactNode }) {
  const { state, setOpen, isMobile } = useSidebar();
  return (
    <Sidebar
      collapsible="icon"
      className={`itis-sidebar border-r border-white/8 ${state === "collapsed" ? "cursor-e-resize" : ""}`}
      onClickCapture={(event) => {
        if (state !== "collapsed" || isMobile) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
      }}
    >
      {children}
    </Sidebar>
  );
}

function ChatView({
  uploadLimits,
  firstName,
  messages,
  prompt,
  setPrompt,
  send,
  sending,
  taskStage,
  retryTask,
  taskFailure,
  stopGenerating,
  branchFromMessage,
  exportAnswer,
  truncateMessages,
  selectedModel,
  attachedFiles,
  setAttachedFiles,
  fileRef,
  chatLogoUrl,
}: {
  uploadLimits:UploadLimits;
  firstName: string;
  messages: Msg[];
  prompt: string;
  setPrompt: (value: string) => void;
  send: (value?: string, options?: { displayUser?: boolean; regenerate?: boolean; conversationIdOverride?: string; ignoreAttachment?: boolean }) => void;
  sending: boolean;
  taskStage: string;
  taskFailure?: string;
  retryTask?: () => void;
  stopGenerating: () => void;
  exportAnswer: (messageId:string)=>Promise<void>;
  branchFromMessage: (messageId: string, messageIndex: number, content: string) => Promise<void>;
  truncateMessages: (index: number) => void;
  selectedModel: string;
  attachedFiles: File[];
  setAttachedFiles: (value: File[] | ((current: File[]) => File[])) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  chatLogoUrl: string | null;
}) {
  const { t, numberLocale, locale } = useLanguage();
  const [exportingAnswer,setExportingAnswer]=useState<string|null>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [voiceStarting, setVoiceStarting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; index: number; value: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepthRef = useRef(0);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const voiceBasePromptRef = useRef("");
  function attachFiles(files: File[]) {
    setAttachmentError("");
    if (!files.length) return;
    setAttachedFiles((current) => {
      const unique = [...current];
      for (const file of files) {
        if (!unique.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) unique.push(file);
      }
      const invalid=uploadError(unique,uploadLimits,locale==="vi");
      if(invalid){setAttachmentError(invalid);return current;}
      return unique;
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  function clipboardFile(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) {
      const pasted = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      files.push(...pasted);
    }
    if (!files.length) return;
    event.preventDefault();
    attachFiles(files);
  }

  function voiceErrorMessage(error: string) {
    if (error === "not-allowed" || error === "service-not-allowed")
      return t("Microphone access was denied. Allow microphone access in your browser settings.", "Quyền microphone đã bị từ chối. Hãy cho phép microphone trong cài đặt trình duyệt.");
    if (error === "no-speech")
      return t("No speech was detected. Tap the microphone and try again.", "Không nhận được giọng nói. Hãy bấm micro và thử lại.");
    if (error === "audio-capture")
      return t("No working microphone was found.", "Không tìm thấy microphone đang hoạt động.");
    if (error === "network")
      return t("Voice recognition could not reach the browser speech service.", "Nhận dạng giọng nói không kết nối được dịch vụ của trình duyệt.");
    return t("Voice recognition stopped unexpectedly.", "Nhận dạng giọng nói đã dừng ngoài ý muốn.");
  }

  async function toggleVoiceInput() {
    if (voiceStarting) return;
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    setVoiceError("");
    const speechWindow = window as SpeechRecognitionWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceError(t("Voice typing is not supported in this browser. Use the latest Chrome or Edge.", "Trình duyệt này không hỗ trợ nhập giọng nói. Hãy dùng Chrome hoặc Edge bản mới."));
      return;
    }
    if (!window.isSecureContext) {
      setVoiceError(t("Microphone access requires HTTPS or localhost.", "Microphone chỉ hoạt động qua HTTPS hoặc localhost."));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError(t("This browser cannot access the microphone.", "Trình duyệt này không thể truy cập microphone."));
      return;
    }
    setVoiceStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang = locale === "vi" ? "vi-VN" : "en-US";
      voiceBasePromptRef.current = prompt.trimEnd();
      recognition.onstart = () => {
        setVoiceStarting(false);
        setIsListening(true);
      };
      recognition.onresult = (event) => {
        let transcript = "";
        for (let index = 0; index < event.results.length; index += 1)
          transcript += event.results[index][0]?.transcript ?? "";
        const base = voiceBasePromptRef.current;
        setPrompt(`${base}${base && transcript.trim() ? " " : ""}${transcript}`);
      };
      recognition.onerror = (event) => {
        if (event.error !== "aborted") setVoiceError(voiceErrorMessage(event.error));
        setVoiceStarting(false);
        setIsListening(false);
      };
      recognition.onend = () => {
        setVoiceStarting(false);
        setIsListening(false);
        recognitionRef.current = null;
      };
      recognitionRef.current = recognition;
      recognition.start();
    } catch (error) {
      const permissionDenied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      setVoiceError(permissionDenied
        ? t("Microphone access was denied. Allow it from the browser address bar and try again.", "Quyền microphone đã bị từ chối. Hãy cho phép ở thanh địa chỉ trình duyệt rồi thử lại.")
        : t("Unable to start the microphone.", "Không thể khởi động microphone."));
      setVoiceStarting(false);
      setIsListening(false);
    }
  }

  useEffect(() => () => recognitionRef.current?.abort(), []);
  async function copyMessage(content: string, key: string) {
    await navigator.clipboard.writeText(content);
    setCopiedMessageKey(key);
    window.setTimeout(() => setCopiedMessageKey((current) => current === key ? null : current), 1400);
  }

  function regenerateAnswer(index: number) {
    const previousUser = [...messages.slice(0, index)].reverse().find((item) => item.role === "user");
    if (!previousUser || sending) return;
    truncateMessages(index);
    send(previousUser.content, { displayUser: false, regenerate: true });
  }
  const composerIsExpanded = composerExpanded && Boolean(prompt);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const maxHeight = 320;
    const minHeight = composerIsExpanded ? 112 : 56;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight))}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [prompt, composerIsExpanded]);
  const suggestions = [
    {
      icon: FileSpreadsheet,
      title: t("Analyze data", "Phân tích dữ liệu"),
      sub: t("Find insights in Excel", "Tìm insight trong Excel"),
    },
    { icon: Sparkles, title: t("Create content", "Soạn nội dung"), sub: t("Emails, reports, slides", "Email, báo cáo, slide") },
    {
      icon: BrainCircuit,
      title: t("Solve a problem", "Giải quyết vấn đề"),
      sub: t("Multi-step reasoning", "Lập luận nhiều bước"),
    },
  ];
  return (
    <main className="itis-grid flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-4 md:px-8">
        <div className="no-scrollbar flex-1 overflow-y-auto py-7 md:py-10">
          {!messages.length && (
            <section className="mx-auto mb-9 max-w-2xl text-center">
              <div className="mx-auto mb-5 grid size-14 place-items-center rounded-[20px] border border-[#b8ff6b]/20 bg-[#b8ff6b]/8">
                <Sparkles className="size-6 text-primary" />
              </div>
              <h2 className="text-3xl font-semibold tracking-[-.04em] md:text-[40px]">
                {t(`Hello ${firstName}, what are we working on?`, `Chào ${firstName}, hôm nay mình làm gì?`)}
              </h2>
              <p className="mx-auto mt-3 max-w-lg text-[15px] leading-6 text-muted-foreground">
                {t("Each chat has its own URL and history. iTis only uses context from the conversation you have open.", "Mỗi chat có lịch sử và URL riêng. iTis chỉ dùng context của đúng phiên đang mở.")}
              </p>
              <div className="mt-7 grid gap-3 text-left sm:grid-cols-3">
                {suggestions.map((item) => (
                  <button
                    onClick={() => setPrompt(item.title + ": ")}
                    key={item.title}
                    className="rounded-2xl border border-white/8 bg-[#0c1214]/80 p-4 hover:border-[#b8ff6b]/25 hover:bg-[#111a18]"
                  >
                    <item.icon className="mb-5 size-5 text-primary" />
                    <div className="text-sm font-medium">{item.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.sub}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
          <div className="mx-auto max-w-3xl space-y-7">
            {messages.map((message, index) =>
              message.role === "user" ? (
                <div key={message.id ?? index} className="group ml-auto min-w-0 max-w-[82%]">
                  {editingMessage?.index === index ? (
                    <div className="rounded-2xl border border-primary/25 bg-[#101918] p-2 shadow-[0_0_24px_rgba(184,255,107,.06)]">
                      <textarea
                        autoFocus
                        value={editingMessage.value}
                        onChange={(event) => setEditingMessage({ ...editingMessage, value: event.target.value })}
                        className="min-h-24 w-full resize-y bg-transparent px-2 py-1 text-[15px] leading-6 outline-none"
                      />
                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setEditingMessage(null)}
                          className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-white/5"
                        >
                          {t("Cancel", "Hủy")}
                        </button>
                        <button
                          type="button"
                          disabled={!editingMessage.value.trim() || sending}
                          onClick={() => {
                            const edit = editingMessage;
                            setEditingMessage(null);
                            void branchFromMessage(edit.id, edit.index, edit.value);
                          }}
                          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                        >
                          <GitBranch className="size-3.5" />
                          {t("Create branch", "Tạo nhánh")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl rounded-br-md bg-[#1b2728] px-4 py-3 text-[15px] leading-6 text-[#e8efed]">
                      <div className="whitespace-pre-wrap break-words">{message.content}</div>
                      <MessageAttachments attachments={message.attachments} compact />
                      {message.memoryNotice && <details className="mt-2 border-t border-white/10 pt-2 text-xs text-muted-foreground"><summary className="cursor-pointer text-primary">{t("Memory status", "Trạng thái ghi nhớ")}</summary><p className="mt-1 leading-5">{message.memoryNotice}</p></details>}
                    </div>
                  )}
                  {message.createdAt && (
                    <time
                      dateTime={message.createdAt}
                      title={formatMessageDateTime(message.createdAt, locale)}
                      className="mt-1.5 block pr-1 text-right text-[10px] text-muted-foreground"
                    >
                      {formatMessageTime(message.createdAt, locale)}
                    </time>
                  )}
                  <div className="mt-1 flex justify-end gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => void copyMessage(message.content, message.id ?? `user-${index}`)}
                      title={t("Copy", "Sao chép")}
                      aria-label={t("Copy message", "Sao chép tin nhắn")}
                      className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
                    >
                      {copiedMessageKey === (message.id ?? `user-${index}`) ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
                    </button>
                    {message.id && <button
                      type="button"
                      onClick={() => {
                        setEditingMessage({ id: message.id!, index, value: message.content });
                      }}
                      title={t("Edit and create a branch", "Chỉnh sửa và tạo nhánh")}
                      aria-label={t("Edit message", "Chỉnh sửa tin nhắn")}
                      className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>}
                  </div>
                </div>
              ) : (
                <div key={message.id ?? index} className="group flex gap-3">
                  <BrandLogo src={chatLogoUrl} size={30} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-[#d7e1de]">iTis</span>
                      {message.model && (
                        <>
                          <span>·</span>
                          <span>{message.model}</span>
                        </>
                      )}
                      {message.tokens !== undefined && !(sending && message.id?.startsWith("stream-") && message.tokens === 0) && (
                        message.taskUsage ? <Popover>
                          <PopoverTrigger asChild><button type="button" className="cursor-pointer select-none hover:text-foreground" aria-label={t("Token and cost details","Chi tiết token và chi phí")}>{message.taskUsage.usage_complete===false?"≈ ":""}{message.tokens.toLocaleString(numberLocale)} {t("total tokens", "token tổng")}</button></PopoverTrigger>
                          <PopoverContent align="start" collisionPadding={12} className="max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl p-3 text-xs">
                            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
                              <dt>{t("Input", "Đầu vào")}</dt><dd>{(message.taskUsage.input_tokens??0).toLocaleString(numberLocale)}</dd>
                              <dt>{t("Output", "Đầu ra")}</dt><dd>{(message.taskUsage.output_tokens??0).toLocaleString(numberLocale)}</dd>
                              <dt>{t("Reasoning · included in output", "Suy luận · đã nằm trong đầu ra")}</dt><dd>{message.taskUsage.reasoning_tokens?.toLocaleString(numberLocale)??"—"}</dd>
                              <dt>{t("Cached input", "Đầu vào đọc từ cache")}</dt><dd>{(message.taskUsage.cached_tokens??0).toLocaleString(numberLocale)}</dd>
                              <dt>{t("Cache writes", "Ghi cache")}</dt><dd>{message.taskUsage.cache_write_tokens?.toLocaleString(numberLocale)??"—"}</dd>
                              <dt>{t("AI calls", "Lượt gọi AI")}</dt><dd>{message.taskUsage.calls??"—"}</dd>
                              <dt>{t("Estimated tools", "Phí công cụ ước tính")}</dt><dd>${(message.taskUsage.tool_cost_usd??0).toFixed(4)}</dd>
                              <dt>{t("Estimated total cost", "Tổng phí ước tính")}</dt><dd>${(message.taskUsage.estimated_cost_usd??0).toFixed(5)}</dd>
                            </dl>
                            {message.taskUsage.usage_complete===false&&<p className="mt-2 text-amber-400">{t("Provider usage is incomplete; this is not a final billing total.","Chưa nhận đủ usage từ nhà cung cấp; đây chưa phải số liệu thanh toán cuối cùng.")}</p>}
                          </PopoverContent>
                        </Popover> : <span>{message.tokens.toLocaleString(numberLocale)} {t("output tokens · historical", "token đầu ra · lịch sử")}</span>
                      )}
                      {message.createdAt && (
                        <>
                          <span>·</span>
                          <time
                            dateTime={message.createdAt}
                            title={formatMessageDateTime(message.createdAt, locale)}
                          >
                            {formatMessageTime(message.createdAt, locale)}
                          </time>
                        </>
                      )}
                    </div>
                    <MarkdownMessage content={message.content} />
                    <MessageAttachments attachments={message.attachments} />
                    {message.content && (
                      <div className="mt-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                        <button
                          type="button"
                          onClick={() => void copyMessage(message.content, message.id ?? `assistant-${index}`)}
                          title={t("Copy", "Sao chép")}
                          aria-label={t("Copy answer", "Sao chép câu trả lời")}
                          className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
                        >
                          {copiedMessageKey === (message.id ?? `assistant-${index}`) ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
                        </button>
                        {message.id&&!message.attachments?.length&&!message.id.startsWith("stream-")&&!isBlockedArtifactSource(message.content)&&<button type="button" disabled={sending||Boolean(exportingAnswer)} onClick={async()=>{
                          setExportingAnswer(message.id!);setAttachmentError("");
                          try{await exportAnswer(message.id!);}catch(error){setAttachmentError(error instanceof Error?error.message:t("Export failed.","Xuất file thất bại."));}finally{setExportingAnswer(null);}
                        }} title={t("Export this exact answer as Word · no AI tokens","Xuất đúng câu trả lời này ra Word · không dùng token AI")} aria-label={t("Export Word","Xuất Word")} className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground disabled:opacity-40">{exportingAnswer===message.id?<LoaderCircle className="size-4 animate-spin"/>:<Download className="size-4"/>}Word</button>}
                        {index === messages.length - 1 && !sending && message.model!=="iTis Files" && (
                          <button
                            type="button"
                            onClick={() => regenerateAnswer(index)}
                            title={t("Regenerate answer", "Tạo lại câu trả lời")}
                            aria-label={t("Regenerate answer", "Tạo lại câu trả lời")}
                            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
                          >
                            <RotateCcw className="size-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
            {sending && (messages.at(-1)?.role !== "assistant" || taskStage) && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <BrandLogo src={chatLogoUrl} size={30} className="shrink-0" />
                <span className="pulse-dot size-2 rounded-full bg-primary" />
                {taskStage || t("iTis is working…", "iTis đang xử lý…")}
              </div>
            )}
            {!sending && taskFailure && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{taskFailure}</p>}
            {!sending && retryTask && <button onClick={retryTask} className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-2 text-sm text-primary hover:bg-primary/10">{t("Retry task · reuse saved files", "Thử lại · dùng tệp đã lưu")}</button>}
          </div>
        </div>
        <div className="shrink-0 bg-background/95 pb-5 pt-2 backdrop-blur">
          <div
            onDragEnter={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              dragDepthRef.current += 1;
              setIsDraggingFile(true);
            }}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
              if (dragDepthRef.current === 0) setIsDraggingFile(false);
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.files.length) return;
              event.preventDefault();
              dragDepthRef.current = 0;
              setIsDraggingFile(false);
              attachFiles(Array.from(event.dataTransfer.files));
            }}
            className={`glass soft-ring relative mx-auto max-w-3xl rounded-[24px] border px-2.5 py-2 transition-colors duration-300 ${isDraggingFile ? "border-primary bg-primary/[.07] shadow-[0_0_28px_rgba(184,255,107,.16)]" : prompt.trim() ? "neon-chat-composer border-transparent" : "border-white/10"}`}
          >
            {isDraggingFile && (
              <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-[24px] border border-dashed border-primary/70 bg-[#09100e]/90 text-sm font-medium text-primary backdrop-blur-sm">
                <span className="flex items-center gap-2">
                  <FileArchive className="size-4" />
                  {t("Drop file here to attach", "Thả tệp vào đây để đính kèm")}
                </span>
              </div>
            )}
            {attachedFiles.length > 0 && (
              <div className="mx-2 mb-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto pr-1">
                {attachedFiles.map((file, index) => (
                  <PendingAttachment
                    key={`${file.name}-${file.size}-${file.lastModified}`}
                    file={file}
                    onRemove={() => setAttachedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                  />
                ))}
              </div>
            )}
            <div className="relative grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.xlsm,.csv,.tsv,.txt,.md,.json,.html,.xml,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.sql"
                className="hidden"
                onChange={(event) => {
                  attachFiles(Array.from(event.target.files ?? []));
                }}
              />
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(event) => {
                  const value = event.target.value;
                  setPrompt(value);
                  setComposerExpanded(
                    value.includes("\n") ||
                      event.currentTarget.scrollHeight > 56,
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                onPaste={clipboardFile}
                rows={1}
                placeholder={t("Message iTis…", "Nhắn iTis…")}
                className={`block max-h-80 min-w-0 w-full resize-none bg-transparent text-[16px] leading-6 outline-none placeholder:text-[#697673] ${composerIsExpanded ? "col-span-3 col-start-1 row-start-1 min-h-28 px-3 py-3" : "col-start-2 row-start-1 min-h-14 py-4"}`}
              />
              <div
                className="contents"
              >
                <div className={`relative col-start-1 shrink-0 ${composerIsExpanded ? "row-start-2" : "row-start-1"}`}>
                  {attachmentMenuOpen && (
                    <div className="absolute bottom-12 left-0 z-20 w-48 rounded-xl border border-white/10 bg-[#111819] p-1.5 shadow-2xl">
                      <button
                        onClick={() => {
                          setAttachmentMenuOpen(false);
                          fileRef.current?.click();
                        }}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-white/[.06]"
                      >
                        <FileArchive className="size-4 text-primary" />
                        <span>
                          <span className="block font-medium">{t("Add file", "Thêm tệp")}</span>
                          <span className="block text-[10px] text-muted-foreground">
                            {t(`Up to ${uploadLimits.maxFiles} files · ${uploadLimits.maxFileMb} MB each · ${uploadLimits.maxTotalMb} MB total`,`Tối đa ${uploadLimits.maxFiles} tệp · ${uploadLimits.maxFileMb} MB/tệp · tổng ${uploadLimits.maxTotalMb} MB`)}
                          </span>
                        </span>
                      </button>
                    </div>
                  )}
                  <button
                    onClick={() => setAttachmentMenuOpen((open) => !open)}
                    aria-label={t("Open attachment menu", "Mở menu đính kèm")}
                    aria-expanded={attachmentMenuOpen}
                    className={`grid size-10 place-items-center rounded-full border transition ${attachmentMenuOpen ? "rotate-45 border-primary/35 bg-primary/10 text-primary" : "border-white/10 text-muted-foreground hover:bg-white/5 hover:text-foreground"}`}
                  >
                    <Plus className="size-5" />
                  </button>
                </div>
                <div className={`flex min-w-0 items-center justify-end gap-0.5 sm:gap-1 ${composerIsExpanded ? "col-span-2 col-start-2 row-start-2" : "col-start-3 row-start-1"}`}>
                <div title={selectedModel} aria-label={selectedModel} className="hidden size-8 shrink-0 place-items-center rounded-full text-muted-foreground lg:grid">
                  <Cpu className="size-3.5 text-primary" />
                </div>
                <button
                  type="button"
                  onClick={() => void toggleVoiceInput()}
                  aria-label={t("Use microphone", "Dùng microphone")}
                  aria-pressed={isListening}
                  title={voiceStarting ? t("Requesting microphone access", "Đang xin quyền microphone") : isListening ? t("Stop voice typing", "Dừng nhập giọng nói") : t("Start voice typing", "Bắt đầu nhập giọng nói")}
                  className={`pointer-events-auto relative grid size-10 shrink-0 place-items-center rounded-full transition ${isListening ? "bg-red-400/15 text-red-300 ring-1 ring-red-300/35" : voiceStarting ? "bg-amber-300/10 text-amber-200 ring-1 ring-amber-200/25" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}`}
                >
                  {isListening ? <MicOff className="size-[18px]" /> : <Mic className={`size-[18px] ${voiceStarting ? "animate-pulse" : ""}`} />}
                  {isListening && <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full bg-red-400 shadow-[0_0_9px_rgba(248,113,113,.9)]" />}
                </button>
                <button
                  onClick={() => sending ? stopGenerating() : send()}
                  disabled={!sending && !prompt.trim() && attachedFiles.length === 0}
                  aria-label={sending ? t("Stop generating", "Dừng trả lời") : t("Send", "Gửi")}
                  title={sending ? t("Stop generating", "Dừng trả lời") : t("Send", "Gửi")}
                  className={`pointer-events-auto grid size-10 shrink-0 place-items-center rounded-full text-primary-foreground disabled:bg-white/8 disabled:text-muted-foreground ${sending ? "bg-red-400 hover:bg-red-300" : "bg-primary"}`}
                >
                  {sending ? <Square className="size-4 fill-current" /> : <ArrowUp className="size-[18px]" />}
                </button>
                </div>
              </div>
            </div>
            {attachmentError && (
              <div className="mx-2 mt-1 text-xs text-red-300" role="alert">
                {attachmentError}
              </div>
            )}
            {voiceError && (
              <div className="mx-2 mt-1 text-xs text-red-300" role="alert">
                {voiceError}
              </div>
            )}
            {isListening && (
              <div className="mx-2 mt-1 flex items-center gap-2 text-xs text-red-200" role="status" aria-live="polite">
                <span className="size-1.5 animate-pulse rounded-full bg-red-400" />
                {t("Listening… speak now. Tap the microphone again to stop.", "Đang nghe… hãy nói. Bấm micro lần nữa để dừng.")}
              </div>
            )}
            {voiceStarting && (
              <div className="mx-2 mt-1 flex items-center gap-2 text-xs text-amber-200" role="status" aria-live="polite">
                <span className="size-1.5 animate-pulse rounded-full bg-amber-300" />
                {t("Waiting for microphone permission…", "Đang chờ cấp quyền microphone…")}
              </div>
            )}
          </div>
          <div className="mx-auto mt-2 flex max-w-3xl items-center justify-center gap-2 text-[11px] text-muted-foreground">
            {t("Built and configured by Nguyễn Việt Dũng", "Được xây dựng và cấu hình bởi Nguyễn Việt Dũng")}
          </div>
        </div>
      </div>
    </main>
  );
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="itis-markdown min-w-0 max-w-none [overflow-wrap:anywhere] text-[15px] leading-7 text-[#d5deda]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 mt-5 text-xl font-semibold text-foreground">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-5 text-lg font-semibold text-foreground">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-4 text-base font-semibold text-foreground">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="my-2">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">
              {children}
            </strong>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full border-collapse text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-white/[.055] text-foreground">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="border-b border-r border-white/8 px-3 py-2 text-left font-semibold last:border-r-0">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-r border-white/6 px-3 py-2 align-top last:border-r-0">
              {children}
            </td>
          ),
          tr: ({ children }) => (
            <tr className="last:[&>td]:border-b-0">{children}</tr>
          ),
          code: ({ children }) => (
            <code className="rounded bg-white/7 px-1.5 py-0.5 font-mono text-[13px] text-primary">
              {children}
            </code>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-4"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-primary/50 pl-4 text-muted-foreground">
              {children}
            </blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function PendingAttachment({ file, onRemove }: { file: File; onRemove: () => void }) {
  const { t } = useLanguage();
  const previewUrl = useMemo(
    () => file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
    [file],
  );
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);
  return (
    <div className="flex max-w-56 items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] p-1.5 pr-2 text-xs">
      {previewUrl ? (
        <img src={previewUrl} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10">
          <FileArchive className="size-4 text-primary" />
        </div>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{file.name}</span>
        <span className="block text-[10px] text-muted-foreground">{formatFileSize(file.size, t)}</span>
      </span>
      <button type="button" onClick={onRemove} aria-label={t(`Remove ${file.name}`, `Bỏ ${file.name}`)} className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function MessageAttachments({
  attachments,
  compact = false,
}: {
  attachments?: ChatAttachment[];
  compact?: boolean;
}) {
  const { t } = useLanguage();
  if (!attachments?.length) return null;
  return (
    <div className={`grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-2 ${compact ? "mt-2" : "mt-3 sm:grid-cols-2"}`}>
      {attachments.map((file, index) => {
        const isImage = file.type?.startsWith("image/") && file.url;
        const canPreview = Boolean(isImage || file.type === "application/pdf");
        const card = (
          <div
            className="min-w-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground"
          >
            {isImage && <img src={file.url} alt={file.name} loading="lazy" className="h-32 w-full bg-black/20 object-cover" />}
            <div className="flex items-center gap-3 px-3 py-2.5">
              {!isImage && <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                <FileArchive className="size-4 text-primary" />
              </div>}
              <div className="min-w-0 flex-1">
                <div title={file.name} className="text-xs font-medium [overflow-wrap:anywhere]">{file.name}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {formatFileSize(file.size, t)} ·{" "}
                  {file.kind === "output" ? t("Created by iTis", "File iTis tạo") : t("Attachment", "File đính kèm")}
                  {file.version && ` · v${file.version}`}
                </div>
              </div>
              {file.url && <Download className="size-4 shrink-0 text-primary" />}
            </div>
          </div>
        );
        return file.url ? (
          <a
            key={`${file.url}-${index}`}
            href={file.url}
            {...(canPreview ? { target: "_blank", rel: "noreferrer" } : { download: file.name })}
            className="block w-full min-w-0 max-w-full overflow-hidden hover:brightness-110"
          >
            {card}
          </a>
        ) : (
          <div key={`${file.name}-${index}`}>{card}</div>
        );
      })}
    </div>
  );
}

function formatFileSize(size: number | undefined, t: (english: string, vietnamese: string) => string) {
  if (!size) return t("Processing", "Đang xử lý");
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function ImageStudio({
  account,
  images,
  reload,
}: {
  account: Account | null;
  images: GeneratedImage[];
  reload: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"fast" | "quality">("quality");
  const [size, setSize] = useState("1024x1024");
  const [quality, setQuality] = useState("high");
  const [background, setBackground] = useState("auto");
  const [reference, setReference] = useState<File | null>(null);
  const referencePreview = useMemo(
    () => reference ? URL.createObjectURL(reference) : "",
    [reference],
  );
  const [generating, setGenerating] = useState(false);
  const [cancelingId, setCancelingId] = useState("");
  const [error, setError] = useState("");
  const [liveImages, setLiveImages] = useState(images);
  const provider = account?.user.imageProvider ?? "disabled";
  const ready =
    provider === "openai"
      ? account?.system.openaiConfigured
      : provider === "comfyui"
        ? account?.system.comfyUiConnected
        : false;
  const processingKey = liveImages
    .filter((image) => image.status === "processing")
    .map((image) => image.id)
    .sort()
    .join(",");

  useEffect(() => {
    const timer = window.setTimeout(() => setLiveImages(images), 0);
    return () => window.clearTimeout(timer);
  }, [images]);

  useEffect(() => {
    if (!processingKey) return;
    let active = true;
    const ids = processingKey.split(",");
    const sources = ids.map((id) => {
      const source = new EventSource(`/api/images/${id}/events`);
      source.onmessage = (event) => {
        if (!active) return;
        const update = JSON.parse(event.data) as Partial<GeneratedImage> & {
          id: string;
        };
        setLiveImages((current) =>
          current.map((image) =>
            image.id === update.id ? { ...image, ...update } : image,
          ),
        );
        if (update.status && update.status !== "processing") source.close();
      };
      return source;
    });
    const fallback = window.setInterval(async () => {
      const response = await fetch("/api/images", { cache: "no-store" });
      if (!response.ok || !active) return;
      const data = (await response.json()) as { images: GeneratedImage[] };
      if (active) setLiveImages(data.images);
    }, 5_000);
    return () => {
      active = false;
      sources.forEach((source) => source.close());
      window.clearInterval(fallback);
    };
  }, [processingKey]);

  useEffect(() => {
    return () => {
      if (referencePreview) URL.revokeObjectURL(referencePreview);
    };
  }, [referencePreview]);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || generating) return;
    setError("");
    setGenerating(true);
    const form = new FormData();
    form.set("prompt", prompt.trim());
    form.set("mode", mode);
    form.set("size", size);
    form.set("quality", quality);
    form.set("background", provider === "comfyui" ? "opaque" : background);
    if (reference) form.set("reference", reference);
    try {
      const response = await fetch("/api/images", {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as {
        error?: string;
        image?: GeneratedImage;
      };
      if (!response.ok) throw new Error(data.error || t("Unable to generate image.", "Không thể tạo ảnh."));
      if (data.image)
        setLiveImages((current) => [
          data.image!,
          ...current.filter((image) => image.id !== data.image!.id),
        ]);
      setPrompt("");
      setReference(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Unable to generate image.", "Không thể tạo ảnh."));
      await reload();
    } finally {
      setGenerating(false);
    }
  }

  async function removeImage(id: string) {
    const response = await fetch(`/api/images/${id}`, { method: "DELETE" });
    if (response.ok) {
      setLiveImages((current) => current.filter((image) => image.id !== id));
      await reload();
    }
  }

  async function cancelImage(id: string) {
    setCancelingId(id);
    const response = await fetch(`/api/images/${id}/cancel`, {
      method: "POST",
    });
    if (response.ok) {
      setLiveImages((current) =>
        current.map((image) =>
          image.id === id
            ? { ...image, status: "canceled", stage: t("Canceled by request", "Đã dừng theo yêu cầu") }
            : image,
        ),
      );
      await reload();
    } else {
      const data = (await response.json()) as { error?: string };
      setError(data.error || t("Unable to cancel image job.", "Không thể dừng job tạo ảnh."));
    }
    setCancelingId("");
  }

  const providerLabel =
    provider === "openai"
      ? "OpenAI Image"
      : provider === "comfyui"
        ? "ComfyUI Local"
        : t("Disabled", "Đã tắt");
  return (
    <main className="no-scrollbar flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">
              iTis Creative
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-.04em]">
              {t("AI Image Studio", "Studio tạo ảnh AI")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("Create a new image or upload a reference to edit. Every result is stored privately for your account.", "Tạo ảnh mới hoặc đưa ảnh tham chiếu để chỉnh sửa. Mọi kết quả được lưu riêng cho tài khoản.")}
            </p>
          </div>
          <div
            className={`rounded-xl border px-3 py-2 text-sm ${ready ? "border-primary/20 bg-primary/7 text-primary" : "border-amber-400/20 bg-amber-400/7 text-amber-200"}`}
          >
            {providerLabel} · {ready ? t("Ready", "Sẵn sàng") : t("Not connected", "Chưa kết nối")}
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
          <form
            onSubmit={generate}
            className="h-fit rounded-3xl border border-white/8 bg-card p-5 md:p-6"
          >
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-primary/10">
                <Sparkles className="size-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">{t("Image description", "Mô tả hình ảnh")}</h3>
                <p className="text-xs text-muted-foreground">
                  {t("Be specific about the subject, composition, and style.", "Càng cụ thể về chủ thể, bố cục và phong cách càng tốt.")}
                </p>
              </div>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={7}
              maxLength={32000}
              placeholder={t("Example: A cinematic portrait of an astronaut standing before a futuristic city, emerald neon lighting, highly detailed…", "Ví dụ: Chân dung điện ảnh của một phi hành gia Việt Nam đứng trước thành phố tương lai, ánh sáng neon xanh lục, chi tiết cao…")}
              className="mt-5 w-full resize-y rounded-2xl border border-white/10 bg-[#090e10] p-4 text-[16px] leading-7 outline-none focus:border-primary"
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">
                {t("Mode", "Chế độ")}
                <Select
                  value={mode}
                  onValueChange={(value) =>
                    setMode(value as "fast" | "quality")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quality">
                      {provider === "comfyui"
                        ? t("Local · Quality", "Local · Chất lượng")
                        : "VIP · Sunburst"}
                    </SelectItem>
                    <SelectItem value="fast">
                      {provider === "comfyui"
                        ? t("Local · Fast", "Local · Nhanh")
                        : t("Fast · Flare", "Nhanh · Flare")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-2 text-sm">
                {t("Aspect ratio", "Tỷ lệ")}
                <Select value={size} onValueChange={setSize}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1024x1024">{t("Square · 1:1", "Vuông · 1:1")}</SelectItem>
                    <SelectItem value="1536x1024">{t("Landscape · 3:2", "Ngang · 3:2")}</SelectItem>
                    <SelectItem value="1024x1536">{t("Portrait · 2:3", "Dọc · 2:3")}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-2 text-sm">
                {t("Quality", "Chất lượng")}
                <Select value={quality} onValueChange={setQuality}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="xhigh">XHigh</SelectItem>
                    <SelectItem value="max">Max</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-2 text-sm">
                {t("Background", "Nền")}
                <Select
                  value={provider === "comfyui" ? "opaque" : background}
                  onValueChange={setBackground}
                  disabled={provider === "comfyui"}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t("Auto", "Tự động")}</SelectItem>
                    <SelectItem value="opaque">{t("Opaque", "Có nền")}</SelectItem>
                    <SelectItem value="transparent">{t("Transparent", "Trong suốt")}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="mt-4 block cursor-pointer rounded-2xl border border-dashed border-white/12 bg-white/[.02] p-4 hover:border-primary/30">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) =>
                  setReference(event.target.files?.[0] ?? null)
                }
              />
              {referencePreview ? (
                <div className="flex items-center gap-3">
                  <img
                    src={referencePreview}
                    alt={t("Reference image", "Ảnh tham chiếu")}
                    className="size-16 rounded-xl object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {reference?.name}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t("Reference image for editing", "Ảnh tham chiếu để chỉnh sửa")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      setReference(null);
                    }}
                    className="grid size-8 place-items-center rounded-lg hover:bg-white/5"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-sm">
                  <ImageIcon className="size-5 text-primary" />
                  <div>
                    <div className="font-medium">{t("Add reference image", "Thêm ảnh tham chiếu")}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t("PNG, JPEG, or WebP · max 20MB", "PNG, JPEG hoặc WebP · tối đa 20MB")}
                    </div>
                  </div>
                </div>
              )}
            </label>
            {error && (
              <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/7 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}
            {!ready && (
              <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/7 px-4 py-3 text-sm leading-6 text-amber-100">
                {provider === "openai"
                  ? t("OPENAI_API_KEY must be configured on the server.", "Cần cấu hình OPENAI_API_KEY trên server.")
                  : provider === "comfyui"
                    ? t("ComfyUI or the local image checkpoint is not ready.", "ComfyUI hoặc checkpoint ảnh local chưa sẵn sàng.")
                    : t("Image generation is not enabled for this account.", "Admin chưa cấp quyền tạo ảnh cho tài khoản này.")}
              </div>
            )}
            <button
              disabled={!prompt.trim() || !ready || generating}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {generating ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {generating
                ? t("Starting image job…", "Đang khởi tạo job…")
                : reference
                  ? t("Edit image", "Chỉnh sửa hình ảnh")
                  : t("Generate image", "Tạo hình ảnh")}
            </button>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {provider === "comfyui"
                ? mode === "quality"
                  ? t("Local quality uses more sampling steps.", "Local chất lượng dùng nhiều bước lấy mẫu hơn.")
                  : t("Local fast is optimized for the current CPU.", "Local nhanh được tối ưu cho máy CPU hiện tại.")
                : mode === "quality"
                  ? t("Sunburst prioritizes accuracy and quality.", "Sunburst ưu tiên độ chính xác và chất lượng.")
                  : t("Flare prioritizes speed and cost.", "Flare ưu tiên tốc độ và chi phí.")}
            </p>
          </form>

          <section className="rounded-3xl border border-white/8 bg-card p-5 md:p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">{t("Your library", "Thư viện của bạn")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(`${liveImages.length} creations stored in PostgreSQL`, `${liveImages.length} tác phẩm đã ghi trong PostgreSQL`)}
                </p>
              </div>
              <ImageIcon className="size-5 text-muted-foreground" />
            </div>
            {liveImages.length ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {liveImages.map((image) => (
                  <article
                    key={image.id}
                    className="overflow-hidden rounded-2xl border border-white/8 bg-[#090e10]"
                  >
                    {image.url ? (
                      <div className="relative aspect-square overflow-hidden bg-black">
                        <img
                          src={image.url}
                          alt={image.prompt}
                          className="h-full w-full object-cover transition duration-300 hover:scale-[1.02]"
                        />
                      </div>
                    ) : image.status === "processing" ? (
                      <div className="relative flex aspect-square flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-primary/[.09] via-white/[.02] to-[#7aa2ff]/[.08] px-7 text-center">
                        <div className="absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_50%_35%,rgba(184,255,107,.09),transparent_42%)]" />
                        <div className="relative grid size-14 place-items-center rounded-2xl border border-primary/20 bg-[#0b1212]/90 shadow-[0_0_40px_rgba(184,255,107,.08)]">
                          <LoaderCircle className="size-6 animate-spin text-primary" />
                        </div>
                        <div className="relative mt-5 font-medium">
                          {t("iTis is preparing your image", "iTis đang chuẩn bị hình ảnh")}
                        </div>
                        <div className="relative mt-2 min-h-10 text-xs leading-5 text-muted-foreground">
                          {image.stage}
                        </div>
                        <div className="relative flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[.12em] text-primary">
                          <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                          {t("Live sync", "Đồng bộ trực tiếp")}
                        </div>
                        <div className="relative mt-4 w-full">
                          <div className="mb-2 flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground">
                              {t("Stage progress", "Tiến trình theo giai đoạn")}
                            </span>
                            <span className="font-mono text-primary">
                              {image.progress}%
                            </span>
                          </div>
                          <Progress
                            value={image.progress}
                            className="h-1.5 bg-white/8 [&>div]:bg-gradient-to-r [&>div]:from-[#62e6d4] [&>div]:to-[#b8ff6b]"
                          />
                        </div>
                        <button
                          onClick={() => void cancelImage(image.id)}
                          disabled={cancelingId === image.id}
                          className="relative mt-5 flex items-center gap-2 rounded-xl border border-red-300/20 bg-red-400/[.06] px-4 py-2 text-xs font-medium text-red-200 hover:bg-red-400/10 disabled:opacity-50"
                        >
                          {cancelingId === image.id ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <Square className="size-3 fill-current" />
                          )}
                          {cancelingId === image.id
                            ? t("Canceling…", "Đang dừng…")
                            : t("Stop generation", "Dừng tạo ảnh")}
                        </button>
                      </div>
                    ) : (
                      <div className="grid aspect-square place-items-center bg-white/[.02] px-6 text-center">
                        <div>
                          <div
                            className={`mx-auto grid size-11 place-items-center rounded-xl ${image.status === "canceled" ? "bg-amber-400/8 text-amber-200" : "bg-red-400/8 text-red-300"}`}
                          >
                            {image.status === "canceled" ? (
                              <Square className="size-4 fill-current" />
                            ) : (
                              <X className="size-5" />
                            )}
                          </div>
                          <div className="mt-3 text-sm font-medium">
                            {image.status === "canceled"
                              ? t("Image generation canceled", "Đã dừng tạo ảnh")
                              : t("Image generation failed", "Tạo ảnh thất bại")}
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {image.stage}
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="p-4">
                      <p className="line-clamp-2 text-sm leading-5">
                        {image.prompt}
                      </p>
                      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {shortModelLabel(image.model) ?? image.model}
                        </span>
                        <span>${image.estimatedCostUsd.toFixed(4)}</span>
                      </div>
                      {image.error && (
                        <p className="mt-2 line-clamp-2 text-xs text-red-300">
                          {image.error}
                        </p>
                      )}
                      <div className="mt-3 flex items-center gap-2">
                        {image.url && (
                          <a
                            href={image.url}
                            download={`itis-${image.id}.png`}
                            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5"
                          >
                            <Download className="size-3.5" />
                            {t("Download", "Tải xuống")}
                          </a>
                        )}
                        {image.status !== "processing" && (
                          <button
                            onClick={() => void removeImage(image.id)}
                            aria-label={t("Delete image", "Xóa ảnh")}
                            className="grid size-8 place-items-center rounded-lg border border-white/10 text-muted-foreground hover:border-red-400/25 hover:text-red-300"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[.015] text-center">
                <div>
                  <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/8">
                    <ImageIcon className="size-5 text-primary" />
                  </div>
                  <p className="mt-4 text-sm font-medium">{t("No images yet", "Chưa có hình ảnh")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("Your first creation will appear here.", "Tác phẩm đầu tiên sẽ xuất hiện tại đây.")}
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
  color,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  note: string;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-card p-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" style={{ color }} />
        {label}
      </div>
      <div className="metric-number mt-4 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

function AccountView({
  account,
  reload,
  historyCount,
  clearHistory,
}: {
  account: Account | null;
  reload: () => Promise<void>;
  historyCount: number;
  clearHistory: () => Promise<void>;
}) {
  const { t, locale } = useLanguage();
  const [name, setName] = useState(account?.user.name ?? "");
  const [email, setEmail] = useState(account?.user.email ?? "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [languageSaving, setLanguageSaving] = useState(false);
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [memoryInput, setMemoryInput] = useState("");
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryEdit, setMemoryEdit] = useState<{id:string;content:string}|null>(null);
  const [memoryVisible, setMemoryVisible] = useState(12);
  const [memoryNotice, setMemoryNotice] = useState("");
  const [error, setError] = useState("");
  async function loadMemories() {
    setMemoryLoading(true);
    try {
      const response = await fetch("/api/account/memory", { cache: "no-store" });
      if (response.ok) setMemories(((await response.json()) as { memories: UserMemory[] }).memories);
    } finally {
      setMemoryLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (account) void loadMemories();
    // The signed-in account controls the only visible memory namespace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.user.id]);

  async function addMemory() {
    const content = memoryInput.trim();
    if (!content) return;
    setMemoryLoading(true);
    const response = await fetch("/api/account/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, kind: "knowledge" }),
    });
    if (response.ok) {
      const result=await response.json() as {notice?:string};setMemoryNotice(result.notice??"");
      setMemoryInput("");
      await Promise.all([loadMemories(), reload()]);
    } else {
      const data = (await response.json()) as { error?: string };
      setError(data.error || t("Unable to save memory.", "Không thể lưu bộ nhớ."));
      setMemoryLoading(false);
    }
  }

  async function deleteMemory(id: string) {
    await fetch(`/api/account/memory/${id}`, { method: "DELETE" });
    await Promise.all([loadMemories(), reload()]);
  }

  async function updateMemory(id:string,body:{content:string}|{undo:true}){
    setMemoryLoading(true);setError("");
    try{
      const response=await fetch(`/api/account/memory/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      if(!response.ok){const data=await response.json() as {error?:string};setError(data.error||t("Unable to update memory.","Không thể cập nhật bộ nhớ."));return;}
      setMemoryEdit(null);setMemoryNotice(t("Memory updated.","Đã cập nhật bộ nhớ."));await Promise.all([loadMemories(),reload()]);
    }finally{setMemoryLoading(false);}
  }

  async function saveProfile() {
    setSaving(true);
    setError("");
    const response = await fetch("/api/account", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error || t("Unable to save profile.", "Không thể lưu hồ sơ."));
      setSaving(false);
      return;
    }
    if (avatarFile) {
      const form = new FormData();
      form.set("avatar", avatarFile);
      const avatarResponse = await fetch("/api/account/avatar", {
        method: "POST",
        body: form,
      });
      if (!avatarResponse.ok) {
        const data = (await avatarResponse.json()) as { error?: string };
        setError(data.error || t("Unable to upload avatar.", "Không thể tải ảnh đại diện."));
        setSaving(false);
        return;
      }
    }
    workspaceCache.account = undefined;
    await reload();
    setAvatarFile(null);
    setEditing(false);
    setSaving(false);
  }

  async function changeLanguage(nextLocale: AppLocale) {
    if (!account || nextLocale === locale || languageSaving) return;
    setLanguageSaving(true);
    setError("");
    const response = await fetch("/api/account", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: account.user.name,
        email: account.user.email,
        locale: nextLocale,
      }),
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error || t("Unable to change language.", "Không thể đổi ngôn ngữ."));
      setLanguageSaving(false);
      return;
    }
    workspaceCache.account = undefined;
    await reload();
    setLanguageSaving(false);
  }

  if (!account)
    return (
      <main className="grid flex-1 place-items-center text-sm text-muted-foreground">
        {t("Loading account…", "Đang tải tài khoản…")}
      </main>
    );
  return (
    <main className="no-scrollbar flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-7">
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">
            {t("iTis Account", "Tài khoản iTis")}
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-.04em]">
            {t("Your profile", "Hồ sơ của bạn")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Manage your personal information, language, and quota in one place.", "Chỉnh sửa thông tin cá nhân, ngôn ngữ và theo dõi toàn bộ quota tại một nơi.")}
          </p>
        </div>
        <AccountSecurity vi={locale === "vi"}/>
        <AccountNotifications vi={locale === "vi"}/>
        <section className="mb-7 rounded-3xl border border-white/8 bg-card p-5 md:p-7">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            {account.user.avatarUrl ? (
              <img
                src={account.user.avatarUrl}
                alt={t("Avatar", "Ảnh đại diện")}
                className="size-24 rounded-3xl border border-white/10 object-cover"
              />
            ) : (
              <div className="grid size-24 shrink-0 place-items-center rounded-3xl bg-gradient-to-br from-[#b8ff6b] to-[#4dd7c3] text-2xl font-black text-[#091005]">
                {initials(name || account.user.name)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold">{account.user.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {account.user.email}
                  </p>
                  <span className="mt-3 inline-flex rounded-full border border-primary/20 bg-primary/8 px-2.5 py-1 text-xs capitalize text-primary">
                    {account.user.role}
                  </span>
                </div>
                {!editing && (
                  <button
                    onClick={() => setEditing(true)}
                    className="flex items-center gap-2 rounded-xl border border-white/10 px-3.5 py-2 text-sm hover:bg-white/5"
                  >
                    <Pencil className="size-4" />
                    {t("Edit profile", "Chỉnh sửa hồ sơ")}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-col gap-3 border-t border-white/8 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium">{t("Display language", "Ngôn ngữ hiển thị")}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("Saved to this account and applied across iTis.", "Được lưu theo tài khoản và áp dụng trên toàn bộ iTis.")}
              </div>
            </div>
            <Select
              value={locale}
              onValueChange={(value) => void changeLanguage(value as AppLocale)}
              disabled={languageSaving}
            >
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="vi">Tiếng Việt</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {editing && (
            <div className="mt-6 grid gap-4 border-t border-white/8 pt-6 md:grid-cols-2">
              <label className="grid gap-2 text-sm">
                {t("Display name", "Tên hiển thị")}
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-11 rounded-xl border border-white/10 bg-white/[.03] px-3 outline-none focus:border-primary"
                />
              </label>
              <label className="grid gap-2 text-sm">
                {t("Login email", "Email đăng nhập")}
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  className="h-11 rounded-xl border border-white/10 bg-white/[.03] px-3 outline-none focus:border-primary"
                />
              </label>
              <label className="grid gap-2 text-sm md:col-span-2">
                {t("Upload avatar", "Ảnh đại diện từ máy")}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(event) =>
                    setAvatarFile(event.target.files?.[0] ?? null)
                  }
                  className="file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:font-semibold file:text-primary-foreground h-11 rounded-xl border border-white/10 bg-white/[.03] px-2 py-1 text-sm text-muted-foreground"
                />
                <span className="text-xs text-muted-foreground">
                  {t("JPG, PNG, WebP, or GIF · max 5MB", "JPG, PNG, WebP hoặc GIF · tối đa 5MB")}
                  {avatarFile ? t(` · Selected: ${avatarFile.name}`, ` · Đã chọn: ${avatarFile.name}`) : ""}
                </span>
              </label>
              {error && (
                <div className="text-sm text-red-300 md:col-span-2">
                  {error}
                </div>
              )}
              <div className="flex justify-end gap-2 md:col-span-2">
                <button
                  onClick={() => {
                    setEditing(false);
                    setName(account.user.name);
                    setEmail(account.user.email);
                    setAvatarFile(null);
                    setError("");
                  }}
                  className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:bg-white/5"
                >
                  {t("Cancel", "Hủy")}
                </button>
                <button
                  onClick={() => void saveProfile()}
                  disabled={saving || name.trim().length < 2}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                >
                  {saving ? t("Saving…", "Đang lưu…") : t("Save profile", "Lưu hồ sơ")}
                </button>
              </div>
            </div>
          )}
        </section>
        <section className="mb-7 rounded-3xl border border-primary/15 bg-card p-5 md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <BrainCircuit className="size-5 text-primary" />
                <h3 className="font-semibold">{t("Personal memory", "Bộ nhớ cá nhân")}</h3>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {t("Encrypted locally and isolated to this account. iTis retrieves only a few relevant memories for each question.", "Được mã hóa tại máy chủ local và tách riêng cho tài khoản này. Mỗi câu hỏi chỉ lấy vài ký ức liên quan.")}
              </p>
            </div>
            <span className="rounded-full border border-primary/20 bg-primary/8 px-3 py-1 text-xs text-primary">
              {memories.length} {t("memories", "ký ức")}
            </span>
          </div>
          <p className="mt-5 rounded-xl border border-white/8 bg-white/[.02] px-4 py-3 text-xs text-muted-foreground">
            {t("Memory settings are managed by your administrator. Contact an admin to request changes.", "Thiết lập bộ nhớ do admin quản lý. Liên hệ admin nếu cần thay đổi.")}
          </p>
          <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
            {[
              [t("Personal memory", "Bộ nhớ cá nhân"), account.user.memoryEnabled ? t("Enabled", "Đã bật") : t("Disabled", "Đã tắt")],
              [t("Automatic learning", "Tự động học"), account.user.memoryEnabled && account.user.autoMemory ? t("Enabled", "Đã bật") : t("Disabled", "Đã tắt")],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 px-4 py-3">
                <dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 flex gap-2">
            <textarea
              value={memoryInput}
              disabled={!account.user.memoryEnabled}
              onChange={(event) => setMemoryInput(event.target.value)}
              placeholder={t("Add information iTis should remember…", "Thêm thông tin iTis cần ghi nhớ…")}
              className="min-h-20 flex-1 resize-y rounded-2xl border border-white/10 bg-white/[.03] px-4 py-3 text-sm outline-none focus:border-primary"
            />
            <button onClick={() => void addMemory()} disabled={!account.user.memoryEnabled || !memoryInput.trim() || memoryLoading} className="self-stretch rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-40">
              {t("Remember", "Ghi nhớ")}
            </button>
          </div>
          <div className="mt-4 grid gap-2">
            {memoryNotice&&<p role="status" className="text-xs leading-5 text-primary">{memoryNotice}</p>}
            {memoryLoading && !memories.length ? <div className="py-4 text-sm text-muted-foreground">{t("Loading memory…", "Đang tải bộ nhớ…")}</div> : memories.slice(0, memoryVisible).map((memory) => (
              <div key={memory.id} className="flex items-start gap-3 rounded-2xl border border-white/7 bg-[#090e10] p-4">
                <span className="mt-0.5 rounded-md bg-primary/10 px-2 py-1 text-[10px] uppercase tracking-wider text-primary">{memory.kind}</span>
                <div className="min-w-0 flex-1">
                  {memoryEdit?.id===memory.id?<div><textarea aria-label={t("Edit memory","Sửa ký ức")} maxLength={2000} value={memoryEdit.content} onChange={event=>setMemoryEdit({...memoryEdit,content:event.target.value})} className="min-h-20 w-full rounded-xl border border-primary/30 bg-background p-3 text-sm"/><div className="mt-2 flex gap-3 text-xs"><button disabled={memoryLoading||!memoryEdit.content.trim()} onClick={()=>void updateMemory(memory.id,{content:memoryEdit.content})} className="text-primary disabled:opacity-40">{t("Save","Lưu")}</button><button onClick={()=>setMemoryEdit(null)}>{t("Cancel","Hủy")}</button></div></div>:<p className="text-sm leading-6">{memory.content}</p>}
                  <p className="mt-1 text-[10px] text-muted-foreground">{formatMessageDateTime(memory.updatedAt,locale)}{memory.sourceConversationId&&<> · <a href={`/chat/${memory.sourceConversationId}`} className="hover:text-primary">{t("Source chat","Chat nguồn")}</a></>}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                <button disabled={!account.user.memoryEnabled||memoryLoading} onClick={()=>setMemoryEdit({id:memory.id,content:memory.content})} aria-label={t("Edit memory","Sửa ký ức")} className="rounded-lg p-2 text-muted-foreground hover:text-primary disabled:opacity-40"><Pencil className="size-4"/></button>
                {memory.canUndo&&<button disabled={!account.user.memoryEnabled||memoryLoading} onClick={()=>void updateMemory(memory.id,{undo:true})} aria-label={t("Undo last memory change","Hoàn tác thay đổi ký ức")} title={t("Undo last change","Hoàn tác thay đổi gần nhất")} className="rounded-lg p-2 text-muted-foreground hover:text-primary disabled:opacity-40"><RotateCcw className="size-4"/></button>}
                <button onClick={() => void deleteMemory(memory.id)} aria-label={t("Forget memory", "Quên ký ức")} className="rounded-lg p-2 text-muted-foreground hover:bg-red-400/10 hover:text-red-300"><Trash2 className="size-4" /></button>
                </div>
              </div>
            ))}
          </div>
          {memories.length>memoryVisible&&<button onClick={()=>setMemoryVisible(n=>n+12)} className="mt-3 text-xs text-primary">{t("Show more memories","Xem thêm ký ức")}</button>}
          {memories.length > 0 && (
            <button onClick={async () => { await fetch("/api/account/memory", { method: "DELETE" }); await Promise.all([loadMemories(), reload()]); }} className="mt-4 text-xs text-red-300 hover:underline">
              {t("Forget all text memories", "Quên toàn bộ ghi nhớ dạng chữ")}
            </button>
          )}
          <MemoryDocuments uploadLimits={account.system.uploadLimits??defaultUploadLimits} enabled={account.user.memoryEnabled} vi={locale === "vi"} onChange={reload}/>
        </section>
        <UsageView account={account} embedded />
        {account?.storage && (
          <section className="mt-7 rounded-3xl border border-white/10 bg-white/[.02] p-5 md:p-6">
            <h3 className="font-semibold">{t("Account storage", "Dung lượng tài khoản")}</h3>
            <div className="mt-3 flex justify-between text-sm">
              <span>{t("History & files", "Lịch sử & tệp")}</span>
              <span>{(account.storage.usedBytes / 1024 ** 3).toFixed(3)} / {(account.storage.limitBytes / 1024 ** 3).toFixed(2)} GiB</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, account.storage.limitBytes ? account.storage.usedBytes / account.storage.limitBytes * 100 : 100)}%` }} /></div>
            <p className="mt-3 text-xs text-muted-foreground">
              {t("Logical history content and stored files. Delete chats to free their attachments; token usage is retained. Backups and database overhead are separate.", "Nội dung lịch sử và tệp đã lưu. Xóa chat để dọn tệp đi kèm; token đã dùng vẫn giữ. Backup và phần phụ trội database tính riêng.")}
            </p>
          </section>
        )}
        <section className="mt-7 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-red-400/15 bg-red-400/[.035] p-5 md:p-6">
          <div>
            <h3 className="font-semibold text-red-200">
              {t("Clear conversation history", "Dọn lịch sử trò chuyện")}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(`Delete messages and attachments from ${historyCount} conversations to free storage. Usage and cost records will be kept.`, `Xóa tin nhắn và tệp đính kèm của ${historyCount} phiên để giải phóng dung lượng. Số liệu usage và chi phí vẫn được giữ.`)}
            </p>
          </div>
          <button
            onClick={async () => {
              setClearing(true);
              try {
                await clearHistory();
              } catch (clearError) {
                setError(
                  clearError instanceof Error
                    ? clearError.message
                    : t("Unable to clear history.", "Không thể xóa lịch sử."),
                );
              } finally {
                setClearing(false);
              }
            }}
            disabled={!historyCount || clearing}
            className="flex items-center gap-2 rounded-xl border border-red-300/20 bg-red-400/8 px-4 py-2.5 text-sm font-semibold text-red-200 hover:bg-red-400/12 disabled:opacity-40"
          >
            <Trash2 className="size-4" />
            {clearing ? t("Clearing…", "Đang xóa…") : t("Clear all history", "Xóa toàn bộ lịch sử")}
          </button>
        </section>
      </div>
    </main>
  );
}

function UsageView({
  account,
  embedded = false,
}: {
  account: Account | null;
  embedded?: boolean;
}) {
  const { t, numberLocale } = useLanguage();
  const used = account?.usage.used ?? 0;
  const limit = account?.usage.limit ?? 0;
  const percent = account?.usage.unlimited
    ? 0
    : Math.round((used / Math.max(limit, 1)) * 100);
  const daily = account?.usage.daily.length
    ? account.usage.daily
    : [{ day: new Date().toISOString().slice(0, 10), tokens: 0 }];
  const maxDaily = Math.max(1, ...daily.map((item) => item.tokens));
  const localTokens =
    account?.usage.byModel
      .filter(
        (item) =>
          item.model.includes("qwen") || item.model.includes("deepseek"),
      )
      .reduce((sum, item) => sum + item.tokens, 0) ?? 0;
  const imageTokens =
    account?.usage.byModel
      .filter(
        (item) =>
          item.model.includes("image") ||
          item.model.includes("sunburst") ||
          item.model.includes("flare"),
      )
      .reduce((sum, item) => sum + item.tokens, 0) ?? 0;
  const content = (
    <div className={embedded ? "" : "mx-auto max-w-6xl"}>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">
            {embedded ? t("Usage", "Mức sử dụng") : t("Your account", "Tài khoản của bạn")}
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-.04em]">
            {t("Token usage", "Mức sử dụng token")}
          </h2>
        </div>
        <div className="rounded-xl border border-[#b8ff6b]/20 bg-[#b8ff6b]/7 px-3 py-2 text-sm capitalize text-primary">
          {account?.user.role ?? t("Loading", "Đang tải")} · {t("Resets every", "Reset mỗi")}{" "}
          {account?.user.resetWindowHours ?? 5} {t("hours", "giờ")}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-3xl border border-white/8 bg-card p-6 md:p-7">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm text-muted-foreground">
                {t("Tokens in current cycle", "Token trong chu kỳ hiện tại")}
              </div>
              <div className="metric-number mt-3 text-4xl font-semibold">
                {used.toLocaleString(numberLocale)}{" "}
                <span className="text-lg font-normal text-muted-foreground">
                  /{" "}
                  {account?.usage.unlimited
                    ? t("Unlimited", "Không giới hạn")
                    : limit.toLocaleString(numberLocale)}
                </span>
              </div>
            </div>
            <CircleGauge className="size-6 text-primary" />
          </div>
          <Progress
            value={percent}
            className="mt-8 h-2 bg-white/8 [&>div]:bg-gradient-to-r [&>div]:from-[#62e6d4] [&>div]:to-[#b8ff6b]"
          />
          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">{t("Remaining", "Còn lại")}</div>
              <div className="mt-1 font-semibold text-primary">
                {account?.usage.unlimited
                  ? "∞"
                  : (account?.usage.remaining ?? 0).toLocaleString(numberLocale)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("Used", "Đã dùng")}</div>
              <div className="mt-1 font-semibold">{percent}%</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("Requests", "Yêu cầu")}</div>
              <div className="mt-1 font-semibold">
                {account?.usage.requests ?? 0}
              </div>
            </div>
          </div>
        </section>
        <section className="rounded-3xl border border-[#7aa2ff]/15 bg-card p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {t("Total tokens allocated by admin", "Tổng token được admin cấp")}
            </span>
            <Coins className="size-5 text-[#7aa2ff]" />
          </div>
          <div className="metric-number mt-4 text-3xl font-semibold">
            {(account?.usage.totalLimit ?? 0).toLocaleString(numberLocale)}
          </div>
          <Progress
            value={
              account?.usage.totalUnlimited
                ? 0
                : Math.min(
                    100,
                    ((account?.usage.totalUsed ?? 0) /
                      Math.max(1, account?.usage.totalLimit ?? 1)) *
                      100,
                  )
            }
            className="mt-6 h-2 bg-white/8 [&>div]:bg-[#7aa2ff]"
          />
          <div className="mt-3 text-xs text-muted-foreground">
            {t("Used", "Đã dùng")} · {(account?.usage.totalUsed ?? 0).toLocaleString(numberLocale)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t("Remaining:", "Còn lại:")}{" "}
            <span className="font-semibold text-[#9cb8ff]">
              {account?.usage.totalUnlimited
                ? "∞"
                : (account?.usage.totalRemaining ?? 0).toLocaleString(numberLocale)}
            </span>{" "}
            · {t("Does not reset automatically", "Không tự reset")}
          </div>
        </section>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          icon={BrainCircuit}
          label="GPT-6.1 Sol"
          value={(
            account?.usage.byModel.find((item) => item.model === "gpt-6.1-sol")
              ?.tokens ?? 0
          ).toLocaleString(numberLocale)}
          note={t("Tokens in cycle", "Token trong chu kỳ")}
          color="#7aa2ff"
        />
        <MetricCard
          icon={Sparkles}
          label="GPT-6 Luna"
          value={(
            account?.usage.byModel.find((item) => item.model === "gpt-6-luna")
              ?.tokens ?? 0
          ).toLocaleString(numberLocale)}
          note={t("Tokens in cycle", "Token trong chu kỳ")}
          color="#b8ff6b"
        />
        <MetricCard
          icon={Cpu}
          label="Local AI"
          value={localTokens.toLocaleString(numberLocale)}
          note="Qwen + DeepSeek"
          color="#63e6d4"
        />
        <MetricCard
          icon={ImageIcon}
          label="Image AI"
          value={imageTokens.toLocaleString(numberLocale)}
          note={t("Image generation and editing tokens", "Token tạo và chỉnh ảnh")}
          color="#ff7fb5"
        />
        <MetricCard
          icon={Clock3}
          label={t("Next reset", "Reset kế tiếp")}
          value={
            account
              ? new Date(account.usage.resetsAt).toLocaleTimeString(numberLocale, {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "--:--"
          }
          note={t("Based on account cycle", "Theo chu kỳ tài khoản")}
          color="#ffcb66"
        />
      </div>
      <section className="mt-4 rounded-3xl border border-white/8 bg-card p-6 md:p-7">
        <div className="mb-6">
          <h3 className="font-semibold">{t("Recent activity", "Hoạt động gần đây")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Actual token usage recorded in PostgreSQL", "Token thực tế được ghi trong PostgreSQL")}
          </p>
        </div>
        <div className="flex h-48 items-end gap-3">
          {daily.map((item) => (
            <div
              className="flex flex-1 flex-col items-center gap-2"
              key={item.day}
            >
              <div
                className="w-full max-w-14 rounded-t-lg bg-gradient-to-t from-[#7aa2ff] to-[#b8ff6b]"
                style={{
                  height: `${Math.max(4, Math.round((item.tokens / maxDaily) * 100))}%`,
                }}
              />
              <span className="text-[11px] text-muted-foreground">
                {new Date(item.day).toLocaleDateString(numberLocale, {
                  day: "2-digit",
                  month: "2-digit",
                })}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
  return embedded ? (
    content
  ) : (
    <main className="no-scrollbar flex-1 overflow-y-auto p-4 md:p-8">
      {content}
    </main>
  );
}

function BrandingEditor({
  branding,
  onChange,
}: {
  branding: Branding;
  onChange: (branding: Branding) => void;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState<"system" | "chat" | null>(null);
  const [error, setError] = useState("");

  function refreshFavicon() {
    document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]').forEach((link) => {
      link.href = `/api/brand-assets/system?v=${Date.now()}`;
    });
  }

  async function upload(kind: "system" | "chat", file?: File) {
    if (!file) return;
    setBusy(kind);
    setError("");
    const form = new FormData();
    form.set("kind", kind);
    form.set("logo", file);
    try {
      const response = await fetch("/api/admin/branding", { method: "POST", body: form });
      const data = await response.json() as { branding?: Branding; error?: string };
      if (!response.ok || !data.branding) throw new Error(data.error || t("Unable to upload logo.", "Không thể tải logo."));
      onChange(data.branding);
      if (kind === "system") refreshFavicon();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t("Unable to upload logo.", "Không thể tải logo."));
    } finally {
      setBusy(null);
    }
  }

  async function reset(kind: "system" | "chat") {
    setBusy(kind);
    setError("");
    try {
      const response = await fetch(`/api/admin/branding?kind=${kind}`, { method: "DELETE" });
      const data = await response.json() as { branding?: Branding; error?: string };
      if (!response.ok || !data.branding) throw new Error(data.error || t("Unable to reset logo.", "Không thể khôi phục logo."));
      onChange(data.branding);
      if (kind === "system") refreshFavicon();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : t("Unable to reset logo.", "Không thể khôi phục logo."));
    } finally {
      setBusy(null);
    }
  }

  const cards = [
    {
      kind: "system" as const,
      title: t("System logo", "Logo hệ thống"),
      description: t("Sidebar, sign-in portal, and browser icon.", "Sidebar, màn hình đăng nhập và biểu tượng trình duyệt."),
      url: branding.systemLogoUrl,
    },
    {
      kind: "chat" as const,
      title: t("Chat AI logo", "Logo Chat AI"),
      description: t("iTis avatar displayed beside every AI response.", "Avatar iTis hiển thị bên cạnh mỗi câu trả lời AI."),
      url: branding.chatLogoUrl,
    },
  ];

  return (
    <section className="mt-4 rounded-3xl border border-white/8 bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ImageIcon className="size-5 text-primary" />
            <h3 className="font-semibold">{t("Brand identity", "Nhận diện thương hiệu")}</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Upload separate logos for the product and the AI assistant. Leave them empty to use the default iTis mark.", "Tải logo riêng cho hệ thống và trợ lý AI. Để trống để dùng logo iTis mặc định.")}
          </p>
        </div>
        <span className="rounded-full border border-primary/15 bg-primary/[.05] px-3 py-1 text-xs text-primary">
          {t("Stored on this server", "Lưu trên server này")}
        </span>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <div key={card.kind} className="flex flex-col gap-4 rounded-2xl border border-white/8 bg-white/[.02] p-4 sm:flex-row sm:items-center">
            <div className="grid size-20 shrink-0 place-items-center rounded-2xl border border-white/10 bg-[#070c0e] shadow-inner">
              <BrandLogo src={card.url} size={62} title={card.title} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-medium">{card.title}</h4>
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${card.url ? "bg-[#7aa2ff]/10 text-[#9cb8ff]" : "bg-primary/10 text-primary"}`}>
                  {card.url ? t("Custom", "Tùy chỉnh") : t("Default", "Mặc định")}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{card.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <label className={`cursor-pointer rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-[#c7ff8e] ${busy ? "pointer-events-none opacity-50" : ""}`}>
                  {busy === card.kind ? t("Uploading…", "Đang tải…") : card.url ? t("Replace image", "Thay ảnh") : t("Upload image", "Tải ảnh lên")}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="sr-only"
                    disabled={Boolean(busy)}
                    onChange={(event) => {
                      void upload(card.kind, event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </label>
                {card.url && (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void reset(card.kind)}
                    className="rounded-lg border border-white/10 px-3 py-2 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground disabled:opacity-50"
                  >
                    {t("Restore default", "Khôi phục mặc định")}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {t("PNG or WebP with a transparent background is recommended · Maximum 5MB.", "Khuyên dùng PNG hoặc WebP nền trong suốt · Tối đa 5MB.")}
      </div>
      {error && <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/[.06] px-3 py-2 text-sm text-red-300">{error}</div>}
    </section>
  );
}

function AdminView({
  members,
  settings,
  account,
  reload,
  setSettings,
}: {
  members: Member[];
  settings: Settings;
  account: Account;
  reload: () => Promise<void>;
  setSettings: (value: Settings) => void;
}) {
  const { t, numberLocale } = useLanguage();
  const totalTokens = members.reduce(
    (sum, member) => sum + member.usedTokens,
    0,
  );
  const totalCost = members.reduce((sum, member) => sum + member.costUsd, 0);
  async function updateSettings(patch: Partial<Settings>) {
    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (response.ok) {
      setSettings(((await response.json()) as { settings: Settings }).settings);
      await reload();
    }
  }
  return (
    <main className="no-scrollbar flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">
              Control center
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-.04em]">
              {t("Operate iTis", "Điều hành iTis")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("All metrics and settings below are loaded from PostgreSQL.", "Tất cả số liệu và cấu hình bên dưới đều đọc từ PostgreSQL.")}
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={Users}
            label={t("Active users", "Người dùng hoạt động")}
            value={String(members.filter((member) => member.isActive).length)}
            note={t(`${members.length} accounts in the database`, `${members.length} tài khoản trong database`)}
            color="#b8ff6b"
          />
          <MetricCard
            icon={Coins}
            label={t("Recorded OpenAI cost", "Chi phí OpenAI ghi nhận")}
            value={`$${totalCost.toFixed(4)}`}
            note={t("Total from actual usage", "Tổng theo usage thật")}
            color="#63e6d4"
          />
          <MetricCard
            icon={Activity}
            label={t("Tokens processed", "Token đã xử lý")}
            value={totalTokens.toLocaleString(numberLocale)}
            note={t("Actual input + output", "Input + output thực tế")}
            color="#7aa2ff"
          />
          <MetricCard
            icon={ShieldCheck}
            label="Database local"
            value="Online"
            note="PostgreSQL + Redis"
            color="#ffcb66"
          />
        </div>

        <AdminNotifications vi={account.user.locale === "vi"} members={members}/>

        <BrandingEditor
          branding={settings.branding}
          onChange={(branding) => {
            const next = { ...settings, branding };
            workspaceCache.settings = next;
            setSettings(next);
          }}
        />

        <section className="mt-4 rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/[.08] to-transparent p-6">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div>
              <div className="flex items-center gap-2">
                <Settings2 className="size-5 text-primary" />
                <h3 className="font-semibold">{t("System-wide AI switch", "Công tắc AI toàn hệ thống")}</h3>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {t("One switch controls Chat and Image Studio for every account. Per-user Image Studio permissions are preserved.", "Một công tắc điều khiển đồng thời Chat và Studio ảnh cho tất cả tài khoản. Quyền tắt Studio ảnh riêng từng user vẫn được giữ.")}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.aiEnvironment.provider === "openai"}
              onClick={() =>
                void updateSettings({
                  aiEnvironment: {
                    provider:
                      settings.aiEnvironment.provider === "local"
                        ? "openai"
                        : "local",
                  },
                })
              }
              className={`group relative flex h-14 w-64 items-center rounded-full border p-1.5 shadow-inner transition-all duration-300 ${settings.aiEnvironment.provider === "openai" ? "border-[#7aa2ff]/40 bg-[#111a2b] shadow-[#7aa2ff]/10" : "border-primary/30 bg-[#101a12] shadow-primary/10"}`}
            >
              <span
                className={`absolute top-1.5 h-11 w-[calc(50%-6px)] rounded-full shadow-lg transition-transform duration-300 ${settings.aiEnvironment.provider === "openai" ? "translate-x-[calc(100%+0px)] bg-[#7aa2ff] shadow-[#7aa2ff]/20" : "translate-x-0 bg-primary shadow-primary/20"}`}
              />
              <span
                className={`relative z-10 flex w-1/2 items-center justify-center gap-2 text-sm font-semibold transition-colors ${settings.aiEnvironment.provider === "local" ? "text-primary-foreground" : "text-muted-foreground"}`}
              >
                <Cpu className="size-4" />
                Local
              </span>
              <span
                className={`relative z-10 flex w-1/2 items-center justify-center gap-2 text-sm font-semibold transition-colors ${settings.aiEnvironment.provider === "openai" ? "text-[#08101f]" : "text-muted-foreground"}`}
              >
                <BrainCircuit className="size-4" />
                OpenAI
              </span>
            </button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div
              className={`rounded-2xl border p-4 ${settings.aiEnvironment.provider === "local" ? "border-primary/30 bg-primary/[.06]" : "border-white/8 bg-white/[.02]"}`}
            >
              <div className="font-medium">Local stack</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Chat: Qwen / DeepSeek · {t("Images", "Ảnh")}: ComfyUI SD 1.5
              </div>
            </div>
            <div
              className={`rounded-2xl border p-4 ${settings.aiEnvironment.provider === "openai" ? "border-[#7aa2ff]/30 bg-[#7aa2ff]/[.06]" : "border-white/8 bg-white/[.02]"}`}
            >
              <div className="font-medium">OpenAI stack</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Chat: Smart Router · {t("Images", "Ảnh")}: GPT-Image-2.5 Sunburst / Flare
              </div>
              {!account.system.openaiConfigured && (
                <div className="mt-2 text-xs text-amber-300">
                  {t("OPENAI_API_KEY is missing — OpenAI requests will remain disabled until a key is configured.", "Chưa có OPENAI_API_KEY — chuyển sang OpenAI sẽ khóa gửi yêu cầu cho đến khi cấu hình key.")}
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <section className="rounded-2xl border border-white/8 bg-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="size-5 text-primary" />
                <h3 className="font-semibold">Local AI · LM Studio</h3>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${!account.system.localStatusChecked ? "bg-white/5 text-muted-foreground" : account.system.localAiConnected ? "bg-primary/10 text-primary" : "bg-red-400/10 text-red-300"}`}
              >
                {!account.system.localStatusChecked
                  ? t("Paused", "Tạm ngắt")
                  : account.system.localAiConnected
                    ? t("Running", "Đang chạy")
                    : t("Disconnected", "Mất kết nối")}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Chat: {account.system.localGeneralModel}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Code: {account.system.localCodeModel}
            </p>
          </section>
          <section className="rounded-2xl border border-white/8 bg-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BrainCircuit className="size-5 text-[#7aa2ff]" />
                <h3 className="font-semibold">OpenAI API</h3>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${account.system.openaiConfigured ? "bg-primary/10 text-primary" : "bg-amber-400/10 text-amber-300"}`}
              >
                {account.system.openaiConfigured
                  ? t("Configured", "Đã cấu hình")
                  : t("API key missing", "Thiếu API key")}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {t("Smart Router: GPT-6 Luna for fast tasks and GPT-6.1 Sol for complex work.", "Smart Router: GPT-6 Luna cho tác vụ nhanh, GPT-6.1 Sol cho tác vụ phức tạp.")}
            </p>
          </section>
          <section className="rounded-2xl border border-white/8 bg-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon className="size-5 text-[#ff7fb5]" />
                <h3 className="font-semibold">ComfyUI Local</h3>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${!account.system.localStatusChecked ? "bg-white/5 text-muted-foreground" : account.system.comfyUiConnected ? "bg-primary/10 text-primary" : "bg-white/5 text-muted-foreground"}`}
              >
                {!account.system.localStatusChecked
                  ? t("Paused", "Tạm ngắt")
                  : account.system.comfyUiConnected
                    ? t("Running", "Đang chạy")
                    : t("Not running", "Chưa chạy")}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {!account.system.localStatusChecked
                ? t("ComfyUI is not checked while the system is using OpenAI.", "Không kiểm tra ComfyUI khi hệ thống đang chạy OpenAI.")
                : account.system.comfyUiConnected
                  ? t("Local SD 1.5 is active. Rendering currently uses the CPU; you can upgrade the GPU and checkpoint later.", "SD 1.5 local đang hoạt động. Máy hiện render bằng CPU; có thể nâng GPU và đổi checkpoint sau.")
                  : t("The connector is configured, but local ComfyUI is not running.", "Connector đã cấu hình nhưng ComfyUI local chưa được khởi động.")}
            </p>
          </section>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
          <section className="rounded-3xl border border-white/8 bg-card p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold">Smart Model Router</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("Automatically applies when the system switch is set to OpenAI.", "Tự động áp dụng khi công tắc tổng đang ở OpenAI.")}
                </p>
              </div>
              <Switch
                checked={settings.modelRouter.enabled}
                onCheckedChange={(enabled) =>
                  void updateSettings({
                    modelRouter: { ...settings.modelRouter, enabled },
                  })
                }
                className="data-[state=checked]:bg-primary"
              />
            </div>
            <div className="mt-6 rounded-2xl border border-white/8 bg-[#090e10] p-5">
              <div className="mb-4 flex items-end justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">
                    {t("Target allocation", "Phân bổ mục tiêu")}
                  </div>
                  <div className="metric-number mt-1 text-3xl font-semibold">
                    {settings.modelRouter.lunaPercent}%{" "}
                    <span className="text-base text-muted-foreground">
                      Luna
                    </span>
                  </div>
                </div>
                <Select
                  value={String(settings.modelRouter.lunaPercent)}
                  onValueChange={(value) =>
                    void updateSettings({
                      modelRouter: {
                        lunaPercent: Number(value),
                        solPercent: 100 - Number(value),
                        enabled: settings.modelRouter.enabled,
                      },
                    })
                  }
                >
                  <SelectTrigger className="border-white/10 bg-white/[.03]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="90">90 / 10</SelectItem>
                    <SelectItem value="80">80 / 20</SelectItem>
                    <SelectItem value="70">70 / 30</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full bg-white/8">
                <div
                  className="bg-primary"
                  style={{ width: `${settings.modelRouter.lunaPercent}%` }}
                />
                <div className="flex-1 bg-[#7aa2ff]" />
              </div>
              <div className="mt-3 flex justify-between text-xs">
                <span className="text-primary">Luna · {t("fast tasks", "tác vụ nhanh")}</span>
                <span className="text-[#8eafff]">Sol · {t("complex reasoning", "reasoning phức tạp")}</span>
              </div>
            </div>
          </section>
          <section className="rounded-3xl border border-white/8 bg-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">{t("Per-chat limit", "Giới hạn mỗi chat")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("Prevent overly deep, expensive context", "Ngăn context quá sâu và tốn token")}
                </p>
              </div>
              <KeyRound className="size-5 text-muted-foreground" />
            </div>
            <ChatLimitEditor
              value={settings.chatLimits.maxContextTokens}
              onSave={(maxContextTokens) =>
                updateSettings({ chatLimits: { maxContextTokens } })
              }
            />
            <div className="mt-4 rounded-xl border border-amber-400/15 bg-amber-400/5 p-4 text-sm leading-6 text-amber-100">
              {t("Near the limit, iTis asks the user to start a new chat. The previous chat remains in history.", "Khi gần chạm giới hạn, iTis yêu cầu người dùng tạo chat mới. Phiên cũ vẫn giữ nguyên trong lịch sử.")}
            </div>
          </section>
        </div>

        <UploadLimitsEditor value={settings.uploadLimits??defaultUploadLimits} onSaved={limits=>{setSettings({...settings,uploadLimits:limits});void reload();}}/>

        <section className="mt-4 rounded-3xl border border-white/8 bg-card p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">{t("Two-tier token plans", "Gói token hai tầng")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("Each role has a cycle quota and a total allocated token budget.", "Mỗi role có quota theo chu kỳ và tổng ngân sách token được cấp.")}
              </p>
            </div>
            <Select
              value={String(settings.tokenReset.windowHours)}
              onValueChange={(value) =>
                void updateSettings({
                  tokenReset: { windowHours: Number(value) },
                })
              }
            >
              <SelectTrigger className="w-44 border-white/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">{t("Every 1 hour", "Chu kỳ mỗi 1 giờ")}</SelectItem>
                <SelectItem value="5">{t("Every 5 hours", "Chu kỳ mỗi 5 giờ")}</SelectItem>
                <SelectItem value="12">{t("Every 12 hours", "Chu kỳ mỗi 12 giờ")}</SelectItem>
                <SelectItem value="24">{t("Every 24 hours", "Chu kỳ mỗi 24 giờ")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mb-4 grid gap-3 text-xs md:grid-cols-2">
            <div className="rounded-xl border border-primary/15 bg-primary/[.04] p-3 text-muted-foreground">
              <span className="font-semibold text-primary">{t("Cycle quota:", "Quota chu kỳ:")}</span>{" "}
              {t("resets after the selected number of hours.", "tự reset sau số giờ đã chọn.")}
            </div>
            <div className="rounded-xl border border-[#7aa2ff]/15 bg-[#7aa2ff]/[.04] p-3 text-muted-foreground">
              <span className="font-semibold text-[#9cb8ff]">
                {t("Total allocation:", "Tổng được cấp:")}
              </span>{" "}
              {t("does not reset; an admin must add more when exhausted.", "không tự reset; admin phải cấp thêm khi hết.")}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <PlanCard
              title={t("Standard", "Thường")}
              plan={settings.roleLimits.standard}
              onSave={(plan) =>
                updateSettings({
                  roleLimits: { ...settings.roleLimits, standard: plan },
                })
              }
            />
            <PlanCard
              title="Plus"
              plan={settings.roleLimits.plus}
              onSave={(plan) =>
                updateSettings({
                  roleLimits: { ...settings.roleLimits, plus: plan },
                })
              }
            />
            <PlanCard
              title="Admin"
              plan={settings.roleLimits.admin}
              onSave={(plan) =>
                updateSettings({
                  roleLimits: { ...settings.roleLimits, admin: plan },
                })
              }
            />
          </div>
        </section>

        <section className="mt-4 overflow-hidden rounded-3xl border border-white/8 bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 p-6">
            <div>
              <h3 className="font-semibold">{t("Users", "Người dùng")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("Track total usage, allocation, and the two independent unlimited permissions.", "Theo dõi tổng đã dùng, tổng được cấp và hai quyền vô hạn riêng biệt.")}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded-xl border border-primary/20 bg-primary/[.06] px-3 py-2 text-primary">
                {t(`${members.filter((member) => member.isActive && !member.accessExpired).length} active`, `${members.filter((member) => member.isActive && !member.accessExpired).length} hoạt động`)}
              </span>
              <span className="rounded-xl border border-white/10 px-3 py-2 text-muted-foreground">
                {t(`${members.filter((member) => !member.isActive || member.accessExpired).length} locked`, `${members.filter((member) => !member.isActive || member.accessExpired).length} đã khóa`)}
              </span>
            </div>
          </div>
          {members.length ? (
            <div>
              <table className="w-full table-fixed text-left text-sm">
                <thead className="bg-white/[.02] text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-[24%] px-4 py-3 font-medium">{t("Account", "Tài khoản")}</th>
                    <th className="w-[15%] px-3 py-3 font-medium">{t("Status", "Trạng thái")}</th>
                    <th className="w-[16%] px-3 py-3 font-medium">{t("Image Studio", "Studio ảnh")}</th>
                    <th className="w-[25%] px-3 py-3 font-medium">
                      {t("Token budget", "Ngân sách token")}
                    </th>
                    <th className="w-[12%] px-3 py-3 font-medium">{t("Unlimited", "Vô hạn")}</th>
                    <th className="w-[8%] px-4 py-3 text-right font-medium">
                      {t("Manage", "Quản lý")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id} className={`border-t border-white/6 transition-opacity ${member.isActive && !member.accessExpired ? "" : "opacity-55"}`}>
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{member.name}</div>
                            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {member.email}
                            </div>
                            <p className="mt-1 text-[10px] text-muted-foreground" title={member.lastSeenAt ? new Date(member.lastSeenAt).toLocaleString(numberLocale) : ""}>{member.lastSeenAt ? `${t("Last active", "Hoạt động cuối")}: ${new Date(member.lastSeenAt).toLocaleString(numberLocale)}` : t("Not signed in yet", "Chưa đăng nhập")}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t("Total activity", "Tổng hoạt động")} · <span className="font-medium text-foreground">{(member.activeSeconds / 3600).toLocaleString(numberLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} {t("h", "giờ")}</span>
                            </p>
                          </div>
                          <span className="shrink-0 rounded-md bg-white/5 px-2 py-1 text-[10px] capitalize">
                            {member.role}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <label className="flex items-center gap-2">
                          <Switch
                            checked={member.isActive}
                            disabled={member.id === account.user.id}
                            onCheckedChange={async (isActive) => {
                              const response = await patchUser(member.id, { isActive });
                              if (response.ok) await reload();
                            }}
                            title={member.id === account.user.id
                              ? t("You cannot disable your current account.", "Không thể tắt tài khoản đang đăng nhập.")
                              : undefined}
                            className="shrink-0 scale-90 data-[state=checked]:bg-primary"
                          />
                          <span className={`truncate text-[11px] font-medium ${member.isActive && !member.accessExpired ? "text-primary" : "text-red-300"}`}>
                            {member.accessExpired ? t("Expired", "Hết hạn") : member.isActive
                              ? t("Active", "Đang hoạt động")
                              : t("Disabled", "Đã ẩn")}
                          </span>
                        </label>
                        {member.accessExpiresAt && (
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {t("Access until", "Hạn sử dụng")} · {new Date(member.accessExpiresAt).toLocaleString(numberLocale, { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" })}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <label className="flex items-center gap-2">
                          <Switch
                            checked={member.imageProvider !== "disabled"}
                            onCheckedChange={async (enabled) => {
                              const imageProvider = enabled
                                ? settings.aiEnvironment.provider === "local"
                                  ? "comfyui"
                                  : "openai"
                                : "disabled";
                              await patchUser(member.id, { imageProvider });
                              await reload();
                            }}
                            className="shrink-0 scale-90 data-[state=checked]:bg-primary"
                          />
                          <span className={`truncate text-[11px] font-medium ${member.imageProvider !== "disabled" ? "text-primary" : "text-muted-foreground"}`}>
                            {member.imageProvider !== "disabled"
                              ? t("Enabled", "Được truy cập")
                              : t("Disabled", "Đã tắt")}
                          </span>
                        </label>
                      </td>
                      <td className="px-3 py-3">
                        <MemberTokenBalances member={member} />
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {t("Cycle", "Chu kỳ")} · {member.unlimited ? "∞" : member.tokenLimit.toLocaleString(numberLocale)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="grid gap-1 text-[10px]">
                          <label className="flex items-center gap-2">
                            <Switch
                              checked={member.unlimited}
                              onCheckedChange={async (unlimited) => {
                                await patchUser(member.id, { unlimited });
                                await reload();
                              }}
                              className="scale-75 data-[state=checked]:bg-primary"
                            />
                            {t("Cycle", "Chu kỳ")}
                          </label>
                          <label className="flex items-center gap-2">
                            <Switch
                              checked={member.totalUnlimited}
                              onCheckedChange={async (totalUnlimited) => {
                                await patchUser(member.id, { totalUnlimited });
                                await reload();
                              }}
                              className="scale-75 data-[state=checked]:bg-[#7aa2ff]"
                            />
                            {t("Total", "Tổng")}
                          </label>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <UserDialog member={member} reload={reload} />
                          <DeleteUserDialog
                            member={member}
                            currentUserId={account.user.id}
                            reload={reload}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {t("Unable to load the list. Select “Try again” in the message above.", "Không tải được danh sách. Hãy bấm “Thử lại” ở thông báo phía trên.")}
            </div>
          )}
          <div className="flex justify-end border-t border-white/8 p-4">
            <CreateUserDialog reload={reload} defaults={settings} />
          </div>
        </section>
      </div>
    </main>
  );
}

function PlanCard({
  title,
  plan,
  onSave,
}: {
  title: string;
  plan: RolePlan;
  onSave: (plan: RolePlan) => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(plan);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    await onSave(draft);
    setEditing(false);
    setSaving(false);
  }
  return (
    <div className="rounded-2xl border border-white/8 bg-[#090e10] p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">{title}</span>
        {title === "Plus" && (
          <span className="rounded-full bg-[#7aa2ff]/10 px-2 py-0.5 text-[10px] font-semibold text-[#9cb8ff]">
            {t("POPULAR", "PHỔ BIẾN")}
          </span>
        )}
      </div>
      <div className="mt-5 grid gap-4">
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          {t("Tokens per cycle", "Token mỗi chu kỳ")}
          <input
            type="number"
            min="0"
            readOnly={!editing}
            disabled={draft.cycleUnlimited}
            value={draft.cycleTokens}
            onChange={(event) =>
              setDraft({
                ...draft,
                cycleTokens: Math.max(0, Number(event.target.value) || 0),
              })
            }
            className={`metric-number h-10 rounded-lg border px-3 text-base font-semibold outline-none ${editing ? "border-primary/30 bg-primary/[.035] text-foreground focus:border-primary" : "cursor-default border-white/8 bg-white/[.02] text-muted-foreground"} disabled:opacity-35`}
          />
        </label>
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          {t("Total token allocation", "Tổng token được cấp")}
          <input
            type="number"
            min="0"
            readOnly={!editing}
            disabled={draft.totalUnlimited}
            value={draft.totalTokens}
            onChange={(event) =>
              setDraft({
                ...draft,
                totalTokens: Math.max(0, Number(event.target.value) || 0),
              })
            }
            className={`metric-number h-10 rounded-lg border px-3 text-base font-semibold outline-none ${editing ? "border-primary/30 bg-primary/[.035] text-foreground focus:border-primary" : "cursor-default border-white/8 bg-white/[.02] text-muted-foreground"} disabled:opacity-35`}
          />
        </label>
      </div>
      <div className="mt-4 grid gap-3 border-t border-white/8 pt-3 text-sm">
        <label className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Clock3 className="size-4 text-muted-foreground" />
            {t("Unlimited cycle", "Chu kỳ vô hạn")}
          </span>
          <Switch
            checked={draft.cycleUnlimited}
            disabled={!editing}
            onCheckedChange={(cycleUnlimited) =>
              setDraft({ ...draft, cycleUnlimited })
            }
            className="data-[state=checked]:bg-primary"
          />
        </label>
        <label className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <InfinityIcon className="size-4 text-muted-foreground" />
            {t("Unlimited total", "Tổng vô hạn")}
          </span>
          <Switch
            checked={draft.totalUnlimited}
            disabled={!editing}
            onCheckedChange={(totalUnlimited) =>
              setDraft({ ...draft, totalUnlimited })
            }
            className="data-[state=checked]:bg-primary"
          />
        </label>
      </div>
      {editing ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              setDraft(plan);
              setEditing(false);
            }}
            className="flex h-9 items-center justify-center rounded-lg border border-white/10 text-xs text-muted-foreground hover:bg-white/5"
          >
            {t("Cancel", "Hủy")}
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex h-9 items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Check className="size-3.5" />
            {saving ? t("Saving…", "Đang lưu…") : t("Save plan", "Lưu gói")}
          </button>
        </div>
      ) : (
        <button
          onClick={() => {
            setDraft(plan);
            setEditing(true);
          }}
          className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-white/10 text-xs font-semibold hover:border-primary/25 hover:bg-primary/[.06] hover:text-primary"
        >
          <Pencil className="size-3.5" />
          {t("Edit", "Chỉnh sửa")}
        </button>
      )}
    </div>
  );
}

function ChatLimitEditor({
  value,
  onSave,
}: {
  value: number;
  onSave: (value: number) => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    await onSave(Math.max(1000, Number(draft) || 50000));
    setEditing(false);
    setSaving(false);
  }
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <label htmlFor="chat-context-limit" className="text-sm">
          {t("Maximum context tokens", "Token context tối đa")}
        </label>
        {editing ? (
          <div className="flex gap-2">
            <button
              onClick={() => {
                setDraft(String(value));
                setEditing(false);
              }}
              className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-white/5"
            >
              {t("Cancel", "Hủy")}
            </button>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              <Check className="size-3.5" />
              {saving ? t("Saving", "Đang lưu") : t("Save", "Lưu")}
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setDraft(String(value));
              setEditing(true);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs hover:bg-white/5"
          >
            <Pencil className="size-3.5" />
            {t("Edit", "Chỉnh sửa")}
          </button>
        )}
      </div>
      <input
        id="chat-context-limit"
        type="number"
        min="1000"
        max="1000000"
        step="1000"
        value={draft}
        readOnly={!editing}
        onChange={(event) => setDraft(event.target.value)}
        className={`h-12 w-full rounded-xl border px-4 font-mono text-lg outline-none transition ${editing ? "border-primary/50 bg-primary/[.04] focus:border-primary" : "cursor-not-allowed border-white/8 bg-white/[.02] text-muted-foreground"}`}
      />
      <div className="mt-2 text-xs text-muted-foreground">
        {t("Recommended: 30,000–80,000 tokens depending on budget.", "Khuyến nghị 30.000–80.000 token tùy ngân sách.")}
      </div>
    </div>
  );
}

async function patchUser(id: string, values: Record<string, unknown>) {
  return fetch(`/api/admin/users/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(values),
  });
}

function MemberTokenBalances({ member }: { member: Member }) {
  const { t, locale } = useLanguage();
  const format = new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US");
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11px]">
      <dt className="text-muted-foreground">{t("Allocated", "Đã cấp")}</dt>
      <dd className="break-all font-mono">{format.format(member.totalTokenLimit)}</dd>
      <dt className="text-muted-foreground">{t("Used", "Đã dùng")}</dt>
      <dd className="break-all font-mono">{format.format(member.usedTokens)}</dd>
      <dt className="text-muted-foreground">{t("Remaining", "Còn lại")}</dt>
      <dd className="break-all font-mono text-primary">
        {member.totalUnlimited ? "∞" : format.format(Math.max(0, member.totalTokenLimit - member.usedTokens))}
      </dd>
    </dl>
  );
}

function expiryInputValue(expiresAt: string | null) {
  return expiresAt ? new Date(new Date(expiresAt).getTime() + 7 * 60 * 60_000).toISOString().slice(0, 16) : "";
}

function UserDialog({
  member,
  reload,
}: {
  member: Member;
  reload: () => Promise<void>;
}) {
  const { t, locale } = useLanguage();
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [role, setRole] = useState(member.role);
  const [tokenLimit, setTokenLimit] = useState(String(member.tokenLimit));
  const [unlimited, setUnlimited] = useState(member.unlimited);
  const [additionalTokens, setAdditionalTokens] = useState("");
  const grantRef = useRef<{ id: string; amount: number } | null>(null);
  const [accessDeadline, setAccessDeadline] = useState(expiryInputValue(member.accessExpiresAt));
  const [totalUnlimited, setTotalUnlimited] = useState(member.totalUnlimited);
  const [storageGiB, setStorageGiB] = useState(String(member.storageLimitBytes / 1024 ** 3));
  const [resetHours, setResetHours] = useState(String(member.resetWindowHours));
  const [isActive, setIsActive] = useState(member.isActive);
  const [allowMultipleSessions,setAllowMultipleSessions]=useState(member.allowMultipleSessions);
  const [memoryEnabled, setMemoryEnabled] = useState(member.memoryEnabled);
  const [autoMemory, setAutoMemory] = useState(member.autoMemory);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function syncDraftFromMember() {
    setName(member.name);
    setEmail(member.email);
    setRole(member.role);
    setTokenLimit(String(member.tokenLimit));
    setUnlimited(member.unlimited);
    setAdditionalTokens(grantRef.current ? String(grantRef.current.amount) : "");
    setAccessDeadline(expiryInputValue(member.accessExpiresAt));
    setTotalUnlimited(member.totalUnlimited);
    setStorageGiB(String(member.storageLimitBytes / 1024 ** 3));
    setResetHours(String(member.resetWindowHours));
    setIsActive(member.isActive);
    setAllowMultipleSessions(member.allowMultipleSessions);
    setMemoryEnabled(member.memoryEnabled);
    setAutoMemory(member.autoMemory);
    setAvatarFile(null);
    setError("");
  }
  async function save() {
    setError("");
    const amount = Number(additionalTokens);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000_000) {
      setError(t("Enter a valid whole number of tokens.", "Hãy nhập số nguyên token hợp lệ."));
      return;
    }
    if (amount > 0 && grantRef.current?.amount !== amount) {
      grantRef.current = { id: crypto.randomUUID(), amount };
    }
    const deadlineChanged = accessDeadline !== expiryInputValue(member.accessExpiresAt);
    const accessExpiresAt = role === "admin" || !accessDeadline ? null : `${accessDeadline}:00+07:00`;
    setSaving(true);
    try {
      const response = await patchUser(member.id, {
        name,
        email,
        role,
        tokenLimit: Number(tokenLimit),
        unlimited,
        ...(amount > 0 ? { tokenGrant: grantRef.current } : {}),
        ...(deadlineChanged || (role === "admin" && member.accessExpiresAt) ? { accessExpiresAt } : {}),
        totalUnlimited,
        storageLimitBytes: Math.round(Number(storageGiB) * 1024 ** 3),
        resetWindowHours: Number(resetHours),
        isActive,
        allowMultipleSessions,
        memoryEnabled,
        autoMemory,
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setError(data.error || t("Unable to save account.", "Không thể lưu tài khoản."));
        return;
      }
      grantRef.current = null;
      setAdditionalTokens("");
      if (avatarFile) {
        const form = new FormData();
        form.set("avatar", avatarFile);
        const avatarResponse = await fetch(
          `/api/admin/users/${member.id}/avatar`,
          { method: "POST", body: form },
        );
        if (!avatarResponse.ok) {
          const data = (await avatarResponse.json()) as { error?: string };
          setError(data.error || t("Unable to upload avatar.", "Không thể tải ảnh đại diện."));
          await reload();
          return;
        }
      }
      await reload();
      setAvatarFile(null);
    } catch {
      setError(t("Unable to confirm the save. Retry to check the result.", "Chưa xác nhận được kết quả lưu. Hãy thử lại."));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog onOpenChange={(open) => { if (open) syncDraftFromMember(); }}>
      <DialogTrigger
        title={t("Edit account", "Chỉnh sửa tài khoản")}
        aria-label={t("Edit account", "Chỉnh sửa tài khoản")}
        className="inline-flex size-8 items-center justify-center rounded-lg border border-white/10 text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
      >
        <Pencil className="size-3.5" />
      </DialogTrigger>
      <DialogContent
        style={{ width: "min(94vw, 1120px)", maxWidth: "1120px" }}
        className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-white/10 bg-[#0d1416]"
      >
        <DialogHeader>
          <DialogTitle>{t(`Configure ${member.name}`, `Cấu hình ${member.name}`)}</DialogTitle>
          <DialogDescription>
            {t("Cycle quota and total tokens are independent limits.", "Quota chu kỳ và tổng token là hai giới hạn độc lập.")}
          </DialogDescription>
        </DialogHeader>
        <div className="no-scrollbar grid min-h-0 gap-4 overflow-y-auto py-2 pr-1 md:grid-cols-2">
          <label className="grid gap-2 text-sm">
            {t("Display name", "Tên hiển thị")}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-10 rounded-lg border border-white/10 bg-white/[.03] px-3 outline-none focus:border-primary"
            />
          </label>
          <label className="grid gap-2 text-sm">
            {t("Login email", "Email đăng nhập")}
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              className="h-10 rounded-lg border border-white/10 bg-white/[.03] px-3 outline-none focus:border-primary"
            />
          </label>
          <label className="grid gap-2 text-sm md:col-span-2">
            {t("Upload avatar", "Ảnh đại diện từ máy")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(event) =>
                setAvatarFile(event.target.files?.[0] ?? null)
              }
              className="file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground h-10 rounded-lg border border-white/10 bg-white/[.03] px-2 py-1 text-xs text-muted-foreground"
            />
          </label>
          <div className="grid grid-cols-2 gap-3 md:col-span-2">
            <label className="grid gap-2 text-sm">
              {t("Role", "Vai trò")}
              <Select
                value={role}
                onValueChange={(value) => setRole(value as Member["role"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="plus">Plus</SelectItem>
                  <SelectItem value="standard">{t("Standard", "Thường")}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <div className="grid gap-2 text-sm">
              <span>{t("AI provider", "Luồng AI")}</span>
              <div className="flex h-10 items-center rounded-lg border border-white/10 bg-white/[.03] px-3 text-muted-foreground">
                {t("Follow system switch", "Theo công tắc tổng")}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[.02] p-3">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary">
              {t("Cycle limit", "Giới hạn theo chu kỳ")}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2 text-sm">
                {t("Tokens / cycle", "Token / chu kỳ")}
                <input
                  value={tokenLimit}
                  disabled={unlimited}
                  onChange={(event) => setTokenLimit(event.target.value)}
                  type="number"
                  className="h-10 rounded-lg border border-white/10 bg-white/[.03] px-3 disabled:opacity-35"
                />
              </label>
              <label className="grid gap-2 text-sm">
                {t("Reset after (hours)", "Reset sau (giờ)")}
                <input
                  value={resetHours}
                  onChange={(event) => setResetHours(event.target.value)}
                  type="number"
                  min="1"
                  max="168"
                  className="h-10 rounded-lg border border-white/10 bg-white/[.03] px-3"
                />
              </label>
            </div>
            <label className="mt-3 flex items-center justify-between text-sm">
              {t("Unlimited cycle", "Chu kỳ vô hạn")}
              <Switch
                checked={unlimited}
                onCheckedChange={setUnlimited}
                className="data-[state=checked]:bg-primary"
              />
            </label>
          </div>
          <div className="rounded-xl border border-[#7aa2ff]/15 bg-[#7aa2ff]/[.025] p-3">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#9cb8ff]">
              {t("Total token budget", "Ngân sách token tổng")}
            </div>
            <MemberTokenBalances member={member} />
            <label className="mt-3 grid gap-2 text-sm">
              {t("Add tokens", "Cấp thêm token")}
              <input
                value={additionalTokens}
                onChange={(event) => setAdditionalTokens(event.target.value)}
                type="number"
                min={0}
                max={100_000_000_000}
                step={1}
                placeholder="0"
                className="h-10 rounded-lg border border-white/10 bg-white/[.03] px-3"
              />
            </label>
            <label className="mt-3 flex items-center justify-between text-sm">
              {t("Unlimited total", "Tổng vô hạn")}
              <Switch
                checked={totalUnlimited}
                onCheckedChange={setTotalUnlimited}
                className="data-[state=checked]:bg-[#7aa2ff]"
              />
            </label>
          </div>
          <div className="rounded-xl border border-primary/15 bg-primary/[.025] p-3">
            <label className="grid gap-2 text-sm">
              {t("History & file storage (GiB)", "Dung lượng lịch sử & tệp (GiB)")}
              <input type="number" min="0" max="1024" step="0.25" value={storageGiB} onChange={(event) => setStorageGiB(event.target.value)} className="h-10 rounded-lg border border-white/10 bg-white/[.03] px-3" />
            </label>
            <p className="mt-2 text-xs text-muted-foreground">{t("Used", "Đã dùng")}: {(Number(member.storageUsedBytes) / 1024 ** 3).toFixed(3)} GiB</p>
            <p className="mt-2 text-xs text-muted-foreground">{t("0 blocks new storage. Lowering the limit never deletes existing data.", "0 chặn lưu mới. Giảm giới hạn không tự xóa dữ liệu đang có.")}</p>
          </div>
          <div className="rounded-xl border border-primary/15 bg-primary/[.025] p-3">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary">
              {t("Personal memory", "Bộ nhớ cá nhân")}
            </div>
            <label className="flex items-center justify-between text-sm">
              {t("Personal memory", "Bộ nhớ cá nhân")}
              <Switch checked={memoryEnabled} onCheckedChange={setMemoryEnabled} />
            </label>
            <label className="mt-3 flex items-center justify-between text-sm">
              {t("Automatic learning", "Tự động học")}
              <Switch checked={autoMemory} disabled={!memoryEnabled} onCheckedChange={setAutoMemory} />
            </label>
          </div>
          <label className="flex min-h-16 items-center justify-between rounded-xl border border-white/8 bg-white/[.02] px-4 text-sm">
            <span>
              <span className="block font-medium">{t("Active account", "Tài khoản hoạt động")}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {t("Can sign in and use iTis", "Có thể đăng nhập và sử dụng iTis")}
              </span>
            </span>
            <Switch checked={isActive} onCheckedChange={setIsActive} className="data-[state=checked]:bg-primary" />
          </label>
          <label className="grid gap-2 rounded-xl border border-white/8 bg-white/[.02] p-4 text-sm">
            {t("Access deadline (UTC+7)", "Khóa tài khoản lúc (giờ Việt Nam)")}
            <input
              type="datetime-local"
              value={role === "admin" ? "" : accessDeadline}
              onChange={(event) => setAccessDeadline(event.target.value)}
              disabled={role === "admin"}
              className="h-10 min-w-0 rounded-lg border border-white/10 bg-white/[.03] px-3 [color-scheme:dark] disabled:opacity-40"
            />
            <span className="text-xs text-muted-foreground">
              {role === "admin"
                ? t("Administrator access has no deadline.", "Tài khoản quản trị không đặt hạn.")
                : t("Clear the date to remove the deadline. Existing sessions lose access at expiry.", "Xóa ngày giờ để bỏ hạn. Đến hạn, phiên đang đăng nhập cũng mất quyền truy cập.")}
            </span>
          </label>
          <div className="min-w-0 rounded-xl border border-white/8 bg-white/[.02] p-4">
            <p className="text-sm font-medium">{t("Account security", "Bảo mật tài khoản")}</p>
            <label className="mt-3 flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block">{t("Allow multiple sign-in sessions", "Cho phép nhiều phiên đăng nhập")}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{allowMultipleSessions?t("Keep sessions on different browsers and devices.","Giữ các phiên trên nhiều trình duyệt và thiết bị."):t("New sign-ins revoke the previous session. Saving keeps the newest session (your current session when editing yourself).","Đăng nhập mới sẽ thu hồi phiên cũ. Khi lưu, giữ phiên mới nhất; nếu chỉnh chính mình thì giữ phiên hiện tại.")}</span>
              </span>
              <Switch aria-label={t("Allow multiple sign-in sessions", "Cho phép nhiều phiên đăng nhập")} checked={allowMultipleSessions} onCheckedChange={setAllowMultipleSessions} className="shrink-0 data-[state=checked]:bg-primary"/>
            </label>
            <AdminResetPassword userId={member.id} vi={locale === "vi"}/>
          </div>
        </div>
        <div className="border-t border-white/8 bg-[#0d1416]/95 pt-4 backdrop-blur">
          {error && <div className="mb-3 text-sm text-red-300">{error}</div>}
          <button
            onClick={save}
            disabled={saving}
            className="ml-auto flex min-w-48 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground disabled:opacity-50"
          >
            {saving && <LoaderCircle className="size-4 animate-spin" />}
                                          {saving ? t("Saving…", "Đang lưu…") : t("Save changes", "Lưu thay đổi")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({
  member,
  currentUserId,
  reload,
}: {
  member: Member;
  currentUserId: string;
  reload: () => Promise<void>;
}) {
  const { t, numberLocale } = useLanguage();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const isCurrentAccount = member.id === currentUserId;

  function reset() {
    setConfirmation("");
    setDeleting(false);
    setError("");
  }

  async function removeAccount() {
    if (confirmation.trim().toLowerCase() !== member.email.toLowerCase()) return;
    setDeleting(true);
    setError("");
    const response = await fetch(`/api/admin/users/${member.id}`, {
      method: "DELETE",
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(data.error || t("Unable to delete this account.", "Không thể xóa tài khoản này."));
      setDeleting(false);
      return;
    }
    setOpen(false);
    reset();
    await reload();
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <AlertDialogTrigger
        disabled={isCurrentAccount}
        title={isCurrentAccount
          ? t("You cannot delete your current account.", "Không thể xóa tài khoản đang đăng nhập.")
          : t("Delete account", "Xóa tài khoản")}
        className="inline-flex size-8 items-center justify-center rounded-lg border border-red-400/20 text-red-300 transition hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-25"
      >
        <Trash2 className="size-3.5" />
      </AlertDialogTrigger>
      <AlertDialogContent className="border-red-400/20 bg-[#0d1416]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-red-200">
            {t(`Permanently delete ${member.name}?`, `Xóa vĩnh viễn ${member.name}?`)}
          </AlertDialogTitle>
          <AlertDialogDescription className="leading-6">
            {t(
              "This cannot be undone. iTis will remove the account and recalculate admin totals without this user's activity.",
              "Không thể hoàn tác. iTis sẽ xóa tài khoản và tính lại tổng số admin mà không gồm hoạt động của người dùng này.",
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-xl border border-red-400/15 bg-red-400/[.045] p-4 text-sm">
          <div className="font-medium text-red-200">
            {t("Data that will be deleted", "Dữ liệu sẽ bị xóa")}
          </div>
          <ul className="mt-2 grid gap-1.5 text-xs text-muted-foreground">
            <li>• {t("All chats, messages and attached files", "Toàn bộ chat, tin nhắn và file đính kèm")}</li>
            <li>• {t("Personal memories, sessions and profile/avatar", "Bộ nhớ cá nhân, phiên đăng nhập và hồ sơ/avatar")}</li>
            <li>• {t("Generated images and image files", "Lịch sử cùng file ảnh đã tạo")}</li>
            <li>• {t(
              `${member.usedTokens.toLocaleString(numberLocale)} recorded tokens`,
              `${member.usedTokens.toLocaleString(numberLocale)} token đã ghi nhận`,
            )}</li>
          </ul>
        </div>
        <label className="grid gap-2 text-sm">
          {t("Enter the account email to confirm", "Nhập email tài khoản để xác nhận")}
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={member.email}
            autoComplete="off"
            className="h-11 rounded-xl border border-white/10 bg-white/[.03] px-3 outline-none focus:border-red-400/50"
          />
        </label>
        {error && (
          <div className="rounded-lg border border-red-400/20 bg-red-400/[.06] px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>
            {t("Cancel", "Hủy")}
          </AlertDialogCancel>
          <button
            type="button"
            onClick={() => void removeAccount()}
            disabled={deleting || confirmation.trim().toLowerCase() !== member.email.toLowerCase()}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-red-500 px-4 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {deleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {deleting ? t("Deleting…", "Đang xóa…") : t("Delete permanently", "Xóa vĩnh viễn")}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CreateUserDialog({
  reload,
  defaults,
}: {
  reload: () => Promise<void>;
  defaults: Settings;
}) {
  const { t } = useLanguage();
  const [emailNotice,setEmailNotice] = useState("");
  const [busy,setBusy]=useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [imageAccess, setImageAccess] = useState(false);
  const [allowMultipleSessions,setAllowMultipleSessions]=useState(true);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [role, setRole] = useState<Member["role"]>("standard");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if(busy)return;
    setBusy(true);
    setError("");
    const plan = defaults.roleLimits[role];
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        password,
        role,
        allowMultipleSessions,
        aiProvider: defaults.aiEnvironment.provider,
        imageProvider: imageAccess
          ? (defaults.aiEnvironment.provider === "local" ? "comfyui" : "openai")
          : "disabled",
        tokenLimit: plan.cycleTokens,
        unlimited: plan.cycleUnlimited,
        totalTokenLimit: plan.totalTokens,
        totalUnlimited: plan.totalUnlimited,
        resetWindowHours: defaults.tokenReset.windowHours,
      }),
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error || t("Unable to create account.", "Không thể tạo tài khoản."));
      setBusy(false);
      return;
    }
    const created = (await response.json()) as { user: { id: string };emailStatus:string };
    if (avatarFile) {
      const form = new FormData();
      form.set("avatar", avatarFile);
      await fetch(`/api/admin/users/${created.user.id}/avatar`, {
        method: "POST",
        body: form,
      });
    }
    setEmailNotice(t(`Account created · Email: ${created.emailStatus}. See Notifications for delivery status.`,`Đã tạo tài khoản · Email: ${created.emailStatus}. Xem kết quả trong Thông báo.`));
    setBusy(false);
    setOpen(false);
    setName("");
    setEmail("");
    setPassword("");
    setAvatarFile(null);
    setImageAccess(false);
    setAllowMultipleSessions(true);
    await reload();
  }
  return (
    <div className="flex flex-col items-end gap-2">{emailNotice && <p role="status" className="max-w-sm text-right text-xs text-primary">{emailNotice}</p>}<Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
        <Plus className="size-4" />
        {t("Create account", "Tạo tài khoản")}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto border-white/10 bg-[#0d1416]">
        <DialogHeader>
          <DialogTitle>{t("Create iTis account", "Tạo tài khoản iTis")}</DialogTitle>
          <DialogDescription>
            {t("New accounts automatically use the backend selected by the system switch.", "Tài khoản mới tự động dùng backend đang chọn ở công tắc tổng.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-2">
          <label className="grid gap-2 text-sm">
            {t("Display name", "Tên hiển thị")}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="h-10 rounded-lg border border-white/10 bg-white/[.03] px-3"
            />
          </label>
          <label className="grid gap-2 text-sm">
            Email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              required
              className="h-10 rounded-lg border border-white/10 bg-white/[.03] px-3"
            />
          </label>
          <label className="grid gap-2 text-sm">
            {t("Initial password", "Mật khẩu ban đầu")}
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              minLength={12}
              required
              className="h-10 rounded-lg border border-white/10 bg-white/[.03] px-3"
            />
          </label>
          <label className="grid gap-2 text-sm">
            {t("Avatar (optional)", "Ảnh đại diện (không bắt buộc)")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(event) =>
                setAvatarFile(event.target.files?.[0] ?? null)
              }
              className="file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground h-10 rounded-lg border border-white/10 bg-white/[.03] px-2 py-1 text-xs text-muted-foreground"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-2 text-sm">
              {t("Role", "Vai trò")}
              <Select
                value={role}
                onValueChange={(value) => setRole(value as Member["role"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">{t("Standard", "Thường")}</SelectItem>
                  <SelectItem value="plus">Plus</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <div className="grid gap-2 text-sm">
              <span>{t("AI provider", "Luồng AI")}</span>
              <div className="flex h-10 items-center rounded-lg border border-white/10 bg-white/[.03] px-3 text-muted-foreground">
                {t("System", "Theo hệ thống")} ·{" "}
                {defaults.aiEnvironment.provider === "local"
                  ? "Local"
                  : "OpenAI"}
              </div>
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[.025] p-3">
            <input type="checkbox" checked={allowMultipleSessions} onChange={event=>setAllowMultipleSessions(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary"/>
            <span className="grid gap-1 text-sm"><span className="font-medium">{t("Allow multiple sign-in sessions","Cho phép nhiều phiên đăng nhập")}</span><span className="text-xs text-muted-foreground">{t("Turn off to allow one session; a new sign-in ends the previous session.","Tắt để chỉ cho một phiên; đăng nhập mới sẽ đăng xuất phiên cũ.")}</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[.025] p-3">
            <input
              type="checkbox"
              checked={imageAccess}
              onChange={(event) => setImageAccess(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="grid gap-1 text-sm">
              <span className="font-medium">{t("Allow Image Studio access", "Cho phép truy cập Studio ảnh")}</span>
              <span className="text-xs text-muted-foreground">{t("When disabled, this account cannot see or use Image Studio.", "Khi tắt, tài khoản không thấy menu và không sử dụng được Studio ảnh.")}</span>
            </span>
          </label>
          {error && <div className="text-sm text-red-300">{error}</div>}
          <button disabled={busy} className="rounded-xl bg-primary px-4 py-2.5 font-semibold text-primary-foreground">
            {t("Create account", "Tạo tài khoản")}
          </button>
        </form>
      </DialogContent>
    </Dialog></div>
  );
}

function formatRelative(value: string, locale: AppLocale) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return locale === "vi" ? "Vừa xong" : "Just now";
  if (minutes < 60) return locale === "vi" ? `${minutes} phút` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return locale === "vi" ? `${hours} giờ` : `${hours} hr`;
  return new Date(value).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatMessageTime(value: string, locale: AppLocale) {
  return new Date(value).toLocaleTimeString(locale === "vi" ? "vi-VN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMessageDateTime(value: string, locale: AppLocale) {
  return new Date(value).toLocaleString(locale === "vi" ? "vi-VN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(-2)
    .join("")
    .toUpperCase();
}

function shortModelLabel(model?: string | null) {
  if (!model) return undefined;
  if (model === "gpt-6.1-sol") return "GPT-6.1 Sol";
  if (model === "gpt-6-luna") return "GPT-6 Luna";
  if (model.includes("deepseek")) return "DeepSeek Coder · Local";
  if (model.includes("qwen")) return "Qwen 3.5 9B · Local";
  if (model.includes("sunburst")) return "GPT Image 2.5 Sunburst";
  if (model.includes("flare")) return "GPT Image 2.5 Flare";
  if (model.includes("comfy")) return "ComfyUI · Local";
  return model;
}

function UploadLimitsEditor({value,onSaved}:{value:UploadLimits;onSaved:(limits:UploadLimits)=>void}){
 const {t}=useLanguage();const [editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[draft,setDraft]=useState(value),[notice,setNotice]=useState("");
 const shown=editing?draft:value;
 async function save(){
  if(!validUploadLimits(draft)){setNotice(t("Use 1–50 MB, a combined limit at least as large as one file, and 1–10 files.","Nhập 1–50 MB, tổng dung lượng không nhỏ hơn mỗi tệp, và 1–10 tệp."));return;}
  setSaving(true);setNotice("");
  try{const response=await fetch("/api/admin/settings",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({uploadLimits:draft})});const data=await response.json() as {error?:string;settings?:Settings};if(!response.ok||!data.settings)throw new Error(data.error||t("Unable to save limits.","Không lưu được giới hạn."));onSaved(data.settings.uploadLimits);setEditing(false);setNotice(t("Upload limits saved.","Đã lưu giới hạn tải lên."));}catch(error){setNotice(error instanceof Error?error.message:t("Connection failed.","Mất kết nối."));}finally{setSaving(false);}
 }
 return <section className="mt-4 rounded-3xl border border-white/8 bg-card p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{t("File upload limits","Giới hạn tệp tải lên")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("Admin-managed limits for Chat and remembered documents.","Admin quản lý giới hạn tài liệu trong Chat và Bộ nhớ cá nhân.")}</p></div><div className="flex gap-2">{editing?<><button type="button" disabled={saving} onClick={()=>{setEditing(false);setNotice("");}} className="rounded-lg px-3 py-2 text-xs">{t("Cancel","Hủy")}</button><button type="button" aria-label={t("Save upload limits","Lưu giới hạn tệp")} disabled={saving} onClick={()=>void save()} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">{saving?<LoaderCircle className="size-3.5 animate-spin"/>:<Check className="size-3.5"/>}{t("Save","Lưu")}</button></>:<button type="button" aria-label={t("Edit upload limits","Chỉnh sửa giới hạn tệp")} onClick={()=>{setDraft(value);setEditing(true);setNotice("");}} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"><Pencil className="size-3.5"/>{t("Edit","Chỉnh sửa")}</button>}</div></div><div className="mt-5 grid gap-4 md:grid-cols-3">{([['maxFileMb',t('Maximum per file (MB)','Tối đa mỗi tệp (MB)'),50],['maxTotalMb',t('Combined per upload (MB)','Tổng mỗi lượt (MB)'),50],['maxFiles',t('Files per upload','Số tệp mỗi lượt'),10]] as const).map(([key,label,max])=><label key={key} className="grid gap-2 text-sm">{label}<input type="number" min={1} max={max} step={1} value={shown[key]} readOnly={!editing||saving} onChange={event=>setDraft(current=>({...current,[key]:Number(event.target.value)}))} className="h-11 min-w-0 rounded-xl border bg-white/[.03] px-3 font-mono read-only:text-muted-foreground"/></label>)}</div><p className="mt-3 text-xs leading-5 text-muted-foreground">{t("Up to 50 MB per file and per upload. Account storage quotas and document-reading limits also apply.","Tối đa 50 MB/tệp và 50 MB/lượt. Vẫn áp dụng dung lượng tài khoản và giới hạn đọc tài liệu.")}</p>{notice&&<p role="status" className="mt-3 text-sm text-primary">{notice}</p>}</section>;
}
