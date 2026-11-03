// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { sessionBufferStore } from "../state/sessionBufferStore";
import { useSessionBufferSubscription } from "./useSessionBufferSubscription";

it("streams capped output without rendering, and cleans up when switching or unmounting", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const consume = vi.fn();
  let renders = 0;
  function Harness({ id }: { id: string }) {
    renders += 1;
    useSessionBufferSubscription(id, consume);
    return null;
  }
  try {
    await act(async () => root.render(<Harness id="subscription-a" />));
    const before = renders;
    for (let i = 0; i < 100; i += 1) sessionBufferStore.append("subscription-a", "same", 8);
    expect(renders).toBe(before);
    expect(consume).toHaveBeenLastCalledWith("subscription-a", { text: "samesame", startOffset: 392, totalAppended: 400 });
    await act(async () => root.render(<Harness id="subscription-b" />));
    consume.mockClear();
    sessionBufferStore.append("subscription-a", "old", 8);
    expect(consume).not.toHaveBeenCalled();
    sessionBufferStore.append("subscription-b", "new", 8);
    expect(consume).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    consume.mockClear();
    sessionBufferStore.append("subscription-b", "after", 8);
    expect(consume).not.toHaveBeenCalled();
  } finally {
    sessionBufferStore.remove("subscription-a");
    sessionBufferStore.remove("subscription-b");
    vi.unstubAllGlobals();
  }
});
