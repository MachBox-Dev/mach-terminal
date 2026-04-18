import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { WorkspaceLayout } from "../state/workspace";
import type { ProviderDescriptor, ProviderSettings } from "./providers";

export type { WorkspaceLayout } from "../state/workspace";

export type { ProviderSettings } from "./providers";

export type SessionStatus = "idle" | "starting" | "running" | "stopped" | "closed" | "error";

export interface TerminalProfile {
  shell?: string;
  cwd?: string;
  env: Record<string, string>;
  font_size: number;
  /** When true, spawns set `MACH_TERMINAL_MINIMAL_PROMPT=1` for optional shell profile snippets. */
  minimal_shell_prompt?: boolean;
}

export interface ProfilePatch {
  shell?: string | null;
  cwd?: string | null;
  font_size?: number;
  minimal_shell_prompt?: boolean;
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

export interface AiContextEvent {
  session_id: string;
  event_type: "command_submitted" | "output_chunk";
  payload: string;
  sequence: number;
  timestamp_ms: number;
  source: "pty" | "input" | "system";
}

export interface ProviderRoutingSettings {
  default_provider: string;
  ollama_model: string;
  ai_feature_enabled: boolean;
}

export interface ProviderRoutingPatch {
  default_provider?: string;
  ollama_model?: string;
  ai_feature_enabled?: boolean;
}

export interface SettingsSchemaDebug {
  settings_path: string;
  file_exists: boolean;
  schema_version_in_file?: number;
  loaded_schema_version: number;
  migrated_from_legacy: boolean;
}

export interface AiExecuteRequest {
  session_id: string;
  prompt: string;
  provider_id?: string;
}

export interface AiExecuteResponse {
  provider_id: string;
  output: string;
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
}

export async function runtimeCapabilities() {
  return invoke("runtime_capabilities");
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

export async function pluginGrantCapability(pluginId: string, capability: string) {
  return invoke("plugin_grant_capability", { pluginId, capability });
}

export async function pluginExecute(pluginId: string, capability: string, payload: string) {
  return invoke<PluginExecutionResult>("plugin_execute", { pluginId, capability, payload });
}

export async function aiExecute(request: AiExecuteRequest) {
  return invoke<AiExecuteResponse>("ai_execute", { request });
}

export function onPtyOutput(handler: (event: PtyOutputEvent) => void): Promise<UnlistenFn> {
  return listen<PtyOutputEvent>("pty-output", ({ payload }) => handler(payload));
}

export function onPtyLifecycle(handler: (event: PtyLifecycleEvent) => void): Promise<UnlistenFn> {
  return listen<PtyLifecycleEvent>("pty-lifecycle", ({ payload }) => handler(payload));
}

export function onPtyCwdChanged(
  handler: (event: PtyCwdChangedEvent) => void,
): Promise<UnlistenFn> {
  return listen<PtyCwdChangedEvent>("pty-cwd-changed", ({ payload }) => handler(payload));
}

export function onAiContext(handler: (event: AiContextEvent) => void): Promise<UnlistenFn> {
  return listen<AiContextEvent>("ai-context", ({ payload }) => handler(payload));
}
