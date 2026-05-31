from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Protocol

import requests

import config
from services.supabase.client import get_service_role_client
from services.supabase.config import get_supabase_service_role_settings


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


class SupabaseRestBackend:
    def __init__(self, *, url: str, key: str) -> None:
        self.url = url.rstrip("/")
        self.key = key

    def _headers(self, *, prefer: str | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Accept": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    def _request(
        self,
        method: str,
        table: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any | None = None,
        prefer: str | None = None,
    ) -> list[dict[str, Any]]:
        response = requests.request(
            method,
            f"{self.url}/rest/v1/{table}",
            headers=self._headers(prefer=prefer),
            params=params,
            json=json,
            timeout=15,
        )
        response.raise_for_status()
        if not response.content:
            return []
        data = response.json()
        if isinstance(data, list):
            return data
        return [data]

    @staticmethod
    def _filter_params(filters: dict[str, Any] | None) -> dict[str, str]:
        return {
            key: f"eq.{value}"
            for key, value in (filters or {}).items()
        }

    def insert(self, table: str, row: dict[str, Any]) -> dict[str, Any]:
        rows = self._request(
            "POST",
            table,
            json=row,
            prefer="return=representation",
        )
        return rows[0] if rows else row

    def select(
        self,
        table: str,
        *,
        filters: dict[str, Any] | None = None,
        order_by: str | None = None,
        ascending: bool = True,
    ) -> list[dict[str, Any]]:
        params = self._filter_params(filters)
        if order_by:
            direction = "asc" if ascending else "desc"
            params["order"] = f"{order_by}.{direction}"
        return self._request("GET", table, params=params)

    def update(
        self,
        table: str,
        *,
        filters: dict[str, Any],
        values: dict[str, Any],
    ) -> list[dict[str, Any]]:
        return self._request(
            "PATCH",
            table,
            params=self._filter_params(filters),
            json=values,
            prefer="return=representation",
        )

    def delete(
        self,
        table: str,
        *,
        filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        return self._request(
            "DELETE",
            table,
            params=self._filter_params(filters),
            prefer="return=representation",
        )


def get_service_role_backend() -> SupabaseBackend:
    settings = get_supabase_service_role_settings()
    if settings.service_role_key.startswith("sb_secret_"):
        return SupabaseRestBackend(url=settings.url, key=settings.service_role_key)
    return SupabaseServiceBackend(get_service_role_client(settings))


_shared_memory_backend = InMemorySupabaseBackend()


def get_default_backend() -> SupabaseBackend:
    if config.has_supabase_service_role_config():
        return get_service_role_backend()
    return _shared_memory_backend


def reset_shared_memory_backend() -> None:
    _shared_memory_backend.tables.clear()
