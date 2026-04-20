import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import {
  isSafeHttpUrlForOpener,
  isSafeLocalPathForOpener,
  mergeHttpAndFileLinksForLine,
} from "../core/terminalLinkRanges";
import { activateTerminalLink } from "../core/terminalLinkActivation";
import {
  decidePasteAction,
  summarizePastePayload,
  type PastePayloadSummary,
} from "../core/terminalPasteGuard";
import type { SessionExitedInfo } from "../core/sessionLifecycle";
import { summarizeExitedInfo } from "../core/sessionExitSummary";
import { buildFindOptions, formatFindStatus } from "../core/terminalFindStatus";
import { evaluateTerminalUiIntent } from "../core/terminalUiIntent";
import type { TerminalUiRequest } from "../core/terminalUiRequest";
import type { PtySessionInfo, SessionStatus } from "../core/terminal";
import { MACH_TERMINAL_MONO_FONT } from "../core/terminalUiFont";
import { MachStatusStrip } from "./MachStatusStrip";

const DEFAULT_TERMINAL_FONT_SIZE = 13;
const SCROLLBACK_LINES = 8000;
/** Max composer height as a fraction of the terminal pane height; textarea scrolls internally beyond this. */
const COMPOSER_MAX_HEIGHT_RATIO = 0.3;

// Muted palette for find decorations. `onDidChangeResults` only fires when this bag is
// passed to findNext/findPrevious, so every surface-facing find call spreads it in.
const FIND_DECORATIONS: NonNullable<ISearchOptions["decorations"]> = {
  matchBackground: "#1a3d36",
  matchBorder: "#475569",
  matchOverviewRuler: "#64748b",
  activeMatchBackground: "#f59e0b",
  activeMatchBorder: "#fcd34d",
  activeMatchColorOverviewRuler: "#f59e0b",
};

function isViewportAtBottom(terminal: Terminal): boolean {
  const b = terminal.buffer.active;
  return b.viewportY >= b.baseY;
}

interface PendingPasteState {
  text: string;
  reasons: string[];
  summary: PastePayloadSummary;
}

export const BELL_FLASH_DURATION_MS = 200;

export function canPasteFromContextMenu(activeSession?: Pick<PtySessionInfo, "id">): boolean {
  return Boolean(activeSession?.id);
}

export function evaluatePendingPasteState(
  text: string,
  bypassForSession: boolean,
): PendingPasteState | null {
  const decision = decidePasteAction({ text, bypassForSession });
  if (decision.kind === "send") {
    return null;
  }
  return {
    text,
    reasons: decision.risk.reasons,
    summary: summarizePastePayload(text),
  };
}

export function clampContextMenuPosition(args: {
  x: number;
  y: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  padding?: number;
}): { x: number; y: number } {
  const pad = args.padding ?? 8;
  let left = args.x;
  let top = args.y;
  if (left + args.menuWidth > args.viewportWidth - pad) {
    left = args.viewportWidth - args.menuWidth - pad;
  }
  if (top + args.menuHeight > args.viewportHeight - pad) {
    top = args.viewportHeight - args.menuHeight - pad;
  }
  return {
    x: Math.max(pad, left),
    y: Math.max(pad, top),
  };
}

interface TerminalSurfaceProps {
  activeSession?: PtySessionInfo;
  activeBuffer: string;
  activeStatus: SessionStatus;
  activeMessage?: string;
  /** When set, the session this pane is wired to has exited and the overlay should render. */
  exitedInfo?: SessionExitedInfo | null;
  /**
   * Last-known absolute cwd: `pty-cwd-changed` (OSC 7) when present, else the
   * backend session cwd (spawn seed + updates). Overlay uses this for restart
   * location; `null` only when both are missing.
   */
  liveCwd?: string | null;
  isFocused: boolean;
  /** Persisted profile `font_size`; falls back to 13 when unset. */
  terminalFontSize?: number;
  /** Palette-driven UI intents; only the focused pane consumes a new `seq`. */
  terminalUiRequest?: TerminalUiRequest | null;
  aiInsightSlot?: ReactNode | null;
  aiAssistEnabled?: boolean;
  onComposerDraftChange?: (draft: string) => void;
  onAiExplainComposer?: () => void;
  onAiFixComposer?: () => void;
  onInput: (sessionId: string, data: string) => void;
  onResize: (sessionId: string, cols: number, rows: number) => void;
  onRequestRestartSession?: () => void;
  onRequestCloseSession?: () => void;
}

export function TerminalSurface({
  activeSession,
  activeBuffer,
  activeStatus,
  activeMessage,
  exitedInfo = null,
  liveCwd = null,
  isFocused,
  terminalFontSize = DEFAULT_TERMINAL_FONT_SIZE,
  terminalUiRequest = null,
  aiInsightSlot = null,
  aiAssistEnabled = false,
  onComposerDraftChange,
  onAiExplainComposer,
  onAiFixComposer,
  onInput,
  onResize,
  onRequestRestartSession,
  onRequestCloseSession,
}: TerminalSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const renderedStateRef = useRef<{ sessionId?: string; length: number }>({ length: 0 });
  const activeSessionRef = useRef<PtySessionInfo | undefined>(activeSession);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const pendingWriteRef = useRef("");
  const writeFrameRef = useRef<number | null>(null);
  const lastResizeSentRef = useRef<{ sessionId?: string; cols: number; rows: number }>({
    cols: 0,
    rows: 0,
  });
  const resizeTimerRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<{ sessionId: string; cols: number; rows: number } | null>(null);
  const linkProviderDisposeRef = useRef<{ dispose: () => void } | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const findOpenRef = useRef(false);
  const findQueryRef = useRef("");
  const isFocusedRef = useRef(isFocused);
  const setFindOpenRef = useRef<(open: boolean) => void>(() => {});
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bellAnimTimerRef = useRef<number | null>(null);
  const consumedTerminalUiSeqRef = useRef(0);
  /** When true, new PTY output keeps the viewport pinned to the newest lines. */
  const stickToBottomRef = useRef(true);
  const findCaseSensitiveRef = useRef(false);
  const findWholeWordRef = useRef(false);
  const findRegexRef = useRef(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingPasteRef = useRef<PendingPasteState | null>(null);
  const pasteBypassForSessionRef = useRef(false);
  const pasteConfirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const exitedInfoRef = useRef<SessionExitedInfo | null>(exitedInfo);
  const exitRestartButtonRef = useRef<HTMLButtonElement | null>(null);
  const onRequestRestartSessionRef = useRef(onRequestRestartSession);
  const onRequestCloseSessionRef = useRef(onRequestCloseSession);
  const findResultStateRef = useRef<{ resultIndex: number; resultCount: number }>({
    resultIndex: -1,
    resultCount: 0,
  });

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findWholeWord, setFindWholeWord] = useState(false);
  const [findRegex, setFindRegex] = useState(false);
  const [findResultState, setFindResultState] = useState<{
    resultIndex: number;
    resultCount: number;
  }>({ resultIndex: -1, resultCount: 0 });
  const [pendingPaste, setPendingPaste] = useState<PendingPasteState | null>(null);
  const [pasteBypassForSession, setPasteBypassForSession] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [composerDraft, setComposerDraft] = useState("");
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerFocusedRef = useRef(false);
  const terminalPanelRef = useRef<HTMLElement | null>(null);
  const composerLocked = !activeSession || Boolean(exitedInfo);

  pendingPasteRef.current = pendingPaste;
  pasteBypassForSessionRef.current = pasteBypassForSession;
  exitedInfoRef.current = exitedInfo;
  onRequestRestartSessionRef.current = onRequestRestartSession;
  onRequestCloseSessionRef.current = onRequestCloseSession;

  isFocusedRef.current = isFocused;
  findCaseSensitiveRef.current = findCaseSensitive;
  findWholeWordRef.current = findWholeWord;
  findRegexRef.current = findRegex;
  findOpenRef.current = findOpen;
  findQueryRef.current = findQuery;
  setFindOpenRef.current = setFindOpen;

  const currentFindOptions = useCallback(
    (): ISearchOptions => ({
      ...buildFindOptions({
        caseSensitive: findCaseSensitiveRef.current,
        wholeWord: findWholeWordRef.current,
        regex: findRegexRef.current,
      }),
      decorations: FIND_DECORATIONS,
    }),
    [],
  );

  const closeFind = useCallback(() => {
    findOpenRef.current = false;
    setFindOpen(false);
    searchAddonRef.current?.clearDecorations();
    findResultStateRef.current = { resultIndex: -1, resultCount: 0 };
    setFindResultState({ resultIndex: -1, resultCount: 0 });
  }, []);

  const runFindNext = useCallback(() => {
    const term = findQueryRef.current;
    searchAddonRef.current?.findNext(term, currentFindOptions());
  }, [currentFindOptions]);

  const runFindPrevious = useCallback(() => {
    const term = findQueryRef.current;
    searchAddonRef.current?.findPrevious(term, currentFindOptions());
  }, [currentFindOptions]);

  const sendTextToPty = useCallback((text: string) => {
    const session = activeSessionRef.current;
    if (!text || !session) {
      return;
    }
    onInputRef.current(session.id, text);
  }, []);

  const submitComposer = useCallback(() => {
    const normalized = composerDraft.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!normalized.trim()) {
      return;
    }
    const payload = `${normalized.replace(/\n/g, "\r\n")}\r`;
    sendTextToPty(payload);
    setComposerDraft("");
    queueMicrotask(() => composerTextareaRef.current?.focus());
  }, [composerDraft, sendTextToPty]);

  const syncComposerHeight = useCallback(() => {
    const ta = composerTextareaRef.current;
    if (!ta) {
      return;
    }
    const panel = terminalPanelRef.current;
    const panelH = panel?.getBoundingClientRect().height ?? 0;
    const basis = panelH > 32 ? panelH : window.innerHeight;
    const maxPx = Math.max(72, basis * COMPOSER_MAX_HEIGHT_RATIO);
    ta.style.height = "auto";
    const contentH = ta.scrollHeight;
    const next = Math.min(contentH, maxPx);
    ta.style.height = `${next}px`;
    ta.style.overflowY = contentH > maxPx ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    syncComposerHeight();
  }, [composerDraft, composerLocked, syncComposerHeight]);

  useEffect(() => {
    const panel = terminalPanelRef.current;
    if (!panel) {
      return;
    }
    const ro = new ResizeObserver(() => syncComposerHeight());
    ro.observe(panel);
    window.addEventListener("resize", syncComposerHeight);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncComposerHeight);
    };
  }, [syncComposerHeight]);

  const handleCandidatePasteText = useCallback(
    (text: string) => {
      if (!text || !activeSessionRef.current) {
        return;
      }
      const pending = evaluatePendingPasteState(text, pasteBypassForSessionRef.current);
      if (!pending) {
        sendTextToPty(text);
        setPendingPaste(null);
        return;
      }
      setPendingPaste(pending);
    },
    [sendTextToPty],
  );

  const commitPendingPaste = useCallback(() => {
    const pending = pendingPasteRef.current;
    if (!pending) {
      return;
    }
    sendTextToPty(pending.text);
    if (pasteBypassForSessionRef.current) {
      // Keep the bypass flag; caller opted in via the checkbox before committing.
    }
    setPendingPaste(null);
  }, [sendTextToPty]);

  const cancelPendingPaste = useCallback(() => {
    if (!pendingPasteRef.current) {
      return;
    }
    setPendingPaste(null);
  }, []);

  const requestClipboardPaste = useCallback(() => {
    void navigator.clipboard.readText().then(
      (text) => {
        handleCandidatePasteText(text);
      },
      () => {
        /* clipboard denied — ignore */
      },
    );
  }, [handleCandidatePasteText]);

  const statusLabel = useMemo(() => activeStatus.toUpperCase(), [activeStatus]);
  const sessionInfoTooltip = useMemo(() => {
    const sid = activeSession?.id ?? "none";
    const shell = activeSession?.shell ?? "n/a";
    return `Session: ${sid} · Shell: ${shell} · Status: ${statusLabel}`;
  }, [activeSession?.id, activeSession?.shell, statusLabel]);
  const sessionMessage = useMemo(() => {
    if (activeMessage) {
      return activeMessage;
    }
    if (!activeSession) {
      return "No active terminal session.";
    }
    if (activeStatus === "starting") {
      return "Starting session...";
    }
    if (activeStatus === "error") {
      return "Session hit an error. Restart this session from controls.";
    }
    return "";
  }, [activeMessage, activeSession, activeStatus]);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    onInputRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    if (!findOpen) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [findOpen]);

  useEffect(() => {
    if (isFocused || !findOpen) {
      return;
    }
    closeFind();
  }, [isFocused, findOpen, closeFind]);

  useEffect(() => {
    if (!findOpen) {
      return;
    }
    const addon = searchAddonRef.current;
    if (!addon) {
      return;
    }
    if (findQuery.length === 0) {
      addon.clearDecorations();
      findResultStateRef.current = { resultIndex: -1, resultCount: 0 };
      setFindResultState({ resultIndex: -1, resultCount: 0 });
      return;
    }
    addon.findNext(findQuery, { ...currentFindOptions(), incremental: true });
  }, [findOpen, findQuery, findCaseSensitive, findWholeWord, findRegex, currentFindOptions]);

  useEffect(() => {
    setPendingPaste(null);
    setPasteBypassForSession(false);
    findResultStateRef.current = { resultIndex: -1, resultCount: 0 };
    setFindResultState({ resultIndex: -1, resultCount: 0 });
    setComposerDraft("");
  }, [activeSession?.id]);

  useEffect(() => {
    if (!exitedInfo) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      exitRestartButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [exitedInfo?.timestampMs]);

  useEffect(() => {
    if (!pendingPaste) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      pasteConfirmButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [pendingPaste?.text]);

  useEffect(() => {
    const decision = evaluateTerminalUiIntent({
      request: terminalUiRequest,
      isFocused,
      consumedSeq: consumedTerminalUiSeqRef.current,
      findQuery: findQueryRef.current,
      followOutput: stickToBottomRef.current,
    });
    consumedTerminalUiSeqRef.current = decision.nextConsumedSeq;
    if (!decision.action) {
      return;
    }

    const t = terminalRef.current;
    switch (decision.action.type) {
      case "openFind":
        findOpenRef.current = true;
        setFindOpen(true);
        return;
      case "scrollToBottom":
        if (t) {
          t.scrollToBottom();
          stickToBottomRef.current = true;
        }
        return;
      case "findNext":
        runFindNext();
        return;
      case "findPrevious":
        runFindPrevious();
        return;
      case "clearViewport":
        // Visual-only clear: xterm viewport/scrollback reset without mutating PTY/session buffer state.
        t?.clear();
        return;
      case "setFollowOutput":
        stickToBottomRef.current = decision.action.followOutput;
        if (decision.action.scrollToBottom && t) {
          t.scrollToBottom();
        }
        return;
      case "jumpSearch": {
        const q = decision.action.query;
        const firstLine = q.split(/\r?\n/)[0]?.trim() ?? "";
        if (!firstLine) {
          return;
        }
        findOpenRef.current = true;
        setFindOpen(true);
        setFindQuery(firstLine);
        findQueryRef.current = firstLine;
        stickToBottomRef.current = false;
        queueMicrotask(() => {
          searchAddonRef.current?.clearDecorations();
          runFindNext();
        });
        return;
      }
    }
  }, [terminalUiRequest, isFocused, runFindNext, runFindPrevious]);

  useEffect(() => {
    if (!ctxMenu) {
      return;
    }
    const dismiss = (event: PointerEvent) => {
      const t = event.target as Node;
      if (t instanceof Element && t.closest?.("[data-terminal-context-menu]")) {
        return;
      }
      setCtxMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCtxMenu(null);
      }
    };
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [ctxMenu]);

  useLayoutEffect(() => {
    if (!ctxMenu) {
      return;
    }
    const el = contextMenuRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const next = clampContextMenuPosition({
      x: ctxMenu.x,
      y: ctxMenu.y,
      menuWidth: rect.width,
      menuHeight: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    if (Math.abs(next.x - ctxMenu.x) > 0.5 || Math.abs(next.y - ctxMenu.y) > 0.5) {
      setCtxMenu(next);
    }
  }, [ctxMenu]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    searchAddonRef.current = searchAddon;

    const terminal = new XTerm({
      cursorBlink: false,
      disableStdin: true,
      fontFamily: MACH_TERMINAL_MONO_FONT,
      fontSize: terminalFontSize,
      scrollback: SCROLLBACK_LINES,
      theme: {
        background: "#0a0a0a",
        foreground: "#e5e5e5",
        cursor: "#0a0a0a",
        cursorAccent: "#0a0a0a",
      },
      // OSC 8 hyperlinks are activated through the same policy as heuristic
      // HTTP/file scraping: http/https open via the URL opener, file:// is
      // decoded + validated before handing to the path opener, and every other
      // scheme is a silent no-op. `allowNonHttpProtocols: true` so xterm
      // forwards `file://` URIs to `activate` instead of dropping them; the
      // helper is the allowlist.
      linkHandler: {
        allowNonHttpProtocols: true,
        activate(_event, text) {
          activateTerminalLink(text, { openUrl, openPath });
        },
      },
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminal.writeln("mach-terminal");
    terminal.writeln("ready.");
    stickToBottomRef.current = isViewportAtBottom(terminal);

    const onScrollDispose = terminal.onScroll(() => {
      stickToBottomRef.current = isViewportAtBottom(terminal);
    });

    const searchResultsDispose = searchAddon.onDidChangeResults((event) => {
      findResultStateRef.current = {
        resultIndex: event.resultIndex,
        resultCount: event.resultCount,
      };
      setFindResultState({
        resultIndex: event.resultIndex,
        resultCount: event.resultCount,
      });
    });

    const terminalLinkProvider: ILinkProvider = {
      provideLinks(bufferLineNumber, callback) {
        const line = terminal.buffer.active.getLine(bufferLineNumber);
        if (!line) {
          callback(undefined);
          return;
        }
        const text = line.translateToString(true);
        const merged = mergeHttpAndFileLinksForLine(text);
        if (merged.length === 0) {
          callback(undefined);
          return;
        }
        const y1 = bufferLineNumber + 1;
        const links: ILink[] = merged.map((entry) => {
          if (entry.kind === "http") {
            return {
              text: entry.url,
              range: {
                start: { x: entry.start + 1, y: y1 },
                end: { x: entry.endExclusive, y: y1 },
              },
              decorations: { pointerCursor: true, underline: true },
              activate(_event, urlText) {
                if (isSafeHttpUrlForOpener(urlText)) {
                  void openUrl(urlText);
                }
              },
            };
          }
          return {
            text: entry.path,
            range: {
              start: { x: entry.start + 1, y: y1 },
              end: { x: entry.endExclusive, y: y1 },
            },
            decorations: { pointerCursor: true, underline: true },
            activate(_event, pathText) {
              if (isSafeLocalPathForOpener(pathText)) {
                void openPath(pathText).catch(() => {
                  /* opener failures are non-fatal; avoid toast spam */
                });
              }
            },
          };
        });
        callback(links);
      },
    };
    linkProviderDisposeRef.current = terminal.registerLinkProvider(terminalLinkProvider);

    const bellDispose = terminal.onBell(() => {
      const el = hostRef.current;
      if (!el) {
        return;
      }
      el.classList.remove("terminal-bell-flash");
      void el.offsetWidth;
      el.classList.add("terminal-bell-flash");
      if (bellAnimTimerRef.current !== null) {
        window.clearTimeout(bellAnimTimerRef.current);
      }
      bellAnimTimerRef.current = window.setTimeout(() => {
        el.classList.remove("terminal-bell-flash");
        bellAnimTimerRef.current = null;
      }, BELL_FLASH_DURATION_MS);
    });

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") {
        return true;
      }
      // While the paste confirm card is visible, let the DOM handle keys so
      // Enter / Escape on the card are not swallowed by xterm.
      if (pendingPasteRef.current) {
        return true;
      }
      // Same guard for the exited-session overlay.
      if (exitedInfoRef.current) {
        return true;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.shiftKey && (event.key === "f" || event.key === "F")) {
        if (!isFocusedRef.current) {
          return true;
        }
        findOpenRef.current = true;
        setFindOpenRef.current(true);
        return false;
      }
      if (findOpenRef.current) {
        if (event.key === "Escape") {
          closeFind();
          return false;
        }
        if (event.key === "Enter") {
          const term = findQueryRef.current;
          const options = currentFindOptions();
          if (event.shiftKey) {
            searchAddon.findPrevious(term, options);
          } else {
            searchAddon.findNext(term, options);
          }
          return false;
        }
      }
      if (mod && event.shiftKey && event.key === "C") {
        const selection = terminal.getSelection();
        if (selection) {
          void navigator.clipboard.writeText(selection);
          terminal.clearSelection();
        }
        return false;
      }
      if (mod && event.shiftKey && event.key === "V") {
        requestClipboardPaste();
        return false;
      }
      return true;
    });

    const onDataDispose = terminal.onData((data) => {
      if (activeSessionRef.current) {
        onInputRef.current(activeSessionRef.current.id, data);
      }
    });

    const flushPendingResize = () => {
      const pending = pendingResizeRef.current;
      resizeTimerRef.current = null;
      if (!pending) {
        return;
      }
      const previous = lastResizeSentRef.current;
      if (
        previous.sessionId === pending.sessionId &&
        previous.cols === pending.cols &&
        previous.rows === pending.rows
      ) {
        return;
      }
      lastResizeSentRef.current = {
        sessionId: pending.sessionId,
        cols: pending.cols,
        rows: pending.rows,
      };
      onResizeRef.current(pending.sessionId, pending.cols, pending.rows);
    };

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      if (!activeSessionRef.current) {
        return;
      }
      pendingResizeRef.current = {
        sessionId: activeSessionRef.current.id,
        cols: terminal.cols,
        rows: terminal.rows,
      };
      if (resizeTimerRef.current !== null) {
        return;
      }
      resizeTimerRef.current = window.setTimeout(flushPendingResize, 80);
    });
    observer.observe(containerRef.current);

    return () => {
      onScrollDispose.dispose();
      searchResultsDispose.dispose();
      bellDispose.dispose();
      if (bellAnimTimerRef.current !== null) {
        window.clearTimeout(bellAnimTimerRef.current);
        bellAnimTimerRef.current = null;
      }
      hostRef.current?.classList.remove("terminal-bell-flash");
      onDataDispose.dispose();
      linkProviderDisposeRef.current?.dispose();
      linkProviderDisposeRef.current = null;
      searchAddon.dispose();
      searchAddonRef.current = null;
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      if (writeFrameRef.current !== null) {
        window.cancelAnimationFrame(writeFrameRef.current);
      }
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
    };
  }, [requestClipboardPaste]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }
    const size = Math.max(8, Math.min(48, Math.round(terminalFontSize)));
    let needsFit = false;
    if (terminal.options.fontSize !== size) {
      terminal.options.fontSize = size;
      needsFit = true;
    }
    if (terminal.options.fontFamily !== MACH_TERMINAL_MONO_FONT) {
      terminal.options.fontFamily = MACH_TERMINAL_MONO_FONT;
      needsFit = true;
    }
    if (needsFit) {
      fitAddon.fit();
    }
  }, [terminalFontSize]);

  useEffect(() => {
    if (!isFocused) {
      return;
    }
    if (composerFocusedRef.current) {
      return;
    }
    if (findOpenRef.current) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      composerTextareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [isFocused]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const currentSession = activeSession?.id;
    const previousSession = renderedStateRef.current.sessionId;
    const previousLength = renderedStateRef.current.length;

    if (!currentSession) {
      terminal.reset();
      terminal.writeln("No session selected.");
      terminal.writeln("Create a session or pick an existing tab.");
      terminal.scrollToBottom();
      stickToBottomRef.current = true;
      renderedStateRef.current = { sessionId: undefined, length: 0 };
      return;
    }

    if (previousSession !== currentSession || activeBuffer.length < previousLength) {
      const pin = stickToBottomRef.current;
      terminal.reset();
      terminal.write(activeBuffer);
      if (pin) {
        terminal.scrollToBottom();
      }
      stickToBottomRef.current = isViewportAtBottom(terminal);
      renderedStateRef.current = { sessionId: currentSession, length: activeBuffer.length };
      pendingWriteRef.current = "";
      return;
    }

    const delta = activeBuffer.slice(previousLength);
    if (delta.length > 0) {
      pendingWriteRef.current += delta;
      if (writeFrameRef.current === null) {
        writeFrameRef.current = window.requestAnimationFrame(() => {
          if (terminalRef.current && pendingWriteRef.current.length > 0) {
            const t = terminalRef.current;
            const pin = stickToBottomRef.current;
            t.write(pendingWriteRef.current);
            if (pin) {
              t.scrollToBottom();
            }
          }
          pendingWriteRef.current = "";
          writeFrameRef.current = null;
        });
      }
      renderedStateRef.current = { sessionId: currentSession, length: activeBuffer.length };
    }
  }, [activeSession, activeBuffer]);

  useEffect(() => {
    if (exitedInfo) {
      setComposerDraft("");
    }
  }, [exitedInfo]);

  useEffect(() => {
    onComposerDraftChange?.(composerDraft);
  }, [composerDraft, onComposerDraftChange]);

  return (
    <section ref={terminalPanelRef} className={`terminal-panel ${isFocused ? "focused" : ""}`}>
      {sessionMessage ? <p className="terminal-message">{sessionMessage}</p> : null}
      <div
        ref={hostRef}
        className="terminal-host"
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="terminal-output-column">
          <div className="terminal-output-stack">
        <button
          type="button"
          className="terminal-session-info-btn"
          title={sessionInfoTooltip}
          aria-label={sessionInfoTooltip}
          onClick={(event) => event.stopPropagation()}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"
            />
          </svg>
        </button>
        {findOpen ? (
          <div className="terminal-find-bar">
            <label className="terminal-find-label" htmlFor={`terminal-find-${activeSession?.id ?? "none"}`}>
              Find
            </label>
            <input
              id={`terminal-find-${activeSession?.id ?? "none"}`}
              ref={findInputRef}
              type="search"
              className="terminal-find-input"
              placeholder="Search buffer…"
              aria-label="Find in terminal output"
              value={findQuery}
              onChange={(e) => {
                const v = e.target.value;
                setFindQuery(v);
                findQueryRef.current = v;
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeFind();
                  composerTextareaRef.current?.focus();
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (e.shiftKey) {
                    runFindPrevious();
                  } else {
                    runFindNext();
                  }
                }
              }}
            />
            <div className="terminal-find-toggles">
              <label className="terminal-find-case">
                <input
                  type="checkbox"
                  checked={findCaseSensitive}
                  onChange={(e) => setFindCaseSensitive(e.target.checked)}
                />
                Match case
              </label>
              <label className="terminal-find-case">
                <input
                  type="checkbox"
                  checked={findWholeWord}
                  onChange={(e) => setFindWholeWord(e.target.checked)}
                />
                Whole word
              </label>
              <label className="terminal-find-case">
                <input
                  type="checkbox"
                  checked={findRegex}
                  onChange={(e) => setFindRegex(e.target.checked)}
                />
                Regex
              </label>
            </div>
            <span
              className="terminal-find-count"
              aria-live="polite"
              aria-atomic="true"
            >
              {formatFindStatus({
                query: findQuery,
                resultIndex: findResultState.resultIndex,
                resultCount: findResultState.resultCount,
              })}
            </span>
            <div className="terminal-find-nav">
              <button
                type="button"
                className="inline-btn ghost"
                aria-label="Previous match"
                title="Previous match (Shift+Enter)"
                onClick={() => runFindPrevious()}
              >
                {"\u2039"}
              </button>
              <button
                type="button"
                className="inline-btn ghost"
                aria-label="Next match"
                title="Next match (Enter)"
                onClick={() => runFindNext()}
              >
                {"\u203A"}
              </button>
            </div>
            <span className="terminal-find-hint">Enter / Shift+Enter</span>
          </div>
        ) : null}
        {pendingPaste ? (
          <div
            className="terminal-paste-guard"
            role="dialog"
            aria-label="Confirm terminal paste"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                commitPendingPaste();
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelPendingPaste();
              }
            }}
          >
            <p className="terminal-paste-guard-title">Confirm terminal paste</p>
            <p className="terminal-paste-guard-reasons">{pendingPaste.reasons.join(" - ")}</p>
            <pre className="terminal-paste-guard-preview" aria-label="Paste preview">
              {pendingPaste.summary.previewText}
            </pre>
            <div className="terminal-paste-guard-meta">
              <span>
                {pendingPaste.summary.lineCount} lines - {pendingPaste.summary.charCount} chars
              </span>
              {pendingPaste.summary.truncated ? (
                <span className="terminal-paste-guard-truncated">preview truncated</span>
              ) : null}
            </div>
            <label className="terminal-paste-guard-bypass">
              <input
                type="checkbox"
                checked={pasteBypassForSession}
                onChange={(e) => setPasteBypassForSession(e.target.checked)}
              />
              Don&apos;t ask again this session
            </label>
            <div className="terminal-paste-guard-actions">
              <button
                ref={pasteConfirmButtonRef}
                type="button"
                className="inline-btn"
                onClick={() => {
                  commitPendingPaste();
                }}
              >
                Paste anyway
              </button>
              <button
                type="button"
                className="inline-btn ghost"
                onClick={() => {
                  cancelPendingPaste();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
            <div
              className="terminal-xterm-input-guard"
              onPointerDown={() => {
                if (findOpenRef.current) {
                  return;
                }
                composerTextareaRef.current?.focus();
              }}
            >
              <div ref={containerRef} className="terminal-container" tabIndex={-1} />
            </div>
          </div>
          <div className="terminal-input-chrome">
            {aiInsightSlot}
            <MachStatusStrip liveCwd={liveCwd} shellExe={activeSession?.shell ?? null} />
            <div className="terminal-composer" onContextMenu={(event) => event.stopPropagation()}>
              <div className="terminal-composer-input-row">
                <textarea
                  ref={composerTextareaRef}
                  className="terminal-composer-field"
                  placeholder={composerLocked ? "Session unavailable…" : "Type a command…"}
                  disabled={composerLocked}
                  value={composerDraft}
                  onChange={(e) => setComposerDraft(e.target.value)}
                  onFocus={() => {
                    composerFocusedRef.current = true;
                  }}
                  onBlur={() => {
                    queueMicrotask(() => {
                      composerFocusedRef.current = false;
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submitComposer();
                    }
                  }}
                  rows={1}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-label="Shell command input"
                />
              </div>
              {aiAssistEnabled && isFocused && (onAiExplainComposer || onAiFixComposer) ? (
                <div className="terminal-composer-ai-row">
                  {onAiExplainComposer ? (
                    <button
                      type="button"
                      className="inline-btn ghost"
                      disabled={composerLocked || !composerDraft.trim()}
                      onClick={() => onAiExplainComposer()}
                    >
                      Explain
                    </button>
                  ) : null}
                  {onAiFixComposer ? (
                    <button
                      type="button"
                      className="inline-btn ghost"
                      disabled={composerLocked || !composerDraft.trim()}
                      onClick={() => onAiFixComposer()}
                    >
                      Safer
                    </button>
                  ) : null}
                </div>
              ) : null}
              <p className="terminal-composer-footer-hint">Enter to send · Shift+Enter newline</p>
            </div>
          </div>
        </div>
        {exitedInfo ? (
          <div
            className={`terminal-exit-overlay status-${exitedInfo.status}`}
            role="dialog"
            aria-modal="true"
            aria-label={`Session ${exitedInfo.status}`}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                onRequestRestartSessionRef.current?.();
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onRequestCloseSessionRef.current?.();
              }
            }}
          >
            <div className="terminal-exit-card">
              {(() => {
                const { headline, detail, codeLine } = summarizeExitedInfo(exitedInfo);
                return (
                  <>
                    <p className="terminal-exit-title">{headline}</p>
                    {codeLine ? <p className="terminal-exit-code">{codeLine}</p> : null}
                    <p className="terminal-exit-message">{detail}</p>
                    {liveCwd ? (
                      <p className="terminal-exit-cwd" title={liveCwd}>
                        Restart will land in <code>{liveCwd}</code>
                      </p>
                    ) : null}
                  </>
                );
              })()}
              <div className="terminal-exit-actions">
                <button
                  ref={exitRestartButtonRef}
                  type="button"
                  className="inline-btn"
                  onClick={() => onRequestRestartSessionRef.current?.()}
                >
                  Restart
                </button>
                <button
                  type="button"
                  className="inline-btn ghost"
                  onClick={() => onRequestCloseSessionRef.current?.()}
                >
                  Close
                </button>
              </div>
              <p className="terminal-exit-hint">Enter restart - Escape close</p>
            </div>
          </div>
        ) : null}
        {ctxMenu ? (
          <div
            ref={contextMenuRef}
            className="terminal-context-menu"
            data-terminal-context-menu
            role="menu"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const t = terminalRef.current;
                const sel = t?.getSelection();
                if (sel && t) {
                  void navigator.clipboard.writeText(sel);
                  t.clearSelection();
                }
                setCtxMenu(null);
              }}
            >
              Copy
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!canPasteFromContextMenu(activeSession)}
              onClick={() => {
                requestClipboardPaste();
                setCtxMenu(null);
              }}
            >
              Paste
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                terminalRef.current?.selectAll();
                setCtxMenu(null);
              }}
            >
              Select all
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                findOpenRef.current = true;
                setFindOpen(true);
                setCtxMenu(null);
                queueMicrotask(() => findInputRef.current?.focus());
              }}
            >
              Find…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const t = terminalRef.current;
                if (t) {
                  t.scrollToBottom();
                  stickToBottomRef.current = true;
                }
                setCtxMenu(null);
              }}
            >
              Scroll to bottom
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
