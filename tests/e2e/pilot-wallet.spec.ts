import { expect, test, type BrowserContext } from "@playwright/test";

const treasury = "treasury.near";
const contract = "usdc.near";
const txHash = "11111111111111111111111111111111";
const recipient = "0x1111111111111111111111111111111111111111";
const nonce = Buffer.alloc(32, 7).toString("base64url");
const base = "http://127.0.0.1:3102";
const originStatus = "NEAR funding confirmed. Awaiting Base settlement evidence.";

async function mockPilot(context: BrowserContext, { enabled = true, cancel = false } = {}) {
  let status = "PREPARED";
  let hasAttempt = false;
  let signer = treasury;
  let handoffCount = 0;
  const attempt = () => ({
    id: "attempt", status, originDebitAtomic: "5100000", destinationAmountAtomic: "5000000",
    quoteExpiresAt: new Date(Date.now() + 240_000).toISOString(), sourceAccountId: treasury, sourceContract: contract,
    destinationAddress: recipient, refundAccountId: treasury, slippageBps: 100,
    fundingTxHash: status === "FUNDING_CONFIRMED" ? txHash : null,
  });
  const action = { type: "FunctionCall", params: {
    methodName: "ft_transfer", args: { receiver_id: "deposit.near", amount: "5100000" }, gas: "30000000000000", deposit: "1",
  } };

  await context.route(base + "/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/session") return route.fulfill({ json: { data: { role: "TREASURY_SIGNER", workspace: "Pilot" } } });
    if (path === "/api/invoices/fixture") return route.fulfill({ json: { data: {
      id: "fixture", invoiceNumber: "PILOT-1", status: status === "PREPARED" ? "APPROVED" : "PAYMENT_PENDING",
      currency: "USDC", amountMinor: 500, invoiceDate: "2026-11-27", createdAt: "2026-11-27",
      paymentDestination: recipient, paymentChain: "base", vendor: { name: "Pilot vendor", accountAddress: recipient },
      lineItems: [], auditEvents: [], approvals: [],
    } } });
    if (path === "/api/invoices/fixture/live-attempt") {
      if (request.method() === "POST") hasAttempt = true;
      return route.fulfill({ json: { data: hasAttempt ? attempt() : null, walletHandoffEnabled: enabled } });
    }
    if (path === "/api/treasury/proof/challenge") {
      expect(request.postDataJSON()).toEqual({ wallet: "my-near-wallet" });
      return route.fulfill({ json: { data: {
        accountId: treasury, message: "Verify Covendro treasury ownership", recipient: "127.0.0.1", callbackUrl: base + "/", nonce,
      } } });
    }
    if (path === "/api/treasury/proof") {
      expect(request.postDataJSON()).toMatchObject({ wallet: "my-near-wallet", accountId: treasury, nonce });
      return route.fulfill({ json: { data: { verifiedAt: new Date().toISOString() } } });
    }
    if (path === "/api/live-attempts/attempt/wallet-handoff") {
      handoffCount++;
      status = "AWAITING_FUNDING";
      return route.fulfill({ json: { data: { attempt: attempt(), walletRequest: {
        network: "mainnet", signerId: treasury, receiverId: contract, actions: [action],
      } } } });
    }
    if (path === "/api/live-attempts/attempt/funding") {
      expect(request.postDataJSON()).toEqual({ txHash });
      status = "FUNDING_CONFIRMED";
      return route.fulfill({ json: { data: attempt() } });
    }
    await route.fulfill({ status: 404, json: { error: { message: "Unexpected test request" } } });
  });

  await context.route("https://free.rpc.fastnear.com/**", async (route) => {
    const { method, id } = route.request().postDataJSON();
    const result = method === "block" ? { header: { hash: txHash } } : { transaction: { hash: txHash } };
    await route.fulfill({ json: { jsonrpc: "2.0", id, result }, headers: { "access-control-allow-origin": "*" } });
  });

  await context.route("https://app.mynearwallet.com/**", async (route) => {
    const url = new URL(route.request().url());
    let response: object;
    if (url.pathname === "/login/") {
      expect(url.searchParams.has("public_key")).toBe(false);
      expect(url.searchParams.has("contract_id")).toBe(false);
      response = { status: "success", account_id: signer };
    } else if (url.pathname === "/sign-message") {
      expect(url.searchParams.get("callbackUrl")).toBe(base + "/");
      expect(url.searchParams.get("nonce")).toBe(Buffer.from(nonce, "base64url").toString("base64"));
      response = { status: "success", signedRequest: { accountId: signer, publicKey: "ed25519:test", signature: "signature" } };
    } else {
      expect(url.pathname).toBe("/sign");
      expect(url.searchParams.get("transactions")).toBeTruthy();
      response = cancel ? { status: "failure", error: "Cancelled" } : { status: "success", transactionHashes: txHash };
    }
    await route.fulfill({ contentType: "text/html", body: `<script>opener.postMessage(${JSON.stringify(response)}, ${JSON.stringify(base)})</script>` });
  });

  return { setSigner: (account: string) => { signer = account; }, handoffCount: () => handoffCount };
}

test("@pilot prepares a quote and respects the server handoff gate", async ({ page, context }) => {
  await mockPilot(context, { enabled: false });
  await page.goto("/invoices/fixture");
  await page.getByRole("button", { name: "Prepare firm quote" }).click();
  await expect(page.getByText("5.100000 USDC", { exact: true })).toBeVisible();
  await expect(page.getByText("Wallet handoff is disabled for this pilot.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect MyNearWallet" })).toHaveCount(0);
});

for (const cancel of [false, true]) {
  test(`@pilot ${cancel ? "retains the reservation after wallet cancellation" : "verifies the account and the returned funding hash"}`, async ({ page, context }) => {
    const pilot = await mockPilot(context, { cancel });
    pilot.setSigner("unexpected.near");
    await page.goto("/invoices/fixture");
    await page.getByRole("button", { name: "Prepare firm quote" }).click();
    await page.getByRole("button", { name: "Connect MyNearWallet" }).click();
    await expect(page.getByText(/Connect the approved treasury account/)).toBeVisible();
    expect(pilot.handoffCount()).toBe(0);
    pilot.setSigner(treasury);
    await page.getByRole("button", { name: "Reconnect MyNearWallet" }).click();
    await page.getByRole("button", { name: "Verify treasury wallet" }).click();
    await page.getByRole("checkbox", { name: "I reviewed the quoted debit and vendor destination." }).check();
    await page.getByRole("button", { name: "Review transfer in MyNearWallet" }).click();
    if (cancel) {
      await expect(page.getByText(/The debit remains reserved/)).toBeVisible();
      await page.reload();
      await expect(page.getByText("AWAITING FUNDING")).toBeVisible();
      await expect(page.getByRole("button", { name: "Review transfer in MyNearWallet" })).toHaveCount(0);
      await page.getByRole("textbox", { name: "NEAR funding transaction hash" }).fill(txHash);
      await page.getByRole("button", { name: "Verify funding" }).click();
    }
    await expect(page.getByText(originStatus)).toBeVisible();
    expect(pilot.handoffCount()).toBe(1);
  });
}
