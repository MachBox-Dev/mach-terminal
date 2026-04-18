import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../core/tauriRuntime";

export interface CustomTitleBarProps {
  onOpenSettings?: () => void;
  onOpenDiagnostics?: () => void;
  /** Dev-only diagnostics entry; wired from `import.meta.env.DEV` at callsite. */
  showDiagnostics?: boolean;
}

function isMacHost(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent);
}

function TitleBarBrandRow() {
  return (
    <div className="custom-titlebar-brand-row">
      <img
        src="/mach-terminal-logo.png"
        alt=""
        className="custom-titlebar-logo"
        width={22}
        height={22}
        decoding="async"
      />
      <span className="custom-titlebar-brand">Mach Terminal</span>
    </div>
  );
}

function TitleBarMenu({
  onOpenSettings,
  onOpenDiagnostics,
  showDiagnostics,
}: Required<Pick<CustomTitleBarProps, "onOpenSettings" | "onOpenDiagnostics" | "showDiagnostics">>) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocPointer = (event: MouseEvent | PointerEvent) => {
      const el = wrapRef.current;
      if (el && event.target instanceof Node && !el.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={wrapRef} className="custom-titlebar-menu-wrap">
      <button
        type="button"
        className="custom-titlebar-menu-trigger"
        aria-label="Open app menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((previous) => !previous)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M4 7h16v2H4V7zm0 4h16v2H4v-2zm0 4h16v2H4v-2z" />
        </svg>
      </button>
      {open ? (
        <div className="custom-titlebar-menu-dropdown" role="menu">
          <button type="button" className="custom-titlebar-menu-item" role="menuitem" onClick={() => run(onOpenSettings)}>
            Settings
          </button>
          {showDiagnostics ? (
            <button
              type="button"
              className="custom-titlebar-menu-item"
              role="menuitem"
              onClick={() => run(onOpenDiagnostics)}
            >
              Diagnostics
            </button>
          ) : null}
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

  const brand = (
    <div
      className="custom-titlebar-drag"
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
    >
      <TitleBarBrandRow />
    </div>
  );

  if (!isTauri()) {
    return (
      <header className="custom-titlebar custom-titlebar-web">
        {menu}
        <div className="custom-titlebar-drag custom-titlebar-drag-web">
          <TitleBarBrandRow />
        </div>
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
          {brand}
        </>
      ) : (
        <>
          {menu}
          {brand}
          {controls}
        </>
      )}
    </header>
  );
}
