import { describe, expect, it } from "vitest";
import type { TerminalProfile } from "./terminal";
import {
  ensureChatKeysForSessionIds,
  restoreSessionMetadataFromTabs,
  resolveChatKeyForSession,
  spawnProfileForRestorableTab,
} from "./sessionRestore";

describe("sessionRestore", () => {
  const defaultProfile: TerminalProfile = {
    shell: "pwsh.exe",
    args: [],
    cwd: "C:\\Users\\me",
    env: {},
    font_size: 13,
  };

  it("restores shell and cwd from restorable tab", () => {
    const profile = spawnProfileForRestorableTab(
      { sessionId: "session-1", shell: "wsl.exe", cwd: "/home/me" },
      defaultProfile,
    );
    expect(profile.shell).toBe("wsl.exe");
    expect(profile.cwd).toBe("/home/me");
    expect(profile.font_size).toBe(13);
  });

  it("restores shell args from restorable tab", () => {
    const profile = spawnProfileForRestorableTab(
      { sessionId: "session-1", shell: "wsl.exe", args: ["-d", "Ubuntu"] },
      defaultProfile,
    );
    expect(profile.args).toEqual(["-d", "Ubuntu"]);
  });

  it("maps persisted tab metadata onto respawned session ids", () => {
    const { names, modes, chatKeys } = restoreSessionMetadataFromTabs(
      [
        {
          sessionId: "session-old",
          shell: "bash",
          name: "build",
          chatKey: "chat-abc",
          inputMode: "commander",
        },
      ],
      (id) => (id === "session-old" ? "session-new" : null),
    );
    expect(names).toEqual({ "session-new": "build" });
    expect(modes).toEqual({ "session-new": "commander" });
    expect(chatKeys).toEqual({ "session-new": "chat-abc" });
  });

  it("creates chat keys for sessions missing from restored metadata", () => {
    const keys = ensureChatKeysForSessionIds(["session-1", "session-2"], { "session-1": "chat-existing" });
    expect(keys["session-1"]).toBe("chat-existing");
    expect(keys["session-2"]).toMatch(/^chat-/);
  });

  it("resolveChatKeyForSession is idempotent", () => {
    const first = resolveChatKeyForSession({}, "session-1");
    const second = resolveChatKeyForSession(first.nextKeys, "session-1");
    expect(second.chatKey).toBe(first.chatKey);
    expect(second.nextKeys).toBe(first.nextKeys);
  });
});
