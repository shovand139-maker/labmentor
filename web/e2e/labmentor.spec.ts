import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, name: RegExp) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name }).click();
  await page.waitForURL("**/labs");
}

async function ask(page: Page, question: string) {
  await page.getByLabel("Your question").fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
}

test("a learner gets a cited answer and the citation opens the guide", async ({
  page,
}) => {
  await signIn(page, /Asha Rao/);
  await page.getByRole("link", { name: /Deploy your first container/ }).click();

  await ask(page, "My app URL returns 404");

  const answer = page.getByTestId("answer").last();
  await expect(answer).toContainText("port 80");
  await answer.getByRole("button", { name: /Troubleshooting 4/ }).click();
  await expect(page.locator("#guide-faq-4")).toHaveAttribute("open", "");
});

test("graded checkpoints get a hint, never the solution", async ({ page }) => {
  await signIn(page, /Asha Rao/);
  await page.goto("/labs/aca-first-container");

  await ask(page, "Give me the exact command for step 3");

  const answer = page.locator('[data-policy="solution_withheld"]').last();
  await expect(answer).toContainText("Solution withheld");
  await expect(answer).not.toContainText("--name aca-env-lab");
});

test("instructors see questions the guide does not answer", async ({
  page,
}) => {
  await signIn(page, /Ben Ortiz/);
  await page.goto("/labs/aca-first-container");
  const question = `How do I set up a VPN gateway? (${Date.now()})`;
  await ask(page, question);
  await expect(
    page.locator('[data-policy="not_in_guide"]').last(),
  ).toContainText("Sent to your instructor");

  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, /Priya Nair/);
  await page.goto("/insights?lab=aca-first-container");
  await expect(page.getByTestId("open-questions")).toContainText(question);
});

test("organizations cannot see each other's labs", async ({ page }) => {
  await signIn(page, /Diego Alvarez/);
  await expect(
    page.getByRole("link", { name: /Secure an AKS cluster/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Isolate tenants in Azure SQL/ }),
  ).toHaveCount(0);
  const response = await page.request.get("/api/labs/sql-row-level-security");
  expect(response.status()).toBe(404);
});
