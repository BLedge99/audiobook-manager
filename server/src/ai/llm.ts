export interface LLMAdapter {
  chat(messages: { role: "system" | "user"; content: string }[]): Promise<string>;
  available(): Promise<boolean>;
}

export class LMStudioAdapter implements LLMAdapter {
  constructor(
    private baseUrl: string = process.env.LM_STUDIO_URL || "http://host.docker.internal:1234/v1",
    private model: string = process.env.LM_STUDIO_MODEL || "local-model",
    private timeoutMs: number = 15_000,
  ) {}

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async chat(messages: { role: "system" | "user"; content: string }[]): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages, temperature: 0.2 }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`LM Studio error: ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  }
}
