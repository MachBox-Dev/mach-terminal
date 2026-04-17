import type { PaletteCommand } from "../components/CommandPalette";

export interface RankedPaletteCommand {
  command: PaletteCommand;
  score: number;
}

function scoreText(haystack: string, needle: string): number {
  if (!needle) {
    return 1;
  }
  const index = haystack.indexOf(needle);
  if (index === -1) {
    return 0;
  }
  if (index === 0) {
    return 8;
  }
  return Math.max(2, 6 - index);
}

export function scorePaletteCommand(command: PaletteCommand, query: string): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return 1;
  }

  const label = command.label.toLowerCase();
  const shortcut = (command.shortcut ?? "").toLowerCase();
  const id = command.id.toLowerCase();

  const labelScore = scoreText(label, normalized);
  const shortcutScore = scoreText(shortcut, normalized);
  const idScore = scoreText(id, normalized);

  return labelScore * 3 + shortcutScore * 2 + idScore;
}

export function filterPaletteCommands(commands: PaletteCommand[], query: string): RankedPaletteCommand[] {
  return commands
    .map((command) => ({ command, score: scorePaletteCommand(command, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.command.label.localeCompare(b.command.label);
    });
}
