"use client";

import { History } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { hasPermission } from "@/lib/client-api";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ItemAuditDialog({
  entityType,
  entityId,
  itemLabel,
}: {
  entityType: string;
  entityId: number;
  itemLabel: string;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!hasPermission(user, "audit_log.view")) return null;

  return (
    <>
      <Button variant="outline" size="sm" className="h-7" onClick={() => setOpen(true)} aria-label={`Lihat log ${itemLabel}`}>
        <History className="h-3.5 w-3.5" /> Log
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Log {itemLabel}</DialogTitle>
            <DialogDescription>Riwayat pembuatan, perubahan, pembaruan, status, dan penghapusan item ini.</DialogDescription>
          </DialogHeader>
          <ActivityLogPanel entityTypes={[entityType]} entityId={entityId} title={`Aktivitas ${itemLabel}`} />
        </DialogContent>
      </Dialog>
    </>
  );
}