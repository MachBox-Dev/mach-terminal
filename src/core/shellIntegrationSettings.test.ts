import { describe, expect, it } from "vitest";

describe("shellIntegrationSettings patch payload", () => {
  it("supports clearing pwsh override with null", () => {
    const patch = { pwshProfileOverride: null as string | null };
    expect(patch.pwshProfileOverride).toBeNull();
  });

  it("supports onboarding flag", () => {
    expect({ onboardingInstallPromptSeen: true }).toEqual(
      expect.objectContaining({ onboardingInstallPromptSeen: true }),
    );
  });

  it("supports backup restore arguments", () => {
    const args = { shell_kind: "pwsh", backup_id: "1713072222000:profile.1713072222000.mach.bak" };
    expect(args).toEqual(
      expect.objectContaining({
        shell_kind: "pwsh",
        backup_id: expect.stringContaining(".mach.bak"),
      }),
    );
  });

  it("supports shell status diagnostics fields", () => {
    const diagnostics = {
      health: "stale",
      backupCount: 2,
      capabilities: { supportsBackupRestore: true, supportsProfileOverride: false },
    };
    expect(diagnostics).toEqual(
      expect.objectContaining({
        health: "stale",
        backupCount: 2,
        capabilities: expect.objectContaining({ supportsBackupRestore: true }),
      }),
    );
  });
});
