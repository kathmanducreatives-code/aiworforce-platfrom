# Lyra 3D pilot: implementation and handoff

## Architecture found

Lyra is canonical in `src/config/agentRegistry.ts`; `scout` is her execution alias. The homepage renders `WorkforceAgentCard`, already connected to `AgentVisual`. `useAgentVisualStates` derives presentation from tasks, approvals, chat and plans. The older count-based workforce status is not used for animation. Three.js was already installed; React Three Fiber was not. The existing lazy renderer avoids a second rendering architecture.

## This change

Extended `AgentVisual.tsx` to acknowledge completion only after model readiness and stop rendering outside the actual viewport. Extended `GltfAgentRenderer.tsx` with cancellable, timed, bounded GLB downloads, embedded-resource validation, optional smile morphs, pointer-cancel cleanup and local performance diagnostics. Added `loadModel.ts` and loader regression tests. Extended the existing animation controller and registry; added a one-shot smile test. The homepage card and its callbacks were not edited.

## State and motion

Real fresh running task → working; active reply → thinking; pending attributed approval → awaiting/waiting; otherwise idle or existing setup-blocked state. Recent completed task → deduplicated one-shot nod and optional subtle smile, then the current truthful base state. Hover is an attention modifier, not a new source of business state. The controller supplies constrained damped eye/head gaze, small breathing posture, irregular natural blink, focused working gaze, and calm waiting posture. Unsupported expression channels do nothing.

## Asset blocker

No GLB exists. `/public/agents/lyra/lyra.glb` is the reserved disk path, served as `/agents/lyra/lyra.glb`. The registry intentionally remains null. The complete asset specification is in `public/agents/lyra/README.md`. Head/neck/eye/chest names, blink/smile morphs, materials and framing cannot be verified until the authored model is supplied. Atlas, Mira and Orion remain unregistered and untouched.

## Fallback and performance

The existing portrait remains immediately visible. Missing model, unsupported WebGL2, reduced motion, mobile/coarse input, low hardware capability, failed load/parse, context loss and sustained slow frames use the portrait. Models load lazily in view; tab inactivity pauses rendering. One isolated canvas is supported for Lyra. No model is loaded today, so model bytes, model load time, FPS and GPU cost are unavailable—not zero measurements. The renderer now emits `agent3d:performance` after 120 rendered frames with actual downloaded bytes, load milliseconds, approximate rendered FPS, CPU submission time, draw calls and triangles. GPU timing is explicitly null.

## Verification

TypeScript, focused lint and production build passed; build retains existing bundle-size warnings. State, animator, and loader tests cover real working-state mapping, waiting, completion, gaze constraints, reduced-motion/mobile capability policy, and missing/corrupt/oversized GLB rejection. Live homepage inspection confirmed a loaded Lyra portrait and no canvas. A real 3D hover, full model-failure browser path, animation quality and desktop performance still require a GLB. Browser navigation verification was inconclusive; card callbacks were preserved without edits. Replicate only after Lyra's actual rig and performance have passed visual acceptance.
