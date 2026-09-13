import { afterEach, describe, expect, it, vi } from "vitest";
import { startQuoteExpansion } from "./expandQuotes.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("scheduled quote expansion", () => {
  it("checks stale requests immediately and every minute without a dashboard visit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00.000Z"));
    const expandStaleQuoteRequests = vi.fn(async (_now: string) => {});

    const stop = startQuoteExpansion({ expandStaleQuoteRequests });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(expandStaleQuoteRequests.mock.calls).toEqual([
      ["2026-09-08T12:00:00.000Z"],
      ["2026-09-08T12:01:00.000Z"],
    ]);
    stop();
  });

  it("does not overlap a pending expansion", async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<void>();
    const expandStaleQuoteRequests = vi.fn(() => pending.promise);

    const stop = startQuoteExpansion({ expandStaleQuoteRequests });
    await vi.advanceTimersByTimeAsync(120_000);

    expect(expandStaleQuoteRequests).toHaveBeenCalledTimes(1);
    pending.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(expandStaleQuoteRequests).toHaveBeenCalledTimes(2);
    stop();
  });

  it("reports a failed attempt and retries at the next interval", async () => {
    vi.useFakeTimers();
    const failure = new Error("database unavailable");
    const expandStaleQuoteRequests = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const onError = vi.fn();

    const stop = startQuoteExpansion({ expandStaleQuoteRequests }, { onError });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(expandStaleQuoteRequests).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops future attempts even when the current attempt is still pending", async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<void>();
    const expandStaleQuoteRequests = vi.fn(() => pending.promise);
    const stop = startQuoteExpansion({ expandStaleQuoteRequests });

    stop();
    pending.resolve();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(expandStaleQuoteRequests).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("records the database failure code without logging private error details", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = { code: "PGRST202", message: "private database detail" };
    const expandStaleQuoteRequests = vi.fn(async () => { throw failure; });
    const stop = startQuoteExpansion({ expandStaleQuoteRequests });
    await vi.advanceTimersByTimeAsync(0);
    stop();

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "Quote expansion unavailable; retrying in one minute",
      { errorType: "Error", code: "PGRST202" },
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(failure.message);
  });
});
