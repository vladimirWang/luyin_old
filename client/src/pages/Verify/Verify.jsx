import { useMemo, useState } from "react";
import {
  Building2,
  Check,
  KeyRound,
  LoaderCircle,
  Mail,
  MapPin,
  Network,
  Phone,
  Play,
  RefreshCw,
  Search,
  UserRound,
  Users,
} from "lucide-react";
import { api, showToast } from "../../utils/index.js";
import "./Verify.css";

function DetailRow({ icon: Icon, label, value }) {
  return (
    <div className="verify-detail-row">
      <span className="verify-detail-icon"><Icon size={16} /></span>
      <div>
        <span>{label}</span>
        <strong>{value || "—"}</strong>
      </div>
    </div>
  );
}

function findFirstValue(value, keys) {
  if (!value || typeof value !== "object") return "";
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== "") return String(value[key]);
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = findFirstValue(child, keys);
      if (found) return found;
    }
  }
  return "";
}

export default function Verify() {
  const [stsTokenRequesting, setStsTokenRequesting] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [query, setQuery] = useState("");
  const [meetingApiRunning, setMeetingApiRunning] = useState("");
  const [meetingApiResult, setMeetingApiResult] = useState(null);
  const [meetingApiInput, setMeetingApiInput] = useState({
    meetingRecordId: "",
    addressId: "",
    recordFileId: "",
    meetingId: "",
  });

  const filteredContacts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return contacts;
    return contacts.filter((contact) =>
      [contact.name, contact.userId, ...(contact.departmentNames || [])]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [contacts, query]);

  async function requestStsToken() {
    if (stsTokenRequesting) return;
    setStsTokenRequesting(true);
    try {
      const result = await api("/api/tencent-meeting/sts-token/request", { method: "POST" });
      showToast(result.message || "STS Token 申请已提交");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "STS Token 申请失败");
    } finally {
      setStsTokenRequesting(false);
    }
  }

  async function loadContacts() {
    if (contactsLoading) return;
    setContactsLoading(true);
    try {
      const result = await api("/api/wecom/contacts");
      const nextContacts = Array.isArray(result.users) ? result.users : [];
      setContacts(nextContacts);
      showToast(
        result.partial
          ? `已获取 ${nextContacts.length} 位可见成员，部分部门无权读取`
          : `已获取 ${nextContacts.length} 位企业成员`,
      );
      if (selectedUserId && !nextContacts.some((item) => item.userId === selectedUserId)) {
        setSelectedUserId("");
        setSelectedUser(null);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "企业通讯录获取失败");
    } finally {
      setContactsLoading(false);
    }
  }

  async function selectContact(contact) {
    if (!contact?.userId || detailLoading) return;
    setSelectedUserId(contact.userId);
    setSelectedUser(null);
    setDetailLoading(true);
    try {
      const result = await api(`/api/wecom/contacts/${encodeURIComponent(contact.userId)}`);
      setSelectedUser(result.user || null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "成员详情获取失败");
    } finally {
      setDetailLoading(false);
    }
  }

  function mergeMeetingApiIds(payload) {
    setMeetingApiInput((current) => ({
      meetingRecordId:
        findFirstValue(payload, ["meeting_record_id", "meetingRecordId"]) || current.meetingRecordId,
      addressId:
        findFirstValue(payload, ["address_id", "addressId", "record_file_id", "recordFileId", "id"]) ||
        current.addressId,
      recordFileId:
        findFirstValue(payload, ["record_file_id", "recordFileId"]) || current.recordFileId,
      meetingId: findFirstValue(payload, ["meeting_id", "meetingId"]) || current.meetingId,
    }));
  }

  async function callMeetingApi(operation, input = meetingApiInput, keepRunning = false) {
    if (meetingApiRunning && !keepRunning) return null;
    if (!keepRunning) setMeetingApiRunning(operation);
    try {
      const result = await api("/api/tencent-meeting/verify-api", {
        method: "POST",
        body: JSON.stringify({ operation, input }),
      });
      setMeetingApiResult(result);
      mergeMeetingApiIds(result.payload);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "腾讯会议接口调用失败";
      setMeetingApiResult({ ok: false, operation, error: message });
      showToast(message);
      return null;
    } finally {
      if (!keepRunning) setMeetingApiRunning("");
    }
  }

  async function runMeetingApiChain() {
    if (meetingApiRunning) return;
    setMeetingApiRunning("chain");
    const chainResult = [];
    try {
      const records = await callMeetingApi("records", meetingApiInput, true);
      if (!records) return;
      chainResult.push(records);
      const derived = {
        ...meetingApiInput,
        meetingRecordId: findFirstValue(records.payload, ["meeting_record_id", "meetingRecordId"]),
        recordFileId: findFirstValue(records.payload, ["record_file_id", "recordFileId"]),
        meetingId: findFirstValue(records.payload, ["meeting_id", "meetingId"]),
      };
      if (!derived.meetingRecordId) throw new Error("录制列表中没有可用于地址接口的 meeting_record_id");

      const addresses = await callMeetingApi("addresses", derived, true);
      if (!addresses) return;
      chainResult.push(addresses);
      derived.addressId =
        findFirstValue(addresses.payload, ["address_id", "addressId", "record_file_id", "recordFileId", "id"]) ||
        derived.recordFileId ||
        derived.meetingRecordId;

      const addressDetail = await callMeetingApi("address-detail", derived, true);
      if (addressDetail) chainResult.push(addressDetail);

      if (derived.recordFileId) {
        const transcripts = await callMeetingApi("transcript-details", derived, true);
        if (transcripts) chainResult.push(transcripts);
      }
      setMeetingApiInput(derived);
      setMeetingApiResult({ ok: true, operation: "chain", steps: chainResult });
    } catch (error) {
      const message = error instanceof Error ? error.message : "串联调用失败";
      setMeetingApiResult({ ok: false, operation: "chain", steps: chainResult, error: message });
      showToast(message);
    } finally {
      setMeetingApiRunning("");
    }
  }

  return (
    <section className="screen verify-screen">
      <header className="verify-header">
        <div>
          <span className="verify-eyebrow">ENTERPRISE DIRECTORY</span>
          <h1>企业通讯录</h1>
          <p>读取企业微信成员，并查看完整成员资料。</p>
        </div>
        <div className="verify-header-actions">
          <button
            className="verify-secondary-button"
            type="button"
            onClick={requestStsToken}
            disabled={stsTokenRequesting}
          >
            <KeyRound size={16} />
            {stsTokenRequesting ? "申请中" : "STS Token"}
          </button>
          <button
            className="verify-primary-button"
            type="button"
            onClick={loadContacts}
            disabled={contactsLoading}
          >
            {contactsLoading ? <LoaderCircle className="verify-spin" size={17} /> : <RefreshCw size={17} />}
            {contacts.length ? "刷新通讯录" : "获取企业通讯录"}
          </button>
        </div>
      </header>

      <div className="verify-directory">
        <aside className="verify-contact-panel">
          <div className="verify-panel-heading">
            <div>
              <span>企业成员</span>
              <strong>{contacts.length || "—"}</strong>
            </div>
            {contacts.length > 0 && (
              <label className="verify-search">
                <Search size={15} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索姓名、部门"
                />
              </label>
            )}
          </div>

          <div className="verify-contact-list">
            {contactsLoading && contacts.length === 0 ? (
              <div className="verify-empty"><LoaderCircle className="verify-spin" size={28} /><span>正在读取企业通讯录</span></div>
            ) : filteredContacts.length ? (
              filteredContacts.map((contact) => {
                const active = selectedUserId === contact.userId;
                return (
                  <button
                    className={`verify-contact${active ? " active" : ""}`}
                    type="button"
                    key={contact.userId}
                    onClick={() => selectContact(contact)}
                  >
                    <span className="verify-avatar">{contact.name.slice(0, 1)}</span>
                    <span className="verify-contact-copy">
                      <strong>{contact.name}</strong>
                      <small>{contact.departmentNames?.join(" · ") || contact.userId}</small>
                    </span>
                    {active && <Check size={17} />}
                  </button>
                );
              })
            ) : (
              <div className="verify-empty">
                <Users size={30} />
                <strong>{contacts.length ? "没有匹配的成员" : "尚未获取通讯录"}</strong>
                <span>{contacts.length ? "尝试更换搜索关键词" : "点击上方按钮开始读取"}</span>
              </div>
            )}
          </div>
        </aside>

        <article className="verify-detail-panel">
          {detailLoading ? (
            <div className="verify-empty"><LoaderCircle className="verify-spin" size={30} /><span>正在读取成员详情</span></div>
          ) : selectedUser ? (
            <>
              <div className="verify-profile">
                <span className="verify-profile-avatar">
                  {selectedUser.avatar ? <img src={selectedUser.avatar} alt="" /> : selectedUser.name.slice(0, 1)}
                </span>
                <div>
                  <span className="verify-profile-kicker">成员详情</span>
                  <h2>{selectedUser.name}</h2>
                  <p>{selectedUser.position || "暂未设置职务"}</p>
                </div>
              </div>
              <div className="verify-detail-grid">
                <DetailRow icon={Building2} label="所属部门" value={selectedUser.department || "未设置"} />
                <DetailRow icon={UserRound} label="企业微信 UserID" value={selectedUser.userId} />
                <DetailRow icon={Phone} label="手机号" value={selectedUser.mobile} />
                <DetailRow icon={Mail} label="企业邮箱" value={selectedUser.email} />
                <DetailRow icon={MapPin} label="地址" value={selectedUser.address} />
                <DetailRow
                  icon={Users}
                  label="直属上级"
                  value={selectedUser.directLeaders?.length ? selectedUser.directLeaders.join("、") : "未设置"}
                />
              </div>
              <div className="verify-status">
                <span className={String(selectedUser.status) === "1" ? "online" : ""} />
                成员状态：{String(selectedUser.status) === "1" ? "已激活" : selectedUser.status || "未知"}
              </div>
            </>
          ) : (
            <div className="verify-empty verify-detail-placeholder">
              <UserRound size={38} />
              <strong>选择一位企业成员</strong>
              <span>成员的部门、职务、联系方式与直属上级将在这里展示</span>
            </div>
          )}
        </article>
      </div>

      <section className="verify-api-lab">
        <div className="verify-api-heading">
          <div>
            <span className="verify-eyebrow">TENCENT MEETING API LAB</span>
            <h2>接口串联演示</h2>
            <p>录制列表 → 地址列表 → 地址详情；录制文件 ID → 转写详情</p>
          </div>
          <button
            className="verify-primary-button"
            type="button"
            onClick={runMeetingApiChain}
            disabled={Boolean(meetingApiRunning)}
          >
            {meetingApiRunning === "chain" ? <LoaderCircle className="verify-spin" size={17} /> : <Network size={17} />}
            一键串联调用
          </button>
        </div>

        <div className="verify-api-inputs">
          {[
            ["meetingRecordId", "meeting_record_id"],
            ["addressId", "address / record file ID"],
            ["recordFileId", "record_file_id"],
            ["meetingId", "meeting_id"],
          ].map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                value={meetingApiInput[key]}
                onChange={(event) =>
                  setMeetingApiInput((current) => ({ ...current, [key]: event.target.value }))
                }
                placeholder="由上一步自动填入"
              />
            </label>
          ))}
        </div>

        <div className="verify-api-buttons">
          {[
            ["records", "GET /v1/records"],
            ["addresses", "GET /v1/addresses"],
            ["address-detail", "GET /v1/addresses/:id"],
            ["transcript-details", "GET /v1/records/transcripts/details"],
          ].map(([operation, label]) => (
            <button
              type="button"
              key={operation}
              onClick={() => callMeetingApi(operation)}
              disabled={Boolean(meetingApiRunning)}
            >
              {meetingApiRunning === operation ? <LoaderCircle className="verify-spin" size={14} /> : <Play size={14} />}
              {label}
            </button>
          ))}
        </div>

        <pre className="verify-api-result">
          {meetingApiResult
            ? JSON.stringify(meetingApiResult, null, 2)
            : "调用结果将在这里显示；响应中的依赖 ID 会自动填入上方参数。"}
        </pre>
      </section>
    </section>
  );
}
