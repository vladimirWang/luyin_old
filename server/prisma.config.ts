import { defineConfig, env } from "prisma/config";

const datasourceUrl = env("DATABASE_URL");
const shadowDatabaseName = String(process.env.SHADOW_DATABASE_NAME || "").trim();

function shadowDatabaseUrl(databaseUrl: string, databaseName: string) {
  if (!databaseName) return "";
  const url = new URL(databaseUrl);
  // Reuse only the local development credentials while keeping the shadow schema isolated.
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: datasourceUrl,
    ...(shadowDatabaseName
      ? { shadowDatabaseUrl: shadowDatabaseUrl(datasourceUrl, shadowDatabaseName) }
      : {}),
  },
});
