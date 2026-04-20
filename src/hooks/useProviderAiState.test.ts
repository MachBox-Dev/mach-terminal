import { describe, expect, it } from "vitest";
import { historyAiContract } from "./useProviderAiState";

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
