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


def test_updated_at_trigger_function_uses_fixed_search_path() -> None:
    sql = _normalized_migration_sql()

    assert "create or replace function public.set_updated_at()" in sql
    assert "set search_path = public, pg_temp" in sql


def test_migration_chain_does_not_create_duplicate_devices_install_indexes() -> None:
    sql = _normalized_migration_sql()

    assert "constraint devices_user_install_unique unique (user_id, install_id_hash)" in sql
    assert "devices_user_install_unique_idx" not in sql


def test_migration_chain_indexes_foreign_keys_reported_by_advisors() -> None:
    sql = _normalized_migration_sql()

    expected_indexes = [
        "create index if not exists adk_sessions_conversation_id_idx on public.adk_sessions (conversation_id)",
        "create index if not exists artifacts_adk_session_row_id_idx on public.artifacts (adk_session_row_id)",
    ]

    for expected_index in expected_indexes:
        assert expected_index in sql


def test_migration_chain_includes_dialogue_logs_table() -> None:
    sql = _normalized_migration_sql()

    expected_fragments = [
        "create table if not exists public.dialogue_logs",
        "user_id text not null",
        "user_text text not null default ''",
        "assistant_text text not null default ''",
        "logged_at timestamptz not null default timezone('utc', now())",
        "create index if not exists dialogue_logs_user_logged_at_idx on public.dialogue_logs (user_id, logged_at desc)",
        "alter table public.dialogue_logs enable row level security",
    ]

    for expected_fragment in expected_fragments:
        assert expected_fragment in sql
