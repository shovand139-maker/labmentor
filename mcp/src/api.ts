/** A small client for the LabMentor web API, authenticated as one instructor with a bearer token. */

export type Fetch = typeof fetch;

export class LabMentorError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type LabSummary = {
  slug: string;
  title: string;
  summary: string;
  durationMinutes: number;
  steps: number;
  solutionsAllowed: boolean;
};

export type LabGuide = LabSummary & {
  guide: { position: number; title: string; body: string; graded: boolean }[];
  faq: { position: number; question: string; answer: string }[];
};

export type LabInsights = {
  slug: string;
  title: string;
  days: number;
  learners: number;
  questions: number;
  byPolicy: Record<string, number>;
  needsInstructor: number;
  thumbsUp: number;
  thumbsDown: number;
  averageConfidence: number | null;
  steps: { position: number; title: string; graded: boolean; questions: number; needsInstructor: number; thumbsDown: number }[];
  openQuestions: { learner: string; question: string; step: number | null; reason: string; askedAt: string }[];
};

export class LabMentorApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(new URL(path, this.baseUrl), {
      headers: { authorization: `Bearer ${this.token}`, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as { detail?: string } | null;
      throw new LabMentorError(problem?.detail ?? `LabMentor returned ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  }

  async labs(): Promise<LabSummary[]> {
    return (await this.get<{ labs: LabSummary[] }>("/api/labs")).labs;
  }

  guide(slug: string): Promise<LabGuide> {
    return this.get(`/api/labs/${encodeURIComponent(slug)}`);
  }

  insights(slug: string, days: number): Promise<LabInsights> {
    return this.get(`/api/insights?lab=${encodeURIComponent(slug)}&days=${days}`);
  }
}
