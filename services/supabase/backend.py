from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Protocol

import config
from services.supabase.client import get_service_role_client


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SupabaseBackend(Protocol):
    def insert(self, table: str, row: dict[str, Any]) -> dict[str, Any]:
        ...

    def select(
        self,
        table: str,
        *,
        filters: dict[str, Any] | None = None,
        order_by: str | None = None,
        ascending: bool = True,
    ) -> list[dict[str, Any]]:
        ...

    def update(
        self,
        table: str,
        *,
        filters: dict[str, Any],
        values: dict[str, Any],
    ) -> list[dict[str, Any]]:
        ...

    def delete(
        self,
        table: str,
        *,
        filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        ...


class InMemorySupabaseBackend:
    def __init__(self, tables: dict[str, list[dict[str, Any]]] | None = None) -> None:
        self.tables = tables or {}

    def _table(self, table: str) -> list[dict[str, Any]]:
        return self.tables.setdefault(table, [])

    @staticmethod
    def _matches(row: dict[str, Any], filters: dict[str, Any] | None) -> bool:
        if not filters:
            return True
        return all(row.get(key) == value for key, value in filters.items())

    def insert(self, table: str, row: dict[str, Any]) -> dict[str, Any]:
        stored = deepcopy(row)
        self._table(table).append(stored)
        return deepcopy(stored)

    def select(
        self,
        table: str,
        *,
        filters: dict[str, Any] | None = None,
        order_by: str | None = None,
        ascending: bool = True,
    ) -> list[dict[str, Any]]:
        rows = [
            deepcopy(row)
            for row in self._table(table)
            if self._matches(row, filters)
        ]
        if order_by:
            rows.sort(key=lambda row: row.get(order_by) or "", reverse=not ascending)
        return rows

    def update(
        self,
        table: str,
        *,
        filters: dict[str, Any],
        values: dict[str, Any],
    ) -> list[dict[str, Any]]:
        updated: list[dict[str, Any]] = []
        for row in self._table(table):
            if self._matches(row, filters):
                row.update(deepcopy(values))
                updated.append(deepcopy(row))
        return updated

    def delete(
        self,
        table: str,
        *,
        filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        rows = self._table(table)
        deleted: list[dict[str, Any]] = []
        remaining: list[dict[str, Any]] = []
        for row in rows:
            if self._matches(row, filters):
                deleted.append(deepcopy(row))
            else:
                remaining.append(row)
        self.tables[table] = remaining
        return deleted


class SupabaseServiceBackend:
    def __init__(self, client) -> None:
        self.client = client

    def insert(self, table: str, row: dict[str, Any]) -> dict[str, Any]:
        result = self.client.table(table).insert(row).execute()
        data = result.data or []
        return data[0] if data else row

    def select(
        self,
        table: str,
        *,
        filters: dict[str, Any] | None = None,
        order_by: str | None = None,
        ascending: bool = True,
    ) -> list[dict[str, Any]]:
        query = self.client.table(table).select("*")
        for key, value in (filters or {}).items():
            query = query.eq(key, value)
        if order_by:
            query = query.order(order_by, desc=not ascending)
        result = query.execute()
        return result.data or []

    def update(
        self,
        table: str,
        *,
        filters: dict[str, Any],
        values: dict[str, Any],
    ) -> list[dict[str, Any]]:
        query = self.client.table(table).update(values)
        for key, value in filters.items():
            query = query.eq(key, value)
        result = query.execute()
        return result.data or []

    def delete(
        self,
        table: str,
        *,
        filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        query = self.client.table(table).delete()
        for key, value in (filters or {}).items():
            query = query.eq(key, value)
        result = query.execute()
        return result.data or []


_shared_memory_backend = InMemorySupabaseBackend()


def get_default_backend() -> SupabaseBackend:
    if config.has_supabase_config():
        return SupabaseServiceBackend(get_service_role_client())
    return _shared_memory_backend


def reset_shared_memory_backend() -> None:
    _shared_memory_backend.tables.clear()
