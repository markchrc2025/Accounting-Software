import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /**
     * Run test FILES one at a time.
     *
     * The integration suites all drive the same demo workspace in one database,
     * and several of them mutate state that is global to it:
     * `deferredModules.int.test.ts` flips the demo admin's role to assert the
     * 403s, and `dataAdminReset.int.test.ts` resets the workspace outright.
     * With vitest's default file-level parallelism those races are real — a
     * suite that needs the admin to be an admin can observe it demoted
     * mid-request and get a 403 instead of the status it asserted.
     *
     * Each file is internally sequential already, so this makes the whole run
     * deterministic. The cost is a few seconds; the alternative is a suite that
     * fails on unrelated changes.
     */
    fileParallelism: false,
  },
});
