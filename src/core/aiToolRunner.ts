import type {
  AiExecuteRequest,
  AiExecuteResponse,
  AiProviderMessage,
  McpClientToolDescriptor,
} from "./terminal";
import {
  MACH_AI_TOOL_DEFINITIONS,
  mcpToolDescriptorsToOpenAiTools,
  parseMcpToolArguments,
  parseQualifiedMcpToolName,
  providerSupportsAiTools,
  resolveAiToolCall,
  type AiToolCall,
  type AiToolContext,
} from "./aiTools";

const DEFAULT_MAX_ROUNDS = 4;

export type AiExecuteFn = (request: AiExecuteRequest) => Promise<AiExecuteResponse>;
export type McpCallToolFn = (
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<{ output: string; isError: boolean }>;

function assistantMessageWithToolCalls(calls: AiToolCall[]): AiProviderMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: calls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    })),
  };
}

function toolResultMessage(call: AiToolCall, result: string): AiProviderMessage {
  return {
    role: "tool",
    content: result,
    tool_call_id: call.id,
    name: call.name,
  };
}

/**
 * Run AI execute with a read-only tool loop (ops-rail command output lookup).
 * When tools are disabled or the provider lacks native tool support, performs a single execute.
 */
export async function executeAiWithTools(
  baseRequest: AiExecuteRequest,
  options: {
    enabled: boolean;
    providerId: string;
    toolContext: AiToolContext;
    userMessageBody: string;
    execute: AiExecuteFn;
    maxRounds?: number;
    mcpTools?: McpClientToolDescriptor[];
    callMcpTool?: McpCallToolFn;
  },
): Promise<AiExecuteResponse> {
  const mcpDefs =
    options.mcpTools && options.mcpTools.length > 0
      ? mcpToolDescriptorsToOpenAiTools(options.mcpTools)
      : [];
  const combinedTools = [
    ...(options.enabled ? MACH_AI_TOOL_DEFINITIONS : []),
    ...mcpDefs,
  ];
  const useTools = combinedTools.length > 0 && providerSupportsAiTools(options.providerId);
  if (!useTools) {
    return options.execute({ ...baseRequest, enable_tools: false });
  }

  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  let providerMessages: AiProviderMessage[] | undefined;
  let lastResponse: AiExecuteResponse | null = null;

  for (let round = 0; round < maxRounds; round += 1) {
    const request: AiExecuteRequest =
      round === 0
        ? { ...baseRequest, enable_tools: true, tools: combinedTools }
        : {
            ...baseRequest,
            prompt: "",
            history: undefined,
            context: undefined,
            enable_tools: true,
            tools: combinedTools,
            provider_messages: providerMessages,
            use_provider_messages: true,
          };

    const response = await options.execute(request);
    lastResponse = response;

    const toolCalls = response.tool_calls ?? [];
    if (toolCalls.length === 0 || response.finish_reason !== "tool_calls") {
      return response;
    }

    if (!providerMessages) {
      providerMessages = buildInitialProviderMessages(baseRequest, options.userMessageBody);
    }
    providerMessages.push(assistantMessageWithToolCalls(toolCalls));
    for (const call of toolCalls) {
      const mcpTarget = parseQualifiedMcpToolName(call.name);
      if (mcpTarget && options.callMcpTool) {
        try {
          const parsedArgs = parseMcpToolArguments(call.arguments);
          const mcpResult = await options.callMcpTool(
            mcpTarget.serverId,
            mcpTarget.toolName,
            parsedArgs,
          );
          const output = mcpResult.isError
            ? `MCP Error (${mcpTarget.serverId}/${mcpTarget.toolName}): ${mcpResult.output}`
            : mcpResult.output;
          providerMessages.push(toolResultMessage(call, output));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          providerMessages.push(
            toolResultMessage(
              call,
              `MCP Error (${mcpTarget.serverId}/${mcpTarget.toolName}): ${msg}`,
            ),
          );
        }
      } else {
        const result = resolveAiToolCall(call, options.toolContext);
        providerMessages.push(toolResultMessage(call, result));
      }
    }
  }

  if (providerMessages) {
    const finalResponse = await options.execute({
      ...baseRequest,
      prompt: "",
      history: undefined,
      context: undefined,
      enable_tools: false,
      tools: undefined,
      provider_messages: providerMessages,
      use_provider_messages: true,
    });
    if (finalResponse.output.trim().length > 0) {
      return finalResponse;
    }
  }

  return {
    provider_id: options.providerId,
    output:
      lastResponse && lastResponse.output.trim().length > 0
        ? lastResponse.output
        : "AI tool loop exceeded max rounds without a final answer.",
    tool_calls: undefined,
    finish_reason: "stop",
  };
}

function buildInitialProviderMessages(request: AiExecuteRequest, userMessageBody: string): AiProviderMessage[] {
  const messages: AiProviderMessage[] = [];
  if (request.history) {
    for (const turn of request.history) {
      messages.push({ role: turn.role, content: turn.content });
    }
  }
  messages.push({ role: "user", content: userMessageBody });
  return messages;
}
