/**
 * The kinds of slip the `mistakes` option can produce.
 *
 * Caught while drawing: `oversize` (an outline too big), `misplace` (an outline in the
 * wrong spot), `overshoot` (a line too long), `nudge` (a duplicate dropped off target),
 * `retype` (text partly deleted and typed again).
 *
 * Caught once the piece is built: `place` (out of place, then moved), `size` (too big,
 * then resized from the corner), `round` (square corners, then rounded off).
 */
export type SlipKind = 'oversize' | 'misplace' | 'overshoot' | 'nudge' | 'retype' | 'place' | 'size' | 'round';

/** Options for {@link crowdsurf}. Every one is optional. */
export interface CrowdsurfOptions {
  /** Cursors working at once in calm conditions. Default `5`. */
  agents?: number;
  /** Ceiling on cursors when a backlog builds up, as when scrolling fast. Default `12`. */
  maxAgents?: number;
  /** Build speed multiplier. Default `1`. */
  speed?: number;
  /** Share of pieces (0 to 1) built with a slip that is then corrected. Default `0`, which is off. */
  mistakes?: number;
  /**
   * How much more or less often each kind of slip happens. A weight multiplies that
   * kind's rate: `0` turns it off, `2` doubles it. Kinds left out stay at `1`.
   */
  slips?: Partial<Record<SlipKind, number>>;
  /** Cursors travel in hand-like curves, sometimes overshooting a little. Default `false`. */
  naturalMovement?: boolean;
  /** Between jobs a cursor sometimes loiters, or reads along a line of text. Default `false`. */
  dillyDally?: boolean;
  /** IntersectionObserver margin deciding when an element counts as on screen. Default `'0px'`. */
  rootMargin?: string;
  /** Selector for elements (and their contents) that are left alone. Default `'[data-crowdsurf-ignore]'`. */
  ignore?: string;
  /** Cursor names. Defaults to a built-in list. */
  names?: string[] | null;
  /** Cursor colors as 6-digit hex. Defaults to a built-in palette. */
  colors?: string[] | null;
  /**
   * Skip regions a visitor has already seen built: `'session'` until the tab closes,
   * `true` for good, or a number of days. Default `false`.
   */
  once?: boolean | 'session' | number;
  /** What `once` remembers a page by. Defaults to the page's path. */
  onceKey?: string;
  /** Also build elements added to a region after it was planned. Default `false`. */
  watch?: boolean;
  /** Do nothing for visitors who prefer reduced motion. Default `true`. */
  respectReducedMotion?: boolean;
}

/** One targeted element and its build state. */
export interface CrowdsurfRegion {
  /** The targeted element. */
  readonly el: Element;
  /** Pieces built so far. */
  readonly done: number;
  /** Pieces planned. */
  readonly total: number;
  readonly completed: boolean;
  /** Deliberate mistakes played so far (see `mistakes`). */
  readonly slips: number;
  /** The same, by kind. */
  readonly slipCounts: Partial<Record<SlipKind, number>>;
  /** Times a cursor dawdled between jobs (see `dillyDally`). */
  readonly dallies: number;
}

export type CrowdsurfEventType = 'start' | 'progress' | 'complete';

export interface CrowdsurfEvent {
  type: CrowdsurfEventType;
  region: CrowdsurfRegion;
  /** The region's element. */
  element: Element;
  done: number;
  total: number;
}

/** What {@link crowdsurf} returns: a handle on everything it set up. */
export interface Crowdsurf {
  readonly options: Required<CrowdsurfOptions>;
  readonly regions: CrowdsurfRegion[];
  /** Pieces built and planned, across every region. */
  readonly progress: { done: number; total: number };
  /** True when every region has finished. */
  readonly complete: boolean;
  /** How many targets were left as they are because of `once`. */
  readonly skipped: number;
  /** Listen for an event. Each fires once per region. */
  on(type: CrowdsurfEventType, listener: (event: CrowdsurfEvent) => void): this;
  off(type: CrowdsurfEventType, listener: (event: CrowdsurfEvent) => void): this;
  /** Change options while running, e.g. `set({ speed: 2 })`. */
  set(options: CrowdsurfOptions): this;
  /** Build everything that is left, instantly. */
  finish(): this;
  /** Hide everything again and rebuild, including anything `once` had skipped. */
  replay(): this;
  /** Stop, and put every element back exactly as it was. */
  destroy(): void;
}

/** A selector, an element, or a collection of elements. */
export type CrowdsurfTarget = string | Element | Iterable<Element>;

/**
 * Build part or all of a page in front of the reader as they scroll.
 *
 * @param target What to build. Defaults to every `[data-crowdsurf]` element.
 */
export function crowdsurf(target?: CrowdsurfTarget, options?: CrowdsurfOptions): Crowdsurf;
export default crowdsurf;

/** Forget every region remembered by the `once` option, so they build again. */
export function forget(): void;

/** How many cursors are working right now, across every region. */
export function activeAgents(): number;

/** Every kind of slip, by name. */
export const SLIP_KINDS: SlipKind[];

/** The default value of every option. */
export const DEFAULTS: Required<CrowdsurfOptions>;

declare global {
  interface HTMLElementEventMap {
    'crowdsurf:start': CustomEvent<CrowdsurfEvent>;
    'crowdsurf:complete': CustomEvent<CrowdsurfEvent>;
  }
}
