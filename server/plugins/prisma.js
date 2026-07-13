import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";


const { DATABASE_URL } = process.env;

const globalForPrisma = globalThis

function getDatabaseConfig() {
  const baseConfig = {
    connectionLimit: 10,
    connectTimeout:
      process.env.NODE_ENV === "prod" ? 30000 : 10000,
    // 解决 MySQL 8 caching_sha2_password 认证时 "RSA public key is not available" 错误
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
}

const adapter = new PrismaMariaDb(getDatabaseConfig());

function createPrismaClient() {
  const basePrisma = new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error", "warn"],
  });
  return basePrisma
  // // 使用 $extends 添加软删除过滤逻辑
  // return basePrisma.$extends({
  //   query: {
  //     $allModels: {
  //       async findMany({ args, query, model }) {
  //         // 检查模型是否有 deletedAt 字段
  //         // 只有 Vendor, Product, StockIn 有 deletedAt 字段
  //         const hasDeletedAt = [
  //           "Vendor",
  //           "Product",
  //           "StockIn",
  //           "StockOut",
  //           "User",
  //           "ProductJoinStockIn",
  //           "ProductJoinStockOut",
  //           "HistoryCost",
  //           "FileInfo",
  //           "Client",
  //           "Platform",
  //         ].includes(model);
  //         if (hasDeletedAt) {
  //           // 在查询之前修改 args
  //           if (!args.where) {
  //             args.where = {};
  //           }

  //           // 只有当 deletedAt 条件未设置时，才自动过滤已删除的记录
  //           if (!("deletedAt" in args.where)) {
  //             (args.where as any).deletedAt = null;
  //           }
  //         }

  //         // 执行查询
  //         const result = await query(args);
  //         return result;
  //       },
  //     },
  //   },
  // });
}

const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "prod") {
  globalForPrisma.prisma = prisma;
}

export default prisma;

// console.log(result.parsed, '---parsed');
// const prisma = new PrismaClient({
//   log: ["info", "error"],
//   datasources: {
//     db: {
//       url: DATABASE_URL,
//     },
//   },
// });

// prisma
//   .$connect()
//   // .then(() => {console.log('connected')})
//   .catch((err) => {
//     console.log("disconnected, because: ", err.message);
//   });
// export default prisma;
