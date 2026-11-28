# Safari capability qualification

These cases measure the behaviors specified in the [feasibility plan](technical-feasibility.md), [candidate audit](rendering-candidate-audit.md) and [comparison protocol](rendering-comparison-protocol.md). Build the probe and start its fixtures with the [operator instructions](../../Probes/SafariCapabilities/README.md). Run the marker first and repeat candidate-sensitive cases with the audited library. Record one observation per variant, environment and condition.

## 1. Evidence by platform

`NOT_RUN` means no qualifying observation exists for the stated combination. `LIMITED` requires a demonstrated restriction, `UNAVAILABLE` a verified missing capability, and `SUPPORTED` a successful run with its controls. A failed prerequisite makes a dependent observation inconclusive. A package build proves packaging. Deterministic tests prove behavior for the supplied inputs. Neither establishes how Safari dispatches events or enforces a user's grants.

| Environment | Current evidence | Scope |
|---|---|---|
| macOS 27.2.1, shipping Safari 27.2 | MV2 and MV3 loaded in a disposable profile. Both calibrated the top grant, injected on reload, applied the marker and received an ordinary pre-import reply. Both reported a candidate import failure. | [Mac run and package digests](../evidence/safari-capabilities/mac-safari-27.2/observations.jsonl). The [earlier extension-off reference](../evidence/safari-capabilities/mac-fixture-reference/observations.jsonl) used a development fixture. |
| iPhone Simulator Safari | NOT_RUN | Build evidence applies only to the wrapper. |
| iPad Simulator Safari | NOT_RUN | Build evidence applies only to the wrapper. |
| Physical iPhone Safari | NOT_RUN | No device, installation or provisioning authorization. |
| Physical iPad Safari | NOT_RUN | No device, installation or provisioning authorization. |
| Private Browsing and Mac Dock web app | NOT_RUN | Require separate configuration authorization. |

## 2. Browser scenarios

Use a fresh authorized document for each positive control. Repeat with the extension disabled and with the relevant gate denied. Use a second independent fixture tab for tab-isolation cases. Across all rows, an unlisted platform or variant observation is `NOT_RUN`. Run on Mac, iPhone and iPad unless a narrower platform is named.

| Case | Procedure and controls | What determines the result |
|---|---|---|
| 1. Manifest and first injection | Cold launch and warm-load the fixture under MV2 and MV3. Compare the document-start observation with the website's first script, first visible content and a later ready-state signal. | Capture order, document readiness and a recording if claiming paint timing. Lack of a common timebase limits the timing result. |
| 2. Execution world, CSP and messaging | Run a normal and strict-CSP page. Send an ordinary request from the same world before importing the candidate, after import and after disable. | Record return kind, receiver count and payload arrival. Check isolated globals and whether candidate styles and page functionality survive. |
| 3. Background and popup | Record the instance token, open/dismiss the editor, close the inspector, idle, then wake by navigation, runtime message and command. | A changed instance plus rebuilt state supports wakeup. Time spent idle alone cannot establish suspension. |
| 4. Independent frame grants | Visit a nested frame tree with a conflicting embedded-host rule. Change one grant at a time, navigate the innermost frame, then visit the embedded host top-level. Include native-dark and top-level Off controls. | Inspect each frame's actual appearance, original controls and grant. An authorized embedded frame follows the top-level decision and its own native-dark check. An inaccessible frame retains site behavior. |
| 5. Stylesheet grant pair | On a controlled, guard-accepted HTTPS origin, first prove the original sheet applies while page fetch and CSSOM cannot read it. In two fresh documents change only the resource grant. Compare same-origin, CORS-readable and guard-rejected loopback sheets. | Both grant-pair runs must reach the hook. Allow must transform the distinctive rule. Deny must reject before a privileged request while the site sheet still works. A guard refusal, loader refusal and Safari transport refusal have different evidence. |
| 6. Nested and delayed resources | Run nested imports, redirects to granted and ungranted destinations, an error response and a held stylesheet. Revoke during transfer, then release. | Attribute website and extension requests separately. Check destination request count, grant at each hook, bytes released, stale response status and original site style. A previously received request cannot be undone. |
| 7. Eligibility and fix | Cross authorization, synthetic access (valid, inactive, unknown, refreshing with/without valid prior evidence), pause, preview, tab override, saved activation, website dark and Use My Theme. | Compare source reason, actual style, fix on the designated broken element and saved revision. Only explicit eligible preview bypasses ordinary activation and preservation. Use My Theme alone cannot activate saved Off. |
| 8. Native-dark transitions | With a dark hero on a light page, enable marker then candidate in adaptive and palette configurations. Trigger three reevaluations, then switch the site's CSS independently dark and back. Repeat initially dark and CSS-only cases. | Compare the independent site oracle, renderer transitions and detector source. Report unreadable/ambiguous site CSS separately. Site-controlled root colors and actual settled appearance must agree after restoration. |
| 9. Teardown and site ownership | Change theme metadata, enter synthetic text and focus a control. Include the WP Dark Mode marker case. Disable, then reactivate the site theme in the same document. Compare the same actions with the extension off. | Record any overwritten metadata, lost input, suppressed site marker or observer still changing the site after disable. |
| 10. Scoped preview | Edit a broader scope below a narrower override, preview removal at its owning scope, change editing scope, and change saved configuration during preview. | Expect inherited values to resolve per field and discard to reveal the latest saved revision. A draft cannot persist a rule. |
| 11. Navigation | Exercise dismissal, same-URL reload, new document, same-/cross-host path, query, fragment, anchor, SPA push/replace and back/forward. Schedule a website action before opening the popup to isolate navigation from dismissal. Use a same-URL history entry and a DOM-only mutation as controls. | Each observed top-level URL change or new document discards the draft. DOM-only changes retain it. Record actual event source and resulting appearance. |
| 12. Pending work and supersession | Hold an operation across pause, access loss, preview disposal, saved Off, top/frame revocation, navigation or newer eligible appearance. Include an unaffected second tab. Run an unchanged-decision positive control. Repeat before hook completion and after release to the library. | Record attempted abort, transfer outcome, stale response rejection and later candidate-owned sheet/DOM writes independently. If the library's internal pending phase cannot be established, that phase stays unqualified. |
| 13. Disable/revocation recovery | Disable the renderer, disable the Safari extension, and revoke a fixture grant in separate runs. Capture the current site state, then reload while still denied/disabled if necessary. | Record the shortest observed recovery, resulting site functionality and any loss of unsaved input. A reload remains a proposed recovery until tested. |
| 14. Temporary activation and pause | Override an opposing saved rule. Reload, navigate and traverse history on one host, suspend/wake, leave and return, explicitly restore, duplicate, close/reopen and restore a session. Separately restart the containing app and browser while paused, then resume. | Compare tab, background instance, visible reason and saved revision. Only the original live tab retains its override on the same host. Pause must survive supported restarts. A temporary Safari installation disappears on quit and cannot prove browser-restart persistence. |
| 15. Private Browsing | Seed a saved setting in normal browsing. In an authorized test profile vary private enablement and site permission independently; visit a new fixture path and discard an edit. Compare persistent keys/rules before, after and after relaunch. | Existing saved values must apply with both grants. The visit and draft must leave no durable rule or URL trail. Deliberate future saves require prior explanation of persistence and optional sync under [ADR 0003](../adr/0003-local-rendering-and-preference-sync.md). |
| 16. System appearance and scheduling | Toggle system appearance with Follow System and with a site override. Use Friday 22:00–Saturday 07:00, just before/at/after both boundaries, a nonselected start day and an equal-time attempt. Test both Los Angeles clock transitions, clock/zone changes and resume across missed boundaries. | Compare the actual refresh with a fresh current-wall-time evaluation; record the wake or notification source. Native notification delivery remains an integration question. |
| 17. Mac keyboard commands | Run tab toggle and pause/resume in Safari, a supported Dock app and with an unrelated app frontmost. Exercise an available binding, supported customization and a conflict. | Record actual dispatch, conflict feedback, app scope and rule preservation. |
| 18. Add to Dock | On a supported Mac, enable the extension in a fixture Dock app, inspect its actual website grants and repeat injection, popup, appearance and restoration. | Record the web-app version/context separately. A tab result does not qualify a web app. |

### Observed Mac controls

1. Both manifests reported the top host denied while the control host remained granted. After Allow, both passed calibration. The resource role followed the top host across ports, so the loopback run could not isolate a resource-only grant. Fresh top documents reported injection at `loading`. Injection into an existing document also occurred at `complete`. First-paint ordering remains open.
2. MV3 reported active, paused, active, preview and active at saved revision 2. Its marker sampled a 3 px outline on the fixture control. MV2 applied the marker, but one popup rejected preview and discard with `open-editor-on-fixture`. The MV2 preview result is inconclusive. After top-host revocation and reload, the fixture’s check button still advanced its counter. Immediate style removal on the live page remains unverified.
3. On both manifests the ordinary and strict-CSP light documents recorded a promise, one receiver, an echoed reply and then `candidate-import-failed`. Neither reached the after-import message. Fresh native-dark documents produced the preservation decision. The captured failure does not distinguish module loading from UMD registration. The next candidate experiment needs to distinguish those two steps before testing rendering, resource reads or teardown. [Sanitized traces](../evidence/safari-capabilities/mac-safari-27.2/observations.jsonl)

For the top role, the first Deny sample has `observed: false` and `qualified: false`. The API agreed with Deny. Qualification stayed false until the same instance also saw Allow. The subsequent sample has `observed: true` and `qualified: true` on both manifests. The fixture role named `denied` shares the allowed control host in this run.

| Capture | Fixture | Pre-import echoed reply sequence | Import failure sequence |
|---|---|---:|---:|
| MV2, manifest-comparison | Ordinary light | 95 | 96 |
| MV2, manifest-comparison | Strict-CSP light | 105 | 106 |
| MV3, candidate-repeat | Ordinary light | 69 | 70 |
| MV3, candidate-repeat | Strict-CSP light | 49 | 50 |

The browser record pins the exact unpacked files used on the Mac. At `61d6a04` the markup and popup export guard had changed, while the manifest, background, content and audited library still matched the run. The subsequent loader and race corrections have separate package receipts.

MV2 ordinary marker samples 53–54 and 88–89 recorded swatch foreground `rgb(224, 244, 255)`. The strict marker sample at 66–67 retained the original light-page foreground `rgb(24, 35, 50)`. Swatch backgrounds were transparent. The old marker event recorded insertion. Those captures lack a matched strict extension-off root sample and a before/after root color pair. They establish neither that the strict marker CSS applied nor which restriction caused the difference. The variants also shared a temporary installation slot. Use the [matched controls and independent-install procedure](../../Probes/SafariCapabilities/mac-loading-controls.md) before attributing a difference to CSP or manifest version.

The corrected probe measures the two authorization races in deterministic tests. The offline manifest comparison reached public enable and disable and measured all three messaging phases with the audited UMD. The corresponding shipping Safari results for the new packages are `NOT_RUN`. The instrumented loader, paired marker controls and scoped fixture exports are available for subsequent work once their platform controls pass.

## 3. Preliminary OS boundaries

| Platform | Documented boundary for screening | Oldest observed working OS |
|---|---|---|
| macOS Safari tabs | Safari 14 web-extension surface; Safari 15.4 MV3; Safari 16.4 session storage and constructible sheets. Match the Safari build to the actual macOS version. | Undetermined |
| iOS Safari | iOS/Safari 15 web-extension surface. Screen the 15.4 and 16.4 capabilities independently. | Undetermined |
| iPadOS Safari | Screen the same API milestones on iPadOS, recording iPad evidence separately. | Undetermined |
| Mac Dock apps | Safari 18 adds web-extension support to Mac web apps. This conditional feature does not raise the ordinary browsing floor. | Undetermined |

Sources: [Apple compatibility guidance](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility), [WebKit 16.4](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/), [WebKit 18](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/). A successful SDK build or a recent Safari result cannot establish a deployment minimum.

## 4. Interpreting failures

Rendering across a denied boundary, lost input and broken essential controls are critical. For each failure, identify whether the evidence implicates the fixture, probe, candidate, loader or Safari. Record unknown attribution when controls cannot distinguish them. Keep unresolved mandatory behavior open for an owner decision. The next rendering comparison can reuse the two staged manifests, the marker reference, pinned candidate, controlled pages, native-dark oracle and request counters. Treat a failed or unexecuted control as a prerequisite for its dependent comparison.

## 5. Acceptance disposition

The [local run record](../evidence/safari-capabilities/local-validation/observations.jsonl) identifies the implementation and fixture fingerprint, deterministic coverage scope and four unsigned Apple builds. The working fixture reference above predates the final fixture changes.

| Issue checkbox | Technical evidence | Product qualification |
|---|---|---|
| 1. Platform surface | Two packaged manifests on Mac and iOS Simulator. The audited bundle forwarded messages but dropped the caller's promise after import and disable in the deterministic harness. Grant calibration, frame checks and redirects have deterministic controls. | Mac injection and pre-import messaging were observed in both variants. Candidate loading failed on both. Independent HTTPS grants, natural suspension, Private Browsing and Dock behavior remain open. |
| 2. Eligibility and preservation | Decision-table, native-dark, renderer and first-party cancellation tests passed. The library's messaging limitation is reproducible in Node. | The Mac top-host grant pair passed. Fresh dark pages triggered preservation. Same-document site transitions and candidate-owned asynchronous rendering remain unqualified. |
| 3. Preview and restoration | Scope inheritance, latest saved behavior, boundary invalidation, stale responses, lost editor and tab isolation have passing deterministic cases. | MV3 entered and discarded a preview at the same saved revision. MV2 preview, the full navigation matrix and live restoration after revocation remain open. A denied reload preserved the fixture button on MV2. |
| 4. Tab override, pause and commands | Tests exercise synthetic browser events, session identity, pause and editor commands. | Natural suspension, duplicated/restored tabs, restart persistence and shortcut conflicts need platform runs. |
| 5. Scheduling | Evaluator tests cover start-day attribution, endpoint validation, DST, zone/clock changes and current-time recomputation. | Actual browser wakeup, clock propagation and native integration remain open. |
| 6. Evidence and OS floors | The probe, runbook, evidence classes and candidate OS boundaries are available for source inspection. | A platform floor or engine choice requires later evidence. |

Coverage below target in a branch or function metric remains visible. Uncovered paths include browser API failures, popup events and Safari-specific timing. The Node reporter measures the modules loaded by the suite; browser fixture scripting also requires observation in Safari. Treat a candidate defect or platform restriction as a finding, and retain the associated product obligation.
