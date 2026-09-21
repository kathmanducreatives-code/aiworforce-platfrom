# Agent portrait system

The four specialist identities use cinematic WebP portraits with consistent charcoal clothing, natural skin detail, and a restrained emerald rim light. The original assets remain available. Pilot retains its existing artwork.

## Reuse

`src/components/agents/AgentPortrait.tsx` resolves canonical and legacy identities through the agent registry. Use `agentId`, optional `name`, `size`, and `shape` (`circle` or `squircle`). Custom agents can pass `src`; unavailable images fall back to an initial. Set `decorative` inside an already labelled control and `interactive={false}` when motion is inappropriate. `active` is a static selection treatment, not a claim of live agent activity.

## Interaction

Fine mouse pointers control a maximum four-degree tilt and a localized reflection. Pointer updates use requestAnimationFrame and CSS variables without React renders. Pending frames are cancelled on exit and unmount. A soft glass rim and keyboard-focus illumination complete the treatment. Touch does not track; reduced-motion disables tilt and transitions. There are no idle loops or additional animation dependencies.

## Coverage

Agents roster and profiles; workforce dashboard selectors; chat avatars and command bar; workflow avatars; agent dock previews and drawers; department workspace headers; Signals copilot; Content panel; landing-page agent portraits. Canonical registry assets also update consumers that render images directly.

## Assets and validation

Four 768px WebPs total approximately 206 KB. TypeScript and production build pass. Live Agents-page inspection confirmed all four assets loaded. The existing large-bundle build warning remains unrelated to this visual change. Motion accessibility is implemented through input and media-query guards; no full browser motion or assistive-technology test suite was run.
