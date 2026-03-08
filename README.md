# Military Simulation Framework

A large-scale modular military simulation framework built in Node.js with real-time graphical visualization and LLM-powered AI commanders.

## Features

### Multi-Domain Warfare

- **Land Warfare** — Infantry, Armor, Artillery, SAM sites, MLRS, Recon teams
- **Naval Warfare** — Destroyers, Aircraft Carriers, Submarines, Cruisers, Patrol Boats, Amphibious ships, Ballistic Missile Subs
- **Air Warfare** — Fighters, Bombers, Stealth Bombers, Helicopters, Combat Drones, AWACS, Transport aircraft
- **Nuclear Warfare** — Tactical nukes, Strategic warheads, ICBMs, SLBMs with launch authorization (DEFCON system), interception, fallout, and terrain destruction

### AI Commander System

- **Rule-based AI** with configurable personalities (aggressive, defensive, balanced, reckless)
- **LLM Integration** — Connect to any OpenAI-compatible API (OpenAI, Ollama, LM Studio) for strategic decision-making
- Automatic threat assessment, force ratio calculation, and escalation logic
- Nuclear launch authorization tied to DEFCON levels

### Graphical Interface

- **Real-time Canvas rendering** with pan/zoom and minimap
- **12 toggleable map layers:**
  - Terrain (procedurally generated biomes)
  - Elevation shading
  - Water bodies (deep/shallow)
  - Grid overlay
  - Unit positions with faction-specific shapes
  - Cities, military bases, resource points
  - Detection ranges
  - Weapon ranges
  - Nuclear radiation/fallout
  - In-flight missiles with trails
  - Combat effects (explosions, hits, nuclear blasts)
  - Unit labels
- Combat log with category filtering
- Force overview panel with real-time unit counts
- Unit inspection on click
- DEFCON status display
- Commander AI decision display

### Simulation Engine

- Event-driven architecture with pub/sub EventBus
- Configurable tick rate and time scaling
- Procedural terrain generation with value noise  
- Line-of-sight and cover-based combat resolution
- Area-of-effect damage for artillery, bombs, and nuclear weapons
- Entity movement, auto-targeting, and order queuing

## Quick Start

```bash
# Install dependencies
npm install

# Start the server (auto-initializes FullSpectrumWar scenario)
npm start

# Open browser
# Navigate to http://localhost:3000
# Click START to begin the simulation
```

## Running Headless (CLI only)

```bash
npm run sim
```

## LLM Commander Setup

To enable LLM-powered AI commanders, set environment variables:

```bash
# For Ollama (local)
export LLM_API_URL=http://localhost:11434/v1/chat/completions
export LLM_MODEL=llama3

# For OpenAI
export LLM_API_URL=https://api.openai.com/v1/chat/completions
export LLM_API_KEY=sk-...
export LLM_MODEL=gpt-4o-mini
```

Then start with LLM mode enabled in the scenario config.

## Architecture

```text
military-sim/
├── server.js                     # Express + WebSocket server
├── src/
│   ├── core/
│   │   ├── Engine.js             # Main simulation orchestrator
│   │   ├── Entity.js             # Base entity with movement/combat
│   │   ├── Terrain.js            # Procedural map generation
│   │   ├── Clock.js              # Simulation time management
│   │   └── EventBus.js           # Pub/sub event system
│   ├── modules/
│   │   ├── LandWarfare.js        # Ground forces module
│   │   ├── NavalWarfare.js       # Naval forces module
│   │   ├── AirWarfare.js         # Air forces module
│   │   └── NuclearWarfare.js     # Nuclear weapons module
│   ├── commander/
│   │   └── LLMCommander.js       # AI commander (rule-based + LLM)
│   ├── scenarios/
│   │   └── FullSpectrumWar.js    # Example multi-domain war scenario
│   └── utils/
│       └── Combat.js             # Combat resolution utilities
└── public/
    ├── index.html                # Command center UI
    ├── css/style.css             # Dark theme styling
    └── js/app.js                 # Client (WebSocket, Canvas renderer, UI)
```

## API Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /api/state` | Full simulation state |
| `GET /api/terrain` | Complete terrain data |
| `GET /api/events?filter=combat&limit=50` | Event history |
| `GET /api/factions` | Faction data |
| `GET /api/nuclear` | Nuclear status (DEFCON, in-flight missiles) |

## WebSocket Commands

```json
{ "action": "start" }
{ "action": "pause" }
{ "action": "resume" }
{ "action": "stop" }
{ "action": "reset" }
{ "action": "setTimeScale", "scale": 2 }
{ "action": "getTerrain" }
{ "action": "order", "event": "order:land:attack", "data": { "entityId": "...", "targetId": "..." } }
```
