(() => {
  const token = new URLSearchParams(location.search).get('token');
  const headers = { 'Content-Type': 'application/json', 'X-Touch-Grass-Token': token || '' };
  let snapshot;
  let dirty = false;

  const elements = {
    enabled: document.querySelector('#enabled'),
    statusDot: document.querySelector('#status-dot'),
    statusLabel: document.querySelector('#status-label'),
    remaining: document.querySelector('#remaining'),
    interval: document.querySelector('#interval'),
    idleReset: document.querySelector('#idle-reset'),
    duration: document.querySelector('#duration'),
    order: document.querySelector('#order'),
    quietEnabled: document.querySelector('#quiet-enabled'),
    quietStart: document.querySelector('#quiet-start'),
    quietEnd: document.querySelector('#quiet-end'),
    grid: document.querySelector('#reminder-grid'),
    companions: document.querySelector('#companion-list'),
    dataDir: document.querySelector('#data-dir'),
    save: document.querySelector('#save'),
    saveBar: document.querySelector('#save-bar'),
    saveStatus: document.querySelector('#save-status')
  };

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Request failed.');
    return body;
  }

  function toast(message) {
    const node = document.createElement('div');
    node.className = 'toast';
    node.textContent = message;
    document.body.append(node);
    setTimeout(() => node.remove(), 2600);
  }

  function markDirty() {
    dirty = true;
    elements.save.disabled = false;
    elements.saveStatus.textContent = 'You have unsaved changes.';
    elements.saveBar.classList.add('is-dirty');
    setTimeout(() => elements.saveBar.classList.remove('is-dirty'), 320);
  }

  function setStatus(status) {
    elements.remaining.textContent = status.enabled ? String(status.remainingMinutes) : '—';
    elements.statusLabel.textContent = status.enabled ? 'Reminders on' : 'Reminders off';
    elements.statusDot.classList.toggle('is-on', status.enabled);
  }

  function renderReminders() {
    elements.grid.replaceChildren();
    const disabled = new Set(snapshot.config.disabledPresetIds);
    for (const reminder of snapshot.presets) {
      const card = document.querySelector('#reminder-template').content.firstElementChild.cloneNode(true);
      const checkbox = card.querySelector('input');
      const enabled = !disabled.has(reminder.id);
      card.dataset.id = reminder.id;
      card.classList.toggle('is-off', !enabled);
      card.querySelector('img').src = `/assets/actions/${encodeURIComponent(reminder.icon)}`;
      card.querySelector('img').alt = '';
      card.querySelector('b').textContent = reminder.title;
      card.querySelector('p').textContent = reminder.message;
      checkbox.checked = enabled;
      checkbox.nextElementSibling.nextElementSibling.textContent = `Enable ${reminder.title}`;
      checkbox.addEventListener('change', () => {
        card.classList.toggle('is-off', !checkbox.checked);
        markDirty();
      });
      elements.grid.append(card);
    }
  }

  function renderCompanions() {
    elements.companions.replaceChildren();
    if (!snapshot.config.companions.length) {
      const empty = document.createElement('p');
      empty.className = 'companion-pill';
      empty.textContent = 'No cat packs imported yet — action icons are active.';
      elements.companions.append(empty);
      return;
    }
    for (const companion of snapshot.config.companions) {
      const item = document.createElement('p');
      item.className = 'companion-pill';
      item.textContent = `${companion.name} · ${Object.keys(companion.assets).length} actions`;
      elements.companions.append(item);
    }
  }

  function hydrate() {
    const { config, status } = snapshot;
    elements.enabled.checked = config.enabled;
    elements.interval.value = config.intervalMinutes;
    elements.idleReset.value = config.idleResetMinutes;
    elements.duration.value = config.reminderDurationSeconds;
    elements.order.value = config.order;
    elements.quietEnabled.checked = config.quietHours.enabled;
    elements.quietStart.value = config.quietHours.start;
    elements.quietEnd.value = config.quietHours.end;
    elements.dataDir.textContent = snapshot.dataDir;
    setStatus(status);
    renderReminders();
    renderCompanions();
  }

  function collectConfig() {
    const disabledPresetIds = [...elements.grid.querySelectorAll('.reminder-card')]
      .filter((card) => !card.querySelector('input').checked)
      .map((card) => card.dataset.id);
    return {
      ...snapshot.config,
      enabled: elements.enabled.checked,
      intervalMinutes: Number(elements.interval.value),
      idleResetMinutes: Number(elements.idleReset.value),
      reminderDurationSeconds: Number(elements.duration.value),
      order: elements.order.value,
      quietHours: {
        enabled: elements.quietEnabled.checked,
        start: elements.quietStart.value,
        end: elements.quietEnd.value
      },
      disabledPresetIds
    };
  }

  async function save() {
    elements.save.disabled = true;
    elements.save.textContent = 'Saving…';
    try {
      const result = await api('/api/config', { method: 'PUT', body: JSON.stringify(collectConfig()) });
      snapshot.config = result.config;
      snapshot.status.enabled = result.config.enabled;
      dirty = false;
      elements.saveStatus.textContent = 'Settings saved locally.';
      setStatus(snapshot.status);
      toast('Saved');
    } catch (error) {
      elements.save.disabled = false;
      elements.saveStatus.textContent = error.message;
    } finally {
      elements.save.textContent = 'Save changes';
    }
  }

  document.querySelectorAll('input, select').forEach((input) => input.addEventListener('change', markDirty));
  elements.save.addEventListener('click', save);
  document.querySelector('#test-nap').addEventListener('click', async () => {
    try { await api('/api/action', { method: 'POST', body: JSON.stringify({ action: 'test', reminderId: 'nap' }) }); toast('Nap reminder opened'); }
    catch (error) { toast(error.message); }
  });
  document.querySelector('#snooze').addEventListener('click', async () => {
    try { await api('/api/action', { method: 'POST', body: JSON.stringify({ action: 'snooze', minutes: 15 }) }); toast('Snoozed for 15 minutes'); }
    catch (error) { toast(error.message); }
  });
  document.querySelector('#reset-activity').addEventListener('click', async () => {
    try { await api('/api/action', { method: 'POST', body: JSON.stringify({ action: 'reset-activity' }) }); elements.remaining.textContent = elements.interval.value; toast('Timer reset'); }
    catch (error) { toast(error.message); }
  });
  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  api('/api/snapshot')
    .then((data) => { snapshot = data; hydrate(); })
    .catch((error) => { elements.statusLabel.textContent = error.message; elements.saveStatus.textContent = 'Could not load local settings.'; });
})();
