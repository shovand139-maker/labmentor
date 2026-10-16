import { describe, expect, it } from "vitest";
import { anchorFor, citationLabel, paragraphs, tokenize } from "@/lib/inline";

describe("tokenize", () => {
  it("splits code, bold and citations without interpreting HTML", () => {
    expect(
      tokenize("Run `az login` in **the terminal** [step-1]. <b>no</b>"),
    ).toEqual([
      { kind: "text", value: "Run " },
      { kind: "code", value: "az login" },
      { kind: "text", value: " in " },
      { kind: "bold", value: "the terminal" },
      { kind: "text", value: " " },
      { kind: "citation", id: "step-1" },
      { kind: "text", value: ". <b>no</b>" },
    ]);
  });

  it("leaves unknown bracketed text alone", () => {
    expect(tokenize("[link](x) [step-x]")).toEqual([
      { kind: "text", value: "[link](x) [step-x]" },
    ]);
  });
});

describe("citations", () => {
  it("point at the step or troubleshooting note in the guide", () => {
    expect(anchorFor("step-3-2")).toBe("guide-step-3");
    expect(anchorFor("faq-2")).toBe("guide-faq-2");
    expect(citationLabel("step-3-2")).toBe("Step 3");
    expect(citationLabel("faq-2")).toBe("Troubleshooting 2");
  });
});

describe("paragraphs", () => {
  it("joins wrapped lines and splits on blank lines", () => {
    expect(paragraphs("one\ntwo\n\n three ")).toEqual(["one two", "three"]);
  });
});
