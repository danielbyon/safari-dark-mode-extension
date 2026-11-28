export interface NativeAppearance {
    scheme: "dark" | "light" | "unknown";
    reason: "root-declaration" | "no-declaration" | "ambiguous" | "unreadable";
}

/**
 * Take the inventory before either renderer writes to the document. Keep the
 * stylesheet objects themselves so CSSOM edits and media changes remain visible.
 * Generated sheets and the computed appearance never enter this experiment.
 */
export function captureNativeDark(
    sheets: Iterable<CSSStyleSheet>,
    mediaMatches: (query: string) => boolean,
    missingSource = false,
): () => NativeAppearance {
    const sources = Array.from(sheets);
    const active = (media: MediaList) => !media.mediaText || mediaMatches(media.mediaText);

    return () => {
        const declarations = new Set<string>();
        let unreadable = missingSource;

        function visit(rules: CSSRuleList): void {
            for (const rule of rules) {
                if (rule.type === 1) {
                    const style = rule as CSSStyleRule;
                    if (style.selectorText === ":root" || style.selectorText === "html") {
                        const scheme = style.style.getPropertyValue("color-scheme").trim();
                        if (scheme) declarations.add(scheme);
                    }
                } else if (rule.type === 4) {
                    const group = rule as CSSMediaRule;
                    if (active(group.media)) visit(group.cssRules);
                } else if (rule.type === 3 || "cssRules" in rule) {
                    // Imported sheets and other grouping rules can change the cascade.
                    unreadable = true;
                }
            }
        }

        for (const sheet of sources) {
            const owner = sheet.ownerNode;
            if (owner?.isConnected === false || (owner && "sheet" in owner && owner.sheet !== sheet)) {
                unreadable = true;
                continue;
            }
            if (sheet.disabled) continue;
            try {
                if (active(sheet.media)) visit(sheet.cssRules);
            } catch {
                // Safari can apply a cross-origin stylesheet while denying CSSOM access.
                unreadable = true;
            }
        }
        if (unreadable) return { scheme: "unknown", reason: "unreadable" };
        if (!declarations.size) return { scheme: "unknown", reason: "no-declaration" };
        if (declarations.size === 1) {
            const [value] = declarations;
            if (value === "dark" || value === "light") {
                return { scheme: value, reason: "root-declaration" };
            }
        }
        return { scheme: "unknown", reason: "ambiguous" };
    };
}
