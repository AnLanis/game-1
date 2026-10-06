/**
 * Web-portal SDK adapter (Poki / CrazyGames). The game only ever talks to a
 * `PortalAdapter`; nothing here loads external scripts. A portal build simply
 * includes the vendor <script> in its HTML, and `detectPortal()` picks the
 * adapter from the SDK global if it is present. Every SDK call is wrapped so an
 * ad-blocked or failing SDK can never break gameplay.
 */

export interface PortalAdapter {
  readonly name: string;
  init(): Promise<void>;
  loadingStart(): void;
  loadingDone(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  /** Midgame ad. Resolves when the break is over (or immediately if none). */
  commercialBreak(): Promise<void>;
  /** Rewarded ad. Resolves true only if the player earned the reward. */
  rewardedBreak(): Promise<boolean>;
  happyTime?(intensity?: number): void;
  /** Hooks so the game can mute audio / freeze input while an ad plays. */
  onAdStart?: () => void;
  onAdEnd?: () => void;
}

/** Never let a hung ad promise freeze the game. */
const AD_TIMEOUT_MS = 45_000;

function withTimeout<T>(p: Promise<T>, fallback: T, ms = AD_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

const safe = (fn: () => void): void => {
  try {
    fn();
  } catch {
    /* SDK misbehaving: ignore */
  }
};

/** Default: no portal. Ads resolve immediately; rewarded breaks are not granted. */
export class NullPortal implements PortalAdapter {
  readonly name: string = 'none';
  onAdStart?: () => void;
  onAdEnd?: () => void;
  async init(): Promise<void> {}
  loadingStart(): void {}
  loadingDone(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  async commercialBreak(): Promise<void> {}
  async rewardedBreak(): Promise<boolean> {
    return false;
  }
  happyTime(): void {}
}

/** Shared behaviour: idempotent gameplay/loading state and ad hook bracketing. */
abstract class BasePortal implements PortalAdapter {
  abstract readonly name: string;
  onAdStart?: () => void;
  onAdEnd?: () => void;
  protected playing = false;
  protected loading = false;
  protected ready = false;

  abstract init(): Promise<void>;
  protected abstract sdkLoadingStart(): void;
  protected abstract sdkLoadingDone(): void;
  protected abstract sdkGameplayStart(): void;
  protected abstract sdkGameplayStop(): void;
  protected abstract sdkCommercial(): Promise<void>;
  protected abstract sdkRewarded(): Promise<boolean>;
  abstract happyTime(intensity?: number): void;

  loadingStart(): void {
    if (this.loading) return;
    this.loading = true;
    safe(() => this.sdkLoadingStart());
  }

  loadingDone(): void {
    if (!this.loading) return;
    this.loading = false;
    safe(() => this.sdkLoadingDone());
  }

  gameplayStart(): void {
    if (this.playing) return;
    this.playing = true;
    safe(() => this.sdkGameplayStart());
  }

  gameplayStop(): void {
    if (!this.playing) return;
    this.playing = false;
    safe(() => this.sdkGameplayStop());
  }

  async commercialBreak(): Promise<void> {
    const wasPlaying = this.playing;
    if (wasPlaying) this.gameplayStop();
    safe(() => this.onAdStart?.());
    try {
      await withTimeout(this.sdkCommercial(), undefined);
    } catch {
      /* ignore */
    } finally {
      safe(() => this.onAdEnd?.());
    }
  }

  async rewardedBreak(): Promise<boolean> {
    if (this.playing) this.gameplayStop();
    safe(() => this.onAdStart?.());
    try {
      return await withTimeout(this.sdkRewarded(), false);
    } catch {
      return false;
    } finally {
      safe(() => this.onAdEnd?.());
    }
  }
}

// ------------------------------------------------------------------- Poki

interface PokiSdk {
  init(): Promise<unknown>;
  gameLoadingStart?(): void;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(before?: () => void): Promise<unknown>;
  rewardedBreak(before?: () => void): Promise<boolean>;
  happyTime?(intensity?: number): void;
}

export class PokiPortal extends BasePortal {
  readonly name = 'poki';
  constructor(private readonly sdk: PokiSdk) {
    super();
  }
  async init(): Promise<void> {
    try {
      await withTimeout(Promise.resolve(this.sdk.init()), undefined, 8000);
      this.ready = true;
    } catch {
      /* ad-blocked: the SDK still resolves ads immediately */
    }
  }
  protected sdkLoadingStart(): void {
    this.sdk.gameLoadingStart?.();
  }
  protected sdkLoadingDone(): void {
    this.sdk.gameLoadingFinished();
  }
  protected sdkGameplayStart(): void {
    this.sdk.gameplayStart();
  }
  protected sdkGameplayStop(): void {
    this.sdk.gameplayStop();
  }
  protected async sdkCommercial(): Promise<void> {
    await this.sdk.commercialBreak();
  }
  protected async sdkRewarded(): Promise<boolean> {
    return Boolean(await this.sdk.rewardedBreak());
  }
  happyTime(intensity = 1): void {
    safe(() => this.sdk.happyTime?.(intensity));
  }
}

// ------------------------------------------------------------- CrazyGames

interface CrazyAdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (e: unknown) => void;
}
interface CrazySdk {
  init(): Promise<void>;
  game: {
    loadingStart?(): void;
    loadingStop?(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime?(): void;
  };
  ad: { requestAd(type: 'midgame' | 'rewarded', cb: CrazyAdCallbacks): void };
}

export class CrazyGamesPortal extends BasePortal {
  readonly name = 'crazygames';
  constructor(private readonly sdk: CrazySdk) {
    super();
  }
  async init(): Promise<void> {
    try {
      await withTimeout(Promise.resolve(this.sdk.init()), undefined, 8000);
      this.ready = true;
    } catch {
      /* SDK unavailable outside the portal */
    }
  }
  protected sdkLoadingStart(): void {
    this.sdk.game.loadingStart?.();
  }
  protected sdkLoadingDone(): void {
    this.sdk.game.loadingStop?.();
  }
  protected sdkGameplayStart(): void {
    this.sdk.game.gameplayStart();
  }
  protected sdkGameplayStop(): void {
    this.sdk.game.gameplayStop();
  }
  private request(type: 'midgame' | 'rewarded'): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      try {
        this.sdk.ad.requestAd(type, {
          adFinished: () => resolve(true),
          adError: () => resolve(false),
        });
      } catch {
        resolve(false);
      }
    });
  }
  protected async sdkCommercial(): Promise<void> {
    await this.request('midgame');
  }
  protected sdkRewarded(): Promise<boolean> {
    return this.request('rewarded');
  }
  happyTime(): void {
    safe(() => this.sdk.game.happytime?.());
  }
}

// -------------------------------------------------------------- detection

interface PortalGlobals {
  PokiSDK?: PokiSdk;
  CrazyGames?: { SDK?: CrazySdk };
}

/** Pick an adapter from whichever vendor SDK global is present; NullPortal otherwise. */
export function detectPortal(root: unknown = typeof window !== 'undefined' ? window : undefined): PortalAdapter {
  try {
    const g = (root ?? {}) as PortalGlobals;
    if (g.PokiSDK && typeof g.PokiSDK.init === 'function') return new PokiPortal(g.PokiSDK);
    const cg = g.CrazyGames?.SDK;
    if (cg && typeof cg.init === 'function' && cg.game && cg.ad) return new CrazyGamesPortal(cg);
  } catch {
    /* fall through */
  }
  return new NullPortal();
}
