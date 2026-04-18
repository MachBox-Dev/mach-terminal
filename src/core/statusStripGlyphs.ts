/**
 * Nerd Font PUA glyphs (Fira Code Nerd Font Mono / nf-fa-*).
 * Cheat sheet: https://www.nerdfonts.com/cheat-sheet
 *
 * If you see tofu boxes here, the UI stack expects a Nerd-patched face (see `--mach-terminal-mono` in App.css).
 * Alternatives: install "FiraCode Nerd Font" from nerdfonts.com, or swap these strings to inline SVG / assets
 * and render them in `MachStatusStrip` instead of private-use codepoints.
 */
export const StatusGlyphs = {
  terminal: "\uf120",
  folder: "\uf07c",
  clock: "\uf017",
  gitBranch: "\uf126",
  gitWorkingTree: "\uf15b",
  shieldAdmin: "\uf132",
  metrics: "\uf080",
} as const;

export function shellChipLabel(shellPath: string): string {
  const leaf = shellPath.replace(/[/\\]/g, "/").split("/").pop() ?? shellPath;
  return leaf.replace(/\.exe$/i, "");
}
