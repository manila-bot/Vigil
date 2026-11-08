import { describe, expect, it } from "vitest";
import { canAdmin, canClaim, formatCountdown, roleLabel, USERS, FILING_DUE_MS } from "@/lib/vigil";

describe("Vigil rules", () => {
  it("shows responder as Team Member", () => expect(roleLabel("responder")).toBe("Team Member"));
  it("lets IT responders claim tasks but not lawyers", () => {
    expect(canClaim(USERS.find((u) => u.role === "responder"))).toBe(true);
    expect(canClaim(USERS.find((u) => u.role === "lawyer"))).toBe(false);
  });
  it("shows Access only to admins", () => {
    expect(canAdmin(USERS.find((u) => u.role === "admin"))).toBe(true);
    expect(canAdmin(USERS.find((u) => u.role === "responder"))).toBe(false);
  });
  it("filing is due 29h after the 9 a.m. attack", () => expect(formatCountdown(FILING_DUE_MS)).toBe("29h 00m 00s"));
});
