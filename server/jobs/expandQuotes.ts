import type { Repository } from "../repository.js";

type QuoteExpansionOptions = {
  readonly now?: () => Date;
  readonly onError?: (error: Error) => void;
};

export function startQuoteExpansion(
  repository: Pick<Repository, "expandStaleQuoteRequests">,
  options: QuoteExpansionOptions = {},
): () => void {
  const now = options.now ?? (() => new Date());
  const onError = options.onError ?? ((error: Error) => {
    const detail = "code" in error ? error : error.cause;
    const code = detail !== null && typeof detail === "object" && "code" in detail
      && typeof detail.code === "string" && /^[A-Z0-9_]{1,40}$/.test(detail.code)
      ? detail.code : "UNKNOWN";
    const errorType = /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(error.name) ? error.name : "Error";
    console.warn("Quote expansion unavailable; retrying in one minute", { errorType, code });
  });
  let running = false;
  let stopped = false;

  const run = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await repository.expandStaleQuoteRequests(now().toISOString());
    } catch (error) {
      onError(error instanceof Error ? error : new Error("Quote expansion failed", { cause: error }));
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void run(); }, 60_000);
  timer.unref();
  void run();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
