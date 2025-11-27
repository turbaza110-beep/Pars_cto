const path = require("node:path");
const dotenv = require("dotenv");

const envPath = path.resolve(__dirname, ".env");
dotenv.config({ path: envPath });

const DEFAULT_DATABASE_URL = "postgresql://love_parser:love_parser@localhost:5432/love_parser";
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || DEFAULT_DATABASE_URL;

module.exports = {
  client: "pg",
  connection: connectionString,
  pool: {
    min: 0,
    max: 20,
    idleTimeoutMillis: 30000,
  },
  migrations: {
    tableName: "knex_migrations",
    directory: path.resolve(__dirname, "migrations"),
  },
};
