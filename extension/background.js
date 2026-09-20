// ─── Background Service Worker — IBIG Immo Trust ─────────────────────────────
const API = 'https://api.ibigimmotrust.com';

// ── Installation / démarrage ──────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('ibig-autoscan', { periodInMinutes: 1 });
  chrome.alarms.create('ibig-groupscan', { periodInMinutes: 15 }); // scan groupes surveillés
});
chrome.alarms.get('ibig-autoscan', alarm => {
  if (!alarm) chrome.alarms.create('ibig-autoscan', { periodInMinutes: 1 });
});
chrome.alarms.get('ibig-groupscan', alarm => {
  if (!alarm) chrome.alarms.create('ibig-groupscan', { periodInMinutes: 15 });
});

// ── Détecter l'ouverture d'une page Facebook (auto-capture immédiate) ─────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url?.includes('facebook.com')) return;

  const store = await chrome.storage.local.get(['ibig_auto_mode', 'ibig_token', 'ibig_last_scan', 'ibig_last_scan_by_url']);
  if (!store.ibig_auto_mode || !store.ibig_token) return;

  const url = tab.url || '';

  // Priorité aux groupes Facebook — les pages de groupes sont toujours scannées
  const isGroup = /facebook\.com\/groups\//i.test(url);
  const isPageOrFeed = /facebook\.com\/(pages?|profile\.php|[^/]+\/posts)/i.test(url)
    || /facebook\.com\/?$/.test(url)
    || url.includes('search');

  if (!isGroup && !isPageOrFeed) return;

  // Cooldown par URL — éviter de rescanner la même page avant 10 min
  const scanByUrl = store.ibig_last_scan_by_url || {};
  const urlKey = url.replace(/[?#].*/, '').slice(0, 100); // URL sans paramètres
  const lastScanForUrl = scanByUrl[urlKey] || 0;
  if (Date.now() - lastScanForUrl < 10 * 60 * 1000) return;

  // Délai humain aléatoire (4–8 secondes) avant de commencer
  const delay = 4000 + Math.random() * 4000;
  await new Promise(r => setTimeout(r, delay));
  await lancerAutoScan(tabId, store.ibig_token);

  scanByUrl[urlKey] = Date.now();
  // Garder seulement les 50 dernières URLs pour ne pas surcharger le storage
  const keys = Object.keys(scanByUrl);
  if (keys.length > 50) delete scanByUrl[keys[0]];
  chrome.storage.local.set({ ibig_last_scan_by_url: scanByUrl });
});

// ── Alarme périodique (1 min) — continue de capturer au scroll ────────────────
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'ibig-autoscan') {
    const store = await chrome.storage.local.get(['ibig_auto_mode', 'ibig_token']);
    if (!store.ibig_auto_mode || !store.ibig_token) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes('facebook.com')) return;
    if (!/facebook\.com\/(groups?|pages?|[^/]+\/posts|\s*$)/i.test(tab.url)) return;

    await lancerAutoScan(tab.id, store.ibig_token);
  }

  // ── Scan automatique des groupes surveillés (toutes les 15 min) ─────────────
  if (alarm.name === 'ibig-groupscan') {
    const store = await chrome.storage.local.get(['ibig_auto_mode', 'ibig_token', 'ibig_watched_groups']);
    if (!store.ibig_auto_mode || !store.ibig_token) return;
    const groupes = store.ibig_watched_groups || [];
    if (!groupes.length) return;

    for (const groupe of groupes) {
      if (!groupe.url) continue;
      try {
        // Ouvrir l'onglet en arrière-plan, scanner, puis fermer
        const tab = await chrome.tabs.create({ url: groupe.url, active: false });
        await new Promise(r => setTimeout(r, 8000 + Math.random() * 4000)); // attendre le chargement
        await lancerAutoScan(tab.id, store.ibig_token);
        await new Promise(r => setTimeout(r, 30000 + Math.random() * 20000)); // laisser le scan tourner
        chrome.tabs.remove(tab.id).catch(() => {});
        await new Promise(r => setTimeout(r, 5000)); // pause entre groupes
      } catch(e) {
        console.warn('IBIG groupscan error:', groupe.url, e.message);
      }
    }
  }
});

// ── Messages depuis la page (badge, compte, refetch) ─────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'IBIG_COUNT_UPDATE') {
    chrome.storage.local.set({ ibig_auto_count: msg.count });
    chrome.action.setBadgeText({ text: msg.count > 0 ? String(msg.count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
  }
  if (msg.type === 'IBIG_SCROLL_DONE') {
    // scroll terminé dans la page, rien à faire ici
  }
  if (msg.type === 'IBIG_REFETCH_ANNONCE') {
    const senderTabId = sender.tab?.id;
    refetchAnnonce(msg.id, msg.url, senderTabId);
  }
});

// ── Refetch complet d'une annonce depuis son lien Facebook ───────────────────
async function refetchAnnonce(annonceId, fbUrl, callerTabId) {
  const store = await chrome.storage.local.get(['ibig_token']);
  const token = store.ibig_token;
  if (!token) {
    if (callerTabId) chrome.tabs.sendMessage(callerTabId, { type: 'IBIG_REFETCH_RESULT', id: annonceId, ok: false, error: 'Non connecté' });
    return;
  }

  let fbTab = null;
  try {
    // Ouvrir l'URL Facebook en arrière-plan
    fbTab = await chrome.tabs.create({ url: fbUrl, active: false });
    // Attendre le chargement complet
    await new Promise(resolve => {
      const listener = (tabId, changeInfo) => {
        if (tabId === fbTab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      // Fallback timeout 15s
      setTimeout(resolve, 15000);
    });

    // Laisser le JS de Facebook se charger
    await new Promise(r => setTimeout(r, 4000));

    // Injecter le script d'extraction complet
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: fbTab.id },
      func: extractFullPost,
    });

    const data = result?.result;
    if (!data || !data.texte) {
      throw new Error('Impossible d\'extraire le contenu');
    }

    // Appeler l'API pour structurer avec l'IA et mettre à jour l'annonce
    const iaRes = await fetch(`${API}/api/annonces/extraire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ texte_brut: data.texte }),
    });
    const iaData = await iaRes.json();
    const ia = iaData.extraction || {};

    // PATCH l'annonce avec les données enrichies
    const patchBody = {
      texte_brut: data.texte,
      ...(ia.titre        && { titre:         ia.titre }),
      ...(ia.type_bien    && { type_bien:     ia.type_bien }),
      ...(ia.transaction  && { transaction:   ia.transaction }),
      ...(ia.commune      && { commune:        ia.commune }),
      ...(ia.quartier     && { quartier:       ia.quartier }),
      ...(ia.prix         && { prix:           ia.prix }),
      ...(ia.superficie   && { superficie:     ia.superficie }),
      ...(ia.nb_pieces    && { nb_pieces:      ia.nb_pieces }),
      ...(ia.contact      && { contact:        ia.contact }),
      ...((ia.description_ia || ia.description) && { description_ia: ia.description_ia || ia.description }),
    };

    await fetch(`${API}/api/annonces/${annonceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(patchBody),
    });

    if (callerTabId) chrome.tabs.sendMessage(callerTabId, { type: 'IBIG_REFETCH_RESULT', id: annonceId, ok: true });
  } catch (err) {
    console.error('IBIG refetch error:', err.message);
    if (callerTabId) chrome.tabs.sendMessage(callerTabId, { type: 'IBIG_REFETCH_RESULT', id: annonceId, ok: false, error: err.message });
  } finally {
    if (fbTab) chrome.tabs.remove(fbTab.id).catch(() => {});
  }
}

// Fonction injectée dans l'onglet Facebook pour extraire le post complet
function extractFullPost() {
  // Cliquer "Voir plus" — recherche exhaustive dans TOUT le DOM
  const VOIR_PLUS = ['voir plus', 'see more', 'lire la suite', 'voir la suite', 'afficher plus'];
  function clickerVoirPlus() {
    const candidats = Array.from(document.querySelectorAll('div,span,a,button,[role="button"],[role="link"]'))
      .filter(el => {
        const t = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (!t) return false;
        if (t.length <= 40 && VOIR_PLUS.some(k => t.includes(k))) return true;
        return VOIR_PLUS.some(k => t.endsWith(k) || t.endsWith('...'+k) || t.endsWith('… '+k) || t.endsWith('... '+k));
      });
    const innermost = candidats.filter(el => !candidats.some(other => other !== el && el.contains(other)));
    innermost.forEach(el => { try { el.click(); } catch(_){} });
    return innermost.length;
  }
  clickerVoirPlus();

  // Attendre un instant puis extraire
  return new Promise(resolve => {
    setTimeout(() => {
      // Extraire le texte complet
      const article = document.querySelector('div[role="article"]') || document.body;
      let best = '';
      article.querySelectorAll('div[dir="auto"], span[dir="auto"]').forEach(node => {
        if (node.closest('a[href]') || node.closest('button') || node.closest('[role="button"]')) return;
        const t = (node.innerText || '').trim();
        if (t.length > best.length) best = t;
      });

      // Extraire les images
      const imgs = [];
      const BAD = /emoji|avatar|sticker|rsrc\.php|1x1|static|_s\.jpg|profile/i;
      article.querySelectorAll('img[src]').forEach(img => {
        if (!img.src || BAD.test(img.src)) return;
        if ((img.naturalWidth || 0) < 100 || (img.naturalHeight || 0) < 100) return;
        if (imgs.length < 8) imgs.push(img.src);
      });

      resolve({ texte: best, imgs });
    }, 2000);
  });
}

// ── Lancer le scan avec scroll automatique ────────────────────────────────────
async function lancerAutoScan(tabId, token) {
  const store = await chrome.storage.local.get(['ibig_auto_count']);
  const prevCount = store.ibig_auto_count || 0;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: ibigFullPageScan,
      args: [token, API, prevCount],
    });
  } catch (e) {
    console.warn('IBIG autoscan error:', e.message);
  }
}

// ─── Fonction injectée dans la page : scroll + capture toutes les annonces ────
async function ibigFullPageScan(token, API, prevCount) {
  if (window.__ibigProcessing) return;
  window.__ibigProcessing = true;

  try {
    // ── Détecter le contexte (groupe Facebook ou page classique) ──────────────
    const pageUrl = window.location.href;
    const isGroupe = /facebook\.com\/groups\//i.test(pageUrl);

    // Extraire le nom du groupe
    let nomGroupe = null;
    if (isGroupe) {
      // Méthode 1 : h1 de la page (nom du groupe affiché)
      nomGroupe = document.querySelector('h1')?.innerText?.trim() || null;
      // Méthode 2 : breadcrumb ou titre de l'onglet
      if (!nomGroupe) nomGroupe = document.title?.split('|')[0]?.trim() || null;
      // Méthode 3 : depuis l'URL /groups/[nom-ou-id]/
      if (!nomGroupe) {
        const m = pageUrl.match(/facebook\.com\/groups\/([^/?#]+)/);
        if (m) nomGroupe = decodeURIComponent(m[1]).replace(/-/g, ' ');
      }
    }
    const sourceName = 'facebook'; // source toujours 'facebook' (VARCHAR(20) en DB)

    // ── Mots-clés immobiliers ──────────────────────────────────────────────────
    const IMMO = [
      'villa','appartement','appart','terrain','bureau','magasin','studio','duplex',
      'triplex','immeuble','résidence','vente','location','louer','vendre','à vendre',
      'à louer','en vente','mise en vente','immobilier','immo','chambre','pièces','m²',
      'm2','fcfa','f cfa','millions','million','xof','cocody','marcory','yopougon',
      'abobo','koumassi','abidjan','riviera','angré','djibi','bonoumin','plateau',
      'treichville','adjamé','port-bouet','songon','bingerville','anyama','deux plateaux',
      'baulé','palmeraie','biétry','sicogi','gouro','route de bingerville',
    ];
    const isImmo = t => { const s = (t||'').toLowerCase(); return IMMO.some(k => s.includes(k)); };

    // ── Détecteur de date Facebook (< 30 jours) ────────────────────────────────
    function isRecent(el) {
      // Chercher les balises de date dans l'article
      const dateEls = el.querySelectorAll('abbr[data-utime], abbr[data-utime] ~ span, span[id*="jsc"] a, a[href*="/posts/"] ~ span, [data-ad-preview] ~ * span a');
      for (const d of dateEls) {
        const utime = d.getAttribute?.('data-utime');
        if (utime) {
          const age = Date.now()/1000 - parseInt(utime);
          return age < 30 * 24 * 3600; // 30 jours
        }
      }
      // Chercher dans le texte des timestamps
      const allText = el.querySelectorAll('a, span');
      for (const node of allText) {
        const t = (node.innerText || '').trim().toLowerCase();
        // Formats Facebook : "il y a 2 h", "hier", "3 j.", "lundi", "15 août"
        if (/^\d+\s*(s|min|h|heure|minute|seconde)/.test(t)) return true;
        if (/^(hier|today|aujourd'hui)/.test(t)) return true;
        if (/^\d+\s*j\.?$/.test(t) && parseInt(t) <= 30) return true;
        if (/^(lun|mar|mer|jeu|ven|sam|dim|mon|tue|wed|thu|fri|sat|sun)/i.test(t)) return true;
        if (/^il y a \d+ (jour|semaine|heure|minute)/i.test(t)) {
          const semaines = t.match(/(\d+)\s*semaine/);
          if (semaines && parseInt(semaines[1]) > 4) return false;
          return true;
        }
        // "15 août" sans année → probablement récent si < 30 jours de cette année
        if (/^\d{1,2}\s+(jan|fév|mar|avr|mai|juin|juil|août|sep|oct|nov|déc)/i.test(t)) {
          // Parser et comparer
          const moisMap = {jan:0,fév:1,mar:2,avr:3,mai:4,juin:5,juil:6,août:7,sep:8,oct:9,nov:10,déc:11};
          const m = t.match(/^(\d{1,2})\s+(\w{3})/i);
          if (m) {
            const mois = moisMap[m[2].toLowerCase().substring(0,3)];
            if (mois !== undefined) {
              const now = new Date();
              const d = new Date(now.getFullYear(), mois, parseInt(m[1]));
              if (d > now) d.setFullYear(now.getFullYear() - 1);
              return (now - d) < 30 * 24 * 3600000;
            }
          }
        }
      }
      return true; // Par défaut considérer comme récent si on ne peut pas déterminer
    }

    // ── Initialiser les structures de déduplication ─────────────────────────────
    if (!window.__ibigSeenKeys) window.__ibigSeenKeys = new Set();
    const seenKeys = window.__ibigSeenKeys;

    // ── Nettoyer le texte (supprimer les "voir plus" résiduels) ─────────────────
    function nettoyerTexte(texte) {
      return (texte || '')
        .replace(/\s*\.\.\.\s*(voir plus|see more|lire la suite|afficher plus)\s*/gi, '')
        .replace(/^(voir plus|see more)\s*/gi, '')
        .replace(/\s*…\s*$/, '')
        .replace(/\s*\.\.\.\s*$/, '')
        .trim();
    }

    // ── Extraire les images haute résolution d'un container ─────────────────────
    function extraireImages(container) {
      const BAD = /emoji|avatar|sticker|rsrc\.php|1x1|static|_s\.jpg|profile/i;
      const imgs = [];
      container.querySelectorAll('img[src]').forEach(img => {
        let src = '';
        if (img.srcset) {
          const parts = img.srcset.split(',').map(s => s.trim().split(' '));
          const best = parts.sort((a,b) => parseFloat(b[1]||0)-parseFloat(a[1]||0))[0];
          src = best?.[0] || img.src;
        } else { src = img.src || ''; }
        if (!src || BAD.test(src)) return;
        const w = img.naturalWidth||0, h = img.naturalHeight||0;
        if (w > 0 && w < 100 && h > 0 && h < 100) return;
        src = src.replace(/\/[spc]\d+x\d+\//, '/').replace(/_\d+x\d+\./, '.');
        if (!imgs.includes(src) && imgs.length < 10) imgs.push(src);
      });
      // Liens vers photos cachées (>5 dans le grid)
      container.querySelectorAll('a[href*="/photo/"],a[href*="/photos/"],a[href*="fbid="]').forEach(a => {
        const img = a.querySelector('img[src]');
        if (!img?.src || BAD.test(img.src)) return;
        if (!imgs.includes(img.src) && imgs.length < 10) imgs.push(img.src);
      });
      return imgs;
    }

    // ── Extraire un post depuis son container ───────────────────────────────────
    function extractPost(el, texteRaw) {
      const texte = nettoyerTexte(texteRaw);
      const key = texte.slice(0, 120).replace(/\s+/g, ' ').trim();
      if (seenKeys.has(key)) return null;
      seenKeys.add(key);

      // ── Capturer le lien source (référence permanente de l'annonce) ──────────
      let lien = null;

      // Priorité 1 : liens directs vers le post (timestamp, header du post)
      const LIEN_SELS = [
        'a[href*="/groups/"][href*="/posts/"]',
        'a[href*="/groups/"][href*="/permalink/"]',
        'a[href*="/posts/"]',
        'a[href*="/permalink/"]',
        'a[href*="/reel/"]',
        'a[href*="/videos/"]',
        'a[href*="story_fbid"]',
        'a[href*="?fbid="]',
        'a[href*="&fbid="]',
        'a[href*="fbid="]',
      ];
      for (const sel of LIEN_SELS) {
        const a = el.querySelector(sel);
        if (!a?.href?.includes('facebook.com')) continue;
        const url = a.href;
        // Conserver les paramètres fbid/story_fbid car ils identifient le post
        if (url.includes('story_fbid') || url.includes('fbid=')) {
          lien = url; // garder l'URL complète
        } else {
          lien = url.split('?')[0]; // nettoyer les paramètres de tracking
        }
        break;
      }

      // Priorité 2 : lien du timestamp (souvent l'URL la plus propre)
      if (!lien) {
        const timeLinks = el.querySelectorAll('a[href]');
        for (const a of timeLinks) {
          const h = a.href || '';
          if (!h.includes('facebook.com')) continue;
          // Les liens timestamp sont souvent courts et pointent vers /posts/ ou /permalink/
          if (/facebook\.com\/[^/]+\/posts\/\d+/.test(h) ||
              /facebook\.com\/groups\/[^/]+\/permalink\/\d+/.test(h) ||
              /facebook\.com\/permalink\/\d+/.test(h)) {
            lien = h.split('?')[0];
            break;
          }
        }
      }

      // Priorité 3 : URL courante si on est sur la page d'un post unique
      if (!lien && (window.location.href.includes('/posts/') ||
          window.location.href.includes('/permalink/') ||
          window.location.href.includes('story_fbid') ||
          window.location.href.includes('fbid='))) {
        lien = window.location.href;
      }

      const imgUrls = extraireImages(el);

      const videoUrls = [];
      el.querySelectorAll('video source[src], video[src]').forEach(v => {
        const u = v.src || v.getAttribute('src');
        if (u && u.startsWith('http') && !videoUrls.includes(u)) videoUrls.push(u);
      });
      el.querySelectorAll('a[href*="/videos/"],a[href*="/reel/"],a[href*="/watch/"]').forEach(a => {
        if (a.href && !videoUrls.includes(a.href)) videoUrls.push(a.href);
      });

      const auteur = el.querySelector('h2 a, h3 a, strong a, [data-testid="actor-name"] a')?.innerText?.trim() || null;
      const recent = isRecent(el);
      return { texte, lien, auteur, imgUrls, videoUrls, recent };
    }

    // ── Collecter tous les posts visibles ───────────────────────────────────────
    function collectPosts() {
      const posts = [];
      const tooOldSeen = [];

      // Méthode 1 : data-ad-preview="message"
      document.querySelectorAll('[data-ad-preview="message"]').forEach(msgEl => {
        const texte = nettoyerTexte((msgEl.innerText || '').trim());
        if (texte.length < 40 || !isImmo(texte)) return;
        const container = msgEl.closest('[data-pagelet]') || msgEl.closest('[role="article"]') || msgEl.parentElement?.parentElement?.parentElement || msgEl;
        const post = extractPost(container, texte);
        if (!post) return;
        if (!post.recent) { tooOldSeen.push(true); return; }
        posts.push(post);
      });

      // Méthode 2 : div[role="feed"] > div
      document.querySelectorAll('div[role="feed"] > div').forEach(feedItem => {
        let texte = '';
        feedItem.querySelectorAll('div[dir="auto"], span[dir="auto"]').forEach(node => {
          if (node.closest('a[href]') || node.closest('button') || node.closest('[role="button"]')) return;
          const t = (node.innerText || '').trim();
          if (t.length > texte.length) texte = t;
        });
        texte = nettoyerTexte(texte);
        if (texte.length < 40 || !isImmo(texte)) return;
        const post = extractPost(feedItem, texte);
        if (!post) return;
        if (!post.recent) { tooOldSeen.push(true); return; }
        posts.push(post);
      });

      // Méthode 3 : div[role="article"] — DOM spécifique aux groupes Facebook
      document.querySelectorAll('div[role="article"]').forEach(art => {
        let texte = '';
        art.querySelectorAll('div[dir="auto"], span[dir="auto"]').forEach(node => {
          if (node.closest('a[href]') || node.closest('button') || node.closest('[role="button"]')) return;
          const t = (node.innerText || '').trim();
          if (t.length > texte.length) texte = t;
        });
        texte = nettoyerTexte(texte);
        if (texte.length < 40 || !isImmo(texte)) return;
        const post = extractPost(art, texte);
        if (!post) return;
        if (!post.recent) { tooOldSeen.push(true); return; }
        posts.push(post);
      });

      return { posts, allTooOld: tooOldSeen.length > 5 && posts.length === 0 };
    }

    // ── Scroll automatique + capture ─────────────────────────────────────────
    let totalSaved = prevCount;
    let scrollAttempts = 0;
    const MAX_SCROLLS = 40; // ~40 scrolls = env. 200 posts

    // ── Expandeur : MutationObserver pour détecter le texte complet ─────────
    function attendreExpansion(container, timeout = 4000) {
      return new Promise(resolve => {
        if (!container) return resolve();
        const avant = container.innerText?.length || 0;
        let done = false;
        const fin = () => { if (!done) { done = true; obs.disconnect(); resolve(); } };

        const obs = new MutationObserver(() => {
          const apres = container.innerText?.length || 0;
          // Texte augmenté de plus de 30 caractères = expansion réussie
          if (apres > avant + 30) fin();
        });
        obs.observe(container, { childList: true, subtree: true, characterData: true });
        setTimeout(fin, timeout); // fallback max 4s
      });
    }

    async function expanderTousVoirPlus() {
      const VOIR = ['voir plus','see more','lire la suite','voir la suite','afficher plus'];

      function findVoirPlusDans(root) {
        const all = Array.from(root.querySelectorAll('*'));
        const candidats = all.filter(el => {
          const t = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (!t || t.length > 200) return false;
          if (VOIR.some(k => t.includes(k))) return true;
          const lbl = (el.getAttribute('aria-label')||'').toLowerCase();
          return VOIR.some(k => lbl.includes(k));
        });
        return candidats.filter(el => !candidats.some(o => o !== el && el.contains(o)));
      }

      // Traiter article par article avec MutationObserver (vrai attente Ajax)
      const articles = Array.from(new Set([
        ...document.querySelectorAll('div[role="article"]'),
        ...document.querySelectorAll('div[role="feed"] > div'),
        ...document.querySelectorAll('[data-pagelet*="FeedUnit"]'),
      ]));

      for (const art of articles) {
        const boutons = findVoirPlusDans(art);
        if (!boutons.length) continue;
        const avant = art.innerText.length;
        boutons.forEach(b => { try { b.click(); } catch(_){} });
        await new Promise(resolve => {
          const obs = new MutationObserver(() => {
            if (art.innerText.length > avant + 50) { obs.disconnect(); resolve(); }
          });
          obs.observe(art, { childList: true, subtree: true, characterData: true });
          setTimeout(() => { obs.disconnect(); resolve(); }, 5000);
        });
      }
    }

    async function scrollAndCapture() {
      // 1. Étendre TOUS les "Voir plus" avant d'extraire
      await expanderTousVoirPlus();

      // 2. Collecter les posts (texte complet maintenant)
      const { posts, allTooOld } = collectPosts();

      // 3. Sauvegarder les nouveaux posts via IA + API
      for (const post of posts) {
        let ia = {};
        try {
          const iaRes = await fetch(`${API}/api/annonces/extraire`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ texte_brut: post.texte }),
          });
          if (iaRes.ok) { const d = await iaRes.json(); ia = d.extraction || {}; }
        } catch(_) {}

        const fd = new FormData();
        fd.append('texte_brut', post.texte);
        fd.append('source', sourceName);
        if (nomGroupe)   fd.append('groupe_source', nomGroupe);
        if (post.lien)   fd.append('lien_original', post.lien);
        if (post.auteur) fd.append('auteur_nom', post.auteur);
        if (ia.titre)       fd.append('titre',        ia.titre);
        if (ia.type_bien)   fd.append('type_bien',    ia.type_bien);
        if (ia.transaction) fd.append('transaction',  ia.transaction);
        if (ia.commune)     fd.append('commune',      ia.commune);
        if (ia.quartier)    fd.append('quartier',     ia.quartier);
        if (ia.prix)        fd.append('prix',         String(ia.prix));
        if (ia.superficie)  fd.append('superficie',   String(ia.superficie));
        if (ia.nb_pieces)   fd.append('nb_pieces',    String(ia.nb_pieces));
        if (ia.contact)     fd.append('contact',      ia.contact);
        if (ia.description_ia) fd.append('description_ia', ia.description_ia);
        else if (ia.description) fd.append('description_ia', ia.description);
        if (post.videoUrls?.length) {
          fd.append('description_ia', (ia.description||'') + '\n[Vidéos] ' + post.videoUrls.join(', '));
        }

        // Télécharger jusqu'à 10 médias (images + vidéos)
        let mediaCount = 0;
        for (const src of post.imgUrls.slice(0, 10)) {
          if (mediaCount >= 10) break;
          try {
            await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
            const r = await fetch(src, { credentials: 'include' });
            if (!r.ok) continue;
            const blob = await r.blob();
            if (blob.type.startsWith('image/') && blob.size > 5000) {
              fd.append('images', blob, `img.${blob.type.split('/')[1]||'jpg'}`);
              mediaCount++;
            }
          } catch(_) {}
        }
        for (const src of post.videoUrls.slice(0, 10 - mediaCount)) {
          if (mediaCount >= 10) break;
          // Vidéos directes (src blob/mp4) uniquement — pas les liens Facebook
          if (!src.includes('.mp4') && !src.includes('.webm') && !src.includes('blob:')) continue;
          try {
            await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
            const r = await fetch(src, { credentials: 'include' });
            if (!r.ok) continue;
            const blob = await r.blob();
            if (blob.type.startsWith('video/') && blob.size > 10000) {
              fd.append('images', blob, `video.${blob.type.split('/')[1]||'mp4'}`);
              mediaCount++;
            }
          } catch(_) {}
        }

        try {
          const res = await fetch(`${API}/api/annonces`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: fd,
          });
          if (res.ok) {
            totalSaved++;
            try { chrome.runtime.sendMessage({ type: 'IBIG_COUNT_UPDATE', count: totalSaved }); } catch(_) {}
          }
        } catch(_) {}

        // Pause naturelle entre chaque annonce (0.5–1.5s)
        await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
      }

      // 4. Mettre à jour le badge visuel sur la page
      if (totalSaved > prevCount) {
        let badge = document.getElementById('__ibig_badge');
        if (!badge) {
          badge = document.createElement('div');
          badge.id = '__ibig_badge';
          badge.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;background:#0284c7;color:white;border-radius:28px;padding:10px 20px;font-size:13px;font-weight:700;font-family:sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.35);pointer-events:none;transition:opacity .5s;';
          document.body.appendChild(badge);
        }
        badge.style.opacity = '1';
        const groupeLabel = nomGroupe ? ` · ${nomGroupe}` : '';
        badge.textContent = `🏠 IBIG Auto${groupeLabel} — ${totalSaved} annonce${totalSaved>1?'s':''} capturée${totalSaved>1?'s':''}`;
      }

      // 5. Arrêter si tous les posts sont trop vieux ou si on a trop scrollé
      if (allTooOld) {
        // Signaler que le scan est terminé
        let badge = document.getElementById('__ibig_badge');
        if (badge) {
          badge.textContent = `✅ Scan terminé — ${totalSaved} annonce${totalSaved>1?'s':''}`;
          badge.style.background = '#16a34a';
          setTimeout(() => { if (badge) badge.style.opacity = '0'; }, 4000);
        }
        return;
      }

      scrollAttempts++;
      if (scrollAttempts >= MAX_SCROLLS) return;

      // 6. Scroller lentement comme un humain
      // Scroll en plusieurs petites étapes avec délais aléatoires
      const steps = 3 + Math.floor(Math.random() * 3);
      const stepSize = Math.floor((window.innerHeight * 1.2) / steps);
      for (let s = 0; s < steps; s++) {
        window.scrollBy({ top: stepSize + Math.random() * 80 - 40, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 400 + Math.random() * 600));
      }
      // Pause humaine aléatoire (2–5 secondes) avant de continuer
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
      await scrollAndCapture(); // continuer
    }

    await scrollAndCapture();

  } finally {
    window.__ibigProcessing = false;
  }
}
