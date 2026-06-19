import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Check,
  CircleAlert,
  Clock3,
  Eye,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import type {
  NotificationDelivery,
  ScannerImportState,
  SignalEvent,
  SignalState,
} from "../types";
import { formatDateTime } from "../utils/format";
import { Badge } from "./ui";

function eventTone(type: SignalState) {
  if (type === "actionable_entry") return "green" as const;
  if (type === "actionable_exit" || type === "scanner_error") {
    return "red" as const;
  }
  if (type === "watchlist_only") return "purple" as const;
  if (type === "no_change" || type === "informational") return "blue" as const;
  return "amber" as const;
}

function stateLabel(type: SignalState) {
  return type.replace(/_/g, " ");
}

function EventIcon({ type }: { type: SignalState }) {
  if (type === "actionable_entry") return <ArrowUpRight size={19} />;
  if (type === "actionable_exit") return <ArrowDownRight size={19} />;
  if (type === "scanner_error") return <CircleAlert size={19} />;
  if (type === "low_liquidity_warning") return <TriangleAlert size={19} />;
  if (type === "watchlist_only") return <Eye size={19} />;
  return <Clock3 size={19} />;
}

function noActionCopy(scanner: ScannerImportState) {
  if (scanner.status === "awaiting") {
    return {
      title: "Awaiting scanner data",
      detail:
        "No valid canonical scanner export has been imported. The dashboard will not invent an alert from the watchlist trend.",
      tone: "blue" as const,
    };
  }
  if (scanner.status === "stale") {
    return {
      title: "Scanner data stale",
      detail: `The last successful scanner export is older than ${scanner.staleAfterMinutes} minutes. Treat displayed state as historical.`,
      tone: "amber" as const,
    };
  }
  if (scanner.status === "error") {
    return {
      title: "Scanner import needs review",
      detail:
        scanner.lastError ??
        "The scanner reported an error or supplied an invalid export.",
      tone: "red" as const,
    };
  }
  return {
    title: "No action today",
    detail:
      "The scanner has not supplied a new actionable entry or exit event.",
    tone: "green" as const,
  };
}

export function TodayActionPanel({
  events,
  scanner,
}: {
  events: SignalEvent[];
  scanner: ScannerImportState;
}) {
  const actionable = [...events]
    .filter((event) => event.isActionable)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  const reviewCount = events.filter((event) =>
    ["low_liquidity_warning", "scanner_error", "wait_review"].includes(
      event.signalState,
    ),
  ).length;
  const empty = noActionCopy(scanner);

  return (
    <section className="control-actions" aria-label="Today's action">
      <div className="control-actions__heading">
        <div>
          <span>Today&apos;s action</span>
          <h1>{actionable ? "One decision requires attention" : empty.title}</h1>
        </div>
        <Badge tone={actionable ? "amber" : empty.tone}>
          {actionable ? "ACTION REQUIRED" : scanner.status.toUpperCase()}
        </Badge>
      </div>

      {actionable ? (
        <article
          className={`control-action control-action--${eventTone(actionable.signalState)}`}
        >
          <span className="control-action__icon">
            <EventIcon type={actionable.signalState} />
          </span>
          <div>
            <Badge tone={eventTone(actionable.signalState)}>
              {stateLabel(actionable.signalState)}
            </Badge>
            <h2>
              {actionable.signalState === "actionable_entry" ? "BUY" : "EXIT"}{" "}
              {actionable.tradeTicker}
            </h2>
            <p>{actionable.reasonText}</p>
            <small>
              {actionable.strategyName} · {actionable.riskTier} ·{" "}
              {actionable.allocationPercent}% allocation ·{" "}
              {formatDateTime(actionable.occurredAt)}
            </small>
          </div>
        </article>
      ) : (
        <div className="control-no-action">
          <ShieldAlert size={22} />
          <div>
            <strong>{empty.title}</strong>
            <p>{empty.detail}</p>
          </div>
        </div>
      )}

      {reviewCount > 0 && (
        <div className="control-review-line">
          <TriangleAlert size={15} />
          {reviewCount} non-actionable review event
          {reviewCount === 1 ? "" : "s"} remain in Signals.
        </div>
      )}
    </section>
  );
}

export function SignalEventList({
  events,
  deliveries = [],
  limit,
  compact = false,
  emptyCopy = "Awaiting scanner data.",
  onAcknowledge,
}: {
  events: SignalEvent[];
  deliveries?: NotificationDelivery[];
  limit?: number;
  compact?: boolean;
  emptyCopy?: string;
  onAcknowledge?: (event: SignalEvent) => Promise<void>;
}) {
  const visible = [...events]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit);

  if (!visible.length) return <div className="empty-state">{emptyCopy}</div>;

  return (
    <div className={`event-list ${compact ? "event-list--compact" : ""}`}>
      {visible.map((event) => {
        const latestDelivery = deliveries
          .filter((delivery) => delivery.eventId === event.eventId)
          .sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt))[0];
        return (
          <article className="event-row" key={event.eventId}>
            <span
              className={`event-row__icon event-row__icon--${eventTone(event.signalState)}`}
            >
              <EventIcon type={event.signalState} />
            </span>
            <div className="event-row__main">
              <div className="event-row__meta">
                <Badge tone={eventTone(event.signalState)}>
                  {stateLabel(event.signalState)}
                </Badge>
                <span>{formatDateTime(event.occurredAt)}</span>
                <span>{event.strategyName}</span>
              </div>
              <h3>
                {event.underlyingTicker} → {event.tradeTicker}
              </h3>
              <p>{event.reasonText}</p>
              {!compact && (
                <small>
                  {event.reasonCode} · run {event.scannerRunId} · source{" "}
                  {event.source}
                </small>
              )}
              {!compact && onAcknowledge && !event.isAcknowledged && (
                <button
                  className="event-acknowledge"
                  onClick={() => void onAcknowledge(event)}
                >
                  <Check size={14} /> Acknowledge
                </button>
              )}
            </div>
            <dl className="event-row__facts">
              <div>
                <dt>Transition</dt>
                <dd>
                  {event.previousTrend} → {event.currentTrend}
                </dd>
              </div>
              <div>
                <dt>Eligibility</dt>
                <dd>{event.eligibility}</dd>
              </div>
              <div>
                <dt>Allocation</dt>
                <dd>
                  {event.allocationStatus} · {event.allocationPercent}%
                </dd>
              </div>
              <div>
                <dt>Actionable</dt>
                <dd>{event.isActionable ? "yes" : "no"}</dd>
              </div>
              <div>
                <dt>Acknowledged</dt>
                <dd>{event.isAcknowledged ? "yes" : "no"}</dd>
              </div>
              <div>
                <dt>Latest delivery</dt>
                <dd>{latestDelivery?.status ?? "not recorded"}</dd>
              </div>
              <div>
                <dt>Future Discord</dt>
                <dd>
                  {event.discordDeliveryEligible
                    ? "eligible"
                    : "not eligible"}
                </dd>
              </div>
            </dl>
          </article>
        );
      })}
    </div>
  );
}

export function NotificationHistory({
  deliveries,
  limit,
  onRetry,
  onResend,
}: {
  deliveries: NotificationDelivery[];
  limit?: number;
  onRetry?: (deliveryId: string) => void;
  onResend?: (deliveryId: string) => void;
}) {
  const visible = deliveries.slice(0, limit);
  if (!visible.length) {
    return (
      <div className="empty-state">
        No notification delivery attempts have been recorded.
      </div>
    );
  }
  return (
    <div className="delivery-list">
      {visible.map((delivery) => (
        <article key={delivery.deliveryId}>
          <Bell size={16} />
          <div>
            <div>
              <Badge
                tone={
                  delivery.status === "sent"
                    ? "green"
                    : delivery.status === "failed"
                      ? "red"
                      : "amber"
                }
              >
                {delivery.status}
              </Badge>
              <span>
                {delivery.channel} · {delivery.category ?? "signal"} ·{" "}
                {formatDateTime(delivery.attemptedAt)}
              </span>
            </div>
            {delivery.message && <p>{delivery.message}</p>}
            {delivery.errorMessage && <small>{delivery.errorMessage}</small>}
            <small>
              {delivery.deliveredAt
                ? `Delivered ${formatDateTime(delivery.deliveredAt)}`
                : "Not delivered"}
              {delivery.retryCount > 0
                ? ` · retries ${delivery.retryCount}`
                : ""}
            </small>
            {delivery.status === "failed" && onRetry && (
              <button
                className="button button--secondary"
                type="button"
                onClick={() => onRetry(delivery.deliveryId)}
              >
                Retry
              </button>
            )}
            {delivery.status === "sent" &&
              ["discord", "daily_summary"].includes(delivery.channel) &&
              onResend && (
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => onResend(delivery.deliveryId)}
                >
                  Re-send
                </button>
              )}
          </div>
        </article>
      ))}
    </div>
  );
}
