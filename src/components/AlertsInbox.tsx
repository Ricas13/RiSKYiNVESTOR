import { Bell, CheckCheck, CircleAlert, Inbox, TriangleAlert } from "lucide-react";
import type { AlertRecord, AlertStatus, ManualTrade } from "../types";
import { formatDateTime } from "../utils/format";
import { Badge } from "./ui";

export function AlertsInbox({
  alerts,
  trades,
  mutate,
}: {
  alerts: AlertRecord[];
  trades: ManualTrade[];
  mutate: (
    path: string,
    method: "POST" | "PUT" | "DELETE",
    body?: unknown,
  ) => Promise<unknown>;
}) {
  const sorted = [...alerts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = alerts.filter((alert) => alert.status === "unread").length;

  async function update(alert: AlertRecord, status: AlertStatus) {
    await mutate(`/alerts/${alert.id}`, "PUT", {
      status,
      manualTradeId: alert.manualTradeId,
    });
  }

  return (
    <div className="alerts-panel panel">
      <div className="alerts-summary">
        <div>
          <Inbox size={20} />
          <span>{alerts.length} archived alerts</span>
        </div>
        <Badge tone={unread ? "amber" : "green"}>{unread} unread</Badge>
      </div>
      <div className="alerts-list">
        {sorted.map((alert) => {
          const Icon =
            alert.alertType === "ERROR"
              ? CircleAlert
              : alert.alertType === "LIQUIDITY"
                ? TriangleAlert
                : alert.status === "actioned"
                  ? CheckCheck
                  : Bell;
          const trade = trades.find((item) => item.id === alert.manualTradeId);
          return (
            <article className={`alert-row alert-row--${alert.status}`} key={alert.id}>
              <span className="alert-row__icon"><Icon size={17} /></span>
              <div className="alert-row__copy">
                <div>
                  <Badge tone={alert.alertType === "EXIT" || alert.alertType === "ERROR" ? "red" : alert.alertType === "LIQUIDITY" || alert.alertType === "TAKE PROFIT" ? "amber" : "green"}>
                    {alert.alertType}
                  </Badge>
                  <span>{formatDateTime(alert.createdAt)}</span>
                </div>
                <h3>{alert.ticker || alert.strategyName}</h3>
                <p>{alert.message}</p>
                {trade && <small>Linked to {trade.ticker} entered {trade.entryDate}</small>}
              </div>
              <select value={alert.status} onChange={(event) => update(alert, event.target.value as AlertStatus)} aria-label={`Status for ${alert.message}`}>
                <option value="unread">Unread</option>
                <option value="read">Read</option>
                <option value="actioned">Actioned</option>
                <option value="ignored">Ignored</option>
              </select>
            </article>
          );
        })}
      </div>
    </div>
  );
}
