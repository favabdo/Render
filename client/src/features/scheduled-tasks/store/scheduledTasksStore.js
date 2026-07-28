import { create } from 'zustand';
import { scheduledTasksApi } from '../services/scheduledTasks.service';

const useScheduledTasksStore = create((set, get) => ({
  tasks: [],
  loaded: false,
  modalOpen: false,
  modalMode: 'card', // 'card' | 'page'

  async loadTasks() {
    try {
      const tasks = await scheduledTasksApi.listAll();
      set({ tasks, loaded: true });
    } catch (err) {
      console.error('[API] loadScheduledTasksPage error:', err);
      throw err;
    }
  },

  openModal: (mode) => set({ modalOpen: true, modalMode: mode }),
  closeModal: () => set({ modalOpen: false }),

  async addTask(contactId, taskText, dueDate, customerName) {
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const optimisticTask = {
      id: tempId,
      contact_id: contactId,
      customer_name: customerName,
      task_text: taskText,
      due_date: dueDate,
      status: 'open',
      created_at: new Date().toISOString(),
      _pending: true,
    };
    // Optimistic: التاسك بتظهر فورًا في اللستة، وبتتستبدل بالنسخة الحقيقية من
    // السيرفر لما الرد يوصل، أو بتتشال لو فشلت الإضافة
    set((state) => ({ tasks: [optimisticTask, ...state.tasks] }));
    try {
      const data = await scheduledTasksApi.add(contactId, taskText, dueDate, customerName);
      set((state) => ({ tasks: state.tasks.map((t) => (t.id === tempId ? data.task : t)) }));
      return data.task;
    } catch (err) {
      set((state) => ({ tasks: state.tasks.filter((t) => t.id !== tempId) }));
      throw err;
    }
  },

  async endTask(taskId, contactId) {
    const previous = get().tasks;
    // Optimistic: التاسك بتتحط "منتهية" فورًا، ولو فشل الطلب بنرجّعها "مفتوحة" تاني
    set((state) => ({
      tasks: state.tasks.map((t) => (String(t.id) === String(taskId) ? { ...t, status: 'ended', _pending: true } : t)),
    }));
    try {
      const data = await scheduledTasksApi.end(contactId, taskId);
      set((state) => ({ tasks: state.tasks.map((t) => (String(t.id) === String(taskId) ? data.task : t)) }));
    } catch (err) {
      set({ tasks: previous });
      throw err;
    }
  },

  openCount: () => get().tasks.filter((t) => t.status === 'open').length,
}));

export default useScheduledTasksStore;
