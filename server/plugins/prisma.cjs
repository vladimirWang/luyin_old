const { PrismaClient } = require("@prisma/client");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");

const { DATABASE_URL } = process.env;

const globalForPrisma = globalThis;

function getDatabaseConfig() {
  // DATABASE_URL is the canonical connection setting for Prisma. In local
  // development MYSQL_HOST can still be set to the Docker-only host `mysql`,
  // so preferring the split MYSQL_* variables makes a host-run server time out.
  if (DATABASE_URL) return DATABASE_URL;

  const baseConfig = {
    connectionLimit: 10,
    connectTimeout: process.env.NODE_ENV === "prod" ? 30000 : 10000,
    allowPublicKeyRetrieval: true,
  };

  if (
    process.env.MYSQL_PASSWORD &&
    process.env.MYSQL_USER &&
    process.env.MYSQL_DATABASE &&
    process.env.MYSQL_HOST
  ) {
    return {
      ...baseConfig,
      host: process.env.MYSQL_HOST,
      port: parseInt(process.env.MYSQL_PORT || "3306"),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    };
  }

  throw new Error(
    "Database connection is not configured. Set DATABASE_URL or MYSQL_HOST/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE.",
  );
}

const adapter = new PrismaMariaDb(getDatabaseConfig());

function createPrismaClient() {
  const basePrisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error", "warn"],
  });
  return basePrisma;
}

const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "prod") {
  globalForPrisma.prisma = prisma;
}

module.exports = prisma;
