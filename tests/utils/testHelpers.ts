/**
 * Test utility functions and helpers
 */

/**
 * Create a mock translation response
 */
export function createMockTranslationResponse(
  text: string = "你好世界",
  sourceLang: string = "EN",
  targetLang: string = "ZH",
  id: number = 12345
) {
  return {
    result: {
      texts: [{ text }],
      lang: sourceLang,
    },
    id,
  };
}

/**
 * Create a mock error response
 */
export function createMockErrorResponse(
  code: number = 1156049,
  message: string = "Invalid request format"
) {
  return {
    error: {
      code,
      message,
    },
  };
}

/**
 * Create a mock fetch response
 */
export function createMockFetchResponse(
  data: any,
  options: { ok?: boolean; status?: number } = {}
) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

/**
 * Create a mock request object
 */
export function createMockRequest(
  url: string,
  options: RequestInit & { body?: any } = {}
) {
  return {
    url,
    method: options.method || "GET",
    headers: new Map(Object.entries(options.headers || {})),
    json: () => Promise.resolve(options.body || {}),
    text: () =>
      Promise.resolve(
        typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body || {})
      ),
  };
}

/**
 * Create a mock Hono context
 */
export function createMockHonoContext(
  request: any,
  env: Env,
  options: any = {}
) {
  return {
    req: {
      raw: request,
      json: () => request.json(),
      text: () => request.text(),
    },
    env,
    json: jest.fn().mockImplementation((data, status) => ({
      data,
      status: status || 200,
    })),
    text: jest.fn().mockImplementation((text, status, headers) => ({
      text,
      status: status || 200,
      headers,
    })),
    redirect: jest.fn().mockImplementation((url) => ({
      redirect: url,
      status: 302,
    })),
    ...options,
  };
}

/**
 * Wait for a specified amount of time
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate random text for testing
 */
export function generateRandomText(length: number = 100): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Mock KV namespace with common operations
 */
export function createMockKV() {
  const storage = new Map<string, string>();

  return {
    get: jest.fn().mockImplementation((key: string) => {
      return Promise.resolve(storage.get(key) || null);
    }),
    put: jest.fn().mockImplementation((key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    }),
    delete: jest.fn().mockImplementation((key: string) => {
      storage.delete(key);
      return Promise.resolve();
    }),
    list: jest.fn().mockImplementation(() => {
      return Promise.resolve({
        keys: Array.from(storage.keys()).map((key) => ({ name: key })),
      });
    }),
    // Internal storage for testing
    _storage: storage,
  };
}

/**
 * Assert that a response matches the expected translation format
 */
export function expectValidTranslationResponse(response: any) {
  expect(response).toHaveProperty("code");
  expect(response).toHaveProperty("data");
  expect(response).toHaveProperty("id");
  expect(response).toHaveProperty("source_lang");
  expect(response).toHaveProperty("target_lang");
  expect(typeof response.code).toBe("number");
  expect(typeof response.id).toBe("number");
  expect(typeof response.source_lang).toBe("string");
  expect(typeof response.target_lang).toBe("string");
}

/**
 * Assert that a response matches the expected error format
 */
export function expectValidErrorResponse(response: any) {
  expect(response).toHaveProperty("code");
  expect(response).toHaveProperty("data");
  expect(response.code).toBeGreaterThanOrEqual(400);
  expect(response.data).toBeNull();
}

/**
 * Create a comprehensive test environment
 */
export function createTestEnvironment() {
  const cacheKV = createMockKV();
  const rateLimitKV = createMockKV();

  const env: Env = {
    CACHE_KV: cacheKV as any,
    RATE_LIMIT_KV: rateLimitKV as any,
    ANALYTICS: {
      writeDataPoint: jest.fn(),
    } as any,
    PROXY_URLS:
      "https://test1.example.com/jsonrpc,https://test2.example.com/jsonrpc",
    PROXY_WEIGHTS: "1,1",
    DEBUG_MODE: "true",
  };

  return {
    env,
    cacheKV,
    rateLimitKV,
    cleanup: () => {
      cacheKV._storage.clear();
      rateLimitKV._storage.clear();
      jest.clearAllMocks();
    },
  };
}

/**
 * Performance measurement utility
 */
export class PerformanceTimer {
  private startTime: number = 0;
  private endTime: number = 0;

  start(): void {
    this.startTime = Date.now();
  }

  stop(): number {
    this.endTime = Date.now();
    return this.endTime - this.startTime;
  }

  get duration(): number {
    return this.endTime - this.startTime;
  }
}

/**
 * Retry utility for flaky tests
 */
export async function retryTest<T>(
  testFn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 100
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await testFn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}
