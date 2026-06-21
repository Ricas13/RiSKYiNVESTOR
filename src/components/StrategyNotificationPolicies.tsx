import { BellRing } from "lucide-react";
import type {
  DiscordDestination,
  NotificationSettings,
  StrategyEventType,
  StrategyId,
} from "../types";
import { Badge } from "./ui";

const strategies: Array<{ id: StrategyId; label: string }> = [
  { id: "daily-supertrend", label: "Daily SuperTrend" },
  { id: "nasdaq-sma200-3x", label: "Nasdaq SMA200 Regime — 3x" },
];

const eventTypes: Array<{ id: StrategyEventType; label: string }> = [
  { id: "entry", label: "Entry" },
  { id: "exit", label: "Exit" },
  { id: "lowLiquidity", label: "Low liquidity" },
  { id: "stateUpdate", label: "State update" },
  { id: "dailySummary", label: "Daily summary" },
  { id: "weeklySummary", label: "Weekly summary" },
  { id: "scannerError", label: "Scanner error" },
];

export function StrategyNotificationPolicies({
  value,
  destinations,
  onChange,
}: {
  value: NotificationSettings["strategyPolicies"];
  destinations: DiscordDestination[];
  onChange: (value: NotificationSettings["strategyPolicies"]) => void;
}) {
  function toggle(
    strategyId: StrategyId,
    eventType: StrategyEventType,
    destinationId: string,
    selected: boolean,
  ) {
    const current = value[strategyId][eventType];
    onChange({
      ...value,
      [strategyId]: {
        ...value[strategyId],
        [eventType]: selected
          ? [...new Set([...current, destinationId])]
          : current.filter((id) => id !== destinationId),
      },
    });
  }

  return (
    <section className="settings-card strategy-policy">
      <div className="settings-card__heading">
        <BellRing size={20} />
        <div>
          <h2>Strategy-specific notification policies</h2>
          <p>
            Website history is always retained. External delivery is muted
            unless a managed Discord destination is selected here.
          </p>
        </div>
        <Badge tone="blue">DEFAULT MUTED</Badge>
      </div>

      {destinations.length === 0 ? (
        <p className="settings-note">
          Add a managed Discord destination before enabling external strategy
          notifications.
        </p>
      ) : (
        strategies.map((strategy) => (
          <div className="strategy-policy__group" key={strategy.id}>
            <h3>{strategy.label}</h3>
            <div className="table-scroll">
              <table className="strategy-policy__table">
                <thead>
                  <tr>
                    <th>Event type</th>
                    <th>Website history</th>
                    {destinations.map((destination) => (
                      <th key={destination.destinationId}>
                        {destination.label}
                        <small>
                          {destination.enabled ? "enabled" : "disabled"}
                        </small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {eventTypes.map((eventType) => {
                    const selected = value[strategy.id][eventType.id];
                    return (
                      <tr key={eventType.id}>
                        <th scope="row">{eventType.label}</th>
                        <td>
                          <Badge tone="green">Always</Badge>
                        </td>
                        {destinations.map((destination) => (
                          <td key={destination.destinationId}>
                            <input
                              type="checkbox"
                              aria-label={`${strategy.label} ${eventType.label} to ${destination.label}`}
                              checked={selected.includes(
                                destination.destinationId,
                              )}
                              onChange={(event) =>
                                toggle(
                                  strategy.id,
                                  eventType.id,
                                  destination.destinationId,
                                  event.target.checked,
                                )
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
