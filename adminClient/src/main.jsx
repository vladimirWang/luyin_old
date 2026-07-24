document.title = "录音管理中台";

if (window.location.pathname === "/") {
  window.history.replaceState(null, "", "/admin");
}

import("./admin/AdminApp.jsx");
