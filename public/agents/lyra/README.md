# Lyra model handoff

The final model is not present. The homepage intentionally retains Lyra's portrait.

Supply `lyra.glb` here, served as `/agents/lyra/lyra.glb`. This must be an authored, licensed, rigged character preserving the blonde Lyra identity; do not substitute a portrait plane or an invented final character.

Deliver a self-contained glTF 2 GLB under 5 MiB, facing +Z with +Y up, in metres. Embed textures and buffers; use PBR materials. Meshopt compression is supported. Draco and KTX2 are not configured. Prefer ordinary embedded PNG/JPEG textures, limited material count, and an upper-body mesh.

Provide exact head, neck, chest, and eye bone names. Include left/right blink morph names, optionally smile morphs. Supply camera target, distance and FOV after checking head/upper-torso framing. Optional clips: idle, working, thinking, awaiting, and completion. Without clips, the controller supplies subtle breathing, blink, constrained gaze, posture and one-shot nods.

After asset inspection, register ONLY `AGENT_3D_REGISTRY.lyra.model` in `src/lib/agent3d/registry.ts` with its measured byte count, exact rig/morph names and framing. Leave every other agent null. No placeholder has been presented as final Lyra.

Verify the actual rig in-browser before rollout. Listen to `agent3d:performance` or the development console for measured bytes, load time, approximate rendered FPS, CPU submission time, draw calls and triangles. GPU timing is explicitly unavailable. Evaluate mobile/reduced-motion fallbacks and missing-file recovery, and test a real Lyra task completion before replicating this setup.
