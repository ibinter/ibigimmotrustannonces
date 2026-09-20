import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Plus, X, Phone } from 'lucide-react';

function prix(p) {
  if (!p) return '—';
  return p >= 1_000_000 ? `${(p/1_000_000).toFixed(1)} M` : `${p.toLocaleString('fr-FR')}`;
}

const VIDE = {
  nom_client:'', telephone:'', email:'',
  type_bien:'', transaction:'vente',
  communes:[], quartiers:[],
  budget_min:'', budget_max:'',
  superficie_min:'', superficie_max:'',
  nb_pieces_min:'', nb_pieces_max:'',
  criteres_libres:'',
};

export default function Recherches() {
  const qc = useQueryClient();
  const [form, setForm] = useState(null);

  const { data: recherches = [] } = useQuery({
    queryKey: ['recherches'],
    queryFn: () => axios.get('/api/recherches').then(r => r.data),
  });

  const create = useMutation({
    mutationFn: data => axios.post('/api/recherches', data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries(['recherches']); setForm(null); },
  });

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-semibold">Demandes clients</h1>
        <button
          onClick={() => setForm(VIDE)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium"
        >
          <Plus size={15} /> Nouvelle demande
        </button>
      </div>

      {/* Formulaire */}
      {form && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-medium">Nouveau client</h2>
            <button onClick={() => setForm(null)}><X size={16} /></button>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <input placeholder="Nom du client *" value={form.nom_client} onChange={set('nom_client')}
              className="border border-gray-200 rounded-lg px-3 py-2 col-span-2" />
            <input placeholder="Téléphone" value={form.telephone} onChange={set('telephone')}
              className="border border-gray-200 rounded-lg px-3 py-2" />
            <input placeholder="Email" value={form.email} onChange={set('email')}
              className="border border-gray-200 rounded-lg px-3 py-2" />
            <select value={form.type_bien} onChange={set('type_bien')}
              className="border border-gray-200 rounded-lg px-3 py-2">
              <option value="">Type de bien</option>
              {['villa','appartement','terrain','studio','bureau','magasin','duplex'].map(t =>
                <option key={t}>{t}</option>)}
            </select>
            <select value={form.transaction} onChange={set('transaction')}
              className="border border-gray-200 rounded-lg px-3 py-2">
              {['vente','location','colocation'].map(t => <option key={t}>{t}</option>)}
            </select>
            <input placeholder="Budget min (FCFA)" value={form.budget_min} onChange={set('budget_min')}
              className="border border-gray-200 rounded-lg px-3 py-2" type="number" />
            <input placeholder="Budget max (FCFA)" value={form.budget_max} onChange={set('budget_max')}
              className="border border-gray-200 rounded-lg px-3 py-2" type="number" />
            <input placeholder="Communes (séparées par virgule)" value={form.communes.join(',')}
              onChange={e => setForm(f => ({ ...f, communes: e.target.value.split(',').map(s=>s.trim()).filter(Boolean) }))}
              className="border border-gray-200 rounded-lg px-3 py-2 col-span-2" />
            <textarea placeholder="Critères libres (étage, garage, piscine…)" value={form.criteres_libres}
              onChange={set('criteres_libres')} rows={2}
              className="border border-gray-200 rounded-lg px-3 py-2 col-span-2 resize-none" />
          </div>
          <button
            onClick={() => create.mutate({ ...form, communes: form.communes })}
            disabled={!form.nom_client || create.isPending}
            className="mt-4 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium disabled:opacity-40"
          >
            {create.isPending ? 'Enregistrement…' : 'Enregistrer la demande'}
          </button>
        </div>
      )}

      {/* Liste */}
      <div className="space-y-3">
        {recherches.map(r => (
          <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex justify-between items-start">
              <div>
                <span className="font-medium">{r.nom_client}</span>
                {r.telephone && (
                  <a href={`tel:${r.telephone}`} className="ml-3 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-brand-600">
                    <Phone size={11} />{r.telephone}
                  </a>
                )}
              </div>
              <div className="flex gap-2">
                {r.matchs_forts > 0 && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                    {r.matchs_forts} match(s) fort(s)
                  </span>
                )}
                {r.matchs_moyens > 0 && (
                  <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
                    {r.matchs_moyens} à vérifier
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {[r.type_bien, r.transaction].filter(Boolean).join(' · ')}
              {r.budget_max && ` · max ${prix(r.budget_max)} FCFA`}
              {r.communes?.length ? ` · ${r.communes.join(', ')}` : ''}
            </p>
          </div>
        ))}
        {!recherches.length && (
          <p className="text-sm text-gray-400">Aucune demande enregistrée.</p>
        )}
      </div>
    </div>
  );
}
