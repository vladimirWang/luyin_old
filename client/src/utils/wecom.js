export function isInWeCom(userAgent = typeof window !== "undefined" ? window.navigator.userAgent : "") {
  return /wxwork/i.test(String(userAgent || ""));
}

export function isInWeChat(userAgent = typeof window !== "undefined" ? window.navigator.userAgent : "") {
  const normalized = String(userAgent || "");
  return /MicroMessenger/i.test(normalized) && !/wxwork/i.test(normalized);
}
