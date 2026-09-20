// Content script — IBIG Immo Trust
// Le scan automatique est géré par background.js via chrome.scripting.executeScript
// Ce fichier expose uniquement les fonctions de capture manuelle

// ─── Capture manuelle du texte ────────────────────────────────────────────────
window.__ibigCapture = () => {
  // 1. Texte sélectionné
  const sel = window.getSelection()?.toString().trim();
  if (sel && sel.length > 30) return (window.__ibigCapturedText = sel);

  // 2. Étendre "Voir plus" dans l'article visible
  const article = document.querySelector('div[role="dialog"] div[role="article"]')
    || document.querySelector('div[role="article"]');

  if (article) {
    article.querySelectorAll('div[role="button"], span[role="button"]').forEach(btn => {
      const t = (btn.innerText||'').trim().toLowerCase();
      if (['voir plus','see more','lire la suite'].includes(t)) { try { btn.click(); } catch(_){} }
    });

    // Chercher le texte dans les div[dir="auto"] qui ne sont pas dans des liens
    let best = '';
    article.querySelectorAll('div[dir="auto"], span[dir="auto"]').forEach(node => {
      if (node.closest('a[href]') || node.closest('button') || node.closest('[role="button"]')) return;
      const t = (node.innerText||'').trim();
      if (t.length > best.length) best = t;
    });
    if (best.length > 30) return (window.__ibigCapturedText = best);
  }

  // 3. WhatsApp
  const waMsg = document.querySelector('div.copyable-text span.selectable-text');
  if (waMsg?.innerText?.trim().length > 30) return (window.__ibigCapturedText = waMsg.innerText.trim());

  return null;
};

// ─── Capture du lien ─────────────────────────────────────────────────────────
window.__ibigCaptureLink = () => {
  if (window.location.hostname.includes('facebook.com')) {
    if (/\/(posts|permalink|reel|story\.php|groups\/.+\/permalink)/.test(window.location.href)) return window.location.href;
    for (const sel of ['a[href*="/posts/"]','a[href*="/permalink/"]','a[href*="story_fbid"]','a[href*="/reel/"]']) {
      const a = document.querySelector(sel);
      if (a?.href?.includes('facebook.com')) return a.href.split('?')[0];
    }
    return window.location.href;
  }
  if (window.location.hostname.includes('whatsapp.com')) return null;
  return window.location.href;
};

// ─── Capture des images ───────────────────────────────────────────────────────
window.__ibigCaptureImages = async () => {
  const imgs = [];
  const container = document.querySelector('div[role="dialog"]')
    || document.querySelector('div[role="article"]')
    || document.body;

  for (const img of container.querySelectorAll('img[src]')) {
    const src = img.src;
    if (!src || /emoji|avatar|sticker|rsrc\.php|1x1/i.test(src)) continue;
    if ((img.naturalWidth||0) < 100 || (img.naturalHeight||0) < 100) continue;
    if (imgs.length >= 6) break;
    try {
      const r = await fetch(src, { credentials: 'include' });
      const blob = await r.blob();
      if (!blob.type.startsWith('image/') || blob.size < 3000) continue;
      const b64 = await new Promise(res => {
        const rd = new FileReader(); rd.onload = () => res(rd.result); rd.readAsDataURL(blob);
      });
      imgs.push({ src, b64, type: blob.type });
    } catch (_) {
      imgs.push({ src, b64: null, type: 'image/jpeg' });
    }
  }
  return imgs;
};

// ─── Mémoriser la sélection ───────────────────────────────────────────────────
if (window.location.hostname.includes('facebook.com')) {
  document.addEventListener('mouseup', () => {
    const s = window.getSelection()?.toString().trim();
    if (s && s.length > 30) window.__ibigCapturedText = s;
  });
}

// ─── Refetch depuis le dashboard ibigimmotrust.com ────────────────────────────
// Le dashboard envoie postMessage({type:'IBIG_REFETCH', id, url}) et écoute la réponse
if (window.location.hostname.includes('ibigimmotrust.com') ||
    window.location.hostname.includes('localhost')) {
  window.addEventListener('message', evt => {
    if (!evt.data || evt.data.type !== 'IBIG_REFETCH') return;
    const { id, url } = evt.data;
    if (!id || !url) return;
    chrome.runtime.sendMessage({ type: 'IBIG_REFETCH_ANNONCE', id, url });
  });

  // Recevoir le résultat du background et le retransmettre à la page
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'IBIG_REFETCH_RESULT') {
      window.postMessage({ type: 'IBIG_REFETCH_RESULT', id: msg.id, ok: msg.ok, error: msg.error }, '*');
    }
  });
}
