import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { MapPin, DollarSign, Tag, AlertCircle } from 'lucide-react';
import clsx from 'clsx';

const BADGE = {
  forte:  'bg-green-100 text-green-700',
  moyenne:'bg-yellow-100 text-yellow-700',
};

function prix(p) {
  if (!p) return '—';
  return p >= 1_000_000
    ? `${(p / 1_000_000).toFixed(p % 1_000_000 ? 1 : 0)} M FCFA`
    : `${p.toLocaleString('fr-FR')} FCFA`;
}

export default function Dashboard() {
  const [filters, setFilters] = useState({ commune: '', type_bien: '', transaction: '', q: '' });

  const params = Object.fromEntries(Object.entries(filters).filter(([,v]) => v));
  const { data, isLoading } = useQuery({
    queryKey: ['annonces', params],
    queryFn: () => axios.get('/api/annonces', { params }).then(r => r.data),
  });
  const { data: recherches } = useQuery({
    queryKey: ['recherches'],
    queryFn: () => axios.get('/api/recherches').then(r => r.data),
  });

  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Annonces collectées</h1>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 mb-5">
        <input
          placeholder="Recherche libre…"
          value={filters.q}
          onChange={set('q')}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-52"
        />
        <input
          placeholder="Commune"
          value={filters.commune}
          onChange={set('commune')}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-36"
        />
        <select
          value={filters.type_bien}
          onChange={set('type_bien')}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">Tous les biens</option>
          {['villa','appartement','terrain','studio','bureau','magasin','duplex'].map(t =>
            <option key={t}>{t}</option>
          )}
        </select>
        <select
          value={filters.transaction}
          onChange={set('transaction')}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">Vente & Location</option>
          <option value="vente">Vente</option>
          <option value="location">Location</option>
        </select>
      </div>

      <div className="flex gap-6">
        {/* Liste annonces */}
        <div className="flex-1">
          {isLoading && <p className="text-gray-400 text-sm">Chargement…</p>}
          {data && (
            <p className="text-xs text-gray-400 mb-3">{data.total} annonce(s)</p>
          )}
          <div className="space-y-3">
            {(data?.annonces || []).map(a => (
              <div key={a.id} className="bg-white border border-gray-200 rounded-xl p-4 flex gap-4">
                {a.images?.[0] && (
                  <img src={a.images[0]} alt=""
                    className="w-20 h-16 object-cover rounded-lg flex-shrink-0 bg-gray-100" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-medium text-sm capitalize">
                        {a.type_bien || 'Bien'} — {a.transaction}
                      </span>
                      {a.nb_matchs > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs bg-brand-50 text-brand-700 rounded-full px-2 py-0.5">
                          <AlertCircle size={10} />
                          {a.nb_matchs} match(s)
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-brand-700 whitespace-nowrap">
                      {prix(a.prix)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <MapPin size={11} />
                      {[a.quartier, a.commune].filter(Boolean).join(', ') || '—'}
                    </span>
                    {a.superficie && <span>{a.superficie} m²</span>}
                    <span className="capitalize text-gray-400">{a.source}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Demandes clients */}
        <div className="w-72 flex-shrink-0">
          <h2 className="font-medium text-sm mb-3 text-gray-700">Demandes clients actives</h2>
          <div className="space-y-2">
            {(recherches || []).map(r => (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-sm">{r.nom_client}</span>
                  {r.matchs_forts > 0 && (
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', BADGE.forte)}>
                      {r.matchs_forts} fort
                    </span>
                  )}
                  {!r.matchs_forts && r.matchs_moyens > 0 && (
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', BADGE.moyenne)}>
                      {r.matchs_moyens}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {r.type_bien} · {prix(r.budget_max)} max · {(r.communes || []).join(', ')}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
