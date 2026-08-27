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
  const banner = document.querySelector('#banner');
  const pet = document.querySelector('#pet');
  const petPair = document.querySelector('#pet-pair');
  const icon = document.querySelector('#icon');
  const iconText = document.querySelector('#icon-text');
  const placeholder = document.querySelector('#placeholder');
  const close = document.querySelector('#close');
  const progress = document.querySelector('#progress');

  title.textContent = payload.title;
  message.textContent = payload.message;
  document.title = `Touch Grass — ${payload.title}`;

  function showFallback() {
    pet.hidden = true;
    petPair.hidden = true;
    if (payload.iconUrl) {
      icon.src = payload.iconUrl;
      icon.alt = `${payload.id} reminder icon`;
      placeholder.hidden = false;
    } else {
      iconText.textContent = payload.iconText || '•';
      iconText.hidden = false;
    }
  }

  // Two portraits means the pair layout, whether this is the welcome banner or a
  // reminder with no animation of its own.
  if (Array.isArray(payload.assetUrls) && payload.assetUrls.length >= 2) {
    banner.classList.add('banner--welcome');
    let failed = false;
    for (const [index, assetUrl] of payload.assetUrls.slice(0, 2).entries()) {
      const image = document.createElement('img');
      image.src = assetUrl;
      image.alt = '';
      image.className = `visual__pair-cat visual__pair-cat--${index + 1}`;
      image.addEventListener('error', () => {
        if (failed) return;
        failed = true;
        showFallback();
      });
      petPair.append(image);
    }
    petPair.hidden = false;
  } else if (payload.assetUrl) {
    pet.src = payload.assetUrl;
    pet.alt = payload.companionName
      ? `${payload.companionName} doing the ${payload.id} reminder`
      : `${payload.id} reminder`;
    pet.hidden = false;
    pet.addEventListener('error', showFallback);
  } else showFallback();

  const duration = Math.max(5, Number(payload.durationSeconds) || 18);
  progress.style.setProperty('--duration', `${duration}s`);
  const timer = window.setTimeout(closeReminder, duration * 1000);

  close.addEventListener('click', () => {
    window.clearTimeout(timer);
    closeReminder();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close.click();
  });
})();
