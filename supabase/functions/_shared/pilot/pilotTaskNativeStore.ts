// No connection, credentials or runtime wiring. The approved host must provide
// one real, parameterized READ COMMITTED transaction; tests use disposable PG.
import { PilotRefusal } from "./pilotPolicy.ts";
import { recordIdColumn, RESOURCES, type Row } from "./pilotScopeStore.ts";
import type {
  NativeTaskScope,
  NativeTaskTransaction,
  PilotRegistrationDeps,
} from "./pilotTaskRegistration.ts";
export interface NativeQuery {
  query(text: string, values: readonly (string | number)[]): Promise<Row[]>;
}
export type NativeBegin = <T>(
  fn: (db: NativeQuery) => Promise<T>,
) => Promise<T>;
export function createPilotTaskTransaction(
  begin: NativeBegin,
): PilotRegistrationDeps["transaction"] {
  return async (claims, scope, fn) =>
    await begin(async (db) => {
      // Fixed local limits, never caller-controlled. Conflicts abort, no repairs.
      await db.query(
        "select set_config('lock_timeout','2s',true), set_config('statement_timeout','5s',true), set_config('idle_in_transaction_session_timeout','10s',true)",
        [],
      );
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify(claims),
      ]);
      const args = (s: NativeTaskScope): (string | number)[] => {
        if (
          s.workspace_id !== scope.workspace_id ||
          s.client_binding_id !== scope.client_binding_id ||
          s.version !== scope.version || s.task_id !== scope.task_id
        ) throw new PilotRefusal("task_scope_mismatch", 403);
        return [s.workspace_id, s.client_binding_id, s.version, s.task_id];
      };
      const workspace = (w: string) => {
        if (w !== scope.workspace_id) {
          throw new PilotRefusal("task_scope_mismatch", 403);
        }
      };
      const operation = async (
        name:
          | "lock_task_security"
          | "register_verified_task"
          | "cancel_verified_task"
          | "bind_prepared_task",
        s: NativeTaskScope,
        expected?: Row,
        payload?: Row,
      ) => {
        const params = args(s);
        if (expected) {
          params.push(JSON.stringify(expected));
        }
        if (payload) params.push(JSON.stringify(payload));
        const rows = await db.query(
          `select outpost_private.${name}($1::uuid,$2::uuid,$3::integer,$4::uuid${
            expected ? ",$5::text::jsonb" : ""
          }${payload ? ",$6::text::jsonb" : ""}) as result`,
          params,
        );
        if (rows.length !== 1) {
          throw new PilotRefusal("pilot_task_transaction_refused", 503);
        }
        return rows[0].result;
      };
      const tx: NativeTaskTransaction = {
        lock: async (s) => {
          const result = await operation("lock_task_security", s);
          if (
            !result || typeof result !== "object" || Array.isArray(result)
          ) throw new PilotRefusal("pilot_task_transaction_refused", 503);
          return result as Row;
        },
        register: async (s, row) => {
          const result = await operation("register_verified_task", s, row);
          if (
            result !== "registered" && result !== "replayed"
          ) throw new PilotRefusal("pilot_task_transaction_refused", 503);
          return result;
        },
        cancel: async (s, row) => {
          const result = await operation("cancel_verified_task", s, row);
          if (
            result !== "cancelled" && result !== "replayed"
          ) throw new PilotRefusal("pilot_task_transaction_refused", 503);
          return result;
        },
        store: {
          member: async (w, u) => {
            workspace(w);
            return (await db.query(
              "select workspace_id,user_id,role from public.workspace_members where workspace_id=$1::uuid and user_id=$2::uuid for share",
              [w, u],
            ))[0] ?? null;
          },
          brain: async (w) => {
            workspace(w);
            return (await db.query(
              "select workspace_id,profile,onboarding_completed,updated_at from public.company_brain where workspace_id=$1::uuid for share",
              [w],
            ))[0] ?? null;
          },
          records: async (w, k, ids) => {
            workspace(w);
            if (!Object.hasOwn(RESOURCES, k)) {
              throw new PilotRefusal("invalid_resource_set", 400);
            }
            // Relation/column names are compile-time registry entries, all external
            // values are bound parameters. No request-supplied SQL identifiers.
            const rows = await db.query(
              `select to_jsonb(r) as row from public.${
                RESOURCES[k]
              } r where r.workspace_id=$1::uuid and r.${
                recordIdColumn(k)
              } in (select value::uuid from jsonb_array_elements_text($2::text::jsonb)) for share`,
              [w, JSON.stringify(ids)],
            );
            return rows.map((r) => {
              if (
                !r.row || typeof r.row !== "object" || Array.isArray(r.row)
              ) throw new PilotRefusal("pilot_task_transaction_refused", 503);
              return r.row as Row;
            });
          },
          bind: async (task, payload) => {
            if (
              task.id !== scope.task_id ||
              task.workspace_id !== scope.workspace_id
            ) throw new PilotRefusal("task_scope_mismatch", 403);
            const result = await operation(
              "bind_prepared_task",
              scope,
              task,
              payload,
            );
            if (
              !result || typeof result !== "object" || Array.isArray(result)
            ) throw new PilotRefusal("pilot_task_transaction_refused", 503);
            return result as Row;
          },
        },
      };
      return await fn(tx);
    });
}
