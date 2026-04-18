import { useCallback, useEffect, useState } from "react";
import { normalizeQuickStartProfile, QUICKSTART_ROUTING, toQuickStartProviders } from "../core/onboarding";
import { isExecutableProvider } from "../core/providerUiState";
import type { ProviderRoutingSettings, ProviderSettings, TerminalProfile } from "../core/terminal";
import {
  profileGet,
  profilePatch,
  providerEndpointSet,
  providerRoutingGet,
  providerRoutingPatch,
  providerSettingsGet,
  providerSetEnabled,
} from "../core/terminal";

export const ONBOARDING_STORAGE_KEY = "mach-terminal.onboarding.v1";

const SNIPPET_PWSH =
  "# Mach Terminal: paste into $PROFILE when Minimal shell prompt is enabled in Mach.\nif ($env:MACH_TERMINAL_MINIMAL_PROMPT -eq '1') { function prompt { '> ' } }";

const SNIPPET_BASH = `# Mach Terminal: paste into ~/.bashrc when Minimal shell prompt is enabled.
if [ "$MACH_TERMINAL_MINIMAL_PROMPT" = "1" ]; then PS1='> '; fi`;

const SNIPPET_ZSH = `# Mach Terminal: paste into ~/.zshrc when Minimal shell prompt is enabled.
[[ "$MACH_TERMINAL_MINIMAL_PROMPT" == "1" ]] && PROMPT='> '`;

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called after successful save so parent can refresh provider descriptors and routing. */
  onSaved: () => void | Promise<void>;
};

export function FirstRunSetup({ open, onClose, onSaved }: Props) {
  const [profile, setProfile] = useState<TerminalProfile>({ env: {}, font_size: 13 });
  const [providers, setProviders] = useState<ProviderSettings[]>([]);
  const [routing, setRouting] = useState<ProviderRoutingSettings>({
    default_provider: "ollama",
    ollama_model: "llama3.2",
    ai_feature_enabled: false,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [p, pv, r] = await Promise.all([profileGet(), providerSettingsGet(), providerRoutingGet()]);
        if (!cancelled) {
          setProfile(p);
          setProviders(pv);
          setRouting(r);
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
        }),
      );
      await providerRoutingPatch({
        default_provider: routing.default_provider,
        ollama_model: routing.ollama_model,
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
  }, [profile, providers, routing, onClose, onSaved]);

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

  if (!open) {
    return null;
  }

  const onboardingState = typeof window !== "undefined" ? window.localStorage.getItem(ONBOARDING_STORAGE_KEY) : "done";
  const showSkip = onboardingState !== "done" && onboardingState !== "skipped";

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
