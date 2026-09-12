"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type Customer } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { ActiveBadge, TypeBadge } from "@/components/app/status-badge";
import { Field, FormSelect, Input, SubmitButton, Textarea } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CustomerForm {
  name: string;
  type: "b2b" | "b2c";
  companyName: string;
  phone: string;
  email: string;
  address: string;
}

const EMPTY: CustomerForm = { name: "", type: "b2c", companyName: "", phone: "", email: "", address: "" };

export function CustomersPage() {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "customer.view"),
    create: hasPermission(user, "customer.create"),
    update: hasPermission(user, "customer.update"),
    delete: hasPermission(user, "customer.delete"),
  };

  const { data, loading, reload } = useApiData<Customer[]>(() => apiGet<Customer[]>("/customers"), []);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<Customer | null>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (c.companyName ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q),
    );
  }, [data, search]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setFieldErrors({});
    setDialogOpen(true);
  }

  function openEdit(c: Customer) {
    setEditing(c);
    setForm({
      name: c.name,
      type: c.type,
      companyName: c.companyName ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      address: c.address ?? "",
    });
    setFieldErrors({});
    setDialogOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFieldErrors({});
    const payload = {
      ...form,
      companyName: form.type === "b2b" ? form.companyName || null : null,
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
    };
    const ok = await runAction(
      () => (editing ? apiPut(`/customers/${editing.id}`, payload) : apiPost("/customers", payload)),
      {
        success: editing ? "Customer diperbarui." : "Customer dibuat.",
        onError: (message) => {
          if (message.includes("wajib")) setFieldErrors({ name: message });
        },
      },
    );
    setBusy(false);
    if (ok) {
      setDialogOpen(false);
      reload();
    }
  }

  async function onDelete() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    const ok = await runAction(() => apiDelete(`/customers/${target.id}`), {
      success: target.isActive ? "Customer diproses." : "Customer dihapus.",
    });
    if (ok) reload();
  }

  if (!can.view) {
    return <PageHeader title="Customers" subtitle="Anda tidak memiliki izin melihat customer." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        subtitle="Master data pelanggan B2B dan B2C."
        icon={<Users className="h-5 w-5" />}
        actions={
          can.create && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Tambah Customer
            </Button>
          )
        }
      />

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Daftar</TabsTrigger>
          <TabsTrigger value="activity">Log Aktivitas</TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="mt-3">
          <DataTable
            rows={rows}
            loading={loading}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Cari nama / kode / telp…"
            emptyMessage="Belum ada customer. Klik “Tambah Customer” untuk membuat."
            columns={[
              { key: "code", header: "Kode", primary: true, render: (c) => <span className="font-mono text-xs">{c.code}</span> },
              {
                key: "name",
                header: "Nama",
                render: (c) => (
                  <div>
                    <p className="font-medium text-foreground">{c.name}</p>
                    {c.companyName && <p className="text-xs text-muted-foreground">{c.companyName}</p>}
                  </div>
                ),
              },
              { key: "type", header: "Tipe", render: (c) => <TypeBadge type={c.type} /> },
              { key: "phone", header: "Telepon", hideOnMobile: true, render: (c) => c.phone ?? "—" },
              { key: "email", header: "Email", hideOnMobile: true, render: (c) => c.email ?? "—" },
              { key: "status", header: "Status", render: (c) => <ActiveBadge active={c.isActive} /> },
              ...(can.update || can.delete
                ? [
                    {
                      key: "actions",
                      header: "Aksi",
                      render: (c: Customer) => (
                        <div className="flex gap-1.5">
                          {can.update && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)} aria-label={`Edit ${c.name}`}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {can.delete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setConfirmDelete(c)}
                              aria-label={`Hapus ${c.name}`}
                            >
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
        </TabsContent>
        <TabsContent value="activity" className="mt-3">
          <ActivityLogPanel entityTypes={["customer"]} />
        </TabsContent>
      </Tabs>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Customer — ${editing.code}` : "Tambah Customer"}</DialogTitle>
            <DialogDescription>
              {editing ? "Perbarui data customer." : "Customer baru akan mendapat kode otomatis (CUS-xxxxxx)."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nama" htmlFor="c-name" error={fieldErrors.name} className="sm:col-span-2">
                <Input id="c-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nama lengkap / PIC" required disabled={busy} />
              </Field>
              <Field label="Tipe Customer" htmlFor="c-type">
                <FormSelect
                  value={form.type}
                  onValueChange={(value) => setForm({ ...form, type: value as "b2b" | "b2c" })}
                  options={[{ value: "b2c", label: "B2C — individu" }, { value: "b2b", label: "B2B — perusahaan" }]}
                  disabled={busy}
                />
              </Field>
              {form.type === "b2b" && (
                <Field label="Nama Perusahaan" htmlFor="c-company">
                  <Input id="c-company" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="PT / CV" disabled={busy} />
                </Field>
              )}
              <Field label="Telepon" htmlFor="c-phone">
                <Input id="c-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" disabled={busy} />
              </Field>
              <Field label="Email" htmlFor="c-email">
                <Input id="c-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nama@email.com" disabled={busy} />
              </Field>
              <Field label="Alamat" htmlFor="c-address" className="sm:col-span-2">
                <Textarea id="c-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} placeholder="Alamat pengirim / penerima" disabled={busy} />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>{editing ? "Simpan Perubahan" : "Buat Customer"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus customer {confirmDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Customer yang sudah memiliki shipment akan dinonaktifkan (history pengiriman tetap aman). Tindakan ini tercatat di log audit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              Ya, hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
