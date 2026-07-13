import { defineConfig, env } from "prisma/config";

// const datasourceUrl = new URL(env("DATABASE_URL"));

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // url: datasourceUrl.toString(),
    url: env("DATABASE_URL")
  },
});
