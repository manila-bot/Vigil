"""Request bodies and the AI triage draft shape. Shared by core, NVIDIA and Photon modules."""
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

Availability = Literal["available", "degraded", "locked", "destroyed", "unknown"]
Copying = Literal["none_observed", "suspected", "confirmed", "unknown"]
Certainty = Literal["observed", "confirmed", "unknown"]
IncidentStatus = Literal["open", "investigating", "contained", "recovering", "closed"]
Severity = Literal["low", "medium", "high", "critical"]
TaskStatus = Literal["open", "in_progress", "done", "blocked"]


class LoginIn(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)


class UserCreate(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=200)
    name: str = Field(min_length=1, max_length=100)
    role: Literal["admin", "responder"] = "responder"
    team_role: Optional[str] = Field(None, max_length=100)
    password: str = Field(min_length=10, max_length=200)
    phone: Optional[str] = Field(None, max_length=30)
    alert_opt_in: bool = False


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    role: Optional[Literal["admin", "responder"]] = None
    team_role: Optional[str] = Field(None, max_length=100)
    active: Optional[bool] = None
    phone: Optional[str] = Field(None, max_length=30)
    alert_opt_in: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=10, max_length=200)


class IncidentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    severity: Severity = "high"
    category: Optional[str] = Field(None, max_length=50)
    summary: Optional[str] = Field(None, max_length=5000)
    detected_at: Optional[str] = None


class IncidentUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    status: Optional[IncidentStatus] = None
    severity: Optional[Severity] = None
    summary: Optional[str] = Field(None, max_length=5000)


class ScopeCreate(BaseModel):
    system: str = Field(min_length=1, max_length=100)
    data_category: str = Field(min_length=1, max_length=100)
    matter_code: Optional[str] = Field(None, max_length=50)
    availability: Availability = "unknown"
    copying: Copying = "unknown"
    certainty: Certainty = "unknown"
    notes: Optional[str] = Field(None, max_length=2000)


class ScopeUpdate(BaseModel):
    availability: Optional[Availability] = None
    copying: Optional[Copying] = None
    certainty: Optional[Certainty] = None
    notes: Optional[str] = Field(None, max_length=2000)


class EvidenceCreate(BaseModel):
    kind: str = Field(min_length=1, max_length=50)
    description: str = Field(min_length=1, max_length=2000)
    observed_at: Optional[str] = None
    certainty: Certainty = "observed"


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)

    @field_validator("body")
    @classmethod
    def not_blank(cls, v):
        if not v.strip():
            raise ValueError("Message is empty")
        return v.strip()


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    owner_user_id: Optional[int] = None
    owner_label: Optional[str] = Field(None, max_length=100)
    priority: Severity = "high"
    due_at: Optional[str] = None
    evidence_refs: List[str] = []


class TaskUpdate(BaseModel):
    status: Optional[TaskStatus] = None
    owner_user_id: Optional[int] = None
    owner_label: Optional[str] = Field(None, max_length=100)
    due_at: Optional[str] = None


# ---- AI triage draft (NVIDIA module must return exactly this shape) ----

class DraftTask(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    owner_role: str = Field(min_length=1, max_length=100)          # e.g. 'Litigation lead'
    owner_user_id: Optional[int] = None
    due_at: Optional[str] = None                                    # ISO 8601
    priority: Severity = "high"
    evidence_refs: List[str] = []                                   # e.g. ['EV-1']
    matter_code: Optional[str] = None
    rationale: Optional[str] = Field(None, max_length=1000)


class TriageDraft(BaseModel):
    summary: str = Field(min_length=1, max_length=2000)
    tasks: List[DraftTask] = Field(min_length=1, max_length=10)
    unknowns: List[str] = []
    evidence_refs: List[str] = []
    recommend_alert: bool = True


class ApproveIn(BaseModel):
    triage_id: int
    decision: Literal["approve", "reject"] = "approve"
    task_indexes: Optional[List[int]] = None   # approve a subset; default all


class NotifyIn(BaseModel):
    recipient_user_id: int
    channel: Literal["imessage", "sms"] = "imessage"
    task_id: int | None = None


class ITRequestCreate(BaseModel):
    matter_code: str = Field(min_length=1, max_length=100)
    body: str = Field(min_length=1, max_length=1000)


class SimulateIn(BaseModel):
    # rename_burst / benign are the runbook's names for the same two fixtures.
    fixture: Literal["ransomware_burst", "normal_activity", "rename_burst", "benign"] = "ransomware_burst"
