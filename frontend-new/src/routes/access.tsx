import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/vigil/AppShell";
import { actions, canAdmin, roleLabel, useCurrentUser, useVigil, type Role } from "@/lib/vigil";
import { api, USE_MOCKS, type DirectoryUser } from "@/lib/api";

export const Route = createFileRoute("/access")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Access — Vigil" },
      { name: "description", content: "Manage who at the firm can use Vigil." },
      { property: "og:title", content: "Access — Vigil" },
      { property: "og:description", content: "Manage firm users and roles." },
    ],
  }),
  component: Access,
});

const input = "rounded border bg-input/30 px-3 py-2 text-sm";
const TEAM_ROLES = ["Litigation lead", "IT lead", "Incident commander"];

function Access() {
  const me = useCurrentUser();
  return (
    <AppShell>
      {!canAdmin(me) ? (
        <p role="alert" className="rounded-lg border border-risk/50 p-6 text-risk">Only admins can manage access.</p>
      ) : USE_MOCKS ? <SampleAccess /> : <LiveAccess myId={me?.id} />}
    </AppShell>
  );
}

function LiveAccess({ myId }: { myId: string | undefined }) {
  const client = useQueryClient();
  const users = useQuery({ queryKey: ["vigil", "users"], queryFn: api.users, retry: false });
  const blank = { name: "", email: "", role: "responder" as "admin" | "responder", team_role: "Litigation lead", password: "", phone: "", alert_opt_in: false };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);

  async function save(fn: () => Promise<DirectoryUser>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); await client.invalidateQueries({ queryKey: ["vigil", "users"] }); return true; }
    catch (err) { toast.error(err instanceof Error ? err.message : "Unable to save."); return false; }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl">Access</h1>
      <p className="max-w-2xl text-sm text-muted-foreground">Vigil keeps its own accounts, separate from firm email and SSO. Litigation leads can request filing help; IT leads can claim filing tasks. Phone alerts need a number and recorded consent.</p>
      {users.isPending ? <p role="status">Loading people…</p> : users.error ? <p role="alert" className="text-threat">People could not load: {users.error.message}</p> :
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground"><tr className="border-b"><th className="px-4 py-3">Name</th><th>Access</th><th>Team role</th><th>Phone alerts</th><th>Status</th><th /></tr></thead>
            <tbody>
              {users.data.map((u) => {
                const self = String(u.id) === myId;
                return <tr key={u.id} className="border-b last:border-0">
                  <td className="px-4 py-3">{u.name}<div className="text-xs text-muted-foreground">{u.email}</div></td>
                  <td><select aria-label={`Access for ${u.name}`} disabled={busy || self} value={u.role} className="rounded border bg-input/30 px-2 py-1"
                    onChange={(e) => void save(() => api.updateUser(u.id, { role: e.target.value as "admin" | "responder" }), "Access updated")}>
                    <option value="responder">{roleLabel("responder")}</option><option value="admin">{roleLabel("admin")}</option></select></td>
                  <td><select aria-label={`Team role for ${u.name}`} disabled={busy} value={u.team_role ?? ""} className="rounded border bg-input/30 px-2 py-1"
                    onChange={(e) => void save(() => api.updateUser(u.id, { team_role: e.target.value }), "Team role updated")}>
                    {!TEAM_ROLES.includes(u.team_role ?? "") && <option value={u.team_role ?? ""}>{u.team_role ?? "—"}</option>}
                    {TEAM_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></td>
                  <td>{u.phone_masked ? <label className="flex items-center gap-2"><input type="checkbox" disabled={busy} checked={u.alert_opt_in}
                    onChange={(e) => void save(() => api.updateUser(u.id, { alert_opt_in: e.target.checked }), "Alert consent updated")} />{u.phone_masked}</label> : <span className="text-muted-foreground">No phone</span>}</td>
                  <td className={u.active ? "text-healthy" : "text-muted-foreground"}>{u.active ? "Active" : "Deactivated"}</td>
                  <td className="pr-4 text-right">{!self && <button disabled={busy} onClick={() => void save(() => api.updateUser(u.id, { active: !u.active }), u.active ? "Deactivated" : "Reactivated")} className="text-xs text-primary hover:underline">{u.active ? "Deactivate" : "Reactivate"}</button>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
      <form onSubmit={(e) => { e.preventDefault(); void save(() => api.createUser({ ...f, phone: f.phone || undefined }), "Person added").then((ok) => ok && setF(blank)); }}
        className="flex flex-wrap gap-2 rounded-lg border bg-card p-4">
        <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Full name" aria-label="Full name" className={input} />
        <input required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email" type="email" aria-label="Email" className={input} />
        <select value={f.team_role} onChange={(e) => setF({ ...f, team_role: e.target.value })} aria-label="Team role" className={input}>{TEAM_ROLES.map((r) => <option key={r}>{r}</option>)}</select>
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as "admin" | "responder" })} aria-label="Access" className={input}>
          <option value="responder">{roleLabel("responder")}</option><option value="admin">{roleLabel("admin")}</option></select>
        <input required minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="Temporary password (10+ chars)" type="password" autoComplete="new-password" aria-label="Temporary password" className={input} />
        <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Phone (optional)" type="tel" aria-label="Phone" className={input} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.alert_opt_in} disabled={!f.phone} onChange={(e) => setF({ ...f, alert_opt_in: e.target.checked })} />Consents to phone alerts</label>
        <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Add person</button>
      </form>
    </div>
  );
}

function SampleAccess() {
  const s = useVigil();
  const me = useCurrentUser();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("responder");
  return (
    <div className="space-y-6">
      <h1 className="text-3xl">Access <span className="text-sm text-muted-foreground">· sample</span></h1>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground"><tr className="border-b"><th className="px-4 py-3">Name</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead>
          <tbody>
            {s.users.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="px-4 py-3">{u.name}<div className="text-xs text-muted-foreground">{u.title}</div></td>
                <td>{u.email}</td>
                <td>
                  <select aria-label={`Role for ${u.name}`} value={u.role} onChange={(e) => actions.updateUser(u.id, { role: e.target.value as Role })} className="rounded border bg-input/30 px-2 py-1">
                    {(["lawyer", "responder", "admin"] as Role[]).map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </select>
                </td>
                <td className={u.active ? "text-healthy" : "text-muted-foreground"}>{u.active ? "Active" : "Deactivated"}</td>
                <td className="pr-4 text-right">
                  {u.id !== me?.id && <button onClick={() => actions.updateUser(u.id, { active: !u.active })} className="text-xs text-primary hover:underline">{u.active ? "Deactivate" : "Reactivate"}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (!name || !email) return; actions.addUser({ name, email, role, title: roleLabel(role) }); toast.success("User added (sample)"); setName(""); setEmail(""); }} className="flex flex-wrap gap-2 rounded-lg border bg-card p-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={input} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className={input} />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={input}>
          {(["lawyer", "responder", "admin"] as Role[]).map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
        <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Add user</button>
      </form>
    </div>
  );
}
