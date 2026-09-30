/**
 * Typed content registry with validation. Content packs (future DLC, mods,
 * seasonal drops, remote configs) register into the same registries; systems
 * only ever look things up by stable string id.
 */
export class Registry<T extends { id: string }> {
  private readonly items = new Map<string, T>();
  private readonly order: T[] = [];

  constructor(
    readonly kind: string,
    private readonly validate?: (item: T) => string | null,
  ) {}

  register(item: T): T {
    if (this.items.has(item.id)) throw new Error(`${this.kind}: duplicate id "${item.id}"`);
    const problem = this.validate?.(item);
    if (problem) throw new Error(`${this.kind} "${item.id}": ${problem}`);
    this.items.set(item.id, item);
    this.order.push(item);
    return item;
  }

  registerAll(items: readonly T[]): void {
    for (const item of items) this.register(item);
  }

  get(id: string): T {
    const item = this.items.get(id);
    if (!item) throw new Error(`${this.kind}: unknown id "${id}"`);
    return item;
  }

  maybe(id: string | undefined | null): T | undefined {
    return id ? this.items.get(id) : undefined;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  all(): readonly T[] {
    return this.order;
  }

  /** Stable numeric index (compact for snapshots / network). */
  indexOf(id: string): number {
    return this.order.findIndex((item) => item.id === id);
  }

  get size(): number {
    return this.order.length;
  }
}
