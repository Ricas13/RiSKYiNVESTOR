import { Check, LayoutGrid, Palette, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyAppearance,
  dashboardThemes,
  normaliseAppearance,
  type DashboardAppearance,
  type DashboardSettingsWithAppearance,
} from "../appearance";
import type { DashboardSettings } from "../types";

type Mutate = (
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
) => Promise<unknown>;

export function AppearanceSettings({
  settings,
  mutate,
}: {
  settings: DashboardSettings;
  mutate: Mutate;
}) {
  const saved = useMemo(() => normaliseAppearance(settings), [settings]);
  const [draft, setDraft] = useState<DashboardAppearance>(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const savedRef = useRef(saved);
  const dirty =
    draft.theme !== saved.theme || draft.density !== saved.density;

  useEffect(() => {
    savedRef.current = saved;
    setDraft(saved);
  }, [saved]);

  useEffect(() => {
    applyAppearance(draft);
  }, [draft]);

  useEffect(
    () => () => {
      applyAppearance(savedRef.current);
    },
    [],
  );

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      await mutate("/settings", "PUT", {
        ...(settings as DashboardSettingsWithAppearance),
        appearance: draft,
      });
      savedRef.current = draft;
      setMessage("Appearance saved to your private dashboard settings.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Appearance could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card appearance-settings">
      <div className="settings-card__heading">
        <Palette size={20} />
        <div>
          <h2>Appearance and density</h2>
          <p>Three curated dark themes, tuned for readable trading status.</p>
        </div>
        <span className={`unsaved-indicator ${dirty ? "is-dirty" : ""}`}>
          <i aria-hidden="true" />
          {dirty ? "Unsaved" : "Saved"}
        </span>
      </div>

      <fieldset className="theme-options">
        <legend>Dashboard theme</legend>
        {dashboardThemes.map((theme) => (
          <label
            className={`theme-option theme-option--${theme.value}`}
            key={theme.value}
          >
            <input
              type="radio"
              name="dashboard-theme"
              value={theme.value}
              checked={draft.theme === theme.value}
              onChange={() => setDraft({ ...draft, theme: theme.value })}
            />
            <span className="theme-option__preview" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>
              <strong>{theme.label}</strong>
              <small>{theme.description}</small>
            </span>
            {draft.theme === theme.value && <Check size={17} />}
          </label>
        ))}
      </fieldset>

      <fieldset className="density-options">
        <legend>Information density</legend>
        <label>
          <input
            type="radio"
            name="dashboard-density"
            checked={draft.density === "comfortable"}
            onChange={() =>
              setDraft({ ...draft, density: "comfortable" })
            }
          />
          <LayoutGrid size={17} />
          <span>
            <strong>Comfortable</strong>
            <small>More breathing room for everyday review</small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="dashboard-density"
            checked={draft.density === "compact"}
            onChange={() => setDraft({ ...draft, density: "compact" })}
          />
          <LayoutGrid size={17} />
          <span>
            <strong>Compact</strong>
            <small>Denser tables, logs, cards and settings</small>
          </span>
        </label>
      </fieldset>

      <div className="appearance-save">
        {message && <span className="form-message">{message}</span>}
        <button
          className="button button--primary"
          disabled={busy || !dirty}
          onClick={save}
        >
          <Save size={16} /> Save appearance
        </button>
      </div>
    </section>
  );
}
