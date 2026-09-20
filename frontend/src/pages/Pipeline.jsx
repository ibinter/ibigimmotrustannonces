import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { MessageSquare, ChevronRight } from 'lucide-react';

const COLS = [
  { key: 'a_contacter',     label: 'À contacter',     color: 'bg-gray-100'   },
  { key: 'contacte',        label: 'Contacté',         color: 'bg-blue-50'   },
  { key: 'en_negociation',  label: 'En négociation',   color: 'bg-yellow-50' },
  { key: 'conclu',          label: 'Conclu',           color: 'bg-green-50'  },
  { key: 'perdu',           label: 'Perdu',            color: 'bg-red-50'    },
];

function ScoreBadge({ score }) {
  const cls = score >= 70
    ? 'bg-green-100 text-green-700'
    : score >= 40
    ? 'bg-yellow-100 text-yellow-700'
    : 'bg-gray-100 text-gray-500';
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>
      {score}/100
    </span>
  );
}

function PipelineCard({ card, onMove, onNote }) {
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 text-sm">
      <div className="flex justify-between items-start mb-1">
        <span className="font-medium text-gray-800">{card.nom_client}</span>
        <ScoreBadge score={card.score} />
      </div>
      <p className="text-xs text-gray-500 capitalize">
        {card.type_bien} · {card.commune} {card.quartier ? `/ ${card.quartier}` : ''}
      </p>
      {card.prix && (
        <p className="text-xs text-brand-700 font-medium mt-0.5">
          {(card.prix/1_000_000).toFixed(1)} M FCFA
        </p>
      )}
      {card.contact_agent && (
        <p className="text-xs text-gray-400 mt-0.5">Agent : {card.contact_agent}</p>
      )}

      <div className="mt-2 flex justify-between items-center">
        <button onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <MessageSquare size={12} />
          {card.notes?.length || 0} note(s)
        </button>
        <select
          value={card.statut}
          onChange={e => onMove(card.id, e.target.value)}
          className="text-xs border border-gray-200 rounded px-1 py-0.5"
        >
          {COLS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>

      {open && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          {card.notes?.map((n, i) => (
            <p key={i} className="text-xs text-gray-500 mb-1">
              <span className="text-gray-300 mr-1">{new Date(n.date).toLocaleDateString('fr-FR')}</span>
              {n.note}
            </p>
          ))}
          <div className="flex gap-1 mt-1">
            <input value={note} onChange={e => setNote(e.target.value)}
              placeholder="Ajouter une note…"
              className="flex-1 text-xs border border-gray-200 rounded px-2 py-1" />
            <button
              disabled={!note.trim()}
              onClick={() => { onNote(card.id, note); setNote(''); }}
              className="text-xs bg-brand-600 text-white px-2 py-1 rounded disabled:opacity-40"
            >
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Pipeline() {
  const qc = useQueryClient();

  const { data: kanban = {}, isLoading } = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => axios.get('/api/pipeline').then(r => r.data),
  });

  const move = useMutation({
    mutationFn: ({ id, statut }) => axios.patch(`/api/pipeline/${id}`, { statut }),
    onSuccess: () => qc.invalidateQueries(['pipeline']),
  });

  const addNote = useMutation({
    mutationFn: ({ id, note }) => axios.post(`/api/pipeline/${id}/notes`, { note }),
    onSuccess: () => qc.invalidateQueries(['pipeline']),
  });

  if (isLoading) return <div className="p-6 text-sm text-gray-400">Chargement…</div>;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-5">Pipeline de démarchage</h1>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLS.map(col => (
          <div key={col.key} className="flex-shrink-0 w-60">
            <div className={`rounded-t-xl px-3 py-2 ${col.color}`}>
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                {col.label}
              </span>
              <span className="ml-2 text-xs text-gray-400">
                {kanban[col.key]?.length || 0}
              </span>
            </div>
            <div className={`rounded-b-xl min-h-[200px] p-2 space-y-2 ${col.color}`}>
              {(kanban[col.key] || []).map(card => (
                <PipelineCard
                  key={card.id}
                  card={card}
                  onMove={(id, statut) => move.mutate({ id, statut })}
                  onNote={(id, note) => addNote.mutate({ id, note })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
