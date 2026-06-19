import { DatabaseBackup, Download, FileInput, FileJson, Upload } from "lucide-react";
import { useRef, useState } from "react";

export function DataPortability({
  download,
  mutate,
}: {
  download: (path: string, filename: string) => Promise<void>;
  mutate: (
    path: string,
    method: "POST" | "PUT" | "DELETE",
    body?: unknown,
  ) => Promise<unknown>;
}) {
  const tradeImport = useRef<HTMLInputElement>(null);
  const signalImport = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) throw new Error("Choose a file first.");
    return file.text();
  }

  return (
    <div className="portability-layout">
      <div className="portability-grid">
        <PortabilityCard icon={FileJson} title="Export all data" copy="Portable JSON containing every owner record and strategy decision." action="Download JSON" disabled={busy} onClick={() => run(() => download("/export/all", "risky-investor-export.json"), "JSON export downloaded.")} />
        <PortabilityCard icon={Download} title="Export trades" copy="Manual trade ledger as a spreadsheet-friendly CSV file." action="Download CSV" disabled={busy} onClick={() => run(() => download("/export/trades.csv", "risky-investor-trades.csv"), "Trade CSV downloaded.")} />
        <PortabilityCard icon={Download} title="Export wealth" copy="All portfolio snapshots as CSV, including cash and invested values." action="Download CSV" disabled={busy} onClick={() => run(() => download("/export/wealth.csv", "risky-investor-wealth.csv"), "Wealth CSV downloaded.")} />
        <PortabilityCard icon={DatabaseBackup} title="Backup database" copy="One complete versioned backup for encrypted offline storage." action="Download backup" disabled={busy} onClick={() => run(() => download("/backup", "risky-investor-backup.json"), "Backup downloaded.")} />
        <PortabilityCard icon={FileInput} title="Import manual trades" copy="Import rows from a Risky Investor trade CSV. Existing records remain." action="Choose CSV" disabled={busy} onClick={() => tradeImport.current?.click()} />
        <PortabilityCard icon={Upload} title="Import scanner events" copy="Normalise scanner output into the canonical private signal-event repository." action="Choose JSON" disabled={busy} onClick={() => signalImport.current?.click()} />
      </div>
      <div className="restore-panel panel">
        <div><DatabaseBackup size={20} /><div><span>Disaster recovery</span><strong>Restore a full Risky Investor backup</strong><p>This replaces all portable owner records after an explicit confirmation.</p></div></div>
        <button className="button button--secondary" disabled={busy} onClick={() => restoreInput.current?.click()}>Choose backup</button>
      </div>
      {message && <div className="form-message portability-message">{message}</div>}

      <input ref={tradeImport} className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => run(async () => mutate("/import/manual-trades-csv", "POST", { csv: await readFile(event.target.files?.[0]) }), "Manual trades imported.")} />
      <input ref={signalImport} className="sr-only" type="file" accept=".json,application/json" onChange={(event) => run(async () => mutate("/import/signals-json", "POST", { signals: JSON.parse(await readFile(event.target.files?.[0])) }), "Scanner events normalised and imported.")} />
      <input ref={restoreInput} className="sr-only" type="file" accept=".json,application/json" onChange={(event) => run(async () => {
        const backup = JSON.parse(await readFile(event.target.files?.[0]));
        if (!window.confirm("Restore this backup and replace current private records? This cannot be undone without another backup.")) return;
        await mutate("/restore", "POST", backup);
      }, "Backup restored.")} />
    </div>
  );
}

function PortabilityCard({
  icon: Icon,
  title,
  copy,
  action,
  disabled,
  onClick,
}: {
  icon: typeof Download;
  title: string;
  copy: string;
  action: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <article className="portability-card">
      <Icon size={20} />
      <h3>{title}</h3>
      <p>{copy}</p>
      <button className="button button--secondary" disabled={disabled} onClick={onClick}>{action}</button>
    </article>
  );
}
