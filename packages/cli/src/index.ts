import { program } from "./program.js";

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(
    `Unexpected error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
