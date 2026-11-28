# Safari Dark Mode

The appearance of websites viewed in Safari, including darkening, themes, and user preferences that apply to particular parts of a website.

## Language

### Appearance

**Darkening**:
The change from a webpage's original appearance to a dark color scheme supplied by the extension.
_Avoid_: Inversion (a particular way of changing colors, not the overall behavior)

**Theme**:
A collection of appearance choices for darkened webpages.
_Avoid_: Mode (which can also refer to when darkening activates)

**Adaptive appearance**:
A dark appearance that aims to preserve the website's recognizable accent colors.
_Avoid_: Inversion

**Palette theme**:
A theme with a user-selected background, text, and link palette.
_Avoid_: Adaptive appearance (when a chosen palette is intended)

**Built-in theme**:
A supplied, immutable theme that a user may select or use as the starting point for a custom theme.
_Avoid_: Editable preset

**Custom theme**:
A reusable theme owned and editable by the user.
_Avoid_: Site rule (a scoped override rather than a reusable theme)

**Appearance preview**:
An unsaved evaluation of proposed setting changes and override removals at the selected editing scope against the latest saved configuration for the current page. Ordinary inheritance and narrower overrides still apply. Discarding it reveals the current saved behavior rather than restoring an obsolete snapshot.
_Avoid_: Saved site rule

**Appearance override**:
An explicitly saved appearance value that replaces the corresponding value inherited from the selected theme or broader scope without changing the reusable theme.
_Avoid_: Edited theme (which changes the reusable theme itself)

**Rendering method**:
The way the extension transforms a webpage to produce the effective appearance. It is independent of the selected theme.
_Avoid_: Adaptive appearance (a visual goal rather than a rendering algorithm)

**Native dark mode**:
A dark appearance supplied by the website itself, independently of this extension.
_Avoid_: System dark mode

**System appearance**:
The device's light or dark appearance setting.
_Avoid_: Native dark mode (which refers to the website)

**Compatibility fix**:
A correction for a website-specific rendering issue supplied by the product, rather than an appearance preference created by a user.
_Avoid_: Site rule

### Activation

**Default activation mode**:
The user's baseline choice of Always On, Always Off, Follow System, or Schedule for webpages without an applicable activation override.
_Avoid_: Master switch

**Site activation override**:
A site rule's explicit Always On, Always Off, or Follow System choice, replacing the inherited activation value. Use Default removes the override; a website may inherit Schedule but does not have its own schedule in v1.
_Avoid_: Default activation mode

**Schedule**:
A device-local activation mode that enables darkening during a selected time window on selected weekdays, using the device's current local time.
_Avoid_: System appearance (which follows the device's light or dark setting)

**Pause Everywhere**:
A device-local suspension of darkening across websites that persists until explicitly resumed, including across app and browser restarts, while preserving saved preferences and site rules.
_Avoid_: Always Off (a default activation mode that site rules can override)

**Temporary tab override**:
A change to darkening in the current tab that does not modify saved preferences and lasts until the tab leaves its current hostname, closes, or the user restores its saved behavior.
_Avoid_: Site activation override (a persistent preference)

### Website preferences

**Site rule**:
A user's saved preference overrides for webpages within a particular website scope.
_Avoid_: Exception (a rule can customize appearance as well as disable darkening)

**Rule scope**:
The part of a website covered by a site rule: an entire domain, exact hostname, website section, or exact page path.
_Avoid_: Site (when the distinction between an entire domain and part of it matters)

**Domain scope**:
A rule scope covering a registrable domain and its subdomains, with public and private suffix boundaries respected.
_Avoid_: Exact hostname

**Hostname scope**:
A rule scope covering only one exact hostname.
_Avoid_: Entire domain

**Section scope**:
A rule scope covering a path and its descendant paths on a particular hostname.
_Avoid_: Text prefix (a similar-looking sibling path is not necessarily part of the same section)

**Page-path scope**:
A rule scope covering one exact path on a particular hostname, independent of query parameters and URL fragments.
_Avoid_: Full-URL scope

**Global appearance defaults**:
The user's baseline theme and appearance preferences for websites, subject to applicable site-rule overrides.
_Avoid_: All website rules

**Inherited value**:
A preference supplied by a broader applicable site rule or the user's defaults until a more specific rule explicitly overrides it.
_Avoid_: Copied setting (an inherited value remains connected to its source)

**Preference sync**:
Optional sharing of the user's theme collection, persistent site rules, and global appearance defaults between their devices.
_Avoid_: Browsing-history sync

**Preference conflict**:
Competing edits to the same saved preference across devices. The last edit wins; independent preference edits are retained.
_Avoid_: User-managed merge

**Cloud configuration**:
The user's synchronized theme collection, persistent site rules, and global appearance defaults. Deleting it ends participation in that configuration without deleting device-local preferences.
_Avoid_: Local configuration

### Support

**Appearance problem report**:
An explicitly authorized, user-reviewed report describing a rendering problem on a website, with relevant non-sensitive diagnostics and optional user-provided attachments.
_Avoid_: Automatic telemetry

### Product access

**Subscription trial**:
An introductory period of full access that starts an automatically renewing subscription, with payment deferred until the trial ends unless the subscription is canceled.
_Avoid_: No-commitment trial (which does not start a subscription)

**Individual subscription**:
Recurring access for the purchaser across their supported devices.
_Avoid_: Single-device purchase

**Family subscription**:
Recurring access that the purchaser can share with eligible family members through Apple's Family Sharing.
_Avoid_: Shared settings (purchase access does not merge the family's preferences)

**Permanent unlock**:
A one-time purchase granting non-expiring access, including future versions and features released within this app.
_Avoid_: Subscription; perpetual maintenance promise
