const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXTRACTION_PROMPT = `Tu es un assistant spécialisé en immobilier à Abidjan, Côte d'Ivoire.
Extrait les informations structurées de l'annonce immobilière suivante.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ou après.

Champs à extraire :
- titre : titre commercial accrocheur de l'annonce (ex: "Villa 4 pièces à vendre à Cocody Angré", "Appartement meublé à louer à Marcory"). Doit être précis et informatif.
- type_bien : "villa" | "appartement" | "terrain" | "bureau" | "magasin" | "studio" | "duplex" | "autre"
- transaction : "vente" | "location" | "colocation" | "autre"
- commune : commune d'Abidjan (ex: "Cocody", "Yopougon", "Marcory", "Plateau"…) ou null
- quartier : quartier précis ou null
- prix : nombre entier en FCFA ou null (ex: 150000 pour 150 000 FCFA, 45000000 pour 45 millions)
- devise : "FCFA" par défaut
- superficie : nombre en m² ou null
- nb_pieces : nombre de pièces/chambres ou null
- contact : numéro de téléphone ou WhatsApp extrait, ou null
- description_ia : description complète et attractive en 2-4 phrases mettant en valeur les points forts du bien (emplacement, équipements, état, avantages)

Si une information n'est pas présente, mets null.`;

async function extraireAnnonce(texte_brut) {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `${EXTRACTION_PROMPT}\n\nANNONCE :\n${texte_brut}`,
      },
    ],
  });

  const raw = message.content[0].text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Réponse IA non parseable');
  return JSON.parse(jsonMatch[0]);
}

module.exports = { extraireAnnonce };
