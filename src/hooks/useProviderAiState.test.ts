import { describe, expect, it } from "vitest";
import {
  historyAiContract,
  mergeProviderApiKeyDrafts,
  nextAiRequestId,
  shouldApplyAiResult,
} from "./useProviderAiState";

describe("history AI orchestration contracts", () => {
  it("keeps explain command prompt, intent, and statuses stable", () => {
    const command = "rm -rf ./tmp && npm run build";
    const contract = historyAiContract("explain", command);
    expect(contract.prompt).toBe(`Explain this shell command:\n${command}`);
    expect(contract.intent).toBe("explain_command");
    expect(contract.pendingStatus).toBe("Generating AI explanation...");
    expect(contract.successStatus).toBe("AI explanation ready.");
    expect(contract.historyFailureStatus).toBe("AI explanation failed.");
    expect(contract.fallbackErrorMessage).toBe("AI explain failed.");
  });

  it("keeps fix command prompt, intent, and statuses stable", () => {
    const command = "kubectl delete pod app --all";
    const contract = historyAiContract("fix", command);
    expect(contract.prompt).toBe(
      `Provide a safer or corrected version of this command, with a short explanation:\n${command}`,
    );
    expect(contract.intent).toBe("fix_command");
    expect(contract.pendingStatus).toBe("Generating safer command suggestion...");
    expect(contract.successStatus).toBe("AI fix suggestion ready.");
    expect(contract.historyFailureStatus).toBe("AI fix failed.");
    expect(contract.fallbackErrorMessage).toBe("AI fix failed.");
  });
});

describe("provider AI reliability helpers", () => {
  it("treats only the latest request id as writable", () => {
    expect(nextAiRequestId(0)).toBe(1);
    expect(nextAiRequestId(41)).toBe(42);
    expect(shouldApplyAiResult(42, 42)).toBe(true);
    expect(shouldApplyAiResult(43, 42)).toBe(false);
  });

  it("preserves API key drafts for providers that remain after refresh", () => {
    const merged = mergeProviderApiKeyDrafts(
      [
        { id: "ollama", name: "Ollama", status: "available", kind: "local", enabled: true },
        {
          id: "openai",
          name: "OpenAI",
          status: "available",
          kind: "cloud",
          enabled: false,
          hasStoredKey: true,
        },
      ],
      {
        ollama: "",
        openai: "sk-test-draft",
        anthropic: "should-drop-when-provider-not-present",
      },
    );
    expect(merged).toEqual({
      ollama: "",
      openai: "sk-test-draft",
    });
  });
});
