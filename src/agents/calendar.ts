import { db } from "../lib/firebase";
import { collection, addDoc } from "firebase/firestore";
import { Schedule } from "../types";

export const calendarAgent = {
  scheduleEvent: async (event: Partial<Schedule>) => {
    try {
      // Mocking GCal Integration for demo
      const gcalId = `gcal_${Math.random().toString(36).substr(2, 9)}`;
      
      const docRef = await addDoc(collection(db, "schedules"), {
        ...event,
        gcal_event_id: gcalId,
        created_at: new Date().toISOString()
      });
      
      return { id: docRef.id, gcal_event_id: gcalId, ...event };
    } catch (error) {
      console.error("CalendarAgent Error:", error);
      throw error;
    }
  }
};
