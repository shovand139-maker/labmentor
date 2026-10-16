import { describe, expect, it } from "vitest";
import { feedbackBody, questionBody } from "@/lib/validation";
import { currentStepFor } from "./helpers";

describe("request validation", () => {
  it("normalises whitespace in questions and rejects empty or oversized ones", () => {
    expect(questionBody.parse({ question: "  why   404?\n" })).toEqual({
      question: "why 404?",
    });
    expect(questionBody.safeParse({ question: "   " }).success).toBe(false);
    expect(questionBody.safeParse({ question: "x".repeat(2001) }).success).toBe(
      false,
    );
    expect(
      questionBody.safeParse({ question: "ok", tenantId: "x" }).success,
    ).toBe(false);
  });

  it("accepts only thumbs up or down", () => {
    expect(feedbackBody.parse({ rating: -1 })).toEqual({
      rating: -1,
      comment: null,
    });
    expect(feedbackBody.safeParse({ rating: 5 }).success).toBe(false);
  });

  it("picks the first step that is not done", () => {
    expect(currentStepFor(5, [1, 2, 4])).toBe(3);
    expect(currentStepFor(2, [1, 2])).toBe(2);
    expect(currentStepFor(0, [])).toBeNull();
  });
});
