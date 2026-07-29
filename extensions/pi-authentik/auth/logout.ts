/** Inputs used to construct a browser logout URL for authentik. */
export interface BuildLogoutUrlOptions {
  endSessionEndpoint?: string | null;
  logoutUrl?: string | null;
  idTokenHint?: string;
  postLogoutRedirectUri?: string;
  state?: string;
}

/**
 * Builds a logout URL using the discovered end-session endpoint or a configured fallback.
 * @param options - Logout endpoint and optional OIDC logout query parameters.
 * @returns A logout URL, or null when no logout endpoint is configured.
 */
export function buildLogoutUrl(options: BuildLogoutUrlOptions): string | null {
  const endpoint = options.endSessionEndpoint ?? options.logoutUrl;
  if (!endpoint) return null;

  const url = new URL(endpoint);
  if (options.idTokenHint) {
    url.searchParams.set("id_token_hint", options.idTokenHint);
  }
  if (options.postLogoutRedirectUri) {
    url.searchParams.set("post_logout_redirect_uri", options.postLogoutRedirectUri);
  }
  if (options.state) {
    url.searchParams.set("state", options.state);
  }

  return url.toString();
}
