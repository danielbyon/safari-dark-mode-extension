---
status: accepted
---

# Native TCA application with a shared Safari web extension

Use a Swift/SwiftUI native containing application on iOS, iPadOS, and macOS, with Point-Free's The Composable Architecture (TCA). Use Apple's StoreKit and iCloud facilities for purchases and optional preference sync. Use a shared Safari Web Extension implemented in TypeScript, HTML, and CSS for browser interaction, rule resolution, and rendering. The owner accepted a versioned preference model and App Groups/native messaging bridge, subject to platform feasibility testing.

## Rationale and boundaries

1. Native application features use TCA for consistent state management, composition, dependency injection, and testing. The browser runtime does not depend on TCA; preserve a narrow versioned contract between the native and web-extension sides.
2. The web-extension renderer executes within Safari's authorized website contexts. The containing app owns native onboarding, persistent configuration UI, and purchase flows. The bridge mediates shared settings and native entitlement evidence, rather than implementing independent purchase validation in JavaScript.
3. Safari separates the app, native extension, and browser scripts into sandboxed components. Content scripts cannot directly send native messages; extension background/UI scripts mediate. iOS containing apps cannot push messages directly into the extension's JavaScript. Validate refresh and propagation across browser/app lifecycle and suspended processes rather than assuming continuous execution.
4. Select and pin commercially compatible dependency versions only after examining API compatibility, licenses, compiler requirements, and transitive dependencies. TCA is required for the Swift app; an exact TCA version, manifest version, store implementation, and OS deployment minimums have not been selected. The capability-based minimum OS policy still applies.
5. The rendering method and engine dependency are separate decisions. Do not assume that the reusable Dark Reader API or any alternate renderer has been adopted merely because the architecture is accepted.

## User-facing responsibilities

The Safari popup handles everyday browsing interactions; the containing app handles comprehensive configuration, onboarding, theme management, and commerce. Both surfaces share the same saved preference semantics rather than creating separate settings systems.

| Function | Safari popup | Native app |
| --- | --- | --- |
| Current website activation | Yes | |
| Pause Everywhere | Yes | Yes |
| Theme selection | Yes | Yes |
| Live webpage appearance adjustments | Yes | |
| Scope selection and saving | Yes | Yes |
| Manage all saved website rules | | Yes |
| Custom theme management | | Yes |
| Global appearance defaults | Yes | Yes |
| Scheduling | | Yes |
| Purchases and restoration | | Yes |
| iCloud configuration | | Yes |
| Appearance problem reporting | Yes | Yes |

The native application provides a representative sample webpage for theme previews using the same rendering component and appearance semantics where technically feasible; label it as a sample, not a guarantee for every website. The sample and configuration management remain available without valid purchase access, while actual website preview is access-gated. Live adjustments to the actual current website occur in the extension. Commerce remains in the native app. The reporting flow uses reviewed support email, not an upload service. Exact UI layout and platform handoff mechanisms remain subject to design and feasibility testing. Specify native rule editing by existing rule, user-entered address or explicit address handoff without assuming the containing app knows Safari's current page. Specify first-run onboarding/skipping, permission recovery, and neutral access-state display separately from Safari extension enablement.

Accepted by the owner in Q53 (2026-11-24) and Q55 and Q62 (2026-11-25).

Sources: [Apple Safari native messaging and app groups](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension); [Point-Free TCA](https://github.com/pointfreeco/swift-composable-architecture) (MIT license).
