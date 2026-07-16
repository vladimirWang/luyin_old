import { Link } from "react-router-dom";
import { useWecomAuthStore } from "../../stores/useWecomAuthStore.js";

export default function User() {
  const user = useWecomAuthStore((state) => state.user);
  const clearUser = useWecomAuthStore((state) => state.clearUser);

  return (
    <main style={styles.page}>
      <section style={styles.card} aria-labelledby="user-title">
        <div style={styles.avatar}>
          {user?.avatar ? <img src={user.avatar} alt="" style={styles.avatarImage} /> : (user?.name || "企").slice(0, 1)}
        </div>
        <h1 id="user-title" style={styles.title}>{user?.name || "企业微信用户"}</h1>
        <p style={styles.company}>{user?.position || "企业微信"}</p>
        <dl style={styles.details}>
          <UserDetail label="企业微信用户 ID" value={user?.userId || user?.openUserId} />
          <UserDetail label="部门" value={user?.department} />
          <UserDetail label="职位" value={user?.position} />
          <UserDetail label="邮箱" value={user?.email} />
          <UserDetail label="手机号" value={user?.mobile} />
        </dl>
        <div style={styles.actions}>
          <Link to="/" style={styles.link}>进入录音工作台</Link>
          <button type="button" style={styles.logout} onClick={clearUser}>退出登录</button>
        </div>
      </section>
    </main>
  );
}

function UserDetail({ label, value }) {
  return (
    <div style={styles.row}>
      <dt style={styles.label}>{label}</dt>
      <dd style={styles.value}>{value || "—"}</dd>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 24,
    overflow: "auto",
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
    overflow: "hidden",
    borderRadius: "50%",
    background: "#e8f8ef",
    color: "#07a854",
    fontSize: 30,
    fontWeight: 700,
  },
  avatarImage: { width: "100%", height: "100%", objectFit: "cover" },
  title: { margin: 0, fontSize: 26 },
  company: { margin: "8px 0 26px", color: "#6b778c" },
  details: { margin: "0 0 24px", textAlign: "left" },
  row: { padding: "14px 0", borderTop: "1px solid #edf0f4" },
  label: { marginBottom: 6, color: "#8792a6", fontSize: 13 },
  value: { margin: 0, overflowWrap: "anywhere", fontSize: 15 },
  actions: { display: "flex", alignItems: "center", justifyContent: "center", gap: 18 },
  link: { color: "#07a854", fontWeight: 600, textDecoration: "none" },
  logout: { border: 0, color: "#d14343", background: "transparent", cursor: "pointer" },
};
