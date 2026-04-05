"use client";

import Editor from "@monaco-editor/react";
import { useLogger } from "@logtail/next/hooks";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { AgentStatusLoader } from "@/components/ui/agent-status-loader";
import type { AgentPhase } from "@/components/ui/agent-status-loader";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  HiCheck,
  HiArrowDown,
  HiArrowLeft,
  HiArrowPath,
  HiChevronDown,
  HiChevronRight,
  HiCog6Tooth,
  HiCommandLine,
  HiCodeBracket,
  HiEye,
  HiEyeSlash,
  HiFolderOpen,
  HiOutlineArrowTopRightOnSquare,
  HiPlus,
  HiSparkles,
  HiPaperAirplane,
  HiPaperClip,
  HiStop,
  HiTrash,
  HiXMark,
} from "react-icons/hi2";
import {
  VscFolder,
  VscFolderOpened,
  VscJson,
  VscMarkdown,
  VscFile,
} from "react-icons/vsc";
import {
  SiTypescript,
  SiJavascript,
  SiCss3,
  SiHtml5,
} from "react-icons/si";
import type { Terminal as XTermInstance } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

type WorkspaceTab = "preview" | "files" | "settings";

type SettingsSection = "environment";

type RunMode = "build" | "plan";

type WorkspaceFile = {
  path: string;
  isDir: boolean;
  language: string;
  content?: string;
};

type MessageAttachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  publicUrl: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "analyzing" | "streaming" | "completed" | "failed";
  attachments?: MessageAttachment[];
};

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  uploading: boolean;
  uploadedId?: string;
  publicUrl?: string;
};

type FileNode = {
  name: string;
  path: string;
  isDir: boolean;
  children: FileNode[];
};

type ProjectEnvVar = {
  id: string;
  key: string;
  value: string;
};

type ActiveMention = {
  start: number;
  end: number;
  query: string;
};

const PROJECT_UI_CACHE_VERSION = 1;
const PROJECT_UI_CACHE_TTL_MS = 1000 * 60 * 60 * 24;

const FILE_WRITE_VERBS = ["write", "edit", "create", "update", "overwrite", "patch", "save"];
const FILE_TREE_POLL_INTERVAL_MS = 3000;
const FILE_CONTENT_POLL_INTERVAL_MS = 2500;
const TERMINAL_DEFAULT_HEIGHT = 360;
const TERMINAL_MIN_HEIGHT = 180;
const TERMINAL_AUTO_CLOSE_HEIGHT = 120;

function getTerminalMaxHeight() {
  if (typeof window === "undefined") {
    return 520;
  }

  return Math.max(320, Math.min(560, Math.floor(window.innerHeight * 0.68)));
}

function clampTerminalHeight(height: number) {
  return Math.min(getTerminalMaxHeight(), Math.max(TERMINAL_MIN_HEIGHT, height));
}

function clampTerminalDisplayHeight(height: number) {
  return Math.min(getTerminalMaxHeight(), Math.max(0, height));
}

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  brightGreen: "\x1b[92m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",
} as const;

function colorizeTerminalLine(raw: string): string {
  if (raw.startsWith("[error]")) {
    return `${ANSI.red}${ANSI.bold}✗${ANSI.reset} ${ANSI.red}${raw.slice(7).trim()}${ANSI.reset}`;
  }
  if (raw.startsWith("[tool]")) {
    return `${ANSI.cyan}⚡${ANSI.reset} ${ANSI.brightCyan}${raw.slice(6).trim()}${ANSI.reset}`;
  }
  if (raw.startsWith("[preview]")) {
    return `${ANSI.magenta}◉${ANSI.reset} ${ANSI.magenta}${raw.slice(9).trim()}${ANSI.reset}`;
  }
  if (raw.startsWith("Synced")) {
    return `${ANSI.green}✓${ANSI.reset} ${ANSI.green}${raw}${ANSI.reset}`;
  }
  if (raw.startsWith("Run ") && raw.includes("started")) {
    return `${ANSI.bold}${ANSI.brightGreen}▶ ${raw}${ANSI.reset}`;
  }
  if (raw.toLowerCase().includes("installing") || raw.toLowerCase().includes("resolving")) {
    return `${ANSI.yellow}⏳${ANSI.reset} ${ANSI.yellow}${raw}${ANSI.reset}`;
  }
  if (raw.toLowerCase().includes("ready") || raw.toLowerCase().includes("complete")) {
    return `${ANSI.green}✓${ANSI.reset} ${ANSI.green}${raw}${ANSI.reset}`;
  }
  if (raw.toLowerCase().includes("building") || raw.toLowerCase().includes("compiling") || raw.toLowerCase().includes("starting")) {
    return `${ANSI.blue}⟳${ANSI.reset} ${ANSI.blue}${raw}${ANSI.reset}`;
  }
  return `${ANSI.gray}│${ANSI.reset} ${raw}`;
}

function parseToolActivity(toolName: string, input: unknown): string {
  const inputObj = (input && typeof input === "object") ? input as Record<string, unknown> : null;
  const filePath = inputObj && typeof inputObj.path === "string" ? inputObj.path : null;

  const isFileWrite = FILE_WRITE_VERBS.some((verb) => toolName.toLowerCase().includes(verb));

  if (isFileWrite && filePath) {
    return `Updated ${filePath}`;
  }

  if (filePath) {
    return `${toolName} → ${filePath}`;
  }

  return `Tool: ${toolName}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findActiveMention(value: string, caretIndex: number): ActiveMention | null {
  const caret = Math.max(0, Math.min(caretIndex, value.length));
  const beforeCaret = value.slice(0, caret);
  const match = beforeCaret.match(/(^|\s)@([^\s@]*)$/);

  if (!match || match.index === undefined) {
    return null;
  }

  const prefixLength = match[1]?.length ?? 0;
  const mentionStart = match.index + prefixLength;

  return {
    start: mentionStart,
    end: caret,
    query: match[2] ?? "",
  };
}

function scoreFileMention(path: string, query: string) {
  if (!query) {
    const depth = path.split("/").length - 1;

    if (path.startsWith("src/")) {
      return 1000 - depth;
    }

    if (depth > 0) {
      return 800 - depth;
    }

    return 100;
  }

  const haystack = path.toLowerCase();
  const needle = query.toLowerCase();

  if (haystack === needle) {
    return 1000;
  }

  if (haystack.startsWith(needle)) {
    return 800 - haystack.length;
  }

  const fileName = haystack.split("/").pop() ?? haystack;
  if (fileName.startsWith(needle)) {
    return 700 - haystack.length;
  }

  if (haystack.includes(needle)) {
    return 600 - haystack.indexOf(needle) - haystack.length * 0.01;
  }

  let score = 0;
  let needleIndex = 0;

  for (let index = 0; index < haystack.length && needleIndex < needle.length; index += 1) {
    if (haystack[index] === needle[needleIndex]) {
      score += haystack[index - 1] === "/" ? 6 : 3;
      needleIndex += 1;
    }
  }

  return needleIndex === needle.length ? score - haystack.length * 0.01 : Number.NEGATIVE_INFINITY;
}

function extractMentionedFilePaths(value: string, allowedPaths: Set<string>) {
  const matches = value.match(/(^|\s)@([^\s@]+)/g) ?? [];
  const seen = new Set<string>();
  const mentionedPaths: string[] = [];

  for (const rawMatch of matches) {
    const normalized = rawMatch.trim().replace(/^@/, "");
    if (!allowedPaths.has(normalized) || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    mentionedPaths.push(normalized);
  }

  return mentionedPaths;
}

function removeMentionFromPrompt(value: string, path: string) {
  const escaped = escapeRegExp(path);
  const withoutMention = value.replace(new RegExp(`(^|\\s)@${escaped}(?=\\s|$)`, "g"), (match, leadingWhitespace: string) => leadingWhitespace || "");
  return withoutMention.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function mergeWorkspaceFiles(currentFiles: WorkspaceFile[], incomingFiles: WorkspaceFile[]) {
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file]));
  let changed = currentFiles.length !== incomingFiles.length;

  const nextFiles = incomingFiles.map((incoming) => {
    const existing = currentByPath.get(incoming.path);

    if (!existing) {
      changed = true;
      return incoming;
    }

    const nextContent = incoming.content ?? existing.content;
    const sameFile =
      existing.isDir === incoming.isDir &&
      existing.language === incoming.language &&
      existing.content === nextContent;

    if (sameFile) {
      return existing;
    }

    changed = true;
    return {
      ...existing,
      isDir: incoming.isDir,
      language: incoming.language,
      content: nextContent,
    };
  });

  return changed ? nextFiles : currentFiles;
}

function deriveToolPhase(toolName: string, input: unknown): AgentPhase {
  const name = toolName.toLowerCase();
  const inputObj = (input && typeof input === "object") ? input as Record<string, unknown> : null;
  const commandCandidates = [inputObj?.command, inputObj?.cmd, inputObj?.script, inputObj?.text]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();

  if (name.includes("bash") || name.includes("command") || name.includes("shell")) {
    if (["npm install", "npm i", "pnpm install", "pnpm add", "yarn add", "bun install", "bun add"].some((cmd) => commandCandidates.includes(cmd))) {
      return "installing";
    }
  }

  if (FILE_WRITE_VERBS.some((verb) => name.includes(verb))) {
    return "editing";
  }

  return "thinking";
}

function toolEventRequiresPreviewReload(toolName: string, input: unknown) {
  const normalizedToolName = toolName.toLowerCase();
  const inputObj = (input && typeof input === "object") ? input as Record<string, unknown> : null;
  const pathValue = inputObj && typeof inputObj.path === "string" ? inputObj.path.toLowerCase() : "";

  if (["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"].some((name) => pathValue.endsWith(name))) {
    return true;
  }

  const commandCandidates = [inputObj?.command, inputObj?.cmd, inputObj?.script, inputObj?.text]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (!commandCandidates) {
    return false;
  }

  if (!(normalizedToolName.includes("bash") || normalizedToolName.includes("command") || normalizedToolName.includes("shell"))) {
    return false;
  }

  return [
    "npm install",
    "npm i",
    "pnpm install",
    "pnpm add",
    "yarn add",
    "yarn install",
    "bun add",
    "bun install",
  ].some((needle) => commandCandidates.includes(needle));
}

function randomId() {
  return crypto.randomUUID();
}

function createProjectEnvVar(key = "", value = ""): ProjectEnvVar {
  return {
    id: randomId(),
    key,
    value,
  };
}

function toProjectEnvRows(entries: Array<{ key: string; value: string }>) {
  if (entries.length === 0) {
    return [createProjectEnvVar()];
  }

  return entries.map((entry) => createProjectEnvVar(entry.key, entry.value));
}

function getLanguageFromPath(path: string) {
  if (path.endsWith(".tsx") || path.endsWith(".ts")) {
    return "typescript";
  }
  if (path.endsWith(".css")) {
    return "css";
  }
  if (path.endsWith(".json")) {
    return "json";
  }
  if (path.endsWith(".js") || path.endsWith(".jsx")) {
    return "javascript";
  }

  return "plaintext";
}

type CachedFileEntry = {
  content: string;
  updatedAt: number;
};

type FileContentCache = Record<string, CachedFileEntry>;

type ProjectUiCache = {
  version: number;
  updatedAt: number;
  projectName?: string;
  messages?: ChatMessage[];
  runMode?: RunMode;
};

function getCacheKey(projectId: string) {
  return `project_files_cache:${projectId}`;
}

function getProjectUiCacheKey(projectId: string) {
  return `project_ui_cache:${projectId}`;
}

function readCache(projectId: string): FileContentCache {
  try {
    const raw = localStorage.getItem(getCacheKey(projectId));
    if (!raw) return {};
    return JSON.parse(raw) as FileContentCache;
  } catch {
    return {};
  }
}

function writeCacheEntry(projectId: string, path: string, content: string) {
  try {
    const cache = readCache(projectId);
    cache[path] = { content, updatedAt: Date.now() };
    localStorage.setItem(getCacheKey(projectId), JSON.stringify(cache));
  } catch {
    /* localStorage full or unavailable – silently skip */
  }
}

function readProjectUiCache(projectId: string): ProjectUiCache | null {
  try {
    const raw = localStorage.getItem(getProjectUiCacheKey(projectId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as ProjectUiCache;
    if (parsed.version !== PROJECT_UI_CACHE_VERSION) {
      return null;
    }

    if (Date.now() - parsed.updatedAt > PROJECT_UI_CACHE_TTL_MS) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeProjectUiCache(projectId: string, payload: {
  projectName: string;
  messages: ChatMessage[];
  runMode: RunMode;
}) {
  try {
    const data: ProjectUiCache = {
      version: PROJECT_UI_CACHE_VERSION,
      updatedAt: Date.now(),
      projectName: payload.projectName,
      messages: payload.messages,
      runMode: payload.runMode,
    };

    localStorage.setItem(getProjectUiCacheKey(projectId), JSON.stringify(data));
  } catch {
    // ignore cache write errors
  }
}

function getFileIcon(name: string, isDir: boolean, isExpanded: boolean) {
  if (isDir) {
    return isExpanded
      ? <VscFolderOpened className="size-4 shrink-0 text-amber-400/80" />
      : <VscFolder className="size-4 shrink-0 text-amber-400/70" />;
  }

  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
      return <SiTypescript className="size-3.5 shrink-0 text-blue-400" />;
    case ".js":
    case ".jsx":
      return <SiJavascript className="size-3.5 shrink-0 text-yellow-400" />;
    case ".css":
    case ".scss":
      return <SiCss3 className="size-3.5 shrink-0 text-sky-400" />;
    case ".html":
      return <SiHtml5 className="size-3.5 shrink-0 text-orange-400" />;
    case ".json":
      return <VscJson className="size-4 shrink-0 text-yellow-300/80" />;
    case ".md":
    case ".mdx":
      return <VscMarkdown className="size-4 shrink-0 text-blue-300/80" />;
    default:
      return <VscFile className="size-4 shrink-0 text-muted-foreground/70" />;
  }
}

function buildFileTree(entries: WorkspaceFile[]) {
  const root: FileNode = {
    name: "",
    path: "",
    isDir: true,
    children: [],
  };

  for (const entry of entries) {
    const segments = entry.path.split("/").filter(Boolean);
    let current = root;

    segments.forEach((segment, index) => {
      const nextPath = segments.slice(0, index + 1).join("/");
      const isLast = index === segments.length - 1;

      let child = current.children.find((node) => node.name === segment);
      if (!child) {
        child = {
          name: segment,
          path: nextPath,
          isDir: !isLast || entry.isDir,
          children: [],
        };
        current.children.push(child);
      }

      if (isLast) {
        child.isDir = entry.isDir;
      }

      current = child;
    });
  }

  const sortNodes = (nodes: FileNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) {
        return -1;
      }
      if (!a.isDir && b.isDir) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });

    nodes.forEach((node) => {
      if (node.children.length > 0) {
        sortNodes(node.children);
      }
    });
  };

  sortNodes(root.children);
  return root.children;
}

export default function ProjectWorkspacePage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;

  const [activeTab, setActiveTab] = useState<WorkspaceTab>("preview");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("environment");
  const [projectName, setProjectName] = useState("");
  const [isProjectNameLoading, setIsProjectNameLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewNonce, setPreviewNonce] = useState(0);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  pendingAttachmentsRef.current = pendingAttachments;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isMessagesLoading, setIsMessagesLoading] = useState(true);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [activity, setActivity] = useState("Ready");
  const [isRunning, setIsRunning] = useState(false);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>("analyzing");
  const [agentDetail, setAgentDetail] = useState("");
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [isWorkspaceReady, setIsWorkspaceReady] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(() => clampTerminalHeight(TERMINAL_DEFAULT_HEIGHT));
  const [terminalDisplayHeight, setTerminalDisplayHeight] = useState(() => clampTerminalHeight(TERMINAL_DEFAULT_HEIGHT));
  const [isTerminalResizing, setIsTerminalResizing] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>("build");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [queuedPrompt, setQueuedPrompt] = useState("");
  const [initialMessageIds, setInitialMessageIds] = useState<{
    userId: string;
    assistantId: string;
  } | null>(null);
  const [initialAttachmentIds, setInitialAttachmentIds] = useState<string[]>([]);
  const [isFileContentLoading, setIsFileContentLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    src: true,
  });
  const fileReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runAbortControllerRef = useRef<AbortController | null>(null);
  const [envVars, setEnvVars] = useState<ProjectEnvVar[]>([createProjectEnvVar()]);
  const [isEnvVarsLoading, setIsEnvVarsLoading] = useState(true);
  const [isSavingEnvVars, setIsSavingEnvVars] = useState(false);
  const [showEnvValues, setShowEnvValues] = useState(false);
  const [chatCursorIndex, setChatCursorIndex] = useState(0);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const mentionSuggestionsRef = useRef<HTMLDivElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const terminalResizeHandleRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTermInstance | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalCursorRef = useRef(0);
  const terminalHeightFrameRef = useRef<number | null>(null);
  const terminalPendingHeightRef = useRef<number | null>(null);
  const terminalFitFrameRef = useRef<number | null>(null);
  const terminalResizeStateRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    lastHeight: number;
  } | null>(null);
  const initialPromptRan = useRef(false);
  const router = useRouter();
  const log = useLogger({ source: "app/projects/[projectId]/page.tsx" });

  const selectedFile = useMemo(() => files.find((file) => file.path === selectedFilePath), [files, selectedFilePath]);
  const selectedFileContent = useMemo(() => selectedFile?.content ?? "", [selectedFile?.content]);
  const fileTree = useMemo(() => buildFileTree(files), [files]);
  const availableMentionPaths = useMemo(
    () => files.filter((file) => !file.isDir).map((file) => file.path),
    [files],
  );
  const availableMentionPathSet = useMemo(() => new Set(availableMentionPaths), [availableMentionPaths]);
  const mentionedFilePaths = useMemo(
    () => extractMentionedFilePaths(chatInput, availableMentionPathSet),
    [availableMentionPathSet, chatInput],
  );
  const activeMention = useMemo(
    () => findActiveMention(chatInput, chatCursorIndex),
    [chatCursorIndex, chatInput],
  );
  const mentionSuggestions = useMemo(() => {
    if (!activeMention) {
      return [];
    }

    const scored = availableMentionPaths
      .filter((path) => !mentionedFilePaths.includes(path))
      .map((path) => ({ path, score: scoreFileMention(path, activeMention.query) }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

    if (!activeMention.query) {
      const rootFiles = scored.filter((entry) => !entry.path.includes("/"));
      const nestedFiles = scored.filter((entry) => entry.path.includes("/"));
      const mixed: Array<{ path: string; score: number }> = [];

      for (let index = 0; mixed.length < 8 && (index < nestedFiles.length || index < rootFiles.length); index += 1) {
        if (index < nestedFiles.length) {
          mixed.push(nestedFiles[index]!);
        }

        if (mixed.length >= 8) {
          break;
        }

        if (index < rootFiles.length) {
          mixed.push(rootFiles[index]!);
        }
      }

      return mixed;
    }

    return scored.slice(0, 8);
  }, [activeMention, availableMentionPaths, mentionedFilePaths]);
  const configuredEnvVarCount = useMemo(
    () => envVars.filter((entry) => entry.key.trim().length > 0).length,
    [envVars],
  );

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((current) => ({
      ...current,
      [path]: !current[path],
    }));
  }, []);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [activeMention?.query]);

  useEffect(() => {
    if (mentionSuggestions.length === 0) {
      return;
    }

    const activeItem = mentionSuggestionsRef.current?.querySelector<HTMLElement>(
      `[data-mention-index="${activeMentionIndex}"]`,
    );

    activeItem?.scrollIntoView({ block: "nearest" });
  }, [activeMentionIndex, mentionSuggestions]);

  const handleChatInputChange = useCallback((value: string, selectionStart: number | null) => {
    setChatInput(value);
    setChatCursorIndex(selectionStart ?? value.length);
  }, []);

  const applyMentionSuggestion = useCallback((path: string) => {
    const textarea = chatInputRef.current;
    const mention = findActiveMention(chatInput, textarea?.selectionStart ?? chatCursorIndex);

    if (!mention) {
      return;
    }

    const nextValue = `${chatInput.slice(0, mention.start)}@${path} ${chatInput.slice(mention.end)}`;
    const nextCursorIndex = mention.start + path.length + 2;

    setChatInput(nextValue);
    setChatCursorIndex(nextCursorIndex);
    setActiveMentionIndex(0);

    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursorIndex, nextCursorIndex);
    });
  }, [chatCursorIndex, chatInput]);

  const removeMentionedFile = useCallback((path: string) => {
    const nextValue = removeMentionFromPrompt(chatInput, path);
    setChatInput(nextValue);
    setChatCursorIndex(nextValue.length);

    window.requestAnimationFrame(() => {
      chatInputRef.current?.focus();
      chatInputRef.current?.setSelectionRange(nextValue.length, nextValue.length);
    });
  }, [chatInput]);

  const flushTerminalHeightFrame = useCallback(() => {
    if (terminalHeightFrameRef.current !== null) {
      window.cancelAnimationFrame(terminalHeightFrameRef.current);
      terminalHeightFrameRef.current = null;
    }
  }, []);

  const flushTerminalDisplayHeight = useCallback((height: number) => {
    flushTerminalHeightFrame();
    terminalPendingHeightRef.current = null;
    setTerminalDisplayHeight(clampTerminalDisplayHeight(height));
  }, [flushTerminalHeightFrame]);

  const scheduleTerminalDisplayHeight = useCallback((height: number) => {
    terminalPendingHeightRef.current = clampTerminalDisplayHeight(height);

    if (terminalHeightFrameRef.current !== null) {
      return;
    }

    terminalHeightFrameRef.current = window.requestAnimationFrame(() => {
      terminalHeightFrameRef.current = null;

      if (terminalPendingHeightRef.current === null) {
        return;
      }

      setTerminalDisplayHeight(terminalPendingHeightRef.current);
      terminalPendingHeightRef.current = null;
    });
  }, []);

  const scheduleTerminalFit = useCallback(() => {
    if (terminalFitFrameRef.current !== null) {
      return;
    }

    terminalFitFrameRef.current = window.requestAnimationFrame(() => {
      terminalFitFrameRef.current = null;

      const container = terminalContainerRef.current;

      if (!container || container.clientWidth < 8 || container.clientHeight < 8) {
        return;
      }

      fitAddonRef.current?.fit();
    });
  }, []);

  const stopTerminalResize = useCallback(() => {
    const resizeState = terminalResizeStateRef.current;
    const resizeHandle = terminalResizeHandleRef.current;

    if (resizeState && resizeHandle?.hasPointerCapture(resizeState.pointerId)) {
      try {
        resizeHandle.releasePointerCapture(resizeState.pointerId);
      } catch {
        // Pointer capture can already be released when the drag ends naturally.
      }
    }

    terminalResizeStateRef.current = null;
    setIsTerminalResizing(false);
  }, []);

  const openTerminal = useCallback(() => {
    const nextHeight = clampTerminalHeight(terminalHeight);

    setTerminalHeight(nextHeight);
    setIsTerminalOpen(true);
    scheduleTerminalDisplayHeight(nextHeight);
  }, [scheduleTerminalDisplayHeight, terminalHeight]);

  const closeTerminal = useCallback(() => {
    stopTerminalResize();
    setIsTerminalOpen(false);
    flushTerminalDisplayHeight(0);
  }, [flushTerminalDisplayHeight, stopTerminalResize]);

  const toggleTerminal = useCallback(() => {
    if (isTerminalOpen) {
      closeTerminal();
      return;
    }

    openTerminal();
  }, [closeTerminal, isTerminalOpen, openTerminal]);

  const settleTerminalHeight = useCallback((height: number) => {
    if (height <= TERMINAL_AUTO_CLOSE_HEIGHT) {
      closeTerminal();
      return;
    }

    const nextHeight = clampTerminalHeight(height);
    setTerminalHeight(nextHeight);
    flushTerminalDisplayHeight(nextHeight);
  }, [closeTerminal, flushTerminalDisplayHeight]);

  const finishTerminalResize = useCallback((pointerId?: number) => {
    const resizeState = terminalResizeStateRef.current;

    if (!resizeState || (typeof pointerId === "number" && resizeState.pointerId !== pointerId)) {
      return;
    }

    const lastHeight = resizeState.lastHeight;
    stopTerminalResize();
    settleTerminalHeight(lastHeight);
  }, [settleTerminalHeight, stopTerminalResize]);

  const handleTerminalResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isTerminalOpen) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const startHeight = terminalDisplayHeight > 0 ? terminalDisplayHeight : terminalHeight;

    terminalResizeStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight,
      lastHeight: startHeight,
    };
    setIsTerminalResizing(true);
  }, [isTerminalOpen, terminalDisplayHeight, terminalHeight]);

  const handleTerminalResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const resizeState = terminalResizeStateRef.current;

    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }

    const nextHeight = clampTerminalDisplayHeight(resizeState.startHeight + (resizeState.startY - event.clientY));
    resizeState.lastHeight = nextHeight;

    if (nextHeight <= TERMINAL_AUTO_CLOSE_HEIGHT) {
      closeTerminal();
      return;
    }

    scheduleTerminalDisplayHeight(nextHeight);
  }, [closeTerminal, scheduleTerminalDisplayHeight]);

  const handleTerminalResizeEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    finishTerminalResize(event.pointerId);
  }, [finishTerminalResize]);

  const handleTerminalResizeCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    finishTerminalResize(event.pointerId);
  }, [finishTerminalResize]);

  const handleTerminalResizeLostCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    finishTerminalResize(event.pointerId);
  }, [finishTerminalResize]);

  const applyProjectName = useCallback((name: string) => {
    const normalized = name.trim();
    setProjectName(normalized);
    setIsProjectNameLoading(!normalized || normalized === "New Project");
  }, []);

  const loadMessages = useCallback(async (options?: { silent?: boolean }) => {
    if (!projectId) {
      return;
    }

    if (!options?.silent) {
      setIsMessagesLoading(true);
    }

    try {
      const response = await fetch(`/api/projects/${projectId}/messages`, { cache: "no-store" });
      const data = (await response.json()) as {
        messages?: Array<{
          id: string;
          role: "user" | "assistant";
          content: string;
          status: "analyzing" | "streaming" | "completed" | "failed";
          attachments?: MessageAttachment[];
        }>;
        error?: string;
      };

      if (!response.ok || !data.messages) {
        throw new Error(data.error ?? "Failed to load messages");
      }

      setMessages(data.messages);
    } catch (error) {
      setActivity(error instanceof Error ? error.message : "Failed to load messages");
    } finally {
      if (!options?.silent) {
        setIsMessagesLoading(false);
      }
    }
  }, [projectId]);

  const loadEnvVars = useCallback(async () => {
    if (!projectId) {
      return;
    }

    setIsEnvVarsLoading(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/env`, { cache: "no-store" });
      const data = (await response.json()) as {
        envVars?: Array<{ key: string; value: string }>;
        error?: string;
      };

      if (!response.ok || !Array.isArray(data.envVars)) {
        throw new Error(data.error ?? "Failed to load environment variables");
      }

      setEnvVars(toProjectEnvRows(data.envVars));
    } catch (error) {
      setEnvVars([createProjectEnvVar()]);
      setActivity(error instanceof Error ? error.message : "Failed to load environment variables");
    } finally {
      setIsEnvVarsLoading(false);
    }
  }, [projectId]);

  const pushTerminalLog = useCallback((raw: string) => {
    const lines = raw
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);

    if (lines.length === 0) {
      return;
    }

    setTerminalLogs((current) => {
      const next = [...current, ...lines];
      return next.slice(-120);
    });
  }, []);

  const resetTerminalLogs = useCallback((title?: string) => {
    setTerminalLogs([]);
    terminalCursorRef.current = 0;
    if (xtermRef.current) {
      xtermRef.current.clear();
      if (title) {
        xtermRef.current.writeln(colorizeTerminalLine(title));
      }
    }
  }, []);

  const replaceProjectUrlParams = useCallback(
    (updater: (params: URLSearchParams) => void) => {
      if (!projectId) {
        return;
      }

      const params = new URLSearchParams(window.location.search);
      updater(params);
      const query = params.toString();
      const nextUrl = query.length > 0 ? `/projects/${projectId}?${query}` : `/projects/${projectId}`;
      window.history.replaceState(null, "", nextUrl);
    },
    [projectId],
  );

  const setPreviewUrlWithRoute = useCallback(
    (url: string) => {
      setPreviewUrl(url);
      replaceProjectUrlParams((params) => {
        if (url) {
          params.set("preview", url);
        } else {
          params.delete("preview");
        }
      });
    },
    [replaceProjectUrlParams],
  );

  useEffect(() => {
    if (!projectId) {
      return;
    }

    const cached = readProjectUiCache(projectId);
    if (!cached) {
      return;
    }

    if (cached.projectName) {
      applyProjectName(cached.projectName);
    }

    if (cached.messages && cached.messages.length > 0) {
      setMessages(cached.messages);
      setIsMessagesLoading(false);
    }

    if (cached.runMode) {
      setRunMode(cached.runMode);
    }
  }, [applyProjectName, projectId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    writeProjectUiCache(projectId, {
      projectName,
      messages,
      runMode,
    });
  }, [messages, projectId, projectName, runMode]);

  const selectedFilePathRef = useRef(selectedFilePath);
  selectedFilePathRef.current = selectedFilePath;

  const loadFiles = useCallback(async () => {
    if (!projectId) {
      return;
    }

    const response = await fetch(`/api/projects/${projectId}/files`, { cache: "no-store" });
    const data = (await response.json()) as {
      entries?: Array<{ path: string; isDir: boolean }>;
      error?: string;
    };

    if (!response.ok || !data.entries) {
      throw new Error(data.error ?? "Failed to load files");
    }

    const mapped = data.entries
      .map((entry) => ({
        path: entry.path,
        isDir: entry.isDir,
        language: getLanguageFromPath(entry.path),
      }))
      .sort((a, b) => {
        if (a.isDir && !b.isDir) {
          return -1;
        }
        if (!a.isDir && b.isDir) {
          return 1;
        }
        return a.path.localeCompare(b.path);
      });

    setFiles((currentFiles) => mergeWorkspaceFiles(currentFiles, mapped));

    const currentPath = selectedFilePathRef.current;
    if (!currentPath || !mapped.some((file) => !file.isDir && file.path === currentPath)) {
      const firstFile = mapped.find((file) => !file.isDir);
      if (firstFile) {
        setSelectedFilePath(firstFile.path);
      }
    }
  }, [projectId]);

  const loadFileContent = useCallback(
    async (path: string, options?: { force?: boolean; silent?: boolean }) => {
      if (!projectId) {
        return;
      }

      const cache = readCache(projectId);
      const cached = cache[path];

      if (cached && !options?.force) {
        setFiles((current) =>
          current.map((file) =>
            file.path === path ? { ...file, content: cached.content } : file,
          ),
        );
      } else if (!options?.silent) {
        setIsFileContentLoading(true);
      }

      try {
        const response = await fetch(
          `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
          { cache: "no-store" },
        );

        const data = (await response.json()) as {
          content?: string;
          error?: string;
        };

        if (!response.ok || typeof data.content !== "string") {
          throw new Error(data.error ?? "Failed to load file content");
        }

        if (!cached || cached.content !== data.content) {
          setFiles((current) =>
            current.map((file) =>
              file.path === path ? { ...file, content: data.content } : file,
            ),
          );
        }

        writeCacheEntry(projectId, path, data.content);
      } finally {
        if (!options?.silent) {
          setIsFileContentLoading(false);
        }
      }
    },
    [projectId],
  );



  const appendAssistantText = useCallback((messageId: string, text: string) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              content: `${message.content}${text}`,
              status: "streaming",
            }
          : message,
      ),
    );
  }, []);

  const upsertFileFromToolInput = useCallback((input: unknown) => {
    if (!input || typeof input !== "object") {
      return;
    }

    const typedInput = input as Record<string, unknown>;
    const pathValue = typedInput.path;
    const contentValue = typedInput.content;

    if (typeof pathValue !== "string") {
      return;
    }

    if (typeof contentValue !== "string") {
      return;
    }

    if (projectId) {
      writeCacheEntry(projectId, pathValue, contentValue);
    }

    setFiles((currentFiles) => {
      const existing = currentFiles.find((file) => file.path === pathValue);
      if (existing) {
        return currentFiles.map((file) =>
          file.path === pathValue
            ? {
                ...file,
                content: contentValue,
              }
            : file,
        );
      }

      return [
        ...currentFiles,
        {
          path: pathValue,
          isDir: false,
          language: getLanguageFromPath(pathValue),
          content: contentValue,
        },
      ];
    });
  }, [projectId]);

  const updateEnvVar = useCallback((id: string, field: "key" | "value", value: string) => {
    setEnvVars((current) =>
      current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              [field]: value,
            }
          : entry,
      ),
    );
  }, []);

  const addEnvVarRow = useCallback(() => {
    setEnvVars((current) => [...current, createProjectEnvVar()]);
  }, []);

  const removeEnvVarRow = useCallback((id: string) => {
    setEnvVars((current) => {
      const next = current.filter((entry) => entry.id !== id);
      return next.length > 0 ? next : [createProjectEnvVar()];
    });
  }, []);

  const handleSaveEnvVars = useCallback(async () => {
    if (!projectId) {
      return;
    }

    setIsSavingEnvVars(true);
    setActivity("Saving environment variables...");

    try {
      const response = await fetch(`/api/projects/${projectId}/env`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          envVars: envVars.map((entry) => ({
            key: entry.key,
            value: entry.value,
          })),
        }),
      });

      const data = (await response.json()) as {
        envVars?: Array<{ key: string; value: string }>;
        previewRestarted?: boolean;
        previewUrl?: string | null;
        restartError?: string | null;
        error?: string;
      };

      if (!response.ok || !Array.isArray(data.envVars)) {
        throw new Error(data.error ?? "Failed to save environment variables");
      }

      setEnvVars(toProjectEnvRows(data.envVars));

      if (typeof data.previewUrl === "string" && data.previewUrl.length > 0) {
        setPreviewUrlWithRoute(data.previewUrl);
      }

      if (data.previewRestarted) {
        setPreviewNonce((value) => value + 1);
        setActivity("Environment variables saved and preview restarted");
        pushTerminalLog("[preview] Restarted preview to apply environment variable changes.");
        return;
      }

      if (typeof data.restartError === "string" && data.restartError.length > 0) {
        setActivity("Environment variables saved, but preview restart failed");
        pushTerminalLog(`[error] ${data.restartError}`);
        return;
      }

      setActivity("Environment variables saved");
      pushTerminalLog("[preview] Environment variables saved. They will apply on the next preview start.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save environment variables";
      setActivity(message);
      pushTerminalLog(`[error] ${message}`);
    } finally {
      setIsSavingEnvVars(false);
    }
  }, [envVars, projectId, pushTerminalLog, setPreviewUrlWithRoute]);

  const handleAttachFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;

    const newAttachments: PendingAttachment[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;

      const isImage = file.type.startsWith("image/");
      if (!isImage) continue;

      if (file.size > 5 * 1024 * 1024) continue; // 5MB limit

      newAttachments.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        uploading: false,
      });
    }

    setPendingAttachments((current) => [...current, ...newAttachments].slice(0, 30));

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const removeAttachment = useCallback((attachmentId: string) => {
    setPendingAttachments((current) => {
      const removed = current.find((a) => a.id === attachmentId);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return current.filter((a) => a.id !== attachmentId);
    });
  }, []);

  const uploadPendingAttachments = useCallback(async (attachments: PendingAttachment[]): Promise<string[]> => {
    if (attachments.length === 0 || !projectId) return [];

    const uploadedIds: string[] = [];

    for (const attachment of attachments) {
      if (attachment.uploadedId) {
        uploadedIds.push(attachment.uploadedId);
        continue;
      }

      setPendingAttachments((current) =>
        current.map((a) => (a.id === attachment.id ? { ...a, uploading: true } : a)),
      );

      const formData = new FormData();
      formData.append("file", attachment.file);

      const response = await fetch(`/api/projects/${projectId}/attachments/upload`, {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as {
        attachmentId?: string;
        publicUrl?: string;
        error?: string;
      };

      if (!response.ok || !data.attachmentId) {
        throw new Error(data.error ?? `Failed to upload ${attachment.file.name}`);
      }

      uploadedIds.push(data.attachmentId);

      setPendingAttachments((current) =>
        current.map((a) =>
          a.id === attachment.id
            ? { ...a, uploading: false, uploadedId: data.attachmentId, publicUrl: data.publicUrl }
            : a,
        ),
      );
    }

    return uploadedIds;
  }, [projectId]);

  const runPrompt = useCallback(async (
    prompt: string,
    options?: {
      existingMessageIds?: {
        userId: string;
        assistantId: string;
      };
      preUploadedAttachmentIds?: string[];
    },
  ) => {
    const trimmedPrompt = prompt.trim();
    const resolvedMentionedFilePaths = extractMentionedFilePaths(trimmedPrompt, availableMentionPathSet);

    if (!projectId || !trimmedPrompt) {
      return;
    }

    if (!isWorkspaceReady) {
      setQueuedPrompt(trimmedPrompt);
      setActivity("Preparing workspace before generation...");
      return;
    }

    setQueuedPrompt("");
    setChatInput("");
    setChatCursorIndex(0);

    setIsRunning(true);
    setActivity("Analyzing...");
    setAgentPhase("analyzing");
    setAgentDetail("");

    const existingMessageIds = options?.existingMessageIds;
    const tempUserMessageId = existingMessageIds ? existingMessageIds.userId : `temp-user-${randomId()}`;
    const tempAssistantMessageId = existingMessageIds
      ? existingMessageIds.assistantId
      : `temp-assistant-${randomId()}`;
    let assistantMessageId = tempAssistantMessageId;

    // Snapshot current attachments from ref (avoids stale closure in useCallback)
    const currentAttachments = [...pendingAttachmentsRef.current];
    const inlineAttachments: MessageAttachment[] = currentAttachments
      .filter((a) => a.previewUrl)
      .map((a) => ({
        id: a.id,
        filename: a.file.name,
        contentType: a.file.type,
        sizeBytes: a.file.size,
        publicUrl: a.publicUrl ?? a.previewUrl,
      }));

    if (existingMessageIds) {
      setMessages((current) =>
        current.map((message) =>
          message.id === existingMessageIds.assistantId
            ? {
                ...message,
                status: "analyzing",
              }
            : message,
        ),
      );
    } else {
      setMessages((current) => [
        ...current,
        {
          id: tempUserMessageId,
          role: "user",
          content: trimmedPrompt,
          status: "completed",
          attachments: inlineAttachments.length > 0 ? inlineAttachments : undefined,
        },
        { id: tempAssistantMessageId, role: "assistant", content: "", status: "analyzing" },
      ]);
    }

    try {
      let shouldForcePreviewReload = false;

      // Upload pending attachments to R2 before starting the run
      let attachmentIds: string[] = options?.preUploadedAttachmentIds ?? [];
      if (currentAttachments.length > 0) {
        setActivity("Uploading images...");
        const uploaded = await uploadPendingAttachments(currentAttachments);
        attachmentIds = [...attachmentIds, ...uploaded];
        setPendingAttachments([]);
      }

      const abortController = new AbortController();
      runAbortControllerRef.current = abortController;

      const response = await fetch(`/api/projects/${projectId}/runs/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          mentionedFilePaths: resolvedMentionedFilePaths,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
          userMessageId: existingMessageIds?.userId,
          assistantMessageId: existingMessageIds?.assistantId,
          mode: runMode,
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to start streaming run");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const eventMatch = part.match(/^event:\s*(.+)$/m);
          const dataMatch = part.match(/^data:\s*(.+)$/m);

          if (!eventMatch || !dataMatch) {
            continue;
          }

          const eventName = eventMatch[1]?.trim();
          const payload = JSON.parse(dataMatch[1] ?? "{}");

            if (eventName === "run.started") {
              if (typeof payload.runId === "string") {
                setActiveRunId(payload.runId);
                resetTerminalLogs(`Run ${payload.runId} started (${runMode})`);
              }

              if (typeof payload.previewUrl === "string" && payload.previewUrl.length > 0) {
                setPreviewUrlWithRoute(payload.previewUrl);
              }
            if (typeof payload.projectName === "string" && payload.projectName.length > 0) {
              applyProjectName(payload.projectName);
            }

            if (payload.userMessage && typeof payload.userMessage.id === "string") {
              setMessages((current) =>
                current.map((message) =>
                  message.id === tempUserMessageId
                    ? {
                        id: payload.userMessage.id,
                        role: "user",
                        content:
                          typeof payload.userMessage.content === "string"
                            ? payload.userMessage.content
                            : trimmedPrompt,
                        status: "completed",
                        attachments: message.attachments,
                      }
                    : message,
                ),
              );
            }

            if (payload.assistantMessage && typeof payload.assistantMessage.id === "string") {
              assistantMessageId = payload.assistantMessage.id;
              setMessages((current) =>
                current.map((message) =>
                  message.id === tempAssistantMessageId
                    ? {
                        id: payload.assistantMessage.id,
                        role: "assistant",
                        content:
                          typeof payload.assistantMessage.content === "string"
                            ? payload.assistantMessage.content
                            : "",
                        status: "analyzing",
                      }
                    : message,
                ),
              );
            }

              setActivity("Run started");
              continue;
            }

            if (eventName === "preview.status") {
              if (typeof payload.message === "string" && payload.message.length > 0) {
                setActivity(payload.message);
                pushTerminalLog(payload.message);
              }
              continue;
            }

            if (eventName === "preview.ready") {
              if (typeof payload.previewUrl === "string" && payload.previewUrl.length > 0) {
                setPreviewUrlWithRoute(payload.previewUrl);
              }
              setAgentPhase("idle");
              setAgentDetail("");
              continue;
            }

          if (eventName === "project.renamed") {
            if (typeof payload.name === "string" && payload.name.length > 0) {
              applyProjectName(payload.name);
              setActivity(`Project renamed to ${payload.name}`);
            }
            continue;
          }

          if (eventName === "run.text") {
            if (typeof payload.text === "string") {
              appendAssistantText(assistantMessageId, payload.text);
            }
            setActivity("Generating...");
            setAgentPhase("generating");
            continue;
          }

          if (eventName === "run.reasoning") {
            setActivity("Thinking...");
            setAgentPhase("thinking");
            setAgentDetail("");
            continue;
          }

          if (eventName === "run.tool") {
            if (typeof payload.name === "string") {
              setActivity(`Tool: ${payload.name}`);
              setAgentPhase(deriveToolPhase(payload.name, payload.input));
              const toolSummary = parseToolActivity(payload.name, payload.input);
              setAgentDetail(toolSummary);
              pushTerminalLog(`[tool] ${toolSummary}`);

              if (!shouldForcePreviewReload && toolEventRequiresPreviewReload(payload.name, payload.input)) {
                shouldForcePreviewReload = true;
                pushTerminalLog("[preview] Detected dependency/config changes, preview will refresh after run.");
              }
            }
            upsertFileFromToolInput(payload.input);

            // Debounce file tree reload on tool events (don't block stream)
            if (fileReloadTimerRef.current) {
              clearTimeout(fileReloadTimerRef.current);
            }
            fileReloadTimerRef.current = setTimeout(() => {
              void loadFiles().catch(() => undefined);
            }, 800);

            continue;
          }

          if (eventName === "files.synced") {
            if (typeof payload.fileCount === "number") {
              pushTerminalLog(`Synced ${payload.fileCount} files to R2`);
            }
            continue;
          }

            if (eventName === "run.finished") {
            if (typeof payload.output === "string") {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessageId
                    ? {
                        ...message,
                        content: payload.output,
                        status: "completed",
                      }
                    : message,
                ),
              );
            }
              setAgentDetail("");
              setAgentPhase("idle");
              if (runMode === "build" && shouldForcePreviewReload && previewUrl) {
                setPreviewNonce((value) => value + 1);
                pushTerminalLog("[preview] Reloaded after dependency/config updates.");
                setActivity("Run finished. Refreshing preview...");
              } else {
                setActivity(runMode === "plan" ? "Plan finished" : "Run finished");
              }
              continue;
            }

          if (eventName === "run.cancelled") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: typeof payload.output === "string" && payload.output.length > 0
                        ? payload.output
                        : message.content || "Generation was stopped.",
                      status: "completed",
                    }
                  : message,
              ),
            );
            setAgentDetail("");
            setAgentPhase("idle");
            setActivity("Run stopped");
            pushTerminalLog("[info] Run cancelled by user");
            continue;
          }

          if (eventName === "run.failed") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content:
                        typeof payload.output === "string" && payload.output.length > 0
                          ? payload.output
                          : message.content,
                      status: "failed",
                    }
                  : message,
              ),
            );
            setAgentDetail("");
            setAgentPhase("idle");
            setActivity("Run failed");
            if (typeof payload.error === "string" && payload.error.length > 0) {
              pushTerminalLog(`[error] ${payload.error}`);
            }
          }
        }
      }

      // Reload files once after streaming completes
      if (fileReloadTimerRef.current) {
        clearTimeout(fileReloadTimerRef.current);
        fileReloadTimerRef.current = null;
      }
      await loadFiles();
      await loadMessages({ silent: true });
    } catch (error) {
      const isCancelled = error instanceof DOMException && error.name === "AbortError";

      if (isCancelled) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId || message.id === tempAssistantMessageId
              ? {
                  ...message,
                  status: "completed",
                }
              : message,
          ),
        );
        setAgentDetail("");
        setAgentPhase("idle");
        setActivity("Run stopped");
      } else {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId || message.id === tempAssistantMessageId
              ? {
                  ...message,
                  status: "failed",
                }
              : message,
          ),
        );
        setAgentDetail("");
        setActivity(error instanceof Error ? error.message : "Run failed");
        pushTerminalLog(error instanceof Error ? `[error] ${error.message}` : "[error] Run failed");
      }
    } finally {
      runAbortControllerRef.current = null;
      if (fileReloadTimerRef.current) {
        clearTimeout(fileReloadTimerRef.current);
        fileReloadTimerRef.current = null;
      }
      setIsRunning(false);
      setInitialMessageIds(null);
      setActiveRunId(null);
    }
  }, [appendAssistantText, applyProjectName, availableMentionPathSet, isWorkspaceReady, loadFiles, loadMessages, previewUrl, projectId, pushTerminalLog, resetTerminalLogs, runMode, setPreviewUrlWithRoute, uploadPendingAttachments, upsertFileFromToolInput]);

  const cancelRun = useCallback(async () => {
    // Abort the client-side SSE reader
    runAbortControllerRef.current?.abort();

    // Tell the server to cancel the Upstash Box agent run
    try {
      await fetch(`/api/projects/${projectId}/runs/cancel`, {
        method: "POST",
      });
    } catch {
      // Best effort — the abort above already stops client-side processing
    }
  }, [projectId]);

  const handleEnhancePrompt = async () => {
    const prompt = chatInput.trim();
    if (!prompt) {
      return;
    }

    setIsEnhancing(true);

    try {
      const response = await fetch("/api/prompts/enhance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });

      const data = (await response.json()) as { enhancedPrompt?: string; error?: string };

      if (!response.ok || !data.enhancedPrompt) {
        throw new Error(data.error ?? "Failed to enhance prompt");
      }

      setChatInput(data.enhancedPrompt);
    } catch (error) {
      setActivity(error instanceof Error ? error.message : "Enhance failed");
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleBackToDashboard = async () => {
    if (!projectId || isClosing) {
      return;
    }

    setIsClosing(true);
    setActivity("Closing project and syncing files...");

    try {
      const response = await fetch(`/api/projects/${projectId}/close`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to close project");
      }

      router.push("/");
    } catch (error) {
      log.error("Manual project close failed", {
        projectId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      setActivity(error instanceof Error ? error.message : "Unable to close project");
      setIsClosing(false);
    }
  };

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const preview = query.get("preview") ?? "";
    const initialName = query.get("name") ?? "";
    const initialPrompt = query.get("prompt") ?? "";
    const initialUserMessageId = query.get("umid") ?? "";
    const initialAssistantMessageId = query.get("amid") ?? "";
    const autoStart = query.get("autostart") === "1";
    const attachmentIdsParam = query.get("attachments") ?? "";

    if (initialName) {
      applyProjectName(initialName);
    }

    if (
      initialPrompt &&
      initialUserMessageId &&
      initialAssistantMessageId &&
      autoStart &&
      !initialPromptRan.current
    ) {
      initialPromptRan.current = true;
      setQueuedPrompt(initialPrompt);
      setInitialMessageIds({
        userId: initialUserMessageId,
        assistantId: initialAssistantMessageId,
      });
      if (attachmentIdsParam) {
        setInitialAttachmentIds(attachmentIdsParam.split(",").filter(Boolean));
      }

      // Read attachment metadata from sessionStorage (set by landing page)
      let initialAttachments: MessageAttachment[] | undefined;
      if (projectId) {
        try {
          const stored = sessionStorage.getItem(`vibeit:attachments:${projectId}`);
          if (stored) {
            initialAttachments = JSON.parse(stored) as MessageAttachment[];
            sessionStorage.removeItem(`vibeit:attachments:${projectId}`);
          }
        } catch {
          // ignore parse errors
        }
      }

      setMessages([
        {
          id: initialUserMessageId,
          role: "user",
          content: initialPrompt,
          status: "completed",
          attachments: initialAttachments,
        },
        {
          id: initialAssistantMessageId,
          role: "assistant",
          content: "",
          status: "analyzing",
        },
      ]);
      setIsMessagesLoading(false);
    }

    if (autoStart || initialPrompt || initialUserMessageId || initialAssistantMessageId) {
      replaceProjectUrlParams((params) => {
        params.delete("autostart");
        params.delete("prompt");
        params.delete("umid");
        params.delete("amid");
        params.delete("attachments");
      });
    }

    if (preview) {
      setPreviewUrlWithRoute(preview);
      setIsWorkspaceReady(true);
      setActivity("Project ready");
    }

    if (!projectId) {
      return;
    }

    const abortController = new AbortController();

    void (async () => {
      try {
        const stateResponse = await fetch(`/api/projects/${projectId}/state`, {
          cache: "no-store",
          signal: abortController.signal,
        });
        const stateData = (await stateResponse.json()) as {
          projectName?: string;
          previewUrl?: string | null;
          hasActiveSession?: boolean;
          workspaceReady?: boolean;
          error?: string;
        };

        if (!stateResponse.ok) {
          throw new Error(stateData.error ?? "Failed to load project state");
        }

        if (abortController.signal.aborted) {
          return;
        }

        if (typeof stateData.projectName === "string" && stateData.projectName.length > 0) {
          applyProjectName(stateData.projectName);
        }

        if (typeof stateData.previewUrl === "string" && stateData.previewUrl.length > 0) {
          setPreviewUrlWithRoute(stateData.previewUrl);
        }

        if (stateData.workspaceReady) {
          setIsWorkspaceReady(true);
        }

        if (stateData.hasActiveSession) {
          if (stateData.previewUrl) {
            setIsOpening(false);
            setActivity("Project ready");
            return;
          }

          setActivity("Reconnecting workspace...");
        }

        setIsOpening(true);
        setIsWorkspaceReady(false);
        setActivity("Preparing your workspace...");

        const response = await fetch(`/api/projects/${projectId}/open/stream`, {
          method: "POST",
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Failed to open project");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let openReadyReceived = false;

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const eventMatch = part.match(/^event:\s*(.+)$/m);
            const dataMatch = part.match(/^data:\s*(.+)$/m);

            if (!eventMatch || !dataMatch) {
              continue;
            }

            const eventName = eventMatch[1]?.trim();
            const payload = JSON.parse(dataMatch[1] ?? "{}");

            if (eventName === "open.status") {
              if (typeof payload.message === "string" && payload.message.length > 0) {
                setActivity(payload.message);
                pushTerminalLog(payload.message);
              }
              continue;
            }

            if (eventName === "open.log") {
              if (typeof payload.message === "string" && payload.message.length > 0) {
                pushTerminalLog(payload.message);
              }
              continue;
            }

            if (eventName === "project.renamed") {
              if (typeof payload.name === "string" && payload.name.length > 0) {
                applyProjectName(payload.name);
              }
              continue;
            }

            if (eventName === "open.ready") {
              if (typeof payload.projectName === "string" && payload.projectName.length > 0) {
                applyProjectName(payload.projectName);
              }
              if (typeof payload.previewUrl === "string" && payload.previewUrl.length > 0) {
                setPreviewUrlWithRoute(payload.previewUrl);
              }

              setActivity("Workspace ready, generating your project...");
              setIsWorkspaceReady(true);
              setIsOpening(false);
              openReadyReceived = true;
              continue;
            }

            if (eventName === "open.failed") {
              setActivity(
                typeof payload.error === "string" && payload.error.length > 0
                  ? payload.error
                  : "Failed to open project",
              );
              setMessages((current) =>
                current.map((message) =>
                  message.role === "assistant" && message.status === "analyzing"
                    ? {
                        ...message,
                        status: "failed",
                      }
                    : message,
                ),
              );
              setIsWorkspaceReady(false);
              setIsOpening(false);
            }
          }
        }

        if (!openReadyReceived && !abortController.signal.aborted) {
          setIsWorkspaceReady(false);
          setIsOpening(false);
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        setActivity(error instanceof Error ? error.message : "Failed to open project");
        setIsWorkspaceReady(false);
        setIsOpening(false);
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [applyProjectName, projectId, pushTerminalLog, replaceProjectUrlParams, setPreviewUrlWithRoute]);

  useEffect(() => {
    if (!queuedPrompt || !isWorkspaceReady || isOpening || isRunning) {
      return;
    }

    const attachmentIds = initialAttachmentIds.length > 0 ? initialAttachmentIds : undefined;

    void runPrompt(queuedPrompt, {
      existingMessageIds: initialMessageIds ?? undefined,
      preUploadedAttachmentIds: attachmentIds,
    });

    if (attachmentIds) {
      setInitialAttachmentIds([]);
    }
  }, [initialAttachmentIds, initialMessageIds, isOpening, isRunning, isWorkspaceReady, queuedPrompt, runPrompt]);

  useEffect(() => {
    if (!projectId || !isWorkspaceReady) {
      return;
    }

    void loadFiles().catch((error: unknown) => {
      setActivity(error instanceof Error ? error.message : "Failed to load files");
    });
  }, [isWorkspaceReady, loadFiles, projectId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    void loadMessages({ silent: messages.length > 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only load messages on mount/projectId change, not on every messages update
  }, [loadMessages, projectId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    void loadEnvVars();
  }, [loadEnvVars, projectId]);

  useEffect(() => {
    if (!selectedFile || selectedFile.isDir || typeof selectedFile.content === "string") {
      return;
    }

    void loadFileContent(selectedFile.path).catch((error: unknown) => {
      setActivity(error instanceof Error ? error.message : "Failed to load file");
    });
  }, [loadFileContent, selectedFile]);

  useEffect(() => {
    if (!projectId || !isWorkspaceReady || activeTab !== "files") {
      return;
    }

    const interval = window.setInterval(() => {
      void loadFiles().catch(() => undefined);
    }, FILE_TREE_POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [activeTab, isWorkspaceReady, loadFiles, projectId]);

  useEffect(() => {
    if (
      !projectId ||
      !isWorkspaceReady ||
      activeTab !== "files" ||
      !selectedFile ||
      selectedFile.isDir
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadFileContent(selectedFile.path, { force: true, silent: true }).catch(() => undefined);
    }, FILE_CONTENT_POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [activeTab, isWorkspaceReady, loadFileContent, projectId, selectedFile]);



  const scrollChatToBottom = useCallback(() => {
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  const handleChatScroll = useCallback(() => {
    const container = chatScrollRef.current;
    if (!container) {
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollToBottom(distanceFromBottom > 120);
  }, []);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) {
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 120) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!terminalContainerRef.current || xtermRef.current) {
        return;
      }

      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      if (cancelled || !terminalContainerRef.current) {
        return;
      }

      const term = new Terminal({
        convertEol: true,
        cursorBlink: false,
        cursorStyle: "underline",
        disableStdin: true,
        fontFamily: "var(--font-geist-mono), Menlo, Monaco, 'Courier New', monospace",
        fontSize: 12,
        lineHeight: 1.4,
        scrollback: 1000,
        theme: {
          background: "#090a0a",
          foreground: "#c9d1d9",
          cursor: "#58a6ff",
          cursorAccent: "#0b0d10",
          selectionBackground: "#264f78",
          selectionForeground: "#ffffff",
          black: "#484f58",
          red: "#ff7b72",
          green: "#7ee787",
          yellow: "#d29922",
          blue: "#58a6ff",
          magenta: "#bc8cff",
          cyan: "#76e3ea",
          white: "#c9d1d9",
          brightBlack: "#6e7681",
          brightRed: "#ffa198",
          brightGreen: "#aff5b4",
          brightYellow: "#e3b341",
          brightBlue: "#79c0ff",
          brightMagenta: "#d2a8ff",
          brightCyan: "#a5d6ff",
          brightWhite: "#f0f6fc",
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalContainerRef.current);
      fitAddon.fit();
      term.writeln(`${ANSI.bold}${ANSI.brightGreen}⚡ VibeIt Terminal${ANSI.reset} ${ANSI.gray}— ready${ANSI.reset}`);

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;
    })();

    return () => {
      cancelled = true;

      if (terminalFitFrameRef.current !== null) {
        window.cancelAnimationFrame(terminalFitFrameRef.current);
        terminalFitFrameRef.current = null;
      }

      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      terminalCursorRef.current = 0;
    };
  }, []);

  useEffect(() => {
    if (!xtermRef.current) {
      return;
    }

    const newLines = terminalLogs.slice(terminalCursorRef.current);
    if (newLines.length === 0) {
      return;
    }

    for (const line of newLines) {
      xtermRef.current.writeln(colorizeTerminalLine(line));
    }

    terminalCursorRef.current = terminalLogs.length;
  }, [terminalLogs]);

  useEffect(() => {
    const container = terminalContainerRef.current;

    if (!container) {
      return;
    }

    scheduleTerminalFit();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      scheduleTerminalFit();
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [scheduleTerminalFit]);

  useEffect(() => {
    const handleWindowResize = () => {
      const nextMaxHeight = getTerminalMaxHeight();

      setTerminalHeight((current) => Math.min(nextMaxHeight, Math.max(TERMINAL_MIN_HEIGHT, current)));
      setTerminalDisplayHeight((current) => {
        if (!isTerminalOpen) {
          return 0;
        }

        return Math.min(nextMaxHeight, current);
      });
    };

    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [isTerminalOpen]);

  useEffect(() => {
    if (!isTerminalResizing) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isTerminalResizing]);

  useEffect(() => {
    return () => {
      flushTerminalHeightFrame();

      if (terminalFitFrameRef.current !== null) {
        window.cancelAnimationFrame(terminalFitFrameRef.current);
        terminalFitFrameRef.current = null;
      }

      terminalPendingHeightRef.current = null;
      terminalResizeStateRef.current = null;
    };
  }, [flushTerminalHeightFrame]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen w-full max-w-450 grid-cols-1 gap-3 p-3 lg:grid-cols-[420px_1fr]">
        <section className="flex h-[calc(100dvh-1.5rem)] min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/60 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              {isProjectNameLoading ? (
                <div className="h-7 w-40 animate-pulse rounded-md bg-secondary/70" />
              ) : (
                <h1 className="text-xl font-semibold tracking-tight">{projectName}</h1>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleBackToDashboard}
              disabled={isClosing || isOpening || isRunning}
            >
              <HiArrowLeft className="size-4" />
              {isClosing ? "Closing..." : "Back"}
            </Button>
          </div>

          <div className="relative mb-4 flex min-h-0 flex-1 flex-col gap-3">
            <div
              ref={chatScrollRef}
              onScroll={handleChatScroll}
              className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
            >
              {isMessagesLoading ? (
                <div className="space-y-2">
                  <div className="h-12 w-[70%] animate-pulse rounded-2xl bg-secondary/60" />
                  <div className="ml-auto h-12 w-[62%] animate-pulse rounded-2xl bg-blue-500/20" />
                </div>
              ) : messages.length === 0 ? (
                <div className="rounded-xl border border-border/60 bg-background/50 p-3 text-sm text-muted-foreground">
                  Send your first prompt to start generating files.
                </div>
              ) : null}

              {messages.map((message, messageIndex) => {
                const isLastAssistant =
                  message.role === "assistant" &&
                  messageIndex === messages.length - 1;
                const isActivelyStreaming =
                  isLastAssistant &&
                  isRunning &&
                  (message.status === "streaming" || message.status === "analyzing");

                // Hide empty assistant messages from old failed/stuck runs
                if (
                  message.role === "assistant" &&
                  !message.content &&
                  !isLastAssistant
                ) {
                  return null;
                }

                return (
                <div key={message.id} className="flex flex-col gap-2">
                <div
                  className={`w-fit max-w-[92%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "ml-auto bg-blue-500/90 text-white"
                      : "border border-border/70 bg-background/70"
                  }`}
                >
                  {message.role === "assistant" ? (
                    message.content ? (
                      <div className="prose prose-sm prose-invert max-w-none wrap-break-word prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-headings:mb-2 prose-headings:mt-3 prose-pre:my-2 prose-pre:rounded-lg prose-pre:bg-neutral-900 prose-pre:p-3 prose-code:rounded prose-code:bg-neutral-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[13px] prose-code:before:content-none prose-code:after:content-none">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            table: ({ children, ...props }) => (
                              <div className="my-2 w-full overflow-x-auto">
                                <table className="min-w-max border-collapse border border-border/70 text-left text-sm" {...props}>
                                  {children}
                                </table>
                              </div>
                            ),
                            th: ({ children, ...props }) => (
                              <th className="border border-border/70 px-3 py-2 font-semibold whitespace-nowrap" {...props}>
                                {children}
                              </th>
                            ),
                            td: ({ children, ...props }) => (
                              <td className="border border-border/70 px-3 py-2 align-top whitespace-nowrap" {...props}>
                                {children}
                              </td>
                            ),
                            pre: ({ children, ...props }) => (
                              <pre className="overflow-x-auto rounded-lg bg-neutral-900 p-3 text-[13px] leading-relaxed" {...props}>
                                {children}
                              </pre>
                            ),
                            code: ({ children, className, ...props }) => {
                              const isBlock = className?.startsWith("language-");
                              return isBlock ? (
                                <code className={className} {...props}>{children}</code>
                              ) : (
                                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-[13px] text-blue-300" {...props}>
                                  {children}
                                </code>
                              );
                            },
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    ) : isLastAssistant && (isRunning || isOpening || Boolean(queuedPrompt)) ? (
                      <AgentStatusLoader phase={isOpening ? "analyzing" : agentPhase} detail={agentDetail} className="py-0.5 text-sm" />
                    ) : message.status === "failed" ? (
                      <span className="text-sm text-red-400/80">Generation failed.</span>
                    ) : (
                      <span className="text-sm text-muted-foreground/60">Generation stopped.</span>
                    )
                  ) : (
                    <>
                    {message.attachments && message.attachments.length > 0 ? (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {message.attachments.map((attachment) => (
                          <img
                            key={attachment.id}
                            src={attachment.publicUrl}
                            alt={attachment.filename}
                            className="max-h-24 max-w-32 rounded-lg object-cover"
                          />
                        ))}
                      </div>
                    ) : null}
                    <div className="prose prose-sm prose-invert max-w-none wrap-break-word text-white prose-p:my-1.5 prose-p:text-white prose-ul:my-1.5 prose-ul:text-white prose-ol:my-1.5 prose-ol:text-white prose-li:my-0.5 prose-li:text-white prose-li:marker:text-white prose-headings:mb-2 prose-headings:mt-3 prose-headings:text-white prose-strong:text-white prose-pre:my-2 prose-pre:rounded-lg prose-pre:bg-blue-900/40 prose-pre:p-3 prose-code:rounded prose-code:bg-blue-900/30 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[13px] prose-code:text-white prose-code:before:content-none prose-code:after:content-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          table: ({ children, ...props }) => (
                            <div className="my-2 w-full overflow-x-auto">
                              <table className="min-w-max border-collapse border border-white/40 text-left text-sm" {...props}>
                                {children}
                              </table>
                            </div>
                          ),
                          th: ({ children, ...props }) => (
                            <th className="border border-white/40 px-3 py-2 font-semibold whitespace-nowrap" {...props}>
                              {children}
                            </th>
                          ),
                          td: ({ children, ...props }) => (
                            <td className="border border-white/20 px-3 py-2 align-top whitespace-nowrap" {...props}>
                              {children}
                            </td>
                          ),
                          pre: ({ children, ...props }) => (
                            <pre className="overflow-x-auto rounded-lg bg-blue-900/40 p-3 text-[13px] leading-relaxed" {...props}>
                              {children}
                            </pre>
                          ),
                          code: ({ children, className, ...props }) => {
                            const isBlock = className?.startsWith("language-");
                            return isBlock ? (
                              <code className={className} {...props}>{children}</code>
                            ) : (
                              <code className="rounded bg-blue-900/30 px-1.5 py-0.5 text-[13px]" {...props}>
                                {children}
                              </code>
                            );
                          },
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                    </>
                  )}
                </div>
                {isActivelyStreaming && message.content ? (
                  <AgentStatusLoader phase={agentPhase} detail={agentDetail} className="pl-1 text-xs" />
                ) : null}
                </div>
                );
              })}
            </div>

            {showScrollToBottom ? (
              <button
                type="button"
                onClick={scrollChatToBottom}
                className="absolute cursor-pointer bottom-16 left-1/2 z-10 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border/70 bg-card/90 shadow-md transition-opacity hover:bg-card"
                aria-label="Scroll to latest message"
              >
                <HiArrowDown className="size-4 text-muted-foreground" />
              </button>
            ) : null}

            {!isRunning && activity ? (
              <p className="text-xs text-muted-foreground">{activity}</p>
            ) : null}
          </div>

          {pendingAttachments.length > 0 ? (
            <div className="flex flex-wrap gap-2 mb-2">
              {pendingAttachments.map((attachment) => (
                <div key={attachment.id} className="group relative">
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.file.name}
                    className={cn(
                      "size-14 rounded-xl border border-border/40 object-cover",
                      attachment.uploading && "opacity-40",
                    )}
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden rounded-b-xl bg-black/60 px-1 py-0.5 group-hover:block">
                    <span className="block truncate text-[10px] text-white">{attachment.file.name}</span>
                  </div>
                  {attachment.uploading ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.id)}
                      className="absolute -top-1.5 -right-1.5 hidden size-4.5 items-center justify-center rounded-full bg-background/90 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-red-500 hover:text-white group-hover:flex"
                      aria-label={`Remove ${attachment.file.name}`}
                    >
                      <HiXMark className="size-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          <div className="relative space-y-3 rounded-xl border border-border/70 bg-background/60 p-3">
            <Button
              size="icon-sm"
              type="button"
              variant="secondary"
              onClick={handleEnhancePrompt}
              disabled={isEnhancing || isRunning || isOpening || isClosing || !chatInput.trim()}
              className="absolute top-3 right-3"
              aria-label="Enhance prompt"
            >
              <HiSparkles className="size-4" />
            </Button>
            {mentionedFilePaths.length > 0 ? (
              <div className="flex flex-wrap gap-2 pr-12">
                {mentionedFilePaths.map((path) => (
                  <button
                    key={path}
                    type="button"
                    onClick={() => removeMentionedFile(path)}
                    className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-secondary px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-secondary/80"
                    aria-label={`Remove @${path} mention`}
                  >
                    <span className="font-medium text-muted-foreground">@</span>
                    <span className="max-w-52 truncate">{path}</span>
                    <HiXMark className="size-3.5 text-muted-foreground" />
                  </button>
                ))}
              </div>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
              multiple
              className="hidden"
              onChange={(event) => handleAttachFiles(event.target.files)}
            />
            <textarea
              ref={chatInputRef}
              value={chatInput}
              onChange={(event) => handleChatInputChange(event.target.value, event.target.selectionStart)}
              onClick={(event) => setChatCursorIndex(event.currentTarget.selectionStart ?? chatInput.length)}
              onKeyUp={(event) => setChatCursorIndex(event.currentTarget.selectionStart ?? chatInput.length)}
              onPaste={(event) => {
                const items = event.clipboardData.items;
                const imageFiles: File[] = [];
                for (let i = 0; i < items.length; i++) {
                  const item = items[i];
                  if (item && item.type.startsWith("image/")) {
                    const file = item.getAsFile();
                    if (file) imageFiles.push(file);
                  }
                }
                if (imageFiles.length > 0) {
                  const dt = new DataTransfer();
                  for (const file of imageFiles) dt.items.add(file);
                  handleAttachFiles(dt.files);
                }
              }}
              onKeyDown={(event) => {
                if (mentionSuggestions.length > 0) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveMentionIndex((current) => (current + 1) % mentionSuggestions.length);
                    return;
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveMentionIndex((current) => (current - 1 + mentionSuggestions.length) % mentionSuggestions.length);
                    return;
                  }

                  if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    applyMentionSuggestion(mentionSuggestions[activeMentionIndex]?.path ?? mentionSuggestions[0]!.path);
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    const nextCursorIndex = activeMention?.start ?? chatInput.length;
                    setChatCursorIndex(nextCursorIndex);
                    window.requestAnimationFrame(() => {
                      chatInputRef.current?.setSelectionRange(nextCursorIndex, nextCursorIndex);
                    });
                    return;
                  }
                }

                if (event.key === "Backspace" && !chatInput && mentionedFilePaths.length > 0) {
                  event.preventDefault();
                  removeMentionedFile(mentionedFilePaths[mentionedFilePaths.length - 1]!);
                  return;
                }

                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!isRunning && !isClosing && chatInput.trim()) {
                    void runPrompt(chatInput);
                  }
                }
              }}
              placeholder="Describe what you want to build..."
              className="min-h-28 w-full resize-none bg-transparent pr-12 text-sm outline-none placeholder:text-muted-foreground"
            />
            {mentionSuggestions.length > 0 ? (
              <div className="absolute left-3 right-3 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-border/70 bg-card shadow-xl">
                <div className="border-b border-border/60 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Mention Files
                </div>
                <div ref={mentionSuggestionsRef} className="max-h-56 overflow-y-auto py-1">
                  {mentionSuggestions.map((suggestion, index) => (
                    <button
                      key={suggestion.path}
                      data-mention-index={index}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applyMentionSuggestion(suggestion.path);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors",
                        index === activeMentionIndex ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
                    >
                      <span className="truncate font-mono text-xs">{suggestion.path}</span>
                      <span className="shrink-0 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">file</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setRunMode((current) => (current === "build" ? "plan" : "build"))}
                  aria-label={runMode === "build" ? "Switch to plan mode" : "Switch to build mode"}
                >
                  {runMode === "build" ? "Build" : "Plan"}
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="secondary"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isRunning}
                      aria-label="Attach images"
                    >
                      <HiPaperClip className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Attach images</TooltipContent>
                </Tooltip>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  {isRunning ? (
                    <button
                      type="button"
                      onClick={() => void cancelRun()}
                      className="flex size-8 cursor-pointer items-center justify-center rounded-lg bg-red-500/15 text-red-400 transition-all duration-150 hover:bg-red-500/25 hover:text-red-300 active:scale-95"
                      aria-label="Stop generating"
                    >
                      <HiStop className="size-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isClosing || !chatInput.trim()}
                      onClick={() => void runPrompt(chatInput)}
                      className="flex size-8 cursor-pointer items-center justify-center rounded-lg bg-foreground/10 text-muted-foreground transition-all duration-150 hover:bg-foreground/20 hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-30"
                      aria-label="Send message"
                    >
                      <HiPaperAirplane className="size-4" />
                    </button>
                  )}
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isRunning ? "Stop generating" : "Send message"}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </section>

        <section className="flex h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/60">
          <header className="flex items-center justify-between border-b border-border/70 px-3 py-2">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={activeTab === "preview" ? "default" : "secondary"}
                onClick={() => setActiveTab("preview")}
              >
                <HiEye className="size-4" />
                Preview
              </Button>
              <Button
                size="sm"
                variant={activeTab === "files" ? "default" : "secondary"}
                onClick={() => setActiveTab("files")}
              >
                <HiCodeBracket className="size-4" />
                Files
              </Button>
              <Button
                size="sm"
                variant={activeTab === "settings" ? "default" : "secondary"}
                onClick={() => setActiveTab("settings")}
              >
                <HiCog6Tooth className="size-4" />
                Settings
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={isTerminalOpen ? "secondary" : "ghost"}
                size="sm"
                type="button"
                aria-label="Toggle terminal"
                onClick={toggleTerminal}
              >
                <HiCommandLine className="size-4" />
                Terminal
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    aria-label="Refresh preview"
                    onClick={() => setPreviewNonce((value) => value + 1)}
                  >
                    <HiArrowPath className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Refresh preview</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    aria-label="Refresh files"
                    onClick={() => {
                      void loadFiles().catch((error: unknown) => {
                        setActivity(error instanceof Error ? error.message : "Failed to refresh files");
                      });
                    }}
                  >
                    <HiArrowPath className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Refresh files</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    aria-label="Open preview in new tab"
                    asChild
                  >
                    <a href={previewUrl || "#"} target="_blank" rel="noreferrer">
                      <HiOutlineArrowTopRightOnSquare className="size-4" />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Open in new tab</TooltipContent>
              </Tooltip>
            </div>
          </header>

           <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
              <div className={cn("relative h-full overflow-hidden bg-background", activeTab === "preview" ? "block" : "hidden")}>
                {previewUrl ? (
                  <iframe
                    src={`${previewUrl}${previewUrl.includes("?") ? "&" : "?"}v=${previewNonce}`}
                    title="Project preview"
                    className="h-full w-full bg-white"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
                  />
                ) : (
                  <div className="grid h-full place-items-center p-8 text-center">
                    <div className="max-w-md space-y-2 rounded-xl border border-border/70 bg-card/60 p-5">
                      <div className="mx-auto h-4 w-36 animate-pulse rounded bg-secondary/70" />
                      <p className="text-sm font-medium">
                        {runMode === "plan" && isRunning
                          ? "Preview is disabled in Plan mode"
                          : "Preview is starting"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {runMode === "plan" && isRunning
                          ? "Switch to Build mode to generate files and start preview."
                          : "Once the Upstash preview URL is ready, it will appear here automatically."}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className={cn("grid h-full min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[260px_1fr]", activeTab === "files" ? "grid" : "hidden")}>
                <aside className="overflow-y-auto border-b border-border/70 bg-background/50 p-3 lg:border-b-0 lg:border-r">
                  <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                    <HiFolderOpen className="size-4" />
                    Files
                  </div>
                  <div className="space-y-0.5">
                    {fileTree.map((node) => {
                      const renderNode = (currentNode: FileNode, depth: number) => {
                        const isExpanded = expandedFolders[currentNode.path] ?? false;

                        if (currentNode.isDir) {
                          return (
                            <div key={`dir-${currentNode.path}`}>
                              <button
                                type="button"
                                onClick={() => toggleFolder(currentNode.path)}
                                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-secondary/60"
                                style={{ paddingLeft: `${8 + depth * 12}px` }}
                              >
                                {isExpanded ? <HiChevronDown className="size-3 shrink-0" /> : <HiChevronRight className="size-3 shrink-0" />}
                                {getFileIcon(currentNode.name, true, isExpanded)}
                                <span className="truncate">{currentNode.name}</span>
                              </button>
                              {isExpanded
                                ? currentNode.children.map((child) => renderNode(child, depth + 1))
                                : null}
                            </div>
                          );
                        }

                        return (
                          <button
                            key={currentNode.path}
                            type="button"
                            onClick={() => setSelectedFilePath(currentNode.path)}
                            className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs ${
                              selectedFile?.path === currentNode.path
                                ? "bg-secondary text-foreground"
                                : "text-muted-foreground hover:bg-secondary/60"
                            }`}
                            style={{ paddingLeft: `${8 + depth * 12 + 16}px` }}
                          >
                            {getFileIcon(currentNode.name, false, false)}
                            <span className="truncate">{currentNode.name}</span>
                          </button>
                        );
                      };

                      return renderNode(node, 0);
                    })}
                  </div>
                </aside>

                <div className="relative h-full min-h-0 overflow-hidden">
                  {isFileContentLoading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                      <div className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-card/80 px-4 py-2.5">
                        <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-blue-400" />
                        <span className="text-xs text-muted-foreground">Loading file…</span>
                      </div>
                    </div>
                  )}
                  <Editor
                    height="100%"
                    path={selectedFile?.path ?? "__empty__.tsx"}
                    language={selectedFile?.language ?? "typescript"}
                    value={selectedFileContent}
                    theme="vs-dark"
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 13,
                      smoothScrolling: true,
                      automaticLayout: true,
                    }}
                  />
                </div>
              </div>

              <div className={cn("grid h-full min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[260px_1fr]", activeTab === "settings" ? "grid" : "hidden")}>
                <aside className="overflow-y-auto border-b border-border/70 bg-background/50 p-3 lg:border-b-0 lg:border-r">
                  <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                    <HiCog6Tooth className="size-4" />
                    Settings
                  </div>

                  <button
                    type="button"
                    onClick={() => setSettingsSection("environment")}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors",
                      settingsSection === "environment"
                        ? "border-blue-500/50 bg-blue-500/10 text-foreground"
                        : "border-border/60 bg-background/60 text-muted-foreground hover:bg-secondary/60",
                    )}
                  >
                    <div>
                      <div className="text-sm font-medium">Environment</div>
                      <div className="text-xs text-muted-foreground">Secrets and runtime config</div>
                    </div>
                    <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px]">
                      {configuredEnvVarCount}
                    </span>
                  </button>
                </aside>

                <div className="min-h-0 overflow-y-auto p-4">
                  <div className="mx-auto flex max-w-4xl flex-col gap-4">
                    <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/60 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <HiCheck className="size-4 text-emerald-400" />
                            Environment variables
                          </div>
                          <p className="max-w-2xl text-sm text-muted-foreground">
                            Values are stored encrypted, written into the box as `.env.local`, and the preview server is restarted after save.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => setShowEnvValues((value) => !value)}
                          >
                            {showEnvValues ? <HiEyeSlash className="size-4" /> : <HiEye className="size-4" />}
                            {showEnvValues ? "Hide values" : "Show values"}
                          </Button>
                          <Button type="button" size="sm" variant="secondary" onClick={addEnvVarRow}>
                            <HiPlus className="size-4" />
                            Add variable
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={handleSaveEnvVars}
                            disabled={isEnvVarsLoading || isSavingEnvVars}
                          >
                            {isSavingEnvVars ? "Saving..." : "Save env vars"}
                          </Button>
                        </div>
                      </div>

                      <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
                        Use standard keys like `DATABASE_URL`, `OPENAI_API_KEY`, or `NEXT_PUBLIC_API_URL`. Empty rows are ignored.
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                      {isEnvVarsLoading ? (
                        <div className="space-y-3">
                          {[0, 1, 2].map((index) => (
                            <div key={index} className="grid gap-3 rounded-xl border border-border/60 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                              <div className="h-10 animate-pulse rounded-md bg-secondary/60" />
                              <div className="h-10 animate-pulse rounded-md bg-secondary/60" />
                              <div className="h-10 w-10 animate-pulse rounded-md bg-secondary/60" />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {envVars.map((entry, index) => (
                            <div
                              key={entry.id}
                              className="grid gap-3 rounded-xl border border-border/60 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]"
                            >
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Key
                                </label>
                                <Input
                                  value={entry.key}
                                  onChange={(event) => updateEnvVar(entry.id, "key", event.target.value)}
                                  placeholder="DATABASE_URL"
                                  autoCapitalize="off"
                                  autoCorrect="off"
                                  spellCheck={false}
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Value
                                </label>
                                <Input
                                  type={showEnvValues ? "text" : "password"}
                                  value={entry.value}
                                  onChange={(event) => updateEnvVar(entry.id, "value", event.target.value)}
                                  placeholder="Enter secret value"
                                  autoCapitalize="off"
                                  autoCorrect="off"
                                  spellCheck={false}
                                />
                              </div>

                              <div className="flex items-end justify-end">
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  onClick={() => removeEnvVarRow(entry.id)}
                                  aria-label={`Remove environment variable row ${index + 1}`}
                                >
                                  <HiTrash className="size-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{ height: `${terminalDisplayHeight}px` }}
              className={cn(
                "relative shrink-0 overflow-hidden bg-[#090a0a] transition-[height,opacity] duration-200 ease-out",
                isTerminalOpen ? "border-t border-border/70 opacity-100" : "pointer-events-none border-t border-transparent opacity-0",
              )}
            >
              {terminalDisplayHeight > 0 ? (
                <div
                  ref={terminalResizeHandleRef}
                  role="separator"
                  aria-label="Resize terminal"
                  aria-orientation="horizontal"
                  onPointerDown={handleTerminalResizeStart}
                  onPointerMove={handleTerminalResizeMove}
                  onPointerUp={handleTerminalResizeEnd}
                  onPointerCancel={handleTerminalResizeCancel}
                  onLostPointerCapture={handleTerminalResizeLostCapture}
                  className="absolute inset-x-0 top-0 z-10 h-3 cursor-row-resize touch-none"
                >
                  <div
                    className={cn(
                      "mt-1 h-px w-full transition-colors",
                      isTerminalResizing ? "bg-blue-400/80" : "bg-border/70 hover:bg-blue-400/60",
                    )}
                  />
                </div>
              ) : null}
              <div
                className={cn(
                  "flex h-full flex-col p-3 pt-4 transition-opacity duration-150",
                  isTerminalOpen ? "opacity-100" : "opacity-0",
                )}
              >
                  <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <HiCommandLine className="size-4" />
                      <span>Terminal</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground/70">
                        {activeRunId ? `Run ${activeRunId.slice(0, 8)}` : "Read only"}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        type="button"
                        aria-label="Close terminal"
                        onClick={closeTerminal}
                      >
                        <HiXMark className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <div ref={terminalContainerRef} className="min-h-0 flex-1 w-full overflow-hidden" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
