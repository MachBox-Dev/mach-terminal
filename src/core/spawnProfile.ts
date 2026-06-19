import type { TerminalProfile } from "./terminal";

export interface ShellSpawnSelection {
  shell: string | undefined;
  args: string[];
}

/** Merge a saved profile with a one-off shell/args choice for a new tab spawn. */
export function spawnProfileFromShellSelection(
  baseProfile: TerminalProfile,
  selection: ShellSpawnSelection,
): TerminalProfile {
  const profile: TerminalProfile = { ...baseProfile, env: { ...baseProfile.env } };
  const shell = selection.shell?.trim();
  if (shell) {
    profile.shell = shell;
  } else {
    delete profile.shell;
  }
  profile.args = selection.args.length > 0 ? [...selection.args] : undefined;
  return profile;
}
