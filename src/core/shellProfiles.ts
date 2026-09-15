import type { ShellCandidate } from "./terminal";

/** Sentinel option id for the "type your own shell" path in the picker. */
export const CUSTOM_SHELL_OPTION_ID = "__custom__";

/** Dropdown value prefix for saved shell presets in the picker. */
export const PRESET_SHELL_OPTION_PREFIX = "preset:";

const GROUP_LABELS: Record<string, string> = {
  native: "Installed shells",
  wsl: "WSL distros",
  posix: "Login shells",
};

const GROUP_ORDER = ["native", "wsl", "posix"];

export interface ShellCandidateGroup {
  kind: string;
  label: string;
  items: ShellCandidate[];
}

function quoteArgForPreview(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  return /\s|"/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/**
 * Human-readable rendering of the exact command a profile will spawn, e.g.
 * `wsl.exe -d Ubuntu`. Empty shell means "let the backend pick the platform default".
 */
export function formatShellCommandPreview(shell: string | null | undefined, args: string[]): string {
  const exe = (shell ?? "").trim();
  if (!exe) {
    return "(system default shell)";
  }
  return [exe, ...args].map(quoteArgForPreview).join(" ");
}

/** Parse a one-argument-per-line textarea into a trimmed list (blank lines dropped). */
export function parseArgsLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Inverse of {@link parseArgsLines} for seeding the advanced editor. */
export function argsToLines(args: string[]): string {
  return args.join("\n");
}

export function sameArgs(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Resolve which dropdown option matches the current profile selection. Falls back
 * to the custom sentinel when no detected candidate has the same shell + args, so
 * hand-edited or imported profiles surface in the Advanced editor instead of
 * silently snapping to an unrelated entry.
 */
export function selectedCandidateId(
  candidates: ShellCandidate[],
  shell: string | null | undefined,
  args: string[],
  presetOptionId?: string | null,
): string {
  if (presetOptionId) {
    return presetOptionId;
  }
  const exe = (shell ?? "").trim();
  if (!exe) {
    const fallbackDefault = candidates.find((candidate) => candidate.is_default && candidate.available);
    return fallbackDefault ? fallbackDefault.id : CUSTOM_SHELL_OPTION_ID;
  }
  const match = candidates.find((candidate) => candidate.shell === exe && sameArgs(candidate.args, args));
  return match ? match.id : CUSTOM_SHELL_OPTION_ID;
}

/** Group candidates into ordered, labeled buckets for `<optgroup>` rendering. */
export function groupShellCandidates(candidates: ShellCandidate[]): ShellCandidateGroup[] {
  const byKind = new Map<string, ShellCandidate[]>();
  for (const candidate of candidates) {
    const list = byKind.get(candidate.kind) ?? [];
    list.push(candidate);
    byKind.set(candidate.kind, list);
  }

  const groups: ShellCandidateGroup[] = [];
  const seen = new Set<string>();
  for (const kind of GROUP_ORDER) {
    const items = byKind.get(kind);
    if (items && items.length > 0) {
      groups.push({ kind, label: GROUP_LABELS[kind] ?? kind, items });
      seen.add(kind);
    }
  }
  for (const [kind, items] of byKind) {
    if (!seen.has(kind) && items.length > 0) {
      groups.push({ kind, label: GROUP_LABELS[kind] ?? kind, items });
    }
  }
  return groups;
}

export interface ShellSelection {
  shell: string | undefined;
  args: string[];
}

/** Translate a chosen candidate id into the profile fields it should write. */
export function selectionForCandidateId(candidates: ShellCandidate[], id: string): ShellSelection | null {
  if (id === CUSTOM_SHELL_OPTION_ID) {
    return null;
  }
  const candidate = candidates.find((entry) => entry.id === id);
  if (!candidate) {
    return null;
  }
  return { shell: candidate.shell, args: [...candidate.args] };
}

export function shellCandidatePaletteId(candidateId: string): string {
  return `shell:${candidateId}`;
}

export function parseShellCandidatePaletteId(commandId: string): string | null {
  return commandId.startsWith("shell:") ? commandId.slice("shell:".length) : null;
}

export function shellPresetOptionId(presetId: string): string {
  return `${PRESET_SHELL_OPTION_PREFIX}${presetId}`;
}

export function parseShellPresetOptionId(optionId: string): string | null {
  return optionId.startsWith(PRESET_SHELL_OPTION_PREFIX)
    ? optionId.slice(PRESET_SHELL_OPTION_PREFIX.length)
    : null;
}

/** User-facing validation before spawning from a picker selection. */
export function validateShellSpawnSelection(
  shell: string | null | undefined,
  args: string[],
  options?: { requireExplicitShell?: boolean },
): string | null {
  const exe = (shell ?? "").trim();
  const hasArgs = args.some((arg) => arg.trim().length > 0);
  if (options?.requireExplicitShell && !exe) {
    return "Enter a shell executable in Advanced, or pick a shell from the list.";
  }
  if (!exe && hasArgs) {
    return "Arguments need a shell executable — enter one in Advanced or pick a listed shell.";
  }
  return null;
}
