"""Recovery evidence contract shared by the Phase 3 comparator runners."""

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class RecoveryEvidence:
    tool: str
    protocol: str
    status: str
    seeded: int
    completed_before_kill: int
    completed_after_resume: int
    duplicate_fetches_after_resume: int | None
    lost_urls: int | None
    reason: str | None

    def to_dict(self):
        return asdict(self)


def unsupported(tool: str, reason: str) -> dict:
    return RecoveryEvidence(tool, "task -> attempt -> step URL checkpoint resume", "unsupported", 0, 0, 0, None, None, reason).to_dict()
