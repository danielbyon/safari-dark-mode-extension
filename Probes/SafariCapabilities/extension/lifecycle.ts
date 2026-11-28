import type { AppearanceDraft, Scope, TabOverride } from "./eligibility.ts";

export interface PageDocument {
  /** Use a browser document ID or a unique ID from its live content-script registration. */
  readonly documentId: string;
  readonly url: string;
}

/** Only this small record may be kept in browser-session storage across background suspension. */
export interface OverrideRecord {
  readonly tabId: number;
  readonly lifetimeId: string;
  readonly hostname: string;
  readonly value: TabOverride;
}

export interface WorkToken {
  readonly generation: number;
  readonly signal: AbortSignal;
}

/**
 * Keep one instance per live tab. Supply a fresh lifetimeId for a new, duplicated or restored tab.
 * Reuse it after background suspension only when the adapter can establish continuity of that tab
 * and its hostname. A tab number and a matching URL do not establish continuity.
 */
export class TabLifecycle {
  readonly tabId: number;
  readonly lifetimeId: string;
  #documentId: string;
  #url: URL;
  #tabOverride: TabOverride | null = null;
  #preview: AppearanceDraft | null = null;
  #editor: symbol | null = null;
  #generation = 0;
  #controller = new AbortController();
  #closed = false;
  #canRestore = true;

  constructor(tabId: number, document: PageDocument, lifetimeId: string) {
    this.tabId = tabId;
    this.lifetimeId = lifetimeId;
    this.#url = new URL(document.url);
    this.#documentId = document.documentId;
  }

  get preview(): AppearanceDraft | null { return this.#preview; }
  get tabOverride(): TabOverride | null { return this.#tabOverride; }

  get overrideRecord(): OverrideRecord | null {
    if (this.#tabOverride === null) return null;
    return { tabId: this.tabId, lifetimeId: this.lifetimeId, hostname: this.#url.hostname, value: this.#tabOverride };
  }

  /** Restore an override from session storage before a local edit or cross-host navigation supersedes it. */
  restoreOverride(value: unknown): boolean {
    if (!this.#canRestore || value === null || typeof value !== "object") return false;
    const record = value as Partial<OverrideRecord>;
    if (record.tabId !== this.tabId || record.lifetimeId !== this.lifetimeId
      || record.hostname !== this.#url.hostname || (record.value !== "on" && record.value !== "off")) return false;
    return this.setOverride(record.value);
  }

  setOverride(value: TabOverride | null): boolean {
    if (this.#closed) return false;
    this.#canRestore = false;
    if (this.#tabOverride !== value) {
      this.#tabOverride = value;
      this.invalidate();
    }
    return true;
  }

  /** Call for every observed top-level navigation, including same-document history and anchor changes. */
  navigate(document: PageDocument): void {
    if (this.#closed) return;
    const next = new URL(document.url);
    if (document.documentId === this.#documentId && next.href === this.#url.href) return;
    if (next.hostname !== this.#url.hostname) {
      this.#tabOverride = null;
      this.#canRestore = false;
    }
    this.#documentId = document.documentId;
    this.#url = next;
    this.#editor = null;
    this.#preview = null;
    this.invalidate();
  }

  /** Keep the returned handle on the popup's live background connection. Discard it on disconnect. */
  openEditor(): symbol {
    if (this.#closed) throw new Error("Cannot open an editor for a closed tab");
    const editor = Symbol("editor");
    this.#editor = editor;
    if (this.#preview) {
      this.#preview = null;
      this.invalidate();
    }
    return editor;
  }

  ownsEditor(editor: symbol | undefined): boolean {
    return editor !== undefined && this.#editor === editor;
  }

  setPreview(editor: symbol, draft: AppearanceDraft): boolean {
    if (this.#editor === null || this.#editor !== editor) return false;
    this.#preview = Object.freeze({
      scope: Object.freeze({ ...draft.scope }), edits: Object.freeze({ ...draft.edits }),
    });
    this.invalidate();
    return true;
  }

  changeScope(editor: symbol, scope: Scope): boolean {
    if (this.#preview === null) return false;
    return this.setPreview(editor, { scope, edits: this.#preview.edits });
  }

  closeEditor(editor: symbol): boolean {
    if (this.#editor === null || this.#editor !== editor) return false;
    this.#editor = null;
    if (this.#preview !== null) {
      this.#preview = null;
      this.invalidate();
    }
    return true;
  }

  /**
   * Call synchronously when a grant, access, pause, saved revision, schedule, or native-dark result changes.
   * A completion must still call isCurrent before applying its result if its operation ignored cancellation.
   */
  invalidate(): void {
    if (this.#closed) return;
    const previous = this.#controller;
    this.#generation++;
    this.#controller = new AbortController();
    previous.abort();
  }

  beginWork(): WorkToken {
    return { generation: this.#generation, signal: this.#controller.signal };
  }

  isCurrent(work: WorkToken): boolean {
    return !this.#closed && this.#controller.signal === work.signal && this.#generation === work.generation;
  }

  close(): void {
    this.#closed = true;
    this.#canRestore = false;
    this.#editor = null;
    this.#preview = null;
    this.#tabOverride = null;
    this.#controller.abort();
  }
}
