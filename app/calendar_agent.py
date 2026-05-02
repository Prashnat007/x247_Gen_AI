import os
import asyncio
import datetime
import uuid
from typing import List, Dict, Any, Optional
from google.oauth2 import service_account
from googleapiclient.discovery import build
from app.db import get_db
from app.config import settings

# Timezone configuration
TIMEZONE = "Asia/Kolkata"

class CalendarAgent:
    def __init__(self):
        self.calendar_id = settings.GOOGLE_CALENDAR_ID
        self.service = self._get_service()
        self.is_real = self.service is not None

    def _get_service(self):
        """
        Initializes the Google Calendar service if credentials and ID are available.
        """
        if not self.calendar_id:
            return None
            
        creds_path = settings.GOOGLE_SA_KEY_PATH or settings.GOOGLE_APPLICATION_CREDENTIALS
        if not creds_path or not os.path.exists(creds_path):
            return None
            
        try:
            scopes = ["https://www.googleapis.com/auth/calendar"]
            creds = service_account.Credentials.from_service_account_file(creds_path, scopes=scopes)
            return build("calendar", "v3", credentials=creds)
        except Exception as e:
            print(f"Calendar Service Initialization Error: {e}")
            return None

    async def create_event(self, title: str, date: str, time: str, duration_minutes: int = 60, 
                           description: str = "", linked_task_id: str = "",
                           topic: str = "Other", linked_memory_id: str = "",
                           source: str = "manual") -> dict:
        """
        Creates a calendar event. Uses Google Calendar if configured, otherwise Firestore.
        """
        # Prepare start and end times
        # date: YYYY-MM-DD, time: HH:MM
        start_dt_str = f"{date}T{time}:00"
        start_dt = datetime.datetime.fromisoformat(start_dt_str)
        end_dt = start_dt + datetime.timedelta(minutes=duration_minutes)
        
        from app.user_context import get_uid
        event_data = {
            "title": title,
            "date": date,
            "time": time,
            "duration_minutes": duration_minutes,
            "description": description,
            "linked_task_id": linked_task_id,
            "linked_memory_id": linked_memory_id,
            "topic": topic or "Other",
            "source": source or "manual",
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "user_id": get_uid(),
        }

        if self.is_real:
            loop = asyncio.get_event_loop()
            gcal_body = {
                "summary": title,
                "description": f"{description}\nLinked Task: {linked_task_id}" if linked_task_id else description,
                "start": {
                    "dateTime": start_dt.isoformat(),
                    "timeZone": TIMEZONE,
                },
                "end": {
                    "dateTime": end_dt.isoformat(),
                    "timeZone": TIMEZONE,
                },
            }
            
            def _insert():
                return self.service.events().insert(calendarId=self.calendar_id, body=gcal_body).execute()
            
            try:
                gcal_event = await loop.run_in_executor(None, _insert)
                event_data["id"] = gcal_event.get("id")
                event_data["gcal_event_id"] = gcal_event.get("id")
            except Exception as e:
                print(f"GCal Insert Error: {e}")
                # Fallback to mock behavior if API fails
                event_data["id"] = str(uuid.uuid4())
                event_data["gcal_event_id"] = "error_fallback"
        else:
            # Mock Mode: Save to Firestore
            db = await get_db()
            event_id = str(uuid.uuid4())
            event_data["id"] = event_id
            event_data["gcal_event_id"] = "mock_calendar_id"
            await db.collection("schedules").document(event_id).set(event_data)
            
        return event_data

    async def list_upcoming_events(self, days: int = 7) -> List[dict]:
        """
        Lists upcoming events for the next N days.
        """
        now = datetime.datetime.now(datetime.timezone.utc)
        time_min = now.isoformat()
        time_max = (now + datetime.timedelta(days=days)).isoformat()
        
        if self.is_real:
            loop = asyncio.get_event_loop()
            def _list():
                return self.service.events().list(
                    calendarId=self.calendar_id,
                    timeMin=time_min,
                    timeMax=time_max,
                    maxResults=10,
                    singleEvents=True,
                    orderBy="startTime"
                ).execute()
            
            try:
                result = await loop.run_in_executor(None, _list)
                events = []
                for item in result.get("items", []):
                    start = item["start"].get("dateTime", item["start"].get("date"))
                    # Parse start to get date and time
                    dt = datetime.datetime.fromisoformat(start.replace("Z", "+00:00"))
                    events.append({
                        "id": item["id"],
                        "title": item.get("summary"),
                        "date": dt.date().isoformat(),
                        "time": dt.time().strftime("%H:%M"),
                        "gcal_event_id": item["id"]
                    })
                return events
            except Exception as e:
                print(f"GCal List Error: {e}")
                return []
        else:
            # Mock Mode: Query Firestore
            from app.user_context import belongs_to_current_user
            db = await get_db()
            today_str = datetime.date.today().isoformat()
            query = db.collection("schedules") \
                      .where("date", ">=", today_str) \
                      .order_by("date") \
                      .limit(40)
            
            docs = query.stream()
            events = []
            async for doc in docs:
                data = doc.to_dict()
                if not belongs_to_current_user(data):
                    continue
                events.append(data)
                if len(events) >= 10:
                    break
            return events

    async def delete_event(self, event_id: str) -> str:
        """
        Deletes an event by ID.
        """
        if self.is_real:
            loop = asyncio.get_event_loop()
            def _delete():
                self.service.events().delete(calendarId=self.calendar_id, eventId=event_id).execute()
            
            try:
                await loop.run_in_executor(None, _delete)
                return f"Event {event_id} deleted"
            except Exception as e:
                return f"Error deleting GCal event: {e}"
        else:
            from app.user_context import belongs_to_current_user
            db = await get_db()
            doc_ref = db.collection("schedules").document(event_id)
            doc = await doc_ref.get()
            if not doc.exists or not belongs_to_current_user(doc.to_dict()):
                return f"Error: Event {event_id} not found."
            await doc_ref.delete()
            return f"Event {event_id} deleted"

    async def get_todays_schedule(self) -> List[dict]:
        """
        Returns events scheduled for today.
        """
        today_str = datetime.date.today().isoformat()
        
        if self.is_real:
            loop = asyncio.get_event_loop()
            time_min = f"{today_str}T00:00:00Z"
            time_max = f"{today_str}T23:59:59Z"
            
            def _list_today():
                return self.service.events().list(
                    calendarId=self.calendar_id,
                    timeMin=time_min,
                    timeMax=time_max,
                    singleEvents=True,
                    orderBy="startTime"
                ).execute()
                
            try:
                result = await loop.run_in_executor(None, _list_today)
                events = []
                for item in result.get("items", []):
                    start = item["start"].get("dateTime", item["start"].get("date"))
                    dt = datetime.datetime.fromisoformat(start.replace("Z", "+00:00"))
                    events.append({
                        "id": item["id"],
                        "title": item.get("summary"),
                        "date": dt.date().isoformat(),
                        "time": dt.time().strftime("%H:%M"),
                        "gcal_event_id": item["id"]
                    })
                return events
            except Exception as e:
                print(f"GCal Today List Error: {e}")
                return []
        else:
            from app.user_context import belongs_to_current_user
            db = await get_db()
            query = db.collection("schedules").where("date", "==", today_str)
            docs = query.stream()
            events = []
            async for doc in docs:
                data = doc.to_dict()
                if not belongs_to_current_user(data):
                    continue
                events.append(data)
            return events

# Singleton instance
calendar_agent = CalendarAgent()

# Exportable functions for MCP
async def create_event(title, date, time, duration_minutes=60, description="", linked_task_id="",
                       topic="Other", linked_memory_id="", source="manual"):
    return await calendar_agent.create_event(
        title, date, time, duration_minutes, description, linked_task_id,
        topic=topic, linked_memory_id=linked_memory_id, source=source,
    )

async def list_upcoming_events(days=7):
    return await calendar_agent.list_upcoming_events(days)

async def delete_event(event_id):
    return await calendar_agent.delete_event(event_id)

async def get_todays_schedule():
    return await calendar_agent.get_todays_schedule()


async def get_event(event_id: str) -> Optional[dict]:
    """Fetch a single stored event by id (mock/Firestore mode), scoped to current user."""
    from app.user_context import belongs_to_current_user
    if calendar_agent.is_real:
        return None
    db = await get_db()
    doc = await db.collection("schedules").document(event_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    if not belongs_to_current_user(data):
        return None
    data.setdefault("id", event_id)
    return data


def parse_ics_text(ics_text: str) -> List[Dict[str, Any]]:
    """
    Lightweight RFC 5545 VEVENT parser sufficient for typical exports
    from Google / Apple / Outlook. Returns a list of normalized event dicts:
        {title, date, time, duration_minutes, description}
    Unsupported pieces (RRULE, attachments, attendees) are ignored.
    """
    # Unfold long lines: a CRLF/LF followed by a space or tab continues the previous line.
    text = ics_text.replace("\r\n", "\n").replace("\r", "\n")
    unfolded_lines: List[str] = []
    for line in text.split("\n"):
        if line.startswith(" ") or line.startswith("\t"):
            if unfolded_lines:
                unfolded_lines[-1] += line[1:]
        else:
            unfolded_lines.append(line)

    events: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None

    def _unescape(value: str) -> str:
        return (value.replace("\\n", "\n").replace("\\N", "\n")
                     .replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\"))

    def _parse_dt(raw: str) -> Optional[datetime.datetime]:
        # raw can be 20260512T093000Z, 20260512T093000, or 20260512 (date only)
        raw = raw.strip()
        try:
            if raw.endswith("Z"):
                return datetime.datetime.strptime(raw, "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)
            if "T" in raw:
                return datetime.datetime.strptime(raw, "%Y%m%dT%H%M%S")
            return datetime.datetime.strptime(raw, "%Y%m%d")
        except Exception:
            try:
                # ISO fallback
                return datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except Exception:
                return None

    for line in unfolded_lines:
        if line == "BEGIN:VEVENT":
            current = {}
        elif line == "END:VEVENT":
            if current is not None:
                events.append(current)
                current = None
        elif current is not None and ":" in line:
            key_full, _, value = line.partition(":")
            key = key_full.split(";", 1)[0].upper()
            if key == "SUMMARY":
                current["title"] = _unescape(value).strip()
            elif key == "DESCRIPTION":
                current["description"] = _unescape(value).strip()
            elif key == "LOCATION":
                current.setdefault("description", "")
                if value:
                    loc = _unescape(value).strip()
                    current["description"] = (current["description"] + ("\n" if current["description"] else "") + f"Location: {loc}").strip()
            elif key == "DTSTART":
                dt = _parse_dt(value)
                if dt is not None:
                    current["_start"] = dt
            elif key == "DTEND":
                dt = _parse_dt(value)
                if dt is not None:
                    current["_end"] = dt
            elif key == "UID":
                current["_uid"] = value.strip()

    normalized: List[Dict[str, Any]] = []
    for ev in events:
        start: Optional[datetime.datetime] = ev.get("_start")
        if not start:
            continue
        end: Optional[datetime.datetime] = ev.get("_end")
        duration = 60
        if end:
            try:
                duration = max(15, int((end - start).total_seconds() // 60))
            except Exception:
                duration = 60
        normalized.append({
            "title": ev.get("title") or "Imported event",
            "date": start.date().isoformat(),
            "time": start.strftime("%H:%M"),
            "duration_minutes": duration,
            "description": ev.get("description") or "",
        })
    return normalized


async def import_ics_events(ics_text: str, topic: str = "Other") -> Dict[str, Any]:
    """Parse an ICS payload and create local events for every VEVENT it contains."""
    parsed = parse_ics_text(ics_text)
    created: List[dict] = []
    failed = 0
    for ev in parsed:
        try:
            new_ev = await calendar_agent.create_event(
                title=ev["title"],
                date=ev["date"],
                time=ev["time"],
                duration_minutes=ev["duration_minutes"],
                description=ev.get("description", ""),
                linked_task_id="",
                topic=topic or "Other",
                source="ics_import",
            )
            created.append(new_ev)
        except Exception as e:
            print(f"ICS import error for '{ev.get('title')}': {e}")
            failed += 1
    return {
        "imported": len(created),
        "failed": failed,
        "total_parsed": len(parsed),
        "events": created[:50],
    }
