import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./appearance.css";
import "./dashboardCommandCentre.css";
import "./strategyMonitor.css";
import "./strategyConfiguration.css";
import "./strategyPolicies.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
