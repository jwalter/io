import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { initSupabase } from "./lib/supabase";
import "./style.css";

async function bootstrap() {
  await initSupabase();

  const root = document.getElementById("root")!;
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>
  );
}

bootstrap();
