/**
 * On-screen touch controls: floating move stick, drag-to-look, and a cluster of
 * frosted action buttons. Pure DOM + Pointer Events (tracked by pointerId,
 * `touch-action: none`). The class owns no game state: it reports intent to a
 * host (Input) through callbacks and exposes the analog stick / held buttons.
 */

export type TouchPress = 'jump' | 'reload' | 'grenade' | 'next' | 'pause' | 'flashlight';
export type TouchToggle = 'ads' | 'crouch';

export interface TouchHost {
  /** Look drag in CSS pixels (screen-space delta since the previous event). */
  look(dxPx: number, dyPx: number): void;
  /** Momentary button pressed (edge). */
  press(action: TouchPress): void;
  /** Toggle-style button tapped. */
  toggle(action: TouchToggle): void;
  /** Any touch interaction happened (lets the host switch its device mode). */
  activity(): void;
}

/** Floating stick geometry (CSS px) and tuning. */
export const STICK_RADIUS = 60;
export const STICK_DEADZONE = 0.1;
/** Ignore pointer-glitch deltas larger than this per event. */
const LOOK_SPIKE_PX = 180;

export const TOUCH_CSS = /* css */ `
.tc-root{position:fixed;inset:0;z-index:30;pointer-events:none;touch-action:none;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;
  --k:1;--tc-fg:rgba(255,255,255,.94);--tc-bg:rgba(14,16,20,.44);--tc-border:rgba(255,255,255,.3);
  --tc-accent:#ffbe6e;--tc-accent-bg:rgba(255,178,90,.3);
  --tc-il:env(safe-area-inset-left,0px);--tc-ir:env(safe-area-inset-right,0px);
  --tc-ib:env(safe-area-inset-bottom,0px);--tc-it:env(safe-area-inset-top,0px)}
.tc-root.tc-hidden,.tc-root.tc-suspended{display:none!important}
.tc-zone{position:absolute;pointer-events:auto;touch-action:none}
.tc-move-zone{left:0;top:26%;bottom:0;width:45%}
.tc-look-zone{right:0;top:0;bottom:0;width:55%}
.tc-hint{position:absolute;left:calc(var(--tc-il) + 52px);bottom:calc(var(--tc-ib) + 36px);
  width:120px;height:120px;border-radius:50%;border:1.5px dashed rgba(255,255,255,.2);
  background:radial-gradient(circle,rgba(255,255,255,.05),rgba(255,255,255,0) 70%);
  transition:opacity .15s;pointer-events:none}
.tc-hint::after{content:'';position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;
  border-radius:50%;border:1.5px solid rgba(255,255,255,.16)}
.tc-moving .tc-hint{opacity:0}
.tc-stick{position:absolute;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;
  background:radial-gradient(circle,rgba(255,255,255,.1),rgba(14,16,20,.42) 72%);
  border:1.5px solid var(--tc-border);box-shadow:0 2px 14px rgba(0,0,0,.35);
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;transition:opacity .12s;pointer-events:none}
.tc-moving .tc-stick{opacity:1}
.tc-knob{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.5),rgba(255,255,255,.2));
  border:1.5px solid rgba(255,255,255,.6);box-shadow:0 2px 8px rgba(0,0,0,.4);will-change:transform}
.tc-sprint .tc-knob{background:radial-gradient(circle at 35% 30%,rgba(255,220,160,.85),rgba(255,178,90,.4));border-color:var(--tc-accent)}
.tc-btn{position:absolute;pointer-events:auto;touch-action:none;box-sizing:border-box;
  display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:50%;
  --s:60px;--r:20px;--b:20px;
  width:calc(var(--s)*var(--k));height:calc(var(--s)*var(--k));
  right:calc(var(--tc-ir) + var(--r)*var(--k));bottom:calc(var(--tc-ib) + var(--b)*var(--k));
  color:var(--tc-fg);background:var(--tc-bg);border:1.5px solid var(--tc-border);
  -webkit-backdrop-filter:blur(8px) saturate(1.25);backdrop-filter:blur(8px) saturate(1.25);
  box-shadow:0 2px 10px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.14);
  transition:transform .06s ease,background .08s ease,border-color .08s ease,box-shadow .08s ease}
.tc-g{font-size:calc(var(--s)*var(--k)*.36);line-height:1;font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.tc-l{font-size:9px;line-height:1;letter-spacing:.09em;font-weight:700;opacity:.68;margin-top:3px}
.tc-btn.tc-active{transform:scale(.91);background:rgba(255,255,255,.24);border-color:rgba(255,255,255,.75)}
.tc-btn.tc-on{background:var(--tc-accent-bg);border-color:var(--tc-accent);box-shadow:0 0 16px rgba(255,178,90,.38),inset 0 1px 0 rgba(255,255,255,.14)}
.tc-fire{--s:92px;--r:26px;--b:30px;border-color:rgba(255,190,110,.62)}
.tc-fire .tc-g{font-size:calc(var(--s)*var(--k)*.4)}
.tc-ads{--s:64px;--r:132px;--b:44px}
.tc-jump{--s:64px;--r:40px;--b:138px}
.tc-reload{--s:56px;--r:122px;--b:130px}
.tc-crouch{--s:56px;--r:212px;--b:76px}
.tc-grenade{--s:56px;--r:46px;--b:214px}
.tc-swap{--s:56px;--r:130px;--b:202px}
.tc-interact{--s:58px;--r:204px;--b:146px}
.tc-pause{--s:56px;--r:14px;bottom:auto;top:calc(var(--tc-it) + 10px)}
.tc-light{--s:56px;--r:82px;bottom:auto;top:calc(var(--tc-it) + 10px)}
@media (min-height:560px) and (orientation:landscape){.tc-root{--k:1.2}}
@media (min-height:760px) and (orientation:landscape){.tc-root{--k:1.4}}
@media (orientation:portrait){
  .tc-root{--k:.92}
  .tc-move-zone{top:40%}
  .tc-fire{--r:18px;--b:36px;--s:84px}
  .tc-jump{--r:112px;--b:40px}
  .tc-ads{--r:24px;--b:132px}
  .tc-reload{--r:112px;--b:118px}
  .tc-grenade{--r:24px;--b:208px}
  .tc-crouch{--r:112px;--b:190px}
  .tc-swap{--r:24px;--b:280px}
  .tc-interact{--r:112px;--b:262px}
}
@media (prefers-reduced-motion:reduce){.tc-btn,.tc-stick,.tc-hint{transition:none}}
`;

interface ButtonSpec {
  cls: string;
  glyph: string;
  label: string;
  aria: string;
}

let styleInjected = false;
function ensureStyle(): void {
  if (styleInjected || typeof document === 'undefined') return;
  if (document.getElementById('tc-style')) {
    styleInjected = true;
    return;
  }
  const el = document.createElement('style');
  el.id = 'tc-style';
  el.textContent = TOUCH_CSS;
  document.head.appendChild(el);
  styleInjected = true;
}

export class TouchControls {
  /** Move stick output after deadzone, -1..1. moveF > 0 = forward. */
  moveF = 0;
  moveR = 0;
  /** Stick pushed to (near) its rim while heading forward: auto-sprint. */
  sprint = false;
  fire = false;
  interact = false;

  private readonly root: HTMLDivElement;
  private readonly moveZone: HTMLDivElement;
  private readonly stick: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLDivElement>();
  private readonly cleanups: (() => void)[] = [];
  private movePointer = -1;
  private originX = 0;
  private originY = 0;
  private readonly lookPointers = new Map<number, { x: number; y: number }>();
  private readonly held = new Map<number, HTMLElement>();
  private _visible = false;
  private _suspended = false;

  constructor(
    parent: HTMLElement,
    private readonly host: TouchHost,
  ) {
    ensureStyle();
    const root = document.createElement('div');
    root.className = 'tc-root tc-hidden';
    root.setAttribute('aria-hidden', 'true');
    this.root = root;

    // Move stick zone.
    this.moveZone = this.el('div', 'tc-zone tc-move-zone');
    const hint = this.el('div', 'tc-hint');
    this.stick = this.el('div', 'tc-stick');
    this.knob = this.el('div', 'tc-knob');
    this.stick.appendChild(this.knob);
    this.moveZone.append(hint, this.stick);
    root.appendChild(this.moveZone);
    this.bindMove(this.moveZone);

    // Look zone (whole right side, under the buttons).
    const lookZone = this.el('div', 'tc-zone tc-look-zone');
    root.appendChild(lookZone);
    this.bindLook(lookZone);

    // Buttons.
    const fire = this.button({ cls: 'tc-fire', glyph: '◉', label: 'FIRE', aria: 'Fire' });
    this.bindHold(fire, (on) => {
      this.fire = on;
    });
    this.bindLook(fire); // dragging from the fire button also looks

    this.bindToggle(this.button({ cls: 'tc-ads', glyph: '⊕', label: 'ADS', aria: 'Aim down sights' }), 'ads');
    this.bindPress(this.button({ cls: 'tc-jump', glyph: '▲', label: 'JUMP', aria: 'Jump' }), 'jump');
    this.bindToggle(this.button({ cls: 'tc-crouch', glyph: '▼', label: 'CROUCH', aria: 'Crouch' }), 'crouch');
    this.bindPress(this.button({ cls: 'tc-reload', glyph: '↻', label: 'RELOAD', aria: 'Reload' }), 'reload');
    this.bindPress(this.button({ cls: 'tc-grenade', glyph: '✸', label: 'NADE', aria: 'Grenade' }), 'grenade');
    this.bindPress(this.button({ cls: 'tc-swap', glyph: '⇄', label: 'SWAP', aria: 'Swap weapon' }), 'next');
    this.bindHold(this.button({ cls: 'tc-interact', glyph: 'USE', label: 'HOLD', aria: 'Interact (hold)' }), (on) => {
      this.interact = on;
    });
    this.bindPress(this.button({ cls: 'tc-pause', glyph: '❚❚', label: '', aria: 'Pause' }), 'pause');
    this.bindPress(this.button({ cls: 'tc-light', glyph: '☼', label: 'LIGHT', aria: 'Flashlight' }), 'flashlight');

    // Don't let long-presses open context menus or select text.
    this.listen(root, 'contextmenu', (e) => e.preventDefault());

    parent.appendChild(root);
    this.cleanups.push(() => root.remove());
  }

  get visible(): boolean {
    return this._visible;
  }

  setVisible(v: boolean): void {
    if (v === this._visible) return;
    this._visible = v;
    this.root.classList.toggle('tc-hidden', !v);
    if (!v) this.reset();
  }

  /** Temporarily hide (menus/pause) without forgetting the visible preference. */
  setSuspended(v: boolean): void {
    if (v === this._suspended) return;
    this._suspended = v;
    this.root.classList.toggle('tc-suspended', v);
    if (v) this.reset();
  }

  /** Reflect a toggle state (ADS / crouch) on its button. */
  setToggle(name: TouchToggle, on: boolean): void {
    this.buttons.get(name)?.classList.toggle('tc-on', on);
  }

  /** Release everything (pointers, held buttons, stick). */
  reset(): void {
    this.movePointer = -1;
    this.lookPointers.clear();
    for (const el of this.held.values()) el.classList.remove('tc-active');
    this.held.clear();
    this.moveF = 0;
    this.moveR = 0;
    this.sprint = false;
    this.fire = false;
    this.interact = false;
    this.root.classList.remove('tc-moving', 'tc-sprint');
    this.knob.style.transform = '';
  }

  dispose(): void {
    this.reset();
    for (const c of this.cleanups) c();
    this.cleanups.length = 0;
  }

  // ---------------------------------------------------------------- building

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = cls;
    return e;
  }

  private button(spec: ButtonSpec): HTMLDivElement {
    const b = this.el('div', `tc-btn ${spec.cls}`);
    b.setAttribute('role', 'button');
    b.setAttribute('aria-label', spec.aria);
    const g = this.el('span', 'tc-g');
    g.textContent = spec.glyph;
    b.appendChild(g);
    if (spec.label) {
      const l = this.el('span', 'tc-l');
      l.textContent = spec.label;
      b.appendChild(l);
    }
    this.root.appendChild(b);
    this.buttons.set(spec.cls.replace('tc-', ''), b);
    return b;
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
  ): void {
    target.addEventListener(type, fn);
    this.cleanups.push(() => target.removeEventListener(type, fn));
  }

  private capture(el: HTMLElement, id: number): void {
    try {
      el.setPointerCapture(id);
    } catch {
      /* pointer already gone */
    }
  }

  // --------------------------------------------------------------- move stick

  private bindMove(zone: HTMLElement): void {
    this.listen(zone, 'pointerdown', (e) => {
      if (this.movePointer !== -1) return;
      e.preventDefault();
      this.host.activity();
      this.movePointer = e.pointerId;
      this.capture(zone, e.pointerId);
      const rect = zone.getBoundingClientRect();
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.stick.style.left = `${e.clientX - rect.left}px`;
      this.stick.style.top = `${e.clientY - rect.top}px`;
      this.root.classList.add('tc-moving');
      this.updateStick(e.clientX, e.clientY, rect);
    });
    this.listen(zone, 'pointermove', (e) => {
      if (e.pointerId !== this.movePointer) return;
      e.preventDefault();
      this.updateStick(e.clientX, e.clientY, zone.getBoundingClientRect());
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.movePointer) return;
      this.movePointer = -1;
      this.moveF = 0;
      this.moveR = 0;
      this.sprint = false;
      this.root.classList.remove('tc-moving', 'tc-sprint');
      this.knob.style.transform = '';
    };
    this.listen(zone, 'pointerup', end);
    this.listen(zone, 'pointercancel', end);
    this.listen(zone, 'lostpointercapture', end);
  }

  private updateStick(x: number, y: number, rect: DOMRect): void {
    let dx = x - this.originX;
    let dy = y - this.originY;
    const dist = Math.hypot(dx, dy);
    if (dist > STICK_RADIUS) {
      // The stick base follows the thumb so it never has to travel back far.
      const over = dist - STICK_RADIUS;
      this.originX += (dx / dist) * over;
      this.originY += (dy / dist) * over;
      dx = x - this.originX;
      dy = y - this.originY;
      this.stick.style.left = `${this.originX - rect.left}px`;
      this.stick.style.top = `${this.originY - rect.top}px`;
    }
    const m = Math.min(1, Math.hypot(dx, dy) / STICK_RADIUS);
    const ang = Math.atan2(dy, dx);
    this.knob.style.transform = `translate(${Math.cos(ang) * m * STICK_RADIUS}px,${Math.sin(ang) * m * STICK_RADIUS}px)`;
    if (m < STICK_DEADZONE) {
      this.moveF = 0;
      this.moveR = 0;
      this.sprint = false;
    } else {
      const s = (m - STICK_DEADZONE) / (1 - STICK_DEADZONE);
      this.moveR = Math.cos(ang) * s;
      this.moveF = -Math.sin(ang) * s;
      this.sprint = m >= 0.97 && this.moveF > 0.5;
    }
    this.root.classList.toggle('tc-sprint', this.sprint);
  }

  // --------------------------------------------------------------------- look

  private bindLook(el: HTMLElement): void {
    this.listen(el, 'pointerdown', (e) => {
      e.preventDefault();
      this.host.activity();
      this.capture(el, e.pointerId);
      this.lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    this.listen(el, 'pointermove', (e) => {
      const p = this.lookPointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (Math.abs(dx) > LOOK_SPIKE_PX || Math.abs(dy) > LOOK_SPIKE_PX) return;
      if (dx !== 0 || dy !== 0) this.host.look(dx, dy);
    });
    const end = (e: PointerEvent): void => {
      this.lookPointers.delete(e.pointerId);
    };
    this.listen(el, 'pointerup', end);
    this.listen(el, 'pointercancel', end);
    this.listen(el, 'lostpointercapture', end);
  }

  // ------------------------------------------------------------------ buttons

  private bindHold(el: HTMLElement, set: (on: boolean) => void): void {
    this.listen(el, 'pointerdown', (e) => {
      e.preventDefault();
      this.host.activity();
      this.capture(el, e.pointerId);
      this.held.set(e.pointerId, el);
      el.classList.add('tc-active');
      set(true);
    });
    const end = (e: PointerEvent): void => {
      if (this.held.get(e.pointerId) !== el) return;
      this.held.delete(e.pointerId);
      el.classList.remove('tc-active');
      set(false);
    };
    this.listen(el, 'pointerup', end);
    this.listen(el, 'pointercancel', end);
    this.listen(el, 'lostpointercapture', end);
  }

  private bindPress(el: HTMLElement, action: TouchPress): void {
    this.listen(el, 'pointerdown', (e) => {
      e.preventDefault();
      this.host.activity();
      this.capture(el, e.pointerId);
      this.held.set(e.pointerId, el);
      el.classList.add('tc-active');
      this.host.press(action);
    });
    const end = (e: PointerEvent): void => {
      if (this.held.get(e.pointerId) !== el) return;
      this.held.delete(e.pointerId);
      el.classList.remove('tc-active');
    };
    this.listen(el, 'pointerup', end);
    this.listen(el, 'pointercancel', end);
    this.listen(el, 'lostpointercapture', end);
  }

  private bindToggle(el: HTMLElement, action: TouchToggle): void {
    this.listen(el, 'pointerdown', (e) => {
      e.preventDefault();
      this.host.activity();
      this.capture(el, e.pointerId);
      this.held.set(e.pointerId, el);
      el.classList.add('tc-active');
      this.host.toggle(action);
    });
    const end = (e: PointerEvent): void => {
      if (this.held.get(e.pointerId) !== el) return;
      this.held.delete(e.pointerId);
      el.classList.remove('tc-active');
    };
    this.listen(el, 'pointerup', end);
    this.listen(el, 'pointercancel', end);
    this.listen(el, 'lostpointercapture', end);
  }
}
