import { useCallback, useEffect, useRef, useState } from "react";
import { aiErrorStatusMessage, isExecutableProvider, providerToggleStatus } from "../core/providerUiState";
import { PROVIDER_REGISTRY, type ProviderDescriptor } from "../core/providers";
import {
  aiExecute,
  providerApiKeyClear,
  providerApiKeySet,
  providerEndpointSet,
  providerList,
  providerRoutingPatch,
  providerRoutingSet,
  providerSetEnabled,
  trimAiContextExcerpt,
  type AiContextEvent,
  type AiExecuteIntent,
  type AiPromptContextPayload,
  type ProviderRoutingSettings,
  type PtySessionInfo,
} from "../core/terminal";

type RoutingDraft = {
  default_provider: string;
  ollama_model: string;
  openai_model: string;
  anthropic_model: string;
  custom_openai_model: string;
};

/**
 * Preserve user-entered API key drafts while refreshing descriptors from runtime.
 * Unknown provider ids are dropped; known ids keep existing drafts.
 */
export function mergeProviderApiKeyDrafts(
  providerDescriptors: ProviderDescriptor[],
  currentDrafts: Record<string, string>,
): Record<string, string> {
  return providerDescriptors.reduce<Record<string, string>>((drafts, provider) => {
    drafts[provider.id] = currentDrafts[provider.id] ?? "";
    return drafts;
  }, {});
}

/** Request ids are monotonic; newer requests supersede older async completions. */
export function nextAiRequestId(current: number): number {
  return current + 1;
}

/** Guard writes from stale async responses after a newer request has started. */
export function shouldApplyAiResult(latestRequestId: number, requestId: number): boolean {
  return latestRequestId === requestId;
}

function endpointDraftsFromProviders(providers: ProviderDescriptor[]): Record<string, string> {
  return providers.reduce<Record<string, string>>((drafts, provider) => {
    drafts[provider.id] = provider.endpoint ?? "";
    return drafts;
  }, {});
}

function resolveExecutableDefaultProvider(
  providers: ProviderDescriptor[],
  requestedDefaultProvider: string,
): string {
  if (isExecutableProvider(requestedDefaultProvider)) {
    return requestedDefaultProvider;
  }
  const fallback = providers.find((provider) => isExecutableProvider(provider.id));
  return fallback?.id ?? requestedDefaultProvider;
}

interface UseProviderAiStateParams {
  activeSession: PtySessionInfo | undefined;
  onRuntimeError: (message: string) => void;
  onHistoryActionStatus: (status: string) => void;
  /** Optional cwd/shell/scrollback tail assembled by the host (e.g. App.tsx). */
  buildAiPromptContext?: () => AiPromptContextPayload | undefined;
}

export type HistoryAiAction = "explain" | "fix";

export interface HistoryAiContract {
  prompt: string;
  intent: AiExecuteIntent;
  pendingStatus: string;
  successStatus: string;
  historyFailureStatus: string;
  fallbackErrorMessage: string;
}

export function historyAiContract(action: HistoryAiAction, command: string): HistoryAiContract {
  if (action === "explain") {
    return {
      prompt: `Explain this shell command:\n${command}`,
      intent: "explain_command",
      pendingStatus: "Generating AI explanation...",
      successStatus: "AI explanation ready.",
      historyFailureStatus: "AI explanation failed.",
      fallbackErrorMessage: "AI explain failed.",
    };
  }
  return {
    prompt: `Provide a safer or corrected version of this command, with a short explanation:\n${command}`,
    intent: "fix_command",
    pendingStatus: "Generating safer command suggestion...",
    successStatus: "AI fix suggestion ready.",
    historyFailureStatus: "AI fix failed.",
    fallbackErrorMessage: "AI fix failed.",
  };
}

function composeAiContext(
  buildAiPromptContext: UseProviderAiStateParams["buildAiPromptContext"],
  extras: Partial<AiPromptContextPayload> = {},
): AiPromptContextPayload | undefined {
  const base = buildAiPromptContext?.() ?? {};
  const merged: AiPromptContextPayload = { ...base, ...extras };
  merged.output_excerpt = trimAiContextExcerpt(merged.output_excerpt ?? undefined);
  const hasContext = [merged.cwd, merged.shell, merged.git_branch, merged.command_text, merged.output_excerpt].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  return hasContext ? merged : undefined;
}

export function useProviderAiState({
  activeSession,
  onRuntimeError,
  onHistoryActionStatus,
  buildAiPromptContext,
}: UseProviderAiStateParams) {
  const [providers, setProviders] = useState<ProviderDescriptor[]>(PROVIDER_REGISTRY);
  const [routing, setRouting] = useState<ProviderRoutingSettings>({
    default_provider: "ollama",
    ollama_model: "llama3.2",
    openai_model: "gpt-4o-mini",
    anthropic_model: "claude-3-5-haiku-latest",
    custom_openai_model: "gpt-4o-mini",
    ai_feature_enabled: false,
  });
  const [routingDraft, setRoutingDraft] = useState<RoutingDraft>({
    default_provider: "ollama",
    ollama_model: "llama3.2",
    openai_model: "gpt-4o-mini",
    anthropic_model: "claude-3-5-haiku-latest",
    custom_openai_model: "gpt-4o-mini",
  });
  const [providerApiKeyDrafts, setProviderApiKeyDrafts] = useState<Record<string, string>>({});
  const [providerEndpointDrafts, setProviderEndpointDrafts] = useState<Record<string, string>>({});
  const [providerConfigStatus, setProviderConfigStatus] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("summarize last command");
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiRequestInFlight, setAiRequestInFlight] = useState(false);
  const [aiRequestStatus, setAiRequestStatus] = useState<string | null>(null);
  const [lastAiContext, setLastAiContext] = useState<AiContextEvent | null>(null);
  const latestAiRequestRef = useRef(0);

  useEffect(() => {
    if (!providerConfigStatus) {
      return;
    }
    const timeout = window.setTimeout(() => setProviderConfigStatus(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [providerConfigStatus]);

  useEffect(() => {
    if (!aiRequestStatus) {
      return;
    }
    const timeout = window.setTimeout(() => setAiRequestStatus(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [aiRequestStatus]);

  const initializeProviderAiState = useCallback(
    (providerDescriptors: ProviderDescriptor[], providerRouting: ProviderRoutingSettings) => {
      const defaultProvider = resolveExecutableDefaultProvider(
        providerDescriptors,
        providerRouting.default_provider,
      );
      setProviders(providerDescriptors);
      setRouting({ ...providerRouting, default_provider: defaultProvider });
      setRoutingDraft({
        default_provider: defaultProvider,
        ollama_model: providerRouting.ollama_model,
        openai_model: providerRouting.openai_model,
        anthropic_model: providerRouting.anthropic_model,
        custom_openai_model: providerRouting.custom_openai_model,
      });
      setProviderEndpointDrafts(endpointDraftsFromProviders(providerDescriptors));
    },
    [],
  );

  const applyProviderDescriptors = useCallback((providerDescriptors: ProviderDescriptor[]) => {
    setProviders(providerDescriptors);
    setProviderEndpointDrafts(endpointDraftsFromProviders(providerDescriptors));
    setProviderApiKeyDrafts((current) => mergeProviderApiKeyDrafts(providerDescriptors, current));
  }, []);

  const toggleProvider = useCallback(async (providerId: string, enabled: boolean) => {
    if (enabled && !isExecutableProvider(providerId)) {
      setProviderConfigStatus(`Provider ${providerId} is not executable yet.`);
      return;
    }
    try {
      await providerSetEnabled(providerId, enabled);
      const providerDescriptors = await providerList();
      applyProviderDescriptors(providerDescriptors);
      setProviderConfigStatus(providerToggleStatus(providerId, enabled));
    } catch (error) {
      onRuntimeError(error instanceof Error ? error.message : "Failed to update provider settings.");
    }
  }, [applyProviderDescriptors, onRuntimeError]);

  const updateProviderEndpointDraft = useCallback((providerId: string, endpoint: string) => {
    setProviderEndpointDrafts((current) => ({ ...current, [providerId]: endpoint }));
  }, []);

  const updateProviderApiKeyDraft = useCallback((providerId: string, apiKey: string) => {
    setProviderApiKeyDrafts((current) => ({ ...current, [providerId]: apiKey }));
  }, []);

  const saveProviderApiKey = useCallback(async (providerId: string) => {
    const apiKey = providerApiKeyDrafts[providerId]?.trim() ?? "";
    if (!apiKey) {
      setProviderConfigStatus(`Enter an API key for ${providerId} before saving.`);
      return;
    }
    try {
      await providerApiKeySet(providerId, apiKey);
      setProviderApiKeyDrafts((current) => ({ ...current, [providerId]: "" }));
      const providerDescriptors = await providerList();
      applyProviderDescriptors(providerDescriptors);
      setProviderConfigStatus(`Saved API key for ${providerId}.`);
    } catch (error) {
      onRuntimeError(error instanceof Error ? error.message : "Failed to update provider API key.");
    }
  }, [applyProviderDescriptors, onRuntimeError, providerApiKeyDrafts]);

  const clearProviderApiKey = useCallback(async (providerId: string) => {
    try {
      await providerApiKeyClear(providerId);
      setProviderApiKeyDrafts((current) => ({ ...current, [providerId]: "" }));
      const providerDescriptors = await providerList();
      applyProviderDescriptors(providerDescriptors);
      setProviderConfigStatus(`Cleared API key for ${providerId}.`);
    } catch (error) {
      onRuntimeError(error instanceof Error ? error.message : "Failed to clear provider API key.");
    }
  }, [applyProviderDescriptors, onRuntimeError]);

  const saveProviderEndpoint = useCallback(async (providerId: string) => {
    const endpoint = providerEndpointDrafts[providerId] ?? "";
    try {
      await providerEndpointSet(providerId, endpoint.length > 0 ? endpoint : null);
      const providerDescriptors = await providerList();
      applyProviderDescriptors(providerDescriptors);
      setProviderConfigStatus(`Saved endpoint for ${providerId}.`);
    } catch (error) {
      onRuntimeError(error instanceof Error ? error.message : "Failed to update provider endpoint.");
    }
  }, [applyProviderDescriptors, onRuntimeError, providerEndpointDrafts]);

  const saveRoutingConfig = useCallback(async () => {
    if (!isExecutableProvider(routingDraft.default_provider)) {
      setProviderConfigStatus(`Provider ${routingDraft.default_provider} cannot be used yet.`);
      return;
    }
    try {
      const updated = await providerRoutingPatch({
        default_provider: routingDraft.default_provider,
        ollama_model: routingDraft.ollama_model,
        openai_model: routingDraft.openai_model,
        anthropic_model: routingDraft.anthropic_model,
        custom_openai_model: routingDraft.custom_openai_model,
      });
      setRouting(updated);
      setRoutingDraft({
        default_provider: updated.default_provider,
        ollama_model: updated.ollama_model,
        openai_model: updated.openai_model,
        anthropic_model: updated.anthropic_model,
        custom_openai_model: updated.custom_openai_model,
      });
      setProviderConfigStatus("Saved routing settings.");
    } catch (error) {
      onRuntimeError(error instanceof Error ? error.message : "Failed to save routing settings.");
    }
  }, [
    onRuntimeError,
    routingDraft.anthropic_model,
    routingDraft.custom_openai_model,
    routingDraft.default_provider,
    routingDraft.ollama_model,
    routingDraft.openai_model,
  ]);

  const setAiOptIn = useCallback(async (enabled: boolean) => {
    try {
      const updated = await providerRoutingSet({
        ...routing,
        default_provider: routingDraft.default_provider,
        ollama_model: routingDraft.ollama_model,
        openai_model: routingDraft.openai_model,
        anthropic_model: routingDraft.anthropic_model,
        custom_openai_model: routingDraft.custom_openai_model,
        ai_feature_enabled: enabled,
      });
      setRouting(updated);
      setRoutingDraft({
        default_provider: updated.default_provider,
        ollama_model: updated.ollama_model,
        openai_model: updated.openai_model,
        anthropic_model: updated.anthropic_model,
        custom_openai_model: updated.custom_openai_model,
      });
      setProviderConfigStatus(enabled ? "AI routing enabled." : "AI routing disabled.");
    } catch (error) {
      onRuntimeError(error instanceof Error ? error.message : "Failed to update AI routing opt-in.");
    }
  }, [
    onRuntimeError,
    routing,
    routingDraft.anthropic_model,
    routingDraft.custom_openai_model,
    routingDraft.default_provider,
    routingDraft.ollama_model,
    routingDraft.openai_model,
  ]);

  const runAiPrompt = useCallback(async () => {
    if (!activeSession) {
      onRuntimeError("No active session selected for AI prompt.");
      return;
    }
    if (!isExecutableProvider(routing.default_provider)) {
      setAiRequestStatus(`Provider ${routing.default_provider} is not executable yet.`);
      return;
    }
    const requestId = nextAiRequestId(latestAiRequestRef.current);
    latestAiRequestRef.current = requestId;
    setAiRequestInFlight(true);
    setAiRequestStatus("Running AI prompt...");
    try {
      const response = await aiExecute({
        session_id: activeSession.id,
        prompt: aiPrompt,
        provider_id: routing.default_provider,
        intent: "freeform" satisfies AiExecuteIntent,
        context: composeAiContext(buildAiPromptContext),
      });
      if (!shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
        return;
      }
      setAiResponse(response.output);
      setAiRequestStatus("AI response ready.");
    } catch (error) {
      if (!shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
        return;
      }
      const message = error instanceof Error ? error.message : "AI execution failed.";
      setAiResponse(null);
      onRuntimeError(message);
      setAiRequestStatus(aiErrorStatusMessage(message));
    } finally {
      if (shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
        setAiRequestInFlight(false);
      }
    }
  }, [activeSession, aiPrompt, buildAiPromptContext, onRuntimeError, routing.default_provider]);

  const explainCommand = useCallback(async (command: string) => {
    if (!activeSession) {
      return;
    }
    if (!isExecutableProvider(routing.default_provider)) {
      setAiRequestStatus(`Provider ${routing.default_provider} is not executable yet.`);
      return;
    }
    const requestId = nextAiRequestId(latestAiRequestRef.current);
    latestAiRequestRef.current = requestId;
    setAiRequestInFlight(true);
    const contract = historyAiContract("explain", command);
    onHistoryActionStatus(contract.pendingStatus);
    const prompt = contract.prompt;
    setAiPrompt(prompt);
    try {
      const response = await aiExecute({
        session_id: activeSession.id,
        prompt,
        provider_id: routing.default_provider,
        intent: contract.intent,
        context: composeAiContext(buildAiPromptContext, { command_text: command }),
      });
      if (!shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
        return;
      }
      setAiResponse(response.output);
      onHistoryActionStatus(contract.successStatus);
      setAiRequestStatus(contract.successStatus);
    } catch (error) {
      if (!shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
        return;
      }
      const message = error instanceof Error ? error.message : contract.fallbackErrorMessage;
      onRuntimeError(message);
      onHistoryActionStatus(contract.historyFailureStatus);
      setAiRequestStatus(aiErrorStatusMessage(message));
    } finally {
      if (shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
        setAiRequestInFlight(false);
      }
    }
  }, [activeSession, buildAiPromptContext, onHistoryActionStatus, onRuntimeError, routing.default_provider]);

  const fixCommand = useCallback(async (command: string) => {
    if (!activeSession) {
      return;
    }
    if (!isExecutableProvider(routing.default_provider)) {
      setAiRequestStatus(`Provider ${routing.default_provider} is not executable yet.`);
      return;
    }
    const requestId = nextAiRequestId(latestAiRequestRef.current);
    latestAiRequestRef.current = requestId;
    setAiRequestInFlight(true);
    const contract = historyAiContract("fix", command);
    onHistoryActionStatus(contract.pendingStatus);
    const prompt = contract.prompt;
    setAiPrompt(prompt);
    try {
      const response = await aiExecute({
        session_id: activeSession.id,
        prompt,
        provider_id: routing.default_provider,
        intent: contract.intent,
        context: composeAiContext(buildAiPromptContext, { command_text: command }),
      });
      if (!shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
        return;
      }
      setAiResponse(response.output);
      onHistoryActionStatus(contract.successStatus);
      setAiRequestStatus(contract.successStatus);
    } catch (error) {
      if (!shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
        return;
      }
      const message = error instanceof Error ? error.message : contract.fallbackErrorMessage;
      onRuntimeError(message);
      onHistoryActionStatus(contract.historyFailureStatus);
      setAiRequestStatus(aiErrorStatusMessage(message));
    } finally {
      if (shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
        setAiRequestInFlight(false);
      }
    }
  }, [activeSession, buildAiPromptContext, onHistoryActionStatus, onRuntimeError, routing.default_provider]);

  return {
    providers,
    routing,
    routingDraft,
    providerEndpointDrafts,
    providerApiKeyDrafts,
    providerConfigStatus,
    aiPrompt,
    aiResponse,
    aiRequestInFlight,
    aiRequestStatus,
    lastAiContext,
    initializeProviderAiState,
    setRoutingDraft,
    updateProviderEndpointDraft,
    updateProviderApiKeyDraft,
    setAiPrompt,
    setLastAiContext,
    toggleProvider,
    saveProviderEndpoint,
    saveProviderApiKey,
    clearProviderApiKey,
    saveRoutingConfig,
    setAiOptIn,
    runAiPrompt,
    explainCommand,
    fixCommand,
  };
}
