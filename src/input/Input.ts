/**
 * Device layer: keyboard + mouse (pointer lock), gamepad and touch all funnel
 * into one `InputCmd` per sim tick. The sim never sees devices, only intent.
 *
 * Design notes
 *  - `yaw`/`pitch` are accumulated absolute look and are updated immediately by
 *    device events (so the renderer can read them every frame, decoupled from
 *    the fixed sim tick).
 *  - Momentary actions (jump, reload, grenade, weapon switch, quick fire taps)
 *    are latched until the next `buildCmd`, so a key pressed and released
 *    between two sim ticks is never lost. If a latched press collides with the
 *    same bit being reported on the previous tick, one tick of gap is inserted
 *    so the sim's edge detector (`buttons & ~prevButtons`) still sees a rising edge.
 *  - Aim assist (friction + magnetism) applies to gamepad and touch only.
 */
import { clamp, DEG } from '../engine/math';
import { Btn, type InputCmd } from '../sim/types';
import { TOUCH_CSS, TouchControls, type TouchHost, type TouchPress } from './touch';

export { TOUCH_CSS };

export const ACTION_IDS = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'crouch',
  'sprint',
  'reload',
  'interact',
  'grenade',
  'primary',
  'secondary',
  'next',
  'prev',
  'fire',
  'ads',
  'pause',
  'scoreboard',
  'flashlight',
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export interface InputSettings {
  /** Mouse sensitivity multiplier (1 = default). */
  sensitivity: number;
  /** Multiplier applied on top of zoom scaling while aiming down sights (0.3..1.5). */
  adsSensitivity: number;
  invertY: boolean;
  touchSensitivity: number;
  gamepadSensitivity: number;
  toggleAds: boolean;
  toggleCrouch: boolean;
  /** Touch: fire automatically while the crosshair rests on an enemy. */
  autoFire: boolean;
  /** 0..1 strength of friction/magnetism for gamepad and touch. Never applies to mouse. */
  aimAssist: number;
  /** KeyboardEvent.code values plus 'Mouse0'..'Mouse4', 'WheelUp', 'WheelDown'. */
  bindings: Record<ActionId, string[]>;
}

export const DEFAULT_BINDINGS: Record<ActionId, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['KeyC', 'ControlLeft'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  reload: ['KeyR'],
  interact: ['KeyE'],
  grenade: ['KeyG'],
  primary: ['Digit1'],
  secondary: ['Digit2'],
  next: ['WheelDown', 'KeyQ'],
  prev: ['WheelUp'],
  fire: ['Mouse0'],
  ads: ['Mouse2'],
  pause: ['Escape', 'KeyP'],
  scoreboard: ['Tab'],
  flashlight: ['KeyF'],
};

export const ACTION_LABELS: Record<ActionId, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Strafe left',
  right: 'Strafe right',
  jump: 'Jump',
  crouch: 'Crouch / slide',
  sprint: 'Sprint',
  reload: 'Reload',
  interact: 'Interact (hold)',
  grenade: 'Throw grenade',
  primary: 'Primary weapon',
  secondary: 'Secondary weapon',
  next: 'Next weapon',
  prev: 'Previous weapon',
  fire: 'Fire',
  ads: 'Aim down sights',
  pause: 'Pause',
  scoreboard: 'Scoreboard',
  flashlight: 'Flashlight',
};

export const DEFAULT_INPUT_SETTINGS: InputSettings = {
  sensitivity: 1,
  adsSensitivity: 0.8,
  invertY: false,
  touchSensitivity: 1,
  gamepadSensitivity: 1,
  toggleAds: false,
  toggleCrouch: false,
  autoFire: false,
  aimAssist: 0.6,
  bindings: DEFAULT_BINDINGS,
};

export const cloneBindings = (b: Record<ActionId, string[]> = DEFAULT_BINDINGS): Record<ActionId, string[]> => {
  const out = {} as Record<ActionId, string[]>;
  for (const id of ACTION_IDS) out[id] = [...(b[id] ?? DEFAULT_BINDINGS[id])];
  return out;
};

export const defaultInputSettings = (): InputSettings => ({ ...DEFAULT_INPUT_SETTINGS, bindings: cloneBindings() });

const num = (v: unknown, def: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : def;
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);

/** Coerce arbitrary (saved / hand-edited) data into valid InputSettings. */
export function sanitizeInputSettings(raw: unknown): InputSettings {
  const d = DEFAULT_INPUT_SETTINGS;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bindings = cloneBindings();
  const rb = r.bindings;
  if (rb && typeof rb === 'object') {
    for (const id of ACTION_IDS) {
      const v = (rb as Record<string, unknown>)[id];
      if (!Array.isArray(v)) continue;
      const codes = v.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length <= 24).slice(0, 4);
      bindings[id] = codes;
    }
  }
  return {
    sensitivity: num(r.sensitivity, d.sensitivity, 0.05, 6),
    adsSensitivity: num(r.adsSensitivity, d.adsSensitivity, 0.3, 1.5),
    invertY: bool(r.invertY, d.invertY),
    touchSensitivity: num(r.touchSensitivity, d.touchSensitivity, 0.2, 3),
    gamepadSensitivity: num(r.gamepadSensitivity, d.gamepadSensitivity, 0.2, 3),
    toggleAds: bool(r.toggleAds, d.toggleAds),
    toggleCrouch: bool(r.toggleCrouch, d.toggleCrouch),
    autoFire: bool(r.autoFire, d.autoFire),
    aimAssist: num(r.aimAssist, d.aimAssist, 0, 1),
    bindings,
  };
}

/** Human-readable label for a binding code (for settings UIs and hints). */
export function formatBinding(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const names: Record<string, string> = {
    Mouse0: 'Left Click',
    Mouse1: 'Middle Click',
    Mouse2: 'Right Click',
    Mouse3: 'Mouse 4',
    Mouse4: 'Mouse 5',
    WheelUp: 'Wheel Up',
    WheelDown: 'Wheel Down',
    Space: 'Space',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Esc',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    CapsLock: 'Caps Lock',
  };
  return names[code] ?? code;
}

/** Primary input is a finger (phones/tablets), not a touch-capable laptop. */
export function isTouchDevice(): boolean {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    const points = navigator.maxTouchPoints ?? 0;
    if (typeof window.matchMedia === 'function') {
      if (window.matchMedia('(pointer: coarse)').matches) return true;
      return points > 0 && !window.matchMedia('(pointer: fine)').matches;
    }
    return points > 0 || 'ontouchstart' in window;
  } catch {
    return false;
  }
}

/** Radial deadzone with rescale so output ramps from 0 at the edge of the deadzone to 1 at full tilt. */
export function radialDeadzone(x: number, y: number, dz: number, out: { x: number; y: number }): void {
  const m = Math.hypot(x, y);
  if (!(m > dz)) {
    out.x = 0;
    out.y = 0;
    return;
  }
  const s = Math.min(1, (m - dz) / (1 - dz)) / m;
  out.x = x * s;
  out.y = y * s;
}

export type InputMode = 'kbm' | 'touch' | 'gamepad';

// Tuning ------------------------------------------------------------------
const MOUSE_RAD_PER_PX = 0.0022;
const MOUSE_SPIKE_PX = 300;
const PITCH_LIMIT = 1.45;
const PAD_DEADZONE = 0.15;
const PAD_CURVE = 2.2;
const PAD_LOOK_RATE = 3.2; // rad/s at full tilt, sensitivity 1
const PAD_INTERACT_HOLD = 0.25;
const TOUCH_DEG_PER_PX = 0.2;
const AUTOFIRE_DELAY = 0.1;
const FRICTION_ANGLE = 3 * DEG;
const MAGNET_ANGLE = 2 * DEG;
const FRICTION_MAX_DIST = 60;
const MAGNET_MAX_DIST = 30;
const PAD_ASSIST_SCALE = 0.6; // controllers get ~60% of touch assist
const MOMENTARY = Btn.Jump | Btn.Reload | Btn.Grenade | Btn.Next | Btn.Prev | Btn.Fire;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const isEditable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
};

interface Listener {
  target: EventTarget;
  type: string;
  fn: EventListener;
  opts?: AddEventListenerOptions;
}

export class Input {
  settings: InputSettings = defaultInputSettings();
  /** Accumulated absolute look, radians. Yaw 0 faces -Z, +yaw turns left, +pitch looks up. */
  yaw = 0;
  pitch = 0;
  /** Last-used device; auto-switches on activity. */
  mode: InputMode;
  /** Convenience: canvas mousedown while playing re-acquires pointer lock. */
  autoLockOnClick = true;
  /**
   * Aim assist hook (gamepad/touch only). Fill `out` with the angular offset
   * to ADD to (yaw, pitch) to centre the crosshair on the nearest target near
   * the crosshair, plus its distance in metres; return false if none.
   */
  aimAssistTarget: ((out: { dyaw: number; dpitch: number; dist: number }) => boolean) | null = null;
  /** True if the crosshair is on an enemy (touch auto-fire). */
  onTargetProvider: (() => boolean) | null = null;
  /** Called when the active device changes. */
  onModeChange: ((mode: InputMode) => void) | null = null;

  private _enabled = true;
  private readonly down = new Set<string>();
  private readonly listeners: Listener[] = [];
  private readonly touch: TouchControls;
  private touchForced = false;
  private lastTouchAt = -1e9;

  // Latched (momentary) state, consumed by buildCmd.
  private latch = 0;
  private slotLatch = 0;
  private lastButtons = 0;
  private pauseFlag = false;
  private flashFlag = false;
  private scoreFlag = false;
  private lastPauseReq = -1e9;
  private pauseGuardUntil = 0;
  private expectUnlock = false;
  private wasLocked = false;
  private wheelAcc = 0;
  private lastWheelAt = 0;

  // Toggles.
  private adsToggled = false;
  private crouchToggled = false;
  private touchAds = false;
  private touchCrouch = false;

  // Gamepad.
  private padIndex = -1;
  private padPresent = false;
  private readonly padCur: boolean[] = new Array<boolean>(17).fill(false);
  private readonly padPrev: boolean[] = new Array<boolean>(17).fill(false);
  private padMoveF = 0;
  private padMoveR = 0;
  private padFire = false;
  private padAds = false;
  private padCrouch = false;
  private padInteract = false;
  private padXHeld = 0;
  private padSprintOn = false;
  private readonly stick = { x: 0, y: 0 };

  // Zoom used by look scaling (from the last buildCmd).
  private zoom = 1;

  // Aim assist.
  private readonly assistScratch = { dyaw: 0, dpitch: 0, dist: 0 };
  private assistFriction = 1;
  private pullYaw = 0;
  private pullPitch = 0;

  // Touch auto-fire.
  private onTargetTime = 0;
  private autoFireOn = false;
  private autoFlip = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    touchRoot: HTMLElement,
  ) {
    this.mode = isTouchDevice() ? 'touch' : 'kbm';
    const host: TouchHost = {
      look: (dx, dy) => this.touchLook(dx, dy),
      press: (a: TouchPress) => this.pressAction(a),
      toggle: (a) => {
        if (!this._enabled) return;
        if (a === 'ads') this.touchAds = !this.touchAds;
        else this.touchCrouch = !this.touchCrouch;
        this.syncTouchToggles();
      },
      activity: () => {
        this.lastTouchAt = now();
        this.markMode('touch');
      },
    };
    this.touch = new TouchControls(touchRoot, host);

    const d = document;
    this.on(d, 'keydown', this.onKeyDown as EventListener);
    this.on(d, 'keyup', this.onKeyUp as EventListener);
    this.on(d, 'mousemove', this.onMouseMove as EventListener);
    this.on(d, 'mousedown', this.onMouseDown as EventListener);
    this.on(d, 'mouseup', this.onMouseUp as EventListener);
    this.on(d, 'wheel', this.onWheel as EventListener, { passive: false });
    this.on(d, 'contextmenu', this.onContextMenu as EventListener);
    this.on(d, 'pointerlockchange', this.onPointerLockChange);
    this.on(d, 'pointerdown', this.onAnyPointerDown as EventListener, { capture: true });
    this.on(d, 'visibilitychange', this.onVisibility);
    this.on(window, 'blur', this.releaseAll);
  }

  // ------------------------------------------------------------------ state

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(v: boolean) {
    if (v === this._enabled) return;
    this._enabled = v;
    if (v) this.pauseGuardUntil = now() + 250;
    else this.clearTransient();
    this.touch.setSuspended(!v);
  }

  get pointerLocked(): boolean {
    return typeof document !== 'undefined' && document.pointerLockElement === this.canvas;
  }

  /** True while the scoreboard key is held (for hold-to-show UIs). */
  get scoreboardHeld(): boolean {
    return this.held('scoreboard');
  }

  requestPointerLock(): void {
    if (this.pointerLocked) return;
    const c = this.canvas as unknown as { requestPointerLock?: (o?: object) => Promise<void> | void };
    if (typeof c.requestPointerLock !== 'function') return;
    const swallow = (): void => undefined;
    const plain = (): void => {
      try {
        const r = c.requestPointerLock?.();
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(swallow);
      } catch {
        /* denied */
      }
    };
    try {
      // Raw (unaccelerated) mouse where supported; fall back to plain lock.
      const r = c.requestPointerLock({ unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(plain);
    } catch {
      plain();
    }
  }

  /** Release the pointer without generating a pause request. */
  exitPointerLock(): void {
    if (!this.pointerLocked) return;
    this.expectUnlock = true;
    try {
      document.exitPointerLock();
    } catch {
      this.expectUnlock = false;
    }
  }

  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  consumePause(): boolean {
    const p = this.pauseFlag;
    this.pauseFlag = false;
    return p;
  }

  consumeFlashlight(): boolean {
    const p = this.flashFlag;
    this.flashFlag = false;
    return p;
  }

  consumeScoreboard(): boolean {
    const p = this.scoreFlag;
    this.scoreFlag = false;
    return p;
  }

  showTouch(v: boolean): void {
    this.touchForced = v;
    this.touch.setVisible(v);
    if (v) this.markMode('touch');
    else if (this.mode === 'touch') this.markMode('kbm');
  }

  /**
   * Resolve with the next key / mouse button / wheel notch pressed, for rebinding
   * UIs. Escape cancels (null). Swallows the event so it triggers nothing else.
   */
  captureBinding(): Promise<string | null> {
    return new Promise((resolve) => {
      const d = document;
      const done = (v: string | null): void => {
        d.removeEventListener('keydown', kd, true);
        d.removeEventListener('mousedown', md, true);
        d.removeEventListener('wheel', wh, true);
        resolve(v);
      };
      const kd = (e: KeyboardEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        done(e.code === 'Escape' ? null : e.code);
      };
      const md = (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        done(`Mouse${e.button}`);
      };
      const wh = (e: WheelEvent): void => {
        if (e.deltaY === 0) return;
        e.preventDefault();
        e.stopPropagation();
        done(e.deltaY > 0 ? 'WheelDown' : 'WheelUp');
      };
      d.addEventListener('keydown', kd, true);
      d.addEventListener('mousedown', md, true);
      d.addEventListener('wheel', wh, { capture: true, passive: false });
    });
  }

  dispose(): void {
    for (const l of this.listeners) l.target.removeEventListener(l.type, l.fn, l.opts);
    this.listeners.length = 0;
    this.touch.dispose();
    this.exitPointerLock();
    this.down.clear();
  }

  // ------------------------------------------------------------------- frame

  /** Once per rendered frame: gamepad, touch auto-fire, aim assist. */
  poll(dt: number): void {
    const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    this.updateAssist();
    this.pollGamepad(step);
    this.pollTouch(step);
    if (this.enabled && (this.pullYaw !== 0 || this.pullPitch !== 0)) {
      this.yaw += this.pullYaw * step;
      this.pitch = clamp(this.pitch + this.pullPitch * step, -PITCH_LIMIT, PITCH_LIMIT);
    }
  }

  /** Fill `out` with this tick's movement, buttons and weapon slot; yaw/pitch are the current look. */
  buildCmd(out: InputCmd, zoom: number): InputCmd {
    this.zoom = Number.isFinite(zoom) && zoom > 1 ? zoom : 1;
    out.yaw = this.yaw;
    out.pitch = this.pitch;
    if (!this._enabled) {
      out.moveF = 0;
      out.moveR = 0;
      out.buttons = 0;
      out.slot = 0;
      this.lastButtons = 0;
      return out;
    }
    const s = this.settings;
    const t = this.touch;

    // Movement: keyboard + stick + touch stick, clamped to the unit circle.
    let mf = (this.held('forward') ? 1 : 0) - (this.held('back') ? 1 : 0) + this.padMoveF + t.moveF;
    let mr = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0) + this.padMoveR + t.moveR;
    const ml = Math.hypot(mf, mr);
    if (ml > 1) {
      mf /= ml;
      mr /= ml;
    }
    out.moveF = mf;
    out.moveR = mr;

    // Aim / crouch resolve toggles.
    const adsRaw = this.held('ads') || this.padAds;
    const crouchRaw = this.held('crouch') || this.padCrouch;
    const ads = (s.toggleAds ? this.adsToggled : adsRaw) || this.touchAds;
    const crouch = (s.toggleCrouch ? this.crouchToggled : crouchRaw) || this.touchCrouch;

    let b = 0;
    if (ads) b |= Btn.Ads;
    if (crouch) b |= Btn.Crouch;
    if (this.held('interact') || this.padInteract || t.interact) b |= Btn.Interact;
    if (this.held('jump')) b |= Btn.Jump;
    if (this.held('fire') || this.padFire || t.fire) b |= Btn.Fire;
    if (this.autoFireOn) {
      // Pulse the trigger so semi-automatic weapons also keep firing.
      this.autoFlip = !this.autoFlip;
      if (this.autoFlip) b |= Btn.Fire;
    } else this.autoFlip = false;
    const sprint = this.held('sprint') || this.padSprintOn || t.sprint;
    if (sprint && !this.autoFireOn && !ads) b |= Btn.Sprint;

    // Latched presses: guarantee a rising edge even for taps shorter than a tick.
    const lat = this.latch;
    const gap = lat & this.lastButtons & MOMENTARY;
    b = (b | (lat & ~gap)) & ~gap;
    this.latch = gap;

    out.buttons = b;
    out.slot = this.slotLatch;
    this.slotLatch = 0;
    this.lastButtons = b;
    return out;
  }

  // ------------------------------------------------------------ action logic

  private pressAction(a: ActionId): void {
    if (!this._enabled) return;
    switch (a) {
      case 'jump':
        this.latch |= Btn.Jump;
        break;
      case 'reload':
        this.latch |= Btn.Reload;
        break;
      case 'grenade':
        this.latch |= Btn.Grenade;
        break;
      case 'next':
        this.latch |= Btn.Next;
        break;
      case 'prev':
        this.latch |= Btn.Prev;
        break;
      case 'fire':
        this.latch |= Btn.Fire;
        break;
      case 'primary':
        this.slotLatch = 1;
        break;
      case 'secondary':
        this.slotLatch = 2;
        break;
      case 'ads':
        if (this.settings.toggleAds) this.adsToggled = !this.adsToggled;
        this.syncTouchToggles();
        break;
      case 'crouch':
        if (this.settings.toggleCrouch) this.crouchToggled = !this.crouchToggled;
        this.syncTouchToggles();
        break;
      case 'pause':
        this.requestPause();
        break;
      case 'flashlight':
        this.flashFlag = true;
        break;
      case 'scoreboard':
        this.scoreFlag = true;
        break;
      case 'forward':
      case 'back':
      case 'left':
      case 'right':
      case 'sprint':
      case 'interact':
        break;
    }
  }

  private requestPause(): void {
    const t = now();
    if (!this._enabled || t < this.pauseGuardUntil) return;
    this.pauseFlag = true;
    this.lastPauseReq = t;
  }

  private syncTouchToggles(): void {
    const s = this.settings;
    this.touch.setToggle('ads', s.toggleAds ? this.adsToggled || this.touchAds : this.touchAds);
    this.touch.setToggle('crouch', s.toggleCrouch ? this.crouchToggled || this.touchCrouch : this.touchCrouch);
  }

  private codes(a: ActionId): readonly string[] {
    return this.settings.bindings[a] ?? DEFAULT_BINDINGS[a];
  }

  private held(a: ActionId): boolean {
    const c = this.codes(a);
    for (let i = 0; i < c.length; i += 1) if (this.down.has(c[i])) return true;
    return false;
  }

  private isBound(code: string): boolean {
    for (const a of ACTION_IDS) if (this.codes(a).includes(code)) return true;
    return false;
  }

  private pressCode(code: string): void {
    for (const a of ACTION_IDS) if (this.codes(a).includes(code)) this.pressAction(a);
  }

  /** Drop everything transient (menus opened, focus lost). */
  private clearTransient(): void {
    this.latch = 0;
    this.slotLatch = 0;
    this.lastButtons = 0;
    this.flashFlag = false;
    this.scoreFlag = false;
    this.adsToggled = false;
    this.crouchToggled = false;
    this.touchAds = false;
    this.touchCrouch = false;
    this.padMoveF = 0;
    this.padMoveR = 0;
    this.padFire = false;
    this.padAds = false;
    this.padCrouch = false;
    this.padInteract = false;
    this.padXHeld = 0;
    this.padSprintOn = false;
    this.onTargetTime = 0;
    this.autoFireOn = false;
    this.assistFriction = 1;
    this.pullYaw = 0;
    this.pullPitch = 0;
    this.wheelAcc = 0;
    this.touch.reset();
    this.syncTouchToggles();
  }

  private markMode(m: InputMode): void {
    if (m === 'touch') {
      if (!this.touch.visible && this._enabled) this.touch.setVisible(true);
    } else if (this.mode === 'touch' && !this.touchForced && this.touch.visible) {
      this.touch.setVisible(false);
    }
    if (m === this.mode) return;
    this.mode = m;
    this.onModeChange?.(m);
  }

  private touchRecently(): boolean {
    return now() - this.lastTouchAt < 600;
  }

  // -------------------------------------------------------------- look maths

  /** Combined look scale for the current zoom (ADS): (1/zoom)^0.8, blended with adsSensitivity. */
  private lookScale(): number {
    const z = this.zoom;
    if (z <= 1.0001) return 1;
    const mix = clamp((z - 1) / 0.05, 0, 1);
    return Math.pow(1 / z, 0.8) * (1 + (this.settings.adsSensitivity - 1) * mix);
  }

  private addLook(dyaw: number, dpitch: number): void {
    this.yaw += dyaw;
    this.pitch = clamp(this.pitch + dpitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  private touchLook(dx: number, dy: number): void {
    if (!this._enabled) return;
    const s = this.settings;
    const k = TOUCH_DEG_PER_PX * DEG * s.touchSensitivity * this.lookScale() * this.assistFriction;
    this.addLook(-dx * k, -dy * k * (s.invertY ? -1 : 1));
  }

  private updateAssist(): void {
    this.assistFriction = 1;
    this.pullYaw = 0;
    this.pullPitch = 0;
    if (this.mode === 'kbm' || !this._enabled || !this.aimAssistTarget) return;
    const strength = clamp(this.settings.aimAssist, 0, 1) * (this.mode === 'gamepad' ? PAD_ASSIST_SCALE : 1);
    if (strength <= 0) return;
    const t = this.assistScratch;
    t.dyaw = 0;
    t.dpitch = 0;
    t.dist = 0;
    if (!this.aimAssistTarget(t)) return;
    const ang = Math.hypot(t.dyaw, t.dpitch);
    if (!(ang < FRICTION_ANGLE) || !(t.dist <= FRICTION_MAX_DIST)) return;
    // Friction: up to 50% slower reticle right on the target, fading out at 3 degrees.
    this.assistFriction = 1 - 0.5 * strength * (1 - ang / FRICTION_ANGLE);
    // Magnetism: gentle pull while aiming or firing, within 2 degrees and 30 m.
    const engaged = this.zoom > 1 || (this.lastButtons & (Btn.Fire | Btn.Ads)) !== 0;
    if (engaged && ang <= MAGNET_ANGLE && t.dist <= MAGNET_MAX_DIST) {
      const pull = strength * 3 * (1 - 0.5 * (t.dist / MAGNET_MAX_DIST));
      this.pullYaw = t.dyaw * pull;
      this.pullPitch = t.dpitch * pull;
    }
  }

  private pollTouch(dt: number): void {
    const s = this.settings;
    if (s.autoFire && this.mode === 'touch' && this._enabled && this.onTargetProvider?.()) this.onTargetTime += dt;
    else this.onTargetTime = 0;
    this.autoFireOn = this.onTargetTime >= AUTOFIRE_DELAY;
  }

  // ----------------------------------------------------------------- gamepad

  private findPad(): Gamepad | null {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
    let list: ArrayLike<Gamepad | null>;
    try {
      list = navigator.getGamepads();
    } catch {
      return null;
    }
    let best: Gamepad | null = null;
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      if (!p || !p.connected) continue;
      if (p.index === this.padIndex) return p;
      if (!best || (p.mapping === 'standard' && best.mapping !== 'standard')) best = p;
    }
    return best;
  }

  private resetPad(): void {
    this.padMoveF = 0;
    this.padMoveR = 0;
    this.padFire = false;
    this.padAds = false;
    this.padCrouch = false;
    this.padInteract = false;
    this.padXHeld = 0;
    this.padSprintOn = false;
    this.padPrev.fill(false);
    this.padCur.fill(false);
  }

  private pollGamepad(dt: number): void {
    const pad = this.findPad();
    if (!pad) {
      if (this.padPresent) {
        this.padPresent = false;
        this.resetPad();
      }
      return;
    }
    this.padPresent = true;
    const cur = this.padCur;
    const prev = this.padPrev;
    const btns = pad.buttons;
    for (let i = 0; i < cur.length; i += 1) {
      const b = btns[i];
      cur[i] = b ? b.pressed || b.value > 0.5 : false;
    }
    // Analog triggers with a little hysteresis.
    const lt = btns[6]?.value ?? 0;
    const rt = btns[7]?.value ?? 0;
    cur[6] = prev[6] ? lt > 0.2 : lt > 0.4;
    cur[7] = prev[7] ? rt > 0.2 : rt > 0.4;

    const ax = pad.axes;
    const st = this.stick;
    radialDeadzone(ax[0] ?? 0, ax[1] ?? 0, PAD_DEADZONE, st);
    const mx = st.x;
    const my = st.y;
    radialDeadzone(ax[2] ?? 0, ax[3] ?? 0, PAD_DEADZONE, st);
    const lx = st.x;
    const ly = st.y;

    let active = Math.hypot(ax[0] ?? 0, ax[1] ?? 0) > 0.4 || Math.hypot(ax[2] ?? 0, ax[3] ?? 0) > 0.4;
    for (let i = 0; i < cur.length && !active; i += 1) if (cur[i] && !prev[i]) active = true;
    if (active) {
      this.padIndex = pad.index;
      this.markMode('gamepad');
    }

    if (!this._enabled) {
      // Keep edge state in sync so nothing fires the moment we re-enable.
      this.padMoveF = 0;
      this.padMoveR = 0;
      this.padFire = false;
      this.padAds = false;
      prev.splice(0, prev.length, ...cur);
      return;
    }

    this.padMoveR = mx;
    this.padMoveF = -my;
    if (this.padSprintOn && (Math.hypot(mx, my) < 0.1 || cur[6])) this.padSprintOn = false;

    // Look: response curve, sensitivity, ADS scaling, assist friction.
    const lm = Math.hypot(lx, ly);
    if (lm > 0) {
      const s = this.settings;
      const k = (Math.pow(lm, PAD_CURVE) / lm) * PAD_LOOK_RATE * s.gamepadSensitivity * this.lookScale() * this.assistFriction * dt;
      this.addLook(-lx * k, -ly * k * (s.invertY ? -1 : 1));
    }

    const edge = (i: number): boolean => cur[i] && !prev[i];
    this.padFire = cur[7];
    this.padAds = cur[6];
    this.padCrouch = cur[1];
    if (edge(7)) this.pressAction('fire');
    if (edge(6)) this.pressAction('ads');
    if (edge(1)) this.pressAction('crouch');
    if (edge(0)) this.pressAction('jump');
    if (edge(3)) this.pressAction('next');
    if (edge(5)) this.pressAction('grenade');
    if (edge(9)) this.pressAction('pause');
    if (edge(8)) this.pressAction('scoreboard');
    if (edge(12)) this.pressAction('flashlight');
    if (edge(10)) this.padSprintOn = !this.padSprintOn;

    // X: tap = reload (on release), hold = interact.
    if (cur[2]) {
      this.padXHeld += dt;
      this.padInteract = this.padXHeld >= PAD_INTERACT_HOLD;
    } else {
      if (prev[2] && this.padXHeld < PAD_INTERACT_HOLD) this.pressAction('reload');
      this.padXHeld = 0;
      this.padInteract = false;
    }

    for (let i = 0; i < cur.length; i += 1) prev[i] = cur[i];
  }

  // ------------------------------------------------------------ DOM handlers

  private on(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.listeners.push({ target, type, fn, opts });
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isEditable(e.target) || e.metaKey || !e.code) return;
    if (!this._enabled) {
      this.down.add(e.code);
      return;
    }
    if (!this.isBound(e.code)) return;
    e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    this.markMode('kbm');
    this.pressCode(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this._enabled || !this.pointerLocked || this.touchRecently()) return;
    const dx = e.movementX;
    const dy = e.movementY;
    // Ignore giant spikes (pointer-lock glitches) and NaN.
    if (!(Math.abs(dx) <= MOUSE_SPIKE_PX && Math.abs(dy) <= MOUSE_SPIKE_PX)) return;
    if (dx === 0 && dy === 0) return;
    if (this.mode !== 'kbm') this.markMode('kbm');
    const s = this.settings;
    const k = MOUSE_RAD_PER_PX * s.sensitivity * this.lookScale();
    this.addLook(-dx * k, -dy * k * (s.invertY ? -1 : 1));
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (this.touchRecently()) return;
    if (this._enabled && !this.pointerLocked) {
      if (this.autoLockOnClick && e.target === this.canvas && this.mode !== 'touch') {
        e.preventDefault();
        this.requestPointerLock();
      }
      return;
    }
    if (!this._enabled) return;
    e.preventDefault();
    const code = `Mouse${e.button}`;
    this.down.add(code);
    this.markMode('kbm');
    this.pressCode(code);
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    this.down.delete(`Mouse${e.button}`);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this._enabled || !this.pointerLocked) return;
    e.preventDefault();
    this.wheelAcc += e.deltaMode === 0 ? e.deltaY : e.deltaY * 40;
    if (Math.abs(this.wheelAcc) < 40) return;
    const code = this.wheelAcc > 0 ? 'WheelDown' : 'WheelUp';
    this.wheelAcc = 0;
    const t = now();
    if (t - this.lastWheelAt < 90) return;
    this.lastWheelAt = t;
    this.markMode('kbm');
    this.pressCode(code);
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    if (this.pointerLocked || e.target === this.canvas) e.preventDefault();
  };

  private readonly onPointerLockChange = (): void => {
    const locked = this.pointerLocked;
    if (!locked && this.wasLocked) {
      this.down.delete('Mouse0');
      this.down.delete('Mouse1');
      this.down.delete('Mouse2');
      if (this.expectUnlock) this.expectUnlock = false;
      else if (this._enabled && now() - this.lastPauseReq > 300) this.requestPause();
    }
    this.wasLocked = locked;
  };

  private readonly onAnyPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    this.lastTouchAt = now();
    if (this._enabled && !this.touch.visible) this.markMode('touch');
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      this.releaseAll();
      this.requestPause();
    }
  };

  private readonly releaseAll = (): void => {
    this.down.clear();
    this.padSprintOn = false;
    this.touch.reset();
  };
}
