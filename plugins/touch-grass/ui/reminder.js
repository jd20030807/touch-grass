(() => {
  const fallback = {
    id: 'stretch',
    title: 'Time for a break',
    message: 'Move around for a moment.',
    durationSeconds: 18
  };

  function decodePayload() {
    try {
      const encoded = new URLSearchParams(location.search).get('data');
      if (!encoded) return fallback;
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      return { ...fallback, ...JSON.parse(new TextDecoder().decode(bytes)) };
    } catch {
      return fallback;
    }
  }

  const payload = decodePayload();

  function closeReminder() {
    if (window.webkit?.messageHandlers?.touchGrass) {
      window.webkit.messageHandlers.touchGrass.postMessage('close');
      return;
    }
    window.close();
  }
  const title = document.querySelector('#title');
  const message = document.querySelector('#message');
  const eyebrow = document.querySelector('#eyebrow');
  const pet = document.querySelector('#pet');
  const icon = document.querySelector('#icon');
  const iconText = document.querySelector('#icon-text');
  const placeholder = document.querySelector('#placeholder');
  const countdown = document.querySelector('#countdown');
  const done = document.querySelector('#done');
  const progress = document.querySelector('#progress');

  title.textContent = payload.title;
  message.textContent = payload.message;
  eyebrow.textContent = payload.companionName ? `${payload.companionName} has a suggestion` : 'Your cat has a suggestion';
  document.title = `Touch Grass — ${payload.title}`;

  if (payload.assetUrl) {
    pet.src = payload.assetUrl;
    pet.alt = payload.companionName ? `${payload.companionName} doing the ${payload.id} reminder` : `${payload.id} reminder`;
    pet.hidden = false;
    pet.addEventListener('error', () => {
      pet.hidden = true;
      if (payload.iconUrl) {
        icon.src = payload.iconUrl;
        placeholder.hidden = false;
      }
    });
  } else if (payload.iconUrl) {
    icon.src = payload.iconUrl;
    icon.alt = `${payload.id} reminder icon`;
    placeholder.hidden = false;
  } else {
    iconText.textContent = payload.iconText || '•';
    iconText.hidden = false;
  }

  let remaining = Math.max(5, Number(payload.durationSeconds) || 18);
  const total = remaining;
  countdown.textContent = `${remaining}s`;
  const timer = setInterval(() => {
    remaining -= 1;
    countdown.textContent = `${remaining}s`;
    progress.style.transform = `scaleX(${Math.max(0, remaining / total)})`;
    if (remaining <= 0) {
      clearInterval(timer);
      closeReminder();
    }
  }, 1000);

  done.addEventListener('click', closeReminder);
  done.focus();
})();
