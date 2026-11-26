import { readFileSync, writeFileSync } from "node:fs";
import { URL } from "node:url";


const source = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const schema = source.replace('provider = "sqlite"', 'provider = "postgresql"');
if (schema === source) throw new Error("The canonical Prisma schema must use the SQLite provider");
writeFileSync(new URL("../prisma/postgresql/schema.prisma", import.meta.url), schema);
