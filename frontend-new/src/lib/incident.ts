import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, USE_MOCKS, type IncidentDetail } from "@/lib/api";
import { actions, canClaim, SAMPLE_DEADLINE, STATUS_LABEL, useCurrentUser, useVigil } from "@/lib/vigil";

/** Sample-mode incident (VITE_USE_MOCKS=1). Fictional data from src/lib/vigil.ts. */
export function useIncident() {
  const s = useVigil(); const user = useCurrentUser();
  return {
    activeIncident: s.attack ? { id: "INC-0917", title: "Ransomware on Litigation Drive" } : undefined,
    title: "Calloway v. Brightline Freight",
    deadline: SAMPLE_DEADLINE,
    availability: s.task.recovery === "verified" ? "Available — clean copy verified" : "Exhibits inaccessible",
    copying: "Unknown",
    task: { ...s.task, id: "sample-recovery", title: "Find a verified clean copy of the filing exhibits", canClaim: canClaim(user) },
    request: { status: STATUS_LABEL[s.request.status], text: s.request.text, started: s.request.status !== "idle" },
    messages: s.messages,
    active: s.attack,
    requestHelp: (files: string) => actions.requestHelp(files),
    claim: async () => { const r = actions.claim(); if (!r.ok) throw new Error(r.reason); },
    post: async (body: string) => actions.post(body),
  };
}

/** The deadline that matters most: the earliest at-risk matter with a deadline. */
export const urgentMatter = (d: IncidentDetail) => d.matters_at_risk.find((m) => m.deadline_at && m.at_risk);

/** Live incident: polls GET /incidents/{id} every 2 s. Mutations return the full payload, which replaces the cache. */
export function useLiveIncident(id: string) {
  const user = useCurrentUser();
  const client = useQueryClient();
  const key = ["vigil", "incident", id];
  const query = useQuery({ queryKey: key, queryFn: () => api.incident(id), enabled: !USE_MOCKS && !!user, refetchInterval: 2000, retry: false });
  const apply = (d: IncidentDetail) => {
    client.setQueryData(key, d);
    void client.invalidateQueries({ queryKey: ["vigil", "dashboard"] });
    return d;
  };
  return { query, data: query.data, apply };
}
