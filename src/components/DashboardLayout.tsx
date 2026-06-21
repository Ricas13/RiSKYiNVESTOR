import {
  Activity,
  BarChart3,
  BookOpen,
  CandlestickChart,
  ChevronRight,
  FileWarning,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquareWarning,
  Palette,
  Settings2,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { applyAppearance, type DashboardAppearance } from "../appearance";
import type { DataStatusReport } from "../types";
import type { ControlPage } from "./TradingControlPages";

const navigation: Array<{
  page: ControlPage;
  label: string;
  href?: string;
  icon: typeof Activity;
}> = [
  { page: "dashboard", label: "Dashboard", icon: Activity },
  {
    page: "signals",
    label: "Signal Monitor",
    href: "signal-monitor",
    icon: CandlestickChart,
  },
  {
    page: "performance",
    label: "Strategy Performance",
    href: "strategy-performance",
    icon: BarChart3,
  },
  { page: "trade-journal", label: "Trade Journal", icon: BookOpen },
  { page: "alerts", label: "Alerts", icon: MessageSquareWarning },
  { page: "settings", label: "Settings", icon: Settings2 },
];

export function DashboardLayout({
  children,
  scannerStatus,
  username,
  activePage,
  onLogout,
  dataStatus,
  appearance,
}: {
  children: ReactNode;
  scannerStatus?: string;
  username: string;
  activePage: ControlPage;
  onLogout: () => Promise<void>;
  dataStatus?: DataStatusReport;
  appearance: DashboardAppearance;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    applyAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  const pageLabel =
    navigation.find((item) => item.page === activePage)?.label ?? "Dashboard";

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar--open" : ""}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            RI
          </div>
          <div>
            <strong>Risky Investor</strong>
            <span>Signal control room</span>
          </div>
          <button
            className="icon-button sidebar-close"
            onClick={() => setMenuOpen(false)}
            aria-label="Close navigation"
          >
            <X size={19} />
          </button>
        </div>

        <nav aria-label="Trading control">
          <p className="nav-label">Control room</p>
          {navigation.map(({ page, label, href, icon: Icon }) => (
            <a
              href={`#/${href ?? page}`}
              key={page}
              onClick={() => setMenuOpen(false)}
              aria-current={activePage === page ? "page" : undefined}
              className={
                activePage === page ? "nav-link nav-link--active" : "nav-link"
              }
            >
              <Icon size={18} />
              <span>{label}</span>
              <ChevronRight className="nav-chevron" size={15} />
            </a>
          ))}
        </nav>

        <div className="sidebar-note">
          <FileWarning size={19} />
          <div>
            <strong>Signal reversals first</strong>
            <p>Review flips, model positions and manual actions in one place.</p>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="signed-in-user">
            <UserRound size={16} />
            <div>
              <span>Signed in as</span>
              <strong>{username}</strong>
            </div>
            <button onClick={onLogout} aria-label="Log out">
              <LogOut size={16} />
            </button>
          </div>
          <span className="live-indicator">
            <i aria-hidden="true" /> Private data connected
          </span>
          <small>riskyinvestor.co.uk</small>
        </div>
      </aside>

      {menuOpen && (
        <button
          className="sidebar-scrim"
          onClick={() => setMenuOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <div className="content-frame">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open navigation"
            aria-expanded={menuOpen}
          >
            <Menu size={20} />
          </button>
          <div className="topbar-context">
            <span className="topbar-page-eyebrow">Signal control room</span>
            <strong className="topbar-kicker">{pageLabel}</strong>
            <span className="topbar-scan">
              {scannerStatus ?? "Loading scanner state…"}
            </span>
          </div>
          <div className="topbar-actions">
            <span className="environment-pill private-pill">
              <LockKeyhole size={13} />
              Private session
            </span>
            <a
              className="appearance-pill"
              href="#/settings"
              aria-label={`Appearance: ${appearance.theme}, ${appearance.density}`}
            >
              <Palette size={16} />
              <span>
                {appearance.theme} / {appearance.density}
              </span>
            </a>
          </div>
        </header>
        {dataStatus?.hasDemoData && (
          <div className="demo-data-warning" role="alert">
            <FileWarning size={20} />
            <div>
              <strong>Demo data present — not live signal or trade data</strong>
              <p>
                Displayed historical trades, P/L, model values and signal
                examples may be fake. Scanner status is shown separately above.
              </p>
            </div>
            <a href="#/settings">Review and clean up</a>
          </div>
        )}
        <main>{children}</main>
        <footer className="site-footer">
          <p>Risky Investor · Signal control room</p>
          <p>Strategy signals and journal only. No broker execution.</p>
        </footer>
      </div>
    </div>
  );
}
