import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachAbortKillFallback,
  loadQuestAgentModels,
  recordSpawnError,
} from "./index.js";

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

describe("loadQuestAgentModels (pi-suite contract bridge)", () => {
  // Mirror pi-suite core/hash.ts + core/paths.ts to address the same file the
  // production reader does, then write/clean a throwaway project so we never
  // touch a real project's memory.
  const projectsDir = path.join(
    os.homedir(),
    ".pi",
    "agent",
    "memory",
    "projects",
  );
  const cwd = `/tmp/pi-minions-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const file = path.join(
    projectsDir,
    `${createHash("sha256").update(cwd).digest("hex").slice(0, 16)}.json`,
  );

  const writeMemory = (blob: unknown) => {
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(blob), "utf8");
  };

  afterEach(() => {
    try {
      fs.unlinkSync(file);
    } catch {
      /* not written by this test */
    }
  });

  it("returns {} when no memory file exists for the project", () => {
    expect(loadQuestAgentModels(cwd)).toEqual({});
  });

  it("reads agentModels written by quest (no contractVersion)", () => {
    writeMemory({
      name: "demo",
      agentModels: {
        scout: { model: "deepseek/deepseek-v4-flash", provider: "deepseek" },
      },
    });
    expect(loadQuestAgentModels(cwd)).toEqual({
      scout: { model: "deepseek/deepseek-v4-flash", provider: "deepseek" },
    });
  });

  it("reads agentModels at the current contract version", () => {
    writeMemory({
      contractVersion: 1,
      agentModels: { worker: { model: "claude-opus-4-8" } },
    });
    expect(loadQuestAgentModels(cwd).worker?.model).toBe("claude-opus-4-8");
  });

  it("ignores a file written by a newer contract (future-proofing)", () => {
    writeMemory({
      contractVersion: 999,
      agentModels: { scout: { model: "should-be-ignored" } },
    });
    expect(loadQuestAgentModels(cwd)).toEqual({});
  });

  it("returns {} when agentModels is absent or malformed", () => {
    writeMemory({ name: "demo", agentModels: "not-an-object" });
    expect(loadQuestAgentModels(cwd)).toEqual({});
  });
});

describe("recordSpawnError", () => {
  it("appends err.message to stderr and sets errorMessage", () => {
    const result: { stderr: string; errorMessage?: string } = {
      stderr: "existing stderr\n",
      errorMessage: undefined,
    };
    const err = new Error("ENOENT: no such file or directory");

    recordSpawnError(err, result);

    expect(result.stderr).toBe(
      "existing stderr\nENOENT: no such file or directory",
    );
    expect(result.errorMessage).toBe("ENOENT: no such file or directory");
  });

  it("appends to stderr without replacing prior content", () => {
    const result: { stderr: string; errorMessage?: string } = {
      stderr: "prior\n",
    };
    recordSpawnError(new Error("spawn EACCES"), result);

    expect(result.stderr).toBe("prior\nspawn EACCES");
    expect(result.errorMessage).toBe("spawn EACCES");
  });
});
