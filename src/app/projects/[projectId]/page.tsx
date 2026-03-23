"use client";

import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  HiArrowDown,
  HiArrowLeft,
  HiArrowPath,
  HiChevronDown,
  HiChevronRight,
  HiCommandLine,
  HiCodeBracket,
  HiEye,
  HiFolderOpen,
  HiOutlineArrowTopRightOnSquare,
  HiSparkles,
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

type WorkspaceTab = "preview" | "files";

type RunMode = "build" | "plan";

type WorkspaceFile = {
  path: string;
  isDir: boolean;
  language: string;
  content?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "analyzing" | "streaming" | "completed" | "failed";
};

type FileNode = {
  name: string;
  path: string;
  isDir: boolean;
  children: FileNode[];
};

type ActivityEntryKind = "reasoning" | "tool" | "preview" | "status";

type LiveActivityEntry = {
  id: string;
  text: string;
  kind: ActivityEntryKind;
  timestamp: number;
};

const ACTIVITY_FEED_MAX = 30;
const PROJECT_UI_CACHE_VERSION = 1;
const PROJECT_UI_CACHE_TTL_MS = 1000 * 60 * 60 * 24;

const FILE_WRITE_VERBS = ["write", "edit", "create", "update", "overwrite", "patch", "save"];

function truncateText(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
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
  const [projectName, setProjectName] = useState("");
  const [isProjectNameLoading, setIsProjectNameLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewNonce, setPreviewNonce] = useState(0);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isMessagesLoading, setIsMessagesLoading] = useState(true);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [activity, setActivity] = useState("Ready");
  const [isRunning, setIsRunning] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [isWorkspaceReady, setIsWorkspaceReady] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [runMode, setRunMode] = useState<RunMode>("build");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [queuedPrompt, setQueuedPrompt] = useState("");
  const [initialMessageIds, setInitialMessageIds] = useState<{
    userId: string;
    assistantId: string;
  } | null>(null);
  const [isFileContentLoading, setIsFileContentLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    src: true,
  });
  const [liveActivity, setLiveActivity] = useState<LiveActivityEntry[]>([]);
  const activityFeedRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTermInstance | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalCursorRef = useRef(0);
  const initialPromptRan = useRef(false);
  const router = useRouter();

  const selectedFile = useMemo(() => files.find((file) => file.path === selectedFilePath), [files, selectedFilePath]);
  const fileTree = useMemo(() => buildFileTree(files), [files]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((current) => ({
      ...current,
      [path]: !current[path],
    }));
  }, []);

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
        xtermRef.current.writeln(title);
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

    setFiles(mapped);

    const currentSelected = mapped.find((file) => !file.isDir && file.path === selectedFilePath);
    if (!currentSelected) {
      const firstFile = mapped.find((file) => !file.isDir);
      if (firstFile) {
        setSelectedFilePath(firstFile.path);
      }
    }
  }, [projectId, selectedFilePath]);

  const loadFileContent = useCallback(
    async (path: string) => {
      if (!projectId) {
        return;
      }

      const cache = readCache(projectId);
      const cached = cache[path];

      if (cached) {
        setFiles((current) =>
          current.map((file) =>
            file.path === path ? { ...file, content: cached.content } : file,
          ),
        );
      } else {
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
        setIsFileContentLoading(false);
      }
    },
    [projectId],
  );

  const pushActivityEntry = useCallback((text: string, kind: ActivityEntryKind) => {
    setLiveActivity((current) => {
      const entry: LiveActivityEntry = {
        id: randomId(),
        text,
        kind,
        timestamp: Date.now(),
      };
      const next = [...current, entry];
      return next.length > ACTIVITY_FEED_MAX ? next.slice(-ACTIVITY_FEED_MAX) : next;
    });
  }, []);

  const clearActivityFeed = useCallback(() => {
    setLiveActivity([]);
  }, []);

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

  const runPrompt = useCallback(async (
    prompt: string,
    options?: {
      existingMessageIds?: {
        userId: string;
        assistantId: string;
      };
    },
  ) => {
    const trimmedPrompt = prompt.trim();

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

    setIsRunning(true);
    setActivity("Analyzing...");

    const existingMessageIds = options?.existingMessageIds;
    const tempUserMessageId = existingMessageIds ? existingMessageIds.userId : `temp-user-${randomId()}`;
    const tempAssistantMessageId = existingMessageIds
      ? existingMessageIds.assistantId
      : `temp-assistant-${randomId()}`;
    let assistantMessageId = tempAssistantMessageId;

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
        { id: tempUserMessageId, role: "user", content: trimmedPrompt, status: "completed" },
        { id: tempAssistantMessageId, role: "assistant", content: "", status: "analyzing" },
      ]);
    }

    try {
      let shouldForcePreviewReload = false;

      const response = await fetch(`/api/projects/${projectId}/runs/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          userMessageId: existingMessageIds?.userId,
          assistantMessageId: existingMessageIds?.assistantId,
          mode: runMode,
        }),
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
                pushActivityEntry(payload.message, "preview");
                pushTerminalLog(payload.message);
              }
              continue;
            }

            if (eventName === "preview.ready") {
              if (typeof payload.previewUrl === "string" && payload.previewUrl.length > 0) {
                setPreviewUrlWithRoute(payload.previewUrl);
              }
              setActivity("Preview ready");
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
            continue;
          }

          if (eventName === "run.reasoning") {
            setActivity("Thinking...");
            if (typeof payload.text === "string" && payload.text.trim().length > 0) {
              pushActivityEntry(`Thinking: ${truncateText(payload.text.trim(), 120)}`, "reasoning");
            } else {
              pushActivityEntry("Thinking…", "reasoning");
            }
            continue;
          }

          if (eventName === "run.tool") {
            if (typeof payload.name === "string") {
              setActivity(`Tool: ${payload.name}`);
              const toolSummary = parseToolActivity(payload.name, payload.input);
              pushActivityEntry(toolSummary, "tool");
              pushTerminalLog(`[tool] ${toolSummary}`);

              if (!shouldForcePreviewReload && toolEventRequiresPreviewReload(payload.name, payload.input)) {
                shouldForcePreviewReload = true;
                pushTerminalLog("[preview] Detected dependency/config changes, preview will refresh after run.");
              }
            }
            upsertFileFromToolInput(payload.input);
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
              clearActivityFeed();
              if (runMode === "build" && shouldForcePreviewReload && previewUrl) {
                setPreviewNonce((value) => value + 1);
                pushTerminalLog("[preview] Reloaded after dependency/config updates.");
                setActivity("Run finished. Refreshing preview...");
              } else {
                setActivity(runMode === "plan" ? "Plan finished" : "Run finished");
              }
              continue;
            }

          if (eventName === "run.failed") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      status: "failed",
                    }
                  : message,
              ),
            );
            clearActivityFeed();
            setActivity("Run failed");
            if (typeof payload.error === "string" && payload.error.length > 0) {
              pushTerminalLog(`[error] ${payload.error}`);
            }
          }
        }

        await loadFiles();
      }

      await loadMessages({ silent: true });
    } catch (error) {
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
      clearActivityFeed();
      setActivity(error instanceof Error ? error.message : "Run failed");
      pushTerminalLog(error instanceof Error ? `[error] ${error.message}` : "[error] Run failed");
    } finally {
      setIsRunning(false);
      setInitialMessageIds(null);
      setActiveRunId(null);
    }
  }, [appendAssistantText, applyProjectName, clearActivityFeed, isWorkspaceReady, loadFiles, loadMessages, previewUrl, projectId, pushActivityEntry, pushTerminalLog, resetTerminalLogs, runMode, setPreviewUrlWithRoute, upsertFileFromToolInput]);

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
      setMessages([
        {
          id: initialUserMessageId,
          role: "user",
          content: initialPrompt,
          status: "completed",
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

    void runPrompt(queuedPrompt, {
      existingMessageIds: initialMessageIds ?? undefined,
    });
  }, [initialMessageIds, isOpening, isRunning, isWorkspaceReady, queuedPrompt, runPrompt]);

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
  }, [loadMessages, messages.length, projectId]);

  useEffect(() => {
    if (!selectedFile || selectedFile.isDir || typeof selectedFile.content === "string") {
      return;
    }

    void loadFileContent(selectedFile.path).catch((error: unknown) => {
      setActivity(error instanceof Error ? error.message : "Failed to load file");
    });
  }, [loadFileContent, selectedFile]);

  useEffect(() => {
    if (activityFeedRef.current) {
      activityFeedRef.current.scrollTop = activityFeedRef.current.scrollHeight;
    }
  }, [liveActivity]);

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
        disableStdin: true,
        fontFamily: "var(--font-geist-mono)",
        fontSize: 12,
        lineHeight: 1.35,
        theme: {
          background: "#0b0d10",
          foreground: "#d6d8df",
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalContainerRef.current);
      fitAddon.fit();
      term.writeln("VibeIt terminal ready");

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;
    })();

    const onResize = () => {
      fitAddonRef.current?.fit();
    };

    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
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
      xtermRef.current.writeln(line);
    }

    terminalCursorRef.current = terminalLogs.length;
  }, [terminalLogs]);

  useEffect(() => {
    if (!isTerminalOpen) {
      return;
    }

    fitAddonRef.current?.fit();
  }, [isTerminalOpen]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen w-full max-w-[1800px] grid-cols-1 gap-3 p-3 lg:grid-cols-[420px_1fr]">
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

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`w-fit max-w-[92%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "ml-auto bg-blue-500/90 text-white"
                      : "border border-border/70 bg-background/70"
                  }`}
                >
                  {message.role === "assistant" ? (
                    message.content ? (
                      <div className="prose prose-sm prose-invert max-w-none break-words prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-headings:mb-2 prose-headings:mt-3 prose-pre:my-2 prose-pre:rounded-lg prose-pre:bg-neutral-900 prose-pre:p-3 prose-code:rounded prose-code:bg-neutral-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[13px] prose-code:before:content-none prose-code:after:content-none">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
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
                    ) : (
                      "Analyzing..."
                    )
                  ) : (
                    <div className="prose prose-sm prose-invert max-w-none break-words text-white prose-p:my-1.5 prose-p:text-white prose-ul:my-1.5 prose-ul:text-white prose-ol:my-1.5 prose-ol:text-white prose-li:my-0.5 prose-li:text-white prose-li:marker:text-white prose-headings:mb-2 prose-headings:mt-3 prose-headings:text-white prose-strong:text-white prose-pre:my-2 prose-pre:rounded-lg prose-pre:bg-blue-900/40 prose-pre:p-3 prose-code:rounded prose-code:bg-blue-900/30 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[13px] prose-code:text-white prose-code:before:content-none prose-code:after:content-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
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
                  )}
                </div>
              ))}
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

            {isRunning && liveActivity.length > 0 ? (
              <div className="rounded-xl border border-border/50 bg-background/40 p-2.5">
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/70">
                  <span className="inline-block size-1.5 animate-pulse rounded-full bg-blue-400/80" />
                  AI Activity
                </div>
                <div
                  ref={activityFeedRef}
                  className="max-h-36 space-y-0.5 overflow-y-auto"
                >
                  {liveActivity.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-baseline gap-1.5 py-px font-mono text-[11px] leading-snug text-muted-foreground/80"
                    >
                      <span className="shrink-0 select-none text-[10px] text-muted-foreground/40">
                        {entry.kind === "reasoning" ? "💭" : entry.kind === "tool" ? "🔧" : entry.kind === "preview" ? "👁" : "•"}
                      </span>
                      <span className="min-w-0 truncate">{entry.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">{activity}</p>
          </div>

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
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Describe what you want to build..."
              className="min-h-28 w-full resize-none bg-transparent pr-12 text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setRunMode((current) => (current === "build" ? "plan" : "build"))}
                aria-label={runMode === "build" ? "Switch to plan mode" : "Switch to build mode"}
              >
                {runMode === "build" ? "Build" : "Plan"}
              </Button>
              <Button
                size="sm"
                type="button"
                disabled={isRunning || isClosing || !chatInput.trim()}
                onClick={() => void runPrompt(chatInput)}
              >
                Send
              </Button>
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
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={isTerminalOpen ? "secondary" : "ghost"}
                size="sm"
                type="button"
                aria-label="Toggle terminal"
                onClick={() => setIsTerminalOpen((value) => !value)}
              >
                <HiCommandLine className="size-4" />
                Terminal
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label="Refresh preview"
                onClick={() => setPreviewNonce((value) => value + 1)}
              >
                <HiArrowPath className="size-4" />
              </Button>
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
            </div>
          </header>

           <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
              <div className={cn("relative h-full overflow-hidden bg-background", activeTab === "preview" ? "block" : "hidden")}>
                {previewUrl ? (
                  <iframe
                    src={`${previewUrl}${previewUrl.includes("?") ? "&" : "?"}v=${previewNonce}`}
                    title="Project preview"
                    className="h-full w-full"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
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
                    language={selectedFile?.language ?? "typescript"}
                    value={selectedFile?.content ?? ""}
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
            </div>

            {isTerminalOpen ? (
              <div className="h-[38%] min-h-[180px] max-h-[420px] border-t border-border/70 p-3">
                <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <HiCommandLine className="size-4" />
                    <span>Runtime Output</span>
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
                      onClick={() => setIsTerminalOpen(false)}
                    >
                      <HiXMark className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="h-[calc(100%-1.75rem)] overflow-hidden rounded-lg border border-border/70 bg-[#0b0d10] p-2">
                  <div ref={terminalContainerRef} className="h-full w-full" />
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
