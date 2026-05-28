#!/usr/bin/env node

/**
 * MCP Server — Google Maps Directions (Walking)
 * Mode : Streamable HTTP (protocole MCP 2025-03-26, sans OAuth)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import http from "http";

const PORT = process.env.PORT || 3000;

// ─── Diagnostic de démarrage ───────────────────────────────────────────────
// Affiché dans les logs Railway pour diagnostiquer les variables d'env
console.log("─── Démarrage du serveur ───────────────────────────────");
console.log(`NODE_ENV            : ${process.env.NODE_ENV ?? "(non défini)"}`);
console.log(`PORT                : ${PORT}`);
console.log(`GOOGLE_MAPS_API_KEY : ${process.env.GOOGLE_MAPS_API_KEY ? "✅ présente (" + process.env.GOOGLE_MAPS_API_KEY.slice(0, 8) + "...)" : "❌ MANQUANTE"}`);
console.log("Variables d'env disponibles :", Object.keys(process.env).filter(k => !k.startsWith("npm_")).join(", "));
console.log("────────────────────────────────────────────────────────");

// La clé est lue à chaque appel (lazy) pour éviter tout problème de timing
// et produire un message d'erreur précis côté client plutôt qu'un crash serveur.
function getApiKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY est manquante côté serveur. " +
      "Vérifie le nom exact de la variable dans Railway (casse, espaces)."
    );
  }
  return key;
}

// ─── Outils disponibles ────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "get_walking_directions",
    description:
      "Calcule le temps de trajet à pied entre deux adresses via l'API Google Maps Directions. Retourne la durée, la distance et un résumé de l'itinéraire.",
    inputSchema: {
      type: "object",
      properties: {
        origin: {
          type: "string",
          description: "Adresse de départ (ex: '7 bis Rue du Louvre, 75001 Paris')",
        },
        destination: {
          type: "string",
          description: "Adresse d'arrivée (ex: '10 Rue de Rivoli, 75001 Paris')",
        },
      },
      required: ["origin", "destination"],
    },
  },
  {
    name: "get_walking_duration_seconds",
    description:
      "Retourne uniquement la durée en secondes du trajet à pied entre deux adresses. Utile pour les calculs d'agenda.",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Adresse de départ" },
        destination: { type: "string", description: "Adresse d'arrivée" },
      },
      required: ["origin", "destination"],
    },
  },
  {
    name: "get_multiple_walking_durations",
    description:
      "Calcule les temps de trajet à pied pour plusieurs paires d'adresses en une seule requête. Utile pour planifier une journée de coaching.",
    inputSchema: {
      type: "object",
      properties: {
        pairs: {
          type: "array",
          description: "Liste de paires origine/destination",
          items: {
            type: "object",
            properties: {
              origin: { type: "string", description: "Adresse de départ" },
              destination: { type: "string", description: "Adresse d'arrivée" },
              label: {
                type: "string",
                description: "Label optionnel (ex: 'Séance 1 → Séance 2')",
              },
            },
            required: ["origin", "destination"],
          },
        },
      },
      required: ["pairs"],
    },
  },
];

// ─── Appel à l'API Google Maps ─────────────────────────────────────────────

async function fetchDirections(origin, destination) {
  const params = new URLSearchParams({
    origin,
    destination,
    mode: "walking",
    language: "fr",
    key: getApiKey(),
  });

  const url = `https://maps.googleapis.com/maps/api/directions/json?${params}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Erreur HTTP ${response.status} lors de l'appel à l'API Google Maps`);
  }

  const data = await response.json();

  if (data.status !== "OK") {
    const messages = {
      NOT_FOUND: "Adresse introuvable. Vérifie l'orthographe.",
      ZERO_RESULTS: "Aucun itinéraire piéton trouvé entre ces deux adresses.",
      REQUEST_DENIED: "Clé API refusée. Vérifie que l'API Directions est activée sur Google Cloud.",
      OVER_DAILY_LIMIT: "Quota journalier dépassé.",
      INVALID_REQUEST: "Requête invalide (adresse vide ?).",
    };
    throw new Error(messages[data.status] || `Statut inattendu : ${data.status}`);
  }

  const leg = data.routes[0].legs[0];
  return {
    duration_text: leg.duration.text,
    duration_seconds: leg.duration.value,
    distance_text: leg.distance.text,
    distance_meters: leg.distance.value,
    start_address: leg.start_address,
    end_address: leg.end_address,
    steps_count: leg.steps.length,
    summary: data.routes[0].summary || "",
  };
}

// ─── Gestionnaires d'outils ────────────────────────────────────────────────

async function handleGetWalkingDirections({ origin, destination }) {
  const result = await fetchDirections(origin, destination);
  return {
    content: [
      {
        type: "text",
        text: [
          `🚶 Trajet à pied`,
          `📍 De : ${result.start_address}`,
          `📍 À  : ${result.end_address}`,
          ``,
          `⏱  Durée    : ${result.duration_text} (${result.duration_seconds}s)`,
          `📏 Distance : ${result.distance_text} (${result.distance_meters}m)`,
          result.summary ? `🗺  Via      : ${result.summary}` : "",
          `🔢 Étapes   : ${result.steps_count} étapes`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  };
}

async function handleGetWalkingDurationSeconds({ origin, destination }) {
  const result = await fetchDirections(origin, destination);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          origin: result.start_address,
          destination: result.end_address,
          duration_seconds: result.duration_seconds,
          duration_text: result.duration_text,
          distance_meters: result.distance_meters,
        }),
      },
    ],
  };
}

async function handleGetMultipleWalkingDurations({ pairs }) {
  const results = await Promise.allSettled(
    pairs.map(async ({ origin, destination, label }) => {
      const data = await fetchDirections(origin, destination);
      return { label: label || `${origin} → ${destination}`, ...data };
    })
  );

  const lines = ["🚶 Temps de trajet à pied (multi-trajets)", ""];

  results.forEach((result, i) => {
    const label = pairs[i].label || `Trajet ${i + 1}`;
    if (result.status === "fulfilled") {
      const d = result.value;
      lines.push(`✅ ${label}`);
      lines.push(`   ⏱ ${d.duration_text} · 📏 ${d.distance_text}`);
    } else {
      lines.push(`❌ ${label}`);
      lines.push(`   Erreur : ${result.reason.message}`);
    }
    lines.push("");
  });

  const successes = results.filter((r) => r.status === "fulfilled");
  if (successes.length > 0) {
    const totalSeconds = successes.reduce((sum, r) => sum + r.value.duration_seconds, 0);
    const totalMinutes = Math.round(totalSeconds / 60);
    lines.push(`📊 Total déplacements : ${totalMinutes} min (${successes.length}/${results.length} trajets)`);
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// ─── Fabrique de serveur MCP (une instance par connexion SSE) ──────────────

function createMcpServer() {
  const server = new Server(
    { name: "google-maps-walking", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case "get_walking_directions":
          return await handleGetWalkingDirections(args);
        case "get_walking_duration_seconds":
          return await handleGetWalkingDurationSeconds(args);
        case "get_multiple_walking_durations":
          return await handleGetMultipleWalkingDurations(args);
        default:
          throw new Error(`Outil inconnu : ${name}`);
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: `❌ Erreur : ${error.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ─── Serveur HTTP (Streamable HTTP — protocole MCP 2025-03-26) ────────────
//
// Un seul endpoint POST /mcp gère tout le protocole MCP.
// Pas d'OAuth, pas de session externe : chaque requête POST est autonome.
// Claude Desktop (>= 0.7) utilise ce protocole par défaut.

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS — pas de header WWW-Authenticate -> pas de déclenchement OAuth
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, Accept");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", server: "google-maps-walking", version: "1.0.0" }));
    return;
  }

  // Endpoint MCP principal — stateless, un transport par requête
  if (url.pathname === "/mcp") {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const server = createMcpServer();
      res.on("close", () => server.close().catch(() => {}));
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("[MCP] Erreur :", err.message);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Route inconnue", path: url.pathname }));
});

httpServer.listen(PORT, () => {
  console.log(`✅ Serveur MCP Google Maps Walking démarré sur le port ${PORT}`);
  console.log(`   MCP    : http://localhost:${PORT}/mcp`);
  console.log(`   Health : http://localhost:${PORT}/health`);
});
