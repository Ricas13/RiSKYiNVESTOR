import { CheckCircle2, Pencil, Plus, Send, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import "../discordDestinations.css";
import type { DiscordDestination } from "../types";
import { formatDateTime } from "../utils/format";
import { Badge } from "./ui";

type Mutate = (path: string, method: "POST" | "PUT" | "DELETE", body?: unknown) => Promise<unknown>;
interface DiscordDestinationSubscriptions { entry: boolean; exit: boolean; lowLiquidity: boolean; scannerError: boolean; watchlistOnly: boolean; dailySummary: boolean; weeklySummary: boolean; }
const routingColumns: Array<{ key: keyof DiscordDestinationSubscriptions; shortLabel: string; label: string }> = [
  { key: "entry", shortLabel: "OPEN", label: "Actionable entry / OPEN alerts" },
  { key: "exit", shortLabel: "CLOSE", label: "Actionable exit / CLOSE alerts" },
  { key: "lowLiquidity", shortLabel: "Liquidity", label: "Low-liquidity warnings" },
  { key: "scannerError", shortLabel: "Errors", label: "Scanner errors" },
  { key: "watchlistOnly", shortLabel: "Watchlist", label: "Watchlist-only notices" },
  { key: "dailySummary", shortLabel: "Daily P/L", label: "Daily P/L summaries" },
  { key: "weeklySummary", shortLabel: "Weekly", label: "Weekly summaries" },
];
function subscriptionsFor(destination: DiscordDestination) {
  const subscriptions = (destination as DiscordDestination & { subscriptions?: Partial<DiscordDestinationSubscriptions> }).subscriptions;
  return Object.fromEntries(routingColumns.map(({ key }) => [key, subscriptions?.[key] === true])) as unknown as DiscordDestinationSubscriptions;
}

export function DiscordDestinations({ destinations, legacyDestination, mutate }: { destinations: DiscordDestination[]; legacyDestination: DiscordDestination | null; mutate: Mutate }) {
  const [form, setForm] = useState({ label: "", webhook: "", displayName: "", avatarUrl: "" });
  const [replacement, setReplacement] = useState<Record<string, string>>({});
  const [identity, setIdentity] = useState<Record<string, { displayName: string; avatarUrl: string }>>({});
  const [routing, setRouting] = useState<Record<string, DiscordDestinationSubscriptions>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    setReplacement((current) => Object.fromEntries(Object.entries(current).filter(([id]) => destinations.some((destination) => destination.destinationId === id))));
    setIdentity(Object.fromEntries(destinations.map((destination) => [destination.destinationId, { displayName: destination.displayName ?? "", avatarUrl: destination.avatarUrl ?? "" }])));
    setRouting(Object.fromEntries(destinations.map((destination) => [destination.destinationId, subscriptionsFor(destination)])));
  }, [destinations]);
  async function run(id: string, action: () => Promise<unknown>, success: string) {
    setBusy(id); setMessage("");
    try { await action(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Operation failed."); }
    finally { setBusy(""); }
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    await run("add", () => mutate("/discord-destinations", "POST", { ...form, webhook: form.webhook.trim() }), "Discord destination saved.");
    setForm({ label: "", webhook: "", displayName: "", avatarUrl: "" });
  }
  const all = [...destinations, ...(legacyDestination ? [legacyDestination] : [])];
  return <section className="settings-card discord-destinations">
    <div className="settings-card__heading"><ShieldCheck size={20}/><div><h2>Discord destinations</h2><p>Webhooks are encrypted at rest and are never revealed after saving.</p></div><Badge tone={destinations.some((item) => item.enabled) ? "green" : "amber"}>{destinations.filter((item) => item.enabled).length} ENABLED</Badge></div>
    <form className="discord-destination-form" onSubmit={add}>
      <label className="field"><span>Label</span><input required maxLength={80} value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Owner alerts"/></label>
      <label className="field field--full"><span>Discord webhook URL</span><input required type="password" autoComplete="new-password" value={form.webhook} onChange={(event) => setForm({ ...form, webhook: event.target.value })} placeholder="https://discord.com/api/webhooks/..."/></label>
      <label className="field"><span>Display name (optional)</span><input maxLength={80} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="Risky Investor"/></label>
      <label className="field"><span>Avatar HTTPS URL (optional)</span><input type="url" value={form.avatarUrl} onChange={(event) => setForm({ ...form, avatarUrl: event.target.value })}/></label>
      <p className="settings-note field--full">New destinations are saved disabled with no subscriptions. Configure routing below, then enable delivery.</p>
      <button className="button button--primary" disabled={busy === "add"}><Plus size={15}/> Save destination</button>
    </form>
    {all.length > 0 && <div className="discord-routing"><div><h3>Destination routing matrix</h3><p className="settings-note">Global notification settings apply first. Only enabled, subscribed destinations receive each category.</p></div><div className="discord-routing__scroll"><table className="discord-routing__table"><thead><tr><th>Destination</th>{routingColumns.map((column) => <th key={column.key} title={column.label}>{column.shortLabel}</th>)}<th>Save</th></tr></thead><tbody>{all.map((destination) => <tr key={destination.destinationId}><th scope="row"><span>{destination.label}</span>{destination.legacy && <small>Read-only fallback</small>}</th>{routingColumns.map((column) => <td key={column.key}>{destination.legacy ? <span className="discord-routing__legacy" title="Legacy fallback receives this category only while its existing migration safeguards permit delivery.">All</span> : <input type="checkbox" aria-label={`${destination.label}: ${column.label}`} checked={routing[destination.destinationId]?.[column.key] ?? false} onChange={(event) => setRouting({ ...routing, [destination.destinationId]: { ...routing[destination.destinationId], [column.key]: event.target.checked } })}/>}</td>)}<td>{destination.legacy ? <span className="discord-routing__readonly">-</span> : <button className="button button--secondary" disabled={Boolean(busy)} onClick={() => run(`routing-${destination.destinationId}`, () => mutate(`/discord-destinations/${destination.destinationId}`, "PUT", { enabled: { subscriptions: routing[destination.destinationId] } }), "Destination routing updated.")}>Save</button>}</td></tr>)}</tbody></table></div></div>}
    <div className="discord-destination-list">{all.length === 0 && <p className="settings-note">No Discord destination is configured.</p>}{all.map((destination) => <article className={`discord-destination ${destination.legacy ? "discord-destination--legacy" : ""}`} key={destination.destinationId}>
      <div className="discord-destination__summary"><div><strong>{destination.label}</strong><span>Webhook ending ....{destination.maskedEnding}</span></div><Badge tone={destination.enabled ? "green" : "blue"}>{destination.enabled ? "ENABLED" : "DISABLED"}</Badge></div>
      <p>{destination.displayName ? `Delivery name: ${destination.displayName}. ` : ""}Latest result: {destination.latestResult ?? "none"}. Last success: {destination.lastSuccessfulDeliveryAt ? formatDateTime(destination.lastSuccessfulDeliveryAt) : "none"}.</p>
      {destination.legacy ? <p className="settings-note">Read-only environment fallback. It is automatically suppressed while a UI-managed destination is enabled unless migration settings explicitly allow both.</p> : <>
        <div className="discord-destination__actions"><button className="button button--secondary" disabled={Boolean(busy)} onClick={() => run(destination.destinationId, () => mutate(`/discord-destinations/${destination.destinationId}`, "PUT", { enabled: !destination.enabled }), destination.enabled ? "Destination disabled." : "Destination enabled.")}><CheckCircle2 size={15}/>{destination.enabled ? "Disable" : "Enable"}</button><button className="button button--secondary" disabled={Boolean(busy)} onClick={() => run(`test-${destination.destinationId}`, () => mutate(`/discord-destinations/${destination.destinationId}/test`, "POST"), "Harmless Discord test completed.")}><Send size={15}/> Test</button><button className="button button--danger" disabled={Boolean(busy)} onClick={() => { if (!window.confirm(`Delete Discord destination "${destination.label}"? This cannot be undone.`)) return; void run(`delete-${destination.destinationId}`, () => mutate(`/discord-destinations/${destination.destinationId}`, "DELETE"), "Discord destination deleted."); }}><Trash2 size={15}/> Delete</button></div>
        <div className="discord-replace-row"><input type="password" autoComplete="new-password" value={replacement[destination.destinationId] ?? ""} onChange={(event) => setReplacement({ ...replacement, [destination.destinationId]: event.target.value })} placeholder="Paste replacement webhook"/><button className="button button--secondary" disabled={Boolean(busy) || !(replacement[destination.destinationId] ?? "").trim()} onClick={() => run(`replace-${destination.destinationId}`, () => mutate(`/discord-destinations/${destination.destinationId}/webhook`, "PUT", { webhook: replacement[destination.destinationId] }), "Discord webhook replaced.").then(() => setReplacement({ ...replacement, [destination.destinationId]: "" }))}><Pencil size={15}/> Replace webhook</button></div>
        <div className="discord-identity-row"><input value={identity[destination.destinationId]?.displayName ?? ""} onChange={(event) => setIdentity({ ...identity, [destination.destinationId]: { displayName: event.target.value, avatarUrl: identity[destination.destinationId]?.avatarUrl ?? "" } })} placeholder="Display name" maxLength={80}/><input type="url" value={identity[destination.destinationId]?.avatarUrl ?? ""} onChange={(event) => setIdentity({ ...identity, [destination.destinationId]: { displayName: identity[destination.destinationId]?.displayName ?? "", avatarUrl: event.target.value } })} placeholder="Avatar HTTPS URL"/><button className="button button--secondary" disabled={Boolean(busy)} onClick={() => run(`identity-${destination.destinationId}`, () => mutate(`/discord-destinations/${destination.destinationId}`, "PUT", identity[destination.destinationId]), "Webhook identity updated.")}><Pencil size={15}/> Save identity</button></div>
      </>}
    </article>)}</div>
    {message && <div className="form-message">{message}</div>}
  </section>;
}
