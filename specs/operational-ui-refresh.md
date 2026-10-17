# Operational UI refresh

Apply the Transport masthead to Dashboard (including courier/driver workspaces), Pickups, Shipments, Deliveries, Transport and Return Tasks. Use shared operational headers and task cards so tablet layouts retain full task information and actions. Keep existing table renderers, permissions, filtering, tenant scope and mutation handlers. Redesign shipment detail sections and operational dialogs for narrow screens, with contained scrolling and reachable actions.

Print components, paper dimensions, print styles and print navigation remain unchanged. Do not modify global UI primitives or global CSS, since those also serve print and unrelated menus.

Verify existing operational component suites, new shared-layout coverage, TypeScript and lint. Check print artifacts are unchanged in the final diff.
