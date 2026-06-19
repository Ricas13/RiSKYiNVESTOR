import {
  BadgeAlert,
  BotOff,
  ChartNoAxesCombined,
  DatabaseZap,
  Hand,
  PoundSterling,
} from "lucide-react";

const risks = [
  {
    icon: BadgeAlert,
    title: "Not financial advice",
    copy: "This dashboard is provided for signals, research and education only.",
  },
  {
    icon: PoundSterling,
    title: "Leveraged ETPs are high risk",
    copy: "3× products can lose value quickly and may not track long-term returns as expected.",
  },
  {
    icon: Hand,
    title: "Signals are not recommendations",
    copy: "Every alert is a model output. You remain responsible for deciding whether to act.",
  },
  {
    icon: ChartNoAxesCombined,
    title: "Backtests are not forecasts",
    copy: "Historical performance does not guarantee future returns or drawdowns.",
  },
  {
    icon: DatabaseZap,
    title: "Data sources can differ",
    copy: "Yahoo Finance, TradingView and brokers can report different prices and candles.",
  },
  {
    icon: Hand,
    title: "Make your own decisions",
    copy: "Check spreads, liquidity, market events, suitability and instrument availability before acting.",
  },
  {
    icon: BotOff,
    title: "No trade execution",
    copy: "The system is alert-only. It does not connect to a broker or place orders.",
  },
];

export function RiskDisclaimer() {
  return (
    <div className="risk-panel">
      <div className="risk-banner">
        <BadgeAlert size={24} />
        <div>
          <span>Read before using any signal</span>
          <h3>Leveraged products can move sharply and compound losses.</h3>
        </div>
      </div>
      <div className="risk-grid">
        {risks.map(({ icon: Icon, title, copy }) => (
          <article key={title}>
            <Icon size={19} />
            <div>
              <h4>{title}</h4>
              <p>{copy}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
