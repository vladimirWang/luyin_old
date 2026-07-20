import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Home, ListMusic, Mic } from "lucide-react";
import { getLocalProfile, uiText } from "./utils/index.js";

const NAV_ITEMS = [
  { path: "/records", labelZh: "记录", labelEn: "Records", icon: Home },
  // { path: "/recorder", labelZh: "录音", labelEn: "Record", icon: Mic, center: true },
  { path: "/detail", labelZh: "问答", labelEn: "QA", icon: ListMusic },
];

function useKeyboardVisibility() {
  const [visible, setVisible] = useState(false);
  const baseHeightRef = useRef(0);

  useEffect(() => {
    const editableInputTypes = new Set(["email", "number", "password", "search", "tel", "text", "url"]);
    const visualViewport = window.visualViewport;

    function isEditableElement(element) {
      if (!element) return false;
      const tagName = element.tagName?.toLowerCase();
      if (tagName === "textarea") return true;
      if (tagName === "input") {
        return editableInputTypes.has((element.getAttribute("type") || "text").toLowerCase());
      }
      return Boolean(element.isContentEditable);
    }

    function viewportHeight() {
      return visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0;
    }

    function updateVisibility() {
      const height = viewportHeight();
      if (!height || !isEditableElement(document.activeElement)) {
        if (height) baseHeightRef.current = Math.max(baseHeightRef.current, height);
        setVisible(false);
        return;
      }

      baseHeightRef.current = Math.max(baseHeightRef.current || height, height);
      const keyboardInset = Math.max(0, baseHeightRef.current - height);
      const visualInset = visualViewport ? Math.max(0, (window.innerHeight || baseHeightRef.current) - visualViewport.height) : 0;
      setVisible(keyboardInset > 120 || visualInset > 120);
    }

    let timer = 0;
    function queueUpdate() {
      window.clearTimeout(timer);
      timer = window.setTimeout(updateVisibility, 70);
    }

    updateVisibility();
    visualViewport?.addEventListener("resize", updateVisibility);
    visualViewport?.addEventListener("scroll", updateVisibility);
    window.addEventListener("resize", updateVisibility);
    document.addEventListener("focusin", queueUpdate);
    document.addEventListener("focusout", queueUpdate);

    return () => {
      window.clearTimeout(timer);
      visualViewport?.removeEventListener("resize", updateVisibility);
      visualViewport?.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
      document.removeEventListener("focusin", queueUpdate);
      document.removeEventListener("focusout", queueUpdate);
    };
  }, []);

  return visible;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const keyboardVisible = useKeyboardVisibility();
  const language = getLocalProfile().language;

  return (
    <main className={keyboardVisible ? "app-shell keyboard-visible" : "app-shell"}>
      <div className={`h5-app view-${location.pathname.slice(1) || "recorder"}`}>
        <div className="view-stack">
          <Outlet />
        </div>

        <nav className={keyboardVisible ? "bottom-nav hidden" : "bottom-nav"} aria-label={uiText(language, "底部导航", "Bottom navigation")} aria-hidden={keyboardVisible}>
          {NAV_ITEMS.map(({ path, labelZh, labelEn, icon: Icon, center }) => {
            const active = location.pathname === path;
            return (
              <button
                className={`${active ? "active" : ""}${center ? " center" : ""}`.trim()}
                key={path}
                type="button"
                onClick={() => navigate(path)}
              >
                <Icon size={center ? 24 : 21} />
                <span>{uiText(language, labelZh, labelEn)}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </main>
  );
}
