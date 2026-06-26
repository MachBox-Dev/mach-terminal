import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { decideTitleBarMenuKeyAction } from "../core/titleBarMenuKeyboard";
import { isTauri } from "../core/tauriRuntime";

export interface CustomTitleBarProps {
  onOpenSettings?: () => void;
  onOpenDiagnostics?: () => void;
  /** Dev-only diagnostics entry; wired from `import.meta.env.DEV` at callsite. */
  showDiagnostics?: boolean;
  /** Session tab strip, rendered inline between the logo menu and the window controls. */
  tabs?: ReactNode;
}

function isMacHost(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent);
}

function TitleBarMenu({
  onOpenSettings,
  onOpenDiagnostics,
  showDiagnostics,
}: Required<Pick<CustomTitleBarProps, "onOpenSettings" | "onOpenDiagnostics" | "showDiagnostics">>) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const menuItems = useMemo(
    () =>
      [
        { label: "Settings", action: onOpenSettings },
        showDiagnostics ? { label: "Diagnostics", action: onOpenDiagnostics } : null,
      ].filter((entry): entry is { label: string; action: () => void } => entry !== null),
    [onOpenDiagnostics, onOpenSettings, showDiagnostics],
  );

  const closeMenu = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      itemRefs.current[0]?.focus();
    });
    const onDocPointer = (event: MouseEvent | PointerEvent) => {
      const el = wrapRef.current;
      if (el && event.target instanceof Node && !el.contains(event.target)) {
        closeMenu(false);
      }
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu(true);
      }
    };
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [closeMenu, open]);

  const run = (fn: () => void) => {
    closeMenu(true);
    fn();
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const currentIndex = itemRefs.current.findIndex((element) => element === document.activeElement);
    const decision = decideTitleBarMenuKeyAction({
      key: event.key,
      activeIndex: currentIndex,
      itemCount: menuItems.length,
    });
    if (!decision?.handled) {
      if (event.key === "Enter" || event.key === " ") {
        const active = itemRefs.current[currentIndex];
        if (active) {
          event.preventDefault();
          run(menuItems[currentIndex].action);
        }
      }
      return;
    }
    event.preventDefault();
    if (decision.shouldClose) {
      closeMenu(true);
      return;
    }
    itemRefs.current[decision.nextIndex]?.focus();
    itemRefs.current.forEach((element, index) => {
      if (element) {
        element.tabIndex = index === decision.nextIndex ? 0 : -1;
      }
    });
  };

  return (
    <div ref={wrapRef} className="custom-titlebar-menu-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="custom-titlebar-menu-trigger custom-titlebar-logo-trigger"
        aria-label="Open app menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((previous) => !previous)}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !open) {
            event.preventDefault();
            setOpen(true);
          }
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <img
          src="/mach-terminal-logo.png"
          alt="Mach Terminal menu"
          className="custom-titlebar-logo"
          width={20}
          height={20}
          decoding="async"
        />
      </button>
      {open ? (
        <div
          className="custom-titlebar-menu-dropdown"
          role="menu"
          onKeyDown={onMenuKeyDown}
        >
          {menuItems.map((item, index) => (
            <button
              key={item.label}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              className="custom-titlebar-menu-item"
              role="menuitem"
              tabIndex={index === 0 ? 0 : -1}
              onClick={() => run(item.action)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CustomTitleBar({
  onOpenSettings = () => {
    /* no-op when not wired (e.g. tests) */
  },
  onOpenDiagnostics = () => {},
  showDiagnostics = false,
  tabs = null,
}: CustomTitleBarProps = {}) {
  const [maximized, setMaximized] = useState(false);

  const refreshMaximized = useCallback(async () => {
    if (!isTauri()) {
      return;
    }
    const w = getCurrentWindow();
    setMaximized(await w.isMaximized());
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    void refreshMaximized();
    const w = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void w
      .onResized(() => {
        void refreshMaximized();
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        /* ignore if event ACL blocks listener */
      });
    return () => {
      unlisten?.();
    };
  }, [refreshMaximized]);

  const menu = (
    <TitleBarMenu onOpenSettings={onOpenSettings} onOpenDiagnostics={onOpenDiagnostics} showDiagnostics={showDiagnostics} />
  );

  const tabStrip = <div className="custom-titlebar-tabs">{tabs}</div>;

  // Empty area to the right of the tabs is the window drag handle (double-click
  // to maximize); tabs themselves are real buttons and stay clickable.
  const dragSpacer = (
    <div
      className="custom-titlebar-drag custom-titlebar-spacer"
      data-tauri-drag-region={isTauri() ? true : undefined}
      onDoubleClick={(event) => {
        if (!isTauri()) {
          return;
        }
        if ((event.target as HTMLElement).closest("button")) {
          return;
        }
        void onToggleMaximize();
      }}
    />
  );

  if (!isTauri()) {
    return (
      <header className="custom-titlebar custom-titlebar-web">
        {menu}
        {tabStrip}
        <div className="custom-titlebar-drag custom-titlebar-drag-web custom-titlebar-spacer" />
      </header>
    );
  }

  const w = getCurrentWindow();
  const mac = isMacHost();

  const onMinimize = () => void w.minimize();
  const onToggleMaximize = () => {
    void (async () => {
      await w.toggleMaximize();
      await refreshMaximized();
    })();
  };
  const onClose = () => void w.close();

  const controls = (
    <div className={`custom-titlebar-controls${mac ? " custom-titlebar-controls-mac" : ""}`}>
      {mac ? (
        <>
          <button
            type="button"
            className="custom-titlebar-btn custom-titlebar-close"
            aria-label="Close"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
              <path
                fill="currentColor"
                d="M13.46 12L19 17.54V19h-1.46L12 13.46 6.46 19H5v-1.46L10.54 12 5 6.46V5h1.46L12 10.54 17.54 5H19v1.46z"
              />
            </svg>
          </button>
          <button type="button" className="custom-titlebar-btn" aria-label="Minimize" onClick={onMinimize}>
            <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
              <path fill="currentColor" d="M19 13H5v-2h14z" />
            </svg>
          </button>
          <button type="button" className="custom-titlebar-btn" aria-label="Zoom" onClick={onToggleMaximize}>
            {maximized ? (
              <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M10 4H4v6H2V2h8zm10 10v6h-6v2h8v-8zm0-10h2v8h-2V4h-6V2zM2 14h2v6h6v2H2z"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
                <path fill="currentColor" d="M4 4h16v16H4zm2 4v10h12V8z" />
              </svg>
            )}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="custom-titlebar-btn" aria-label="Minimize" onClick={onMinimize}>
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
              <path fill="currentColor" d="M19 13H5v-2h14z" />
            </svg>
          </button>
          <button type="button" className="custom-titlebar-btn" aria-label="Maximize" onClick={onToggleMaximize}>
            {maximized ? (
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M10 4H4v6H2V2h8zm10 10v6h-6v2h8v-8zm0-10h2v8h-2V4h-6V2zM2 14h2v6h6v2H2z"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                <path fill="currentColor" d="M4 4h16v16H4zm2 4v10h12V8z" />
              </svg>
            )}
          </button>
          <button type="button" className="custom-titlebar-btn custom-titlebar-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
              <path
                fill="currentColor"
                d="M13.46 12L19 17.54V19h-1.46L12 13.46 6.46 19H5v-1.46L10.54 12 5 6.46V5h1.46L12 10.54 17.54 5H19v1.46z"
              />
            </svg>
          </button>
        </>
      )}
    </div>
  );

  return (
    <header className={`custom-titlebar${mac ? " custom-titlebar-mac" : ""}`}>
      {mac ? (
        <>
          {controls}
          {menu}
          {tabStrip}
          {dragSpacer}
        </>
      ) : (
        <>
          {menu}
          {tabStrip}
          {dragSpacer}
          {controls}
        </>
      )}
    </header>
  );
}
