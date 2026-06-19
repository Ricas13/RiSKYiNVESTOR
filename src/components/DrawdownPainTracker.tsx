import { ArrowDown, CalendarDays, HeartPulse, RotateCcw, Trophy } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WealthSnapshot } from "../types";
import { formatDate, formatMoney, formatNumber } from "../utils/format";

export function DrawdownPainTracker({
  snapshots,
}: {
  snapshots: WealthSnapshot[];
}) {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1);
  let peak = 0;
  let peakDate = latest?.date ?? "";
  let worstPercent = 0;
  let worstPounds = 0;
  const chart = sorted.map((snapshot) => {
    if (snapshot.totalPortfolioValue >= peak) {
      peak = snapshot.totalPortfolioValue;
      peakDate = snapshot.date;
    }
    const pounds = snapshot.totalPortfolioValue - peak;
    const percent = peak > 0 ? (pounds / peak) * 100 : 0;
    worstPercent = Math.min(worstPercent, percent);
    worstPounds = Math.min(worstPounds, pounds);
    return {
      date: snapshot.date,
      drawdown: Number(percent.toFixed(2)),
      pounds: Number(pounds.toFixed(2)),
    };
  });
  const currentPeak = Math.max(0, ...sorted.map((item) => item.totalPortfolioValue));
  const currentValue = latest?.totalPortfolioValue ?? 0;
  const currentPounds = currentValue - currentPeak;
  const currentPercent =
    currentPeak > 0 ? (currentPounds / currentPeak) * 100 : 0;
  const requiredGain =
    currentValue > 0 ? ((currentPeak - currentValue) / currentValue) * 100 : 0;
  const daysSinceHigh =
    peakDate && latest
      ? Math.max(
          0,
          Math.round(
            (new Date(latest.date).getTime() - new Date(peakDate).getTime()) /
              86_400_000,
          ),
        )
      : 0;

  const cards = [
    { icon: Trophy, label: "Portfolio peak", value: formatMoney(currentPeak) },
    { icon: HeartPulse, label: "Current value", value: formatMoney(currentValue) },
    { icon: ArrowDown, label: "Current drawdown", value: `${formatNumber(currentPercent)}% · ${formatMoney(currentPounds)}` },
    { icon: ArrowDown, label: "Worst drawdown", value: `${formatNumber(worstPercent)}% · ${formatMoney(worstPounds)}` },
    { icon: CalendarDays, label: "Days since all-time high", value: String(daysSinceHigh) },
    { icon: RotateCcw, label: "Gain required to recover", value: `+${formatNumber(requiredGain)}%` },
  ];

  return (
    <div className="drawdown-layout">
      <div className="drawdown-stat-grid">
        {cards.map(({ icon: Icon, label, value }) => (
          <article key={label}><Icon size={17} /><span>{label}</span><strong>{value}</strong></article>
        ))}
      </div>
      <article className="chart-card drawdown-chart">
        <div className="chart-heading">
          <div><span>Actual wealth</span><h3>Drawdown pain over time</h3></div>
          <small>{latest ? `Latest ${formatDate(latest.date)}` : "No snapshots"}</small>
        </div>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 700, height: 280 }}>
            <AreaChart data={chart}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(value) => `${value}%`} tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--border-strong)", borderRadius: "10px" }} formatter={(value) => [`${value}%`, "Drawdown"]} />
              <Area dataKey="drawdown" stroke="#ff5f69" fill="rgba(255,95,105,.18)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </article>
    </div>
  );
}
