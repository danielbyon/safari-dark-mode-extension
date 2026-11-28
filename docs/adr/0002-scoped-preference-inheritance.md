---
status: accepted
---

# Scoped preferences inherit individual values

The owner chose domain, exact-hostname, website-section, and exact-page-path scopes, with narrower rules overriding only explicitly changed settings. Per-setting inheritance keeps broader preferences useful as a user adds exceptions; complete rule snapshots were rejected because they silently freeze copied settings and make later changes harder to understand.

## Matching and inheritance

1. Resolve each setting in this order: global default, entire domain, exact hostname, all matching sections in increasing specificity, then exact page path. Each matching section contributes only its explicit values; do not select just one section. Pause Everywhere suspends darkening independently of that resolution.
2. Keep one rule per scope. Saving to an existing scope updates it rather than adding a duplicate with competing priority.
3. Ignore query parameters and fragments in the first release. This avoids separate rules caused by tracking or anchor URLs, while intentionally treating meaningful query/hash routes as the same path for customization.
4. An inherited value stays linked to its broader source. Restoring inheritance removes the override rather than copying the broader value.
5. Domain scopes use registrable domains determined with the Public Suffix List, including private suffixes. For example, `example.co.uk` is one registrable domain; `alice.github.io` and `bob.github.io` are separate domains. `example.com` and `www.example.com` have distinct hostname scopes under the same domain scope.
6. HTTP and HTTPS and different ports share the same appearance rule for the same hostname and applicable path. Path matching is case-sensitive, and section matching respects path-segment boundaries: `/docs` does not match `/docs-old`. For nested matching sections, narrower explicit values override broader ones while other values inherit.
7. Remaining canonicalization details require the T3 resolver identity/matching matrix before the persistence format is frozen. Cover non-registrable hosts, IP addresses, localhost, IDNs, trailing-dot hosts, trailing/repeated slashes, encoded separators and other encoded characters, PSL changes, and malformed or migrated/synced rule identities. Preserve exact path distinctions unless normalization is justified; do not decode or normalize in a way that silently broadens a rule. Non-registrable hosts need a defined exact-host behavior, not an invented registrable domain.
8. Safari profiles share the same theme collection, defaults, and site rules in v1. Respect Safari's own permission boundaries separately. Profile-specific settings are unnecessary for v1 and may be evaluated later based on customer demand.

## User-facing controls

1. Simplicity for non-technical users is required. The normal scope choices are This Website and This Page, with section and entire-domain choices available through additional options. Show the affected address or section; default website changes to the exact current hostname.
2. Use Default and short source explanations expose effective settings without requiring users to understand the matching algorithm. Use Default removes the override and may inherit a broader site rule rather than the global default; show the actual source. Explain that This Page ignores query parameters and fragments where relevant.
3. Provide two explicit save actions. Save for This Website updates the selected scope, with the label adapting for a page or section. Save as Default is the current copy direction for updating global appearance defaults. The global action preserves every existing site-rule override; it does not reset all rules. Explain when an existing override means the current page will keep its own value, and expose Use Default.
4. Saving appearance choices to a site rule or the global defaults does not implicitly edit a named theme in the theme collection. Editing a stored named theme is an explicit separate action; its users receive changes except where an applicable explicit appearance override supplies the value.
5. Keep a website's native dark appearance by default. A saved Use My Theme preference for the selected scope can override that choice. Always On alone does not imply replacing native dark appearance.
6. Default activation and Pause Everywhere remain distinct: site rules may override Always Off as a default, while pausing preserves the saved configuration. Site activation choices are Use Default, Always On, Always Off, and Follow System. Use Default removes the explicit activation override and inherits from the applicable broader rule or global default, which may be Schedule. Independent site schedules are not supported in v1; this avoids adding scheduling complexity to each scope.
7. The macOS current-website toggle keyboard shortcut creates or changes a temporary override in the current tab rather than changing a saved site rule. It lasts until navigation leaves the current hostname, the tab closes, or the user explicitly restores saved behavior. Persistently changing a website's activation remains a separate action. This avoids accidental mutation of saved preferences during quick troubleshooting. Pause Everywhere remains an overarching suspension; purchase access and Safari permission boundaries still apply.

## Theme composition (Q66)

A selected theme is a reusable appearance base. Resolve the theme reference independently using the normal scope ordering. Then resolve each explicit appearance override independently across all matching scopes and apply it to the selected theme. Selecting another theme changes the reference, not independently saved overrides; do not reset or flatten those overrides. Explain inherited adjustments that cause the selected theme to differ from its unmodified appearance.

| Field category | Reusable theme | Global appearance defaults / persistent site rule |
| --- | --- | --- |
| Theme identity/reference | Identity of a reusable theme | Independently selected/inherited theme reference |
| Appearance | Adaptive or palette appearance and applicable background/text/link colors, brightness, contrast, saturation, warmth, image dimming | Independent explicit appearance overrides; absence inherits |
| Activation | Not a theme property | Default activation mode is device-local; persistent site activation overrides are scoped; native-dark preservation / Use My Theme is a separate policy |
| Temporary state | Not a theme property | Preview and temporary tab activation are not saved appearance overrides |

For example, global Graphite, a domain green-link override, hostname Ocean with blue links, and a page brightness override resolve to Ocean with green links and the page brightness. Editing Ocean changes its base wherever referenced without overwriting explicit overrides. Removing the domain link override reveals the next applicable explicit link override, if any, or Ocean's link color; it does not copy blue into the rule. The exact field representation and interactions of adaptive/palette-specific controls remain technical specification work.

## Scope-aware preview and built-in recovery (Q79-Q80)

An appearance preview evaluates the draft as hypothetical setting changes and override removals at the selected editing scope against the latest saved configuration. Resolve the result normally, including all narrower applicable overrides; do not overlay draft values directly on the final effective appearance. Previewing Use Default hypothetically removes the setting at its owning scope and then resolves inheritance. For example, when the hostname link color is blue and a page-path override is green, changing the hostname draft to yellow still produces green on that page. Explain the narrower override and offer selection of the relevant narrower scope. Changing the selected editing scope retains the explicitly edited fields and reevaluates their effect. Save as Default targets global appearance defaults even if the preview was evaluated at a site scope; it may produce a different result because site overrides survive. Remove the preview and explain the actual resolved appearance after saving. See ADR 0007 for lifetime and access.

Ordinary selection of a built-in theme remains non-destructive: applicable explicit appearance overrides survive. To return to the unmodified built-in appearance, identify the effective overrides and their owning scopes, then let the user explicitly remove the relevant overrides with the existing inheritance/source controls. Explain broader consequences before changing a domain rule or global default. Reevaluate after each change, including overrides revealed by removing narrower values. Do not label the result unmodified built-in appearance while applicable appearance overrides remain. A scope-specific mechanism that bypasses inherited overrides, or a reset that silently modifies broader preferences, was not selected for v1. The appearance-editor specification determines the guided interaction.

## Activation and preview interaction (Q67-Q68)

For real webpages, first require Safari authorization and valid purchase access; then apply Pause Everywhere as a device-wide suspension. An explicitly initiated appearance preview can temporarily request rendering despite ordinary activation or native-dark preservation, but cannot bypass those three prerequisites. Otherwise resolve temporary tab activation over saved activation (scoped rules over the device-local default, including Schedule), and then apply native-dark preservation unless Use My Theme applies. Use My Theme is not itself an activation request. The complete rendering eligibility decision, including the eligible explicit-preview exception, is independent of the scope-aware appearance values being previewed. Bundled compatibility fixes consume this decision rather than independently granting rendering or reapplying saved Off/native-dark preservation to suppress an otherwise eligible preview.

| Situation | Required behavior |
| --- | --- |
| Saved Always Off, temporary tab On | Request darkening subject to permission, valid access, pause and native-dark policy |
| Paused, temporary tab On or preview requested | Remain suspended |
| Effective On, website already dark, no Use My Theme | Preserve website appearance |
| Use My Theme, effective Off | Do not darken unless an explicit eligible preview is active |
| Native dark mode appears dynamically | Reevaluate and remove our transformation when preservation applies and no eligible preview is active; our own transformed output is not evidence of website-controlled native dark mode |
| Access ends or permission is revoked | Stop rendering and restore the original page at the earliest supported opportunity; never bypass Safari restrictions |

Expose distinguishable inactivity reasons (permission unavailable, access inactive or unknown/refreshing, paused, outside schedule, saved Off, native dark appearance). If Safari prevents immediate restoration after revocation, explain the recovery action; T2/T5 must establish actual lifecycle limits. The ordinary tab toggle changes activation only and does not implicitly select Use My Theme.

## Temporary activation lifetime (Q73)

Pause Everywhere persists on the device across application/browser restarts until explicit resume; expose a visible paused state. A temporary tab override survives reload and same-host navigation/back-forward in that tab, and ordinary suspension, but ends on cross-host navigation, tab closure, or explicit restoration. Newly duplicated or restored tabs do not inherit another tab's temporary override. Validate lifecycle feasibility in T2. Neither a temporary tab override nor an appearance preview changes persistent site rules.

Accepted and refined in the owner's 2026-11-23 design interview, Q9, Q12-Q13, Q21-Q25, Q29, Q56-Q58, Q63 (2026-11-25), and Q66-Q68 and Q73 (2026-11-28). Preserving site rules was selected over replacing their values during a global save because defaults must remain safe to change after customization.
