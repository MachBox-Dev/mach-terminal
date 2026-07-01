import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { WorkspaceLayout } from "../state/workspace";
import type { ProviderDescriptor, ProviderSettings } from "./providers";

export type { WorkspaceLayout } from "../state/workspace";

export type { ProviderSettings } from "./providers";

export type SessionStatus = "idle" | "starting" | "running" | "stopped" | "closed" | "error";

export interface TerminalProfile {
  shell?: string;
  /** Args passed to the shell exe on spawn (e.g. `["-d", "Ubuntu"]` for wsl.exe). */
  args?: string[];
  cwd?: string;
  env: Record<string, string>;
  font_size: number;
  /** When true, spawns set `MACH_TERMINAL_MINIMAL_PROMPT=1` for optional shell profile snippets. */
  minimal_shell_prompt?: boolean;
  /** When true, show completion assist metrics in the composer (in addition to dev builds). */
  show_composer_assist_metrics?: boolean;
}

export interface ProfilePatch {
  shell?: string | null;
  /** Replaces args wholesale; omit for no change. */
  args?: string[];
  cwd?: string | null;
  font_size?: number;
  minimal_shell_prompt?: boolean;
  show_composer_assist_metrics?: boolean;
}

/** A shell the backend detected (or a known default) for the profile picker. */
export interface ShellCandidate {
  id: string;
  label: string;
  shell: string;
  args: string[];
  /** Coarse grouping: `native` | `wsl` | `posix`. */
  kind: string;
  available: boolean;
  is_default: boolean;
}

/** Saved shell launch preset (Settings CRUD + palette quick-open). */
export interface ShellPreset {
  id: string;
  name: string;
  shell: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface PtySpawnRequest {
  profile?: TerminalProfile;
  cols?: number;
  rows?: number;
}

export interface PtySessionInfo {
  id: string;
  shell: string;
  cwd?: string;
  status: SessionStatus;
}

export interface PtyOutputEvent {
  session_id: string;
  data: string;
  sequence: number;
}

export interface PtyLifecycleEvent {
  session_id: string;
  status: SessionStatus;
  message?: string;
  timestamp_ms: number;
  /**
   * Process exit code as reported by `portable_pty::ExitStatus::exit_code()`, downcast
   * to a signed `i32` on the Rust side. Populated only by the EOF-driven `stopped`
   * transition - `running`, `closed`, and `error` events omit the field entirely, and
   * older builds without the Rust-side plumbing also omit it, so consumers must treat
   * this as optional.
   */
  exit_code?: number;
}

/**
 * Emitted by the Rust reader thread whenever a shell-reported `OSC 7` sequence
 * (`ESC ] 7 ; file://host/path <terminator>`) decodes to a *different* absolute
 * path than the one we already have on file for the session. The event is pure
 * telemetry - lifecycle status is untouched - and is meant to feed a live cwd
 * map so `restartSessionById` can land the replacement shell where the old one
 * left off. Shells without the hook simply never emit, so absence is the
 * expected steady-state for unconfigured setups.
 */
export interface PtyCwdChangedEvent {
  session_id: string;
  cwd: string;
  timestamp_ms: number;
}

export type PtyCommandMarkerPhase = "promptStart" | "commandStart" | "outputStart" | "outputEnd";

export interface PtyCommandMarkerEvent {
  session_id: string;
  phase: PtyCommandMarkerPhase;
  exit_code?: number;
  timestamp_ms: number;
}

export interface AiContextEvent {
  session_id: string;
  event_type: "command_submitted" | "output_chunk";
  payload: string;
  sequence: number;
  timestamp_ms: number;
  source: "pty" | "input" | "system";
}

/**
 * Mirrors `AiNotePayload` in `src-tauri/src/models.rs`. Delivered via the
 * `machterm://ai-note` deep link — see `docs/deep-link-contract.md`.
 */
export interface AiNotePayload {
  label?: string;
  text: string;
}

/**
 * Mirrors `ComposerPayload` in `src-tauri/src/models.rs`. Delivered via the
 * `machterm://composer` deep link — see `docs/deep-link-contract.md`.
 */
export interface ComposerPayload {
  label?: string;
  text: string;
}

export interface ProviderRoutingSettings {
  default_provider: string;
  ollama_model: string;
  openai_model: string;
  anthropic_model: string;
  custom_openai_model: string;
  ai_feature_enabled: boolean;
  system_prompt: string;
  ai_context_budget_chars: number;
}

export interface ProviderRoutingPatch {
  default_provider?: string;
  ollama_model?: string;
  openai_model?: string;
  anthropic_model?: string;
  custom_openai_model?: string;
  ai_feature_enabled?: boolean;
  system_prompt?: string;
  ai_context_budget_chars?: number;
}

export interface ProviderApiKeyStatus {
  provider_id: string;
  hasStoredKey: boolean;
}

export interface SettingsSchemaDebug {
  settings_path: string;
  file_exists: boolean;
  schema_version_in_file?: number;
  loaded_schema_version: number;
  migrated_from_legacy: boolean;
}

/** Optional structured hints assembled client-side; trimmed to strict size limits before invoke. */
export interface AiPromptContextPayload {
  cwd?: string | null;
  shell?: string | null;
  git_branch?: string | null;
  /** Primary command the user asked about (explain/fix). */
  command_text?: string | null;
  /** Trailing scrollback excerpt for the active session. */
  output_excerpt?: string | null;
}

export interface AiChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AiProviderMessage {
  role: "user" | "assistant" | "tool" | "system";
  content?: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: AiToolCall[];
}

export type AiExecuteIntent = "freeform" | "explain_command" | "fix_command";

export interface AiExecuteRequest {
  session_id: string;
  prompt: string;
  provider_id?: string;
  intent?: AiExecuteIntent;
  context?: AiPromptContextPayload;
  /** Prior turns; current `prompt` is the latest user message. */
  history?: AiChatTurn[];
  enable_tools?: boolean;
  use_provider_messages?: boolean;
  provider_messages?: AiProviderMessage[];
  tools?: unknown;
}

/** Match backend `MAX_CONTEXT_EXCERPT_CHARS` when slicing session scrollback for `output_excerpt`. */
export const AI_CONTEXT_OUTPUT_MAX_CHARS = 6000;

/** Keep trailing scrollback so recent errors are preserved when trimming. */
export function trimAiContextExcerpt(text: string | undefined | null, max = AI_CONTEXT_OUTPUT_MAX_CHARS): string | undefined {
  if (!text || text.length === 0) {
    return undefined;
  }
  return text.length <= max ? text : text.slice(text.length - max);
}

export interface AiExecuteResponse {
  provider_id: string;
  output: string;
  tool_calls?: AiToolCall[];
  finish_reason?: string;
}

/** Wire DTO for `ai_execute` (Rust `#[serde(rename_all = "camelCase")]`). */
export type AiExecuteRequestWire = {
  sessionId: string;
  prompt: string;
  providerId?: string;
  intent?: AiExecuteIntent;
  context?: {
    cwd?: string | null;
    shell?: string | null;
    gitBranch?: string | null;
    commandText?: string | null;
    outputExcerpt?: string | null;
  };
  history?: AiChatTurn[];
  enableTools?: boolean;
  useProviderMessages?: boolean;
  providerMessages?: AiProviderMessageWire[];
  tools?: unknown;
};

type AiProviderMessageWire = {
  role: AiProviderMessage["role"];
  content?: string | null;
  toolCallId?: string;
  name?: string;
  toolCalls?: AiToolCall[];
};

type AiExecuteResponseWire = {
  providerId: string;
  output: string;
  toolCalls?: AiToolCall[];
  finishReason?: string;
};

export function aiExecuteRequestToWire(request: AiExecuteRequest): AiExecuteRequestWire {
  const wire: AiExecuteRequestWire = {
    sessionId: request.session_id,
    prompt: request.prompt,
  };
  if (request.provider_id != null) {
    wire.providerId = request.provider_id;
  }
  if (request.intent != null) {
    wire.intent = request.intent;
  }
  if (request.context != null) {
    wire.context = {
      cwd: request.context.cwd,
      shell: request.context.shell,
      gitBranch: request.context.git_branch,
      commandText: request.context.command_text,
      outputExcerpt: request.context.output_excerpt,
    };
  }
  if (request.history != null) {
    wire.history = request.history;
  }
  if (request.enable_tools != null) {
    wire.enableTools = request.enable_tools;
  }
  if (request.use_provider_messages != null) {
    wire.useProviderMessages = request.use_provider_messages;
  }
  if (request.provider_messages != null) {
    wire.providerMessages = request.provider_messages.map((message) => ({
      role: message.role,
      content: message.content,
      toolCallId: message.tool_call_id,
      name: message.name,
      toolCalls: message.tool_calls,
    }));
  }
  if (request.tools != null) {
    wire.tools = request.tools;
  }
  return wire;
}

export function aiExecuteResponseFromWire(response: AiExecuteResponseWire): AiExecuteResponse {
  return {
    provider_id: response.providerId,
    output: response.output,
    tool_calls: response.toolCalls,
    finish_reason: response.finishReason,
  };
}

export interface HistoryEntry {
  id: number;
  session_id: string;
  command: string;
  timestamp_ms: number;
}

export interface HistoryQueryRequest {
  query?: string;
  session_id?: string;
  limit?: number;
}

export interface ComposerCompletionRequest {
  draft: string;
  cursor: number;
  cwd?: string;
  shell?: string;
  /** When set, backend resolves cwd from the live PTY session (authoritative vs UI hints). */
  sessionId?: string;
  limit?: number;
}

export interface ComposerCompletionCandidate {
  value: string;
  kind: "path" | "command" | string;
}

export interface ComposerCompletionResponse {
  replacementStart: number;
  replacementEnd: number;
  query: string;
  candidates: ComposerCompletionCandidate[];
}

export interface RuntimeMetricsSnapshot {
  output_chunks_emitted: number;
  output_chunks_dropped: number;
  output_bytes_emitted: number;
  emit_failures: number;
  sequence_anomalies: number;
  write_failures: number;
  resize_failures: number;
  close_failures: number;
  active_sessions: number;
  max_chunk_size: number;
}

export interface RuntimeCapabilitiesSnapshot {
  pty_backend: string;
  plugin_host: boolean;
  provider_host: boolean;
  session_persistence: boolean;
  provider_routing: boolean;
}

export interface RuntimeDebugSnapshot {
  capabilities: RuntimeCapabilitiesSnapshot;
  metrics: RuntimeMetricsSnapshot;
  sessions: PtySessionInfo[];
  history_recovery_pending: boolean;
  settings_path: string;
  history_path: string;
  timestamp_ms: number;
  debug_build: boolean;
}

export interface PluginExecutionResult {
  plugin_id: string;
  capability: string;
  accepted: boolean;
  message: string;
  reason_code: string;
  payload_bytes?: number;
  decision?: PluginPolicyDecision;
}

export interface PluginPolicyDecision {
  accepted: boolean;
  reasonCode: string;
  message: string;
}

export interface PluginGrantRequest {
  pluginId: string;
  capability: string;
}

export interface PluginExecuteRequest {
  pluginId: string;
  capability: string;
  payload: string;
}

export interface PluginMetricsSnapshot {
  grantsTotal: number;
  executionAllowedTotal: number;
  executionDeniedTotal: number;
  executionErrorTotal: number;
  executionTotal: number;
  cumulativeExecutionMs: number;
  lastExecutionMs: number | null;
  grantedPluginCount: number;
}

export interface PluginGrantSnapshot {
  pluginId: string;
  capabilities: string[];
}

export async function runtimeCapabilities() {
  return invoke("runtime_capabilities");
}

export async function detectShells() {
  return invoke<ShellCandidate[]>("detect_shells");
}

export async function profileGet() {
  return invoke<TerminalProfile>("profile_get");
}

export async function profileSet(profile: TerminalProfile) {
  return invoke<TerminalProfile>("profile_set", { profile });
}

export async function profilePatch(patch: ProfilePatch) {
  return invoke<TerminalProfile>("profile_patch", { patch });
}

export async function providerList() {
  return invoke<ProviderDescriptor[]>("provider_list");
}

export async function providerSettingsGet() {
  return invoke<ProviderSettings[]>("provider_settings_get");
}

export async function providerSettingsSet(providers: ProviderSettings[]) {
  return invoke<ProviderSettings[]>("provider_settings_set", { providers });
}

export async function providerSetEnabled(providerId: string, enabled: boolean) {
  return invoke<ProviderSettings[]>("provider_set_enabled", { providerId, enabled });
}

export async function providerEndpointSet(providerId: string, endpoint?: string | null) {
  return invoke<ProviderSettings[]>("provider_endpoint_set", { providerId, endpoint: endpoint ?? null });
}

export async function providerApiKeySet(providerId: string, apiKey: string) {
  return invoke("provider_api_key_set", { providerId, apiKey });
}

export async function providerApiKeyClear(providerId: string) {
  return invoke("provider_api_key_clear", { providerId });
}

export async function providerApiKeyStatus(providerId: string) {
  return invoke<ProviderApiKeyStatus>("provider_api_key_status", { providerId });
}

export async function providerRoutingGet() {
  return invoke<ProviderRoutingSettings>("provider_routing_get");
}

export async function providerRoutingSet(providerRouting: ProviderRoutingSettings) {
  return invoke<ProviderRoutingSettings>("provider_routing_set", { providerRouting });
}

export async function providerRoutingPatch(patch: ProviderRoutingPatch) {
  return invoke<ProviderRoutingSettings>("provider_routing_patch", { patch });
}

export async function settingsSchemaDump() {
  return invoke<SettingsSchemaDebug>("settings_schema_dump");
}

export async function ptySpawn(request: PtySpawnRequest) {
  return invoke<PtySessionInfo>("pty_spawn", { request });
}

export async function ptyWrite(sessionId: string, data: string) {
  return invoke("pty_write", { sessionId, data });
}

export async function ptyResize(sessionId: string, cols: number, rows: number) {
  return invoke("pty_resize", { sessionId, cols, rows });
}

export async function ptyClose(sessionId: string) {
  return invoke("pty_close", { sessionId });
}

export async function ptyListSessions() {
  return invoke<PtySessionInfo[]>("pty_list_sessions");
}

export async function historyQuery(request: HistoryQueryRequest) {
  return invoke<HistoryEntry[]>("history_query", { request });
}

/** One-shot message when command history file was corrupt and reset (returns null after first read). */
export async function historyRecoveryTake() {
  return invoke<string | null>("history_recovery_take");
}

export async function historyReplay(sessionId: string, command: string) {
  return invoke("history_replay", { sessionId, command });
}

export async function composerComplete(request: ComposerCompletionRequest) {
  return invoke<ComposerCompletionResponse>("composer_complete", { request });
}

export async function runtimeMetricsSnapshot() {
  return invoke<RuntimeMetricsSnapshot>("runtime_metrics_snapshot");
}

export interface ShellContextSnapshot {
  elevated: boolean;
  gitBranch: string | null;
  gitShortStat: string | null;
}

export async function shellContextSnapshot(cwd: string | null, includeGitDiff = false) {
  return invoke<ShellContextSnapshot>("shell_context_snapshot", {
    cwd,
    include_git_diff: includeGitDiff,
  });
}

export interface ShellIntegrationMaterializeResult {
  dir: string;
  version: number;
}

export interface ShellIntegrationShellStatus {
  shellKind: string;
  profilePath: string | null;
  profileResolved: boolean;
  markerPresent: boolean;
  /** `healthy`, `stale`, `missing`, or `error` */
  health: string;
  /** PowerShell sidecar backup count when applicable. */
  backupCount?: number | null;
  capabilities: {
    supportsBackupRestore: boolean;
    supportsProfileOverride: boolean;
  };
  /** `override`, `auto`, or omitted when pwsh profile could not be resolved */
  profilePathSource?: string | null;
  error: string | null;
}

export interface ShellIntegrationBackupEntry {
  backupId: string;
  fileName: string;
  createdAtMs: number;
  sizeBytes: number;
}

export interface ShellIntegrationBackupListResult {
  shellKind: string;
  profilePath: string;
  entries: ShellIntegrationBackupEntry[];
}

export interface ShellIntegrationBackupRestoreResult {
  shellKind: string;
  profilePath: string;
  restoredBackupId: string;
}

export interface ShellIntegrationSettings {
  pwshProfileOverride: string | null;
  onboardingInstallPromptSeen: boolean;
}

/** Patch shell integration preferences. Pass `pwshProfileOverride: null` to clear override. */
export interface ShellIntegrationPatch {
  pwshProfileOverride?: string | null;
  onboardingInstallPromptSeen?: boolean;
}

export interface ShellIntegrationStatus {
  scriptVersion: number;
  shellDir: string;
  shells: ShellIntegrationShellStatus[];
}

export async function shellIntegrationMaterializeScripts() {
  return invoke<ShellIntegrationMaterializeResult>("shell_integration_materialize_scripts");
}

export async function shellIntegrationStatus() {
  return invoke<ShellIntegrationStatus>("shell_integration_status");
}

export async function shellIntegrationSettingsGet() {
  return invoke<ShellIntegrationSettings>("shell_integration_settings_get");
}

export async function shellIntegrationSettingsPatch(patch: ShellIntegrationPatch) {
  return invoke<ShellIntegrationSettings>("shell_integration_settings_patch", { patch });
}

export async function shellPresetsGet() {
  return invoke<ShellPreset[]>("shell_presets_get");
}

export async function shellPresetsSet(presets: ShellPreset[]) {
  return invoke<ShellPreset[]>("shell_presets_set", { presets });
}

export async function shellIntegrationInstall(shellKind: "pwsh" | "bash" | "zsh") {
  return invoke<void>("shell_integration_install", { shell_kind: shellKind });
}

export async function shellIntegrationRemove(shellKind: "pwsh" | "bash" | "zsh") {
  return invoke<void>("shell_integration_remove", { shell_kind: shellKind });
}

export async function shellIntegrationBackupsList(shellKind: "pwsh" | "bash" | "zsh") {
  return invoke<ShellIntegrationBackupListResult>("shell_integration_backups_list", { shell_kind: shellKind });
}

export async function shellIntegrationBackupRestore(shellKind: "pwsh" | "bash" | "zsh", backupId: string) {
  return invoke<ShellIntegrationBackupRestoreResult>("shell_integration_backup_restore", {
    shell_kind: shellKind,
    backup_id: backupId,
  });
}

export async function workspaceLayoutGet() {
  return invoke<WorkspaceLayout | null>("workspace_layout_get");
}

export async function workspaceLayoutSet(layout: WorkspaceLayout) {
  return invoke("workspace_layout_set", { layout });
}

/** Debug Tauri builds only; throws if the backend was built without debug assertions. */
export async function runtimeDebugSnapshot() {
  return invoke<RuntimeDebugSnapshot>("runtime_debug_snapshot");
}

export async function pluginGrantCapability(request: PluginGrantRequest) {
  return invoke<PluginPolicyDecision>("plugin_grant_capability", { request });
}

export async function pluginExecute(request: PluginExecuteRequest) {
  return invoke<PluginExecutionResult>("plugin_execute", { request });
}

export async function pluginMetricsSnapshot() {
  return invoke<PluginMetricsSnapshot>("plugin_metrics_snapshot");
}

export async function pluginGrantsSnapshot() {
  return invoke<PluginGrantSnapshot[]>("plugin_grants_snapshot");
}

export async function aiExecute(request: AiExecuteRequest) {
  const response = await invoke<AiExecuteResponseWire>("ai_execute", {
    request: aiExecuteRequestToWire(request),
  });
  return aiExecuteResponseFromWire(response);
}

/** Max frames buffered when output arrives before the UI handler is wired (boot race). */
const PTY_OUTPUT_PREHANDLER_BACKLOG = 512;

type PtyOutputHandler = (event: PtyOutputEvent) => void;

let ptyOutputHandler: PtyOutputHandler | null = null;
let ptyOutputSubscribePromise: Promise<void> | null = null;
const ptyOutputSequenceBySession: Record<string, number> = {};
const ptyOutputPreHandlerBacklog: PtyOutputEvent[] = [];
const ptyOutputFrameDecoder = new TextDecoder();

function parsePtyOutputFrame(message: unknown): PtyOutputEvent | null {
  // The channel may surface the raw payload as an ArrayBuffer or a Uint8Array
  // view; normalize to a fresh Uint8Array (respects any byteOffset) either way.
  const bytes = new Uint8Array(message as ArrayBuffer);
  if (bytes.byteLength < 2) {
    return null;
  }
  const idLength = bytes[0] | (bytes[1] << 8);
  if (idLength > bytes.byteLength - 2) {
    return null;
  }
  const sessionId = ptyOutputFrameDecoder.decode(bytes.subarray(2, 2 + idLength));
  const data = ptyOutputFrameDecoder.decode(bytes.subarray(2 + idLength));
  const sequence = (ptyOutputSequenceBySession[sessionId] =
    (ptyOutputSequenceBySession[sessionId] ?? 0) + 1);
  return { session_id: sessionId, data, sequence };
}

function deliverPtyOutputEvent(event: PtyOutputEvent): void {
  const handler = ptyOutputHandler;
  if (handler) {
    handler(event);
    return;
  }
  if (ptyOutputPreHandlerBacklog.length < PTY_OUTPUT_PREHANDLER_BACKLOG) {
    ptyOutputPreHandlerBacklog.push(event);
  }
}

function setPtyOutputHandler(handler: PtyOutputHandler | null): void {
  ptyOutputHandler = handler;
  if (!handler || ptyOutputPreHandlerBacklog.length === 0) {
    return;
  }
  const backlog = ptyOutputPreHandlerBacklog.splice(0);
  for (const event of backlog) {
    handler(event);
  }
}

/**
 * Register the raw-bytes PTY output channel once. Safe to call from boot before
 * `onPtyOutput` wires the handler — frames that arrive early are backlog-buffered
 * and replayed when the handler is attached.
 */
export function ensurePtyOutputSubscribed(): Promise<void> {
  if (ptyOutputSubscribePromise) {
    return ptyOutputSubscribePromise;
  }
  ptyOutputSubscribePromise = (async () => {
    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = (message) => {
      const event = parsePtyOutputFrame(message);
      if (event) {
        deliverPtyOutputEvent(event);
      }
    };
    await invoke<void>("pty_subscribe_output", { onOutput: channel });
  })().catch((error) => {
    ptyOutputSubscribePromise = null;
    throw error;
  });
  return ptyOutputSubscribePromise;
}

/**
 * Subscribe to streamed PTY output over a Tauri `Channel` of raw bytes instead of
 * the (JSON-serializing, not-built-for-throughput) event system. The backend frames
 * each chunk as `[u16 LE session_id length][session_id utf8][chunk utf8]` and the
 * channel guarantees ordered delivery, so we synthesize a per-session monotonic
 * sequence to keep the downstream coalescing/anomaly contract (`nextSequenceState`)
 * unchanged — callers still receive the exact `PtyOutputEvent` shape.
 */
export function onPtyOutput(handler: PtyOutputHandler): Promise<UnlistenFn> {
  setPtyOutputHandler(handler);
  return ensurePtyOutputSubscribed().then(() => () => {
    if (ptyOutputHandler === handler) {
      setPtyOutputHandler(null);
    }
  });
}

export function onPtyLifecycle(handler: (event: PtyLifecycleEvent) => void): Promise<UnlistenFn> {
  return listen<PtyLifecycleEvent>("pty-lifecycle", ({ payload }) => handler(payload));
}

export function onPtyCwdChanged(
  handler: (event: PtyCwdChangedEvent) => void,
): Promise<UnlistenFn> {
  return listen<PtyCwdChangedEvent>("pty-cwd-changed", ({ payload }) => handler(payload));
}

export function onPtyCommandMarker(
  handler: (event: PtyCommandMarkerEvent) => void,
): Promise<UnlistenFn> {
  return listen<PtyCommandMarkerEvent>("pty-command-marker", ({ payload }) => handler(payload));
}

export function onAiContext(handler: (event: AiContextEvent) => void): Promise<UnlistenFn> {
  return listen<AiContextEvent>("ai-context", ({ payload }) => handler(payload));
}

export function onAiNoteDeepLink(handler: (event: AiNotePayload) => void): Promise<UnlistenFn> {
  return listen<AiNotePayload>("deep-link://ai-note", ({ payload }) => handler(payload));
}

export function onComposerDeepLink(handler: (event: ComposerPayload) => void): Promise<UnlistenFn> {
  return listen<ComposerPayload>("deep-link://composer", ({ payload }) => handler(payload));
}
