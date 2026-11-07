import { FormEvent, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { get, patch, post, session } from "../api/client";
import { Badge, ErrorBanner, Spinner } from "../components/ui";

const EMPTY = { name: "", email: "", team_role: "", role: "responder", password: "", phone: "", alert_opt_in: false };

export default function Access() {
  const [users, setUsers] = useState<any[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const me = session.user;

  const load = () => get("/users").then(setUsers).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const u = await post("/users", { ...form, phone: form.phone || undefined, team_role: form.team_role || undefined });
      setNotice(`${u.name} can now sign in. Give them their password over a safe channel, not firm email.`);
      setForm(EMPTY);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function update(id: number, change: any) {
    setError(null);
    try {
      await patch(`/users/${id}`, change);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (me?.role !== "admin") return <ErrorBanner message="Only admins can manage access." />;
  if (!users) return <Spinner />;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-2xl font-bold text-ink">Access</h1>
      <p className="mb-6 text-sm text-muted">Add responders to Vigil and remove them. These accounts are separate from firm accounts.</p>
      <ErrorBanner message={error} />
      {notice && <div className="mb-4 rounded-xl border border-lime/30 bg-lime-soft px-4 py-2 text-sm text-lime">{notice}</div>}

      <form onSubmit={add} className="card mb-6 grid grid-cols-1 gap-3 p-5 md:grid-cols-3">
        <h2 className="col-span-full flex items-center gap-2 font-semibold"><UserPlus className="h-4 w-4" /> Add a responder</h2>
        <div><label className="label">Name</label><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="label">Email</label><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><label className="label">Team role</label><input className="input" placeholder="e.g. IT lead" value={form.team_role} onChange={(e) => setForm({ ...form, team_role: e.target.value })} /></div>
        <div><label className="label">Temporary password (10+ characters)</label><input className="input" type="password" minLength={10} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        <div>
          <label className="label">Access level</label>
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="responder">Responder</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div><label className="label">Phone for alerts (optional)</label><input className="input" placeholder="+1 555 555 0123" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <label className="col-span-full flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.alert_opt_in} onChange={(e) => setForm({ ...form, alert_opt_in: e.target.checked })} />
          This person agreed to receive incident alerts on their phone
        </label>
        <div className="col-span-full"><button className="btn-primary">Add responder</button></div>
      </form>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-2">Person</th><th className="px-4 py-2">Role</th><th className="px-4 py-2">Phone alerts</th><th className="px-4 py-2">Status</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((u) => (
              <tr key={u.id} className={u.active ? "" : "opacity-60"}>
                <td className="px-4 py-3"><div className="font-medium">{u.name}</div><div className="text-xs text-muted">{u.email}</div></td>
                <td className="px-4 py-3">{u.team_role ?? "—"} <span className="text-xs text-muted">({u.role})</span></td>
                <td className="px-4 py-3">{u.alert_opt_in ? <Badge value={`Yes · ${u.phone_masked ?? "no phone"}`} tone="ok" /> : <Badge value="No" tone="neutral" />}</td>
                <td className="px-4 py-3"><Badge value={u.active ? "Active" : "Deactivated"} tone={u.active ? "ok" : "neutral"} /></td>
                <td className="px-4 py-3 text-right">
                  {u.id !== me.id && (
                    <button className={u.active ? "btn-ghost text-red-300" : "btn-ghost"} onClick={() => update(u.id, { active: !u.active })}>
                      {u.active ? "Deactivate" : "Reactivate"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
