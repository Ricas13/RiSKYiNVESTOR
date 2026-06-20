import { AsyncLocalStorage } from "node:async_hooks";

export const defaultDashboardAppearance = {
  theme: "midnight",
  density: "comfortable",
} as const;

export type DashboardTheme = "midnight" | "slate" | "ocean";
export type DashboardDensity = "comfortable" | "compact";

export interface DashboardAppearance {
  theme: DashboardTheme;
  density: DashboardDensity;
}

const requestAppearance = new AsyncLocalStorage<
  DashboardAppearance | undefined
>();

export function normaliseDashboardAppearance(
  value: unknown,
): DashboardAppearance {
  const supplied =
    value && typeof value === "object"
      ? (value as { theme?: unknown; density?: unknown })
      : {};
  const theme = ["midnight", "slate", "ocean"].includes(
    String(supplied.theme),
  )
    ? (supplied.theme as DashboardTheme)
    : defaultDashboardAppearance.theme;
  const density = ["comfortable", "compact"].includes(
    String(supplied.density),
  )
    ? (supplied.density as DashboardDensity)
    : defaultDashboardAppearance.density;
  return { theme, density };
}

export function withDashboardAppearance<T extends Record<string, unknown>>(
  settings: T,
) {
  return {
    ...settings,
    appearance: normaliseDashboardAppearance(settings.appearance),
  };
}

export function runWithDashboardAppearance(
  value: unknown,
  callback: () => void,
) {
  return requestAppearance.run(
    value === undefined ? undefined : normaliseDashboardAppearance(value),
    callback,
  );
}

export function currentDashboardAppearance() {
  return requestAppearance.getStore();
}
