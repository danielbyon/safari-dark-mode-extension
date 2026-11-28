---
status: accepted
---

# Bundle compatibility configuration before considering remote delivery

In v1, ship website-specific compatibility fixes as bundled configuration updated through normal App Store releases. The owner wants to investigate independent remote deployment of the kinds of corrections that can sensibly be expressed as configuration after v1, without making the renderer remotely controlled or requiring a remote service to render pages.

## Rationale and boundaries

1. Bundling keeps rendering offline, avoids service dependencies for the initial release, and gives configuration and the executable renderer a common reviewed release boundary.
2. Remote delivery is a future investigation, not a committed v1 feature. Identify a bounded, declarative, versioned schema interpreted by the bundled renderer. Do not plan remote executable scripts, downloaded rendering algorithms, arbitrary commands, or remotely defined new capabilities. App Review compliance, integrity, validation, rollback, caching, privacy, and release compatibility must be assessed before adoption. Do not assume that labeling arbitrary executable or expressive content as configuration makes it permitted.
3. Compatibility fixes are distinct from user site rules. They operate only when rendering is permitted by the complete eligibility decision in ADR 0002, including its eligible explicit-preview exception. A compatibility fix cannot independently grant rendering eligibility, bypass permission/access/pause, or suppress an otherwise eligible preview by rechecking the saved Off or native-dark state; never rewrite saved user preferences. Allow narrowly scoped changes to rendering technique or element treatment, including preserving a problematic element when transforming it would break usability. These exceptions must be diagnosable and must not silently alter deliberately chosen colors merely because the user chose low contrast; product-controlled code, unmodified built-ins, and their transformations must meet applicable WCAG 2.2 AA criteria (ADR 0007, Q78). Do not treat an existing third-party accessibility defect as a defect introduced by the product, or exempt an attributable product regression merely because it occurs on an external website or a customized theme is active. The customization exception covers only consequences of deliberately selected appearance values (ADR 0007). Qualify an eligible preview on an otherwise inactive website that still receives its required bundled compatibility fix; ineligible previews cannot render. Exact schema and permissible element corrections remain subject to engine evaluation. Include the bundled configuration version in reviewed support reports. Do not collect browsing history or transmit visited URLs to select a fix remotely.
4. Apple's App Review Guideline 2.5.2 limits downloaded code that adds or changes functionality; Mac App Store requirements also restrict out-of-store updates and resources that materially change reviewed functionality. The proposed future boundary is a design constraint, not preapproval by Apple.

Accepted by the owner in Q51, 2026-11-24, refining the bundled-only v1 proposal rather than authorizing remote updates now. Q75 (2026-11-28) establishes compatibility-fix precedence and unrestricted custom appearance with a compliant built-in baseline.

Source: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), sections 2.4.5 and 2.5.2.
