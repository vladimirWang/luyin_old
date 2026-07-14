import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, saveLocalProfile } from "../../utils/index.js";

export default function User() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api("/api/profile")
      .then((payload) => {
        if (!active) return;
        const currentProfile = payload.profile || {};
        setProfile(currentProfile);
        saveLocalProfile(currentProfile);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : "获取用户信息失败");
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <main style={styles.page}>
        <section style={styles.card}>
          <p role="alert" style={styles.error}>{error}</p>
          <Link to="/login" style={styles.link}>重新登录</Link>
        </section>
      </main>
    );
  }

  if (!profile) {
    return <main style={styles.page}><p>正在获取当前用户信息…</p></main>;
  }

  return (
    <main style={styles.page}>
      <section style={styles.card} aria-labelledby="user-title">
        <div style={styles.avatar}>{(profile.name || "企").slice(0, 1)}</div>
        <h1 id="user-title" style={styles.title}>{profile.name || "未设置姓名"}</h1>
        <p style={styles.company}>{profile.company || "企业微信"}</p>
        <dl style={styles.details}>
          <div style={styles.row}>
            <dt style={styles.label}>企业微信用户 ID</dt>
            <dd style={styles.value}>{profile.wecomUserId || "—"}</dd>
          </div>
          <div style={styles.row}>
            <dt style={styles.label}>部门</dt>
            <dd style={styles.value}>{profile.department || "—"}</dd>
          </div>
        </dl>
        <Link to="/" style={styles.link}>进入录音工作台</Link>
      </section>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 24,
    background: "#f5f7fa",
    color: "#17233d",
  },
  card: {
    width: "min(100%, 420px)",
    padding: "36px 28px",
    borderRadius: 20,
    background: "#fff",
    boxShadow: "0 18px 50px rgba(28, 49, 79, 0.10)",
    textAlign: "center",
  },
  avatar: {
    width: 72,
    height: 72,
    margin: "0 auto 18px",
    display: "grid",
    placeItems: "center",
    borderRadius: "50%",
    background: "#e8f8ef",
    color: "#07a854",
    fontSize: 30,
    fontWeight: 700,
  },
  title: { margin: 0, fontSize: 26 },
  company: { margin: "8px 0 26px", color: "#6b778c" },
  details: { margin: "0 0 24px", textAlign: "left" },
  row: { padding: "14px 0", borderTop: "1px solid #edf0f4" },
  label: { marginBottom: 6, color: "#8792a6", fontSize: 13 },
  value: { margin: 0, overflowWrap: "anywhere", fontSize: 15 },
  link: { color: "#07a854", fontWeight: 600, textDecoration: "none" },
  error: { color: "#d14343", lineHeight: 1.5 },
};
