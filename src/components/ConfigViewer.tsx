import { Check, Clipboard, Eye, EyeOff, FileJson2, LockKeyhole } from "lucide-react";
import { useState } from "react";
import type { SiteConfig } from "../types";
import { Badge } from "./ui";

export function ConfigViewer({ config }: { config: SiteConfig }) {
  const [copied, setCopied] = useState(false);
  const configText = JSON.stringify(config, null, 2);

  async function copyConfig() {
    await navigator.clipboard.writeText(configText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="config-layout">
      <div className="config-summary">
        <article>
          <div className="config-icon">
            {config.site.mode === "public" ? <Eye size={19} /> : <EyeOff size={19} />}
          </div>
          <span>Site mode</span>
          <strong>{config.site.mode}</strong>
          <p>All dashboard routes and data APIs require an authenticated session.</p>
        </article>
        <article>
          <div className="config-icon">
            <FileJson2 size={19} />
          </div>
          <span>Data contract</span>
          <strong>Private JSON layer</strong>
          <p>Model exports and personal records remain outside the public build.</p>
        </article>
        <article>
          <div className="config-icon">
            <LockKeyhole size={19} />
          </div>
          <span>Secret handling</span>
          <strong>Frontend-safe</strong>
          <p>Channel labels only. No webhook URLs or credentials.</p>
        </article>
      </div>

      <div className="code-panel">
        <div className="code-panel__header">
          <div>
            <span className="window-dot window-dot--red" />
            <span className="window-dot window-dot--amber" />
            <span className="window-dot window-dot--green" />
            <strong>data/private/model/site_config.json</strong>
          </div>
          <button onClick={copyConfig} className="copy-button">
            {copied ? <Check size={15} /> : <Clipboard size={15} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre>
          <code>{configText}</code>
        </pre>
        <div className="code-panel__footer">
          <Badge tone="green">VALID JSON</Badge>
          <span>Safe to overwrite during deployment</span>
        </div>
      </div>
    </div>
  );
}
