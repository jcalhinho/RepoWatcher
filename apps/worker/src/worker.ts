import { createDefaultCommandPolicy } from "@repo-watcher/core";

/**
 * Worker MVP placeholder:
 * - phase suivante: consommer une queue de runs
 * - appliquer boucle plan/act/observe
 * - persister steps et artefacts
 */
export async function bootstrapWorker(): Promise<void> {
  const policy = createDefaultCommandPolicy();
  const smokeCheck = policy.isAllowed(["npm", "test"]);
  if (!smokeCheck) {
    throw new Error("Default command policy must allow npm test");
  }
}

async function start() {
  await bootstrapWorker();
  // eslint-disable-next-line no-console
  console.log("Worker started (MVP scaffold).");
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
