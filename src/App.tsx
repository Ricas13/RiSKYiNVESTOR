import { CircleAlert, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { AppearanceSettings } from "./components/AppearanceSettings";
import { DashboardLayout } from "./components/DashboardLayout";
import { LoginPage } from "./components/LoginPage";
import {
  TradingControlPage,
  type ControlPage,
} from "./components/TradingControlPages";
import { useDashboardData } from "./hooks/useDashboardData";
import { normaliseAppearance } from "./appearance";
import { formatDateTime } from "./utils/format";

const pages = new Set<ControlPage>([
  "dashboard",
  "signals",
  "portfolio",
  "performance",
  "trade-journal",
  "strategies",
  "alerts",
  "settings",
]);

function pageFromHash(): ControlPage {
  const candidate = window.location.hash.replace(/^#\/?/, "") as ControlPage;
  return pages.has(candidate) ? candidate : "dashboard";
}

function LoadingState({ privateCheck = false }: { privateCheck?: boolean }) {
  return (
    <div className="state-screen">
      <div className="loader-orbit">
        <RefreshCw size={26} />
      </div>
      <h1>{privateCheck ? "Checking private session" : "Loading private data"}</h1>
      <p>
        {privateCheck
          ? "Confirming access before any trading-control data is requested."
          : "Reading protected signals, positions and settings."}
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="state-screen state-screen--error">
      <CircleAlert size={32} />
      <h1>Private trading-control data is unavailable</h1>
      <p>{message}</p>
    </div>
  );
}

function App() {
  const {
    data,
    session,
    authChecked,
    error,
    login,
    logout,
    mutate,
    download,
    request,
  } = useDashboardData();
  const [page, setPage] = useState<ControlPage>(pageFromHash);

  useEffect(() => {
    const syncPage = () => setPage(pageFromHash());
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (!session && window.location.pathname !== "/login") {
      window.history.replaceState({}, "", "/login");
    }
    if (session && window.location.pathname === "/login") {
      window.history.replaceState({}, "", "/");
    }
  }, [authChecked, session]);

  if (!authChecked) return <LoadingState privateCheck />;
  if (!session) return <LoginPage onLogin={login} />;

  const scannerStatus = (() => {
    if (!data) return undefined;
    const scanner = data.scannerImport;
    if (scanner.status === "awaiting") return "Awaiting canonical scanner data";
    if (scanner.status === "error") return "Scanner import error";
    const timestamp =
      scanner.lastSuccessfulScanAt ?? scanner.lastGeneratedAt;
    const label = timestamp ? formatDateTime(timestamp) : "unknown time";
    return scanner.status === "stale"
      ? `Scanner data stale · last success ${label}`
      : `Scanner current · completed ${label}`;
  })();

  const layoutProps = {
    username: session.username,
    activePage: page,
    onLogout: async () => {
      await logout();
      window.history.replaceState({}, "", "/login");
    },
    scannerStatus,
    dataStatus: data?.dataStatus,
    appearance: normaliseAppearance(data?.settings),
  };

  if (error) {
    return (
      <DashboardLayout {...layoutProps}>
        <ErrorState message={error} />
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout {...layoutProps}>
        <LoadingState />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout {...layoutProps}>
      <div className="control-page">
        {page === "settings" && (
          <AppearanceSettings settings={data.settings} mutate={mutate} />
        )}
        <TradingControlPage
          page={page}
          data={data}
          session={session}
          mutate={mutate}
          download={download}
          request={request}
        />
      </div>
    </DashboardLayout>
  );
}

export default App;
