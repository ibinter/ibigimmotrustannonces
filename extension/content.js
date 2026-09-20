/* IBIG Immo Trust — content script Facebook (action humaine uniquement) */

const API = 'http://localhost:3000';
let quota = 0;
const QUOTA_MAX = 50;
const QUOTA_KEY = 'ibig_quota_' + new Date().toDateString();

function getQuota() {
  return parseInt(localStorage.getItem(QUOTA_KEY) || '0');
}
function incQuota() {
  const q = getQuota() + 1;
  localStorage.setItem(QUOTA_KEY, q);
  return q;
}

function extractPostData(postEl) {
  const texte = postEl.innerText.slice(0, 3000).trim();

  const lienEl = postEl.querySelector('a[href*="/posts/"], a[href*="/groups/"]');
  const lien   = lienEl ? lienEl.href : window.location.href;

  const auteurEl = postEl.querySelector('a[role="link"] strong, h2 a strong');
  const auteur   = auteurEl ? auteurEl.innerText.trim() : '';

  const dateEl = postEl.querySelector('abbr[data-utime], span[data-testid="story-subtitle"] a');
  const dateStr = dateEl ? (dateEl.getAttribute('data-utime')
    ? new Date(parseInt(dateEl.getAttribute('data-utime')) * 1000).toISOString()
    : dateEl.innerText) : '';

  const imgEls = postEl.querySelectorAll('img[src*="fbcdn"], img[src*="scontent"]');
  const images = [...imgEls]
    .map(img => img.src)
    .filter(src => !src.includes('emoji') && !src.includes('profile'))
    .slice(0, 10);

  const groupeEl = document.querySelector('h1[dir="auto"]');
  const groupe   = groupeEl ? groupeEl.innerText.trim() : document.title;

  return { texte, lien, auteur, dateStr, images, groupe };
}

function ajouterBouton(postEl) {
  if (postEl.querySelector('.ibig-btn')) return;

  const btn = document.createElement('button');
  btn.className = 'ibig-btn';
  btn.textContent = '📋 IBIG';
  btn.title = 'Extraire cette annonce — IBIG Immo Trust';

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const q = getQuota();
    if (q >= QUOTA_MAX) {
      alert(`Quota journalier atteint (${QUOTA_MAX} extractions/jour). Revenez demain.`);
      return;
    }

    btn.textContent = '⏳';
    btn.disabled = true;

    const data = extractPostData(postEl);

    try {
      const res = await fetch(`${API}/api/annonces/extraire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texte_brut: data.texte }),
      });
      const json = await res.json();

      const nouveau = incQuota();
      btn.textContent = '✅';
      btn.title = `Extrait (${nouveau}/${QUOTA_MAX} aujourd'hui)`;

      // Ouvrir le dashboard en pré-remplissant l'import
      const params = new URLSearchParams({
        texte: data.texte,
        lien: data.lien,
        source: 'facebook',
        groupe: data.groupe,
        auteur: data.auteur,
        ...Object.fromEntries(
          Object.entries(json.extraction || {}).filter(([,v]) => v != null)
        ),
      });
      chrome.storage.session.set({ pendingImport: { ...data, extraction: json.extraction } });
      window.open(`http://localhost:5173/import?${params}`, '_blank');

    } catch (err) {
      btn.textContent = '❌';
      btn.title = 'Erreur — dashboard démarré ?';
      setTimeout(() => { btn.textContent = '📋 IBIG'; btn.disabled = false; }, 3000);
    }
  });

  postEl.style.position = 'relative';
  postEl.appendChild(btn);
}

function scanPosts() {
  // Cibler les articles/posts Facebook (sélecteurs courants, à adapter si FB change son DOM)
  const posts = document.querySelectorAll(
    'div[data-pagelet^="FeedUnit"], div[role="article"]'
  );
  posts.forEach(ajouterBouton);
}

// Scan initial puis observer les nouveaux posts (scroll)
scanPosts();
const observer = new MutationObserver(() => scanPosts());
observer.observe(document.body, { childList: true, subtree: true });
