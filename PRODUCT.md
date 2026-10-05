# 3D Stall Planner

The planner helps ITPO / Bharat Mandapam event administrators turn imported hall plans into rule-checked stall layouts. Its primary use is operating a layout editor: review the hall, draw planning zones, confirm rules, request stall proposals, make manual changes, then publish a numbered layout for exhibitor viewing.

The current authorized scope is MASTER-PLAN.md WP-1 through WP-7: 1.5–5 m aisles, emergency access, corner keep-out, Media/Admin/Food/Exhibition zones, B2B/B2C separation, guided seven-rule agreement, zone-aware placement with a maximum 70% utilization, multi-selection and pavilion merge, pre-publish review with recorded overrides, and a Hall 12A demo. Phase 2 now adds user-configured price masters, Excel import, explicit layout rate snapshots, and separate EMC charges in server-verified booking quotes. Payments, external SelfCare posting, EMC permissions/approval policies and production deployment remain future work.

This is an extension of the existing Angular 3D planner, not a redesign. Preserve its blue/white controls, existing typography and design tokens, direct task wording, and prominent interactive hall canvas. Desktop uses a sidebar beside the scene; narrow screens stack scrollable controls and the scene. Preview actions remain reviewable before application. The backend is authoritative for persistence and publication.

A subsequent editor refinement adds editable per-zone colours shared by 3D and CAD, polygon-preserving metadata edits, explicit rectangular coordinate edits, visible CAD Fit plan/Pan controls, cached CAD drawing and AI placement performance work. The exhibitor header remains while its duplicate floating Hall card is removed. This remains a narrow refinement of the existing light planner/exhibitor and separate dark CAD surfaces; broader CAD work and the remaining Phase 2 integrations are still outstanding.

Zones in the supplied demo are illustrative planning assignments on the existing imported Hall 12A geometry. Keep source halls separate from saved layout copies. Record draft/published state, assigned stall numbers, and publication exceptions visibly.
