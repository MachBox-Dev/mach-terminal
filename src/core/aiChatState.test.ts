import { describe, expect, it } from "vitest";
import { extractAiCommandText } from "../components/AiChatPanel";
import { persistAiChatsForSessions } from "./aiChatPersistence";
import { attachmentFromAiNote, attachmentBlockForContext, createAttachmentId, createChatMessageId } from "./aiChatState";
import { AI_CONTEXT_OUTPUT_MAX_CHARS } from "./terminal";

describe("attachmentFromAiNote", () => {
  it("uses the provided label, trimmed", () => {
    const attachment = attachmentFromAiNote({ label: "  Deploy runbook  ", text: "kubectl rollout restart deploy/api" });
    expect(attachment.label).toBe("Deploy runbook");
    expect(attachment.text).toBe("kubectl rollout restart deploy/api");
  });

  it("falls back to a generic label when label is missing", () => {
    const attachment = attachmentFromAiNote({ text: "echo hello" });
    expect(attachment.label).toBe("Armory note");
  });

  it("falls back to a generic label when label is blank/whitespace", () => {
    const attachment = attachmentFromAiNote({ label: "   ", text: "echo hello" });
    expect(attachment.label).toBe("Armory note");
  });

  it("caps text at the shared AI context budget", () => {
    const longText = "x".repeat(AI_CONTEXT_OUTPUT_MAX_CHARS + 500);
    const attachment = attachmentFromAiNote({ text: longText });
    expect(attachment.text.length).toBeLessThanOrEqual(AI_CONTEXT_OUTPUT_MAX_CHARS);
  });

  it("assigns a fresh attachment id each call", () => {
    const first = attachmentFromAiNote({ text: "a" });
    const second = attachmentFromAiNote({ text: "b" });
    expect(first.id).not.toBe(second.id);
  });
});

describe("createAttachmentId / createChatMessageId", () => {
  it("produce distinct ids", () => {
    expect(createAttachmentId()).not.toBe(createAttachmentId());
    expect(createChatMessageId()).not.toBe(createChatMessageId());
  });
});

describe("attachmentBlockForContext", () => {
  it("formats attachments as labeled blocks", () => {
    const block = attachmentBlockForContext([{ id: "1", label: "Armory note", text: "echo hi" }]);
    expect(block).toBe("[Armory note]\necho hi");
  });

  it("removes cleared chat threads from persisted store", () => {
    const next = persistAiChatsForSessions(
      { s1: [] },
      { s1: "chat-key-1" },
      {
        "chat-key-1": [{ id: "m1", role: "user", content: "old", atMs: 1 }],
        "chat-key-2": [{ id: "m2", role: "user", content: "keep", atMs: 2 }],
      },
    );
    expect(next["chat-key-1"]).toBeUndefined();
    expect(next["chat-key-2"]).toHaveLength(1);
  });

  it("extracts fenced command block from AI responses", () => {
    expect(extractAiCommandText("Run this:\n```bash\ngit status\n```")).toBe("git status");
    expect(extractAiCommandText("  echo hello  ")).toBe("echo hello");
  });
});
