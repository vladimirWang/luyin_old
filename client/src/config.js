const isDevMode = import.meta.env.MODE === "development";
const isDebugBuild = import.meta.env.VITE_ENABLE_VCONSOLE === "true";
const showDebug = isDevMode || isDebugBuild;

export const appConfig = {
  isDevMode,
  isDebugBuild,
  showDebug,
  env: import.meta.env.MODE,
};

export default appConfig;
