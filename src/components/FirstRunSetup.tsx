import { useCallback, useEffect, useState } from "react";
import { normalizeQuickStartProfile, QUICKSTART_ROUTING, toQuickStartProviders } from "../core/onboarding";
import { isExecutableProvider } from "../core/providerUiState";
import type { ProviderRoutingSettings, ProviderSettings, TerminalProfile } from "../core/terminal";
import {
  providerApiKeySet,
  profileGet,
  profilePatch,
  providerEndpointSet,
  providerRoutingGet,
  providerRoutingPatch,
  providerSettingsGet,
  providerSetEnabled,
  shellIntegrationInstall,
  shellIntegrationSettingsGet,
  shellIntegrationSettingsPatch,
  shellIntegrationStatus,
} from "../core/terminal";
import { isTauri } from "../core/tauriRuntime";
import {
  MACH_MINIMAL_PROMPT_BASH,
  MACH_MINIMAL_PROMPT_PWSH,
  MACH_MINIMAL_PROMPT_ZSH,
  MACH_SNIPPET_OSC7_BASH,
  MACH_SNIPPET_OSC7_PWSH,
  MACH_SNIPPET_OSC7_ZSH,
} from "../core/machShellSnippets";

export const ONBOARDING_STORAGE_KEY = "mach-terminal.onboarding.v1";

const SNIPPET_PWSH = MACH_MINIMAL_PROMPT_PWSH;
const SNIPPET_BASH = MACH_MINIMAL_PROMPT_BASH;
const SNIPPET_ZSH = MACH_MINIMAL_PROMPT_ZSH;

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called after successful save so parent can refresh provider descriptors and routing. */
  onSaved: () => void | Promise<void>;
};

export function shouldShowOnboardingPwshCta(args: {
  tauri: boolean;
  promptSeen: boolean;
  alreadyInstalled: boolean;
  hardStatusError: boolean;
}): boolean {
  return args.tauri && !args.promptSeen && !args.alreadyInstalled && !args.hardStatusError;
}

export function FirstRunSetup({ open, onClose, onSaved }: Props) {
  const [profile, setProfile] = useState<TerminalProfile>({ env: {}, font_size: 13 });
  const [providers, setProviders] = useState<ProviderSettings[]>([]);
  const [routing, setRouting] = useState<ProviderRoutingSettings>({
    default_provider: "ollama",
    ollama_model: "llama3.2",
    openai_model: "gpt-4o-mini",
    anthropic_model: "claude-3-5-haiku-latest",
    custom_openai_model: "gpt-4o-mini",
    ai_feature_enabled: false,
  });
  const [providerApiKeyDrafts, setProviderApiKeyDrafts] = useState<Record<string, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pwshHookBusy, setPwshHookBusy] = useState(false);
  const [pwshHookOk, setPwshHookOk] = useState(false);
  const [pwshHookErr, setPwshHookErr] = useState<string | null>(null);
  const [pwshPromptDismissBusy, setPwshPromptDismissBusy] = useState(false);
  const [pwshOnboardingPromptSeen, setPwshOnboardingPromptSeen] = useState(false);
  const [pwshHookAlreadyInstalled, setPwshHookAlreadyInstalled] = useState(false);
  const [pwshHardStatusError, setPwshHardStatusError] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [p, pv, r] = await Promise.all([profileGet(), providerSettingsGet(), providerRoutingGet()]);
        let nextPromptSeen = false;
        let nextHookInstalled = false;
        let nextHardStatusError = false;
        if (isTauri()) {
          const [settingsRes, statusRes] = await Promise.allSettled([
            shellIntegrationSettingsGet(),
            shellIntegrationStatus(),
          ]);
          if (settingsRes.status === "fulfilled") {
            nextPromptSeen = settingsRes.value.onboardingInstallPromptSeen;
          }
          if (statusRes.status === "fulfilled") {
            const pwshRow = statusRes.value.shells.find((row) => row.shellKind === "pwsh");
            if (pwshRow) {
              nextHookInstalled = pwshRow.markerPresent;
              nextHardStatusError = Boolean(pwshRow.error && !pwshRow.profileResolved);
            }
          }
        }
        if (!cancelled) {
          setProfile(p);
          setProviders(pv);
          setProviderApiKeyDrafts(() =>
            pv.reduce<Record<string, string>>((acc, provider) => {
              acc[provider.id] = "";
              return acc;
            }, {}),
          );
          setRouting(r);
          setPwshOnboardingPromptSeen(nextPromptSeen);
          setPwshHookAlreadyInstalled(nextHookInstalled);
          setPwshHardStatusError(nextHardStatusError);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load settings");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const updateProvider = useCallback((id: string, patch: Partial<ProviderSettings>) => {
    setProviders((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const save = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await profilePatch({
        shell: profile.shell ?? null,
        cwd: profile.cwd ?? null,
        font_size: profile.font_size,
        minimal_shell_prompt: profile.minimal_shell_prompt ?? false,
      });
      await Promise.all(
        providers.map(async (provider) => {
          await providerSetEnabled(provider.id, provider.enabled);
          await providerEndpointSet(provider.id, provider.endpoint ?? null);
          const apiKey = providerApiKeyDrafts[provider.id]?.trim();
          if (apiKey) {
            await providerApiKeySet(provider.id, apiKey);
          }
        }),
      );
      await providerRoutingPatch({
        default_provider: routing.default_provider,
        ollama_model: routing.ollama_model,
        openai_model: routing.openai_model,
        anthropic_model: routing.anthropic_model,
        custom_openai_model: routing.custom_openai_model,
        ai_feature_enabled: routing.ai_feature_enabled,
      });
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "done");
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }, [onClose, onSaved, profile, providerApiKeyDrafts, providers, routing]);

  const quickStart = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const quickStartProfile = normalizeQuickStartProfile(profile);
      await profilePatch({
        shell: quickStartProfile.shell ?? null,
        cwd: quickStartProfile.cwd ?? null,
        font_size: quickStartProfile.font_size,
        minimal_shell_prompt: quickStartProfile.minimal_shell_prompt ?? false,
      });

      const quickStartProviders = toQuickStartProviders(providers);
      await Promise.all(
        quickStartProviders.map(async (provider) => {
          await providerSetEnabled(provider.id, false);
        }),
      );

      await providerRoutingPatch({
        default_provider: QUICKSTART_ROUTING.default_provider,
        ollama_model: QUICKSTART_ROUTING.ollama_model,
        openai_model: QUICKSTART_ROUTING.openai_model,
        anthropic_model: QUICKSTART_ROUTING.anthropic_model,
        custom_openai_model: QUICKSTART_ROUTING.custom_openai_model,
        ai_feature_enabled: QUICKSTART_ROUTING.ai_feature_enabled,
      });
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "done");
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Quick start failed");
    } finally {
      setLoading(false);
    }
  }, [onClose, onSaved, profile, providers]);

  const skip = useCallback(() => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "skipped");
    onClose();
  }, [onClose]);

  const installPwshHookFromOnboarding = useCallback(async () => {
    if (!isTauri()) {
      return;
    }
    setPwshHookBusy(true);
    setPwshHookErr(null);
    setPwshHookOk(false);
    try {
      await shellIntegrationInstall("pwsh");
      await shellIntegrationSettingsPatch({ onboardingInstallPromptSeen: true });
      setPwshHookOk(true);
      setPwshOnboardingPromptSeen(true);
      setPwshHookAlreadyInstalled(true);
    } catch (e) {
      setPwshHookErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPwshHookBusy(false);
    }
  }, []);

  const dismissPwshInstallPrompt = useCallback(async () => {
    if (!isTauri()) {
      return;
    }
    setPwshPromptDismissBusy(true);
    setPwshHookErr(null);
    try {
      await shellIntegrationSettingsPatch({ onboardingInstallPromptSeen: true });
      setPwshOnboardingPromptSeen(true);
    } catch (e) {
      setPwshHookErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPwshPromptDismissBusy(false);
    }
  }, []);

  if (!open) {
    return null;
  }

  const onboardingState = typeof window !== "undefined" ? window.localStorage.getItem(ONBOARDING_STORAGE_KEY) : "done";
  const showSkip = onboardingState !== "done" && onboardingState !== "skipped";
  const showPwshInstallPrompt = shouldShowOnboardingPwshCta({
    tauri: isTauri(),
    promptSeen: pwshOnboardingPromptSeen,
    alreadyInstalled: pwshHookAlreadyInstalled,
    hardStatusError: pwshHardStatusError,
  });

  return (
    <div className="modal-overlay" role="presentation" onClick={() => !loading && !showSkip && onClose()}>
      <div
        className="modal-card setup-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="setup-title">Profile &amp; providers</h2>
        <p className="muted-block">
          Quick start gets you to a working terminal session fast. Advanced provider/routing settings are optional and can be changed anytime from <strong>Settings</strong>.
        </p>

        {error ? <p className="error-text">{error}</p> : null}

        <section className="setup-section">
          <h3>Terminal profile</h3>
          <label className="field-row">
            <span>Shell (optional)</span>
            <input
              type="text"
              placeholder="e.g. pwsh, bash, zsh"
              value={profile.shell ?? ""}
              onChange={(e) => setProfile((p) => ({ ...p, shell: e.target.value || undefined }))}
            />
          </label>
          <label className="field-row">
            <span>Working directory (optional)</span>
            <input
              type="text"
              placeholder="Path for new sessions"
              value={profile.cwd ?? ""}
              onChange={(e) => setProfile((p) => ({ ...p, cwd: e.target.value || undefined }))}
            />
          </label>
          <label className="field-row">
            <span>Font size (px)</span>
            <input
              type="number"
              min={8}
              max={32}
              value={profile.font_size}
              onChange={(e) =>
                setProfile((p) => ({ ...p, font_size: Number.parseInt(e.target.value, 10) || p.font_size }))
              }
            />
          </label>
          <div className="minimal-prompt-snippet-block mach-osc7-block">
            <p className="muted-block">
              <strong>Shell integration (OSC 7).</strong> Mach reads cwd from your shell so the status strip (path, git,
              restart) matches where you are. Prefer <strong>Settings → Shell integration</strong> to install a hook
              automatically; or paste the block for your shell into your profile — the PowerShell version uses{" "}
              <code>LocationChangedAction</code> so it works with Oh My Posh without replacing your prompt. Oh My Posh
              icons use Nerd Font codepoints; Mach bundles a symbol font so those glyphs render without a separate OS
              install.
            </p>
            {showPwshInstallPrompt ? (
              <div className="shell-hook-cta">
                <div className="inline-controls">
                  <button
                    type="button"
                    className="inline-btn"
                    disabled={loading || pwshHookBusy || pwshPromptDismissBusy}
                    onClick={() => void installPwshHookFromOnboarding()}
                  >
                    {pwshHookBusy ? "Installing…" : "Install PowerShell hook now"}
                  </button>
                  <button
                    type="button"
                    className="inline-btn ghost"
                    disabled={loading || pwshHookBusy || pwshPromptDismissBusy}
                    onClick={() => void dismissPwshInstallPrompt()}
                  >
                    {pwshPromptDismissBusy ? "Saving…" : "Not now"}
                  </button>
                </div>
                {pwshHookOk ? (
                  <p className="muted-block">
                    Hook installed into your profile. Open a new session (or restart the shell) for OSC 7 cwd updates.
                  </p>
                ) : null}
                {pwshHookErr ? <p className="error-text">{pwshHookErr}</p> : null}
              </div>
            ) : null}
            <div className="minimal-prompt-snippet-row">
              <span className="minimal-prompt-snippet-label">PowerShell</span>
              <button
                type="button"
                className="inline-btn ghost"
                onClick={() => void navigator.clipboard.writeText(MACH_SNIPPET_OSC7_PWSH)}
              >
                Copy OSC 7
              </button>
            </div>
            <pre className="minimal-prompt-snippet">{MACH_SNIPPET_OSC7_PWSH}</pre>
            <div className="minimal-prompt-snippet-row">
              <span className="minimal-prompt-snippet-label">Bash</span>
              <button
                type="button"
                className="inline-btn ghost"
                onClick={() => void navigator.clipboard.writeText(MACH_SNIPPET_OSC7_BASH)}
              >
                Copy OSC 7
              </button>
            </div>
            <pre className="minimal-prompt-snippet">{MACH_SNIPPET_OSC7_BASH}</pre>
            <div className="minimal-prompt-snippet-row">
              <span className="minimal-prompt-snippet-label">zsh</span>
              <button
                type="button"
                className="inline-btn ghost"
                onClick={() => void navigator.clipboard.writeText(MACH_SNIPPET_OSC7_ZSH)}
              >
                Copy OSC 7
              </button>
            </div>
            <pre className="minimal-prompt-snippet">{MACH_SNIPPET_OSC7_ZSH}</pre>
          </div>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={profile.minimal_shell_prompt ?? false}
              onChange={(e) =>
                setProfile((p) => ({
                  ...p,
                  minimal_shell_prompt: e.target.checked,
                }))
              }
            />
            Minimal shell prompt for new sessions (sets <code>MACH_TERMINAL_MINIMAL_PROMPT</code>; use snippets below)
          </label>
          <p className="muted-block">
            When enabled, Mach still shows path/git/time in the strip above the input; this option only helps thin out
            the shell&apos;s own prompt line in scrollback once you paste a snippet into your shell profile.
          </p>
          <div className="minimal-prompt-snippet-block">
            <div className="minimal-prompt-snippet-row">
              <span className="minimal-prompt-snippet-label">PowerShell</span>
              <button
                type="button"
                className="inline-btn ghost"
                onClick={() => void navigator.clipboard.writeText(SNIPPET_PWSH)}
              >
                Copy snippet
              </button>
            </div>
            <pre className="minimal-prompt-snippet">{SNIPPET_PWSH}</pre>
            <div className="minimal-prompt-snippet-row">
              <span className="minimal-prompt-snippet-label">Bash</span>
              <button
                type="button"
                className="inline-btn ghost"
                onClick={() => void navigator.clipboard.writeText(SNIPPET_BASH)}
              >
                Copy snippet
              </button>
            </div>
            <pre className="minimal-prompt-snippet">{SNIPPET_BASH}</pre>
            <div className="minimal-prompt-snippet-row">
              <span className="minimal-prompt-snippet-label">zsh</span>
              <button
                type="button"
                className="inline-btn ghost"
                onClick={() => void navigator.clipboard.writeText(SNIPPET_ZSH)}
              >
                Copy snippet
              </button>
            </div>
            <pre className="minimal-prompt-snippet">{SNIPPET_ZSH}</pre>
          </div>
        </section>

        <section className="setup-section">
          <button type="button" className="inline-btn ghost" onClick={() => setShowAdvanced((current) => !current)}>
            {showAdvanced ? "Hide advanced AI settings" : "Show advanced AI settings"}
          </button>
          {showAdvanced ? (
            <>
              <h3>Providers</h3>
              <ul className="setup-provider-list">
                {providers.map((row) => {
                  const executable = isExecutableProvider(row.id);
                  return (
                    <li key={row.id}>
                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          onChange={(e) => updateProvider(row.id, { enabled: e.target.checked })}
                          disabled={!executable && !row.enabled}
                        />
                        <span>
                          {row.id}
                          {!executable ? " (unavailable)" : ""}
                        </span>
                      </label>
                      <input
                        type="text"
                        className="endpoint-input"
                        placeholder="Endpoint URL (if applicable)"
                        value={row.endpoint ?? ""}
                        onChange={(e) => updateProvider(row.id, { endpoint: e.target.value || undefined })}
                        disabled={!executable}
                      />
                      <input
                        type="password"
                        className="endpoint-input"
                        placeholder="API key (stored securely)"
                        value={providerApiKeyDrafts[row.id] ?? ""}
                        onChange={(e) =>
                          setProviderApiKeyDrafts((current) => ({ ...current, [row.id]: e.target.value }))
                        }
                        disabled={!executable}
                      />
                      {row.api_key_env ? (
                        <small className="muted-block">API key env: {row.api_key_env}</small>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              <h3>Routing</h3>
              <label className="field-row">
                <span>Default provider id</span>
                <select
                  value={routing.default_provider}
                  onChange={(e) => setRouting((r) => ({ ...r, default_provider: e.target.value }))}
                >
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id} disabled={!isExecutableProvider(provider.id)}>
                      {provider.id}
                      {!isExecutableProvider(provider.id) ? " (unavailable)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-row">
                <span>Ollama model</span>
                <input
                  type="text"
                  value={routing.ollama_model}
                  onChange={(e) => setRouting((r) => ({ ...r, ollama_model: e.target.value }))}
                />
              </label>
              <label className="field-row">
                <span>OpenAI model</span>
                <input
                  type="text"
                  value={routing.openai_model}
                  onChange={(e) => setRouting((r) => ({ ...r, openai_model: e.target.value }))}
                />
              </label>
              <label className="field-row">
                <span>Anthropic model</span>
                <input
                  type="text"
                  value={routing.anthropic_model}
                  onChange={(e) => setRouting((r) => ({ ...r, anthropic_model: e.target.value }))}
                />
              </label>
              <label className="field-row">
                <span>Custom OpenAI model</span>
                <input
                  type="text"
                  value={routing.custom_openai_model}
                  onChange={(e) => setRouting((r) => ({ ...r, custom_openai_model: e.target.value }))}
                />
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={routing.ai_feature_enabled}
                  onChange={(e) => setRouting((r) => ({ ...r, ai_feature_enabled: e.target.checked }))}
                />
                Opt in to AI features (still requires enabled providers)
              </label>
            </>
          ) : null}
        </section>

        <div className="modal-actions">
          <button type="button" className="inline-btn" onClick={() => void quickStart()} disabled={loading}>
            {loading ? "Starting..." : "Quick start (AI off)"}
          </button>
          {showSkip ? (
            <button type="button" className="inline-btn ghost" onClick={() => skip()} disabled={loading}>
              Skip for now
            </button>
          ) : null}
          <button type="button" className="inline-btn primary" onClick={() => void save()} disabled={loading}>
            {loading ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
