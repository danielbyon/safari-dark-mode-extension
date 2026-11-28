/** Two fixed themes let the probe change rendering modes without a theme store. */
export const THEMES = {
  graphite: { mode: "adaptive", linkColor: "#90bfff", brightness: 100 },
  ocean: { mode: "palette", linkColor: "#62d2ed", brightness: 100 },
} as const;

export type ThemeName = keyof typeof THEMES;
export type TabOverride = "on" | "off";
export type SiteActivation = TabOverride | "follow-system";
export type Activation = SiteActivation | "schedule";
export type Access = "valid" | "inactive" | "unknown" | "refreshing" | "refreshing-valid";

export type Scope =
  | { readonly kind: "default" }
  | { readonly kind: "domain"; readonly domain: string }
  | { readonly kind: "host"; readonly hostname: string }
  | { readonly kind: "section" | "page"; readonly hostname: string; readonly path: string };

interface AppearanceValues {
  theme: ThemeName;
  linkColor: string;
  brightness: number;
}

type Values = Readonly<Partial<AppearanceValues> & { activation?: Activation; useMyTheme?: boolean }>;

export interface SavedPreferences {
  readonly revision: number;
  readonly defaults: Values;
  readonly rules: readonly {
    readonly scope: Exclude<Scope, { kind: "default" }>;
    readonly values: Values & { readonly activation?: SiteActivation };
  }[];
}

export const DEFAULT_PREFERENCES: SavedPreferences = {
  revision: 0, defaults: { activation: "follow-system", theme: "graphite", useMyTheme: false }, rules: [],
};

export interface Page {
  readonly url: URL;
  /** Supply the known registrable domain from the fixture inventory. Omit it for host-only fixtures. */
  readonly domain?: string;
}

export interface AppearanceDraft {
  readonly scope: Scope;
  /** An absent field keeps its saved override. A null field removes that override for this preview. */
  readonly edits: { readonly [Field in keyof AppearanceValues]?: AppearanceValues[Field] | null };
}

export interface Appearance extends Readonly<AppearanceValues> {
  readonly mode: "adaptive" | "palette";
}

export interface ResolvedPreferences {
  readonly savedRevision: number;
  readonly activation: Activation;
  readonly useMyTheme: boolean;
  readonly appearance: Appearance;
  readonly sources: Readonly<Record<keyof AppearanceValues | "activation" | "useMyTheme", Scope>>;
}

const globalScope = { kind: "default" } as const;

function matches(scope: Scope, { url, domain }: Page): boolean {
  switch (scope.kind) {
    case "default": return true;
    case "domain":
      return scope.domain === domain && (url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    case "host": return scope.hostname === url.hostname;
    case "page": return scope.hostname === url.hostname && scope.path === url.pathname;
    case "section": {
      const prefix = scope.path.endsWith("/") ? scope.path : `${scope.path}/`;
      return scope.hostname === url.hostname && (url.pathname === scope.path || url.pathname.startsWith(prefix));
    }
  }
}

function specificity(scope: Scope): number {
  switch (scope.kind) {
    case "default": return 0;
    case "domain": return 1;
    case "host": return 2;
    case "section": return 3 + scope.path.length;
    case "page": return Infinity;
  }
}

function sameScope(a: Scope, b: Scope): boolean {
  switch (a.kind) {
    case "default": return b.kind === "default";
    case "domain": return b.kind === "domain" && a.domain === b.domain;
    case "host": return b.kind === "host" && a.hostname === b.hostname;
    case "section":
    case "page": return b.kind === a.kind && a.hostname === b.hostname && a.path === b.path;
  }
}

/** Resolve the top-level website for every frame. Pass the latest saved values on each evaluation. */
export function resolvePreferences(saved: SavedPreferences, page: Page, draft?: AppearanceDraft | null): ResolvedPreferences {
  const layers = [
    { scope: globalScope as Scope, values: saved.defaults },
    ...saved.rules.filter(rule => matches(rule.scope, page)),
  ];
  if (draft && matches(draft.scope, page) && !layers.some(layer => sameScope(layer.scope, draft.scope))) {
    layers.push({ scope: draft.scope, values: {} });
  }
  layers.sort((a, b) => specificity(a.scope) - specificity(b.scope));

  let theme: ThemeName = "graphite";
  let activation: Activation = "follow-system";
  let useMyTheme = false;
  let brightness: number | undefined;
  let linkColor: string | undefined;
  const sources: Record<keyof ResolvedPreferences["sources"], Scope> = {
    theme: globalScope, brightness: globalScope, linkColor: globalScope,
    activation: globalScope, useMyTheme: globalScope,
  };
  for (const layer of layers) {
    const { scope } = layer;
    const v = draft && sameScope(draft.scope, scope) ? { ...layer.values, ...draft.edits } : layer.values;
    if (v.theme != null) {
      theme = v.theme;
      sources.theme = scope;
    }
    if (v.linkColor != null) {
      linkColor = v.linkColor;
      sources.linkColor = scope;
    }
    if (v.brightness != null) {
      brightness = v.brightness;
      sources.brightness = scope;
    }
    if (v.activation !== undefined) {
      activation = v.activation;
      sources.activation = scope;
    }
    if (v.useMyTheme !== undefined) {
      useMyTheme = v.useMyTheme;
      sources.useMyTheme = scope;
    }
  }
  const base = THEMES[theme];
  if (brightness === undefined) sources.brightness = sources.theme;
  if (linkColor === undefined) sources.linkColor = sources.theme;
  return {
    savedRevision: saved.revision, activation, useMyTheme, sources,
    appearance: { theme, mode: base.mode, brightness: brightness ?? base.brightness, linkColor: linkColor ?? base.linkColor },
  };
}

export interface EligibilityInputs {
  readonly preferences: ResolvedPreferences;
  readonly topAuthorized: boolean;
  readonly frameAuthorized: boolean;
  readonly access: Access;
  readonly paused: boolean;
  readonly preview: boolean;
  readonly tabOverride: TabOverride | null;
  readonly systemDark: boolean;
  readonly scheduleActive: boolean;
  readonly topNativeDark: boolean;
  readonly frameNativeDark: boolean;
}

export type EligibilityDecision =
  | { render: true; reason: "preview" | "active" }
  | { render: false; reason: "permission" | "access-inactive" | "access-unknown" | "paused" | "tab-off"
      | "saved-off" | "outside-schedule" | "system-light" | "native-dark" };

/** Both the renderer and its element-specific compatibility fix require a positive rendering decision. */
export function decideEligibility(input: EligibilityInputs): EligibilityDecision {
  if (input.topAuthorized !== true || input.frameAuthorized !== true) return { render: false, reason: "permission" };
  if (input.access === "inactive") return { render: false, reason: "access-inactive" };
  if (input.access !== "valid" && input.access !== "refreshing-valid") return { render: false, reason: "access-unknown" };
  if (input.paused) return { render: false, reason: "paused" };
  if (input.preview) return { render: true, reason: "preview" };

  const activation = input.tabOverride ?? input.preferences.activation;
  if (activation === "off") return { render: false, reason: input.tabOverride ? "tab-off" : "saved-off" };
  if (activation === "schedule" && !input.scheduleActive) return { render: false, reason: "outside-schedule" };
  if (activation === "follow-system" && !input.systemDark) return { render: false, reason: "system-light" };
  if ((input.topNativeDark || input.frameNativeDark) && !input.preferences.useMyTheme) {
    return { render: false, reason: "native-dark" };
  }
  return { render: true, reason: "active" };
}
