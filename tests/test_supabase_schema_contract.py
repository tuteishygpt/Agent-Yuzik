from __future__ import annotations

from pathlib import Path


def _normalized_migration_sql() -> str:
    migration_dir = Path(__file__).resolve().parents[1] / "supabase" / "migrations"
    migration_chain = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(migration_dir.glob("*.sql"))
    ).lower()
    return " ".join(migration_chain.split())


def test_migration_chain_includes_mobile_teacher_contract_columns() -> None:
    sql = _normalized_migration_sql()

    fragments_in_order = [
        "alter table public.teacher_sessions rename column external_session_id to session_id",
        "alter table public.teacher_sessions rename column status to lesson_status",
        "alter table public.teacher_sessions drop constraint if exists teacher_sessions_status_valid",
        "update public.teacher_sessions set lesson_status = 'stopped' where lesson_status = 'errored'",
        "alter table public.teacher_sessions add constraint teacher_sessions_lesson_status_valid check (lesson_status in ('idle', 'active', 'completed', 'stopped'))",
        "alter table public.teacher_sessions add column if not exists mode text not null default 'teacher'",
        "alter table public.teacher_sessions add column if not exists mistakes_to_review jsonb not null default '[]'::jsonb",
        "alter table public.voice_turns add column if not exists timestamp double precision",
        "alter table public.voice_turns alter column timestamp set not null",
        "create index if not exists voice_turns_user_timestamp_idx on public.voice_turns (user_id, timestamp asc)",
    ]

    start = 0
    for fragment in fragments_in_order:
        idx = sql.find(fragment, start)
        assert idx != -1
        start = idx + len(fragment)
