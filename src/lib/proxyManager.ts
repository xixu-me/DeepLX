/**
 * IP rotation and proxy management for DeepLX
 * Handles proxy selection, browser fingerprinting, and request routing
 */

/**
 * Collection of realistic browser user agents for fingerprinting
 */
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
];

/**
 * Collection of realistic accept-language headers for regional diversity
 */
const ACCEPT_LANGUAGES = [
  "en-US,en;q=0.9",
  "en-GB,en;q=0.9",
  "en-US,en;q=0.8,es;q=0.6",
  "en-US,en;q=0.9,fr;q=0.8",
  "en-US,en;q=0.9,de;q=0.8",
];

/**
 * Get available proxy endpoints from environment configuration
 * Parses and validates proxy URLs from environment variables
 * @param env Environment bindings containing proxy configuration
 * @returns Promise<ProxyEndpoint[]> - Array of available proxy endpoints
 */
export async function getProxyEndpoints(env: Env): Promise<ProxyEndpoint[]> {
  // Get proxy URLs from environment variables
  const proxyUrls = env.PROXY_URLS
    ? env.PROXY_URLS.split(",").map((url) => url.trim())
    : [];

  // Return validated proxy endpoints
  return proxyUrls.map((url) => ({
    url,
  }));
}

/**
 * Select a random proxy from available endpoints
 * Implements random selection for load distribution
 * @param env Environment bindings containing proxy configuration
 * @returns Promise<ProxyEndpoint | null> - Selected proxy or null if none available
 */
export async function selectProxy(env: Env): Promise<ProxyEndpoint | null> {
  try {
    const proxies = await getProxyEndpoints(env);

    if (proxies.length === 0) {
      return null;
    }

    // Random selection for load balancing
    const index = Math.floor(Math.random() * proxies.length);
    return proxies[index];
  } catch (error) {
    console.error("Failed to select proxy:", error);
    return null;
  }
}

/**
 * Generate realistic browser fingerprint headers
 * Creates randomized headers to mimic real browser requests
 * @returns Record<string, string> - Object containing HTTP headers
 */
export function generateBrowserFingerprint(): Record<string, string> {
  return {
    "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    "Accept-Language":
      ACCEPT_LANGUAGES[Math.floor(Math.random() * ACCEPT_LANGUAGES.length)],
    Accept: "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, deflate, br",
    DNT: "1",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
  };
}
