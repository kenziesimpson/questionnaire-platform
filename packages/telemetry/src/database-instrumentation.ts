import type { InstrumentationNodeModuleDefinition } from "@opentelemetry/instrumentation";
import { PgInstrumentation, type PgInstrumentationConfig } from "@opentelemetry/instrumentation-pg";

export const DATABASE_INSTRUMENTATION_CONFIG = {
  enhancedDatabaseReporting: false,
  addSqlCommenterCommentToQueries: true,
} as const satisfies PgInstrumentationConfig;

export interface LoadedDatabaseDriver {
  readonly Client: object;
  readonly Pool: object;
}

interface PatchedModule {
  readonly definition: InstrumentationNodeModuleDefinition;
  readonly moduleExports: object;
}

export class DatabaseInstrumentation extends PgInstrumentation {
  private patchedModules: PatchedModule[] = [];

  constructor() {
    super(DATABASE_INSTRUMENTATION_CONFIG);
  }

  patchLoaded(driver: LoadedDatabaseDriver): void {
    const exportsByModule = new Map<string, object>([
      ["pg", driver],
      ["pg-pool", Object.getPrototypeOf(driver.Pool)],
    ]);
    for (const definition of this.init()) {
      const moduleExports = exportsByModule.get(definition.name);
      if (moduleExports === undefined) continue;
      definition.patch?.(moduleExports);
      this.patchedModules.push({ definition, moduleExports });
    }
  }

  override disable(): void {
    for (const { definition, moduleExports } of this.patchedModules.splice(0)) {
      definition.unpatch?.(moduleExports);
    }
    super.disable();
  }
}
