import type { MultiStrategyEvent, SignalEvent } from "../types";

export function strategySignalDate(event: MultiStrategyEvent | null | undefined) {
  return event?.signalDate ?? event?.occurredAt ?? null;
}

export function canonicalSignalDate(event: SignalEvent) {
  return event.signalDate || event.occurredAt.slice(0, 10);
}

export function canonicalGeneratedAt(event: SignalEvent) {
  return event.generatedAt || event.receivedAt;
}

export function sortCanonicalBySignalDate(left: SignalEvent, right: SignalEvent) {
  return (
    canonicalSignalDate(right).localeCompare(canonicalSignalDate(left)) ||
    canonicalGeneratedAt(right).localeCompare(canonicalGeneratedAt(left))
  );
}

export function sortStrategyBySignalDate(
  left: MultiStrategyEvent,
  right: MultiStrategyEvent,
) {
  return (
    (strategySignalDate(right) ?? "").localeCompare(strategySignalDate(left) ?? "") ||
    right.occurredAt.localeCompare(left.occurredAt)
  );
}
