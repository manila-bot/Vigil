"""Nemotron multi-step triage. OWNER: NVIDIA & Detection teammate.

Implement run(conn, incident) and return the same shape as engine._stub:
    {"provider": "nemotron", "model": "<model id>", "tool_calls": [...], "draft": {...}}

Suggested loop (OpenAI-compatible chat API, key from env NVIDIA_API_KEY, never sent to the browser):
  1. messages = [system prompt, user: incident summary]; tools = tools.TOOL_SPECS
  2. call model; for each tool_call -> engine.run_tool_logged(conn, incident["id"], step, name, args, log)
  3. append tool results, repeat until the model returns the final JSON draft (max ~5 rounds)
  4. return the draft; the router validates it against schemas.TriageDraft and checks evidence refs/owners.
"""


def run(conn, incident):
    raise NotImplementedError("Nemotron triage not implemented yet — unset VIGIL_NEMOTRON_ENABLED to use the mock.")
