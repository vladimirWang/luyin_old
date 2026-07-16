import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App.jsx";
import Recorder from "./pages/Recorder/Recorder.jsx";
import Records from "./pages/Records/Records.jsx";
import Detail from "./pages/Detail/Detail.jsx";
import User from "./pages/User/User.jsx";
import WeComLogin from "./pages/Login/Login.jsx";
import NotFound from "./pages/NotFound/NotFound.jsx";
import ProtectedRoute from "./routes/ProtectedRoute.jsx";
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
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<WeComLogin />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Navigate to="/recorder" replace />} />
          <Route element={<App />}>
            <Route path="/recorder" element={<Recorder />} />
            <Route path="/records" element={<Records />} />
            <Route path="/detail" element={<Detail />} />
          </Route>
          <Route path="/user" element={<User />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
