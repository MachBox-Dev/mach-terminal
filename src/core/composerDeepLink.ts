import type { ComposerPayload } from "./terminal";

/**
 * Gating for applying a queued `machterm://composer` deep link (see
 * `docs/deep-link-contract.md`). Requires an unlocked composer with an empty draft so a
 * cold start, a locked (non-operator) composer, or a command the user is already
 * mid-typing all cause the handoff to wait rather than being dropped or silently
 * clobbered.
 */
export function canApplyPendingComposerText(
  pending: ComposerPayload | null,
  composerLocked: boolean,
  composerDraft: string,
): pending is ComposerPayload {
  return pending !== null && !composerLocked && composerDraft.length === 0;
}
