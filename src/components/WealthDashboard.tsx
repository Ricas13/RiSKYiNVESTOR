import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDown,
  ArrowUp,
  BadgePoundSterling,
  CalendarRange,
  Landmark,
  Pencil,
  Percent,
  Plus,
  Save,
  Trash2,
  Trophy,
  WalletCards,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { CashFlow, ManualTrade, WealthSnapshot } from "../types";
import { formatDate, formatMoney, formatNumber } from "../utils/format";
import { calculateTrade } from "../utils/manualTrades";
import { Badge } from "./ui";

const chartColors = [
  "#26d980",
  "#63a9ff",
  "#ae8cff",
  "#f8b84e",
  "#ff5f69",
  "#4bd6c5",
];
const tooltipStyle = {
  background: "var(--surface-raised)",
  border: "1px solid var(--border-strong)",
  borderRadius: "12px",
  color: "var(--text-primary)",
  fontSize: "11px",
};
const today = () => new Date().toISOString().slice(0, 10);

export function WealthDashboard({
  snapshots,
  cashFlows,
  trades,
  isExample,
  mutate,
}: {
  snapshots: WealthSnapshot[];
  cashFlows: CashFlow[];
  trades: ManualTrade[];
  isExample: boolean;
  mutate: (
    path: string,
    method: "POST" | "PUT" | "DELETE",
    body?: unknown,
  ) => Promise<unknown>;
}) {
  const [snapshotForm, setSnapshotForm] = useState({
    date: today(),
    totalPortfolioValue: "",
    cashBalance: "",
    investedValue: "",
    notes: "",
  });
  const [snapshotEdit, setSnapshotEdit] = useState<string | null>(null);
  const [flowForm, setFlowForm] = useState({
    date: today(),
    type: "deposit",
    amount: "",
    notes: "",
  });
  const [flowEdit, setFlowEdit] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const analytics = useMemo(
    () => buildWealthAnalytics(snapshots, cashFlows, trades),
    [snapshots, cashFlows, trades],
  );

  async function submitSnapshot(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await mutate(
        snapshotEdit
          ? `/wealth/snapshots/${snapshotEdit}`
          : "/wealth/snapshots",
        snapshotEdit ? "PUT" : "POST",
        {
          ...snapshotForm,
          totalPortfolioValue: Number(snapshotForm.totalPortfolioValue),
          cashBalance: Number(snapshotForm.cashBalance),
          investedValue: Number(snapshotForm.investedValue),
        },
      );
      setSnapshotForm({
        date: today(),
        totalPortfolioValue: "",
        cashBalance: "",
        investedValue: "",
        notes: "",
      });
      setSnapshotEdit(null);
      setMessage("Wealth snapshot saved.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Snapshot could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function submitFlow(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await mutate(
        flowEdit ? `/wealth/cash-flows/${flowEdit}` : "/wealth/cash-flows",
        flowEdit ? "PUT" : "POST",
        { ...flowForm, amount: Number(flowForm.amount) },
      );
      setFlowForm({ date: today(), type: "deposit", amount: "", notes: "" });
      setFlowEdit(null);
      setMessage("Cash flow saved.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Cash flow could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function editSnapshot(snapshot: WealthSnapshot) {
    setSnapshotEdit(snapshot.id);
    setSnapshotForm({
      date: snapshot.date,
      totalPortfolioValue: String(snapshot.totalPortfolioValue),
      cashBalance: String(snapshot.cashBalance),
      investedValue: String(snapshot.investedValue),
      notes: snapshot.notes,
    });
  }

  function editFlow(flow: CashFlow) {
    setFlowEdit(flow.id);
    setFlowForm({
      date: flow.date,
      type: flow.type,
      amount: String(flow.amount),
      notes: flow.notes,
    });
  }

  async function deleteItem(path: string, label: string) {
    if (!window.confirm(`Delete this ${label}? This cannot be undone.`)) return;
    await mutate(path, "DELETE");
  }

  return (
    <div className="wealth-stack">
      {isExample && (
        <div className="example-banner">
          <Badge tone="amber">FAKE SAMPLE DATA</Badge>
          Wealth values and cash flows are examples only.
        </div>
      )}

      <div className="wealth-card-grid">
        {analytics.cards.map(({ label, value, detail, tone, icon: Icon }) => (
          <article className={`wealth-card wealth-card--${tone}`} key={label}>
            <div>
              <span>{label}</span>
              <Icon size={17} />
            </div>
            <strong>{value}</strong>
            <p>{detail}</p>
          </article>
        ))}
      </div>

      <div className="wealth-chart-grid">
        <ChartCard title="Portfolio value over time" wide>
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 620, height: 250 }}
          >
            <AreaChart data={analytics.growth}>
              <defs>
                <linearGradient id="wealthFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#26d980" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#26d980" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="date" tick={chartTick} axisLine={false} tickLine={false} />
              <YAxis tick={chartTick} axisLine={false} tickLine={false} width={58} />
              <Tooltip contentStyle={tooltipStyle} formatter={moneyTooltip} />
              <Area
                dataKey="portfolio"
                stroke="#26d980"
                strokeWidth={2.5}
                fill="url(#wealthFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Net invested vs portfolio" wide>
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 620, height: 250 }}
          >
            <LineChart data={analytics.growth}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="date" tick={chartTick} axisLine={false} tickLine={false} />
              <YAxis tick={chartTick} axisLine={false} tickLine={false} width={58} />
              <Tooltip contentStyle={tooltipStyle} formatter={moneyTooltip} />
              <Legend />
              <Line
                dataKey="portfolio"
                name="Portfolio"
                stroke="#26d980"
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                dataKey="netInvested"
                name="Net invested"
                stroke="#63a9ff"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Realised P/L by month">
          <BarMoneyChart data={analytics.realisedByMonth} dataKey="value" />
        </ChartCard>
        <ChartCard title="Monthly deposits / withdrawals">
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 320, height: 250 }}
          >
            <BarChart data={analytics.flowByMonth}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="month" tick={chartTick} axisLine={false} tickLine={false} />
              <YAxis tick={chartTick} axisLine={false} tickLine={false} width={50} />
              <Tooltip contentStyle={tooltipStyle} formatter={moneyTooltip} />
              <Legend />
              <Bar dataKey="deposits" fill="#26d980" radius={[5, 5, 0, 0]} />
              <Bar dataKey="withdrawals" fill="#ff5f69" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Drawdown from peak">
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 320, height: 250 }}
          >
            <AreaChart data={analytics.drawdown}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="date" tick={chartTick} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={(value) => `${value}%`}
                tick={chartTick}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => [`${value}%`, "Drawdown"]}
              />
              <Area dataKey="value" stroke="#ff5f69" fill="rgba(255,95,105,.16)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Strategy contribution to P/L">
          <BarMoneyChart
            data={analytics.strategyContribution}
            dataKey="value"
            categoryKey="name"
          />
        </ChartCard>
        <ChartCard title="Open allocation by ticker">
          <AllocationDonut data={analytics.tickerAllocation} />
        </ChartCard>
        <ChartCard title="Open allocation by strategy">
          <AllocationDonut data={analytics.strategyAllocation} />
        </ChartCard>
      </div>

      <div className="wealth-input-grid">
        <form className="panel compact-form" onSubmit={submitSnapshot}>
          <div className="form-heading">
            <div>
              <span>Manual valuation</span>
              <h3>{snapshotEdit ? "Edit wealth snapshot" : "Add wealth snapshot"}</h3>
            </div>
            <Landmark size={20} />
          </div>
          <div className="form-grid form-grid--compact">
            <label className="field">
              <span>Date</span>
              <input
                type="date"
                required
                value={snapshotForm.date}
                onChange={(event) =>
                  setSnapshotForm({ ...snapshotForm, date: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Total portfolio value (£)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={snapshotForm.totalPortfolioValue}
                onChange={(event) =>
                  setSnapshotForm({
                    ...snapshotForm,
                    totalPortfolioValue: event.target.value,
                  })
                }
              />
            </label>
            <label className="field">
              <span>Cash balance (£)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={snapshotForm.cashBalance}
                onChange={(event) =>
                  setSnapshotForm({
                    ...snapshotForm,
                    cashBalance: event.target.value,
                  })
                }
              />
            </label>
            <label className="field">
              <span>Invested value (£)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={snapshotForm.investedValue}
                onChange={(event) =>
                  setSnapshotForm({
                    ...snapshotForm,
                    investedValue: event.target.value,
                  })
                }
              />
            </label>
            <label className="field field--full">
              <span>Notes</span>
              <input
                value={snapshotForm.notes}
                onChange={(event) =>
                  setSnapshotForm({ ...snapshotForm, notes: event.target.value })
                }
              />
            </label>
          </div>
          <div className="form-actions">
            {snapshotEdit && (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setSnapshotEdit(null)}
              >
                Cancel
              </button>
            )}
            <button className="button button--primary" disabled={busy}>
              <Save size={15} /> Save snapshot
            </button>
          </div>
        </form>

        <form className="panel compact-form" onSubmit={submitFlow}>
          <div className="form-heading">
            <div>
              <span>Capital movements</span>
              <h3>{flowEdit ? "Edit cash flow" : "Add deposit / withdrawal"}</h3>
            </div>
            <WalletCards size={20} />
          </div>
          <div className="form-grid form-grid--compact">
            <label className="field">
              <span>Date</span>
              <input
                type="date"
                required
                value={flowForm.date}
                onChange={(event) =>
                  setFlowForm({ ...flowForm, date: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Type</span>
              <select
                value={flowForm.type}
                onChange={(event) =>
                  setFlowForm({ ...flowForm, type: event.target.value })
                }
              >
                <option value="deposit">Deposit</option>
                <option value="withdrawal">Withdrawal</option>
              </select>
            </label>
            <label className="field">
              <span>Amount (£)</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={flowForm.amount}
                onChange={(event) =>
                  setFlowForm({ ...flowForm, amount: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Notes</span>
              <input
                value={flowForm.notes}
                onChange={(event) =>
                  setFlowForm({ ...flowForm, notes: event.target.value })
                }
              />
            </label>
          </div>
          <div className="form-actions">
            {flowEdit && (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setFlowEdit(null)}
              >
                Cancel
              </button>
            )}
            <button className="button button--primary" disabled={busy}>
              <Plus size={15} /> Save cash flow
            </button>
          </div>
        </form>
      </div>

      {message && <div className="form-message wealth-message">{message}</div>}

      <div className="wealth-history-grid">
        <HistoryTable
          title="Wealth snapshots"
          rows={snapshots.map((snapshot) => ({
            id: snapshot.id,
            date: snapshot.date,
            primary: formatMoney(snapshot.totalPortfolioValue),
            secondary: `${formatMoney(snapshot.cashBalance)} cash · ${formatMoney(snapshot.investedValue)} invested`,
            notes: snapshot.notes,
            edit: () => editSnapshot(snapshot),
            remove: () =>
              deleteItem(`/wealth/snapshots/${snapshot.id}`, "wealth snapshot"),
          }))}
        />
        <HistoryTable
          title="Deposits and withdrawals"
          rows={cashFlows.map((flow) => ({
            id: flow.id,
            date: flow.date,
            primary: `${flow.type === "deposit" ? "+" : "-"}${formatMoney(flow.amount)}`,
            secondary: flow.type,
            notes: flow.notes,
            edit: () => editFlow(flow),
            remove: () =>
              deleteItem(`/wealth/cash-flows/${flow.id}`, "cash flow"),
          }))}
        />
      </div>
    </div>
  );
}

const chartTick = { fill: "var(--text-muted)", fontSize: 10 };
const moneyTooltip = (value: unknown) => [formatMoney(Number(value)), "Value"];

function ChartCard({
  title,
  wide = false,
  children,
}: {
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article className={`chart-card wealth-chart ${wide ? "wealth-chart--wide" : ""}`}>
      <div className="chart-heading">
        <div>
          <span>Actual wealth</span>
          <h3>{title}</h3>
        </div>
      </div>
      <div className="chart-wrap">{children}</div>
    </article>
  );
}

function BarMoneyChart({
  data,
  dataKey,
  categoryKey = "month",
}: {
  data: Array<Record<string, string | number>>;
  dataKey: string;
  categoryKey?: string;
}) {
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      initialDimension={{ width: 320, height: 250 }}
    >
      <BarChart data={data}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey={categoryKey} tick={chartTick} axisLine={false} tickLine={false} />
        <YAxis tick={chartTick} axisLine={false} tickLine={false} width={50} />
        <Tooltip contentStyle={tooltipStyle} formatter={moneyTooltip} />
        <Bar dataKey={dataKey} radius={[5, 5, 0, 0]}>
          {data.map((item, index) => (
            <Cell
              key={`${String(item[categoryKey])}-${index}`}
              fill={Number(item[dataKey]) >= 0 ? "#26d980" : "#ff5f69"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function AllocationDonut({
  data,
}: {
  data: Array<{ name: string; value: number }>;
}) {
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      initialDimension={{ width: 320, height: 250 }}
    >
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={52}
          outerRadius={80}
          paddingAngle={3}
        >
          {data.map((item, index) => (
            <Cell key={item.name} fill={chartColors[index % chartColors.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} formatter={moneyTooltip} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

function HistoryTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    id: string;
    date: string;
    primary: string;
    secondary: string;
    notes: string;
    edit: () => void;
    remove: () => void;
  }>;
}) {
  return (
    <div className="panel history-panel">
      <div className="panel-title-row">
        <div>
          <span>Private ledger</span>
          <h3>{title}</h3>
        </div>
      </div>
      <div className="history-list">
        {[...rows]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((row) => (
            <article key={row.id}>
              <div>
                <strong>{row.primary}</strong>
                <span>
                  {formatDate(row.date)} · {row.secondary}
                </span>
                {row.notes && <p>{row.notes}</p>}
              </div>
              <div className="row-actions">
                <button onClick={row.edit} aria-label={`Edit item from ${row.date}`}>
                  <Pencil size={14} />
                </button>
                <button
                  className="danger-action"
                  onClick={row.remove}
                  aria-label={`Delete item from ${row.date}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
      </div>
    </div>
  );
}

function buildWealthAnalytics(
  snapshots: WealthSnapshot[],
  cashFlows: CashFlow[],
  trades: ManualTrade[],
) {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1);
  const previousMonth = sorted.length > 1 ? sorted.at(-2) : undefined;
  const firstOfYear = sorted.find(
    (snapshot) => snapshot.date.slice(0, 4) === latest?.date.slice(0, 4),
  );
  const netDeposits = cashFlows.reduce(
    (sum, flow) => sum + (flow.type === "deposit" ? flow.amount : -flow.amount),
    0,
  );
  const calculations = trades.map((trade) => ({
    trade,
    result: calculateTrade(trade),
  }));
  const totalGain = (latest?.totalPortfolioValue ?? 0) - netDeposits;
  const totalReturn = netDeposits ? (totalGain / netDeposits) * 100 : 0;
  const monthReturn =
    previousMonth?.totalPortfolioValue && latest
      ? ((latest.totalPortfolioValue - previousMonth.totalPortfolioValue) /
          previousMonth.totalPortfolioValue) *
        100
      : 0;
  const yearReturn =
    firstOfYear?.totalPortfolioValue && latest
      ? ((latest.totalPortfolioValue - firstOfYear.totalPortfolioValue) /
          firstOfYear.totalPortfolioValue) *
        100
      : 0;
  const allTimeHigh = Math.max(0, ...sorted.map((item) => item.totalPortfolioValue));
  const drawdownValue =
    allTimeHigh > 0 && latest
      ? ((latest.totalPortfolioValue - allTimeHigh) / allTimeHigh) * 100
      : 0;
  const closed = calculations.filter((item) => item.result.quantityRemaining <= 0);
  const winners = closed.filter((item) => item.result.totalPL > 0);
  const losers = closed.filter((item) => item.result.totalPL < 0);
  const average = (items: typeof closed) =>
    items.length
      ? items.reduce((sum, item) => sum + item.result.totalPL, 0) / items.length
      : 0;

  let runningCapital = 0;
  const growth = sorted.map((snapshot) => {
    runningCapital = cashFlows
      .filter((flow) => flow.date <= snapshot.date)
      .reduce(
        (sum, flow) => sum + (flow.type === "deposit" ? flow.amount : -flow.amount),
        0,
      );
    return {
      date: snapshot.date.slice(0, 7),
      portfolio: snapshot.totalPortfolioValue,
      netInvested: runningCapital,
    };
  });

  let peak = 0;
  const drawdown = sorted.map((snapshot) => {
    peak = Math.max(peak, snapshot.totalPortfolioValue);
    return {
      date: snapshot.date.slice(0, 7),
      value: Number(
        (((snapshot.totalPortfolioValue - peak) / Math.max(peak, 1)) * 100).toFixed(
          2,
        ),
      ),
    };
  });

  const realisedMap = new Map<string, number>();
  trades.forEach((trade) => {
    const unitCost =
      (trade.entryPrice * trade.quantity + trade.fees) / trade.quantity;
    trade.exits.forEach((exit) => {
      const month = exit.exitDate.slice(0, 7);
      const profit =
        exit.exitPrice * exit.quantitySold -
        exit.fees -
        unitCost * exit.quantitySold;
      realisedMap.set(month, (realisedMap.get(month) ?? 0) + profit);
    });
  });

  const flowMap = new Map<string, { deposits: number; withdrawals: number }>();
  cashFlows.forEach((flow) => {
    const month = flow.date.slice(0, 7);
    const current = flowMap.get(month) ?? { deposits: 0, withdrawals: 0 };
    current[flow.type === "deposit" ? "deposits" : "withdrawals"] += flow.amount;
    flowMap.set(month, current);
  });

  const strategyPL = new Map<string, number>();
  const tickerAllocation = new Map<string, number>();
  const strategyAllocation = new Map<string, number>();
  calculations.forEach(({ trade, result }) => {
    strategyPL.set(
      trade.strategyName,
      (strategyPL.get(trade.strategyName) ?? 0) + result.totalPL,
    );
    if (result.quantityRemaining > 0) {
      tickerAllocation.set(
        trade.ticker,
        (tickerAllocation.get(trade.ticker) ?? 0) + result.openPositionValue,
      );
      strategyAllocation.set(
        trade.strategyName,
        (strategyAllocation.get(trade.strategyName) ?? 0) +
          result.openPositionValue,
      );
    }
  });

  return {
    cards: [
      {
        label: "Current total wealth",
        value: formatMoney(latest?.totalPortfolioValue ?? 0),
        detail: latest ? `Snapshot ${formatDate(latest.date)}` : "No snapshot yet",
        tone: "green",
        icon: Landmark,
      },
      {
        label: "Net deposits",
        value: formatMoney(netDeposits),
        detail: "Deposits less withdrawals",
        tone: "blue",
        icon: WalletCards,
      },
      {
        label: "Total gain / loss",
        value: formatMoney(totalGain),
        detail: `${formatNumber(totalReturn)}% simple return`,
        tone: totalGain >= 0 ? "green" : "red",
        icon: BadgePoundSterling,
      },
      {
        label: "Month-to-date",
        value: `${monthReturn >= 0 ? "+" : ""}${formatNumber(monthReturn)}%`,
        detail: "Latest snapshot comparison",
        tone: monthReturn >= 0 ? "green" : "red",
        icon: CalendarRange,
      },
      {
        label: "Year-to-date",
        value: `${yearReturn >= 0 ? "+" : ""}${formatNumber(yearReturn)}%`,
        detail: "Simple snapshot estimate",
        tone: yearReturn >= 0 ? "green" : "red",
        icon: Percent,
      },
      {
        label: "All-time high",
        value: formatMoney(allTimeHigh),
        detail: "Highest recorded snapshot",
        tone: "purple",
        icon: Trophy,
      },
      {
        label: "Current drawdown",
        value: `${formatNumber(drawdownValue)}%`,
        detail: "From recorded peak",
        tone: drawdownValue < 0 ? "red" : "green",
        icon: ArrowDown,
      },
      {
        label: "Open / closed trades",
        value: `${calculations.filter((item) => item.result.quantityRemaining > 0).length} / ${closed.length}`,
        detail: "Actual manual ledger",
        tone: "blue",
        icon: Plus,
      },
      {
        label: "Actual win rate",
        value: `${closed.length ? formatNumber((winners.length / closed.length) * 100, 1) : "0.0"}%`,
        detail: `${winners.length} winners · ${losers.length} losers`,
        tone: "green",
        icon: Trophy,
      },
      {
        label: "Average winner",
        value: formatMoney(average(winners)),
        detail: "Closed actual trades",
        tone: "green",
        icon: ArrowUp,
      },
      {
        label: "Average loser",
        value: formatMoney(average(losers)),
        detail: "Closed actual trades",
        tone: "red",
        icon: ArrowDown,
      },
      {
        label: "Return method",
        value: "Simple",
        detail: "Ready for later TWR migration",
        tone: "neutral",
        icon: Percent,
      },
    ],
    growth,
    drawdown,
    realisedByMonth: [...realisedMap.entries()].map(([month, value]) => ({
      month,
      value: Number(value.toFixed(2)),
    })),
    flowByMonth: [...flowMap.entries()].map(([month, values]) => ({
      month,
      ...values,
    })),
    strategyContribution: [...strategyPL.entries()].map(([name, value]) => ({
      name,
      value: Number(value.toFixed(2)),
    })),
    tickerAllocation: [...tickerAllocation.entries()].map(([name, value]) => ({
      name,
      value: Number(value.toFixed(2)),
    })),
    strategyAllocation: [...strategyAllocation.entries()].map(
      ([name, value]) => ({
        name,
        value: Number(value.toFixed(2)),
      }),
    ),
  };
}
