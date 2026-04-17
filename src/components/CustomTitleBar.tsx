import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../core/tauriRuntime";

function isMacHost(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent);
}

export function CustomTitleBar() {
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

  if (!isTauri()) {
    return null;
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

  const dragRegion = (
    <div
      className="custom-titlebar-drag"
      data-tauri-drag-region
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) {
          return;
        }
        void onToggleMaximize();
      }}
    >
      <span className="custom-titlebar-brand">Mach Terminal</span>
    </div>
  );

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
          {dragRegion}
        </>
      ) : (
        <>
          {dragRegion}
          {controls}
        </>
      )}
    </header>
  );
}
