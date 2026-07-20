import React from "react";
import { createRoot } from "react-dom/client";
import { unstableSetRender } from "antd-mobile";
import AppRouter from "./AppRouter.jsx";
import "./styles.css";
import "./card-polish.css";

unstableSetRender((node, container) => {
  container._reactRoot ||= createRoot(container);
  const root = container._reactRoot;
  root.render(node);

  return async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.unmount();
  };
});

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
