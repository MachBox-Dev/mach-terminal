import type { SessionCwdMap } from "./sessionCwd";
import type { PtySessionInfo, TerminalProfile } from "./terminal";

export interface ShellSpawnSelection {
  shell: string | undefined;
  args: string[];
  env?: Record<string, string>;
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
  if (selection.env) {
    profile.env = { ...profile.env, ...selection.env };
  }
  return profile;
}

/** Clone the active pane's shell/cwd/args for an in-tab split spawn. */
export function spawnProfileForLiveSession(
  baseProfile: TerminalProfile,
  session: PtySessionInfo,
  spawnArgsBySession: Record<string, string[]>,
  cwdBySession: SessionCwdMap,
): TerminalProfile {
  const shell = session.shell?.trim();
  const args = spawnArgsBySession[session.id] ?? baseProfile.args ?? [];
  const profile = spawnProfileFromShellSelection(baseProfile, {
    shell: shell || baseProfile.shell,
    args: [...args],
  });
  const cwd = cwdBySession[session.id] ?? session.cwd ?? baseProfile.cwd;
  if (cwd && cwd.length > 0) {
    profile.cwd = cwd;
  }
  return profile;
}
