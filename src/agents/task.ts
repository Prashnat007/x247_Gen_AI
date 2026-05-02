import { db } from "../lib/firebase";
import { collection, addDoc, query, where, getDocs, doc, updateDoc } from "firebase/firestore";
import { Task } from "../types";

export const taskAgent = {
  createTask: async (task: Partial<Task>) => {
    try {
      const docRef = await addDoc(collection(db, "tasks"), {
        ...task,
        status: task.status || "todo",
        priority: task.priority || "medium",
        created_at: new Date().toISOString()
      });
      return { id: docRef.id, ...task };
    } catch (error) {
      console.error("TaskAgent Error:", error);
      throw error;
    }
  },

  listTasks: async (userId: string) => {
    const q = query(collection(db, "tasks"), where("userId", "==", userId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }
};
