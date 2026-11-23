import { rescheduleDate } from './calendar.js';

function installRescheduleControls() {
  const list = document.getElementById('upcoming-events');
  if (!list) return;

  const addControls = () => {
    list.querySelectorAll('.event-note').forEach(note => {
      if (note.dataset.rescheduleReady) return;
      note.dataset.rescheduleReady = 'true';
      const title = note.querySelector('.event-meta strong')?.textContent || 'Calendar item';
      const isRecurring = note.dataset.recurring === 'true';
      const item = note.dataset.itemType === 'task'
        ? window.famguardTasks?.find(value => value.id === note.dataset.itemId)
        : window.famguardCalendarEvents?.find(value => value.id === note.dataset.itemId);
      if (!item || isRecurring) return;

      const actions = note.querySelector('.calendar-event-actions');
      if (!actions) return;
      const controls = document.createElement('span');
      controls.className = 'reschedule-controls';
      controls.setAttribute('aria-label', `Reschedule ${title}`);
      [['week', 'Next week'], ['month', 'Next month']].forEach(([unit, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-secondary';
        button.textContent = label;
        button.addEventListener('click', () => {
          try {
            const current = note.dataset.itemType === 'task' ? item.scheduledFor : item.date;
            const nextDate = rescheduleDate(current, 1, unit);
            if (note.dataset.itemType === 'task') {
              item.scheduledFor = nextDate;
              window.famguardRenderTasks();
            } else {
              item.date = nextDate;
              window.famguardSetCalendarEvents(window.famguardCalendarEvents);
            }
            window.toast(`${title} moved to ${formatDate(nextDate)}.`);
          } catch (error) {
            window.toast(`Could not reschedule this item: ${error instanceof Error ? error.message : String(error)}`);
          }
        });
        controls.append(button);
      });
      actions.prepend(controls);
    });
  };

  new MutationObserver(addControls).observe(list, { childList: true, subtree: true });
  addControls();
}

function formatDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

installRescheduleControls();
