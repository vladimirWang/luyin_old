export function isInWeCom(userAgent = typeof window !== "undefined" ? window.navigator.userAgent : "") {
  return /wxwork/i.test(String(userAgent || ""));
}
