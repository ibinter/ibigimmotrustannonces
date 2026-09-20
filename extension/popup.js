const API = 'https://api.ibigimmotrust.com';

let source      = 'facebook';
let extracted   = null;
let capturedImages = [];
let capturedLink   = null;
let token       = null;
let currentUser = null;
let autoEnabled = false;
let autoTotal   = 0;
let autoInterval = null;

// ─── Auth helpers ─────────────────────────────────────────────────────────────
async function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}

// ─── Auth screens ─────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('loginScreen').style.display = 'block';
  document.getElementById('mainScreen').style.display  = 'none';
  document.getElementById('headerUser').style.display  = 'none';
}
function showMain() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display  = 'block';
  document.getElementById('headerUser').style.display  = 'flex';
  if (currentUser) {
    document.getElementById('headerAvatar').textContent = (currentUser.nom||'?').charAt(0).toUpperCase();
    document.getElementById('headerName').textContent   = currentUser.nom || '';
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
chrome.storage.local.get(['ibig_token','ibig_user','ibig_auto_mode','ibig_auto_count'], async (data) => {
  if (data.ibig_token) {
    token = data.ibig_token;
    currentUser = data.ibig_user || null;
    autoEnabled = data.ibig_auto_mode === true;
    autoTotal   = data.ibig_auto_count || 0;
    try {
      const r = await authFetch(`${API}/api/auth/me`);
      if (r.ok) {
        const d = await r.json();
        currentUser = d.user || d;
        chrome.storage.local.set({ ibig_user: currentUser });
        showMain();
        updateAutoUI();
        if (autoEnabled) startAutoMode();
      } else {
        token = null;
        chrome.storage.local.remove(['ibig_token','ibig_user']);
        showLogin();
      }
    } catch {
      showMain();
      updateAutoUI();
      if (autoEnabled) startAutoMode();
    }
  } else {
    showLogin();
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────
document.getElementById('btnLogin').addEventListener('click', login);
document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key==='Enter') login(); });
document.getElementById('loginEmail').addEventListener('keydown',    e => { if (e.key==='Enter') document.getElementById('loginPassword').focus(); });

async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPassword').value;
  const btn   = document.getElementById('btnLogin');
  if (!email || !pass) { showLoginError('Remplissez email et mot de passe.'); return; }
  btn.disabled = true; btn.textContent = 'Connexion…';
  document.getElementById('loginError').style.display = 'none';
  try {
    const r = await fetch(`${API}/api/auth/login`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email, password: pass }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Identifiants incorrects');
    token = d.token; currentUser = d.user;
    chrome.storage.local.set({ ibig_token: token, ibig_user: currentUser });
    showMain(); updateAutoUI();
  } catch(e) { showLoginError(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Se connecter'; }
}
function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg; el.style.display = 'block';
}

// ─── Logout ───────────────────────────────────────────────────────────────────
document.getElementById('btnLogout').addEventListener('click', () => {
  token = null; currentUser = null; autoEnabled = false;
  stopAutoMode();
  chrome.storage.local.remove(['ibig_token','ibig_user','ibig_auto_mode','ibig_auto_count']);
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPassword').value = '';
  showLogin();
});

// ─── Sources ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.src-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.src-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    source = btn.dataset.src;
  });
});

// ─── Mode Auto ────────────────────────────────────────────────────────────────
const autoToggle = document.getElementById('autoToggle');
const autoBar    = document.getElementById('autoBar');
const autoCount  = document.getElementById('autoCount');
const btnScanNow = document.getElementById('btnScanNow');

function updateAutoUI() {
  autoToggle.checked = autoEnabled;
  autoBar.classList.toggle('active', autoEnabled);
  // Boutons toujours visibles
  btnScanNow.style.display = 'block';
  document.getElementById('btnDiag').style.display = 'block';
  if (autoTotal > 0) {
    autoCount.style.display = 'inline-block';
    autoCount.textContent = autoTotal;
  }
}

// ─── Diagnostic ───────────────────────────────────────────────────────────────
document.getElementById('btnDiag').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const diagEl = document.getElementById('diagResult');
  diagEl.style.display = 'block';
  diagEl.textContent = '⏳ Analyse en cours…';

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const report = [];

        // Tester tous les sélecteurs possibles
        const selectors = {
          'role=article': document.querySelectorAll('div[role="article"]').length,
          'data-pagelet*=FeedUnit': document.querySelectorAll('div[data-pagelet*="FeedUnit"]').length,
          'data-pagelet*=GroupFeed': document.querySelectorAll('div[data-pagelet*="GroupFeed"]').length,
          'role=feed>div': document.querySelectorAll('div[role="feed"] > div').length,
          'dir=auto (total)': document.querySelectorAll('div[dir="auto"]').length,
          'data-ad-preview=message': document.querySelectorAll('[data-ad-preview="message"]').length,
        };
        report.push('=== Sélecteurs trouvés ===');
        for (const [k,v] of Object.entries(selectors)) report.push(`${k}: ${v}`);

        // Montrer les 3 premiers textes de div[dir="auto"] hors liens
        report.push('\n=== Premiers textes dir=auto (hors liens) ===');
        let found = 0;
        document.querySelectorAll('div[dir="auto"]').forEach(el => {
          if (found >= 3) return;
          if (el.closest('a[href]') || el.closest('button') || el.closest('[role="button"]')) return;
          const t = (el.innerText||'').trim().slice(0, 120);
          if (t.length > 20) { report.push(`[${t.length} chars] "${t}"`); found++; }
        });

        // Montrer les 2 premiers articles
        report.push('\n=== Articles (2 premiers, 200 chars) ===');
        document.querySelectorAll('div[role="article"]').forEach((el, i) => {
          if (i >= 2) return;
          report.push(`Article ${i+1}: "${(el.innerText||'').trim().slice(0,200)}"`);
        });

        return report.join('\n');
      }
    });
    diagEl.textContent = results?.[0]?.result || 'Aucun résultat';
  } catch(e) {
    diagEl.textContent = 'Erreur: ' + e.message;
  }
});

autoToggle.addEventListener('change', async () => {
  autoEnabled = autoToggle.checked;
  chrome.storage.local.set({ ibig_auto_mode: autoEnabled });
  if (autoEnabled) {
    startAutoMode();
    // Activer le badge dans la page
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.scripting.executeScript({ target:{tabId:tab.id}, func:(t)=>{ window.__ibigAutoToken=t; if(window.__ibigShowBadge) window.__ibigShowBadge(0); }, args:[token] }).catch(()=>{});
    }
  } else {
    stopAutoMode();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.scripting.executeScript({ target:{tabId:tab.id}, func:()=>{ if(window.__ibigHideBadge) window.__ibigHideBadge(); } }).catch(()=>{});
    }
  }
  updateAutoUI();
});

// ─── Bouton "Scanner maintenant" ──────────────────────────────────────────────
btnScanNow.addEventListener('click', () => lancerScan());

async function lancerScan() {
  const btn = btnScanNow;
  btn.textContent = '⏳ Scan en cours…';
  btn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { btn.textContent = '🔍 Scanner les posts visibles maintenant'; btn.disabled=false; return; }

    // Étape 1 : cliquer tous les "Voir plus" avec vérification que le bouton disparaît
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => new Promise(async resolveAll => {
        const VOIR_PLUS = ['voir plus', 'see more', 'lire la suite', 'voir la suite', 'afficher plus'];

        async function clickerVoirPlus() {
          const boutons = Array.from(document.querySelectorAll('[role="button"], [role="link"]'))
            .filter(btn => VOIR_PLUS.some(k => (btn.innerText||btn.textContent||'').trim().toLowerCase().includes(k)));
          if (!boutons.length) return 0;

          const promises = boutons.map(btn => new Promise(resolve => {
            const container = btn.closest('[data-pagelet]')
              || btn.closest('[role="article"]')
              || btn.closest('div[role="feed"] > div')
              || btn.parentElement?.parentElement?.parentElement;

            if (!container) { try { btn.click(); } catch(_) {} return resolve(); }

            const avant = container.innerText?.length || 0;
            let done = false;
            const fin = () => { if (!done) { done=true; obs.disconnect(); resolve(); } };
            const obs = new MutationObserver(() => {
              if ((container.innerText?.length||0) > avant + 20) fin();
            });
            obs.observe(container, { childList:true, subtree:true, characterData:true });
            setTimeout(fin, 5000); // attendre jusqu'à 5s
            try { btn.click(); } catch(_) {}
          }));

          await Promise.all(promises);
          return boutons.length;
        }

        // Cliquer une première fois
        await clickerVoirPlus();
        await new Promise(r => setTimeout(r, 600));
        // Cliquer une deuxième fois pour les boutons apparus après le premier chargement
        await clickerVoirPlus();
        await new Promise(r => setTimeout(r, 600));

        resolveAll();
      }),
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {

        const IMMO = ['villa','appartement','appart','terrain','bureau','magasin','studio','duplex','triplex','immeuble','résidence','vente','location','louer','vendre','à vendre','à louer','en vente','mise en vente','immobilier','immo','chambre','pièces','m²','m2','fcfa','f cfa','millions','million','xof','cocody','marcory','yopougon','abobo','koumassi','abidjan','riviera','angré','djibi','bonoumin','plateau','treichville','port-bouet','bingerville','deux plateaux'];
        const isImmo = t => { const s=(t||'').toLowerCase(); return IMMO.some(k=>s.includes(k)); };

        // ── Détection robuste du lien source ──────────────────────────────────
        function detecterLien(container) {
          const SELS = [
            'a[href*="/groups/"][href*="/posts/"]', 'a[href*="/groups/"][href*="/permalink/"]',
            'a[href*="/posts/"]', 'a[href*="/permalink/"]',
            'a[href*="/reel/"]', 'a[href*="/videos/"]',
            'a[href*="story_fbid"]', 'a[href*="?fbid="]',
            'a[href*="&fbid="]', 'a[href*="fbid="]',
          ];
          for (const sel of SELS) {
            const a = container.querySelector(sel);
            if (!a?.href?.includes('facebook.com')) continue;
            const url = a.href;
            return (url.includes('story_fbid') || url.includes('fbid=')) ? url : url.split('?')[0];
          }
          // Chercher le lien propre dans tous les <a> du container
          for (const a of container.querySelectorAll('a[href]')) {
            const h = a.href || '';
            if (!h.includes('facebook.com')) continue;
            if (/facebook\.com\/[^/]+\/posts\/\d+/.test(h) ||
                /facebook\.com\/groups\/[^/]+\/permalink\/\d+/.test(h) ||
                /facebook\.com\/permalink\/\d+/.test(h)) {
              return h.split('?')[0];
            }
          }
          // Fallback : URL courante si c'est une page de post
          const cur = window.location.href;
          if (cur.includes('/posts/') || cur.includes('/permalink/') ||
              cur.includes('story_fbid') || cur.includes('fbid=')) return cur;
          return null;
        }

        const posts = [];
        const seen  = new Set();

        // ── Extraire les images d'un container (max 10, haute résolution) ────────
        function extraireImages(container) {
          const images = [];
          const BAD = /emoji|avatar|sticker|rsrc\.php|1x1|static|_s\.jpg|profile/i;

          // Méthode 1 : balises <img> avec src direct
          container.querySelectorAll('img[src]').forEach(img => {
            // Préférer la version haute résolution depuis srcset
            let src = '';
            if (img.srcset) {
              const parts = img.srcset.split(',').map(s => s.trim().split(' '));
              const best = parts.sort((a,b) => parseFloat(b[1]||0) - parseFloat(a[1]||0))[0];
              src = best?.[0] || img.src;
            } else {
              src = img.src || '';
            }
            if (!src || BAD.test(src)) return;
            const w = img.naturalWidth||0, h = img.naturalHeight||0;
            if (w > 0 && w < 100 && h > 0 && h < 100) return;
            // Remplacer les URLs basse résolution Facebook par haute résolution
            src = src.replace(/\/[spc]\d+x\d+\//, '/').replace(/_\d+x\d+\./, '.');
            if (!images.includes(src) && images.length < 10) images.push(src);
          });

          // Méthode 2 : liens vers des photos Facebook (images cachées par le grid)
          container.querySelectorAll('a[href*="/photo/"], a[href*="/photos/"], a[href*="fbid="]').forEach(a => {
            // Chercher l'image à l'intérieur du lien
            const img = a.querySelector('img[src]');
            if (!img) return;
            const src = img.src || '';
            if (!src || BAD.test(src)) return;
            if (!images.includes(src) && images.length < 10) images.push(src);
          });

          // Méthode 3 : images dans les divs avec background-image
          container.querySelectorAll('[style*="background-image"]').forEach(el => {
            const m = (el.style.backgroundImage||'').match(/url\(["']?([^"')]+)["']?\)/);
            if (m && m[1] && !BAD.test(m[1]) && !images.includes(m[1]) && images.length < 10) {
              images.push(m[1]);
            }
          });

          return images;
        }

        // ── Texte complet sans "voir plus" résiduel ──────────────────────────────
        function nettoyerTexte(texte) {
          return texte
            .replace(/\s*\.\.\.\s*(voir plus|see more|lire la suite|afficher plus)\s*/gi, '')
            .replace(/^(voir plus|see more)\s*/gi, '')
            .trim();
        }

        // ── Méthode 1 : data-ad-preview="message" ────────────────────────────────
        document.querySelectorAll('[data-ad-preview="message"]').forEach(msgEl => {
          const texte = nettoyerTexte((msgEl.innerText||'').trim());
          if (texte.length < 40 || !isImmo(texte)) return;
          const key = texte.slice(0,120).replace(/\s+/g,' ');
          if (seen.has(key)) return;
          seen.add(key);

          const container = msgEl.closest('[data-pagelet]') || msgEl.closest('[role="article"]') || msgEl.parentElement?.parentElement?.parentElement || msgEl;
          const lien = detecterLien(container);
          const images = extraireImages(container);
          const auteur = container.querySelector('h2 a, h3 a, strong a')?.innerText?.trim() || null;
          posts.push({ texte, lien, auteur, images });
        });

        function extractFromEl(el) {
          let texte = '';
          el.querySelectorAll('div[dir="auto"], span[dir="auto"]').forEach(node => {
            if (node.closest('a[href]') || node.closest('button') || node.closest('[role="button"]')) return;
            const t = (node.innerText||'').trim();
            if (t.length > texte.length) texte = t;
          });
          texte = nettoyerTexte(texte);
          if (texte.length < 40 || !isImmo(texte)) return;
          const key = texte.slice(0,120).replace(/\s+/g,' ');
          if (seen.has(key)) return;
          seen.add(key);
          const lien = detecterLien(el);
          const images = extraireImages(el);
          const auteur = el.querySelector('h2 a, h3 a, strong a')?.innerText?.trim() || null;
          posts.push({ texte, lien, auteur, images });
        }

        // ── Méthode 2 : div[role="feed"]>div ──
        document.querySelectorAll('div[role="feed"] > div').forEach(extractFromEl);

        // ── Méthode 3 : div[role="article"] — spécifique aux groupes Facebook ──
        document.querySelectorAll('div[role="article"]').forEach(extractFromEl);

        return posts;
      }
    });

    const posts = results?.[0]?.result || [];
    if (posts.length === 0) {
      showResult('error', 'Aucune annonce immobilière détectée sur cette page. Scrollez un peu et réessayez.');
      btn.textContent = '🔍 Scanner les posts visibles maintenant'; btn.disabled=false;
      return;
    }

    showResult('info', `✓ ${posts.length} annonce(s) trouvée(s) — Import en cours…`);

    let saved = 0, skipped = 0, errors = 0;

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];

      // Extraction IA individuelle via /api/annonces/extraire
      let ia = {};
      try {
        const iaRes = await fetch(`${API}/api/annonces/extraire`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ texte_brut: post.texte }),
        });
        if (iaRes.ok) { const d = await iaRes.json(); ia = d.extraction || {}; }
      } catch(_) {}

      // Pause anti-throttling Brave (min 800ms entre requêtes)
      if (i > 0) await new Promise(r => setTimeout(r, 800 + Math.random() * 400));

      showResult('info', `⏳ ${i+1}/${posts.length} — ${ia.type_bien || 'bien'} ${ia.commune ? 'à ' + ia.commune : ''}…`);
      try {
        const fd = new FormData();
        // Extraire nom du groupe depuis l'URL de l'onglet courant
        const tabUrl2 = tab?.url || '';
        let sourceScan = 'facebook';
        let nomGroupeScan = null;
        if (/facebook\.com\/groups\//i.test(tabUrl2)) {
          const mg = tabUrl2.match(/facebook\.com\/groups\/([^/?#]+)/);
          if (mg) nomGroupeScan = decodeURIComponent(mg[1]).replace(/-/g, ' ');
        }

        fd.append('texte_brut', post.texte);
        fd.append('source', 'facebook');
        if (nomGroupeScan) fd.append('groupe_source', nomGroupeScan);
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

        for (const src of (post.images||[]).slice(0,10)) {
          try {
            const r = await fetch(src, { credentials:'include' });
            if (!r.ok) continue;
            const blob = await r.blob();
            if (blob.type.startsWith('image/') && blob.size > 3000) fd.append('images', blob, `img.${blob.type.split('/')[1]||'jpg'}`);
          } catch(_) {}
        }

        const res = await fetch(`${API}/api/annonces`, { method:'POST', headers:{ 'Authorization':`Bearer ${token}` }, body: fd });
        const resText = await res.text();
        if (res.ok) { saved++; }
        else if (res.status===409) { skipped++; }
        else { errors++; console.warn(`Annonce ${i+1} erreur ${res.status}:`, resText.slice(0,100)); }
      } catch(e) { errors++; console.warn(`Annonce ${i+1}:`, e.message); }
    }

    autoTotal += saved;
    chrome.storage.local.set({ ibig_auto_count: autoTotal });
    autoCount.style.display = 'inline-block';
    autoCount.textContent = autoTotal;

    const parts = [];
    if (saved > 0)   parts.push(`✅ ${saved} enregistrée(s)`);
    if (skipped > 0) parts.push(`⏭ ${skipped} déjà existante(s)`);
    if (errors > 0)  parts.push(`❌ ${errors} erreur(s) — voir console`);
    const msg = parts.length ? parts.join(' · ') : 'Aucun résultat';
    showResult(saved>0?'success':errors>0?'error':'info', msg);

    // Mettre à jour le badge dans la page
    if (tab?.id) {
      chrome.scripting.executeScript({ target:{tabId:tab.id}, func:(c)=>{ if(window.__ibigShowBadge) window.__ibigShowBadge(c); }, args:[autoTotal] }).catch(()=>{});
    }
  } catch(e) {
    showResult('error', 'Erreur : ' + e.message);
  }
  btn.textContent = '🔍 Scanner les posts visibles maintenant';
  btn.disabled = false;
}

// ─── Auto-mode — géré par background.js via chrome.alarms ────────────────────
function startAutoMode() {
  // Le background service worker fait le scan toutes les 30s automatiquement
  // Lancer un scan immédiat en plus
  lancerScan();
}
function stopAutoMode() {
  // Rien à arrêter ici — le background gère les alarmes
  // L'alarme vérifie ibig_auto_mode dans le storage avant de scanner
}

// ─── Capture manuelle (texte de la page) ─────────────────────────────────────
document.getElementById('captureBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  showResult('info', 'Capture en cours…');
  try {
    const [txt] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__ibigCapture ? window.__ibigCapture() : null,
    });
    if (txt?.result) {
      document.getElementById('texte').value = txt.result;
      document.getElementById('charCount').textContent = txt.result.length;
    }
    const [imgs] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__ibigCaptureImages ? window.__ibigCaptureImages() : [],
    });
    const [lnk] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__ibigCaptureLink ? window.__ibigCaptureLink() : window.location.href,
    });
    if (lnk?.result) { capturedLink = lnk.result; setLienDisplay(capturedLink); }
    if (imgs?.result?.length > 0) {
      capturedImages = imgs.result.map(i => ({ ...i, selected: true }));
      renderImages();
      showResult('info', `✓ Texte + ${capturedImages.length} image(s) capturé(s)`);
    } else if (txt?.result) {
      showResult('info', '✓ Texte capturé');
    } else {
      showResult('error', 'Aucun texte détecté. Sélectionnez le texte de l\'annonce.');
    }
  } catch(e) { showResult('error', 'Impossible d\'accéder à cette page.'); }
});

// ─── Texte manuel ─────────────────────────────────────────────────────────────
const texteEl = document.getElementById('texte');
texteEl.addEventListener('input', () => {
  document.getElementById('charCount').textContent = texteEl.value.length;
  extracted = null;
  document.getElementById('extraction').style.display = 'none';
});

// ─── Lien ─────────────────────────────────────────────────────────────────────
function setLienDisplay(url) {
  const row = document.getElementById('lienRow');
  const lien = document.getElementById('lienDisplay');
  if (url) {
    row.style.display = 'block';
    lien.href = url;
    lien.textContent = url.length > 55 ? url.slice(0,55)+'…' : url;
  } else {
    row.style.display = 'none';
    lien.href = '#'; lien.textContent = '';
  }
}
document.getElementById('lienClear').addEventListener('click', () => { capturedLink=null; setLienDisplay(null); });

// ─── Images ───────────────────────────────────────────────────────────────────
function renderImages() {
  const container = document.getElementById('imagesContainer');
  if (!capturedImages.length) { container.style.display='none'; return; }
  container.style.display = 'block';
  container.innerHTML = `<div class="img-label">Images (cliquez pour désélectionner)</div>
    <div class="img-grid">${capturedImages.map((img,i)=>`
      <div class="img-thumb ${img.selected?'selected':'deselected'}" data-idx="${i}">
        <img src="${img.b64||img.src}" />
        <div class="img-check">${img.selected?'✓':'✗'}</div>
      </div>`).join('')}
    </div>`;
  container.querySelectorAll('.img-thumb').forEach(el=>{
    el.addEventListener('click',()=>{ const i=parseInt(el.dataset.idx); capturedImages[i].selected=!capturedImages[i].selected; renderImages(); });
  });
}

// ─── Structurer IA ────────────────────────────────────────────────────────────
document.getElementById('btnIA').addEventListener('click', async () => {
  const texte = texteEl.value.trim();
  if (!texte) return showResult('error', 'Collez le texte d\'abord.');
  setLoading(true);
  try {
    const res = await authFetch(`${API}/api/annonces/extraire`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ texte_brut: texte }),
    });
    if (res.status===401) { showLogin(); return; }
    const d = await res.json();
    if (!res.ok) throw new Error(d.error||'Erreur');
    extracted = d.extraction;
    displayExtraction(extracted);
    showResult('info', '✓ Données structurées. Vérifiez puis enregistrez.');
  } catch(e) { showResult('error', e.message); }
  finally { setLoading(false); }
});

// ─── Enregistrer ──────────────────────────────────────────────────────────────
document.getElementById('btnSave').addEventListener('click', async () => {
  const texte = texteEl.value.trim();
  if (!texte) return showResult('error', 'Le texte est vide.');
  setLoading(true);
  try {
    const selectedImgs = capturedImages.filter(i => i.selected && i.b64);
    if (selectedImgs.length > 0) {
      const fd = new FormData();
      fd.append('texte_brut', texte);
      fd.append('source', source);
      if (capturedLink) fd.append('lien_original', capturedLink);
      const groupe = document.getElementById('groupe').value.trim();
      if (groupe) fd.append('groupe_source', groupe);
      if (extracted) Object.entries(extracted).forEach(([k,v])=>{ if(v!=null) fd.append(k,v); });
      for (const img of selectedImgs) {
        const resp = await fetch(img.b64);
        const blob = await resp.blob();
        fd.append('images', blob, `image.${img.type.split('/')[1]||'jpg'}`);
      }
      const res = await fetch(`${API}/api/annonces`, { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:fd });
      if (res.status===401) { showLogin(); return; }
      const d = await res.json();
      if (res.status===409) return showResult('info', 'ℹ️ Annonce déjà enregistrée.');
      if (!res.ok) throw new Error(d.error||'Erreur');
      handleSuccess(d);
    } else {
      const body = { texte_brut:texte, source, lien_original:capturedLink||undefined, groupe_source:document.getElementById('groupe').value.trim()||undefined, ...(extracted||{}) };
      const res = await authFetch(`${API}/api/annonces`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      if (res.status===401) { showLogin(); return; }
      const d = await res.json();
      if (res.status===409) return showResult('info', 'ℹ️ Annonce déjà enregistrée.');
      if (!res.ok) throw new Error(d.error||'Erreur');
      handleSuccess(d);
    }
  } catch(e) { showResult('error', e.message); }
  finally { setLoading(false); }
});

function handleSuccess(data) {
  const nb = data.matchs?.length || 0;
  showResult('success', `✅ Enregistrée ! ${nb>0?`${nb} client(s) matché(s) 🎯`:'Aucun match pour l\'instant.'}`);
  texteEl.value=''; document.getElementById('charCount').textContent='0';
  document.getElementById('groupe').value='';
  document.getElementById('extraction').style.display='none';
  document.getElementById('imagesContainer').style.display='none';
  extracted=null; capturedImages=[]; capturedLink=null; setLienDisplay(null);
}

function displayExtraction(ext) {
  const labels = { type_bien:'Type', transaction:'Transaction', commune:'Commune', quartier:'Quartier', prix:'Prix', superficie:'Superficie (m²)', nb_pieces:'Pièces', contact:'Contact' };
  const rows = Object.entries(labels).filter(([k])=>ext[k]!=null&&ext[k]!=='')
    .map(([k,label])=>`<div class="ext-row"><span class="ext-key">${label}</span><span class="ext-val">${ext[k]}</span></div>`).join('');
  document.getElementById('extractionRows').innerHTML = rows;
  document.getElementById('extraction').style.display = 'block';
}

function showResult(type, msg) {
  const el = document.getElementById('result');
  el.className = `result ${type}`;
  el.textContent = msg;
  el.style.display = 'block';
  if (type==='success') setTimeout(()=>el.style.display='none', 6000);
}

function setLoading(on) {
  document.getElementById('btnIA').disabled = on;
  document.getElementById('btnSave').disabled = on;
  document.getElementById('btnSave').textContent = on ? '…' : 'Enregistrer';
}

// Charger état auto
chrome.storage.local.get(['ibig_auto_mode','ibig_auto_count'], (s) => {
  if (s.ibig_auto_mode) {
    autoEnabled = true;
    autoTotal = s.ibig_auto_count || 0;
  }
});

// ─── Onglets ─────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tabCapture').style.display  = tab === 'capture' ? 'block' : 'none';
    document.getElementById('tabGroupes').style.display  = tab === 'groupes'  ? 'block' : 'none';
    if (tab === 'groupes') chargerOngletGroupes();
  });
});

// ─── Onglet Groupes ───────────────────────────────────────────────────────────
async function chargerOngletGroupes() {
  // 1. Détecter si on est sur un groupe Facebook
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  const isGroupe = /facebook\.com\/groups\//i.test(url);
  const infoBar = document.getElementById('groupeInfoBar');
  const noFb    = document.getElementById('groupeNoFb');

  if (isGroupe) {
    // Extraire le nom du groupe depuis la page
    let nomGroupe = null;
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const h1 = document.querySelector('h1')?.innerText?.trim();
          const title = document.title?.split('|')[0]?.trim();
          return h1 || title || null;
        }
      });
      nomGroupe = res?.result || null;
    } catch(_) {}

    // Fallback depuis l'URL
    if (!nomGroupe) {
      const m = url.match(/facebook\.com\/groups\/([^/?#]+)/);
      if (m) nomGroupe = decodeURIComponent(m[1]).replace(/-/g, ' ');
    }

    const urlBase = url.replace(/[?#].*/, '');
    document.getElementById('groupeInfoName').textContent = nomGroupe || 'Groupe Facebook';
    document.getElementById('groupeInfoUrl').textContent  = urlBase.slice(0, 60);
    infoBar.style.display = 'block';
    noFb.style.display    = 'none';

    // Désactiver le bouton si déjà dans la liste
    const store = await chrome.storage.local.get('ibig_watched_groups');
    const groupes = store.ibig_watched_groups || [];
    const dejaDans = groupes.some(g => g.url === urlBase);
    const btnAdd = document.getElementById('btnAddGroupe');
    btnAdd.disabled = dejaDans;
    btnAdd.textContent = dejaDans ? '✅ Déjà dans la liste' : '📌 Ajouter ce groupe aux surveillés';

    // Stocker pour le bouton Ajouter
    btnAdd.dataset.url  = urlBase;
    btnAdd.dataset.name = nomGroupe || 'Groupe Facebook';
  } else {
    infoBar.style.display = 'none';
    noFb.style.display    = 'block';
  }

  // 2. Charger la liste des groupes surveillés
  await afficherGroupesSurveilles();
}

async function afficherGroupesSurveilles() {
  const store = await chrome.storage.local.get('ibig_watched_groups');
  const groupes = store.ibig_watched_groups || [];
  const list = document.getElementById('watchedGroupsList');
  const empty = document.getElementById('emptyGroupes');

  if (!groupes.length) {
    empty.style.display = 'block';
    // Supprimer les anciens items
    list.querySelectorAll('.watched-item').forEach(el => el.remove());
    return;
  }
  empty.style.display = 'none';
  list.querySelectorAll('.watched-item').forEach(el => el.remove());

  groupes.forEach((g, idx) => {
    const item = document.createElement('div');
    item.className = 'watched-item';
    item.innerHTML = `
      <div style="flex:1;overflow:hidden">
        <div class="w-name">${g.name || 'Groupe'}</div>
        <div class="w-url">${(g.url||'').slice(26, 70)}…</div>
      </div>
      <button class="btn-scan-groupe" data-idx="${idx}" title="Scanner maintenant">▶ Scanner</button>
      <button class="btn-rm-groupe" data-idx="${idx}" title="Retirer">✕</button>
    `;

    item.querySelector('.btn-rm-groupe').addEventListener('click', async () => {
      const s2 = await chrome.storage.local.get('ibig_watched_groups');
      const gr = s2.ibig_watched_groups || [];
      gr.splice(idx, 1);
      await chrome.storage.local.set({ ibig_watched_groups: gr });
      await afficherGroupesSurveilles();
    });

    item.querySelector('.btn-scan-groupe').addEventListener('click', async () => {
      const btn = item.querySelector('.btn-scan-groupe');
      btn.textContent = '⏳';
      btn.disabled = true;
      try {
        // Ouvrir le groupe dans un nouvel onglet, scanner, fermer
        const newTab = await chrome.tabs.create({ url: g.url, active: true });
        showResultGroupes('info', `Ouverture de "${g.name}"…`);
        setTimeout(async () => {
          try {
            const store2 = await chrome.storage.local.get(['ibig_token','ibig_auto_count']);
            await chrome.scripting.executeScript({
              target: { tabId: newTab.id },
              func: ibigFullPageScan,
              args: [store2.ibig_token, API, store2.ibig_auto_count || 0],
            });
          } catch(_) {}
          btn.textContent = '▶ Scanner'; btn.disabled = false;
        }, 6000);
      } catch(e) {
        btn.textContent = '▶ Scanner'; btn.disabled = false;
        showResultGroupes('error', e.message);
      }
    });

    list.appendChild(item);
  });
}

// Ajouter un groupe
document.getElementById('btnAddGroupe').addEventListener('click', async () => {
  const btn = document.getElementById('btnAddGroupe');
  const url  = btn.dataset.url;
  const name = btn.dataset.name;
  if (!url) return;

  const store = await chrome.storage.local.get('ibig_watched_groups');
  const groupes = store.ibig_watched_groups || [];
  if (groupes.some(g => g.url === url)) return;

  groupes.push({ url, name, ajouteAt: new Date().toISOString() });
  await chrome.storage.local.set({ ibig_watched_groups: groupes });

  btn.disabled = true;
  btn.textContent = '✅ Ajouté !';
  await afficherGroupesSurveilles();
  showResultGroupes('success', `✅ "${name}" ajouté aux groupes surveillés`);
});

function showResultGroupes(type, msg) {
  const el = document.getElementById('resultGroupes');
  el.className = `result ${type}`;
  el.textContent = msg;
  el.style.display = 'block';
  if (type === 'success') setTimeout(() => el.style.display = 'none', 4000);
}

// Fonction ibigFullPageScan référencée pour le scan manuel depuis popup
// (dupliquée ici pour pouvoir être injectée par chrome.scripting)
async function ibigFullPageScan(token, API, prevCount) {
  if (window.__ibigProcessing) return;
  window.__ibigProcessing = true;
  try {
    const pageUrl = window.location.href;
    const isGroupe = /facebook\.com\/groups\//i.test(pageUrl);
    let nomGroupe = null;
    if (isGroupe) {
      nomGroupe = document.querySelector('h1')?.innerText?.trim()
        || document.title?.split('|')[0]?.trim() || null;
      if (!nomGroupe) {
        const m = pageUrl.match(/facebook\.com\/groups\/([^/?#]+)/);
        if (m) nomGroupe = decodeURIComponent(m[1]).replace(/-/g, ' ');
      }
    }
    const sourceName = 'facebook'; // toujours 'facebook' — groupe dans groupe_source

    const IMMO = ['villa','appartement','appart','terrain','bureau','magasin','studio','duplex','immeuble','résidence','vente','location','louer','vendre','à vendre','à louer','en vente','immobilier','immo','chambre','pièces','m²','m2','fcfa','f cfa','millions','million','xof','cocody','marcory','yopougon','abobo','koumassi','abidjan','riviera','angré','djibi','bonoumin','plateau','treichville','port-bouet','bingerville','deux plateaux'];
    const isImmo = t => { const s=(t||'').toLowerCase(); return IMMO.some(k=>s.includes(k)); };

    if (!window.__ibigSeenKeys) window.__ibigSeenKeys = new Set();
    const seenKeys = window.__ibigSeenKeys;
    let totalSaved = prevCount || 0;

    const LIEN_SELS = ['a[href*="/groups/"][href*="/posts/"]','a[href*="/groups/"][href*="/permalink/"]','a[href*="/posts/"]','a[href*="/permalink/"]','a[href*="/reel/"]','a[href*="/videos/"]','a[href*="story_fbid"]','a[href*="?fbid="]','a[href*="&fbid="]','a[href*="fbid="]'];
    function detecterLien(el) {
      for (const sel of LIEN_SELS) {
        const a = el.querySelector(sel);
        if (!a?.href?.includes('facebook.com')) continue;
        const url = a.href;
        return (url.includes('story_fbid')||url.includes('fbid=')) ? url : url.split('?')[0];
      }
      for (const a of el.querySelectorAll('a[href]')) {
        const h = a.href||'';
        if (!h.includes('facebook.com')) continue;
        if (/facebook\.com\/[^/]+\/posts\/\d+/.test(h)||/facebook\.com\/groups\/[^/]+\/permalink\/\d+/.test(h)||/facebook\.com\/permalink\/\d+/.test(h)) return h.split('?')[0];
      }
      const cur = window.location.href;
      if (cur.includes('/posts/')||cur.includes('/permalink/')||cur.includes('story_fbid')||cur.includes('fbid=')) return cur;
      return null;
    }

    function collectPosts() {
      const posts = []; const tooOld = [];
      const process = (el, texte) => {
        if (texte.length < 40 || !isImmo(texte)) return;
        const key = texte.slice(0,120).replace(/\s+/g,' ');
        if (seenKeys.has(key)) return; seenKeys.add(key);
        const imgs = []; el.querySelectorAll('img[src]').forEach(img => { const s=img.src; if(!s||/emoji|avatar|sticker|rsrc\.php|1x1|static/i.test(s)) return; if((img.naturalWidth||0)>0&&img.naturalWidth<100&&(img.naturalHeight||0)<100) return; if(!imgs.includes(s)&&imgs.length<10) imgs.push(s); });
        const lien = detecterLien(el);
        const auteur = el.querySelector('h2 a, h3 a, strong a')?.innerText?.trim()||null;
        posts.push({ texte, lien, auteur, imgs });
      };
      document.querySelectorAll('[data-ad-preview="message"]').forEach(msgEl => {
        const c = msgEl.closest('[data-pagelet]')||msgEl.closest('[role="article"]')||msgEl.parentElement?.parentElement?.parentElement||msgEl;
        process(c, (msgEl.innerText||'').trim());
      });
      document.querySelectorAll('div[role="feed"] > div').forEach(fi => {
        let t=''; fi.querySelectorAll('div[dir="auto"],span[dir="auto"]').forEach(n => { if(n.closest('a[href]')||n.closest('button')||n.closest('[role="button"]')) return; const tx=(n.innerText||'').trim(); if(tx.length>t.length) t=tx; });
        process(fi, t);
      });
      // Groupes : div[role="article"]
      document.querySelectorAll('div[role="article"]').forEach(art => {
        let t=''; art.querySelectorAll('div[dir="auto"],span[dir="auto"]').forEach(n => { if(n.closest('a[href]')||n.closest('button')||n.closest('[role="button"]')) return; const tx=(n.innerText||'').trim(); if(tx.length>t.length) t=tx; });
        process(art, t);
      });
      return { posts, allTooOld: tooOld.length > 5 && posts.length === 0 };
    }

    async function expandAll() {
      const VOIR = ['voir plus','see more','lire la suite','voir la suite','afficher plus'];
      const btns = Array.from(document.querySelectorAll('[role="button"]')).filter(b => VOIR.some(k=>(b.innerText||b.textContent||'').trim().toLowerCase().includes(k)));
      if (!btns.length) return;
      await Promise.all(btns.map(btn => new Promise(resolve => {
        const c = btn.closest('[data-pagelet]')||btn.closest('div[role="feed"]>div')||btn.closest('[role="article"]')||btn.parentElement?.parentElement?.parentElement;
        if (!c) { try{btn.click();}catch(_){} return resolve(); }
        const avant = c.innerText?.length||0; let done=false;
        const fin = () => { if(!done){done=true;obs.disconnect();resolve();} };
        const obs = new MutationObserver(()=>{ if((c.innerText?.length||0)>avant+30) fin(); });
        obs.observe(c,{childList:true,subtree:true,characterData:true}); setTimeout(fin,4000);
        try{btn.click();}catch(_){}
      })));
      await new Promise(r=>setTimeout(r,400));
    }

    async function run(scrolls) {
      await expandAll();
      const { posts } = collectPosts();
      for (const post of posts) {
        let ia={};
        try { const r=await fetch(`${API}/api/annonces/extraire`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({texte_brut:post.texte})}); if(r.ok){const d=await r.json();ia=d.extraction||{};} } catch(_){}
        const fd=new FormData();
        fd.append('texte_brut',post.texte); fd.append('source',sourceName);
        if(nomGroupe) fd.append('groupe_source',nomGroupe);
        if(post.lien) fd.append('lien_original',post.lien);
        if(post.auteur) fd.append('auteur_nom',post.auteur);
        if(ia.type_bien) fd.append('type_bien',ia.type_bien);
        if(ia.transaction) fd.append('transaction',ia.transaction);
        if(ia.commune) fd.append('commune',ia.commune);
        if(ia.quartier) fd.append('quartier',ia.quartier);
        if(ia.prix) fd.append('prix',String(ia.prix));
        if(ia.superficie) fd.append('superficie',String(ia.superficie));
        if(ia.nb_pieces) fd.append('nb_pieces',String(ia.nb_pieces));
        if(ia.contact) fd.append('contact',ia.contact);
        if(ia.description) fd.append('description_ia',ia.description);
        let mc=0;
        for(const src of post.imgs.slice(0,10)){if(mc>=10)break;try{await new Promise(r=>setTimeout(r,300+Math.random()*400));const r=await fetch(src,{credentials:'include'});if(!r.ok)continue;const b=await r.blob();if(b.type.startsWith('image/')&&b.size>5000){fd.append('images',b,`img.${b.type.split('/')[1]||'jpg'}`);mc++;}}catch(_){}}
        try{const res=await fetch(`${API}/api/annonces`,{method:'POST',headers:{'Authorization':`Bearer ${token}`},body:fd});if(res.ok){totalSaved++;try{chrome.runtime.sendMessage({type:'IBIG_COUNT_UPDATE',count:totalSaved});}catch(_){}}}catch(_){}
        await new Promise(r=>setTimeout(r,500+Math.random()*1000));
      }
      if(scrolls<30){const steps=3+Math.floor(Math.random()*3);const ss=Math.floor(window.innerHeight*1.2/steps);for(let s=0;s<steps;s++){window.scrollBy({top:ss+Math.random()*80-40,behavior:'smooth'});await new Promise(r=>setTimeout(r,400+Math.random()*600));}await new Promise(r=>setTimeout(r,2000+Math.random()*3000));await run(scrolls+1);}
    }

    await run(0);
  } finally { window.__ibigProcessing=false; }
}
