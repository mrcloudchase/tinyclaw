import { describe, it, expect } from "vitest";
import {
  isContextOverflowError,
  isAuthError,
  isRateLimitError,
  isTimeoutError,
  describeError,
} from "../../src/utils/errors.js";

describe("isContextOverflowError", () => {
  it("detects context_length_exceeded", () => {
    expect(isContextOverflowError(new Error("context_length_exceeded"))).toBe(true);
  });

  it("detects maximum context length", () => {
    expect(isContextOverflowError(new Error("maximum context length exceeded"))).toBe(true);
  });

  it("detects token limit", () => {
    expect(isContextOverflowError(new Error("token limit reached"))).toBe(true);
  });

  it("detects prompt is too long", () => {
    expect(isContextOverflowError(new Error("prompt is too long"))).toBe(true);
  });

  it("detects request too large", () => {
    expect(isContextOverflowError(new Error("request too large"))).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isContextOverflowError(new Error("random error"))).toBe(false);
  });
});

describe("isAuthError", () => {
  it("detects status 401", () => {
    expect(isAuthError({ status: 401, message: "" })).toBe(true);
  });

  it("detects status 403", () => {
    expect(isAuthError({ status: 403, message: "" })).toBe(true);
  });

  it("detects unauthorized message", () => {
    expect(isAuthError(new Error("unauthorized access"))).toBe(true);
  });

  it("detects invalid_api_key", () => {
    expect(isAuthError(new Error("invalid_api_key"))).toBe(true);
  });

  it("detects invalid x-api-key", () => {
    expect(isAuthError(new Error("invalid x-api-key"))).toBe(true);
  });

  it("detects permission denied", () => {
    expect(isAuthError(new Error("permission denied"))).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isAuthError(new Error("random error"))).toBe(false);
  });
});

describe("isRateLimitError", () => {
  it("detects status 429", () => {
    expect(isRateLimitError({ status: 429, message: "" })).toBe(true);
  });

  it("detects rate_limit message", () => {
    expect(isRateLimitError(new Error("rate_limit exceeded"))).toBe(true);
  });

  it("detects too many requests", () => {
    expect(isRateLimitError(new Error("too many requests"))).toBe(true);
  });

  it("detects quota exceeded", () => {
    expect(isRateLimitError(new Error("quota exceeded"))).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isRateLimitError(new Error("some error"))).toBe(false);
  });
});

describe("isTimeoutError", () => {
  it("detects timeout message", () => {
    expect(isTimeoutError(new Error("connection timeout"))).toBe(true);
  });

  it("detects ETIMEDOUT", () => {
    expect(isTimeoutError(new Error("ETIMEDOUT"))).toBe(true);
  });

  it("detects ECONNRESET", () => {
    expect(isTimeoutError(new Error("ECONNRESET"))).toBe(true);
  });

  it("detects socket hang up", () => {
    expect(isTimeoutError(new Error("socket hang up"))).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isTimeoutError(new Error("auth failed"))).toBe(false);
  });
});

describe("describeError", () => {
  it("returns message for Error instances", () => {
    expect(describeError(new Error("test error"))).toBe("test error");
  });

  it("stringifies non-Error values", () => {
    expect(describeError("string error")).toBe("string error");
    expect(describeError(42)).toBe("42");
    expect(describeError(null)).toBe("null");
  });
});
