function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

function getStatusCode(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    return (error as { status: number }).status;
  }
  if (error && typeof error === "object" && "statusCode" in error) {
    return (error as { statusCode: number }).statusCode;
  }
  return undefined;
}

export function isContextOverflowError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("context_length_exceeded") ||
    msg.includes("maximum context length") ||
    msg.includes("token limit") ||
    msg.includes("prompt is too long") ||
    msg.includes("request too large") ||
    msg.includes("max_tokens")
  );
}

export function isAuthError(error: unknown): boolean {
  const status = getStatusCode(error);
  if (status === 401 || status === 403) return true;
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("unauthorized") ||
    msg.includes("invalid_api_key") ||
    msg.includes("authentication") ||
    msg.includes("permission denied") ||
    msg.includes("invalid x-api-key")
  );
}

export function isRateLimitError(error: unknown): boolean {
  const status = getStatusCode(error);
  if (status === 429) return true;
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("rate_limit") ||
    msg.includes("too many requests") ||
    msg.includes("quota exceeded") ||
    msg.includes("rate limit")
  );
}

export function isTimeoutError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up")
  );
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
