# Antigravity Prompt: ScreeningPilot Section 3 "The Ecosystem"

Use this prompt in Antigravity to generate a **production-ready React landing-page section** for ScreeningPilot. This prompt is for **Section 3 only**. Do not design the full page or adjacent section transitions.

## Prompt

Build a single premium landing-page section for ScreeningPilot called **"The Ecosystem"**. This is the most important visual section on the page. It must feel like a living AI operating system, not a static infographic.

The section concept is:

- a **500vh scroll-pinned experience**
- a **living orbital neural network**
- a central glowing node called **Pilot Brain**
- real AI and workflow tools orbiting around it like planets
- energy pulses constantly flowing from tool nodes into the center
- left-side narrative panels that change as the user scrolls

This must be generated as **production-ready React code**, with clear component structure, animation logic, responsive behavior, and implementation-oriented styling. Optimize for **desktop first**, then provide a simplified but polished mobile layout.

Match the existing ScreeningPilot landing-page visual language:

- dark canvas
- premium SaaS presentation
- mint-green system accent at the core
- cinematic glow
- glassmorphism where appropriate
- terminal-grade polish
- high-end product demo feel

This section should immediately read as:

**"The best AI tools orbit one company brain and work together as one coordinated workforce."**

Do not make it look like a random graph, generic particle background, crypto visual, or abstract data-art experiment.

## Technical Expectations

Generate the section as a React component suitable for a Vite + React + TypeScript landing page. Use an animation approach appropriate for:

- scroll pinning
- stage-based state changes
- orbital motion or subtle idle motion
- animated bezier or neural connection lines
- traveling particle pulses
- hover spotlight interactions

You may use a practical production-ready animation stack such as:

- Framer Motion for state transitions and hover interactions
- GSAP ScrollTrigger for scroll pinning and staged activation
- SVG for connection lines and pulse paths

Prefer robust, readable implementation over novelty. The output should feel implementable by an engineer without reinterpretation.

## Section Layout

Create a full-width section with:

- outer section height of **500vh**
- a **sticky viewport-height container**
- **left column** for copy panels
- **right/main visual area** for the orbital ecosystem

### Left Column Behavior

The left side contains one active narrative panel at a time. As the user scrolls through the 500vh section, the panel content changes by stage with smooth fades and vertical motion.

Each panel should include:

- stage label in small uppercase mono text
- section title
- short descriptive paragraph

Use these exact stage labels and titles:

1. `Stage 01 / 05`  
   Title: `The Pilot Brain`
2. `Stage 02 / 05`  
   Title: `Talent Comes Online`
3. `Stage 03 / 05`  
   Title: `Growth Activates`
4. `Stage 04 / 05`  
   Title: `Content Starts Publishing`
5. `Stage 05 / 05`  
   Title: `Maximum Orchestration`

Use concise, high-end product copy for each stage that explains what is happening in the network.

## Ecosystem Visual System

The right side is the core visual. It should feel like a **neural solar system**.

### Center Node

At the center is the **Pilot Brain**:

- circular or slightly layered central node
- mint-green dominant glow
- subtle pulsing rings
- premium glass or illuminated-core treatment
- label:
  - primary: `Pilot`
  - secondary: `BRAIN`

This center node remains alive during the full section, but is most isolated in Stage 1.

### Orbital Rings

Build three orbital rings around the Pilot Brain.

#### Inner Ring: Brain Tools

- `Claude` — reasoning and writing
- `Gemini` — screening and analysis
- `GPT-4` — specialized tasks

#### Middle Ring: Data Tools

- `Firecrawl` — web intelligence
- `Apify` — LinkedIn extraction

#### Outer Ring: Action Tools

- `Nano Banana` — image creation for the Content team
- `ElevenLabs` — voice generation
- `Instantly` — email sending
- `Notion` — documentation and operating memory
- `Linear` — task management
- `GitHub` — shipping and code execution

Space the nodes intentionally so the layout feels balanced and premium, not mathematically sterile.

## Real Logos and Brand Colors

Every tool node must show its **real brand logo** wherever possible. Prefer fetching logos with Clearbit where available. If a logo cannot be fetched, use a graceful fallback that still feels branded and polished.

Use strict brand-color glow behavior for each node:

- Claude: Anthropic orange
- Gemini: Google blue/red gradient family
- GPT-4: OpenAI green
- Firecrawl: flame orange-red
- Apify: bright green
- Nano Banana: vibrant yellow or branded image-creation tone
- ElevenLabs: near-black or refined monochrome with premium highlight
- Instantly: vivid blue-indigo
- Notion: black/white neutral
- Linear: violet-indigo
- GitHub: deep graphite

The Pilot Brain remains mint-green and should visually unify the system.

## Scroll Stages

The orbital diagram remains fixed while the scroll advances through 5 narrative activation stages.

### Stage 1

- all tool nodes mostly dark or dormant
- only Pilot Brain glows strongly
- minimal faint orbital scaffolding visible

### Stage 2

Talent tools illuminate:

- Claude
- Gemini
- Apify

These nodes should brighten with brand-colored glows. Draw animated connection lines from them toward the Pilot Brain.

### Stage 3

Growth tools illuminate:

- Firecrawl
- Instantly
- Claude

Use a cooler, growth-oriented energy treatment while preserving each tool's brand color.

### Stage 4

Content tools illuminate:

- Claude
- Nano Banana
- ElevenLabs

This stage should feel slightly more creative and expressive without breaking the darker system look.

### Stage 5

All tools become fully alive:

- all visible nodes active
- strongest overall glow
- all major connections visible
- energy pulses running throughout the system
- the platform feels fully operational

This final stage should feel powerful and coordinated, not chaotic.

## Connection Lines

Between active tools and the Pilot Brain, draw elegant animated connections:

- use bezier curves or neural-style connection paths
- lines should draw themselves in as stages activate
- active connections should have subtle motion or current flow
- inactive connections should remain faint or hidden

On full activation, the network should look like neurons firing inside a coordinated operating system.

## Energy Pulse System

Add a continuous data-flow effect:

- 4 to 6 small pulse particles visible at a time
- pulses connect to a line travel from active tool nodes toward the Pilot Brain
- pulse colors match the originating tool's brand color
- movement should feel smooth and alive
- do not let pulses become noisy or distracting

The section should feel alive even when the user pauses scrolling.

## Hover Behavior

On hover of any tool node:

- that tool scales up by about 20%
- all other tools dim to about 15% opacity
- the hovered tool's connection to the Pilot Brain becomes brighter and animated
- a spotlight effect isolates that tool in the ecosystem
- show a floating tooltip

The tooltip must include:

- tool name
- short description of what it does in the platform
- which agent uses it

Use this content model:

- `Claude` — `Reasoning and writing across the workforce` — used by `Scout, Penn, Quill`
- `Gemini` — `Screening and analysis for multimodal evaluation` — used by `Aria, Hawk`
- `GPT-4` — `Specialized tasks and cross-validation` — used by `Aria, Hawk`
- `Firecrawl` — `Web intelligence and signal enrichment` — used by `Scout, Penn, Hawk`
- `Apify` — `LinkedIn extraction at scale` — used by `Scout`
- `Nano Banana` — `On-brand visual creation for content workflows` — used by `Quill`
- `ElevenLabs` — `Voice generation and audio distribution` — used by `Quill`
- `Instantly` — `Email sending and follow-up execution` — used by `Penn`
- `Notion` — `Documentation and operating memory` — used by `Atlas`
- `Linear` — `Task routing and execution tracking` — used by `Atlas`
- `GitHub` — `Code shipping and technical execution` — used by `Builder agents`

Make the tooltip feel premium and legible, not like a default browser card.

## Motion and Performance

The section should feel sophisticated but controlled:

- subtle orbital drift or idle movement is welcome
- do not make the nodes spin continuously in a distracting way
- prioritize readability and visual hierarchy
- keep animation smooth and production-realistic
- avoid excessive particle count

Desktop should deliver the full cinematic version. On mobile:

- simplify orbital density if needed
- preserve the Pilot Brain concept
- preserve stage-based storytelling
- preserve tap or hover-equivalent access to tool descriptions

## Quality Bar

The final result must feel like:

- a premium AI operating system
- a product demo from a top-tier startup
- an intentional ecosystem of specialized tools working under one brain

It must not feel like:

- a generic network graph
- a dashboard screenshot
- a sci-fi wallpaper
- a dribbble-only concept with no implementation discipline

## Output Requirements

Return:

- the complete React component
- any helper data structure for tool metadata
- animation logic for the five scroll stages
- SVG or canvas logic for the connections and pulses
- responsive behavior decisions
- logo loading strategy with fallback handling
- styles needed for the premium dark aesthetic

The generated output must be implementation-oriented and ready for integration into a production marketing site.
