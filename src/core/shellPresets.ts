import { formatShellCommandPreview } from "./shellProfiles";

export interface ShellPreset {
  id: string;
  name: string;
  shell: string;
  args: string[];
}

const STORAGE_KEY = "mach-terminal.shell-presets.v1";

export function loadShellPresets(): ShellPreset[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as ShellPreset[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (preset) =>
        typeof preset.id === "string" &&
        typeof preset.name === "string" &&
        typeof preset.shell === "string" &&
        Array.isArray(preset.args),
    );
  } catch {
    return [];
  }
}

export function saveShellPresets(presets: ShellPreset[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function createShellPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addShellPreset(preset: Omit<ShellPreset, "id"> & { id?: string }): ShellPreset[] {
  const next: ShellPreset = {
    id: preset.id ?? createShellPresetId(),
    name: preset.name.trim(),
    shell: preset.shell.trim(),
    args: [...preset.args],
  };
  const presets = [...loadShellPresets(), next];
  saveShellPresets(presets);
  return presets;
}

export function removeShellPreset(id: string): ShellPreset[] {
  const presets = loadShellPresets().filter((preset) => preset.id !== id);
  saveShellPresets(presets);
  return presets;
}

export function shellPresetPaletteId(presetId: string): string {
  return `preset:${presetId}`;
}

export function parseShellPresetPaletteId(commandId: string): string | null {
  return commandId.startsWith("preset:") ? commandId.slice("preset:".length) : null;
}

export function shellPresetDescription(preset: ShellPreset): string {
  return formatShellCommandPreview(preset.shell, preset.args);
}
