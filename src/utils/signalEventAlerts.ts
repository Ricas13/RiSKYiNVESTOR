import type {
  NotificationDelivery,
  ScannerImportState,
  SignalEvent,
} from "../types";
import { canonicalSignalDate } from "./signalDates";

export type SignalEventAlertFilter =
  | "current"
  | "unacknowledged"
  | "acknowledged"
  | "historical"
  | "scanner-errors"
  | "delivery-failures"
  | "all";

export interface SignalEventAlertContext {
  scannerStatus: ScannerImportState["status"];
  scannerGeneratedAt: string | null;
  deliveries?: NotificationDelivery[];
  recentWindowDays?: number;
}

export interface SignalEventAlertMeta {
  isCurrentAction: boolean;
  isHistorical: boolean;
  isStale: boolean;
  isAcknowledged: boolean;
  hasDeliveryFailure: boolean;
  latestDeliveryStatus: string | null;
  statusLabel: string;
  reason: string;
}

const defaultRecentWindowDays = 7;

export function classifySignalEventAlert(
  event: SignalEvent,
  context: SignalEventAlertContext,
): SignalEventAlertMeta {
  const isStale = isSignalEventStale(event, context);
  const latestDelivery = latestEventDelivery(event, context.deliveries ?? []);
  const isHealthyScanner = context.scannerStatus === "current";
  const isCurrentScannerError =
    event.signalState === "scanner_error" &&
    context.scannerStatus === "error" &&
    !isStale;
  const isHistorical =
    isStale ||
    (event.signalState === "scanner_error" && !isCurrentScannerError) ||
    (isHealthyScanner && event.signalState === "scanner_error");
  const isCurrentAction =
    !event.isAcknowledged &&
    !isHistorical &&
    (event.isActionable || isCurrentScannerError);

  return {
    isCurrentAction,
    isHistorical,
    isStale,
    isAcknowledged: Boolean(event.isAcknowledged),
    hasDeliveryFailure: latestDelivery?.status === "failed",
    latestDeliveryStatus: latestDelivery?.status ?? null,
    statusLabel: event.isAcknowledged
      ? "Acknowledged"
      : isCurrentAction
        ? "Current action"
        : isHistorical
          ? "Historical"
          : "Unacknowledged",
    reason: explainEventStatus(event, {
      isCurrentAction,
      isHistorical,
      isStale,
      scannerStatus: context.scannerStatus,
    }),
  };
}

export function filterSignalEventsForAlertFilter(
  events: SignalEvent[],
  filter: SignalEventAlertFilter,
  context: SignalEventAlertContext,
) {
  return events.filter((event) => {
    const meta = classifySignalEventAlert(event, context);
    if (filter === "current") return meta.isCurrentAction;
    if (filter === "unacknowledged") return !meta.isAcknowledged;
    if (filter === "acknowledged") return meta.isAcknowledged;
    if (filter === "historical") return meta.isHistorical;
    if (filter === "scanner-errors") return event.signalState === "scanner_error";
    if (filter === "delivery-failures") return meta.hasDeliveryFailure;
    return true;
  });
}

export function currentSignalActions(
  events: SignalEvent[],
  context: SignalEventAlertContext,
) {
  return filterSignalEventsForAlertFilter(events, "current", context);
}

function isSignalEventStale(
  event: SignalEvent,
  context: SignalEventAlertContext,
) {
  const eventDate = parseDate(canonicalSignalDate(event));
  const anchorDate = parseDate(context.scannerGeneratedAt) ?? new Date();
  if (!eventDate) return true;

  const start = new Date(
    Date.UTC(
      anchorDate.getUTCFullYear(),
      anchorDate.getUTCMonth(),
      anchorDate.getUTCDate(),
    ),
  );
  start.setUTCDate(
    start.getUTCDate() -
      Math.max(1, context.recentWindowDays ?? defaultRecentWindowDays) +
      1,
  );
  const end = new Date(
    Date.UTC(
      anchorDate.getUTCFullYear(),
      anchorDate.getUTCMonth(),
      anchorDate.getUTCDate() + 1,
    ),
  );
  return eventDate < start || eventDate >= end;
}

function explainEventStatus(
  event: SignalEvent,
  state: {
    isCurrentAction: boolean;
    isHistorical: boolean;
    isStale: boolean;
    scannerStatus: ScannerImportState["status"];
  },
) {
  if (event.isAcknowledged) return "Acknowledged by the dashboard owner.";
  if (state.isCurrentAction) return "Current, unacknowledged signal action.";
  if (event.signalState === "scanner_error" && state.scannerStatus !== "error") {
    return "Historical scanner error; the scanner is not currently in error.";
  }
  if (state.isStale) {
    return "Historical event outside the current scanner review window.";
  }
  if (state.isHistorical) return "Historical event retained for audit.";
  return "Unacknowledged event retained in alert history.";
}

function latestEventDelivery(
  event: SignalEvent,
  deliveries: NotificationDelivery[],
) {
  return deliveries
    .filter((delivery) => delivery.eventId === event.eventId)
    .sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt))[0];
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
