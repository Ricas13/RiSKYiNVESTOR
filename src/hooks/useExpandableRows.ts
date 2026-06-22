import { useMemo, useState } from "react";
import { expandableRows } from "../utils/expandableRows";

export function useExpandableRows<T>(
  rows: T[],
  options: {
    initialLimit?: number;
    expandedLimit?: number;
  } = {},
) {
  const [expanded, setExpanded] = useState(false);
  const { hasOverflow, totalRows, visibleCount } = expandableRows(
    rows,
    expanded,
    options,
  );
  const visibleRows = useMemo(
    () => rows.slice(0, visibleCount),
    [rows, visibleCount],
  );
  return {
    expanded,
    hasOverflow,
    setExpanded,
    totalRows,
    visibleCount,
    visibleRows,
  };
}
