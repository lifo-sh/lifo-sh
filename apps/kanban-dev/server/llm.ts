export interface LLMOptions {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  apiKey: string;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

export async function callLLM(options: LLMOptions): Promise<string> {
  const {
    systemPrompt,
    userMessage,
    model = "anthropic/claude-sonnet-4.5",
    apiKey,
    maxRetries = 3,
    retryDelayMs = 2000,
    timeoutMs = 60000,
  } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://lifo.sh",
          "X-Title": "Lifo Kanban Agent",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.status === 429 || res.status >= 500) {
        const delay = retryDelayMs * Math.pow(2, attempt - 1);
        console.log(
          `[llm] ${res.status} on attempt ${attempt}/${maxRetries}, retrying in ${delay}ms`,
        );
        await sleep(delay);
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`LLM API error ${res.status}: ${body}`);
      }

      const data = (await res.json()) as {
        choices: { message: { content: string } }[];
      };

      return data.choices[0].message.content;
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        console.log(`[llm] timeout on attempt ${attempt}/${maxRetries}`);
      } else if (attempt === maxRetries) {
        throw err;
      } else {
        console.log(`[llm] error on attempt ${attempt}/${maxRetries}:`, err);
      }
      if (attempt < maxRetries) {
        await sleep(retryDelayMs * Math.pow(2, attempt - 1));
      }
    }
  }

  throw new Error(`LLM call failed after ${maxRetries} attempts`);
}

/**
 * Strip markdown code fences from LLM response.
 * Models often wrap JSON in ```json ... ``` despite being told not to.
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  // Match ```json ... ``` or ``` ... ```
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return match ? match[1].trim() : trimmed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
