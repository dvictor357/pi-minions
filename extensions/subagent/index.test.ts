import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachAbortKillFallback } from "./index.js";

class FakeProcess extends EventEmitter {
  readonly signals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return true;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("attachAbortKillFallback", () => {
  it("sends SIGTERM on abort and SIGKILL after the delay if still open", () => {
    vi.useFakeTimers();
    const proc = new FakeProcess();
    const controller = new AbortController();
    const onAbort = vi.fn();

    attachAbortKillFallback(proc, controller.signal, onAbort, 1000);
    controller.abort();

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(proc.signals).toEqual(["SIGTERM"]);

    vi.advanceTimersByTime(999);
    expect(proc.signals).toEqual(["SIGTERM"]);

    vi.advanceTimersByTime(1);
    expect(proc.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("clears the pending SIGKILL when the process closes after SIGTERM", () => {
    vi.useFakeTimers();
    const proc = new FakeProcess();
    const controller = new AbortController();

    attachAbortKillFallback(proc, controller.signal, vi.fn(), 1000);
    controller.abort();
    proc.emit("close");
    vi.advanceTimersByTime(1000);

    expect(proc.signals).toEqual(["SIGTERM"]);
  });

  it("handles an already-aborted signal", () => {
    vi.useFakeTimers();
    const proc = new FakeProcess();
    const controller = new AbortController();
    controller.abort();

    attachAbortKillFallback(proc, controller.signal, vi.fn(), 1000);

    expect(proc.signals).toEqual(["SIGTERM"]);
  });
});
