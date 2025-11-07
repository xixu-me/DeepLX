/**
 * Core translation query functionality for DeepLX API
 * Handles communication with DeepL API endpoints with retry logic and rate limiting
 */

import {
  DEFAULT_RETRY_CONFIG,
  PAYLOAD_LIMITS,
  REQUEST_TIMEOUT,
} from "./config";
import { API_URL, REQUEST_ALTERNATIVES } from "./const";
import { createErrorResponse } from "./errorHandler";
import { generateBrowserFingerprint, selectProxy } from "./proxyManager";
import { checkCombinedRateLimit } from "./rateLimit";
import { isRetryableError, RetryOptions, retryWithBackoff } from "./retryLogic";
import {
  Config,
  createStandardResponse,
  RawResponseParams,
  RequestParams,
  ResponseParams,
} from "./types";

/**
 * Ensure language code is in uppercase format for consistent output
 * @param langCode - Language code to convert
 * @returns Language code in uppercase
 * @private
 */
function ensureUppercaseLanguageCode(langCode: string): string {
  if (!langCode || langCode.toLowerCase() === "auto") {
    return "auto";
  }
  return langCode.toUpperCase();
}

/**
 * Normalize language code to ensure compatibility with DeepL API
 * Accepts both lowercase and uppercase input, always returns uppercase
 * @param langCode - Language code to normalize
 * @returns Normalized language code in uppercase format for DeepL API
 * @private
 */
function normalizeLanguageCode(langCode: string): string {
  if (!langCode || langCode.toLowerCase() === "auto") {
    return "auto";
  }

  const normalized = langCode.toLowerCase();

  // Map common language variations to DeepL-supported codes
  const languageMap: Record<string, string> = {
    chinese: "ZH",
    english: "EN",
    spanish: "ES",
    french: "FR",
    german: "DE",
    italian: "IT",
    japanese: "JA",
    portuguese: "PT",
    russian: "RU",
    dutch: "NL",
    polish: "PL",
    swedish: "SV",
    danish: "DA",
    norwegian: "NB",
    finnish: "FI",
    czech: "CS",
    slovak: "SK",
    slovenian: "SL",
    estonian: "ET",
    latvian: "LV",
    lithuanian: "LT",
    hungarian: "HU",
    romanian: "RO",
    bulgarian: "BG",
    greek: "EL",
    turkish: "TR",
    ukrainian: "UK",
    korean: "KO",
    indonesian: "ID",
  };

  // Check if it's a mapped language name
  if (languageMap[normalized]) {
    return languageMap[normalized]; // Return uppercase for DeepL API
  }

  // Convert to uppercase for DeepL API
  return normalized.toUpperCase();
}

/**
 * Build request parameters for DeepL API
 * Creates the structured request object with language settings
 * @param sourceLang - Source language code (defaults to "auto")
 * @param targetLang - Target language code (defaults to "en")
 * @returns Structured request parameters object
 * @private
 */

function buildRequestParams(sourceLang = "auto", targetLang = "en") {
  // Generate a more reliable ID using a simpler approach
  const timestamp = Date.now();
  const randomComponent = Math.floor(Math.random() * 1000000);
  // Ensure ID is within a safe range (8-9 digits)
  const requestId = Math.floor(
    (timestamp % 100000000) + (randomComponent % 100000000)
  );

  // Normalize language codes
  const normalizedSourceLang = normalizeLanguageCode(sourceLang || "auto");
  const normalizedTargetLang = normalizeLanguageCode(targetLang || "en");

  return {
    jsonrpc: "2.0",
    method: "LMT_handle_texts",
    id: requestId,
    params: {
      texts: [{ text: "", requestAlternatives: REQUEST_ALTERNATIVES }],
      timestamp: 0,
      splitting: "newlines",
      lang: {
        source_lang_user_selected: normalizedSourceLang,
        target_lang: normalizedTargetLang,
      },
    },
  };
}

/**
 * Count occurrences of letter 'i' in text
 * Used for generating request timestamps
 * @param translateText - The text to analyze
 * @returns Number of 'i' characters in the text
 * @private
 */
function countLetterI(translateText: string) {
  return (translateText || "").split("i").length - 1;
}

/**
 * Generate timestamp based on letter count with improved stability
 * Creates a modified timestamp for request uniqueness that follows DeepL's expected format
 * @param letterCount Count of specific letters in text
 * @returns Modified timestamp value
 * @private
 */
function getTimestamp(letterCount: number) {
  const timestamp = Date.now();

  // Ensure we have a valid letter count
  const safeLetterCount = Math.max(0, letterCount || 0);

  // If no letter count, return current timestamp
  if (safeLetterCount === 0) {
    return timestamp;
  }

  // Apply DeepL's timestamp modification formula more carefully
  const modValue = safeLetterCount + 1;

  // Ensure modValue is reasonable to prevent overflow
  if (modValue <= 0 || modValue > 1000) {
    return timestamp;
  }

  try {
    const modifiedTimestamp = timestamp - (timestamp % modValue) + modValue;

    // Validate the result is reasonable
    if (
      modifiedTimestamp > 0 &&
      modifiedTimestamp <= Number.MAX_SAFE_INTEGER &&
      modifiedTimestamp >= timestamp - 1000
    ) {
      // Should be close to original timestamp
      return modifiedTimestamp;
    }
  } catch (error) {
    // If any calculation fails, return original timestamp
    console.warn("Timestamp calculation failed, using original:", error);
  }

  return timestamp;
}

/**
 * Build complete request body for DeepL API with enhanced validation
 * Assembles the full request with text, parameters, and timestamp
 * @param data Request parameters containing text and languages
 * @returns JSON string ready for API submission
 * @private
 */
function buildRequestBody(data: RequestParams) {
  // Validate input parameters
  if (!data || !data.text || typeof data.text !== "string") {
    throw new Error(
      "Invalid request parameters: text is required and must be a string"
    );
  }

  // Ensure text is not empty
  const trimmedText = data.text;
  if (!trimmedText) {
    throw new Error("Invalid request parameters: text cannot be empty");
  }

  // Apply more conservative text length limits to prevent 413 errors
  const maxTextLength = PAYLOAD_LIMITS.MAX_TEXT_LENGTH;
  if (trimmedText.length > maxTextLength) {
    throw new Error(
      `Text too long. Maximum length is ${maxTextLength} characters to prevent payload size errors.`
    );
  }

  // Validate and normalize language codes before building request
  const sourceLang = data.source_lang || "auto";
  const targetLang = data.target_lang || "en";

  // Log language normalization for debugging (only in debug mode)
  if (typeof globalThis !== "undefined" && globalThis.DEBUG_MODE) {
    if (sourceLang !== "auto") {
      console.debug(`Source language normalized: ${sourceLang}`);
    }
    console.debug(`Target language normalized: ${targetLang}`);
  }

  const requestData = buildRequestParams(sourceLang, targetLang);
  requestData.params.texts = [
    { text: trimmedText, requestAlternatives: REQUEST_ALTERNATIVES },
  ];

  const letterICount = countLetterI(trimmedText);
  const timestamp = getTimestamp(letterICount);

  // Validate timestamp before assigning
  if (timestamp <= 0 || !Number.isFinite(timestamp)) {
    throw new Error("Invalid timestamp generated");
  }

  requestData.params.timestamp = timestamp;

  // Build the request string with proper formatting
  let requestString = JSON.stringify(requestData);

  // Apply DeepL's specific formatting requirements
  const requestId = requestData.id;

  // Use DeepL's method spacing logic - simplified and more reliable
  if ((requestId + 5) % 29 === 0 || (requestId + 3) % 13 === 0) {
    requestString = requestString.replace('"method":"', '"method" : "');
  } else {
    requestString = requestString.replace('"method":"', '"method": "');
  }

  // Validate final payload size to prevent 413 errors
  const payloadSize = new TextEncoder().encode(requestString).length;
  if (payloadSize > PAYLOAD_LIMITS.MAX_REQUEST_SIZE) {
    throw new Error(
      `Request payload too large (${payloadSize} bytes). Maximum allowed is ${PAYLOAD_LIMITS.MAX_REQUEST_SIZE} bytes. Please reduce text length.`
    );
  }

  return requestString;
}

/**
 * Main translation query function
 * Handles the complete translation workflow with retry logic, rate limiting, and error handling
 * @param params Translation request parameters (text, source language, target language)
 * @param config Optional configuration including proxy settings and environment
 * @returns Promise<ResponseParams> - Standardized response with translation result
 */
async function query(
  params: RequestParams,
  config?: Config & { env?: any }
): Promise<ResponseParams> {
  if (!params?.text) {
    return createStandardResponse(
      400,
      null,
      undefined,
      normalizeLanguageCode(params?.source_lang || "auto"),
      normalizeLanguageCode(params?.target_lang || "en")
    );
  }

  const retryOptions: RetryOptions = {
    ...DEFAULT_RETRY_CONFIG,
    isRetryable: isRetryableError,
  };

  try {
    return await retryWithBackoff(async () => {
      const proxy = config?.env ? await selectProxy(config.env) : null;
      const endpoint = config?.proxyEndpoint ?? proxy?.url ?? API_URL;

      // Use comprehensive rate limit check - includes client and proxy backend limits
      if (config?.env) {
        const clientIP = config?.clientIP || "unknown";
        const rateLimitResult = await checkCombinedRateLimit(
          clientIP,
          endpoint,
          config.env
        );
        if (!rateLimitResult.allowed) {
          const error = new Error(
            rateLimitResult.reason || "Rate limit exceeded"
          );
          (error as any).code = 429;
          throw error;
        }
      }

      const fingerprint = generateBrowserFingerprint();

      const makeRequest = async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

        try {
          const requestBody = buildRequestBody(params);

          const response = await fetch(endpoint, {
            headers: {
              "Content-Type": "application/json",
              Accept: "*/*",
              "Accept-Language": "en-US,en;q=0.9",
              "Accept-Encoding": "gzip, deflate, br, zstd",
              Origin: "https://www.deepl.com",
              Connection: "keep-alive",
              Referer: "https://www.deepl.com/",
              "Sec-Fetch-Dest": "empty",
              "Sec-Fetch-Mode": "cors",
              "Sec-Fetch-Site": "same-site",
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
              // ...fingerprint,
              ...config?.customHeader,
            },
            method: "POST",
            body: requestBody,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          // If we get a 400 error, log the request body for debugging
          if (!response.ok && response.status === 400) {
            console.error(`400 error received. Request body was:`, requestBody);
          }

          // Check for rate limit error specifically
          if (!response.ok && response.status === 429) {
            const error = new Error(
              "Too many requests, your IP has been blocked by DeepL temporarily, please don't request it frequently in a short time"
            );
            (error as any).status = 429;
            throw error;
          }

          // Check for other error status codes (general non-200 check)
          if (!response.ok) {
            let errorMessage = `Request failed with status code: ${response.status}`;
            try {
              const errorText = await response.text();
              if (errorText) {
                errorMessage += ` - ${errorText}`;
              }
            } catch {
              // Ignore error when reading response body
            }

            const error = new Error(errorMessage);
            (error as any).status = response.status;
            throw error;
          }

          return response;
        } catch (error) {
          clearTimeout(timeoutId);
          if (error instanceof Error && error.name === "AbortError") {
            const timeoutError = new Error(
              `Request timeout after ${
                REQUEST_TIMEOUT / 1000
              } seconds to ${endpoint}`
            );
            (timeoutError as any).status = 408;
            throw timeoutError;
          }
          throw error;
        }
      };

      const response = await makeRequest();

      if (!response.ok) {
        let errorMessage = `Request failed with status ${response.status}`;
        try {
          const errorText = await response.text();
          if (errorText) {
            errorMessage += `: ${errorText}`;
          }
        } catch {
          // Ignore error when reading response body
        }

        const error = new Error(errorMessage);
        (error as any).status = response.status;
        throw error;
      }

      let result: RawResponseParams;
      try {
        result = (await response.json()) as RawResponseParams;
      } catch (parseError) {
        const error = new Error(
          `Failed to parse JSON response from ${endpoint}: ${
            parseError instanceof Error
              ? parseError.message
              : String(parseError)
          }`
        );
        (error as any).code = 500;
        throw error;
      }
      if ("error" in result && result.error) {
        const errorCode = (result.error as any).code;
        const errorMessage =
          (result.error as any).message || "Unknown DeepL API error";

        // Handle specific DeepL error codes
        let enhancedMessage = errorMessage;

        switch (errorCode) {
          case 1156049:
            enhancedMessage =
              "Invalid request format detected. This may be caused by: " +
              "1) Incorrect JSON-RPC structure, " +
              "2) Invalid request ID format, " +
              "3) Malformed timestamp, or " +
              "4) Unsupported language codes. " +
              "Please verify your request parameters and try again.";
            break;
          case 1042912:
            enhancedMessage = "Too many requests. Please try again later.";
            break;
          case 1042513:
            enhancedMessage = "Request quota exceeded. Please try again later.";
            break;
          case 1042003:
            enhancedMessage =
              "Invalid authentication. Please check your API configuration.";
            break;
          default:
            enhancedMessage = `DeepL API error: ${errorMessage} (Code: ${errorCode})`;
        }

        const error = new Error(enhancedMessage);
        (error as any).code = errorCode;
        (error as any).originalMessage = errorMessage;
        throw error;
      }

      if (
        !result.result ||
        !result.result.texts ||
        !result.result.texts.length
      ) {
        const error = new Error("Invalid response structure from DeepL API");
        (error as any).code = 500;
        throw error;
      }

      const translatedText = result.result.texts[0].text;

      return createStandardResponse(
        200,
        translatedText,
        result.id,
        (result.result.lang as string).toUpperCase(),
        normalizeLanguageCode(params.target_lang)
      );
    }, retryOptions);
  } catch (error: any) {
    const errorDetails = createErrorResponse(error, {
      endpoint: config?.proxyEndpoint,
    });

    return createStandardResponse(
      errorDetails.httpStatus,
      null,
      undefined,
      normalizeLanguageCode(params.source_lang || "auto"),
      normalizeLanguageCode(params.target_lang || "en")
    );
  }
}

export { buildRequestBody, normalizeLanguageCode, query };
