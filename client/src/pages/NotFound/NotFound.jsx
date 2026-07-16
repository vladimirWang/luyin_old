import { ArrowLeft, Home } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import "./NotFound.css";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <main className="not-found-page">
      <section className="not-found-card" aria-labelledby="not-found-title">
        <span className="not-found-code">404</span>
        <h1 id="not-found-title">页面不存在</h1>
        <p>你访问的页面可能已移动或地址有误。</p>
        <div className="not-found-actions">
          <button type="button" onClick={() => navigate(-1)}>
            <ArrowLeft size={18} />
            返回上一页
          </button>
          <Link to="/">
            <Home size={18} />
            返回工作台
          </Link>
        </div>
      </section>
    </main>
  );
}
