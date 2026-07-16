import { Navigate, Outlet, useLocation } from "react-router-dom";
import { hasWecomIdentity, useWecomAuthStore } from "../stores/useWecomAuthStore.js";

export default function ProtectedRoute() {
  const location = useLocation();
  const user = useWecomAuthStore((state) => state.user);

  if (!hasWecomIdentity(user)) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
