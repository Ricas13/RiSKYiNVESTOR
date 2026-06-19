import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Performance } from "../types";

const tooltipStyle = {
  background: "var(--surface-raised)",
  border: "1px solid var(--border-strong)",
  borderRadius: "12px",
  boxShadow: "var(--shadow-lg)",
  color: "var(--text-primary)",
  fontSize: "12px",
};

export function PerformanceCharts({ performance }: { performance: Performance }) {
  return (
    <div className="chart-grid">
      <article className="chart-card chart-card--wide">
        <div className="chart-heading">
          <div>
            <span>Equity progression</span>
            <h3>Realised P/L over time</h3>
          </div>
          <strong>+{performance.realisedModelPL.toFixed(1)}%</strong>
        </div>
        <div className="chart-wrap">
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            minHeight={0}
            initialDimension={{ width: 480, height: 230 }}
          >
            <AreaChart data={performance.realisedSeries}>
              <defs>
                <linearGradient id="plGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#26d980" stopOpacity={0.34} />
                  <stop offset="95%" stopColor="#26d980" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(value) => `${value}%`}
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}%`, "P/L"]} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#26d980"
                strokeWidth={2.5}
                fill="url(#plGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="chart-card">
        <div className="chart-heading">
          <div>
            <span>By calendar year</span>
            <h3>Yearly realised P/L</h3>
          </div>
        </div>
        <div className="chart-wrap">
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            minHeight={0}
            initialDimension={{ width: 300, height: 230 }}
          >
            <BarChart data={performance.yearlyPL}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="year"
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(value) => `${value}%`}
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}%`, "P/L"]} />
              <Bar dataKey="value" fill="#26d980" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="chart-card">
        <div className="chart-heading">
          <div>
            <span>Trade outcomes</span>
            <h3>Win / loss distribution</h3>
          </div>
        </div>
        <div className="donut-layout">
          <div className="chart-wrap chart-wrap--donut">
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={0}
              initialDimension={{ width: 220, height: 230 }}
            >
              <PieChart>
                <Pie
                  data={performance.winLoss}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={54}
                  outerRadius={76}
                  paddingAngle={4}
                >
                  <Cell fill="#26d980" />
                  <Cell fill="#ff5f69" />
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-centre">
              <strong>{performance.winRate}%</strong>
              <span>win rate</span>
            </div>
          </div>
          <div className="chart-legend">
            {performance.winLoss.map((item, index) => (
              <div key={item.name}>
                <span>
                  <i className={index === 0 ? "legend-dot legend-dot--green" : "legend-dot legend-dot--red"} />
                  {item.name}
                </span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </article>

      <article className="chart-card chart-card--wide">
        <div className="chart-heading">
          <div>
            <span>Current exposure</span>
            <h3>Open trade model P/L</h3>
          </div>
        </div>
        <div className="chart-wrap">
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            minHeight={0}
            initialDimension={{ width: 480, height: 230 }}
          >
            <BarChart data={performance.openTradePL} layout="vertical">
              <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(value) => `${value}%`}
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                dataKey="ticker"
                type="category"
                tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={62}
              />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}%`, "P/L"]} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {performance.openTradePL.map((item) => (
                  <Cell key={item.ticker} fill={item.value >= 0 ? "#26d980" : "#ff5f69"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>
    </div>
  );
}
