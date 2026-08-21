import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/ui/PflegeLaunchOS.tsx"],
    rules: {
      // This client controller intentionally loads server state after mount and
      // creates IDs only inside user-triggered async handlers. Both patterns are
      // outside render, but React 19's conservative static rules flag them.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
