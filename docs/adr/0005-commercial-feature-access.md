---
status: accepted
---

# Equivalent features through subscription or permanent purchase

The current purchase direction is a free download with a seven-day subscription introductory trial as the primary purchase flow, plus an optional one-time permanent unlock. All paid routes provide the same application features. The Family subscription costs more because it includes Family Sharing, not because it unlocks additional appearance controls.

This revises the earlier no-commitment app-trial requirement. The owner proposed moving to Apple's subscription-trial flow to avoid the unresolved mechanism for a standalone trial in an app selling both subscriptions and a permanent unlock. A subscription trial starts an automatically renewing subscription; it must never be described as requiring a later purchase decision before charging.

## Accepted product decisions

1. The introductory trial lasts seven days. It starts through the customer's confirmed App Store subscription transaction, not merely by downloading or opening the app. Present the post-trial renewal price and billing period clearly. Eligibility follows StoreKit; there is no promise of a new trial for each device or plan change.
2. Offer an annual Individual subscription without Family Sharing and a higher-priced annual Family subscription with Family Sharing. Both grant the same app capabilities. Monthly billing was not selected; two annual subscriptions and one permanent unlock keep the purchase choice simple.
3. The optional permanent unlock includes future versions and features released within this app. It does not expire, but does not promise perpetual development or indefinite future OS compatibility.
4. Q33 accepted Family Sharing for both purchase types and then requested a premium family subscription. Therefore the permanent unlock retains Family Sharing; the premium-versus-individual distinction applies to the subscription offerings. A second individual/family lifetime product split was not requested.
5. Commercial purchasing flows belong in the containing application. Apple Guideline 4.4 excludes marketing, advertising, and in-app purchases from extensions; neutral extension access status still needs detailed UI design.

6. Accepted US launch price targets: Individual $1.99/year, Family $3.99/year, and family-shareable permanent unlock $6.99. Revisit before launch and use actual localized StoreKit prices, not hardcoded display prices.
7. Fully use Apple's StoreKit purchase, verified transaction, entitlement, renewal-state, and restoration facilities. Do not build proprietary purchasing, license verification, account, or licensing-server infrastructure. Offline operation relies on previously verified access and its valid period; recognize expiry, refund, and revocation when StoreKit evidence establishes them. Preserve preferences after access ends. The extension consumes the native entitlement result, not a second independent purchase system.
8. Configure Apple's 16-day Billing Grace Period for paid-to-paid renewals only, not failed conversion from a free trial. Validate StoreKit grace and expiry transitions before enabling the production configuration.

9. All three purchase routes grant access on supported iPhone, iPad and Mac versions for the qualifying purchaser or eligible Family Sharing recipient. Use a universal-purchase arrangement and shared StoreKit product catalog. T5 must verify the appropriate App Store record/platform arrangement before production app and product identities are established. Identify existing permanent or family-shared access clearly before offering another purchase.
10. Configuration management (view/edit themes, site rules and preferences), the native sample preview, support, and purchase restoration remain available without active rendering access. Actual Safari webpage transformation and live webpage preview require valid access, including an eligible active trial. No real-website free rendering tier was selected.
11. Distinguish confirmed inactive access from unknown/refreshing access or bridge failure; do not present the latter as proof that the user must buy again. Previously verified access follows the accepted StoreKit validity policy, without a second licensing policy. If no valid evidence exists, do not enable real-webpage rendering. On expiry, revocation, or loss of the last valid entitlement, stop transforming and restore already-open pages at the earliest platform-supported opportunity; keep preferences. Avoid routine containing-app launch requirements; T5 must prove the refresh path or identify platform constraints for owner review.

## Apple constraints and implementation direction

1. Apple explicitly supports a Family Sharing subscription alongside an individual subscription and recommends ranking them at the same subscription level. Use a single subscription group for alternatives to the same service so one customer cannot purchase both subscription plans concurrently. Family-shared access can coexist with a personally purchased subscription; entitlement handling must account for all valid access.
2. One-week introductory trials are supported. Customers can redeem one introductory offer per subscription group; actual eligibility must be checked rather than inventing a separate household eligibility rule.
3. Selecting a same-level, same-duration standard-price subscription during an introductory offer can charge the new full price immediately and end the offer. Do not promise that the remaining trial survives a plan switch. The purchase UI must explain the actual effective price and timing.
4. A non-consumable permanent purchase is independent of subscription-group switching. Do not promise that it automatically cancels an existing subscription. The transition must give clear subscription-management guidance and must not hide continued renewal.
5. Family Sharing is enabled per purchase product and cannot be disabled after enabling. Shared purchase access does not mean shared personal configuration.

## Remaining decisions

Exact paywall layout, plan-transition UX, universal-purchase configuration details, entitlement refresh across the extension lifecycle, and validation details for offline continuity and expiry remain open. The observable access contract is accepted; any unavoidable containing-app launch requirement needs evidence and review. Launch price targets and intended billing-grace policy are accepted; recheck price availability before release. Product configuration has not been changed in App Store Connect.

## Sources

1. Owner design interview, 2026-11-23: Q10, Q18-Q19, the A1 revision, Q30-Q31, Q33, Q36, Q44-Q45 (2026-11-24), and Q71 and Q77 (2026-11-28).
2. [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), section 4.4.
3. [Apple subscription guidance](https://developer.apple.com/app-store/subscriptions/).
4. [Subscription introductory offers](https://developer.apple.com/documentation/storekit/implementing-introductory-offers-in-your-app).
5. [Set up introductory offers](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-introductory-offers-for-auto-renewable-subscriptions).
6. [Subscription events](https://developer.apple.com/help/app-store-connect/reference/reporting/subscription-events/), crossgrades from introductory offers.
7. [Enable Family Sharing](https://developer.apple.com/news/?id=ksfkdwpr).
8. [Family Sharing configuration](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/turn-on-family-sharing-for-in-app-purchases/).
9. [Subscription status and Family Sharing](https://developer.apple.com/documentation/storekit/product/subscriptioninfo/status-swift.property).
10. [Billing Grace Period configuration](https://developer.apple.com/help/app-store-connect/manage-subscriptions/enable-billing-grace-period-for-auto-renewable-subscriptions/).
11. [App Store Connect: add platforms](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-platforms/).
