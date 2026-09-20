import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api';
import NotesPanel from '../components/NotesPanel';
import { exportClientPDF } from '../utils/exportPDF';
import {
  ArrowLeft, MapPin, Tag, DollarSign, Maximize2, Hash,
  Phone, ExternalLink, TrendingUp, Users, Pencil, Trash2, Check, X,
  User, MessageCircle, Link2, Home, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useState } from 'react';

const SCORE_COLOR = s =>
  s >= 70 ? 'bg-green-100 text-green-700' :
  s >= 40 ? 'bg-yellow-100 text-yellow-700' :
            'bg-gray-100 text-gray-500';

const FMT = n => n ? (n >= 1_000_000 ? `${(n/1_000_000).toFixed(n%1_000_000?1:0)} M FCFA` : Number(n).toLocaleString('fr-FR') + ' FCFA') : 'N/C';
const API_URL = import.meta.env.VITE_API_URL || '';
const imgUrl = src => { if (!src) return ''; if (typeof src === 'object') src = src.url || ''; if (src.startsWith('/')) return `${API_URL}${src}`; return src; };

export default function AnnonceDetail({ currentUser }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [imgIndex, setImgIndex] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ['annonce', id],
    queryFn: () => api.get(`/api/annonces/${id}`).then(r => r.data),
  });

  const update = useMutation({
    mutationFn: patch => api.patch(`/api/annonces/${id}`, patch).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries(['annonce', id]); setEditing(false); },
  });

  const archive = useMutation({
    mutationFn: () => api.delete(`/api/annonces/${id}`),
    onSuccess: () => navigate('/'),
  });

  if (isLoading) return <div className="p-8 text-sm text-gray-400">Chargement…</div>;
  if (error || !data) return <div className="p-8 text-sm text-red-500">Annonce introuvable.</div>;

  const a = data;
  const matchs = data.matchs || [];

  const imgs = (a.images || []).map(imgUrl).filter(Boolean);

  function startEdit() {
    setForm({
      titre:       a.titre || '',
      type_bien:   a.type_bien || '',
      transaction: a.transaction || '',
      commune:     a.commune || '',
      quartier:    a.quartier || '',
      prix:        a.prix || '',
      superficie:  a.superficie || '',
      nb_pieces:   a.nb_pieces || '',
      contact:     a.contact || '',
      description_ia: a.description_ia || '',
    });
    setEditing(true);
  }

  return (
    <div className="p-3 md:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg shrink-0">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold leading-snug">
            {a.titre || [a.type_bien, a.transaction, a.commune ? `à ${a.commune}` : null, a.quartier].filter(Boolean).join(' ') || 'Bien immobilier'}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Source : {a.source || 'N/C'} · Collecté le {a.date_collecte ? new Date(a.date_collecte).toLocaleDateString('fr-FR') : '?'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!editing && (
            <button onClick={startEdit} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">
              <Pencil size={12} /> Modifier
            </button>
          )}
          <button
            onClick={() => confirm('Archiver cette annonce ?') && archive.mutate()}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 rounded-lg text-xs text-red-500 hover:bg-red-50"
          >
            <Trash2 size={12} /> Archiver
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Colonne principale */}
        <div className="col-span-2 space-y-5">

          {/* Galerie images */}
          {imgs.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="relative bg-gray-900">
                <img src={imgs[imgIndex]} alt="" className="w-full h-64 object-cover"
                  onError={e => { e.target.style.display='none'; }} />
                {imgs.length > 1 && (
                  <>
                    <button onClick={() => setImgIndex(i => (i-1+imgs.length)%imgs.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-black/70">
                      <ChevronLeft size={16} />
                    </button>
                    <button onClick={() => setImgIndex(i => (i+1)%imgs.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-black/70">
                      <ChevronRight size={16} />
                    </button>
                    <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">
                      {imgIndex+1}/{imgs.length}
                    </div>
                  </>
                )}
              </div>
              {imgs.length > 1 && (
                <div className="flex gap-1.5 p-2 overflow-x-auto bg-gray-50">
                  {imgs.map((src,i) => (
                    <img key={i} src={src} alt="" onClick={() => setImgIndex(i)}
                      className={`h-12 w-16 object-cover rounded-lg flex-shrink-0 cursor-pointer border-2 transition-all ${i===imgIndex?'border-brand-500':'border-transparent opacity-60 hover:opacity-100'}`}
                      onError={e => { e.target.parentElement?.remove(); }} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Infos clés */}
          {editing && form ? (
            <div className="bg-white border border-brand-200 rounded-2xl p-5">
              <h2 className="text-sm font-semibold mb-4">Modifier les informations</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Titre de l'annonce</label>
                  <input value={form.titre} onChange={e => setForm(f=>({...f,titre:e.target.value}))}
                    placeholder="Ex: Villa 4 pièces à vendre à Cocody Angré"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['type_bien','Type de bien'],['transaction','Transaction'],
                    ['commune','Commune'],['quartier','Quartier'],
                    ['prix','Prix (FCFA)'],['superficie','Superficie (m²)'],
                    ['nb_pieces','Nbre de pièces'],['contact','Contact'],
                  ].map(([k, label]) => (
                    <div key={k}>
                      <label className="text-xs text-gray-500 block mb-1">{label}</label>
                      <input value={form[k]} onChange={e => setForm(f=>({...f,[k]:e.target.value}))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                    </div>
                  ))}
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500 block mb-1">Description</label>
                    <textarea value={form.description_ia} onChange={e => setForm(f=>({...f,description_ia:e.target.value}))}
                      rows={4} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => update.mutate(form)} disabled={update.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm disabled:opacity-40">
                  <Check size={13} /> Enregistrer
                </button>
                <button onClick={() => setEditing(false)} className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 rounded-lg text-sm">
                  <X size={13} /> Annuler
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
              {/* Prix */}
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-brand-700">{FMT(a.prix)}</span>
                {a.lien_original && (
                  <a href={a.lien_original} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-full hover:bg-blue-100 font-medium">
                    <ExternalLink size={11} /> Annonce originale
                  </a>
                )}
              </div>

              {/* Badges caractéristiques */}
              <div className="flex flex-wrap gap-2">
                {a.type_bien && <span className="flex items-center gap-1 text-xs bg-brand-50 text-brand-700 border border-brand-200 px-2.5 py-1 rounded-full capitalize font-medium"><Home size={10}/>{a.type_bien}</span>}
                {a.transaction && <span className="flex items-center gap-1 text-xs bg-orange-50 text-orange-700 border border-orange-200 px-2.5 py-1 rounded-full capitalize font-medium"><Tag size={10}/>{a.transaction}</span>}
                {a.commune && <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full font-medium"><MapPin size={10}/>{a.commune}{a.quartier?` · ${a.quartier}`:''}</span>}
                {a.superficie && <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full font-medium"><Maximize2 size={10}/>{a.superficie} m²</span>}
                {a.nb_pieces && <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full font-medium"><Hash size={10}/>{a.nb_pieces} pièce{a.nb_pieces>1?'s':''}</span>}
              </div>

              {/* Vendeur */}
              {(a.contact || a.auteur_nom) && (
                <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5"><User size={11}/> Vendeur / Propriétaire</p>
                  {a.auteur_nom && <p className="text-sm font-medium text-gray-800">{a.auteur_nom}</p>}
                  {a.groupe_source && <p className="text-xs text-gray-400">Groupe Facebook : {a.groupe_source}</p>}
                  {a.contact && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <a href={`tel:${a.contact}`} className="flex items-center gap-1.5 text-xs bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-full hover:bg-gray-100 font-medium">
                        <Phone size={11}/> {a.contact}
                      </a>
                      <a href={`https://wa.me/${a.contact.replace(/\D/g,'')}`} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1.5 text-xs bg-green-500 text-white px-3 py-1.5 rounded-full hover:bg-green-600 font-medium">
                        <MessageCircle size={11}/> WhatsApp
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Description */}
              {a.description_ia && (
                <div>
                  <p className="text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wide">Description</p>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{a.description_ia}</p>
                </div>
              )}

              {/* Texte brut */}
              {a.texte_brut && (
                <details className="border border-gray-100 rounded-xl">
                  <summary className="px-3 py-2 text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none">Texte brut original</summary>
                  <p className="px-3 pb-3 text-xs text-gray-500 whitespace-pre-wrap leading-relaxed">{a.texte_brut}</p>
                </details>
              )}
            </div>
          )}

          {/* Notes */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <NotesPanel refType="annonce" refId={id} currentUser={currentUser} />
          </div>
        </div>

        {/* Sidebar — clients matchés */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
              <Users size={14} /> Clients matchés ({matchs.length})
            </h3>
            {matchs.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">Aucun client correspondant</p>
            ) : (
              <div className="space-y-2">
                {matchs.map(m => (
                  <div key={m.id} className="flex items-center gap-2 p-2 rounded-xl hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{m.nom_client}</p>
                      <p className="text-xs text-gray-400">{m.telephone || '—'}</p>
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${SCORE_COLOR(m.score)}`}>
                      {m.score}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stats rapides */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
              <TrendingUp size={14} /> Stats
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Matchs forts</span>
                <span className="font-semibold text-green-600">
                  {matchs.filter(m => m.score >= 70).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Matchs moyens</span>
                <span className="font-semibold text-yellow-600">
                  {matchs.filter(m => m.score >= 40 && m.score < 70).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Score max</span>
                <span className="font-semibold">
                  {matchs.length ? Math.max(...matchs.map(m => m.score)) : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <Icon size={13} className="text-gray-400 mt-0.5 shrink-0" />
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="font-medium text-gray-800">{value}</p>
      </div>
    </div>
  );
}
