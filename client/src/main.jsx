import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { App } from "./App.jsx";
import User from "./pages/User/User.jsx";
import WeComLogin from "./pages/WeComLogin/WeComLogin.jsx";
import "./styles.css";
import "./card-polish.css";

// Enterprise WeChat returns OAuth parameters before the URL hash. Ensure the
// callback is handled by the login route when HashRouter is in use.
const oauthCallbackParams = new URLSearchParams(window.location.search);
if (oauthCallbackParams.has("code") && !window.location.hash.includes("/login")) {
  window.location.hash = "/login";
}

const isProd = process.env.NODE_ENV === "prod"
if (true) {
  import("vconsole").then(({ default: VConsole }) => {
    new VConsole();
  });
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/login" element={<WeComLogin />} />
        <Route path="/wecom-login" element={<WeComLogin />} />
        <Route path="/user" element={<User />} />
        <Route path="*" element={<App />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>,
);
