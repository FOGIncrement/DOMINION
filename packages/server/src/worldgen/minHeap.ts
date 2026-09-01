// Plain binary min-heap keyed by a numeric priority — no external dependency.
// Shared by generateContinent.ts (priority-flood pit filling) and
// generateTerritories.ts (multi-source Dijkstra territory partition), the
// two offline bake scripts that both need one.
export class MinHeap {
  private cellIdx: number[] = [];
  private priority: number[] = [];

  get size(): number {
    return this.cellIdx.length;
  }

  push(idx: number, priority: number): void {
    this.cellIdx.push(idx);
    this.priority.push(priority);
    let i = this.cellIdx.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priority[parent] <= this.priority[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  popMin(): { idx: number; priority: number } | null {
    if (this.cellIdx.length === 0) return null;
    const topIdx = this.cellIdx[0];
    const topPriority = this.priority[0];
    const lastIdx = this.cellIdx.pop()!;
    const lastPriority = this.priority.pop()!;
    if (this.cellIdx.length > 0) {
      this.cellIdx[0] = lastIdx;
      this.priority[0] = lastPriority;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = i * 2 + 2;
        let smallest = i;
        if (l < this.cellIdx.length && this.priority[l] < this.priority[smallest]) smallest = l;
        if (r < this.cellIdx.length && this.priority[r] < this.priority[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return { idx: topIdx, priority: topPriority };
  }

  private swap(a: number, b: number): void {
    [this.cellIdx[a], this.cellIdx[b]] = [this.cellIdx[b], this.cellIdx[a]];
    [this.priority[a], this.priority[b]] = [this.priority[b], this.priority[a]];
  }
}
