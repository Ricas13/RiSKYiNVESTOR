import type { DashboardSettings } from "./types";

export type DashboardTheme = "midnight" | "slate" | "ocean";
export type DashboardDensity = "comfortable" | "compact";

export interface DashboardAppearance {
  theme: DashboardTheme;
  density: DashboardDensity;
}

export type DashboardSettingsWithAppearance = DashboardSettings & {
  appearance?: Partial<DashboardAppearance>;
};

export const dashboardThemes: Array<{
  value: DashboardTheme;
  label: string;
  description: string;
}> = [
  {
    value: "midnight",
    label: "Midnight",
    description: "Near-black premium default",
  },
  {
    value: "slate",
    label: "Slate",
    description: "Neutral dark-grey",
  },
  {
    value: "ocean",
    label: "Ocean",
    description: "Dark navy and blue",
  },
];

export function normaliseAppearance(
  settings?: DashboardSettings | null,
): DashboardAppearance {
  const appearance = (settings as DashboardSettingsWithAppearance | null)
    ?.appearance;
  return {
    theme: ["midnight", "slate", "ocean"].includes(
      String(appearance?.theme),
    )
      ? (appearance!.theme as DashboardTheme)
      : "midnight",
    density: ["comfortable", "compact"].includes(
      String(appearance?.density),
    )
      ? (appearance!.density as DashboardDensity)
      : "comfortable",
  };
}

export function applyAppearance(appearance: DashboardAppearance) {
  document.documentElement.dataset.theme = appearance.theme;
  document.documentElement.dataset.density = appearance.density;
}
