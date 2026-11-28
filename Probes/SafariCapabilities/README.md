# Run the Safari capability probe

The marker adds one removable style to a controlled page. The candidate configuration runs the audited Dark Reader bundle against the same fixture. Use the [capability matrix](../../docs/plans/safari-capability-matrix.md) for procedures, controls and expected outcomes.

For the next bounded Mac run, follow the [loading and marker controls](mac-loading-controls.md). They cover independent installations, the historical profile activation, three messaging phases and the matched strict-CSP comparison.

## 1. Build

Use Node 24 or later, npm, Python 3, and Xcode with macOS and iOS Simulator SDKs. From this directory run:

```sh
npm ci --ignore-scripts --no-audit
npm run lint
npm run typecheck
npm test
npm run coverage
npm run build
npm run package
```

Each build writes a complete extension under `.build/mv2/extension` and `.build/mv3/extension`. The build checks the audited npm integrity, JavaScript digest and MIT license digest before staging either variant. Only the UMD library and its license ship from the candidate package. The local Apple packager generates separate unsigned wrapper projects for build testing. Its generated target settings apply only to these disposable projects.

## 2. Start the fixtures

Run `npm run fixtures` and open `http://127.0.0.1:8787/page.html` in an authorized fixture-only profile. By default the top and frame roles use 127.0.0.1 and localhost on port 8787. Resource and denied roles use those hosts on port 8788. These are distinct web origins. Safari website grants can group origins by host; the default setup cannot qualify independent resource grants on a guard-accepted HTTPS origin.

If ports are busy, set the same `SAFARI_PROBE_ORIGINS` JSON object before **both** the build and server commands. Supply the four keys `top`, `frame`, `resource` and `denied` with distinct origin URLs. Use loopback HTTP or an already-authorized default-port HTTPS fixture origin. An external route needs independently controlled DNS, TLS and Safari grants. The probe does not set any of these up. Keep declaration patterns and exact-origin runtime checks aligned by rebuilding after a change.

Start with the extension off. Record the website's initial observation, use **Run action** for each site transition, and compare the site's synthetic text, focus, markers, metadata and color samples. **Run in 5 seconds** lets a website event occur while the editor is open. Use `?frames=1&frameTheme=dark` for embedded documents, `?theme=dark` for initially dark content, `?theme=system` for the system appearance control and `?csp=strict` for strict CSP. Fixture query strings belong only to the experiment.

## 3. Run the extension

1. Use a disposable profile and one manifest variant at a time. On supported macOS Safari versions, choose Settings → Developer → Add Temporary Extension and select the staged extension directory. Safari may require the operator to authenticate. Enable the extension only for the test profile and grant access only to the controlled fixture sites. Repeat using a fresh document for each grant condition. A temporary installation expires on quit; a separately authorized packaged install is required to test browser-restart persistence. [Apple’s instructions](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)
2. Check the active profile in Safari’s Extensions pane before granting access. Safari 27.2 initially enabled the temporary extension in the default profile. Its global checkbox cycles through mixed, all and off. Once only the lab profile is active, use a second allowed fixture host to keep the popup available while you change the top host’s grant. In **Permissions**, sample both Deny and Allow. Reload the allowed top fixture. In **Rendering**, start with valid synthetic access, global saved activation On and the marker. Pause, check the decision, then resume and check that the marker returns.
3. For scope precedence, save a host or page link-color override, preview a different broader value, then preview Use Default at the narrower scope. Change a saved value while the draft is open. Dismiss or navigate and compare the resolved appearance to the latest saved revision. Saving in this probe edits synthetic test settings. Actual Private Browsing save UX is outside the investigation.
4. Run the same conditions with the candidate. Start light, reevaluate three times, independently switch the site dark and back, and repeat using the Ocean palette. Capture both site observations and the extension's reason. The detector reads its bounded site stylesheet inputs. The fixture's action names and expected labels belong to verification only. Inspect the ordinary message reply at each phase before relying on later readings from that execution world.
5. For schedule tests choose at least one start day and two distinct times. The popup offers quarter-hour endpoints; the pure evaluator accepts valid minute-precision inputs. Compare an actual Safari refresh against the deterministic time-zone cases. Changing the clock, configuring Private Browsing, installing a Dock app, changing shortcuts, or installing on a device requires the corresponding owner authorization.

## 4. Resource and stale-work controls

1. Choose a stylesheet with `?sheet=same`, `cors`, `opaque`, `guard`, `import`, `redirect`, `redirect-cross`, `failed` or `gated`. With the extension off, inspect the distinctive resource swatch and invoke the CSSOM and page fetch controls. Use `/control/status` on the fixture control origin for counters. Count only positively identified extension requests as extension traffic. An unclassified initiator leaves that attribution unresolved.
2. Choose the host role in **Permissions**. Click **Compare Deny**, **Compare Allow** or **Compare Ask** to match the setting you saw in Safari. Each sample records the expected setting and all four API answers. Both Deny and Allow must agree before the role qualifies. For a resource grant pair, leave participating document roles allowed and change only the resource host’s grant. Preserve the URL, headers, candidate and loader. Grouped grants or a rejected upstream origin leave this case open. Start a fresh document after calibration and repeat the samples when the background instance changes.
3. For a held resource, arm the gate, begin a fresh candidate read, confirm a pending request, change one eligibility input, then release. Repeat with an unchanged decision as the positive control. Use the website mutation gate separately for candidate-owned asynchronous effects. Capture the order of release, invalidation and visible updates. Receiving a background abort and rejecting stale response bytes are separate observations. The public candidate can continue internal work after bytes have been delivered; record any late style writes and final site state. If the internal pending phase cannot be demonstrated, leave that cell `NOT_RUN`.
4. Include tab and frame navigation, permission loss, pause, access loss, preview discard, a saved-Off change and a newer eligible appearance. Compare the latest complete decision, including an eligible preview that legitimately overrides saved Off. Do not reuse a resource callback from an expired decision. Use a fresh authorized document for a new attributable candidate read.
5. For both redirect fixtures expect the original authorized endpoint to see a request and the redirect destination to see none from the extension. A site-loaded sheet may independently contact that destination. Compare each counter with the extension-off reference.

For the default top origin, the following commands control an already running fixture server. Substitute the actual top origin for a custom run. The CSS gate holds extension-side or other non-style reads while allowing the website to load its original sheet.

```sh
curl -fsS -X POST -H 'Content-Type: application/json' http://127.0.0.1:8787/control/arm
curl -fsS http://127.0.0.1:8787/control/status
curl -fsS -X POST -H 'Content-Type: application/json' http://127.0.0.1:8787/control/release
```

Use `/control/arm-mutation` and `/control/release-mutation` with the gated mutation website action. A released website mutation proves delivery to the website; use the extension's observations and settled fixture output to establish any later candidate effect.

## 5. Record and restore

Record UTC, operator method, OS/Safari build, environment, manifest and bundle digest, fixture revision, condition, result, control and limitation. In **Observations**, refresh and choose **Export JSON snapshot**. On Safari 27.2 this opened the JSON in a separate lab tab. Capture the snapshot before the background instance changes. Keep full exports and screenshots local. Publish only the synthetic settings, grant answers and event fields needed to reproduce the finding.

Remove the temporary extension, restore any changed test-site settings, close the fixture-only window and delete its disposable profile. Stop only the fixture server started for the run. Document a restoration failure explicitly. Keep product requirements open where Safari behavior could not be observed.
