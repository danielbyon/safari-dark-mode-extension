#!/usr/bin/env bash
# Build generated wrappers without provisioning or installing either application.
set -euo pipefail
cd "$(dirname "$0")/.."
probe_root="$(pwd -P)"
packager="$(xcrun --find safari-web-extension-packager 2>/dev/null || xcrun --find safari-web-extension-converter)"
case "${1:-dynamic}" in
    dynamic) variants=(mv2 mv3) ;;
    ordered-preflight) variants=(mv2-ordered-preflight mv3-ordered-preflight) ;;
    *) echo "Expected dynamic or ordered-preflight" >&2; exit 1 ;;
esac
for variant in "${variants[@]}"; do
    variant_root="$probe_root/.build/$variant"
    resources="$variant_root/extension"
    [[ -f "$resources/manifest.json" ]] || { echo "Run npm run build first" >&2; exit 1; }
    # A fresh generation avoids accepting stale target settings from a previous Xcode.
    generated="$variant_root/wrapper"
    rm -rf "$generated"
    "$packager" "$resources" --project-location "$generated" --app-name SafariCapabilities \
        --bundle-identifier "org.example.SafariCapabilities.$variant" --swift --copy-resources --no-open --no-prompt
    project="$(find "$generated" -name '*.xcodeproj' -print -quit)"
    [[ -n "$project" ]] || { echo "Packager produced no Xcode project" >&2; exit 1; }
    schemes="$(xcodebuild -list -json -project "$project")"
    for platform in macOS iOS; do
        # Apple generates one containing-app scheme per platform plus extension schemes.
        scheme="$(python3 -c 'import json,sys; names=json.load(sys.stdin)["project"]["schemes"]; hits=[s for s in names if s.endswith("("+sys.argv[1]+")") and "Extension" not in s]; assert len(hits)==1, names; print(hits[0])' "$platform" <<<"$schemes")"
        destination="generic/platform=macOS"
        if [[ "$platform" == iOS ]]; then destination="generic/platform=iOS Simulator"; fi
        xcodebuild -project "$project" -scheme "$scheme" -configuration Debug \
            -destination "$destination" -derivedDataPath "$variant_root/DerivedData" \
            CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
        products="$variant_root/DerivedData/Build/Products"
        if [[ "$platform" == macOS ]]; then
            app="$products/Debug/SafariCapabilities.app/Contents"
            extension="$app/PlugIns/SafariCapabilities Extension.appex/Contents"
            packaged="$extension/Resources"
        else
            app="$products/Debug-iphonesimulator/SafariCapabilities.app"
            extension="$app/PlugIns/SafariCapabilities Extension.appex"
            packaged="$extension"
        fi
        bundle_id="org.example.SafariCapabilities.$variant"
        [[ "$(plutil -extract CFBundleIdentifier raw "$app/Info.plist")" == "$bundle_id" ]]
        [[ "$(plutil -extract CFBundleIdentifier raw "$extension/Info.plist")" == "$bundle_id.Extension" ]]
        node scripts/verify-wrapper.mjs "$variant" "$variant_root" "$packaged"
    done
done
