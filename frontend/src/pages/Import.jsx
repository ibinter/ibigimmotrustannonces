import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import { Wand2, Upload, CheckCircle, AlertTriangle } from 'lucide-react';

const SOURCES = ['facebook', 'whatsapp'];
const TYPES   = ['villa','appartement','terrain','studio','bureau','magasin','duplex','autre'];
const TRANSACTIONS = ['vente','location','colocation','autre'];

export default function Import() {
  const [texte, setTexte]       = useState('');
  const [lien, setLien]         = useState('');
  const [source, setSource]     = useState('facebook');
  const [groupe, setGroupe]     = useState('');
  const [images, setImages]     = useState([]);
  const [extracted, setExtracted] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [saved, setSaved]       = useState(null);
  const [error, setError]       = useState('');

  const onDrop = useCallback(accepted => {
    setImages(prev => [...prev, ...accepted]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    maxSize: 10 * 1024 * 1024,
  });

  const extraire = async () => {
    if (!texte.trim()) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.post('/api/annonces/extraire', { texte_brut: texte });
      setExtracted(data.extraction);
    } catch (e) {
      setError(e.response?.data?.error || 'Erreur lors de l'extraction IA');
    } finally {
      setLoading(false);
    }
  };

  const enregistrer = async () => {
    if (!texte || !source) return;
    setLoading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('texte_brut', texte);
      fd.append('source', source);
      if (groupe) fd.append('groupe_source', groupe);
      if (lien)   fd.append('lien_original', lien);
      if (extracted) {
        Object.entries(extracted).forEach(([k, v]) => {
          if (v != null) fd.append(k, v);
        });
      }
      images.forEach(img => fd.append('images', img));
      const { data } = await axios.post('/api/annonces', fd);
      setSaved(data);
      setTexte(''); setLien(''); setImages([]); setExtracted(null);
    } catch (e) {
      if (e.response?.status === 409) {
        setError('Doublon détecté : une annonce similaire existe déjà.');
      } else {
        setError(e.response?.data?.error || 'Erreur lors de l'enregistrement');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold mb-5">Importer une annonce</h1>

      {saved && (
        <div className="mb-4 flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-green-700 text-sm">
          <CheckCircle size={16} />
          Annonce enregistrée — {saved.matchs?.length || 0} match(s) trouvé(s)
          <button className="ml-auto text-xs underline" onClick={() => setSaved(null)}>×</button>
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">
          <AlertTriangle size={16} />
          {error}
          <button className="ml-auto text-xs" onClick={() => setError('')}>×</button>
        </div>
      )}

      {/* Source */}
      <div className="flex gap-3 mb-4">
        {SOURCES.map(s => (
          <button key={s}
            onClick={() => setSource(s)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors
              ${source === s ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <input
          placeholder="Nom du groupe"
          value={groupe}
          onChange={e => setGroupe(e.target.value)}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
        />
      </div>

      {/* Texte */}
      <textarea
        rows={6}
        placeholder="Collez ici le texte de l'annonce (Facebook ou WhatsApp)…"
        value={texte}
        onChange={e => setTexte(e.target.value)}
        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none mb-3"
      />

      {/* Lien */}
      <input
        placeholder="Lien du post (optionnel)"
        value={lien}
        onChange={e => setLien(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mb-4"
      />

      {/* Images */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-6 text-center text-sm cursor-pointer mb-4 transition-colors
          ${isDragActive ? 'border-brand-500 bg-brand-50' : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}
      >
        <input {...getInputProps()} />
        <Upload size={20} className="mx-auto mb-2 opacity-50" />
        {images.length > 0
          ? `${images.length} image(s) sélectionnée(s)`
          : 'Glissez-déposez les photos de l\'annonce, ou cliquez'}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={extraire}
          disabled={!texte.trim() || loading}
          className="flex items-center gap-2 px-4 py-2 border border-brand-500 text-brand-600 rounded-lg text-sm font-medium hover:bg-brand-50 disabled:opacity-40"
        >
          <Wand2 size={15} />
          Structurer avec l'IA
        </button>
        <button
          onClick={enregistrer}
          disabled={!texte.trim() || loading}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-40"
        >
          {loading ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>

      {/* Aperçu extraction IA */}
      {extracted && (
        <div className="mt-5 bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-medium mb-3 text-gray-700">Données extraites par l'IA</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {Object.entries(extracted).map(([k, v]) => v != null && (
              <div key={k} className="flex gap-2">
                <span className="text-gray-400 capitalize min-w-[90px]">{k.replace('_', ' ')}</span>
                <span className="font-medium truncate">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
