# MCP Google Maps Walking — Guide d'installation

Serveur MCP qui calcule les **temps de trajet à pied** entre deux adresses via l'API Google Maps Directions.

---

## Installation

### 1. Prérequis

- **Node.js 18+** — vérifie avec `node --version`
- Une **clé API Google Maps** avec l'API *Directions* activée

### 2. Installer les dépendances

```bash
cd mcp-google-maps
npm install
```

### 3. Configurer Claude Desktop

Ouvre le fichier de config Claude Desktop :

- **macOS** : `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows** : `%APPDATA%\Claude\claude_desktop_config.json`

Ajoute (ou fusionne) ce bloc dans `mcpServers` :

```json
{
  "mcpServers": {
    "google-maps-walking": {
      "command": "node",
      "args": ["/CHEMIN/ABSOLU/VERS/mcp-google-maps/index.js"],
      "env": {
        "GOOGLE_MAPS_API_KEY": "AIzaSyBWy0O7nA15TpWFmp4CkqX3xQAUJT24aII"
      }
    }
  }
}
```

> ⚠️ Remplace `/CHEMIN/ABSOLU/VERS/` par le vrai chemin sur ton Mac.
> Exemple macOS : `/Users/lucas/Documents/mcp-google-maps/index.js`

### 4. Redémarre Claude Desktop

Quitte complètement l'app et relance-la.

---

## Outils disponibles

| Outil | Description |
|-------|-------------|
| `get_walking_directions` | Trajet complet avec durée, distance et étapes |
| `get_walking_duration_seconds` | Durée en secondes (idéal pour l'agenda) |
| `get_multiple_walking_durations` | Plusieurs trajets en une fois |

---

## Exemples d'utilisation dans Claude

```
Combien de temps à pied de "7 bis Rue du Louvre, 75001 Paris"
vers "15 Rue de la Paix, 75002 Paris" ?
```

```
Calcule les temps de trajet pour mes 3 séances de demain :
- De mon domicile (7 bis Rue du Louvre) au client 1 (20 Rue Montorgueil)
- Du client 1 au client 2 (5 Place des Vosges)
- Du client 2 à mon domicile
```

---

## Activation de l'API Google Maps (si pas encore fait)

1. Va sur [Google Cloud Console](https://console.cloud.google.com/)
2. Sélectionne ton projet
3. **APIs & Services → Bibliothèque**
4. Recherche **Directions API** → Active-la
5. Vérifie que ta clé n'a pas de restrictions bloquantes (ou autorise les IP/domaines nécessaires)
