export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function listFocusableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.tabIndex !== -1 && !element.hasAttribute("disabled"),
  );
}

/** Returns true when Tab was trapped inside `container`. */
export function handleFocusTrapTab(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">,
  container: ParentNode,
  activeElement: Element | null,
): boolean {
  if (event.key !== "Tab") {
    return false;
  }
  const focusable = listFocusableElements(container);
  if (focusable.length === 0) {
    return false;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && activeElement === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
