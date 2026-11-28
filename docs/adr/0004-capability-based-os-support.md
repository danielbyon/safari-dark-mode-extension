---
status: accepted
---

# OS support follows required capabilities

Support the oldest major iOS, iPadOS, and macOS versions that can meet the agreed product requirements using the APIs the product needs. The owner replaced the provisional iOS/iPadOS 18 and macOS 15 minimums with this capability-based policy so support is determined by actual requirements rather than an arbitrary recent-version cutoff.

## Consequences

1. Exact platform minimums remain unset until mandatory feature, API, and rendering-engine requirements are assessed.
2. Evaluate platforms independently and validate actual Safari behavior on the resulting minimum versions; API availability alone does not establish rendering quality.
3. Optional platform conveniences may use availability checks and appear only where supported. Their use does not by itself make them mandatory core requirements or raise the core OS floor.
4. Custom time schedules are in the first release. Apple Shortcuts integration remains in product scope but is deferred to v2 and must not raise the v1 minimum OS requirement. Schedule is a fourth device-local default activation mode, available in settings after the three-choice onboarding. Support an on-time, off-time, selected weekdays, windows that cross midnight, and the device's current local time zone. Site activation overrides continue to take precedence over the scheduled default. Include macOS keyboard shortcuts for temporary current-tab darkening and Pause Everywhere/resume. The tab shortcut does not write a site rule (ADR 0002). Include standalone Safari Add to Dock web apps on macOS where the required extension APIs are supported; do not raise the ordinary Safari browsing minimum for this capability. Additional native conveniences remain open.
5. This policy does not authorize silently dropping an agreed mandatory requirement to support an older OS.
6. Schedule weekdays identify the start day of an overnight window (Friday 22:00–Saturday 07:00 is a Friday window). The start boundary is inclusive; end is exclusive. The UI must prevent choosing equal start/end times, not merely accept them and report a validation error; invalid stored inputs must not be interpreted as zero or 24 hours. Evaluate current local wall time, including skipped/repeated daylight-saving hours, and recompute on time-zone change, clock change, or resume instead of replaying missed transitions. Qualify concrete boundary scenarios.
7. macOS shortcuts are scoped to Safari and supported standalone Safari web apps where the platform permits; they are not system-wide shortcuts. Investigate supported binding customization/conflict handling in T2. The Pause Everywhere and tab-override lifetimes are defined in ADR 0002.
8. Screen candidate engine, extension APIs, TCA/compiler and storage constraints early in T1a/T2/T3 rather than waiting until T7. T7 still determines the final evidence-backed platform minimums.

Accepted by the owner's OS-support clarification and Q26, Q35, Q37, and Q39-Q40 on 2026-11-23, superseding the numerical proposal in Q7; refined in Q73 on 2026-11-28.
