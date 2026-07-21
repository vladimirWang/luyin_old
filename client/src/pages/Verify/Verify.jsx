import { useState } from "react";
import { api, formatDuration, showToast } from "../../utils/index.js";
import { KeyRound, Mic, UserRound, X } from "lucide-react";

export default function Verify() {
  const [stsTokenRequesting, setStsTokenRequesting] = useState(false);
  async function requestStsToken() {
    if (stsTokenRequesting) return;
    setStsTokenRequesting(true);
    try {
      const result = await api("/api/tencent-meeting/sts-token/request", {
        method: "POST",
      });
      showToast(result.message || "STS Token 申请已提交");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "STS Token 申请失败");
    } finally {
      setStsTokenRequesting(false);
    }
  }
  return (
    <div>
      <button
        className="sts-token-request-button"
        type="button"
        onClick={requestStsToken}
        disabled={stsTokenRequesting}
      >
        <KeyRound size={16} />
        {stsTokenRequesting ? "申请中…" : "申请 STS Token"}
      </button>
    </div>
  );
}
