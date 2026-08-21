import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/ui/PflegeLaunchOS.tsx", "app/ui/PflegeSalesOS.tsx", "app/ui/studio-v3/PflegeStudioV3.tsx", "app/ui/StudioNavPortal.tsx"],
    rules: {
      // These client controllers intentionally synchronize remote application state
      // after mount. State changes happen in async effects/event handlers, not during render.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
