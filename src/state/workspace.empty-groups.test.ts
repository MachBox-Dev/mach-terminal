import { describe, expect, it } from "vitest";
import { addNewSessionTab, createWorkspaceState, reconcileWorkspace, sessionIdsInGroup } from "./workspace";

describe("empty groups orphan tab loop", () => {
  it("reconcileWorkspace with no groups creates one tab per session", () => {
    const empty: ReturnType<typeof createWorkspaceState> = { groups: [], activeGroupId: "" };
    const repaired = reconcileWorkspace(empty, ["session-a", "session-b", "session-c"]);
    expect(repaired.groups.length).toBe(3);
    expect(repaired.groups.map((g) => sessionIdsInGroup(g))).toEqual([
      ["session-a"],
      ["session-b"],
      ["session-c"],
    ]);
  });

  it("addNewSessionTab on empty groups creates only the new tab", () => {
    const empty: ReturnType<typeof createWorkspaceState> = { groups: [], activeGroupId: "" };
    const next = addNewSessionTab(empty, ["session-a", "session-b"], "session-c");
    expect(next.groups.length).toBe(1);
    expect(sessionIdsInGroup(next.groups[0])).toEqual(["session-c"]);
  });
});
