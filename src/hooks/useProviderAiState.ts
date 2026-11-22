import { useCallback, useEffect, useRef, useState } from "react";
import {
  aiErrorStatusMessage,
  aiAssistNotReadyStatus,
  aiExecutionFailedFallback,
  aiExplainFailedFallback,
  aiExplainFailedStatus,
  aiExplainPendingStatus,
  aiExplainReadyStatus,
  aiFixFailedFallback,
  aiFixFailedStatus,
  aiFixPendingStatus,
  aiFixReadyStatus,
  aiNoActiveSessionStatus,
  aiPromptPendingStatus,
  aiPromptReadyStatus,
  aiRoutingOptInStatus,
  aiRoutingOptInUpdateFailedStatus,
  isAiAssistReady,
  isExecutableProvider,
  providerApiKeyClearedStatus,
  providerApiKeyClearFailedStatus,
  providerApiKeyRequiredStatus,
  providerApiKeySavedStatus,
  providerApiKeyUpdateFailedStatus,
  providerEndpointSavedStatus,
  providerEndpointUpdateFailedStatus,
  providerRoutingSaveFailedStatus,
  providerRoutingSavedStatus,
  providerSettingsUpdateFailedStatus,
  providerToggleStatus,
  providerUnavailableStatus,
} from "../core/providerUiState";
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
  type AiChatTurn,
  type AiContextEvent,
  type AiExecuteIntent,
  type AiPromptContextPayload,
  type ProviderRoutingSettings,
  type PtySessionInfo,
} from "../core/terminal";
import { DEFAULT_AI_CONTEXT_BUDGET_CHARS } from "../core/aiContextBudget";
import { messageFromUnknownError } from "../core/errors";
import { buildToolUserMessage, type AiToolContext } from "../core/aiTools";
import { executeAiWithTools } from "../core/aiToolRunner";

export type RunAiPromptOptions = {
  /** Target session (defaults to active session). */
  sessionId?: string;
  contextExtras?: Partial<AiPromptContextPayload>;
  history?: AiChatTurn[];
  onSuccess?: (output: string) => void;
  onError?: (message: string) => void;
};

type RoutingDraft = {
  default_provider: string;
  ollama_model: string;
  openai_model: string;
  anthropic_model: string;
  custom_openai_model: string;
  system_prompt: string;
  ai_context_budget_chars: number;
};

export type ProviderRoutingDraftState = RoutingDraft;

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
  onHistoryActionStatus: (status: string) => void;
  /** Optional cwd/shell/scrollback tail assembled by the host (e.g. App.tsx). */
  buildAiPromptContext?: (sessionId?: string) => AiPromptContextPayload | undefined;
  /** Ops-rail run ledger + scrollback for read-only AI tools. */
  buildAiToolContext?: (sessionId: string) => AiToolContext;
  /** When true, eligible providers run the read-only tool loop for chat prompts. */
  enableAiTools?: boolean;
  /** Fired after any successful AI execution (composer, explain, fix, settings prompt). */
  onAiAssistantReply?: (payload: {
    prompt: string;
    output: string;
    intent: AiExecuteIntent;
    sessionId?: string;
  }) => void;
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
      pendingStatus: aiExplainPendingStatus(),
      successStatus: aiExplainReadyStatus(),
      historyFailureStatus: aiExplainFailedStatus(),
      fallbackErrorMessage: aiExplainFailedFallback(),
    };
  }
  return {
    prompt: `Provide a safer or corrected version of this command, with a short explanation:\n${command}`,
    intent: "fix_command",
    pendingStatus: aiFixPendingStatus(),
    successStatus: aiFixReadyStatus(),
    historyFailureStatus: aiFixFailedStatus(),
    fallbackErrorMessage: aiFixFailedFallback(),
  };
}

function composeAiContext(
  buildAiPromptContext: UseProviderAiStateParams["buildAiPromptContext"],
  extras: Partial<AiPromptContextPayload> = {},
  sessionId?: string,
): AiPromptContextPayload | undefined {
  const base = buildAiPromptContext?.(sessionId) ?? {};
  const merged: AiPromptContextPayload = { ...base, ...extras };
  merged.output_excerpt = trimAiContextExcerpt(merged.output_excerpt ?? undefined);
  const hasContext = [merged.cwd, merged.shell, merged.git_branch, merged.command_text, merged.output_excerpt].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  return hasContext ? merged : undefined;
}

export function useProviderAiState({
  activeSession,
  onHistoryActionStatus,
  buildAiPromptContext,
  buildAiToolContext,
  enableAiTools = false,
  onAiAssistantReply,
}: UseProviderAiStateParams) {
  const [providers, setProviders] = useState<ProviderDescriptor[]>(PROVIDER_REGISTRY);
  const [routing, setRouting] = useState<ProviderRoutingSettings>({
    default_provider: "ollama",
    ollama_model: "llama3.2",
    openai_model: "gpt-4o-mini",
    anthropic_model: "claude-3-5-haiku-latest",
    custom_openai_model: "gpt-4o-mini",
    ai_feature_enabled: false,
    system_prompt: "",
    ai_context_budget_chars: DEFAULT_AI_CONTEXT_BUDGET_CHARS,
  });
  const [routingDraft, setRoutingDraft] = useState<RoutingDraft>({
    default_provider: "ollama",
    ollama_model: "llama3.2",
    openai_model: "gpt-4o-mini",
    anthropic_model: "claude-3-5-haiku-latest",
    custom_openai_model: "gpt-4o-mini",
    system_prompt: "",
    ai_context_budget_chars: DEFAULT_AI_CONTEXT_BUDGET_CHARS,
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
        system_prompt: providerRouting.system_prompt ?? "",
        ai_context_budget_chars: providerRouting.ai_context_budget_chars ?? DEFAULT_AI_CONTEXT_BUDGET_CHARS,
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
      setProviderConfigStatus(providerUnavailableStatus(providerId));
      return;
    }
    try {
      await providerSetEnabled(providerId, enabled);
      const providerDescriptors = await providerList();
      applyProviderDescriptors(providerDescriptors);
      setProviderConfigStatus(providerToggleStatus(providerId, enabled));
    } catch (error) {
      setProviderConfigStatus(messageFromUnknownError(error, providerSettingsUpdateFailedStatus()));
    }
  }, [applyProviderDescriptors]);

  const updateProviderEndpointDraft = useCallback((providerId: string, endpoint: string) => {
    setProviderEndpointDrafts((current) => ({ ...current, [providerId]: endpoint }));
  }, []);

  const updateProviderApiKeyDraft = useCallback((providerId: string, apiKey: string) => {
    setProviderApiKeyDrafts((current) => ({ ...current, [providerId]: apiKey }));
  }, []);

  const saveProviderApiKey = useCallback(async (providerId: string) => {
    const apiKey = providerApiKeyDrafts[providerId]?.trim() ?? "";
    if (!apiKey) {
      setProviderConfigStatus(providerApiKeyRequiredStatus(providerId));
      return;
    }
    try {
      await providerApiKeySet(providerId, apiKey);
      setProviderApiKeyDrafts((current) => ({ ...current, [providerId]: "" }));
      const providerDescriptors = await providerList();
      applyProviderDescriptors(providerDescriptors);
      setProviderConfigStatus(providerApiKeySavedStatus(providerId));
    } catch (error) {
      setProviderConfigStatus(messageFromUnknownError(error, providerApiKeyUpdateFailedStatus()));
    }
  }, [applyProviderDescriptors, providerApiKeyDrafts]);

  const clearProviderApiKey = useCallback(async (providerId: string) => {
    try {
      await providerApiKeyClear(providerId);
      setProviderApiKeyDrafts((current) => ({ ...current, [providerId]: "" }));
      const providerDescriptors = await providerList();
      applyProviderDescriptors(providerDescriptors);
      setProviderConfigStatus(providerApiKeyClearedStatus(providerId));
    } catch (error) {
      setProviderConfigStatus(messageFromUnknownError(error, providerApiKeyClearFailedStatus()));
    }
  }, [applyProviderDescriptors]);

  const saveProviderEndpoint = useCallback(async (providerId: string) => {
    const endpoint = providerEndpointDrafts[providerId] ?? "";
    try {
      await providerEndpointSet(providerId, endpoint.length > 0 ? endpoint : null);
      const providerDescriptors = await providerList();
      applyProviderDescriptors(providerDescriptors);
      setProviderConfigStatus(providerEndpointSavedStatus(providerId));
    } catch (error) {
      setProviderConfigStatus(messageFromUnknownError(error, providerEndpointUpdateFailedStatus()));
    }
  }, [applyProviderDescriptors, providerEndpointDrafts]);

  const saveRoutingConfig = useCallback(async () => {
    if (!isExecutableProvider(routingDraft.default_provider)) {
      setProviderConfigStatus(providerUnavailableStatus(routingDraft.default_provider));
      return;
    }
    try {
      const updated = await providerRoutingPatch({
        default_provider: routingDraft.default_provider,
        ollama_model: routingDraft.ollama_model,
        openai_model: routingDraft.openai_model,
        anthropic_model: routingDraft.anthropic_model,
        custom_openai_model: routingDraft.custom_openai_model,
        system_prompt: routingDraft.system_prompt,
        ai_context_budget_chars: routingDraft.ai_context_budget_chars,
      });
      setRouting(updated);
      setRoutingDraft({
        default_provider: updated.default_provider,
        ollama_model: updated.ollama_model,
        openai_model: updated.openai_model,
        anthropic_model: updated.anthropic_model,
        custom_openai_model: updated.custom_openai_model,
        system_prompt: updated.system_prompt ?? "",
        ai_context_budget_chars: updated.ai_context_budget_chars ?? DEFAULT_AI_CONTEXT_BUDGET_CHARS,
      });
      setProviderConfigStatus(providerRoutingSavedStatus());
    } catch (error) {
      setProviderConfigStatus(messageFromUnknownError(error, providerRoutingSaveFailedStatus()));
    }
  }, [
    routingDraft.anthropic_model,
    routingDraft.custom_openai_model,
    routingDraft.default_provider,
    routingDraft.ollama_model,
    routingDraft.openai_model,
    routingDraft.system_prompt,
    routingDraft.ai_context_budget_chars,
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
        system_prompt: routingDraft.system_prompt,
        ai_context_budget_chars: routingDraft.ai_context_budget_chars,
        ai_feature_enabled: enabled,
      });
      setRouting(updated);
      setRoutingDraft({
        default_provider: updated.default_provider,
        ollama_model: updated.ollama_model,
        openai_model: updated.openai_model,
        anthropic_model: updated.anthropic_model,
        custom_openai_model: updated.custom_openai_model,
        system_prompt: updated.system_prompt ?? "",
        ai_context_budget_chars: updated.ai_context_budget_chars ?? DEFAULT_AI_CONTEXT_BUDGET_CHARS,
      });
      setProviderConfigStatus(aiRoutingOptInStatus(enabled));
    } catch (error) {
      setProviderConfigStatus(messageFromUnknownError(error, aiRoutingOptInUpdateFailedStatus()));
    }
  }, [
    routing,
    routingDraft.anthropic_model,
    routingDraft.custom_openai_model,
    routingDraft.default_provider,
    routingDraft.ollama_model,
    routingDraft.openai_model,
  ]);

  const runAiPrompt = useCallback(async () => {
    if (!activeSession) {
      setAiRequestStatus(aiNoActiveSessionStatus());
      return;
    }
    if (!isExecutableProvider(routing.default_provider)) {
      setAiRequestStatus(providerUnavailableStatus(routing.default_provider));
      return;
    }
    const requestId = nextAiRequestId(latestAiRequestRef.current);
    latestAiRequestRef.current = requestId;
    setAiRequestInFlight(true);
    setAiRequestStatus(aiPromptPendingStatus());
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
      setAiRequestStatus(aiPromptReadyStatus());
      onAiAssistantReply?.({ prompt: aiPrompt, output: response.output, intent: "freeform" });
    } catch (error) {
      if (!shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
        return;
      }
      const message = messageFromUnknownError(error, aiExecutionFailedFallback());
      setAiResponse(null);
      setAiRequestStatus(aiErrorStatusMessage(message));
    } finally {
      if (shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
        setAiRequestInFlight(false);
      }
    }
  }, [activeSession, aiPrompt, buildAiPromptContext, onAiAssistantReply, routing.default_provider]);

  const runAiPromptWithText = useCallback(
    async (promptText: string, options: RunAiPromptOptions = {}) => {
      const targetSessionId = options.sessionId ?? activeSession?.id;
      if (!targetSessionId) {
        setAiRequestStatus(aiNoActiveSessionStatus());
        return;
      }
      const trimmed = promptText.trim();
      if (trimmed.length === 0) {
        return;
      }
      if (!isExecutableProvider(routing.default_provider)) {
        setAiRequestStatus(providerUnavailableStatus(routing.default_provider));
        return;
      }
      const requestId = nextAiRequestId(latestAiRequestRef.current);
      latestAiRequestRef.current = requestId;
      setAiRequestInFlight(true);
      setAiRequestStatus(aiPromptPendingStatus());
      setAiPrompt(trimmed);
      try {
        const context = composeAiContext(buildAiPromptContext, options.contextExtras, targetSessionId);
        const userMessageBody = buildToolUserMessage(trimmed, context);
        const toolContext = buildAiToolContext?.(targetSessionId) ?? {
          sessionId: targetSessionId,
          runLedger: {},
          sessionBuffers: {},
        };
        const baseRequest = {
          session_id: targetSessionId,
          prompt: trimmed,
          provider_id: routing.default_provider,
          intent: "freeform" as const satisfies AiExecuteIntent,
          context,
          history: options.history,
        };
        const response = await executeAiWithTools(baseRequest, {
          enabled: enableAiTools,
          providerId: routing.default_provider,
          toolContext,
          userMessageBody,
          execute: aiExecute,
        });
        if (!shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
          return;
        }
        setAiResponse(response.output);
        setAiRequestStatus(aiPromptReadyStatus());
        onAiAssistantReply?.({
          prompt: trimmed,
          output: response.output,
          intent: "freeform",
          sessionId: targetSessionId,
        });
        options.onSuccess?.(response.output);
      } catch (error) {
        if (!shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
          return;
        }
        const message = messageFromUnknownError(error, aiExecutionFailedFallback());
        setAiResponse(null);
        setAiRequestStatus(aiErrorStatusMessage(message));
        options.onError?.(message);
      } finally {
        if (shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
          setAiRequestInFlight(false);
        }
      }
    },
    [activeSession, buildAiPromptContext, buildAiToolContext, enableAiTools, onAiAssistantReply, routing.default_provider],
  );

  const explainCommand = useCallback(async (command: string) => {
    if (!activeSession) {
      return;
    }
    if (!isAiAssistReady(routing.ai_feature_enabled, routing.default_provider, providers)) {
      setAiRequestStatus(aiAssistNotReadyStatus());
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
      onAiAssistantReply?.({ prompt, output: response.output, intent: contract.intent });
    } catch (error) {
      if (!shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
        return;
      }
      const message = messageFromUnknownError(error, contract.fallbackErrorMessage);
      onHistoryActionStatus(contract.historyFailureStatus);
      setAiRequestStatus(aiErrorStatusMessage(message));
    } finally {
      if (shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
        setAiRequestInFlight(false);
      }
    }
  }, [activeSession, buildAiPromptContext, onHistoryActionStatus, providers, routing.ai_feature_enabled, routing.default_provider]);

  const fixCommand = useCallback(async (command: string) => {
    if (!activeSession) {
      return;
    }
    if (!isAiAssistReady(routing.ai_feature_enabled, routing.default_provider, providers)) {
      setAiRequestStatus(aiAssistNotReadyStatus());
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
      onAiAssistantReply?.({ prompt, output: response.output, intent: contract.intent });
    } catch (error) {
      if (!shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
        return;
      }
      const message = messageFromUnknownError(error, contract.fallbackErrorMessage);
      onHistoryActionStatus(contract.historyFailureStatus);
      setAiRequestStatus(aiErrorStatusMessage(message));
    } finally {
      if (shouldApplyAiResult(latestAiRequestRef.current, requestId)) {
        setAiRequestInFlight(false);
      }
    }
  }, [activeSession, buildAiPromptContext, onHistoryActionStatus, providers, routing.ai_feature_enabled, routing.default_provider]);

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
    runAiPromptWithText,
    explainCommand,
    fixCommand,
  };
}
