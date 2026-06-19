import { describe, expect, it } from "vitest";
import { spawnProfileFromShellSelection } from "./spawnProfile";
import type { TerminalProfile } from "./terminal";

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
