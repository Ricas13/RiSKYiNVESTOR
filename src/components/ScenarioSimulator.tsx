import { Calculator, CircleAlert, Flag, LineChart, PiggyBank } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Line,
  LineChart as RechartsLineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney, formatNumber } from "../utils/format";

const scenarios = [
  { name: "Conservative", cagr: 10, color: "#63a9ff" },
  { name: "Strong", cagr: 15, color: "#26d980" },
  { name: "Aggressive", cagr: 20, color: "#f8b84e" },
  { name: "Very aggressive", cagr: 25, color: "#ae8cff" },
];

export function ScenarioSimulator({ defaultValue = 10000 }: { defaultValue?: number }) {
  const [inputs, setInputs] = useState({
    startingValue: String(defaultValue),
    monthlyContribution: "500",
    expectedCagr: "15",
    years: "10",
    startingDrawdown: "0",
    annualFee: "0.5",
    targetWealth: "100000",
  });

  const result = useMemo(() => {
    const starting = Number(inputs.startingValue) * (1 + Number(inputs.startingDrawdown) / 100);
    const monthly = Number(inputs.monthlyContribution);
    const years = Math.max(1, Number(inputs.years));
    const fee = Number(inputs.annualFee);
    const expected = Number(inputs.expectedCagr) - fee;
    const target = Number(inputs.targetWealth);
    const projection = Array.from({ length: years + 1 }, (_, year) => {
      const row: Record<string, number | string> = { year: `Year ${year}` };
      scenarios.forEach((scenario) => {
        row[scenario.name] = futureValue(starting, monthly, scenario.cagr - fee, year);
      });
      row.Custom = futureValue(starting, monthly, expected, year);
      return row;
    });
    const targetYears = timeToTarget(starting, monthly, expected, target);
    const requiredCagr = solveCagr(starting, monthly, years, target);
    const requiredMonthly = solveMonthly(starting, expected, years, target);
    return {
      projection,
      projected: futureValue(starting, monthly, expected, years),
      targetYears,
      requiredCagr,
      requiredMonthly,
    };
  }, [inputs]);

  function field(key: keyof typeof inputs, label: string, min = 0, step = "0.1") {
    return (
      <label className="field">
        <span>{label}</span>
        <input type="number" min={min} step={step} value={inputs[key]} onChange={(event) => setInputs({ ...inputs, [key]: event.target.value })} />
      </label>
    );
  }

  return (
    <div className="scenario-layout">
      <div className="scenario-controls panel">
        <div className="form-heading"><div><span>Projection inputs</span><h3>Model a future path</h3></div><Calculator size={20} /></div>
        <div className="form-grid form-grid--compact">
          {field("startingValue", "Starting portfolio (£)", 0, "100")}
          {field("monthlyContribution", "Monthly contribution (£)", 0, "25")}
          {field("expectedCagr", "Expected CAGR (%)", -99, "0.5")}
          {field("years", "Years", 1, "1")}
          {field("startingDrawdown", "Optional starting drawdown (%)", -99, "1")}
          {field("annualFee", "Annual fee / slippage (%)", 0, "0.1")}
          {field("targetWealth", "Target wealth (£)", 0, "1000")}
        </div>
        <div className="scenario-presets">
          {scenarios.map((scenario) => (
            <button key={scenario.name} onClick={() => setInputs({ ...inputs, expectedCagr: String(scenario.cagr) })}>
              <i style={{ background: scenario.color }} /> {scenario.name} · {scenario.cagr}%
            </button>
          ))}
        </div>
      </div>

      <div className="scenario-results">
        <article><LineChart size={18} /><span>Projected value</span><strong>{formatMoney(result.projected)}</strong></article>
        <article><Flag size={18} /><span>Time to target</span><strong>{result.targetYears === null ? "Not reached" : `${formatNumber(result.targetYears, 1)} years`}</strong></article>
        <article><Calculator size={18} /><span>Required CAGR</span><strong>{result.requiredCagr === null ? "Not feasible" : `${formatNumber(result.requiredCagr)}%`}</strong></article>
        <article><PiggyBank size={18} /><span>Required monthly contribution</span><strong>{formatMoney(result.requiredMonthly)}</strong></article>
      </div>

      <article className="chart-card scenario-chart">
        <div className="chart-heading"><div><span>Bear / base / bull assumptions</span><h3>Projected value by year</h3></div></div>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 900, height: 320 }}>
            <RechartsLineChart data={result.projection}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(value) => `£${Math.round(value / 1000)}k`} tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} width={56} />
              <Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--border-strong)", borderRadius: "10px" }} formatter={(value) => [formatMoney(Number(value)), "Projected"]} />
              {scenarios.map((scenario) => <Line key={scenario.name} type="monotone" dataKey={scenario.name} stroke={scenario.color} dot={false} strokeWidth={2} />)}
              <Line type="monotone" dataKey="Custom" stroke="#f3f8f5" dot={false} strokeDasharray="6 4" strokeWidth={2} />
            </RechartsLineChart>
          </ResponsiveContainer>
        </div>
      </article>
      <div className="projection-warning"><CircleAlert size={16} /> Projections are mathematical assumptions, not guarantees. Real returns are uneven and losses can be severe.</div>
    </div>
  );
}

function futureValue(start: number, monthly: number, annualPercent: number, years: number) {
  const monthlyRate = Math.pow(1 + annualPercent / 100, 1 / 12) - 1;
  const months = years * 12;
  const principal = start * Math.pow(1 + monthlyRate, months);
  const contributions =
    Math.abs(monthlyRate) < 1e-9
      ? monthly * months
      : monthly * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
  return principal + contributions;
}

function timeToTarget(start: number, monthly: number, annualPercent: number, target: number) {
  if (start >= target) return 0;
  for (let month = 1; month <= 100 * 12; month += 1) {
    if (futureValue(start, monthly, annualPercent, month / 12) >= target) return month / 12;
  }
  return null;
}

function solveCagr(start: number, monthly: number, years: number, target: number) {
  if (futureValue(start, monthly, -99, years) >= target) return -99;
  if (futureValue(start, monthly, 100, years) < target) return null;
  let low = -99;
  let high = 100;
  for (let index = 0; index < 80; index += 1) {
    const mid = (low + high) / 2;
    if (futureValue(start, monthly, mid, years) >= target) high = mid;
    else low = mid;
  }
  return high;
}

function solveMonthly(start: number, annualPercent: number, years: number, target: number) {
  if (futureValue(start, 0, annualPercent, years) >= target) return 0;
  let low = 0;
  let high = Math.max(100, target / Math.max(1, years * 12));
  while (futureValue(start, high, annualPercent, years) < target) high *= 2;
  for (let index = 0; index < 80; index += 1) {
    const mid = (low + high) / 2;
    if (futureValue(start, mid, annualPercent, years) >= target) high = mid;
    else low = mid;
  }
  return high;
}
