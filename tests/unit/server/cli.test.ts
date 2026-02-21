import { describe, expect, it } from "vitest";

import { parseCliArgs, resolveCliPort } from "../../../src/server/cli.js";

describe("server cli helpers", () => {
  it("preserves --port 0 (space form)", () => {
    const args = parseCliArgs(["--port", "0"]);
    expect(args.port).toBe(0);
    expect(resolveCliPort(args, { JABTERM_PORT: "3223" })).toBe(0);
  });

  it("preserves --port=0 (equals form)", () => {
    const args = parseCliArgs(["--port=0"]);
    expect(args.port).toBe(0);
    expect(resolveCliPort(args, { JABTERM_PORT: "3223" })).toBe(0);
  });
});

