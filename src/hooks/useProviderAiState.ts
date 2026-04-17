import { useCallback, useEffect, useRef, useState } from "react";
import { aiErrorStatusMessage, isExecutableProvider, providerToggleStatus } from "../core/providerUiState";
import { PROVIDER_REGISTRY, type ProviderDescriptor } from "../core/providers";
import {
  aiExecute,
  providerEndpointSet,
  providerList,
  providerRoutingPatch,
  providerRoutingSet,
  providerSetEnabled,
  type AiContextEvent,
  type ProviderRoutingSettings,
  type PtySessionInfo,
} from "../core/terminal";

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
}

export function useProviderAiState({ activeSession, onRuntimeError, onHistoryActionStatus }: UseProviderAiStateParams) {
  const [providers, setProviders] = useState<ProviderDescriptor[]>(PROVIDER_REGISTRY);
  const [routing, setRouting] = useState<ProviderRoutingSettings>({
    default_provider: "ollama",
    ollama_model: "llama3.2",
    ai_feature_enabled: false,
  });
  const [routingDraft, setRoutingDraft] = useState<{ default_provider: string; ollama_model: string }>({
    default_provider: "ollama",
    ollama_model: "llama3.2",
  });
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
      });
      setProviderEndpointDrafts(endpointDraftsFromProviders(providerDescriptors));
    },
    [],
  );

  const applyProviderDescriptors = useCallback((providerDescriptors: ProviderDescriptor[]) => {
    setProviders(providerDescriptors);
    setProviderEndpointDrafts(endpointDraftsFromProviders(providerDescriptors));
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
      });
      setRouting(updated);
      setRoutingDraft({
        default_provider: updated.default_provider,
        ollama_model: updated.ollama_model,
      });
      setProviderConfigStatus("Saved routing settings.");
    } catch (error) {
      onRuntimeError(error instanceof Error ? error.message : "Failed to save routing settings.");
    }
  }, [onRuntimeError, routingDraft.default_provider, routingDraft.ollama_model]);

  const setAiOptIn = useCallback(async (enabled: boolean) => {
    try {
      const updated = await providerRoutingSet({
        ...routing,
        default_provider: routingDraft.default_provider,
        ollama_model: routingDraft.ollama_model,
        ai_feature_enabled: enabled,
      });
      setRouting(updated);
      setRoutingDraft({
        default_provider: updated.default_provider,
        ollama_model: updated.ollama_model,
      });
      setProviderConfigStatus(enabled ? "AI routing enabled." : "AI routing disabled.");
    } catch (error) {
      onRuntimeError(error instanceof Error ? error.message : "Failed to update AI routing opt-in.");
    }
  }, [onRuntimeError, routing, routingDraft.default_provider, routingDraft.ollama_model]);

  const runAiPrompt = useCallback(async () => {
    if (!activeSession) {
      onRuntimeError("No active session selected for AI prompt.");
      return;
    }
    if (!isExecutableProvider(routing.default_provider)) {
      setAiRequestStatus(`Provider ${routing.default_provider} is not executable yet.`);
      return;
    }
    const requestId = latestAiRequestRef.current + 1;
    latestAiRequestRef.current = requestId;
    setAiRequestInFlight(true);
    setAiRequestStatus("Running AI prompt...");
    try {
      const response = await aiExecute({
        session_id: activeSession.id,
        prompt: aiPrompt,
        provider_id: routing.default_provider,
      });
      if (latestAiRequestRef.current !== requestId) {
        return;
      }
      setAiResponse(response.output);
      setAiRequestStatus("AI response ready.");
    } catch (error) {
      if (latestAiRequestRef.current !== requestId) {
        return;
      }
      const message = error instanceof Error ? error.message : "AI execution failed.";
      setAiResponse(null);
      onRuntimeError(message);
      setAiRequestStatus(aiErrorStatusMessage(message));
    } finally {
      if (latestAiRequestRef.current === requestId) {
        setAiRequestInFlight(false);
      }
    }
  }, [activeSession, aiPrompt, onRuntimeError, routing.default_provider]);

  const explainCommand = useCallback(async (command: string) => {
    if (!activeSession) {
      return;
    }
    if (!isExecutableProvider(routing.default_provider)) {
      setAiRequestStatus(`Provider ${routing.default_provider} is not executable yet.`);
      return;
    }
    const requestId = latestAiRequestRef.current + 1;
    latestAiRequestRef.current = requestId;
    setAiRequestInFlight(true);
    onHistoryActionStatus("Generating AI explanation...");
    const prompt = `Explain this shell command:\n${command}`;
    setAiPrompt(prompt);
    try {
      const response = await aiExecute({
        session_id: activeSession.id,
        prompt,
        provider_id: routing.default_provider,
      });
      if (latestAiRequestRef.current !== requestId) {
        return;
      }
      setAiResponse(response.output);
      onHistoryActionStatus("AI explanation ready.");
      setAiRequestStatus("AI explanation ready.");
    } catch (error) {
      if (latestAiRequestRef.current !== requestId) {
        return;
      }
      const message = error instanceof Error ? error.message : "AI explain failed.";
      onRuntimeError(message);
      onHistoryActionStatus("AI explanation failed.");
      setAiRequestStatus(aiErrorStatusMessage(message));
    } finally {
      if (latestAiRequestRef.current === requestId) {
        setAiRequestInFlight(false);
      }
    }
  }, [activeSession, onHistoryActionStatus, onRuntimeError, routing.default_provider]);

  const fixCommand = useCallback(async (command: string) => {
    if (!activeSession) {
      return;
    }
    if (!isExecutableProvider(routing.default_provider)) {
      setAiRequestStatus(`Provider ${routing.default_provider} is not executable yet.`);
      return;
    }
    const requestId = latestAiRequestRef.current + 1;
    latestAiRequestRef.current = requestId;
    setAiRequestInFlight(true);
    onHistoryActionStatus("Generating safer command suggestion...");
    const prompt = `Provide a safer or corrected version of this command, with a short explanation:\n${command}`;
    setAiPrompt(prompt);
    try {
      const response = await aiExecute({
        session_id: activeSession.id,
        prompt,
        provider_id: routing.default_provider,
      });
      if (latestAiRequestRef.current !== requestId) {
        return;
      }
      setAiResponse(response.output);
      onHistoryActionStatus("AI fix suggestion ready.");
      setAiRequestStatus("AI fix suggestion ready.");
    } catch (error) {
      if (latestAiRequestRef.current !== requestId) {
        return;
      }
      const message = error instanceof Error ? error.message : "AI fix failed.";
      onRuntimeError(message);
      onHistoryActionStatus("AI fix failed.");
      setAiRequestStatus(aiErrorStatusMessage(message));
    } finally {
      if (latestAiRequestRef.current === requestId) {
        setAiRequestInFlight(false);
      }
    }
  }, [activeSession, onHistoryActionStatus, onRuntimeError, routing.default_provider]);

  return {
    providers,
    routing,
    routingDraft,
    providerEndpointDrafts,
    providerConfigStatus,
    aiPrompt,
    aiResponse,
    aiRequestInFlight,
    aiRequestStatus,
    lastAiContext,
    initializeProviderAiState,
    setRoutingDraft,
    updateProviderEndpointDraft,
    setAiPrompt,
    setLastAiContext,
    toggleProvider,
    saveProviderEndpoint,
    saveRoutingConfig,
    setAiOptIn,
    runAiPrompt,
    explainCommand,
    fixCommand,
  };
}
