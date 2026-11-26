export const pilotMode = process.env.NEXT_PUBLIC_COVENDRO_PILOT === "true";
export const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function apiFetch(url: string, options?: RequestInit) {
  if (!pilotMode) return fetch(url, options);
  const headers = new Headers(options?.headers);
  headers.delete("x-demo-user-email");
  return fetch(url, { ...options, headers, credentials: "include" });
}
