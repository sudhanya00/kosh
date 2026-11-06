import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastHost } from "./components/ui";
import { DataProvider } from "./data";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DataProvider>
      <ToastHost>
        <App />
      </ToastHost>
    </DataProvider>
  </StrictMode>,
);

// Lets Kosh receive shares (UPI screenshots, SMS) once installed; see public/sw.js.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("sw", e));
