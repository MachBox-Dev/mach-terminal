import { useEffect, useRef, useState } from "react";
import type { TabBarGroup } from "../core/tabGroups";

interface TabBarProps {
  groups: TabBarGroup[];
  onSelect: (groupId: string) => void;
  onCreate: () => void;
  /** Shift+click on + invokes this when provided (shell picker). */
  onCreateWithProfile?: () => void;
  onClose: (groupId: string) => void;
  onRestartSession: (sessionId: string) => void;
  /** Set (non-empty) or clear (empty/whitespace) a tab's custom name. */
  onRename: (sessionId: string, name: string) => void;
}

export function TabBar({
  groups,
  onSelect,
  onCreate,
  onCreateWithProfile,
  onClose,
  onRestartSession,
  onRename = () => {},
}: TabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (editingId && !groups.some((group) => group.primarySessionId === editingId)) {
      setEditingId(null);
    }
  }, [editingId, groups]);

  const beginRename = (sessionId: string, label: string) => {
    setDraft(label);
    setEditingId(sessionId);
  };

  const commitRename = () => {
    if (editingId) {
      onRename(editingId, draft);
    }
    setEditingId(null);
  };

  return (
    <div className="session-tabs">
      {groups.map((group) => {
        const isEditing = editingId === group.primarySessionId;
        const isSplit = group.sessionIds.length > 1;
        return (
          <button
            key={group.groupId}
            type="button"
            className={`tab-btn ${group.isActive ? "active" : ""} ${group.isExited ? "dead" : ""} ${isSplit ? "split-tab" : ""}`}
            onClick={() => onSelect(group.groupId)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              beginRename(group.primarySessionId, group.label);
            }}
            title={group.tooltip}
            aria-label={group.tooltip}
          >
            <span className={`tab-dot status-${group.status}`} aria-hidden="true" />
            {isSplit ? <span className="tab-split-mark" aria-hidden="true" /> : null}
            {isEditing ? (
              <input
                ref={inputRef}
                className="tab-name-input"
                value={draft}
                aria-label="Rename tab"
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRename();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setEditingId(null);
                  }
                }}
              />
            ) : (
              <span className="tab-name">{group.label}</span>
            )}
            {group.isExited ? (
              <span
                className="tab-restart"
                role="button"
                aria-label="Restart session"
                title="Restart this session"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  onRestartSession(group.primarySessionId);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onRestartSession(group.primarySessionId);
                  }
                }}
              >
                {"\u21BB"}
              </span>
            ) : null}
            <span
              className="tab-close"
              onClick={(event) => {
                event.stopPropagation();
                onClose(group.groupId);
              }}
            >
              x
            </span>
          </button>
        );
      })}
      <button
        type="button"
        className="tab-btn create"
        onClick={(event) => {
          if (event.shiftKey && onCreateWithProfile) {
            onCreateWithProfile();
          } else {
            onCreate();
          }
        }}
        aria-label="New session"
        title={onCreateWithProfile ? "New session (Shift+click to choose shell)" : "New session"}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
