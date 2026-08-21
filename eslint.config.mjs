import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/ui/PflegeLaunchOS.tsx", "app/ui/studio-v3/PflegeStudioV3.tsx", "app/ui/StudioNavPortal.tsx"],
    rules: {
      // These client controllers intentionally synchronize remote application state
      // after mount. The state changes happen in async effects/event handlers, not
      // during render, but React 19's conservative static rules flag the pattern.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
  {
    files: ["app/ui/studio-v3/PflegeStudioV3.tsx"],
    rules: {
      // Canvas elements share a stable `key` through the common JSX props object.
      // The Next rule cannot infer that spread key. The backlink is an intentional
      // full workspace navigation so Studio state cannot leak into the sales shell.
      "react/jsx-key": "off",
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
