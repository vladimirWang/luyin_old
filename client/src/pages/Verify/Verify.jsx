import { useState } from "react";
import { Building2, KeyRound, ListTree, LoaderCircle, Search, Users } from "lucide-react";
import { getWecomDepartmentIds, getWecomDepartmentMembers } from "../../api/wecom.js";
import { api, showToast } from "../../utils/index.js";

export default function Verify() {
  const [stsTokenRequesting, setStsTokenRequesting] = useState(false);
  const [departmentId, setDepartmentId] = useState("1");
  const [parentDepartmentId, setParentDepartmentId] = useState("");
  const [departments, setDepartments] = useState([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(false);
  const [departmentsError, setDepartmentsError] = useState("");
  const [fetchChild, setFetchChild] = useState(false);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");

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

  async function queryDepartmentMembers(event) {
    event.preventDefault();
    const normalizedDepartmentId = Number(departmentId);
    if (!Number.isInteger(normalizedDepartmentId) || normalizedDepartmentId <= 0) {
      setMembersError("部门 ID 必须是大于 0 的整数");
      return;
    }

    setMembersLoading(true);
    setMembersError("");
    try {
      const result = await getWecomDepartmentMembers(normalizedDepartmentId, fetchChild);
      setMembers(Array.isArray(result.userlist) ? result.userlist : []);
    } catch (error) {
      setMembers([]);
      setMembersError(error instanceof Error ? error.message : "企业微信部门成员获取失败");
    } finally {
      setMembersLoading(false);
    }
  }

  async function queryDepartmentIds(event) {
    event.preventDefault();
    const normalizedParentDepartmentId = parentDepartmentId.trim();
    if (
      normalizedParentDepartmentId &&
      (!Number.isInteger(Number(normalizedParentDepartmentId)) || Number(normalizedParentDepartmentId) <= 0)
    ) {
      setDepartmentsError("上级部门 ID 必须是大于 0 的整数，留空表示获取全部");
      return;
    }

    setDepartmentsLoading(true);
    setDepartmentsError("");
    try {
      const result = await getWecomDepartmentIds(normalizedParentDepartmentId);
      setDepartments(Array.isArray(result.department_id) ? result.department_id : []);
    } catch (error) {
      setDepartments([]);
      setDepartmentsError(error instanceof Error ? error.message : "企业微信部门 ID 列表获取失败");
    } finally {
      setDepartmentsLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
      <section className="rounded-[28px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(30,41,59,0.08)] backdrop-blur">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white">
            <ListTree size={21} />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-slate-950">企业微信部门 ID 列表</h1>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              对应企业微信文档 95350。上级部门 ID 留空时获取应用可见范围内的部门。
            </p>
          </div>
        </div>

        <form className="mt-6 flex gap-3" onSubmit={queryDepartmentIds}>
          <input
            className="h-12 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base font-semibold text-slate-950 outline-none transition focus:border-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-100"
            type="number"
            min="1"
            step="1"
            value={parentDepartmentId}
            onChange={(event) => setParentDepartmentId(event.target.value)}
            placeholder="上级部门 ID，可留空"
          />
          <button
            className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={departmentsLoading}
          >
            {departmentsLoading ? <LoaderCircle className="animate-spin" size={18} /> : <Search size={18} />}
            查询
          </button>
        </form>

        {departmentsError ? (
          <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {departmentsError}
          </div>
        ) : null}

        {departments.length ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
            <div className="grid grid-cols-[1fr_1fr_1fr] bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500">
              <span>部门 ID</span>
              <span>上级 ID</span>
              <span className="text-right">排序</span>
            </div>
            <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
              {departments.map((department, index) => (
                <button
                  className="grid w-full grid-cols-[1fr_1fr_1fr] px-4 py-3 text-left text-sm transition hover:bg-blue-50"
                  type="button"
                  key={`${department.id}-${index}`}
                  onClick={() => setDepartmentId(String(department.id))}
                >
                  <span className="font-bold text-blue-700">{department.id}</span>
                  <span className="text-slate-600">{department.parentid}</span>
                  <span className="text-right text-slate-500">{department.order}</span>
                </button>
              ))}
            </div>
            <p className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
              点击任意部门，可填入下方成员查询。
            </p>
          </div>
        ) : null}
      </section>

      <section className="rounded-[28px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(30,41,59,0.08)] backdrop-blur">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
            <Building2 size={21} />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-slate-950">企业微信部门成员 Demo</h1>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              服务端调用通讯录接口，应用 Secret 和 access_token 不会发送到浏览器。
            </p>
          </div>
        </div>

        <form className="mt-6 space-y-4" onSubmit={queryDepartmentMembers}>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-700">部门 ID</span>
            <input
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base font-semibold text-slate-950 outline-none transition focus:border-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-100"
              type="number"
              min="1"
              step="1"
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              placeholder="例如：1"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <span>
              <span className="block text-sm font-bold text-slate-800">递归获取子部门成员</span>
              <span className="mt-0.5 block text-xs text-slate-500">对应官方参数 fetch_child=1</span>
            </span>
            <input
              className="size-5 accent-slate-950"
              type="checkbox"
              checked={fetchChild}
              onChange={(event) => setFetchChild(event.target.checked)}
            />
          </label>

          <button
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={membersLoading}
          >
            {membersLoading ? <LoaderCircle className="animate-spin" size={18} /> : <Search size={18} />}
            {membersLoading ? "正在查询…" : "获取部门成员"}
          </button>
        </form>

        {membersError ? (
          <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {membersError}
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/90 shadow-[0_16px_45px_rgba(30,41,59,0.08)]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2 text-slate-950">
            <Users size={19} />
            <h2 className="font-black">查询结果</h2>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            {members.length} 位成员
          </span>
        </div>

        {members.length ? (
          <div className="divide-y divide-slate-100">
            {members.map((member, index) => (
              <article className="px-5 py-4" key={member.userid || member.open_userid || index}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="truncate font-bold text-slate-950">{member.name || "未命名成员"}</h3>
                    <p className="mt-1 break-all text-xs text-slate-500">userid：{member.userid || "—"}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                    部门 {Array.isArray(member.department) && member.department.length ? member.department.join(", ") : "—"}
                  </span>
                </div>
                <p className="mt-2 break-all text-xs text-slate-400">
                  open_userid：{member.open_userid || "—"}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="flex min-h-40 flex-col items-center justify-center px-5 py-8 text-center text-slate-400">
            <Users size={28} strokeWidth={1.5} />
            <p className="mt-3 text-sm">输入部门 ID 后发起查询</p>
          </div>
        )}
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white/80 p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Tencent Meeting</p>
        <button
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-800 disabled:opacity-60"
          type="button"
          onClick={requestStsToken}
          disabled={stsTokenRequesting}
        >
          <KeyRound size={16} />
          {stsTokenRequesting ? "申请中…" : "申请 STS Token"}
        </button>
      </section>
    </div>
  );
}
