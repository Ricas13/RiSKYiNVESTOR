import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BrainCircuit,
  CalendarDays,
  Gauge,
  ShieldCheck,
} from "lucide-react";
import type { SiteConfig } from "../types";
import { Badge } from "./ui";

export function StrategyRules({ config }: { config: SiteConfig }) {
  const rules = [
    {
      icon: ArrowUpFromLine,
      label: "Entry rule",
      title: "Underlying flips red → green",
      copy: config.strategy.entryRule,
      tone: "green",
    },
    {
      icon: ArrowDownToLine,
      label: "Exit rule",
      title: "Leveraged 3× ticker flips green → red",
      copy: config.strategy.exitRule,
      tone: "red",
    },
    {
      icon: CalendarDays,
      label: "Signal cadence",
      title: `${config.strategy.timeframe} candles`,
      copy: "Signals are assessed once each completed trading day, not intraday.",
      tone: "blue",
    },
    {
      icon: Gauge,
      label: "Indicator",
      title: `ATR length ${config.strategy.atrLength}`,
      copy: config.strategy.directionConvention,
      tone: "purple",
    },
  ];

  return (
    <div className="strategy-layout">
      <div className="rule-grid">
        {rules.map(({ icon: Icon, label, title, copy, tone }) => (
          <article className={`rule-card rule-card--${tone}`} key={label}>
            <div className="rule-icon">
              <Icon size={20} />
            </div>
            <span>{label}</span>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>

      <div className="logic-panel">
        <div className="logic-panel__header">
          <div>
            <span>Risk-tier logic</span>
            <h3>Allocation follows instrument quality</h3>
          </div>
          <ShieldCheck size={22} />
        </div>
        <div className="tier-logic">
          {Object.entries(config.riskTiers).map(([tier, details]) => (
            <div key={tier}>
              <Badge
                tone={
                  tier === "CORE"
                    ? "green"
                    : tier === "AGGRESSIVE"
                      ? "amber"
                      : tier === "SPECULATIVE"
                        ? "purple"
                        : "neutral"
                }
              >
                {tier}
              </Badge>
              <strong>{details.allocation}</strong>
              <p>{details.status}</p>
            </div>
          ))}
        </div>
        <div className="not-ai-note">
          <BrainCircuit size={19} />
          <div>
            <strong>Rules, not AI predictions</strong>
            <p>
              This is a deterministic signal system. Regime 200 is ignored for live
              trading; only CORE and AGGRESSIVE instruments are active.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
