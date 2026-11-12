type VerificationState = "MOCKED" | "UNVERIFIED" | "VERIFIED" | "VERIFICATION_FAILED";

const descriptions: Record<VerificationState, string> = {
  MOCKED: "This result came from Covendro's deterministic local provider and is not externally verified.",
  UNVERIFIED: "The AI provider returned a result, but no attestation or response-signature verification was completed.",
  VERIFIED: "The provider evidence was checked successfully by a verification routine.",
  VERIFICATION_FAILED: "Verification or analysis failed. Treat this result as unsafe to approve.",
};

export function VerificationPanel({ state, provider, model, timestamp, explanation }: { state?: VerificationState | null; provider?: string | null; model?: string | null; timestamp?: string | null; explanation?: string | null }) {
  const current = state ?? "UNVERIFIED";
  return (
    <div className={`verification-card verification-${current.toLowerCase()}`}>
      <div className="verification-heading"><div><p className="eyebrow">AI verification</p><h3>{current}</h3></div><span className="status-badge">{provider ?? "Not analyzed"}</span></div>
      <p>{explanation ?? descriptions[current]}</p>
      <dl className="verification-meta"><dt>Provider</dt><dd>{provider ?? "—"}</dd><dt>Model</dt><dd>{model ?? "—"}</dd><dt>Checked</dt><dd>{timestamp ? new Date(timestamp).toLocaleString() : "—"}</dd></dl>
    </div>
  );
}
