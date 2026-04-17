import { useEffect, useMemo, useState } from "react";
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

export function CommandPalette({ open, commands, onClose, onRun }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const ranked = useMemo(() => filterPaletteCommands(commands, query), [commands, query]);
  const filtered = ranked.map((entry) => entry.command);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }
    setActiveIndex(0);
  }, [open, query]);

  if (!open) {
    return null;
  }

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette-panel" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder="Type a command..."
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (filtered.length === 0) {
                return;
              }
              setActiveIndex((current) => (current + 1) % filtered.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              if (filtered.length === 0) {
                return;
              }
              setActiveIndex((current) => (current - 1 + filtered.length) % filtered.length);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const selected = filtered[activeIndex];
              if (!selected) {
                return;
              }
              onRun(selected.id);
              onClose();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <div className="palette-results">
          {filtered.length === 0 ? (
            <p className="palette-empty">No commands match your query.</p>
          ) : (
            filtered.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className={`palette-item ${index === activeIndex ? "active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  onRun(command.id);
                  onClose();
                }}
              >
                <span>
                  {command.label}
                  {command.description ? <small className="palette-item-description">{command.description}</small> : null}
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
