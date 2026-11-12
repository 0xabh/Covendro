import { expect, test } from "@playwright/test";

test("completes the invoice-to-ledger happy path", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Covendro" })).toBeVisible();

  await page.getByRole("link", { name: "Upload an invoice" }).click();
  await page.selectOption('select[aria-label="Sample invoice"]', "sample-invoice-001.json");
  await expect(page.getByText("sample-invoice-001.json loaded.")).toBeVisible();
  await page.getByRole("button", { name: "Save invoice draft" }).click();
  await expect(page).toHaveURL(/\/invoices\/[^/]+$/);

  await page.getByRole("button", { name: "Analyze invoice" }).click();
  await expect(page.getByText("MOCKED", { exact: true })).toBeVisible();
  await expect(page.getByText("MockInvoiceAIProvider", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.locator("header").getByText("REVIEW_REQUIRED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve as reviewer" }).click();
  await expect(page.locator("header").getByText("APPROVED", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Generate payment quote" }).click();
  await expect(page).toHaveURL(/\/payments\/[^/]+$/);
  await expect(page.getByText("MOCK QUOTE", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Simulate success" }).click();
  await expect(page.getByText("Simulation finished with SUCCESS.")).toBeVisible();
  await expect(page.getByText("PAID", { exact: true })).toBeVisible();

  await page.goto("/ledger");
  await expect(page.getByRole("heading", { name: "Ledger" })).toBeVisible();
  await expect(page.getByText("NS-2026-001", { exact: true })).toBeVisible();
  await expect(page.getByText("PAID", { exact: true })).toBeVisible();

  await page.goto("/audit");
  await expect(page.getByRole("heading", { name: "Audit history" })).toBeVisible();
  await expect(page.getByText("PAYMENT_SIMULATED", { exact: true })).toBeVisible();
});
