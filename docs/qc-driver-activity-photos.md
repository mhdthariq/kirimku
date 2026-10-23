# Driver activity photos

The ACTIVITY arrival dialog previously submitted an empty body and could close the journey without arrival evidence. Arrival now requires a live camera capture with fresh GPS. Shared server validation rejects missing, stale or malformed evidence. The arrival transaction writes the evidence and updates lifecycle together, retaining the lifecycle concurrency check and warehouse receipt workflow.

The camera can switch between environment and user facing modes. It releases the old stream before requesting a replacement and provides a retry after a camera error. Owner access already bypasses proof_photo.view checks; authorized users now have a full-size activity photo viewer.

Automated checks cover capture/GPS, camera switching and cleanup, arrival validation and concurrent lifecycle rejection, owner API reads, photo viewer callbacks, and lifecycle UI behavior. Physical phone camera selection and permission prompts still need device verification.

Manual checks:
- On a phone with two cameras, capture activity using each camera; deny and then re-enable camera/GPS access and retry.
- For a departed ACTIVITY transport, choose Tandai Tiba, capture a photo, retake, and submit. Confirm the photo and GPS remain visible after arrival.
- As Owner, open Lihat Foto Aktivitas and confirm the full-size image opens.
- Confirm arrival still waits for audit and standard shipments still require warehouse receipt scanning.

## Owner undo arrival

Owner can choose **Batalkan Tiba** in transport detail while status is ARRIVED. The API independently requires `isOwner`; wildcard permission alone does not grant this action. Confirmation restores the stored PLANNED/DEPARTED status, clears arrivedAt, synchronizes the status of an associated return task, and records an audit event. COMPLETED and other statuses cannot use this action. Evidence and shipment/drop/warehouse receipt records remain intact; this action reopens only the transport lifecycle.

Apply migration `20261023010000_transport_undo_arrival` before running this version. New manual and automatic checkpoint arrivals save the previous status. Legacy arrivals use departedAt, with DEPARTED for ACTIVITY (which already required departure). Existing checkpoint arrivals without departedAt use PLANNED.

Regression tests cover owner-only access, both saved previous statuses, legacy fallback, invalid lifecycle, missing transport, concurrent change, and the owner confirmation flow.

Deployment verified on 23 October 2026: migration 20261023010000_transport_undo_arrival and vehicle photo storage are applied to rajawalilogistik; Prisma reports all 21 migrations applied and schema up to date. See review-changes-2026-10-23.md for recovery of the earlier migration-history mismatch.
