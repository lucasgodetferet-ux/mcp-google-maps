#!/usr/bin/env node

/**
 * MCP Server — Google Maps Directions (Walking)
 * Mode : HTTP + SSE (compatible Railway / Claude Desktop remote)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import http from "http";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PORT = process.env.PORT || 3000;

if (!GOOGLE_MAPS_API_KEY) {
  console.error("❌ Erreur : la variable d'environnement GOOGLE_MAPS_API_KEY est manquante.");
  process.exit(1);
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
    key: GOOGLE_MAPS_API_KEY,
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

// ─── Serveur HTTP ──────────────────────────────────────────────────────────

// Map sessionId → SSEServerTransport (pour router les POST)
const transports = new Map();

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS — nécessaire pour Claude Desktop et les clients web
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Health check ──────────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", server: "google-maps-walking", version: "1.0.0" }));
    return;
  }

  // ── Connexion SSE : le client ouvre un canal d'écoute ────────────────────
  if (req.method === "GET" && url.pathname === "/sse") {
    console.log("[SSE] Nouvelle connexion client");

    const transport = new SSEServerTransport("/messages", res);
    const server = createMcpServer();

    transports.set(transport.sessionId, transport);

    res.on("close", () => {
      console.log(`[SSE] Connexion fermée : ${transport.sessionId}`);
      transports.delete(transport.sessionId);
    });

    await server.connect(transport);
    return;
  }

  // ── Messages entrants du client → on route vers le bon transport ──────────
  if (req.method === "POST" && url.pathname === "/messages") {
    const sessionId = url.searchParams.get("sessionId");
    const transport = transports.get(sessionId);

    if (!transport) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Session introuvable : ${sessionId}` }));
      return;
    }

    await transport.handlePostMessage(req, res);
    return;
  }

  // ── 404 pour tout le reste ────────────────────────────────────────────────
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Route inconnue", path: url.pathname }));
});

httpServer.listen(PORT, () => {
  console.log(`✅ Serveur MCP Google Maps Walking démarré sur le port ${PORT}`);
  console.log(`   SSE  : http://localhost:${PORT}/sse`);
  console.log(`   POST : http://localhost:${PORT}/messages?sessionId=<id>`);
  console.log(`   Health : http://localhost:${PORT}/health`);
});
