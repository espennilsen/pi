/** Normalized subset of OpenID Connect discovery metadata used by the extension. */
export interface OidcDiscoveryMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  response_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  code_challenge_methods_supported: string[];
  end_session_endpoint?: string;
  [key: string]: unknown;
}

/** Options for fetching and validating OpenID Connect discovery metadata. */
export interface FetchOidcDiscoveryOptions {
  discoveryUrl: string;
  expectedIssuer?: string;
  fetchImpl?: typeof fetch;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`OIDC discovery metadata is missing required string field ${key}`);
  }
  return value;
}

function requireStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`OIDC discovery metadata is missing required array field ${key}`);
  }
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (items.length === 0) {
    throw new Error(`OIDC discovery metadata field ${key} must contain at least one string value`);
  }
  return items;
}

function validateUrlField(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`OIDC discovery metadata field ${name} must be an absolute URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`OIDC discovery metadata field ${name} must use http or https`);
  }

  return url.toString();
}

/**
 * Validates raw discovery metadata and enforces the capabilities required by this extension.
 * @param input - Raw JSON payload returned by the discovery endpoint.
 * @param expectedIssuer - Optional issuer that must match the discovered issuer exactly.
 * @returns Normalized discovery metadata.
 */
export function validateOidcDiscoveryMetadata(input: unknown, expectedIssuer?: string): OidcDiscoveryMetadata {
  const record = asRecord(input);
  const metadata: OidcDiscoveryMetadata = {
    ...record,
    issuer: validateUrlField("issuer", requireString(record, "issuer")),
    authorization_endpoint: validateUrlField("authorization_endpoint", requireString(record, "authorization_endpoint")),
    token_endpoint: validateUrlField("token_endpoint", requireString(record, "token_endpoint")),
    jwks_uri: validateUrlField("jwks_uri", requireString(record, "jwks_uri")),
    response_types_supported: requireStringArray(record, "response_types_supported"),
    subject_types_supported: requireStringArray(record, "subject_types_supported"),
    id_token_signing_alg_values_supported: requireStringArray(record, "id_token_signing_alg_values_supported"),
    code_challenge_methods_supported: requireStringArray(record, "code_challenge_methods_supported"),
  };

  if (typeof record.end_session_endpoint === "string" && record.end_session_endpoint.trim()) {
    metadata.end_session_endpoint = validateUrlField("end_session_endpoint", record.end_session_endpoint);
  }

  if (expectedIssuer && metadata.issuer !== expectedIssuer) {
    throw new Error(`OIDC discovery issuer mismatch: expected ${expectedIssuer} but received ${metadata.issuer}`);
  }

  if (!metadata.response_types_supported.includes("code")) {
    throw new Error("OIDC discovery metadata must support the authorization code flow");
  }

  if (!metadata.code_challenge_methods_supported.includes("S256")) {
    throw new Error("OIDC discovery metadata must advertise PKCE S256 support");
  }

  return metadata;
}

/**
 * Fetches and validates OpenID Connect discovery metadata from the configured endpoint.
 * @param options - Discovery endpoint URL and optional validation behavior.
 * @returns Validated discovery metadata.
 */
export async function fetchOidcDiscoveryMetadata(options: FetchOidcDiscoveryOptions): Promise<OidcDiscoveryMetadata> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(options.discoveryUrl, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`OIDC discovery request failed: ${response.status} ${response.statusText}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("OIDC discovery endpoint did not return valid JSON");
  }

  return validateOidcDiscoveryMetadata(payload, options.expectedIssuer);
}
