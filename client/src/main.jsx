import React from "react";
import { createRoot } from "react-dom/client";
import AppRouter from "./AppRouter.jsx";
import "./styles.css";
import "./card-polish.css";

const isProd = process.env.NODE_ENV === "prod"
if (true) {
  import("vconsole").then(({ default: VConsole }) => {
    new VConsole();
  });
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>,
);
