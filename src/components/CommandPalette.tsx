import { useEffect, useId, useMemo, useRef, useState } from "react";
import { handleFocusTrapTab } from "../core/focusTrap";
import { filterPaletteCommands } from "../core/palette";

export interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
  description?: string;
}

interface CommandPaletteProps {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
  onRun: (commandId: string) => void;
}

export interface PaletteKeyDecision {
  preventDefault: boolean;
  nextActiveIndex: number;
  shouldRunSelection: boolean;
  shouldClose: boolean;
}

export function paletteOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

export function decidePaletteKeyAction(args: {
  key: string;
  activeIndex: number;
  filteredCount: number;
  hasSelection: boolean;
}): PaletteKeyDecision | null {
  const { key, activeIndex, filteredCount, hasSelection } = args;
  if (key === "ArrowDown") {
    if (filteredCount === 0) {
      return {
        preventDefault: true,
        nextActiveIndex: activeIndex,
        shouldRunSelection: false,
        shouldClose: false,
      };
    }
    return {
      preventDefault: true,
      nextActiveIndex: (activeIndex + 1) % filteredCount,
      shouldRunSelection: false,
      shouldClose: false,
    };
  }
  if (key === "ArrowUp") {
    if (filteredCount === 0) {
      return {
        preventDefault: true,
        nextActiveIndex: activeIndex,
        shouldRunSelection: false,
        shouldClose: false,
      };
    }
    return {
      preventDefault: true,
      nextActiveIndex: (activeIndex - 1 + filteredCount) % filteredCount,
      shouldRunSelection: false,
      shouldClose: false,
    };
  }
  if (key === "Enter") {
    return {
      preventDefault: true,
      nextActiveIndex: activeIndex,
      shouldRunSelection: hasSelection,
      shouldClose: hasSelection,
    };
  }
  if (key === "Escape") {
    return {
      preventDefault: true,
      nextActiveIndex: activeIndex,
      shouldRunSelection: false,
      shouldClose: true,
    };
  }
  return null;
}

export function CommandPalette({ open, commands, onClose, onRun }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const listboxId = useId();

  const ranked = useMemo(() => filterPaletteCommands(commands, query), [commands, query]);
  const filtered = ranked.map((entry) => entry.command);
  const activeOptionId =
    filtered.length > 0 ? paletteOptionId(listboxId, activeIndex) : undefined;

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      const restore = previousFocusRef.current;
      previousFocusRef.current = null;
      restore?.focus?.();
      return;
    }
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
    }
  }, [open, query]);

  if (!open) {
    return null;
  }

  const closePalette = () => {
    onClose();
  };

  return (
    <div className="palette-backdrop" onClick={closePalette}>
      <div
        ref={panelRef}
        className="palette-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (panelRef.current) {
            handleFocusTrapTab(event, panelRef.current, document.activeElement);
          }
        }}
      >
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Search commands"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={filtered.length > 0}
          aria-activedescendant={activeOptionId}
          value={query}
          placeholder="Type a command..."
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            const decision = decidePaletteKeyAction({
              key: event.key,
              activeIndex,
              filteredCount: filtered.length,
              hasSelection: Boolean(filtered[activeIndex]),
            });
            if (!decision) {
              return;
            }
            if (decision.preventDefault) {
              event.preventDefault();
            }
            if (decision.nextActiveIndex !== activeIndex) {
              setActiveIndex(decision.nextActiveIndex);
            }
            if (decision.shouldRunSelection) {
              const selected = filtered[activeIndex];
              if (selected) {
                onRun(selected.id);
              }
            }
            if (decision.shouldClose) {
              closePalette();
            }
          }}
        />
        <div
          id={listboxId}
          className="palette-results"
          role="listbox"
          aria-label="Command results"
        >
          {filtered.length === 0 ? (
            <p className="palette-empty">No commands match your query.</p>
          ) : (
            filtered.map((command, index) => (
              <button
                key={command.id}
                id={paletteOptionId(listboxId, index)}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`palette-item ${index === activeIndex ? "active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  onRun(command.id);
                  closePalette();
                }}
              >
                <span>
                  {command.label}
                  {command.description ? (
                    <small className="palette-item-description">{command.description}</small>
                  ) : null}
                </span>
                {command.shortcut ? <small>{command.shortcut}</small> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
