# LEADMISSION V2 WORKER — long-running Deno process.
#
# Built from the REPOSITORY ROOT, not from worker/:
#     docker build -f worker/Dockerfile -t agentory-lead-worker .
#
# The worker imports run-agent's handler and ~24 shared modules by relative
# path out of supabase/functions/, so the build context has to contain them.
# A context of worker/ alone compiles to nothing.

FROM denoland/deno:2.8.2

WORKDIR /app

# THE ONLY TWO TREES THE WORKER NEEDS. Copying the whole repo would drag the
# frontend, node_modules and the migrations into an image that runs none of them.
COPY worker/ ./worker/
COPY supabase/functions/ ./supabase/functions/

# Fetch and type-check every transitive dependency at BUILD time, so a bad
# import or a network-flaky registry fails the build instead of the first
# production start. `deno cache` also bakes the modules into the image, which is
# what lets the container run with no registry access at all.
RUN deno cache worker/main.ts

# Least privilege, and each flag is load-bearing:
#   --allow-env   Supabase + provider credentials, and the worker's own knobs
#   --allow-net   Supabase, Apify, Firecrawl, the model gateways
#   --allow-read  the relative module graph
# No --allow-write and no --allow-run: the worker persists through Supabase only.
CMD ["deno", "run", "--allow-env", "--allow-net", "--allow-read", "worker/main.ts"]
