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
    employeeDisable: hasPermission(user, "employee.disable"),
    userView: hasPermission(user, "user.view"),
    userCreate: hasPermission(user, "user.create"),
    userUpdate: hasPermission(user, "user.update"),
    userDisable: hasPermission(user, "user.disable"),
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
          {can.userView && <TabsTrigger value="partners">Partners</TabsTrigger>}
          {can.roleView && <TabsTrigger value="roles">Roles</TabsTrigger>}
          {can.employeeView && <TabsTrigger value="employees">Employees</TabsTrigger>}
          <TabsTrigger value="activity">Log Aktivitas</TabsTrigger>
        </TabsList>
        {can.userView && <TabsContent value="users" className="mt-3"><UsersTab can={can} /></TabsContent>}
        {can.userView && <TabsContent value="partners" className="mt-3"><PartnersTab can={can} /></TabsContent>}
        {can.roleView && <TabsContent value="roles" className="mt-3"><RolesTab can={can} /></TabsContent>}
        {can.employeeView && <TabsContent value="employees" className="mt-3"><EmployeesTab can={can} /></TabsContent>}
        <TabsContent value="activity" className="mt-3">
          <ActivityLogPanel entityTypes={["user", "role", "employee", "partner", "auth"]} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Partners
// ---------------------------------------------------------------------------

function PartnersTab({ can }: { can: { userCreate: boolean; userUpdate: boolean; userDisable: boolean } }) {
  const { data, loading, reload } = useApiData<UserAccount[]>(() => apiGet<UserAccount[]>('/users'), []);
  const { data: roles } = useApiData<Role[]>(() => apiGet<Role[]>('/roles'), []);
  // Revise round 10 — load warehouses so we can offer a Gudang dropdown
  // for marketing partner alignment at creation time.
  const { data: options } = useApiData<Options>(() => apiGet<Options>('/options'), []);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editFor, setEditFor] = useState<UserAccount | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<UserAccount | null>(null);
  const [createForm, setCreateForm] = useState({ username: '', name: '', password: '', type: 'MARKETING' as 'MARKETING' | 'VEHICLE_OWNER', warehouseId: 'none' });
  const [editForm, setEditForm] = useState({ name: '', password: '', isActive: true, warehouseId: 'none' });
  const [busy, setBusy] = useState(false);

  const partnerRows = useMemo(() => {
    const q = search.toLowerCase();
    return (data ?? []).filter((u) =>
      u.partnerType && (!q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)),
    );
  }, [data, search]);

  // Revise round 10 — warehouse options for the Gudang selector (shown only
  // when partner type is MARKETING). "none" sentinel = umum / general.
  const warehouseOptions = [
    { value: 'none', label: '— Umum (tidak terikat gudang) —' },
    ...(options?.warehouses ?? []).map((w) => ({ value: String(w.id), label: w.name + (w.city ? ` · ${w.city}` : '') })),
  ];

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const role = roles?.find((r) => r.slug === (createForm.type === 'MARKETING' ? 'marketing' : 'vehicle-owner'));
    if (!role) {
      toast.error('Role partner belum tersedia.');
      return;
    }
    setBusy(true);
    // Revise round 10 — forward warehouseId only when the partner type is
    // MARKETING. For VEHICLE_OWNER the server silently ignores it.
    const payload: Record<string, unknown> = {
      username: createForm.username,
      name: createForm.name,
      password: createForm.password,
      employeeId: null,
      roleIds: [role.id],
    };
    if (createForm.type === 'MARKETING') {
      payload.warehouseId = createForm.warehouseId === 'none' ? null : Number(createForm.warehouseId);
    }
    const ok = await runAction(
      () => apiPost('/users', payload),
      { success: `${createForm.type === 'MARKETING' ? 'Marketing' : 'Vehicle Owner'} dibuat.` },
    );
    setBusy(false);
    if (ok) {
      setDialogOpen(false);
      setCreateForm({ username: '', name: '', password: '', type: 'MARKETING', warehouseId: 'none' });
      reload();
    }
  }

  function openEdit(u: UserAccount) {
    setEditFor(u);
    setEditForm({
      name: u.name,
      password: '',
      isActive: u.isActive,
      // Revise round 10 — pre-fill the gudang alignment from the partner.
      warehouseId: u.partnerWarehouseId != null ? String(u.partnerWarehouseId) : 'none',
    });
  }

  async function onEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editFor?.partnerId) return;
    setBusy(true);
    // For Marketing partners, update name/password via /partners/{id}/profile
    // AND update warehouseId via /users/{id} (which forwards to
    // ensurePartnerProfile). For Vehicle Owner, just update profile.
    const profilePayload: Record<string, unknown> = { name: editForm.name, isActive: editForm.isActive };
    if (editForm.password) profilePayload.password = editForm.password;
    let ok = true;
    if (editFor.partnerType === 'MARKETING') {
      // Update the gudang alignment via PUT /users/{id} — that's where
      // ensurePartnerProfile lives and where warehouseId is honored.
      const warehousePayload = editForm.warehouseId === 'none' ? null : Number(editForm.warehouseId);
      ok = await runAction(
        () => apiPut(`/users/${editFor.id}`, { warehouseId: warehousePayload }),
        { success: 'Gudang alignment diperbarui.' },
      );
      if (!ok) { setBusy(false); return; }
    }
    ok = await runAction(
      () => apiPut(`/partners/${editFor.partnerId}/profile`, profilePayload),
      { success: 'Profil partner diperbarui.' },
    );
    setBusy(false);
    if (ok) {
      setEditFor(null);
      reload();
    }
  }

  async function onDisable() {
    if (!confirmDisable?.partnerId) return;
    const target = confirmDisable;
    setConfirmDisable(null);
    const ok = await runAction(
      () => apiDelete(`/partners/${target.partnerId}/profile`),
      { success: `Partner @${target.username} dinonaktifkan.` },
    );
    if (ok) reload();
  }

  return (
    <>
      <DataTable
        rows={partnerRows}
        loading={loading}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Cari nama / username…"
        toolbar={can.userCreate && (
          <Button size="sm" onClick={() => setDialogOpen(true)}><UserPlus className="h-4 w-4" /> Tambah Partner</Button>
        )}
        emptyMessage="Belum ada partner."
        columns={[
          { key: 'username', header: 'Username', primary: true, render: (u) => <span className="font-mono text-xs font-semibold">@{u.username}</span> },
          { key: 'name', header: 'Nama', render: (u) => <span className="font-medium">{u.name}</span> },
          { key: 'type', header: 'Tipe', render: (u) => <Badge variant={u.partnerType === 'MARKETING' ? 'secondary' : 'outline'}>{u.partnerType === 'MARKETING' ? 'Marketing' : 'Vehicle Owner'}</Badge> },
          // Revise round 10 — show the marketing partner's gudang alignment
          // (or "Umum" badge) in the table.
          {
            key: 'gudang',
            header: 'Gudang',
            render: (u) =>
              u.partnerType === 'MARKETING' ? (
                u.partnerWarehouseName ? (
                  <Badge variant="outline" className="bg-chart-2/10 text-chart-2">{u.partnerWarehouseName}</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">Umum</span>
                )
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              ),
          },
          { key: 'status', header: 'Status', render: (u) => <ActiveBadge active={u.isActive} /> },
          ...(can.userUpdate || can.userDisable
            ? [{
                key: 'actions',
                header: 'Aksi',
                render: (u: UserAccount) => (
                  <div className="flex gap-1.5">
                    {can.userUpdate && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)} aria-label="Edit partner">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {can.userDisable && !u.isOwner && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setConfirmDisable(u)} aria-label="Nonaktifkan partner">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ),
              }]
            : []),
        ]}
      />

      {/* Create partner dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah Partner</DialogTitle>
            <DialogDescription>Partner (Marketing / Vehicle Owner) dibuat tanpa data employee dan langsung memiliki wallet.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreate} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Username" htmlFor="p-username"><Input id="p-username" value={createForm.username} onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })} required disabled={busy} autoComplete="off" /></Field>
              <Field label="Nama" htmlFor="p-name"><Input id="p-name" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} required disabled={busy} /></Field>
            </div>
            <Field label="Tipe Partner" htmlFor="p-type">
              <FormSelect value={createForm.type} onValueChange={(v) => setCreateForm({ ...createForm, type: v as 'MARKETING' | 'VEHICLE_OWNER' })} options={[{ value: 'MARKETING', label: 'Marketing' }, { value: 'VEHICLE_OWNER', label: 'Vehicle Owner' }]} disabled={busy} />
            </Field>
            {/* Revise round 10 — Gudang selector shown only for MARKETING partners.
                When not selected (Umum), customers they create will need a
                manual gudang pick. When aligned to a gudang, customers they
                create auto-inherit that gudang. */}
            {createForm.type === 'MARKETING' && (
              <Field
                label="Gudang (afiliasi marketing)"
                htmlFor="p-warehouse"
                hint="Pilih gudang jika marketing ini khusus melayani satu gudang. 'Umum' = melayani semua gudang."
              >
                <FormSelect
                  value={createForm.warehouseId}
                  onValueChange={(v) => setCreateForm({ ...createForm, warehouseId: v })}
                  options={warehouseOptions}
                  disabled={busy}
                />
              </Field>
            )}
            <Field label="Password (min. 8 karakter)" htmlFor="p-password"><Input id="p-password" type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} required minLength={8} disabled={busy} autoComplete="new-password" /></Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>Batal</Button>
              <SubmitButton busy={busy}>Buat Partner</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit partner profile dialog */}
      <Dialog open={!!editFor} onOpenChange={(open) => !open && setEditFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Partner — @{editFor?.username}</DialogTitle>
            <DialogDescription>
              Ubah nama atau password partner. Kosongkan password jika tidak ingin mengganti.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onEdit} className="space-y-4">
            <Field label="Nama" htmlFor="ep-name">
              <Input id="ep-name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required disabled={busy} />
            </Field>
            <Field label="Password baru (opsional, min. 8 karakter)" htmlFor="ep-password">
              <Input id="ep-password" type="password" value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} disabled={busy} minLength={8} autoComplete="new-password" placeholder="••••••••" />
            </Field>
            {/* Revise round 10 — Gudang selector for marketing partners (edit). */}
            {editFor?.partnerType === 'MARKETING' && (
              <Field
                label="Gudang (afiliasi marketing)"
                htmlFor="ep-warehouse"
                hint="Pilih gudang untuk auto-assign ke customer yang dibuat marketing ini. 'Umum' = manual per customer."
              >
                <FormSelect
                  value={editForm.warehouseId}
                  onValueChange={(v) => setEditForm({ ...editForm, warehouseId: v })}
                  options={warehouseOptions}
                  disabled={busy}
                />
              </Field>
            )}
            <label className="flex items-center gap-2.5 rounded-lg border p-2.5 text-sm">
              <input type="checkbox" checked={editForm.isActive} onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })} className="h-4 w-4 accent-primary" disabled={busy} />
              <span>Akun aktif (login diizinkan)</span>
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditFor(null)} disabled={busy}>Batal</Button>
              <SubmitButton busy={busy}>Simpan Perubahan</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Disable confirm */}
      <AlertDialog open={!!confirmDisable} onOpenChange={(open) => !open && setConfirmDisable(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nonaktifkan partner @{confirmDisable?.username}?</AlertDialogTitle>
            <AlertDialogDescription>
              Sesi aktif partner akan dihapus dan akun tidak bisa login. Profil partner & wallet tetap utuh untuk data historis. Bisa diaktifkan kembali lewat edit partner.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDisable}>Ya, nonaktifkan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ActivityLogPanel entityTypes={["partner"]} title="Log Aktivitas Partner" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

function EmployeesTab({ can }: { can: { employeeCreate: boolean; employeeUpdate: boolean; employeeDisable: boolean } }) {
  const { data, loading, reload } = useApiData<Employee[]>(() => apiGet<Employee[]>("/employees"), []);
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<Employee | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", position: "", warehouseId: "" });
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter((e) => {
      const isPartner = e.user?.roles.some((r) => r.role.slug === "marketing" || r.role.slug === "vehicle-owner");
      return !isPartner && (!q || e.name.toLowerCase().includes(q) || e.employeeNumber.toLowerCase().includes(q) || (e.position ?? "").toLowerCase().includes(q));
    });
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

  async function onDisable() {
    if (!confirmDisable) return;
    const target = confirmDisable;
    setConfirmDisable(null);
    const ok = await runAction(
      () => apiDelete(`/employees/${target.id}`),
      { success: `Employee ${target.name} dinonaktifkan.` },
    );
    if (ok) reload();
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
          ...(can.employeeUpdate || can.employeeDisable
            ? [
                {
                  key: "actions",
                  header: "Aksi",
                  render: (e: Employee) => (
                    <div className="flex gap-1.5">
                      {can.employeeUpdate && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditing(e); setForm({ name: e.name, phone: e.phone ?? "", position: e.position ?? "", warehouseId: e.warehouseId != null ? String(e.warehouseId) : "" }); setDialogOpen(true); }} aria-label="Edit employee">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {can.employeeDisable && e.isActive && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setConfirmDisable(e)} aria-label="Nonaktifkan employee">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
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
            <DialogTitle>{editing ? `Edit Employee — ${editing.employeeNumber}` : "Tambah Employee"}</DialogTitle>
            <DialogDescription>{editing ? "Perbarui data employee." : "Nomor employee (EMP-xxxxxx) dibuat otomatis."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Nama" htmlFor="e-name">
              <Input id="e-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required disabled={busy} />
            </Field>
            <Field
              label="Gudang Penempatan"
              htmlFor="e-warehouse"
              hint="Semua data operasional karyawan dibatasi ke gudang ini. Pilih 'Umum' untuk driver / kenek (mereka tidak terikat ke satu gudang — bisa di-assign ke transport rute mana saja)."
            >
              <FormSelect
                value={form.warehouseId || "none"}
                onValueChange={(v) => setForm({ ...form, warehouseId: v === "none" ? "" : v })}
                placeholder="Pilih gudang…"
                options={[
                  // Driver / Kenek (and any other role that doesn't need a
                  // gudang binding) can be left unaffiliated. The 'none'
                  // sentinel maps to warehouseId = null server-side.
                  { value: "none", label: "— Umum (tidak terikat gudang) —" },
                  ...(options?.warehouses ?? []).map((w) => ({ value: String(w.id), label: w.name + (w.city ? ` · ${w.city}` : "") })),
                ]}
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

      <AlertDialog open={!!confirmDisable} onOpenChange={(open) => !open && setConfirmDisable(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nonaktifkan employee {confirmDisable?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Employee akan dinonaktifkan. Jika memiliki akun user terhubung, akun tersebut juga dinonaktifkan dan sesi aktifnya dihapus. Data historis tetap utuh.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDisable}>Ya, nonaktifkan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ActivityLogPanel entityTypes={["employee"]} title="Log Aktivitas Employee" />
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
    return data.filter((u) => !u.partnerType && (!q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)));
  }, [data, search]);

  const employeeRoleOptions = (roles ?? []).filter((r) => r.slug !== "marketing" && r.slug !== "vehicle-owner");
  // Step 3 — Only employees that don't already have a user account linked
  // are eligible to be picked when creating a new user. Once linked the
  // employee disappears from this list (so the same employee can't get a
  // second account). Inactive employees are also hidden.
  const unlinkedEmployees = (employees ?? []).filter((e) => !e.user && e.isActive);

  /** Step 3 — Suggest a username from a full name: take the first word,
   *  strip diacritics, lowercase, keep only [a-z0-9._-]. "Joko Widodo" →
   *  "joko"; "Siti Rahma" → "siti"; "Adit Nugroho" → "adit". Returns an
   *  empty string when the input has no usable ASCII characters. */
  function suggestUsername(fullName: string): string {
    const firstWord = fullName.trim().split(/\s+/)[0] ?? "";
    if (!firstWord) return "";
    // NFKD normalize then drop combining marks (so "Siti" stays "Siti",
    // but "José" becomes "Jose")
    const ascii = firstWord
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const cleaned = ascii.replace(/[^a-z0-9._-]/g, "");
    return cleaned;
  }

  /** Step 3 — When the user picks an employee in the create dialog, auto-
   *  fill the Name and Username fields from the employee record. The user
   *  can still retype either field if the suggestion isn't good (e.g.
   *  name has typos, username collides with an existing user). The
   *  employeeId stays pinned — the new user MUST be linked to an employee
   *  record (the user's request: "users absolutely have relation to
   *  employee table"). */
  function onPickEmployee(employeeId: string) {
    if (editing) {
      // Editing an existing user — don't allow changing the link.
      return;
    }
    const emp = unlinkedEmployees.find((e) => String(e.id) === employeeId);
    if (!emp) {
      setForm((f) => ({ ...f, employeeId, username: "", name: "" }));
      return;
    }
    const suggestedUsername = suggestUsername(emp.name);
    setForm((f) => ({ ...f, employeeId, name: emp.name, username: suggestedUsername }));
  }

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
            <DialogDescription>{editing ? "Kosongkan password jika tidak ingin mengganti." : "Pilih employee yang belum punya akun — nama & username terisi otomatis, masih bisa diubah."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            {/* Step 3 — Employee select moved to the TOP and made REQUIRED
                for new users. The user's request: "users absolutely have
                relation to employee table". When the user picks an employee,
                the Name + Username fields below auto-fill from the employee
                record (still editable in case the name has a typo or the
                suggested username collides with an existing user). When
                editing an existing user, the select is disabled (you
                can't re-link a user to a different employee). */}
            <Field
              label="Employee"
              htmlFor="u-employee"
              hint={editing
                ? "Tautan employee tidak bisa diganti."
                : "Wajib — pilih employee yang belum punya akun. Nama & username akan terisi otomatis dari data employee."}
            >
              <FormSelect
                value={form.employeeId}
                onValueChange={(v) => onPickEmployee(v)}
                placeholder={editing ? (form.employeeId ? "—" : "Tanpa employee") : "Pilih employee…"}
                options={unlinkedEmployees.map((e) => ({
                  value: String(e.id),
                  label: `${e.name}${e.position ? ` — ${e.position}` : ""}${e.warehouse ? ` (${e.warehouse.name})` : ""}`,
                }))}
                disabled={busy || !!editing}
                required={!editing}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Username" htmlFor="u-username" hint={!editing ? "Auto dari nama depan employee — edit jika perlu" : undefined}>
                <Input id="u-username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required disabled={busy || !!editing} autoComplete="off" />
              </Field>
              <Field label="Nama" htmlFor="u-name" hint={!editing ? "Auto dari employee — edit jika perlu" : undefined}>
                <Input id="u-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required disabled={busy} />
              </Field>
            </div>
            <Field label={editing ? "Password baru (opsional)" : "Password (min. 8 karakter)"} htmlFor="u-password">
              <Input id="u-password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editing} disabled={busy} minLength={8} autoComplete="new-password" />
            </Field>
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Roles</p>
              <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border p-2.5">
                {employeeRoleOptions.map((r) => (
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

      <ActivityLogPanel entityTypes={["user"]} title="Log Aktivitas User" />
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
  const [form, setForm] = useState({ name: "", description: "", permissionIds: [] as string[] });
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
                      setForm({ name: r.name, description: r.description ?? "", permissionIds: r.permissions.map((p) => String(p.permission.id)) });
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
          onClick={() => { setEditing(null); setForm({ name: "", description: "", permissionIds: [] }); setDialogOpen(true); }}
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
