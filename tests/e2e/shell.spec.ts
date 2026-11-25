import { expect, test } from "@playwright/test";

test("opens the command palette and navigates from the shared shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Covendro overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Invoices", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open command menu" }).click();
  const dialog = page.getByRole("dialog", { name: "Search workspace" });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[aria-label="Search navigation"]').fill("audit");
  await expect(dialog.getByText("Audit history", { exact: true })).toBeVisible();
  await dialog.getByText("Audit history", { exact: true }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByRole("heading", { name: "Audit history" })).toBeVisible();
});

test("keeps the shell usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/invoices");
  await expect(page.getByRole("link", { name: "Covendro overview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open command menu" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
});
