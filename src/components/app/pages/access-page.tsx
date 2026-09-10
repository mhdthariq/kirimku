"use client";

import { useMemo, useState } from "react";
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type Employee, type UserAccount, type Role, type Permission, type Options } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { ActiveBadge } from "@/components/app/status-badge";
import { Field, FormSelect, Input, SubmitButton, formatDate } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

export function AccessPage() {
  const { user } = useAuth();
  const can = {
    employeeView: hasPermission(user, "employee.view"),
    employeeCreate: hasPermission(user, "employee.create"),
    employeeUpdate: hasPermission(user, "employee.update"),
    userView: hasPermission(user, "user.view"),
    userCreate: hasPermission(user, "user.create"),
    userUpdate: hasPermission(user, "user.update"),
    roleView: hasPermission(user, "role.view"),
    roleCreate: hasPermission(user, "role.create"),
    roleUpdate: hasPermission(user, "role.update"),
  };

  if (!can.employeeView && !can.userView && !can.roleView) {
    return <PageHeader title="Access Control" subtitle="Anda tidak memiliki izin akses ke menu ini." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Access Control"
        subtitle="Employees, akun user, dan role dengan permission terperinci."
        icon={<ShieldCheck className="h-5 w-5" />}
      />

      <Tabs defaultValue={can.userView ? "users" : can.employeeView ? "employees" : "roles"}>
        <TabsList>
          {can.userView && <TabsTrigger value="users">Users</TabsTrigger>}
          {can.roleView && <TabsTrigger value="roles">Roles</TabsTrigger>}
          {can.employeeView && <TabsTrigger value="employees">Employees</TabsTrigger>}
          <TabsTrigger value="activity">Log Aktivitas</TabsTrigger>
        </TabsList>
        {can.userView && <TabsContent value="users" className="mt-3"><UsersTab can={can} /></TabsContent>}
        {can.roleView && <TabsContent value="roles" className="mt-3"><RolesTab can={can} /></TabsContent>}
        {can.employeeView && <TabsContent value="employees" className="mt-3"><EmployeesTab can={can} /></TabsContent>}
        <TabsContent value="activity" className="mt-3">
          <ActivityLogPanel entityTypes={["user", "role", "employee", "auth"]} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

function EmployeesTab({ can }: { can: { employeeCreate: boolean; employeeUpdate: boolean } }) {
  const { data, loading, reload } = useApiData<Employee[]>(() => apiGet<Employee[]>("/employees"), []);
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", position: "", warehouseId: "" });
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter((e) => !q || e.name.toLowerCase().includes(q) || e.employeeNumber.toLowerCase().includes(q) || (e.position ?? "").toLowerCase().includes(q));
  }, [data, search]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const payload = { name: form.name, phone: form.phone || null, position: form.position || null, warehouseId: form.warehouseId ? Number(form.warehouseId) : null };
    const ok = await runAction(
      () => (editing ? apiPut(`/employees/${editing.id}`, payload) : apiPost("/employees", payload)),
      { success: editing ? "Employee diperbarui." : "Employee dibuat." },
    );
    setBusy(false);
    if (ok) {
      setDialogOpen(false);
      reload();
    }
  }

  return (
    <>
      <DataTable
        rows={rows}
        loading={loading}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Cari nama / nomor / posisi…"
        toolbar={
          can.employeeCreate && (
            <Button size="sm" onClick={() => { setEditing(null); setForm({ name: "", phone: "", position: "", warehouseId: "" }); setDialogOpen(true); }}>
              <UserPlus className="h-4 w-4" /> Tambah Employee
            </Button>
          )
        }
        emptyMessage="Belum ada employee."
        columns={[
          { key: "number", header: "Nomor", primary: true, render: (e) => <span className="font-mono text-xs">{e.employeeNumber}</span> },
          { key: "name", header: "Nama", render: (e) => <span className="font-medium">{e.name}</span> },
          { key: "position", header: "Posisi", render: (e) => e.position ?? "—" },
          {
            key: "gudang",
            header: "Gudang",
            render: (e) =>
              e.warehouse ? (
                <Badge variant="outline" className="max-w-[180px] truncate text-[11px]">{e.warehouse.name}</Badge>
              ) : (
                <span className="text-xs text-muted-foreground" title="Data operational kosong — hanya Owner melihat semua gudang">belum ditugaskan</span>
              ),
          },
          { key: "phone", header: "Telepon", hideOnMobile: true, render: (e) => e.phone ?? "—" },
          {
            key: "account",
            header: "Akun User",
            render: (e) =>
              e.user ? (
                <Badge variant="outline" className="font-mono text-[11px]">@{e.user.username}</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">belum ada</span>
              ),
          },
          { key: "status", header: "Status", render: (e) => <ActiveBadge active={e.isActive} /> },
          ...(can.employeeUpdate
            ? [
                {
                  key: "actions",
                  header: "Aksi",
                  render: (e: Employee) => (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditing(e); setForm({ name: e.name, phone: e.phone ?? "", position: e.position ?? "", warehouseId: e.warehouseId != null ? String(e.warehouseId) : "" }); setDialogOpen(true); }} aria-label="Edit employee">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Employee — ${editing.employeeNumber}` : "Tambah Employee"}</DialogTitle>
            <DialogDescription>{editing ? "Perbarui data employee." : "Nomor employee (EMP-xxxxxx) dibuat otomatis."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Nama" htmlFor="e-name">
              <Input id="e-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required disabled={busy} />
            </Field>
            <Field label="Gudang Penempatan" htmlFor="e-warehouse" hint="Semua data operasional karyawan dibatasi ke gudang ini">
              <FormSelect
                value={form.warehouseId}
                onValueChange={(v) => setForm({ ...form, warehouseId: v })}
                placeholder="Pilih gudang…"
                options={(options?.warehouses ?? []).map((w) => ({ value: String(w.id), label: w.name }))}
                disabled={busy}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Posisi" htmlFor="e-position">
                <Input id="e-position" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="Kurir / Driver" disabled={busy} />
              </Field>
              <Field label="Telepon" htmlFor="e-phone">
                <Input id="e-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xx" disabled={busy} />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>Batal</Button>
              <SubmitButton busy={busy}>{editing ? "Simpan Perubahan" : "Buat Employee"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function UsersTab({ can }: { can: { userCreate: boolean; userUpdate: boolean } }) {
  const { data, loading, reload } = useApiData<UserAccount[]>(() => apiGet<UserAccount[]>("/users"), []);
  const { data: employees } = useApiData<Employee[]>(() => apiGet<Employee[]>("/employees"), []);
  const { data: roles } = useApiData<Role[]>(() => apiGet<Role[]>("/roles"), []);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserAccount | null>(null);
  const [form, setForm] = useState({ username: "", name: "", password: "", employeeId: "", roleIds: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState<UserAccount | null>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter((u) => !q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
  }, [data, search]);

  const roleOptions = (roles ?? []).map((r) => ({ value: String(r.id), label: r.name }));
  const unlinkedEmployees = (employees ?? []).filter((e) => !e.user && e.isActive);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const payload: Record<string, unknown> = {
      username: form.username,
      name: form.name,
      ...(editing ? {} : { password: form.password }),
      employeeId: form.employeeId ? Number(form.employeeId) : null,
      roleIds: form.roleIds.map(Number),
    };
    if (editing && form.password) payload.password = form.password;
    const ok = await runAction(
      () => (editing ? apiPut(`/users/${editing.id}`, payload) : apiPost("/users", payload)),
      { success: editing ? "User diperbarui." : "User dibuat." },
    );
    setBusy(false);
    if (ok) {
      setDialogOpen(false);
      reload();
    }
  }

  async function onDisable() {
    if (!confirmDisable) return;
    const target = confirmDisable;
    setConfirmDisable(null);
    const ok = await runAction(() => apiDelete(`/users/${target.id}`), { success: "User dinonaktifkan." });
    if (ok) reload();
  }

  return (
    <>
      <DataTable
        rows={rows}
        loading={loading}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Cari nama / username…"
        toolbar={
          can.userCreate && (
            <Button size="sm" onClick={() => { setEditing(null); setForm({ username: "", name: "", password: "", employeeId: "", roleIds: [] }); setDialogOpen(true); }}>
              <UserPlus className="h-4 w-4" /> Tambah User
            </Button>
          )
        }
        emptyMessage="Belum ada user."
        columns={[
          { key: "username", header: "Username", primary: true, render: (u) => <span className="font-mono text-xs font-semibold">@{u.username}</span> },
          {
            key: "name",
            header: "Nama",
            render: (u) => (
              <div>
                <p className="text-sm font-medium">{u.name}</p>
                {u.employee && <p className="text-xs text-muted-foreground">{u.employee.employeeNumber}</p>}
              </div>
            ),
          },
          {
            key: "roles",
            header: "Roles",
            render: (u) => (
              <div className="flex flex-wrap gap-1">
                {u.isOwner ? (
                  <Badge>Owner — semua akses</Badge>
                ) : u.roles.length === 0 ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  u.roles.map((r) => (
                    <Badge key={r.role.id} variant="secondary" className="text-[10px]">{r.role.name}</Badge>
                  ))
                )}
              </div>
            ),
          },
          { key: "status", header: "Status", render: (u) => <ActiveBadge active={u.isActive} /> },
          ...(can.userUpdate
            ? [
                {
                  key: "actions",
                  header: "Aksi",
                  render: (u: UserAccount) =>
                    u.isOwner ? (
                      <span className="text-xs text-muted-foreground">protected</span>
                    ) : (
                      <div className="flex gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditing(u);
                            setForm({
                              username: u.username,
                              name: u.name,
                              password: "",
                              employeeId: u.employeeId ? String(u.employeeId) : "",
                              roleIds: u.roles.map((r) => String(r.role.id)),
                            });
                            setDialogOpen(true);
                          }}
                          aria-label="Edit user"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setConfirmDisable(u)} aria-label="Nonaktifkan user">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ),
                },
              ]
            : []),
        ]}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit User — @${editing.username}` : "Tambah User"}</DialogTitle>
            <DialogDescription>{editing ? "Kosongkan password jika tidak ingin mengganti." : "User baru aktif langsung dengan role terpilih."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Username" htmlFor="u-username">
                <Input id="u-username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required disabled={busy || !!editing} autoComplete="off" />
              </Field>
              <Field label="Nama" htmlFor="u-name">
                <Input id="u-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required disabled={busy} />
              </Field>
            </div>
            <Field label={editing ? "Password baru (opsional)" : "Password (min. 8 karakter)"} htmlFor="u-password">
              <Input id="u-password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editing} disabled={busy} minLength={8} autoComplete="new-password" />
            </Field>
            <Field label="Employee (opsional)" htmlFor="u-employee" hint={editing ? "Tautan employee tidak bisa diganti." : undefined}>
              <FormSelect
                value={form.employeeId}
                onValueChange={(v) => setForm({ ...form, employeeId: v })}
                placeholder="Tanpa employee"
                options={unlinkedEmployees.map((e) => ({ value: String(e.id), label: `${e.name}${e.position ? ` — ${e.position}` : ""}` }))}
                disabled={busy || !!editing}
              />
            </Field>
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Roles</p>
              <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border p-2.5">
                {(roles ?? []).map((r) => (
                  <label key={r.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                    <input
                      type="checkbox"
                      checked={form.roleIds.includes(String(r.id))}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          roleIds: e.target.checked ? [...f.roleIds, String(r.id)] : f.roleIds.filter((id) => id !== String(r.id)),
                        }))
                      }
                      className="h-4 w-4 accent-primary"
                      disabled={busy}
                    />
                    <span className="font-medium">{r.name}</span>
                    <span className="text-[10px] text-muted-foreground">{r.permissions.length} permission</span>
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>Batal</Button>
              <SubmitButton busy={busy}>{editing ? "Simpan Perubahan" : "Buat User"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDisable} onOpenChange={(open) => !open && setConfirmDisable(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nonaktifkan user @{confirmDisable?.username}?</AlertDialogTitle>
            <AlertDialogDescription>Sesi aktif user akan dihapus dan akun tidak bisa login. Bisa diaktifkan kembali lewat edit user.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDisable}>Ya, nonaktifkan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

function RolesTab({ can }: { can: { roleCreate: boolean; roleUpdate: boolean } }) {
  const { user } = useAuth();
  const isOwner = !!user?.isOwner;
  const { data, loading, reload } = useApiData<Role[]>(() => apiGet<Role[]>("/roles"), []);
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", description: "", permissionIds: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const modules = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of options?.permissions ?? []) {
      if (!map.has(p.module)) map.set(p.module, []);
      map.get(p.module)!.push({ id: p.id, slug: p.slug, module: p.module, description: p.description ?? "" });
    }
    return Array.from(map.entries());
  }, [options]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const payload = {
      name: form.name,
      slug: form.slug,
      description: form.description || null,
      permissionIds: form.permissionIds.map(Number),
    };
    const ok = await runAction(
      () => (editing ? apiPut(`/roles/${editing.id}`, payload) : apiPost("/roles", payload)),
      { success: editing ? "Role diperbarui." : "Role dibuat." },
    );
    setBusy(false);
    if (ok) {
      setDialogOpen(false);
      reload();
    }
  }

  return (
    <>
      <DataTable
        rows={data ?? []}
        loading={loading}
        emptyMessage="Belum ada role."
        columns={[
          {
            key: "name",
            header: "Role",
            primary: true,
            render: (r) => (
              <div>
                <p className="font-semibold">{r.name}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{r.slug}</p>
              </div>
            ),
          },
          { key: "description", header: "Deskripsi", render: (r) => <span className="text-sm text-muted-foreground">{r.description ?? "—"}</span> },
          { key: "permissions", header: "Permissions", render: (r) => <Badge variant="secondary">{r.permissions.length}</Badge> },
          { key: "users", header: "Users", render: (r) => r._count?.users ?? 0 },
          { key: "type", header: "Tipe", render: (r) => (r.isSystem ? <Badge variant="outline">system</Badge> : <Badge>custom</Badge>) },
          {
            key: "actions",
            header: "Aksi",
            render: (r) => (
              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" className="h-7" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                  <KeyRound className="h-3.5 w-3.5" /> Permissions
                </Button>
                {can.roleUpdate && (!r.isSystem || isOwner) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      setEditing(r);
                      setForm({ name: r.name, slug: r.slug, description: r.description ?? "", permissionIds: r.permissions.map((p) => String(p.permission.id)) });
                      setDialogOpen(true);
                    }}
                    aria-label="Edit role"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      {can.roleCreate && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setEditing(null); setForm({ name: "", slug: "", description: "", permissionIds: [] }); setDialogOpen(true); }}
        >
          <Plus className="h-4 w-4" /> Tambah Role Custom
        </Button>
      )}

      {/* Permission detail */}
      {expanded != null && (
        <div className="rounded-xl border bg-card">
          {rolesPanel(data?.find((r) => r.id === expanded))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Role — ${editing.name}` : "Tambah Role Custom"}</DialogTitle>
            <DialogDescription>
              {editing?.isSystem
                ? "Role sistem: nama & slug terkunci, tapi owner bisa mengubah permission yang dimiliki role ini."
                : "Pilih permission yang dimiliki role. Perubahan berlaku untuk semua user dengan role ini."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Nama Role" htmlFor="r-name">
                <Input id="r-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required disabled={busy || !!editing?.isSystem} />
              </Field>
              <Field label="Slug" htmlFor="r-slug" hint="huruf kecil + tanda hubung">
                <Input id="r-slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required disabled={busy || !!editing?.isSystem} placeholder="supervisor-gudang" />
              </Field>
            </div>
            <Field label="Deskripsi" htmlFor="r-desc">
              <Input id="r-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={busy} />
            </Field>
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Permissions ({form.permissionIds.length} dipilih)</p>
              <div className="max-h-64 space-y-2.5 overflow-y-auto rounded-lg border p-3">
                {modules.map(([moduleName, perms]) => (
                  <div key={moduleName}>
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{moduleName}</p>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {perms.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent">
                          <input
                            type="checkbox"
                            checked={form.permissionIds.includes(String(p.id))}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                permissionIds: e.target.checked ? [...f.permissionIds, String(p.id)] : f.permissionIds.filter((id) => id !== String(p.id)),
                              }))
                            }
                            className="h-3.5 w-3.5 accent-primary"
                            disabled={busy}
                          />
                          <span className="font-mono text-[10px]">{p.slug}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>Batal</Button>
              <SubmitButton busy={busy}>{editing ? "Simpan Perubahan" : "Buat Role"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );

  function rolesPanel(role: Role | undefined) {
    if (!role) return null;
    const byModule = new Map<string, string[]>();
    for (const rp of role.permissions) {
      const p = rp.permission;
      if (!byModule.has(p.module)) byModule.set(p.module, []);
      byModule.get(p.module)!.push(p.slug);
    }
    return (
      <>
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Permissions — {role.name}</p>
        </div>
        <div className="space-y-3 p-4">
          {Array.from(byModule.entries()).map(([moduleName, perms]) => (
            <div key={moduleName}>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{moduleName}</p>
              <div className="flex flex-wrap gap-1.5">
                {perms.map((slug) => (
                  <Badge key={slug} variant="secondary" className="font-mono text-[10px]">{slug}</Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }
}
