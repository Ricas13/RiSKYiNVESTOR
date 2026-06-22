export const DEFAULT_EXPANDABLE_ROW_LIMIT = 10;

export function expandableRows<T>(
  rows: T[],
  expanded: boolean,
  options: {
    initialLimit?: number;
    expandedLimit?: number;
  } = {},
) {
  const initialLimit = options.initialLimit ?? DEFAULT_EXPANDABLE_ROW_LIMIT;
  const expandedLimit = options.expandedLimit ?? Number.POSITIVE_INFINITY;
  const totalRows = rows.length;
  const boundedExpandedLimit = Number.isFinite(expandedLimit)
    ? Math.max(initialLimit, expandedLimit)
    : totalRows;
  const visibleCount =
    totalRows <= initialLimit
      ? totalRows
      : expanded
        ? Math.min(totalRows, boundedExpandedLimit)
        : initialLimit;
  return {
    hasOverflow: totalRows > initialLimit,
    totalRows,
    visibleCount,
    visibleRows: rows.slice(0, visibleCount),
  };
}
