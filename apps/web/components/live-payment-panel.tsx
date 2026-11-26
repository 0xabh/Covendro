"use client";

import { useEffect, useState } from "react";
import { convertWalletActions, decodeChallengeNonce, getTreasuryWallet, withWalletPopup, type TreasuryWalletRequest } from "../lib/treasury-wallet";
import { apiBase, apiFetch } from "../lib/api";

type Attempt = {
  id: string; status: string; originDebitAtomic: string; destinationAmountAtomic: string;
  quoteExpiresAt: string; sourceAccountId: string; sourceContract: string; destinationAddress: string; refundAccountId: string;
  refundFeeAtomic?: string | null; withdrawFeeAtomic?: string | null; slippageBps: number; fundingTxHash?: string | null; destinationTxHash?: string | null; refundTxHash?: string | null; reconcileIssue?: string | null;
};

function formatUsdc(atomic: string) {
  const amount = atomic.padStart(7, "0");
  return `${amount.slice(0, -6)}.${amount.slice(-6)} USDC`;
}

export function LivePaymentPanel({ invoiceId, canPrepare }: { invoiceId: string; canPrepare: boolean }) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [available, setAvailable] = useState(false);
  const [working, setWorking] = useState(false);
  const [handoffEnabled, setHandoffEnabled] = useState(false);
  const [walletAccount, setWalletAccount] = useState("");
  const [proofExpiresAt, setProofExpiresAt] = useState(0);
  const [paymentConsent, setPaymentConsent] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const url = `${apiBase}/api/invoices/${invoiceId}/live-attempt`;

  useEffect(() => {
    const request = new AbortController();
    apiFetch(url, { signal: request.signal }).then(async (response) => {
      if (!response.ok) return;
      const result = await response.json();
      setAttempt(result.data);
      setHandoffEnabled(result.walletHandoffEnabled === true);
      setAvailable(true);
    }).catch(() => undefined);
    return () => request.abort();
  }, [url]);

  if (!available || (!canPrepare && !attempt)) return null;

  async function prepare() {
    setWorking(true);
    setError("");
    try {
      const response = await apiFetch(url, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Could not prepare a firm quote");
      setAttempt(result.data);
      setPaymentConsent(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not prepare a firm quote");
    } finally {
      setWorking(false);
    }
  }

  async function post<T>(path: string, fallback: string, body?: object): Promise<T> {
    const response = await apiFetch(`${apiBase}${path}`, {
      method: "POST",
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? fallback);
    return result.data;
  }

  async function perform(action: () => Promise<void>, fallback: string) {
    setWorking(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : fallback);
    } finally {
      setWorking(false);
    }
  }

  async function connectWallet() {
    await perform(async () => {
      setProofExpiresAt(0);
      setPaymentConsent(false);
      await withWalletPopup(async () => {
        const wallet = await getTreasuryWallet();
        await wallet.signOut();
        const [account] = await wallet.signIn({});
        if (!account?.accountId) throw new Error("MyNearWallet did not return an account.");
        setWalletAccount(account.accountId);
      });
    }, "Could not connect MyNearWallet");
  }

  async function verifyWallet() {
    if (!attempt || walletAccount !== attempt.sourceAccountId) return;
    await perform(async () => {
      await withWalletPopup(async () => {
        const wallet = await getTreasuryWallet();
        const challenge = await post<{ accountId: string; message: string; recipient: string; nonce: string; callbackUrl: string }>(
          "/api/treasury/proof/challenge", "Could not create a treasury challenge", { wallet: "my-near-wallet" },
        );
        if (challenge.accountId !== walletAccount || new URL(challenge.callbackUrl).origin !== window.location.origin) {
          throw new Error("The treasury challenge does not match this wallet and Covendro origin.");
        }
        if (!wallet.signMessage) throw new Error("This wallet cannot sign a treasury ownership message.");
        const signature = await wallet.signMessage({
          message: challenge.message, recipient: challenge.recipient,
          nonce: decodeChallengeNonce(challenge.nonce), callbackUrl: challenge.callbackUrl, state: challenge.nonce,
        });
        if (!signature || signature.accountId !== walletAccount) throw new Error("MyNearWallet signed with a different account.");
        const proof = await post<{ verifiedAt: string }>("/api/treasury/proof", "Could not verify the treasury wallet", {
          wallet: "my-near-wallet", nonce: challenge.nonce,
          accountId: signature.accountId, publicKey: signature.publicKey, signature: signature.signature,
        });
        setProofExpiresAt(Date.parse(proof.verifiedAt) + 10 * 60_000);
      });
    }, "Could not verify the treasury wallet");
  }

  async function verifyFunding(attemptId: string, hash: string) {
    const updated = await post<Attempt>(`/api/live-attempts/${attemptId}/funding`, "Could not verify funding", { txHash: hash });
    setAttempt(updated);
    setTxHash("");
  }

  async function sendToWallet() {
    if (!attempt || !paymentConsent || walletAccount !== attempt.sourceAccountId) return;
    if (proofExpiresAt <= Date.now() || Date.parse(attempt.quoteExpiresAt) <= Date.now() + 30_000) {
      setError("The quote or wallet proof expired. Refresh the quote and verify the wallet again.");
      return;
    }
    await perform(async () => {
      let handedOff = false;
      try {
        await withWalletPopup(async () => {
          const wallet = await getTreasuryWallet();
          const accounts = await wallet.getAccounts();
          if (!accounts.some((account) => account.accountId === attempt.sourceAccountId)) {
            throw new Error("Reconnect the approved treasury account before signing.");
          }
          const { attempt: reserved, walletRequest } = await post<{ attempt: Attempt; walletRequest: TreasuryWalletRequest }>(
            `/api/live-attempts/${attempt.id}/wallet-handoff`, "Could not reserve the treasury debit",
          );
          handedOff = true;
          setAttempt(reserved);
          setPaymentConsent(false);
          const action = walletRequest.actions[0];
          if (reserved.id !== attempt.id || reserved.originDebitAtomic !== attempt.originDebitAtomic ||
              walletRequest.actions.length !== 1 || action?.type !== "FunctionCall" ||
              action.params.methodName !== "ft_transfer" || action.params.deposit !== "1" ||
              typeof action.params.args !== "object" || !("amount" in action.params.args) ||
              action.params.args.amount !== attempt.originDebitAtomic || walletRequest.network !== "mainnet" ||
              walletRequest.signerId !== attempt.sourceAccountId || walletRequest.receiverId !== attempt.sourceContract) {
            throw new Error("The wallet request does not match the reviewed treasury account and token contract.");
          }
          // This path forces a wallet confirmation popup and never creates a browser access key.
          const outcomes = await wallet.signAndSendTransactions({ transactions: [{
            signerId: walletRequest.signerId, receiverId: walletRequest.receiverId, actions: await convertWalletActions(walletRequest.actions),
          }] });
          const hash = Array.isArray(outcomes) && outcomes.length === 1 ? outcomes[0]?.transaction?.hash : undefined;
          if (!hash) throw new Error("MyNearWallet did not return a transaction hash.");
          setTxHash(hash);
          await verifyFunding(attempt.id, hash);
        });
      } catch (failure) {
        // The response can be lost after the server has durably reserved the debit.
        const response = await apiFetch(url).catch(() => null);
        if (response?.ok) {
          const result = await response.json();
          if (result.data?.id === attempt.id) {
            setAttempt(result.data);
            handedOff ||= result.data.status === "AWAITING_FUNDING";
          }
        }
        if (handedOff) {
          throw new Error("The debit remains reserved. Check MyNearWallet for a transaction hash before taking further action.");
        }
        throw failure;
      }
    }, "Could not open MyNearWallet");
  }

  return <section className="panel">
    <h2>NEAR mainnet quote</h2>
    {attempt && <>
      <p className="status-badge">{attempt.status.replaceAll("_", " ")}</p>
      <dl className="detail-list">
        <dt>Treasury debit</dt><dd>{formatUsdc(attempt.originDebitAtomic)}</dd>
        <dt>Vendor receives</dt><dd>{formatUsdc(attempt.destinationAmountAtomic)} on Base</dd>
        <dt>Vendor destination</dt><dd>{attempt.destinationAddress}</dd>
        <dt>Treasury account</dt><dd>{attempt.sourceAccountId}</dd>
        <dt>Refund account</dt><dd>{attempt.refundAccountId}</dd>
        <dt>Slippage tolerance</dt><dd>{attempt.slippageBps / 100}%</dd>
        {attempt.refundFeeAtomic && <><dt>Quoted refund fee</dt><dd>{formatUsdc(attempt.refundFeeAtomic)}</dd></>}
        {attempt.withdrawFeeAtomic && <><dt>Quoted withdrawal fee</dt><dd>{formatUsdc(attempt.withdrawFeeAtomic)}</dd></>}
        <dt>Quote expires</dt><dd>{new Date(attempt.quoteExpiresAt).toLocaleString()}</dd>
      </dl>
    </>}
    {attempt?.status === "PREPARED" && (handoffEnabled ? <div className="panel">
      <h3>Treasury wallet</h3>
      <div className="action-row">
        <button type="button" onClick={() => void connectWallet()} disabled={working}>{walletAccount ? "Reconnect MyNearWallet" : "Connect MyNearWallet"}</button>
        {walletAccount === attempt.sourceAccountId && <button type="button" onClick={() => void verifyWallet()} disabled={working}>Verify treasury wallet</button>}
      </div>
      {walletAccount && <p>Connected account: {walletAccount}</p>}
      {walletAccount && walletAccount !== attempt.sourceAccountId && <p role="alert">Connect the approved treasury account {attempt.sourceAccountId}.</p>}
      {proofExpiresAt > Date.now() && <div>
        <label><input type="checkbox" checked={paymentConsent} onChange={(event) => setPaymentConsent(event.target.checked)} /> I reviewed the quoted debit and vendor destination.</label>
        <button type="button" disabled={!paymentConsent || working} onClick={() => void sendToWallet()}>Review transfer in MyNearWallet</button>
      </div>}
    </div> : <p>Wallet handoff is disabled for this pilot.</p>)}
    {attempt?.status === "AWAITING_FUNDING" && <form onSubmit={(event) => { event.preventDefault(); void perform(() => verifyFunding(attempt.id, txHash.trim()), "Could not verify funding"); }}>
      <label>NEAR funding transaction hash <input required value={txHash} onChange={(event) => setTxHash(event.target.value)} /></label>
      <button disabled={working}>Verify funding</button>
    </form>}
    {attempt?.status === "FUNDING_CONFIRMED" && <p>NEAR funding confirmed. Awaiting Base settlement evidence.</p>}
    {attempt?.reconcileIssue && <p role="status">{attempt.reconcileIssue.replaceAll("_", " ")}</p>}
    {attempt?.destinationTxHash && <p className="hash-value">Base delivery: {attempt.destinationTxHash}</p>}
    {attempt?.refundTxHash && <p className="hash-value">NEAR refund: {attempt.refundTxHash}</p>}
    {attempt?.fundingTxHash && <p className="hash-value">NEAR funding transaction: {attempt.fundingTxHash}</p>}
    {canPrepare && (!attempt || attempt.status === "PREPARED") && <button onClick={() => void prepare()} disabled={working}>{working ? "Preparing…" : attempt ? "Refresh quote" : "Prepare firm quote"}</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
