function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const inner = hostname.slice(1, -1);
    if (inner === "::1") return true;
  }
  return false;
}

function normalizeHttpsOrHttpUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${name} must be an absolute http/https URL`);
  }

  if (url.protocol === "https:") {
    // https is always allowed
  } else if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) {
    // http is allowed only for loopback hosts
  } else {
    throw new Error(`${name} must be an absolute http/https URL`);
  }

  url.search = "";
  url.hash = "";
  return url;
}

/**
 * Normalizes the configured authentik host into a canonical absolute URL.
 * @param authentikHost - Raw authentik host value.
 * @returns Canonical host URL without a trailing slash.
 */
export function normalizeAuthentikHost(authentikHost: string): string {
  const url = normalizeHttpsOrHttpUrl("AUTHENTIK_HOST", authentikHost);
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

/**
 * Normalizes and validates an authentik provider slug.
 * @param providerSlug - Raw provider slug.
 * @returns Sanitized provider slug.
 */
export function normalizeProviderSlug(providerSlug: string): string {
  const slug = providerSlug.trim().replace(/^\/+|\/+$/g, "");
  if (!slug) throw new Error("AUTHENTIK_PROVIDER_SLUG is required");
  if (!/^[A-Za-z0-9._~-]+$/.test(slug)) {
    throw new Error("AUTHENTIK_PROVIDER_SLUG contains invalid characters");
  }
  return slug;
}

/**
 * Derives the authentik OpenID Connect discovery URL from host and provider slug.
 * @param authentikHost - Base authentik host.
 * @param providerSlug - Authentik provider slug.
 * @returns Discovery endpoint URL.
 */
export function deriveDiscoveryUrl(authentikHost: string, providerSlug: string): string {
  const base = new URL(normalizeAuthentikHost(authentikHost));
  const slug = normalizeProviderSlug(providerSlug);
  const prefix = base.pathname === "/" ? "" : base.pathname;
  base.pathname = `${prefix}/application/o/${slug}/.well-known/openid-configuration`;
  return base.toString();
}

/**
 * Builds the loopback redirect URI used for native-app browser login.
 * @param port - Loopback callback server port.
 * @param callbackPath - Callback path served by the local HTTP server.
 * @returns Absolute loopback redirect URI.
 */
export function buildLoopbackRedirectUri(port: number, callbackPath = "/callback"): string {
  const normalizedPath = callbackPath.startsWith("/") ? callbackPath : `/${callbackPath}`;
  return `http://127.0.0.1:${port}${normalizedPath}`;
}
