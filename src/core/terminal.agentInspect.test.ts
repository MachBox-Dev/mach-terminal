import { expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({ sessionId: "s" })) }));
import { invoke } from "@tauri-apps/api/core";
import { ptyInspectSessionProcess } from "./terminal";

it("uses the Tauri command argument casing for session process inspection", async () => {
  await ptyInspectSessionProcess("s");
  expect(invoke).toHaveBeenCalledWith("pty_inspect_session_process", { sessionId: "s" });
});
