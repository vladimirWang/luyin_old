import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App.jsx";
import Detail from "./pages/Detail/Detail.jsx";
import WeComLogin from "./pages/Login/Login.jsx";
import NotFound from "./pages/NotFound/NotFound.jsx";
import Recorder from "./pages/Recorder/Recorder.jsx";
import Records from "./pages/Records/Records.jsx";
import User from "./pages/User/User.jsx";
import Verify from "./pages/Verify/Verify.jsx";
import ProtectedRoute from "./routes/ProtectedRoute.jsx";
import appConfig from "./config.js";

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<WeComLogin />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Navigate to="/records" replace />} />
          <Route element={<App />}>
            {/* <Route path="/recorder" element={<Recorder />} /> */}
            <Route path="/records" element={<Records />} />
            <Route path="/detail" element={<Detail />} />
            {appConfig.showDebug && (
              <Route path="/verify" element={<Verify />} />
            )}
          </Route>
          <Route path="/user" element={<User />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
