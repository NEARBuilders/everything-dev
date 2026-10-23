import { describe, expect, it } from "vitest";
import { extractSiteError, siteErrorMessage } from "./site-error";

describe("extractSiteError", () => {
  it("keeps the server's message and detail fields", () => {
    expect(extractSiteError({ message: "relay busy", detail: "retry in 30s" })).toEqual({
      message: "relay busy",
      detail: "retry in 30s",
    });
  });

  it("keeps an Error's message", () => {
    expect(extractSiteError(new Error("no passkey on this device"))).toEqual({
      message: "no passkey on this device",
      detail: null,
    });
  });

  it("yields nulls for a fetch-layer TypeError so the fallback line applies", () => {
    expect(extractSiteError(new TypeError("Failed to fetch"))).toEqual({
      message: null,
      detail: null,
    });
  });

  it("yields nulls for null/undefined", () => {
    expect(extractSiteError(null)).toEqual({ message: null, detail: null });
    expect(extractSiteError(undefined)).toEqual({ message: null, detail: null });
  });
});

describe("siteErrorMessage", () => {
  it("falls back to the translated line on a network failure", () => {
    expect(siteErrorMessage(new TypeError("Failed to fetch"), "Check your connection.")).toEqual({
      message: "Check your connection.",
      detail: null,
    });
  });

  it("prefers the server message over the fallback", () => {
    expect(siteErrorMessage({ message: "server says no" }, "fallback")).toEqual({
      message: "server says no",
      detail: null,
    });
  });
});
