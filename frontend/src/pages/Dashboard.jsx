import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api';
import {
  MapPin, AlertCircle, X, Edit2, Trash2, Save, Phone, MessageCircle,
  ChevronRight, Search, SlidersHorizontal, FileDown, ExternalLink,
  ChevronLeft, ArrowUpDown, Home, Building2, Layers, Calendar, RefreshCw,
  User, Users, Link2, Maximize2, Hash, Tag, DollarSign, ZoomIn,
} from 'lucide-react';
import clsx from 'clsx';
import { exportAnnoncesPDF } from '../utils/exportPDF';
import NotesPanel from '../components/NotesPanel';

// ── Helpers ──────────────────────────────────────────────────────────────────
const API_URL = import.meta.env.VITE_API_URL || '';
const imgUrl = src => {
  if (!src) return '';
  if (typeof src === 'object') src = src.url || src.url_locale || '';
  if (!src) return '';
  if (src.startsWith('/uploads/') || src.startsWith('/')) return `${API_URL}${src}`;
  return src;
};

function prix(p) {
  if (!p) return '—';
  return p >= 1_000_000
    ? `${(p / 1_000_000).toFixed(p % 1_000_000 ? 1 : 0)} M FCFA`
    : `${Number(p).toLocaleString('fr-FR')} FCFA`;
}

function dateRel(d) {
  if (!d) return null;
  const diff = Date.now() - new Date(d).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'À l\'instant';
  if (h < 24) return `Il y a ${h}h`;
  const j = Math.floor(h / 24);
  if (j < 7) return `Il y a ${j}j`;
  if (j < 30) return `Il y a ${Math.floor(j/7)} sem.`;
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

const BADGE_SCORE = { forte: 'bg-green-100 text-green-700', moyenne: 'bg-yellow-100 text-yellow-700' };
const TYPES = ['villa','appartement','terrain','studio','bureau','magasin','duplex','immeuble','autre'];
const TRANSACTIONS = ['vente','location','colocation'];
const SORT_OPTIONS = [
  { value: 'date_desc',       label: 'Plus récentes' },
  { value: 'date_asc',        label: 'Plus anciennes' },
  { value: 'prix_asc',        label: 'Prix croissant' },
  { value: 'prix_desc',       label: 'Prix décroissant' },
  { value: 'superficie_desc', label: 'Grande superficie' },
  { value: 'superficie_asc',  label: 'Petite superficie' },
];
const PAGE_SIZE = 20;

// ── Barre de score ─────────────────────────────────────────────────────────
function ScoreBar({ label, value, max }) {
  const pct = Math.round((value / max) * 100);
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-gray-300';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-400 w-24 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-gray-500 w-8 text-right">{value}/{max}</span>
    </div>
  );
}

// ── Panneau de détail d'une annonce ───────────────────────────────────────
function AnnonceDetail({ annonce, onClose }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [imgIndex, setImgIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const [form, setForm] = useState({
    titre: annonce.titre || '',
    type_bien: annonce.type_bien || '',
    transaction: annonce.transaction || '',
    commune: annonce.commune || '',
    quartier: annonce.quartier || '',
    prix: annonce.prix || '',
    superficie: annonce.superficie || '',
    nb_pieces: annonce.nb_pieces || '',
    contact: annonce.contact || '',
    description_ia: annonce.description_ia || '',
  });

  const { data } = useQuery({
    queryKey: ['annonce', annonce.id],
    queryFn: () => api.get(`/api/annonces/${annonce.id}`).then(r => r.data),
  });

  const update = useMutation({
    mutationFn: body => api.patch(`/api/annonces/${annonce.id}`, body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries(['annonces']);
      qc.invalidateQueries(['annonce', annonce.id]);
      setEditing(false);
    },
  });

  const archive = useMutation({
    mutationFn: () => api.delete(`/api/annonces/${annonce.id}`).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries(['annonces']); onClose(); },
  });

  const detail = data || annonce;
  const matchs = data?.matchs || [];
  const allMedia = (detail.images || []).map(imgUrl).filter(Boolean);
  const imgs = allMedia.filter(u => !u.match(/\.(mp4|mov|webm|avi|3gp|mpeg|ogv)(\?|$)/i));
  const videos = allMedia.filter(u => u.match(/\.(mp4|mov|webm|avi|3gp|mpeg|ogv)(\?|$)/i));
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const lancerRefetch = () => {
    const url = detail.lien_original;
    if (!url || !url.includes('facebook.com')) {
      alert('Pas de lien Facebook disponible pour cette annonce.');
      return;
    }
    setRefetching(true);
    const handler = evt => {
      if (!evt.data || evt.data.type !== 'IBIG_REFETCH_RESULT') return;
      if (evt.data.id !== detail.id) return;
      window.removeEventListener('message', handler);
      setRefetching(false);
      if (evt.data.ok) {
        qc.invalidateQueries(['annonces']);
        qc.invalidateQueries(['annonce', detail.id]);
      } else {
        alert(`Erreur refetch : ${evt.data.error || 'inconnue'}. Assurez-vous que l'extension IBIG est active.`);
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ type: 'IBIG_REFETCH', id: detail.id, url }, '*');
    // Timeout 30s
    setTimeout(() => {
      window.removeEventListener('message', handler);
      if (refetching) setRefetching(false);
    }, 30000);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-[560px] max-w-full bg-white shadow-2xl flex flex-col h-full">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            <h2 className="font-semibold text-gray-900 capitalize leading-snug">
              {detail.titre || [detail.type_bien, detail.transaction, detail.commune ? `à ${detail.commune}` : null, detail.quartier].filter(Boolean).join(' ') || 'Bien immobilier'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {[detail.quartier, detail.commune].filter(Boolean).join(', ')}
              {detail.source && ` · ${detail.source}`}
              {detail.date_collecte && ` · ${dateRel(detail.date_collecte)}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {detail.lien_original?.includes('facebook.com') && (
              <button onClick={lancerRefetch} disabled={refetching} title="Récupérer le contenu complet depuis Facebook"
                className={clsx('p-1.5 rounded-lg text-sm', refetching ? 'animate-spin text-blue-500' : 'hover:bg-blue-50 text-blue-400')}>
                <RefreshCw size={14} />
              </button>
            )}
            <button onClick={() => setEditing(e => !e)}
              className={clsx('p-1.5 rounded-lg text-sm', editing ? 'bg-brand-100 text-brand-700' : 'hover:bg-gray-100 text-gray-500')}>
              <Edit2 size={14} />
            </button>
            <button onClick={() => { if (confirm('Archiver ?')) archive.mutate(); }}
              className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg">
              <Trash2 size={14} />
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* Galerie images */}
          {imgs.length > 0 && (
            <div className="border-b border-gray-100">
              <div className="relative bg-gray-50">
                <img
                  src={imgs[imgIndex]}
                  alt=""
                  className="w-full h-52 object-cover"
                  onError={e => { e.target.style.display='none'; }}
                />
                {imgs.length > 1 && (
                  <>
                    <button onClick={() => setImgIndex(i => (i - 1 + imgs.length) % imgs.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-black/60">
                      <ChevronLeft size={16} />
                    </button>
                    <button onClick={() => setImgIndex(i => (i + 1) % imgs.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-black/60">
                      <ChevronRight size={16} />
                    </button>
                    <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">
                      {imgIndex + 1}/{imgs.length}
                    </div>
                  </>
                )}
              </div>
              {imgs.length > 1 && (
                <div className="flex gap-1.5 p-2 overflow-x-auto">
                  {imgs.map((src, i) => (
                    <img key={i} src={src} alt="" onClick={() => setImgIndex(i)}
                      className={clsx('h-12 w-16 object-cover rounded-lg flex-shrink-0 cursor-pointer border-2 transition-all',
                        i === imgIndex ? 'border-brand-500' : 'border-transparent opacity-70 hover:opacity-100')}
                      onError={e => { e.target.parentElement.remove(); }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Vidéos */}
          {videos.length > 0 && (
            <div className="border-b border-gray-100 px-4 py-3 space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Vidéos ({videos.length})</p>
              {videos.map((src, i) => (
                <video key={i} src={src} controls className="w-full rounded-xl max-h-64 bg-black"
                  preload="metadata" />
              ))}
            </div>
          )}

          {/* Prix + actions contact */}
          <div className="px-5 py-4 border-b border-gray-100 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold text-brand-700">{prix(detail.prix)}</span>
              {detail.lien_original && (
                <a href={detail.lien_original} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-full hover:bg-blue-100 font-medium">
                  <ExternalLink size={11} /> Annonce originale
                </a>
              )}
            </div>

            {/* Contact vendeur */}
            {(detail.contact || detail.auteur_nom) && (
              <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <User size={11} /> Vendeur / Propriétaire
                </p>
                {detail.auteur_nom && (
                  <p className="text-sm font-medium text-gray-800">{detail.auteur_nom}</p>
                )}
                {detail.groupe_source && (
                  <p className="text-xs text-gray-400 flex items-center gap-1">
                    <Users size={10} /> Groupe : {detail.groupe_source}
                  </p>
                )}
                {detail.contact && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={`tel:${detail.contact}`}
                      className="flex items-center gap-1.5 text-xs bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-full hover:bg-gray-100 font-medium">
                      <Phone size={11} /> {detail.contact}
                    </a>
                    <a href={`https://wa.me/${detail.contact.replace(/\D/g,'')}`}
                      target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 text-xs bg-green-500 text-white px-3 py-1.5 rounded-full hover:bg-green-600 font-medium">
                      <MessageCircle size={11} /> WhatsApp
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Caractéristiques */}
          <div className="px-5 py-4 border-b border-gray-100">
            {editing ? (
              <div className="space-y-3 text-sm">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Titre de l'annonce</label>
                  <input value={form.titre} onChange={set('titre')}
                    placeholder="Ex: Villa 4 pièces à vendre à Cocody Angré"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['type_bien', 'Type', TYPES, 'select'],
                    ['transaction', 'Transaction', TRANSACTIONS, 'select'],
                    ['commune', 'Commune', null, 'text'],
                    ['quartier', 'Quartier', null, 'text'],
                    ['prix', 'Prix (FCFA)', null, 'number'],
                    ['superficie', 'Superficie (m²)', null, 'number'],
                    ['nb_pieces', 'Nb pièces', null, 'number'],
                    ['contact', 'Contact', null, 'text'],
                  ].map(([k, lbl, opts, type]) => (
                    <div key={k}>
                      <label className="text-xs text-gray-400 mb-1 block">{lbl}</label>
                      {type === 'select'
                        ? <select value={form[k]} onChange={set(k)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                            {opts.map(o => <option key={o}>{o}</option>)}
                          </select>
                        : <input type={type} value={form[k]} onChange={set(k)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                      }
                    </div>
                  ))}
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Description</label>
                  <textarea value={form.description_ia} onChange={set('description_ia')}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none h-24" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => update.mutate(form)}
                    disabled={update.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50">
                    <Save size={13} /> Enregistrer
                  </button>
                  <button onClick={() => setEditing(false)}
                    className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Badges caractéristiques */}
                <div className="flex flex-wrap gap-2">
                  {detail.type_bien && (
                    <span className="flex items-center gap-1 text-xs bg-brand-50 text-brand-700 border border-brand-200 px-2.5 py-1 rounded-full capitalize font-medium">
                      <Home size={10} /> {detail.type_bien}
                    </span>
                  )}
                  {detail.transaction && (
                    <span className="flex items-center gap-1 text-xs bg-orange-50 text-orange-700 border border-orange-200 px-2.5 py-1 rounded-full capitalize font-medium">
                      <Tag size={10} /> {detail.transaction}
                    </span>
                  )}
                  {detail.commune && (
                    <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full font-medium">
                      <MapPin size={10} /> {detail.commune}{detail.quartier ? ` · ${detail.quartier}` : ''}
                    </span>
                  )}
                  {detail.superficie && (
                    <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full font-medium">
                      <Maximize2 size={10} /> {detail.superficie} m²
                    </span>
                  )}
                  {detail.nb_pieces && (
                    <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full font-medium">
                      <Hash size={10} /> {detail.nb_pieces} pièce{detail.nb_pieces > 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {/* Description */}
                {detail.description_ia && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wide">Description</p>
                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{detail.description_ia}</p>
                  </div>
                )}

                {/* Texte brut (rétractable) */}
                {detail.texte_brut && (
                  <details className="border border-gray-100 rounded-xl">
                    <summary className="px-3 py-2 text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none">
                      Texte brut de l'annonce
                    </summary>
                    <p className="px-3 pb-3 text-xs text-gray-500 whitespace-pre-line leading-relaxed">{detail.texte_brut}</p>
                  </details>
                )}

                {/* Lien source */}
                {detail.lien_original && (
                  <div className="flex items-center gap-2">
                    <Link2 size={11} className="text-gray-400 shrink-0" />
                    <a href={detail.lien_original} target="_blank" rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline truncate">
                      {detail.lien_original}
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="px-5 py-4 border-b border-gray-100">
            <NotesPanel annonceId={annonce.id} />
          </div>

          {/* Matchs clients */}
          {matchs.length > 0 && (
            <div className="px-5 py-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Clients intéressés — {matchs.length} match(s)
              </h3>
              <div className="space-y-3">
                {matchs.map(m => {
                  const d = typeof m.details === 'string' ? JSON.parse(m.details||'{}') : (m.details||{});
                  const scoreColor = m.score >= 70 ? 'text-green-700 border-green-200 bg-green-50'
                    : m.score >= 40 ? 'text-yellow-700 border-yellow-200 bg-yellow-50'
                    : 'text-gray-500 border-gray-200 bg-gray-50';
                  return (
                    <div key={m.id} className="bg-gray-50 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium text-sm">{m.nom_client}</span>
                          {m.telephone && (
                            <a href={`https://wa.me/${m.telephone.replace(/\D/g,'')}`}
                              target="_blank" rel="noreferrer"
                              className="ml-2 inline-flex items-center gap-1 text-xs text-green-700 hover:underline">
                              <MessageCircle size={10} /> {m.telephone}
                            </a>
                          )}
                        </div>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${scoreColor}`}>{m.score}/100</span>
                      </div>
                      {Object.keys(d).length > 0 && (
                        <div className="space-y-1">
                          <ScoreBar label="Localisation" value={d.localisation ?? 0} max={35} />
                          <ScoreBar label="Budget"       value={d.budget       ?? 0} max={30} />
                          <ScoreBar label="Type"         value={d.type_bien    ?? 0} max={20} />
                          <ScoreBar label="Superficie"   value={d.superficie   ?? 0} max={10} />
                          <ScoreBar label="Fraîcheur"    value={d.fraicheur    ?? 0} max={5}  />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page principale ──────────────────────────────────────────────────────────
export default function Dashboard() {
  const [filters, setFilters] = useState({
    commune: '', type_bien: '', transaction: '',
    q: '', budget_min: '', budget_max: '',
    source: '', sort: 'date_desc',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  const params = {
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v && v !== 'date_desc')),
    sort: filters.sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['annonces', params],
    queryFn: () => api.get('/api/annonces', { params }).then(r => r.data),
    keepPreviousData: true,
  });

  const qc = useQueryClient();
  const [reExtractState, setReExtractState] = useState(null);

  const reExtraire = async () => {
    setReExtractState('loading');
    try {
      const r = await api.post('/api/annonces/re-extraire?limit=50');
      setReExtractState(`✓ ${r.data.traites} annonces structurées`);
      qc.invalidateQueries(['annonces']);
      setTimeout(() => setReExtractState(null), 5000);
    } catch (e) {
      setReExtractState('Erreur');
      setTimeout(() => setReExtractState(null), 3000);
    }
  };

  const { data: recherches } = useQuery({
    queryKey: ['recherches'],
    queryFn: () => api.get('/api/recherches').then(r => r.data),
  });

  const set = useCallback(k => e => {
    setFilters(f => ({ ...f, [k]: e.target.value }));
    setPage(1);
  }, []);

  const resetFilters = () => {
    setFilters({ commune: '', type_bien: '', transaction: '', q: '', budget_min: '', budget_max: '', source: '', sort: 'date_desc' });
    setPage(1);
  };

  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const activeFilters = ['commune','type_bien','transaction','q','budget_min','budget_max','source'].filter(k => filters[k]).length;

  // Badges type de bien
  const typeBadge = t => {
    const m = { villa:'bg-orange-50 text-orange-700', appartement:'bg-blue-50 text-blue-700',
      terrain:'bg-green-50 text-green-700', studio:'bg-purple-50 text-purple-700',
      bureau:'bg-gray-100 text-gray-600', magasin:'bg-yellow-50 text-yellow-700' };
    return m[t] || 'bg-gray-100 text-gray-500';
  };
  const transactionBadge = t => t === 'vente' ? 'bg-red-50 text-red-600' : t === 'location' ? 'bg-teal-50 text-teal-600' : 'bg-gray-100 text-gray-500';

  return (
    <div className="p-4 md:p-6 max-w-screen-xl mx-auto">

      {/* Titre + actions */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Annonces collectées</h1>
          {!isLoading && <p className="text-xs text-gray-400 mt-0.5">{total} annonce(s) au total</p>}
        </div>
        <div className="flex items-center gap-2">
          {data?.annonces?.length > 0 && (
            <button onClick={() => exportAnnoncesPDF(data.annonces, filters)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">
              <FileDown size={14} /> PDF
            </button>
          )}
          <button
            onClick={reExtraire}
            disabled={reExtractState === 'loading'}
            title="Re-structurer les annonces vides via IA"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50">
            <RefreshCw size={14} className={reExtractState === 'loading' ? 'animate-spin' : ''} />
            {reExtractState === 'loading' ? 'IA en cours…' : reExtractState || 'Structurer IA'}
          </button>
          {/* Tri rapide */}
          <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-sm">
            <ArrowUpDown size={13} className="text-gray-400" />
            <select value={filters.sort} onChange={set('sort')}
              className="text-sm bg-transparent focus:outline-none text-gray-700">
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button onClick={() => setShowFilters(v => !v)}
            className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors',
              showFilters || activeFilters > 0
                ? 'bg-brand-50 border-brand-300 text-brand-700'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}>
            <SlidersHorizontal size={14} />
            Filtres {activeFilters > 0 && <span className="bg-brand-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{activeFilters}</span>}
          </button>
        </div>
      </div>

      {/* Barre de recherche */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input placeholder="Rechercher commune, quartier, contact, description…"
          value={filters.q} onChange={set('q')}
          className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-brand-400" />
      </div>

      {/* Filtres avancés */}
      {showFilters && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Commune</label>
            <input placeholder="Ex: Cocody" value={filters.commune} onChange={set('commune')}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Type de bien</label>
            <select value={filters.type_bien} onChange={set('type_bien')}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
              <option value="">Tous</option>
              {TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Transaction</label>
            <select value={filters.transaction} onChange={set('transaction')}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
              <option value="">Toutes</option>
              {TRANSACTIONS.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Budget min (FCFA)</label>
            <input placeholder="Ex: 5000000" type="number" value={filters.budget_min} onChange={set('budget_min')}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Budget max (FCFA)</label>
            <input placeholder="Ex: 50000000" type="number" value={filters.budget_max} onChange={set('budget_max')}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Source</label>
            <select value={filters.source} onChange={set('source')}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
              <option value="">Toutes</option>
              <option value="facebook">Facebook</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="terrain">Terrain</option>
            </select>
          </div>
          {activeFilters > 0 && (
            <div className="col-span-2 md:col-span-3 lg:col-span-6 flex items-center">
              <button onClick={resetFilters}
                className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                <X size={12} /> Réinitialiser les filtres
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-6">
        {/* Liste annonces */}
        <div className="flex-1 min-w-0">
          {isLoading && (
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="bg-white border border-gray-100 rounded-xl p-4 animate-pulse flex gap-4">
                  <div className="w-24 h-20 bg-gray-100 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-100 rounded w-1/3" />
                    <div className="h-3 bg-gray-100 rounded w-1/2" />
                    <div className="h-3 bg-gray-100 rounded w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && data?.annonces?.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <Home size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Aucune annonce ne correspond à ces critères.</p>
              {activeFilters > 0 && (
                <button onClick={resetFilters} className="mt-3 text-xs text-brand-500 hover:underline">
                  Effacer les filtres
                </button>
              )}
            </div>
          )}

          <div className="space-y-3">
            {(data?.annonces || []).map(a => {
              const firstImg = a.images?.[0] ? imgUrl(a.images[0]) : null;
              return (
                <div key={a.id} onClick={() => setSelected(a)}
                  className="bg-white border border-gray-200 rounded-xl overflow-hidden cursor-pointer hover:border-brand-300 hover:shadow-sm transition-all flex">

                  {/* Image */}
                  {firstImg ? (
                    <img src={firstImg} alt=""
                      className="w-28 h-24 object-cover shrink-0 bg-gray-100"
                      onError={e => { e.target.style.display='none'; }} />
                  ) : (
                    <div className="w-28 h-24 shrink-0 bg-gray-50 flex items-center justify-center">
                      <Building2 size={24} className="text-gray-200" />
                    </div>
                  )}

                  {/* Infos */}
                  <div className="flex-1 min-w-0 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {a.type_bien && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${typeBadge(a.type_bien)}`}>
                            {a.type_bien}
                          </span>
                        )}
                        {a.transaction && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${transactionBadge(a.transaction)}`}>
                            {a.transaction}
                          </span>
                        )}
                        {a.nb_matchs > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-brand-50 text-brand-700 rounded-full px-2 py-0.5">
                            <AlertCircle size={9} /> {a.nb_matchs} match
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-bold text-brand-700 whitespace-nowrap shrink-0">{prix(a.prix)}</span>
                    </div>

                    <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500 flex-wrap">
                      {(a.quartier || a.commune) && (
                        <span className="flex items-center gap-0.5">
                          <MapPin size={10} />
                          {[a.quartier, a.commune].filter(Boolean).join(', ')}
                        </span>
                      )}
                      {a.superficie && <span>{a.superficie} m²</span>}
                      {a.nb_pieces && <span>{a.nb_pieces} pièce(s)</span>}
                    </div>

                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        {a.images?.length > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Layers size={9} /> {a.images.length} photo(s)
                          </span>
                        )}
                        {a.source && <span className="capitalize">{a.source}</span>}
                      </div>
                      {a.date_collecte && (
                        <span className="flex items-center gap-0.5 text-xs text-gray-400">
                          <Calendar size={9} /> {dateRel(a.date_collecte)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronLeft size={14} /> Précédent
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                  let pg;
                  if (totalPages <= 7) pg = i + 1;
                  else if (page <= 4) pg = i + 1;
                  else if (page >= totalPages - 3) pg = totalPages - 6 + i;
                  else pg = page - 3 + i;
                  return (
                    <button key={pg} onClick={() => setPage(pg)}
                      className={clsx('w-8 h-8 rounded-lg text-sm font-medium transition-colors',
                        pg === page ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100')}>
                      {pg}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                Suivant <ChevronRight size={14} />
              </button>
            </div>
          )}

          {/* Info pagination */}
          {total > 0 && (
            <p className="text-xs text-gray-400 text-center mt-3">
              Affichage {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, total)} sur {total} annonce(s)
            </p>
          )}
        </div>

        {/* Demandes clients actives */}
        <div className="w-64 shrink-0 hidden lg:block">
          <h2 className="font-medium text-sm mb-3 text-gray-700">Demandes clients actives</h2>
          <div className="space-y-2">
            {(recherches || []).map(r => (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-sm truncate">{r.nom_client}</span>
                  {r.matchs_forts > 0 && (
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium shrink-0', BADGE_SCORE.forte)}>
                      {r.matchs_forts} fort
                    </span>
                  )}
                  {!r.matchs_forts && r.matchs_moyens > 0 && (
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium shrink-0', BADGE_SCORE.moyenne)}>
                      {r.matchs_moyens}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  {r.type_bien} · {prix(r.budget_max)} max
                </p>
                {(r.communes||[]).length > 0 && (
                  <p className="text-xs text-gray-400 truncate">{(r.communes||[]).join(', ')}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {selected && <AnnonceDetail annonce={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
