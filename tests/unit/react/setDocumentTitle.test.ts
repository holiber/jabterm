import { describe, expect, it } from "vitest";
import { setDocumentTitle } from "../../../src/react/setDocumentTitle.js";

describe("setDocumentTitle", () => {
  it("sets document.title when available", () => {
    document.title = "before";
    setDocumentTitle("after");
    expect(document.title).toBe("after");
  });

  it("does not throw if document.title setter throws", () => {
    const prev = Object.getOwnPropertyDescriptor(document, "title");
    Object.defineProperty(document, "title", {
      configurable: true,
      get() {
        return "ignored";
      },
      set() {
        throw new Error("boom");
      },
    });
    try {
      expect(() => setDocumentTitle("x")).not.toThrow();
    } finally {
      if (prev) Object.defineProperty(document, "title", prev);
    }
  });
});

