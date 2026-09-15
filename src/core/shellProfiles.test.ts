import { describe, expect, it } from "vitest";
import type { ShellCandidate } from "./terminal";
import {
  CUSTOM_SHELL_OPTION_ID,
  argsToLines,
  formatShellCommandPreview,
  groupShellCandidates,
  parseArgsLines,
  parseShellPresetOptionId,
  sameArgs,
  selectedCandidateId,
  selectionForCandidateId,
  shellPresetOptionId,
  validateShellSpawnSelection,
} from "./shellProfiles";

function candidate(overrides: Partial<ShellCandidate> & Pick<ShellCandidate, "id" | "shell">): ShellCandidate {
  return {
    label: overrides.label ?? overrides.id,
    args: [],
    kind: "native",
    available: true,
    is_default: false,
    ...overrides,
  };
}

const CANDIDATES: ShellCandidate[] = [
  candidate({ id: "pwsh", shell: "pwsh.exe", kind: "native", is_default: true }),
  candidate({ id: "windows-powershell", shell: "C:\\Windows\\powershell.exe", kind: "native" }),
  candidate({ id: "wsl", shell: "wsl.exe", kind: "wsl" }),
  candidate({ id: "wsl:Ubuntu", shell: "wsl.exe", args: ["-d", "Ubuntu"], kind: "wsl", label: "Ubuntu (WSL)" }),
];

describe("formatShellCommandPreview", () => {
  it("renders shell + args and quotes whitespace", () => {
    expect(formatShellCommandPreview("wsl.exe", ["-d", "Ubuntu"])).toBe("wsl.exe -d Ubuntu");
    expect(formatShellCommandPreview("C:\\Program Files\\Git\\bin\\bash.exe", ["-l"])).toBe(
      '"C:\\Program Files\\Git\\bin\\bash.exe" -l',
    );
  });

  it("falls back to a default-shell hint when empty", () => {
    expect(formatShellCommandPreview("", [])).toBe("(system default shell)");
    expect(formatShellCommandPreview(null, [])).toBe("(system default shell)");
  });
});

describe("parseArgsLines / argsToLines", () => {
  it("splits on newlines, trims, drops blanks", () => {
    expect(parseArgsLines("-d\n  Ubuntu \n\n-e zsh\n")).toEqual(["-d", "Ubuntu", "-e zsh"]);
  });

  it("round-trips through argsToLines", () => {
    const args = ["-NoLogo", "-NoProfile"];
    expect(parseArgsLines(argsToLines(args))).toEqual(args);
  });
});

describe("sameArgs", () => {
  it("is order- and length-sensitive", () => {
    expect(sameArgs(["-d", "Ubuntu"], ["-d", "Ubuntu"])).toBe(true);
    expect(sameArgs(["-d", "Ubuntu"], ["Ubuntu", "-d"])).toBe(false);
    expect(sameArgs(["-d"], ["-d", "Ubuntu"])).toBe(false);
  });
});

describe("selectedCandidateId", () => {
  it("matches on exact shell + args", () => {
    expect(selectedCandidateId(CANDIDATES, "wsl.exe", ["-d", "Ubuntu"])).toBe("wsl:Ubuntu");
    expect(selectedCandidateId(CANDIDATES, "wsl.exe", [])).toBe("wsl");
  });

  it("returns the available default when no shell is set", () => {
    expect(selectedCandidateId(CANDIDATES, undefined, [])).toBe("pwsh");
  });

  it("falls back to custom for unknown shells", () => {
    expect(selectedCandidateId(CANDIDATES, "fish", [])).toBe(CUSTOM_SHELL_OPTION_ID);
    expect(selectedCandidateId(CANDIDATES, "wsl.exe", ["-d", "Debian"])).toBe(CUSTOM_SHELL_OPTION_ID);
  });

  it("prefers an active saved-preset option id", () => {
    const presetId = shellPresetOptionId("preset-abc");
    expect(selectedCandidateId(CANDIDATES, "fish", [], presetId)).toBe(presetId);
  });
});

describe("groupShellCandidates", () => {
  it("orders native then wsl and keeps members", () => {
    const groups = groupShellCandidates(CANDIDATES);
    expect(groups.map((group) => group.kind)).toEqual(["native", "wsl"]);
    expect(groups[0].label).toBe("Installed shells");
    expect(groups[1].items.map((item) => item.id)).toEqual(["wsl", "wsl:Ubuntu"]);
  });
});

describe("selectionForCandidateId", () => {
  it("returns shell + cloned args for a known candidate", () => {
    expect(selectionForCandidateId(CANDIDATES, "wsl:Ubuntu")).toEqual({ shell: "wsl.exe", args: ["-d", "Ubuntu"] });
  });

  it("returns null for the custom sentinel or unknown id", () => {
    expect(selectionForCandidateId(CANDIDATES, CUSTOM_SHELL_OPTION_ID)).toBeNull();
    expect(selectionForCandidateId(CANDIDATES, "nope")).toBeNull();
  });
});

describe("shellPresetOptionId", () => {
  it("round-trips preset ids", () => {
    expect(shellPresetOptionId("abc")).toBe("preset:abc");
    expect(parseShellPresetOptionId("preset:abc")).toBe("abc");
    expect(parseShellPresetOptionId("pwsh")).toBeNull();
  });
});

describe("validateShellSpawnSelection", () => {
  it("rejects args without a shell executable", () => {
    expect(validateShellSpawnSelection(undefined, ["-d", "Ubuntu"])).toMatch(/shell executable/i);
  });

  it("allows empty shell for profile default", () => {
    expect(validateShellSpawnSelection(undefined, [])).toBeNull();
  });

  it("requires explicit shell when requested", () => {
    expect(
      validateShellSpawnSelection("", [], { requireExplicitShell: true }),
    ).toMatch(/Enter a shell executable/i);
  });
});
