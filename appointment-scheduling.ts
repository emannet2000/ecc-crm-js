import type {TaskRow,TransferResult} from './shared/workflow-model';
import type { Database, Audit, Auth, Services, HttpRequest, HttpResponse, HttpNext } from './types/runtime';
import type { Router } from 'express';
// A booking owns its consultant and time; lead ownership changes must not move it.
function transferOpenTasks(db: Database, leadId: number, fromId: number, toId: number): TransferResult {
    const booked = db.prepare("SELECT t.id FROM tasks t WHERE t.lead_id=? AND t.assignee_id=? AND t.status<>'DONE' AND EXISTS(SELECT 1 FROM bookings b WHERE b.task_id=t.id AND b.status='BOOKED')").all(leadId, fromId);
    if (fromId === toId)
        return { transferred: 0, bookings_preserved: booked.length };
    const tasks = db.prepare<TaskRow>("SELECT t.* FROM tasks t WHERE t.lead_id=? AND t.assignee_id=? AND t.status<>'DONE' AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.task_id=t.id AND b.status='BOOKED') ORDER BY t.id").all(leadId, fromId);
    const conflict = db.prepare(`SELECT t.id FROM tasks t WHERE t.assignee_id=? AND t.status<>'DONE' AND t.category IN ('INTERVIEW','APPOINTMENT') AND t.scheduled_at IS NOT NULL
  AND julianday(t.scheduled_at)<julianday(?) AND julianday(COALESCE((SELECT bs.ends_at FROM bookings b JOIN booking_slots bs ON bs.id=b.slot_id WHERE b.task_id=t.id),datetime(t.scheduled_at,'+30 minutes')))>julianday(?) LIMIT 1`);
    for (const task of tasks) {
        if (['INTERVIEW', 'APPOINTMENT'].includes(task.category) && task.scheduled_at) {
            const end = new Date(Date.parse(task.scheduled_at) + 1800000).toISOString();
            if (conflict.get(toId, end, task.scheduled_at))
                throw Error('TASK_TRANSFER_APPOINTMENT_CONFLICT');
        }
        db.prepare('UPDATE tasks SET assignee_id=? WHERE id=?').run(toId, task.id);
    }
    return { transferred: tasks.length, bookings_preserved: booked.length };
}
function installBookingLifecycle(db: Database) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS booking_task_completion AFTER UPDATE OF status ON tasks
 WHEN OLD.status<>NEW.status BEGIN
  UPDATE bookings SET status=CASE WHEN NEW.status='DONE' THEN 'COMPLETED' ELSE 'BOOKED' END
  WHERE task_id=NEW.id AND status IN ('BOOKED','COMPLETED');
 END;`);
    // Bring bookings saved before completion synchronization into the same state.
    db.prepare("UPDATE bookings SET status='COMPLETED' WHERE status='BOOKED' AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=bookings.task_id AND t.status='DONE')").run();
}
const service = { transferOpenTasks, installBookingLifecycle };
export = service;
