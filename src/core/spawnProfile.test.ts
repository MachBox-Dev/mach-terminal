import { describe, expect, it } from "vitest";
import { spawnProfileForLiveSession, spawnProfileFromShellSelection } from "./spawnProfile";
import type { PtySessionInfo, TerminalProfile } from "./terminal";

describe("spawnProfileFromShellSelection", () => {
  const base: TerminalProfile = {
    shell: "pwsh.exe",
    args: ["-NoLogo"],
    cwd: "C:\\Users\\me",
    env: { FOO: "bar" },
    font_size: 14,
    minimal_shell_prompt: true,
  };

  it("replaces shell and args while keeping cwd, env, and font settings", () => {
    const profile = spawnProfileFromShellSelection(base, {
      shell: "wsl.exe",
      args: ["-d", "Ubuntu"],
    });
    expect(profile.shell).toBe("wsl.exe");
    expect(profile.args).toEqual(["-d", "Ubuntu"]);
    expect(profile.cwd).toBe("C:\\Users\\me");
    expect(profile.env).toEqual({ FOO: "bar" });
    expect(profile.font_size).toBe(14);
    expect(profile.minimal_shell_prompt).toBe(true);
    expect(profile.env).not.toBe(base.env);
  });

  it("clears args when the selection has none", () => {
    const profile = spawnProfileFromShellSelection(base, {
      shell: "bash",
      args: [],
    });
    expect(profile.shell).toBe("bash");
    expect(profile.args).toBeUndefined();
  });

  it("drops shell when selection is blank", () => {
    const profile = spawnProfileFromShellSelection(base, {
      shell: undefined,
      args: [],
    });
    expect(profile.shell).toBeUndefined();
    expect(profile.args).toBeUndefined();
  });
});

describe("spawnProfileForLiveSession", () => {
  const base: TerminalProfile = {
    shell: "pwsh.exe",
    args: ["-NoLogo"],
    cwd: "C:\\Users\\me",
    env: {},
    font_size: 14,
    minimal_shell_prompt: true,
  };

  const session: PtySessionInfo = {
    id: "session-1",
    shell: "wsl.exe",
    cwd: "/home/me",
    status: "running",
  };

  it("inherits shell, spawn args, and cwd from the live session", () => {
    const profile = spawnProfileForLiveSession(
      base,
      session,
      { "session-1": ["-d", "Ubuntu"] },
      { "session-1": "/home/me/projects" },
    );
    expect(profile.shell).toBe("wsl.exe");
    expect(profile.args).toEqual(["-d", "Ubuntu"]);
    expect(profile.cwd).toBe("/home/me/projects");
  });

  it("falls back to profile shell and session cwd when maps are empty", () => {
    const profile = spawnProfileForLiveSession(base, session, {}, {});
    expect(profile.shell).toBe("wsl.exe");
    expect(profile.args).toEqual(["-NoLogo"]);
    expect(profile.cwd).toBe("/home/me");
  });
});
