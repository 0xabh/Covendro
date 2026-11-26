import type { BrowserWallet, InternalAction } from "@near-wallet-selector/core";

export type TreasuryWalletRequest = {
  network: string; signerId: string; receiverId: string; actions: InternalAction[];
};

let walletPromise: Promise<BrowserWallet> | undefined;

export function getTreasuryWallet() {
  walletPromise ??= (async () => {
    // The wallet connector uses Buffer to encode NEAR transactions in the browser.
    const { Buffer } = await import("buffer");
    globalThis.Buffer ??= Buffer;
    const [{ setupWalletSelector }, { setupMyNearWallet }] = await Promise.all([
      import("@near-wallet-selector/core"),
      import("@near-wallet-selector/my-near-wallet"),
    ]);
    const selector = await setupWalletSelector({ network: "mainnet", modules: [setupMyNearWallet()] });
    return selector.wallet<BrowserWallet>("my-near-wallet");
  })().catch((error) => {
    walletPromise = undefined;
    throw error;
  });
  return walletPromise;
}

export async function withWalletPopup<T>(operation: () => Promise<T>) {
  // Reuse the connector's named popup even if a network preflight outlasts user activation.
  const popup = window.open("about:blank", "MyNearWallet", "popup,width=480,height=640");
  if (!popup) throw new Error("Allow popups for Covendro and try again.");
  try {
    return await operation();
  } finally {
    if (!popup.closed) popup.close();
  }
}

export function decodeChallengeNonce(nonce: string) {
  const base64 = nonce.replaceAll("-", "+").replaceAll("_", "/");
  return globalThis.Buffer.from(base64, "base64");
}

export async function convertWalletActions(actions: InternalAction[]) {
  const { internalActionToNaj } = await import("@near-wallet-selector/core");
  return actions.map(internalActionToNaj);
}
