import { db } from "@/lib/db";

const ACTIVE_TRANSPORT_STATUSES = ["PLANNED", "DEPARTED"];

export async function findActiveCrewAssignment(employeeId: number, excludeTransportId?: number) {
  return db.transport.findFirst({
    where: {
      status: { in: ACTIVE_TRANSPORT_STATUSES },
      ...(excludeTransportId != null ? { id: { not: excludeTransportId } } : {}),
      OR: [{ driverId: employeeId }, { kenekId: employeeId }],
    },
    select: { id: true, transportCode: true, status: true },
  });
}

export function crewAssignmentMessage(role: "Driver" | "Kenek", transportCode: string): string {
  return `${role} masih ditugaskan pada transport ${transportCode} yang belum selesai.`;
}