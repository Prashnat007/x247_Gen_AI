import os
import uuid
import datetime
from typing import Optional, List, Dict, Any

from app.config import settings

# ─── In-Memory Mock Firestore ─────────────────────────────────────────────────

class MockDocSnapshot:
    def __init__(self, id: str, data: dict):
        self.id = id
        self.reference = MockDocRef(None, id)
        self._data = data

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> dict:
        return dict(self._data) if self._data else {}


# ── Atomic array sentinels ────────────────────────────────────────────────
# Mirror of google.cloud.firestore.ArrayUnion / ArrayRemove so the
# in-memory mock can recognise them and apply atomic semantics. The public
# `ArrayUnion` / `ArrayRemove` factories below return the *real* sentinel
# when google-cloud-firestore is importable, and one of these mock markers
# otherwise. Either flavour is safely consumed by `MockDocRef.set/update`.

class _MockArrayUnion:
    __slots__ = ("values",)
    def __init__(self, values): self.values = list(values)


class _MockArrayRemove:
    __slots__ = ("values",)
    def __init__(self, values): self.values = list(values)


def ArrayUnion(values):
    """Atomically add the given items to an array field. Use inside
    `doc.set({field: ArrayUnion([...])}, merge=True)` to make concurrent
    toggles safe across multiple devices/tabs."""
    try:
        from google.cloud.firestore import ArrayUnion as _RealArrayUnion
        return _RealArrayUnion(list(values))
    except Exception:
        return _MockArrayUnion(values)


def ArrayRemove(values):
    """Atomically remove the given items from an array field."""
    try:
        from google.cloud.firestore import ArrayRemove as _RealArrayRemove
        return _RealArrayRemove(list(values))
    except Exception:
        return _MockArrayRemove(values)


# Resolve real Firestore sentinel classes once so the mock can recognise
# them too — the public `ArrayUnion` / `ArrayRemove` factories above return
# the real classes whenever google-cloud-firestore is importable, so the
# mock client must accept them as well as its local `_MockArray*` markers.
try:
    from google.cloud.firestore_v1.transforms import (
        ArrayUnion as _RealArrayUnionCls,
        ArrayRemove as _RealArrayRemoveCls,
    )
    _UNION_CLASSES: tuple = (_MockArrayUnion, _RealArrayUnionCls)
    _REMOVE_CLASSES: tuple = (_MockArrayRemove, _RealArrayRemoveCls)
except Exception:
    _UNION_CLASSES = (_MockArrayUnion,)
    _REMOVE_CLASSES = (_MockArrayRemove,)


def _apply_array_sentinels(base: dict, patch: dict) -> dict:
    """Apply a partial-update dict to `base`, honouring ArrayUnion /
    ArrayRemove markers. Used by the mock to mimic Firestore atomic-array
    semantics (the real client applies them server-side)."""
    out = dict(base) if base else {}
    for k, v in (patch or {}).items():
        if isinstance(v, _UNION_CLASSES):
            cur = list(out.get(k) or [])
            for item in v.values:
                if item not in cur:
                    cur.append(item)
            out[k] = cur
        elif isinstance(v, _REMOVE_CLASSES):
            cur = list(out.get(k) or [])
            out[k] = [x for x in cur if x not in v.values]
        else:
            out[k] = v
    return out


class MockDocRef:
    def __init__(self, collection, doc_id: str):
        self._collection = collection
        self.id = doc_id

    async def get(self) -> MockDocSnapshot:
        if self._collection is None:
            return MockDocSnapshot(self.id, None)
        data = self._collection._store.get(self.id)
        return MockDocSnapshot(self.id, data)

    async def set(self, data: dict, merge: bool = False) -> None:
        # `merge=True` mirrors Firestore semantics and also applies
        # ArrayUnion / ArrayRemove atomically against the current doc.
        if self._collection is None:
            return
        if merge:
            existing = self._collection._store.get(self.id, {})
            self._collection._store[self.id] = _apply_array_sentinels(existing, data)
        else:
            # Even without merge, sentinels must apply against an empty doc
            # so a brand-new document seeded with ArrayUnion works.
            self._collection._store[self.id] = _apply_array_sentinels({}, data)

    async def update(self, data: dict) -> None:
        if self._collection is None:
            return
        if self.id not in self._collection._store:
            return
        existing = self._collection._store[self.id]
        self._collection._store[self.id] = _apply_array_sentinels(existing, data)

    async def delete(self) -> None:
        if self._collection is not None:
            self._collection._store.pop(self.id, None)


class MockQuery:
    def __init__(self, collection, filters=None, order_field=None, order_dir="ASCENDING", limit_n=None):
        self._collection = collection
        self._filters = filters or []
        self._order_field = order_field
        self._order_dir = order_dir
        self._limit_n = limit_n

    def where(self, field, op, value) -> "MockQuery":
        new_filters = self._filters + [(field, op, value)]
        return MockQuery(self._collection, new_filters, self._order_field, self._order_dir, self._limit_n)

    def order_by(self, field, direction="ASCENDING") -> "MockQuery":
        return MockQuery(self._collection, self._filters, field, direction, self._limit_n)

    def limit(self, n: int) -> "MockQuery":
        return MockQuery(self._collection, self._filters, self._order_field, self._order_dir, n)

    def count(self) -> "MockAggQuery":
        return MockAggQuery(self)

    def _apply(self) -> List[tuple]:
        items = list(self._collection._store.items())

        for (field, op, value) in self._filters:
            filtered = []
            for doc_id, doc in items:
                doc_val = doc.get(field)
                if op == "==" and doc_val == value:
                    filtered.append((doc_id, doc))
                elif op == ">=" and doc_val is not None and str(doc_val) >= str(value):
                    filtered.append((doc_id, doc))
                elif op == "<=" and doc_val is not None and str(doc_val) <= str(value):
                    filtered.append((doc_id, doc))
                elif op == ">" and doc_val is not None and str(doc_val) > str(value):
                    filtered.append((doc_id, doc))
                elif op == "array_contains" and isinstance(doc_val, list) and value in doc_val:
                    filtered.append((doc_id, doc))
                elif op == "array_contains_any" and isinstance(doc_val, list) and any(v in doc_val for v in value):
                    filtered.append((doc_id, doc))
                elif op == "in" and doc_val in value:
                    filtered.append((doc_id, doc))
            items = filtered

        if self._order_field:
            reverse = self._order_dir == "DESCENDING"
            def sort_key(item):
                val = item[1].get(self._order_field)
                if val is None:
                    return ""
                if hasattr(val, "isoformat"):
                    return val.isoformat()
                return str(val)
            items = sorted(items, key=sort_key, reverse=reverse)

        if self._limit_n is not None:
            items = items[:self._limit_n]

        return items

    async def get(self) -> List[MockDocSnapshot]:
        return [MockDocSnapshot(doc_id, doc) for doc_id, doc in self._apply()]

    async def stream(self):
        for doc_id, doc in self._apply():
            yield MockDocSnapshot(doc_id, doc)


class MockAggQuery:
    def __init__(self, query: MockQuery):
        self._query = query

    async def get(self):
        items = self._query._apply()
        return [[type('obj', (object,), {'value': len(items)})()]]


class MockCollectionRef:
    def __init__(self, store: dict):
        self._store = store

    async def add(self, data: dict):
        doc_id = str(uuid.uuid4())
        self._store[doc_id] = dict(data)
        doc_ref = MockDocRef(self, doc_id)
        doc_ref._collection = self
        return (datetime.datetime.now(datetime.timezone.utc), doc_ref)

    def document(self, doc_id: str) -> MockDocRef:
        ref = MockDocRef(self, doc_id)
        return ref

    def where(self, field, op, value) -> MockQuery:
        return MockQuery(self, [(field, op, value)])

    def order_by(self, field, direction="ASCENDING") -> MockQuery:
        return MockQuery(self, [], field, direction)

    def limit(self, n: int) -> MockQuery:
        return MockQuery(self, [], None, "ASCENDING", n)

    def count(self) -> MockAggQuery:
        return MockAggQuery(MockQuery(self))

    async def get(self) -> List[MockDocSnapshot]:
        return [MockDocSnapshot(doc_id, doc) for doc_id, doc in self._store.items()]

    async def stream(self):
        for doc_id, doc in self._store.items():
            yield MockDocSnapshot(doc_id, doc)


class MockFirestoreClient:
    """In-memory Firestore mock for when real credentials are unavailable."""
    _collections: Dict[str, dict] = {}

    def collection(self, name: str) -> MockCollectionRef:
        if name not in self._collections:
            self._collections[name] = {}
        return MockCollectionRef(self._collections[name])


# ─── DB Provider ─────────────────────────────────────────────────────────────

_db_instance = None
_using_mock = False

def _get_firestore_client():
    """Get a Firestore client with persistence-first behaviour.

    Strategy:
      1. If GOOGLE_APPLICATION_CREDENTIALS points at a real service-account
         JSON file → use it (best for local dev with explicit creds).
      2. Otherwise, attempt Application Default Credentials (ADC). On Google
         Cloud Run / GCE / GKE this just works via the metadata server and
         requires NO secret to be uploaded to Replit. The runtime service
         account simply needs the `roles/datastore.user` IAM grant on the
         target project. This is the path that real users of the deployed
         site rely on for persistent storage.
      3. Only if both fail do we fall back to the in-memory mock — clearly
         logged so it's obvious in production that data won't persist.

    Env / config used:
      - GCP_PROJECT_ID (or FIREBASE_PROJECT_ID)
      - FIREBASE_DATABASE_ID (defaults to "(default)")
      - GOOGLE_APPLICATION_CREDENTIALS (optional, only for explicit creds)
    """
    global _db_instance, _using_mock

    if _db_instance is not None:
        return _db_instance

    # Explicit credentials file wins if present and readable.
    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    if creds_path and not os.path.exists(creds_path):
        # Stale env var pointing at a missing file would crash auth lookup —
        # remove it so ADC discovery can proceed cleanly.
        print(f"db: GOOGLE_APPLICATION_CREDENTIALS={creds_path!r} missing; "
              f"falling back to ADC.")
        os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
        creds_path = ""

    # If we have NO creds file, we'd rely on ADC. ADC on Replit dev will try
    # to reach the GCE metadata server (`metadata.google.internal`) and hang
    # for many seconds before failing — that hangs startup. So we do a fast
    # DNS pre-flight: if the metadata server isn't reachable AND we have no
    # explicit creds, use the mock immediately. On real Cloud Run / GCE the
    # DNS resolves, ADC works, and we proceed normally.
    if not creds_path:
        try:
            import socket
            socket.setdefaulttimeout(0.4)
            try:
                socket.gethostbyname("metadata.google.internal")
                metadata_reachable = True
            except Exception:
                metadata_reachable = False
            finally:
                socket.setdefaulttimeout(None)
        except Exception:
            metadata_reachable = False
        if not metadata_reachable:
            print("db: No creds file and GCE metadata server unreachable "
                  "(local dev). Using in-memory mock — DATA WILL NOT PERSIST. "
                  "On Cloud Run, ADC will succeed automatically.")
            _db_instance = MockFirestoreClient()
            _using_mock = True
            return _db_instance

    # Attempt real Firestore. On Cloud Run, ADC just works via the metadata
    # server. With an explicit GOOGLE_APPLICATION_CREDENTIALS file, that
    # service-account JSON is used.
    try:
        from google.cloud import firestore as gfs
        project_id = (
            settings.GCP_PROJECT_ID
            or os.environ.get("GCP_PROJECT_ID")
            or os.environ.get("FIREBASE_PROJECT_ID")
        )
        if not project_id:
            raise RuntimeError("No GCP_PROJECT_ID configured for Firestore.")
        database_id = settings.FIREBASE_DATABASE_ID or "(default)"
        client = gfs.AsyncClient(project=project_id, database=database_id)
        _db_instance = client
        _using_mock = False
        cred_mode = "service-account-file" if creds_path else "ADC"
        print(f"db: Connected to Firestore via {cred_mode} "
              f"(project={project_id}, database={database_id}).")
        return _db_instance
    except Exception as e:
        print(f"db: Firestore connection failed: {e}")
        print("db: Falling back to in-memory mock — DATA WILL NOT PERSIST. "
              "Grant roles/datastore.user to the runtime service account "
              "to enable persistence.")
        _db_instance = MockFirestoreClient()
        _using_mock = True
        return _db_instance


def is_using_mock_db() -> bool:
    """True if we couldn't connect to real Firestore. Surfaced via /api/health
    and a startup log so deploy issues are obvious."""
    _get_firestore_client()  # ensure init
    return _using_mock


async def get_db():
    return _get_firestore_client()


async def log_interaction(session_id: str, user_message: str, reply: str, agents_called: List[str]):
    from app.user_context import get_uid
    db = await get_db()
    try:
        log_data = {
            "session_id": session_id,
            "user_message": user_message,
            "reply": reply,
            "agents_called": agents_called,
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "user_id": get_uid(),
        }
        await db.collection("interaction_logs").add(log_data)
    except Exception as e:
        print(f"Error logging interaction: {e}")


async def get_collection_count(collection_name: str, user_id: Optional[str] = None) -> int:
    """Count docs in a collection. If user_id provided (or we can resolve one
    from the request context), only count docs owned by that user."""
    db = await get_db()
    if user_id is None:
        try:
            from app.user_context import get_uid
            user_id = get_uid()
        except Exception:
            user_id = None
    try:
        if isinstance(db, MockFirestoreClient):
            store = db.collection(collection_name)._store
            if user_id is None:
                return len(store)
            count = 0
            for doc in store.values():
                owner = doc.get("user_id") or doc.get("userId") or "guest"
                if owner == user_id:
                    count += 1
            return count
        # Real Firestore: scoped count via where()
        if user_id is not None:
            try:
                cq = db.collection(collection_name).where("user_id", "==", user_id).count()
                result = await cq.get()
                return result[0][0].value
            except Exception:
                pass
        count_query = db.collection(collection_name).count()
        result = await count_query.get()
        return result[0][0].value
    except Exception as e:
        print(f"Error getting collection count for {collection_name}: {e}")
        return 0
