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
  /** When set, opens rename input for that session (palette / F2). */
  renameRequestSessionId?: string | null;
  onRenameRequestHandled?: () => void;
}

export function TabBar({
  groups,
  onSelect,
  onCreate,
  onCreateWithProfile,
  onClose,
  onRestartSession,
  onRename = () => {},
  renameRequestSessionId = null,
  onRenameRequestHandled = () => {},
}: TabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);

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

  const activeGroupId = groups.find((group) => group.isActive)?.groupId ?? null;

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

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeGroupId, groups.length]);

  useEffect(() => {
    if (!renameRequestSessionId) {
      return;
    }
    const group = groups.find((entry) => entry.primarySessionId === renameRequestSessionId);
    if (group) {
      beginRename(group.primarySessionId, group.label);
    }
    onRenameRequestHandled();
  }, [renameRequestSessionId, groups, onRenameRequestHandled]);

  return (
    <div className="session-tabs">
      {groups.map((group) => {
        const isEditing = editingId === group.primarySessionId;
        const isSplit = group.sessionIds.length > 1;
        return (
          <div
            key={group.groupId}
            ref={group.isActive ? activeTabRef : undefined}
            className={`tab-strip-item ${group.isActive ? "active" : ""} ${group.isExited ? "dead" : ""} ${isSplit ? "split-tab" : ""}`}
          >
            <button
              type="button"
              className="tab-btn"
              onClick={() => onSelect(group.groupId)}
              onDoubleClick={(event) => {
                event.stopPropagation();
                beginRename(group.primarySessionId, group.label);
              }}
              title={`${group.tooltip} · F2 or double-click to rename`}
              aria-label={`${group.tooltip}. F2 or double-click to rename.`}
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
            </button>
            {group.isExited ? (
              <button
                type="button"
                className="tab-restart"
                aria-label="Restart session"
                title="Restart this session"
                onClick={(event) => {
                  event.stopPropagation();
                  onRestartSession(group.primarySessionId);
                }}
              >
                {"\u21BB"}
              </button>
            ) : null}
            <button
              type="button"
              className="tab-close"
              aria-label="Close tab"
              title="Close tab"
              onClick={(event) => {
                event.stopPropagation();
                onClose(group.groupId);
              }}
            >
              x
            </button>
          </div>
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
