/** Shapes the API returns. Shared by route handlers, server components and client components. */

export type Policy =
  "answered" | "hint_only" | "solution_withheld" | "not_in_guide";

export type Citation = { id: string; title: string; step: number | null };

export type LabSummary = {
  slug: string;
  title: string;
  summary: string;
  durationMinutes: number;
  steps: number;
  completed: number;
  solutionsAllowed: boolean;
};

/** A step as learners see it. Hints and solutions never leave the server. */
export type GuideStep = {
  position: number;
  title: string;
  body: string;
  graded: boolean;
  completed: boolean;
};

export type GuideFaq = { position: number; question: string; answer: string };

export type LabGuide = LabSummary & { guide: GuideStep[]; faq: GuideFaq[] };

export type MessageDto = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  currentStep: number | null;
  policy: Policy | null;
  citations: Citation[];
  needsInstructor: boolean;
  confidence: number | null;
  rating: -1 | 1 | null;
};

export type StepInsight = {
  position: number;
  title: string;
  graded: boolean;
  questions: number;
  needsInstructor: number;
  thumbsDown: number;
};

export type OpenQuestion = {
  messageId: string;
  learner: string;
  question: string;
  step: number | null;
  policy: Policy | null;
  reason: "not_in_guide" | "low_confidence" | "rated_unhelpful";
  askedAt: string;
};

export type LabInsights = {
  slug: string;
  title: string;
  days: number;
  learners: number;
  questions: number;
  byPolicy: Record<Policy, number>;
  needsInstructor: number;
  thumbsUp: number;
  thumbsDown: number;
  averageConfidence: number | null;
  steps: StepInsight[];
  openQuestions: OpenQuestion[];
};

/** Server-sent events from POST /api/labs/:slug/questions. */
export type QuestionEvent =
  | { event: "accepted"; data: { question: MessageDto } }
  | {
      event: "tool";
      data: {
        name: string;
        status: "running" | "done" | "error";
        summary?: string;
      };
    }
  | { event: "delta"; data: { text: string } }
  | { event: "done"; data: { answer: MessageDto } }
  | { event: "error"; data: { code: string; message: string } };
