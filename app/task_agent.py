import uuid
import datetime
from typing import List, Dict, Any, Optional
from app.db import get_db
from app.user_context import get_uid, belongs_to_current_user, stamp


async def create_task(title: str, due_date: str = "", priority: str = "medium", linked_memory_id: str = "") -> dict:
    """Creates a new task tagged with the current user_id."""
    db = await get_db()
    task_id = str(uuid.uuid4())
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    task_doc = {
        "id": task_id,
        "title": title,
        "linked_memory_id": linked_memory_id,
        "due_date": due_date,
        "priority": priority,
        "status": "pending",
        "created_at": now,
        "user_id": get_uid(),
    }

    await db.collection("tasks").document(task_id).set(task_doc)
    return task_doc


async def list_tasks(status: str = "pending", limit: int = 10) -> List[dict]:
    """Lists tasks for the current user, filtered by status."""
    db = await get_db()
    query = db.collection("tasks") \
              .where("status", "==", status) \
              .order_by("created_at", direction="DESCENDING") \
              .limit(limit * 4)

    docs = query.stream()
    tasks = []
    async for doc in docs:
        data = doc.to_dict()
        if not belongs_to_current_user(data):
            continue
        tasks.append(data)
        if len(tasks) >= limit:
            break
    return tasks


async def update_task(task_id: str, title: str = "", due_date: str = "", priority: str = "", status: str = "") -> dict:
    db = await get_db()
    doc_ref = db.collection("tasks").document(task_id)
    doc = await doc_ref.get()

    if not doc.exists or not belongs_to_current_user(doc.to_dict()):
        raise ValueError(f"Firestore Error: Task with ID '{task_id}' not found.")

    updates = {}
    if title: updates["title"] = title
    if due_date: updates["due_date"] = due_date
    if priority: updates["priority"] = priority
    if status: updates["status"] = status

    if updates:
        await doc_ref.update(updates)

    updated_doc = await doc_ref.get()
    return updated_doc.to_dict()


async def complete_task(task_id: str) -> dict:
    db = await get_db()
    doc_ref = db.collection("tasks").document(task_id)
    doc = await doc_ref.get()

    if not doc.exists or not belongs_to_current_user(doc.to_dict()):
        raise ValueError(f"Firestore Error: Task with ID '{task_id}' not found.")

    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    updates = {"status": "completed", "completed_at": now}

    await doc_ref.update(updates)
    updated_doc = await doc_ref.get()
    return updated_doc.to_dict()


async def delete_task(task_id: str) -> str:
    db = await get_db()
    doc_ref = db.collection("tasks").document(task_id)
    doc = await doc_ref.get()

    if not doc.exists or not belongs_to_current_user(doc.to_dict()):
        return f"Error: Task {task_id} not found."

    await doc_ref.delete()
    return f"Task {task_id} deleted"


async def get_tasks_summary() -> dict:
    """Returns task stats scoped to the current user."""
    db = await get_db()
    docs = db.collection("tasks").stream()

    total = pending = completed = overdue = 0
    today = datetime.date.today().isoformat()

    async for doc in docs:
        data = doc.to_dict()
        if not belongs_to_current_user(data):
            continue
        total += 1
        status = data.get("status")
        if status == "completed":
            completed += 1
        elif status == "pending":
            pending += 1
            due_date = data.get("due_date")
            if due_date and due_date < today:
                overdue += 1

    return {"total": total, "pending": pending, "completed": completed, "overdue": overdue}
