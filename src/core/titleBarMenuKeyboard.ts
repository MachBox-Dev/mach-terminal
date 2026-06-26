export function decideTitleBarMenuKeyAction(args: {
  key: string;
  activeIndex: number;
  itemCount: number;
}): { nextIndex: number; shouldClose: boolean; handled: boolean } | null {
  const { key, activeIndex, itemCount } = args;
  if (itemCount <= 0) {
    return null;
  }
  if (key === "ArrowDown") {
    const base = activeIndex < 0 ? 0 : activeIndex;
    return { nextIndex: (base + 1) % itemCount, shouldClose: false, handled: true };
  }
  if (key === "ArrowUp") {
    const base = activeIndex < 0 ? 0 : activeIndex;
    return { nextIndex: (base - 1 + itemCount) % itemCount, shouldClose: false, handled: true };
  }
  if (key === "Home") {
    return { nextIndex: 0, shouldClose: false, handled: true };
  }
  if (key === "End") {
    return { nextIndex: itemCount - 1, shouldClose: false, handled: true };
  }
  if (key === "Escape") {
    return { nextIndex: activeIndex, shouldClose: true, handled: true };
  }
  return null;
}
