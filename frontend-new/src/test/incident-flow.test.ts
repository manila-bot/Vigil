import { describe, expect, it } from "vitest";
import { actions, initialState, getState, liveUser, setState, requestDisplayStatus, SAMPLE_DEADLINE } from "@/lib/vigil";
import { errorDetail, isITResponder, isLitigation, type ApiUser } from "@/lib/api";

const account = (role: ApiUser["role"], team_role: string | null): ApiUser => ({ id: 7, email: "a@vigil.local", name: "A", role, team_role });

describe("sample incident rules", () => {
  it("uses the requested sample filing time", () => expect(SAMPLE_DEADLINE).toBe("Tomorrow at 2:00 p.m. CT"));
  it("waits for IT only when an unclaimed task exists", () => {
    expect(requestDisplayStatus("saved", { exists: false, owner: null })).toBe("saved");
    expect(requestDisplayStatus("saved", { exists: true, owner: null })).toBe("Waiting for IT");
    expect(requestDisplayStatus("saved", { exists: true, owner: "Marcus Lee" })).toBe("saved");
  });
  it("claiming changes ownership without changing file recovery", () => {
    setState(() => ({ ...initialState(), userId: "u-it", task: { exists: true, owner: null, recovery: "not started" } }));
    expect(actions.claim().ok).toBe(true);
    expect(getState().task.owner).toBe("Marcus Lee");
    expect(getState().task.recovery).toBe("not started");
    setState(initialState);
  });
});

describe("live backend mapping", () => {
  it("maps backend roles and team roles onto UI roles", () => {
    expect(liveUser(account("admin", "Incident commander")).role).toBe("admin");
    expect(liveUser(account("responder", "Litigation lead")).role).toBe("lawyer");
    expect(liveUser(account("responder", "IT Lead")).role).toBe("responder");
  });
  it("matches the backend's claim and filing-request eligibility", () => {
    expect(isITResponder(account("responder", " IT Lead "))).toBe(true);
    expect(isITResponder(account("admin", "IT lead"))).toBe(false);
    expect(isLitigation(account("responder", "Litigation lead"))).toBe(true);
    expect(isLitigation(account("responder", "IT lead"))).toBe(false);
  });
  it("shows FastAPI error detail as-is", () => {
    expect(errorDetail(409, { detail: "Task already claimed" })).toBe("Task already claimed");
    expect(errorDetail(422, { detail: [{ msg: "Field required" }] })).toBe("Field required");
    expect(errorDetail(500, null)).toBe("Request failed (500).");
  });
});
