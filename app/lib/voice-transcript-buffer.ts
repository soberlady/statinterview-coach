/** Keeps browser-only transcript fragments isolated across saved turns. */
export class VoiceTranscriptBuffer {
  private segments = new Map<string, { text: string; final: boolean }>();
  private retired = new Set<string>();
  private generation = 0;

  get text(): string {
    return Array.from(this.segments.values(), (segment) => segment.text)
      .filter(Boolean).join(" ");
  }

  checkpoint(): void {
    for (const id of this.segments.keys()) this.retired.add(id);
    this.segments.clear();
    this.generation += 1;
  }

  async consume(
    chunks: AsyncIterable<string>,
    id: string,
    final: boolean,
    onUpdate: (text: string) => void,
    isActive: () => boolean = () => true,
  ): Promise<string | null> {
    const previous = this.segments.get(id);
    if (this.retired.has(id) || (previous?.final && !final) || !isActive()) return null;
    const generation = this.generation;
    const segment = { text: previous?.text ?? "", final };
    // Reserve arrival order before awaiting; later streams may finish first.
    this.segments.set(id, segment);
    const current = () => isActive() && generation === this.generation && this.segments.get(id) === segment;
    let text = "";
    for await (const chunk of chunks) {
      if (!current()) return null;
      text += chunk;
      if (text.trim()) {
        segment.text = text.trim();
        onUpdate(this.text);
      }
    }
    return current() && text.trim() ? text.trim() : null;
  }
}
