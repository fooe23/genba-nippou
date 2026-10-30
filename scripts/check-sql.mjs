// supabase/*.sql の構文を Postgres 本物のパーサ(libpg-query)でオフライン検査する。
// 構文のみ検査（plpgsql 関数本体の構文も検査）。存在しないオブジェクト参照などは検出できない。
// 引数でファイルを指定した場合はそのファイルだけを検査する。
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { loadModule, parseSync, parsePlPgSQLSync } from "libpg-query";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "supabase");
const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
        .map((f) => join(dir, f));

if (files.length === 0) {
  console.error("SQL files not found");
  process.exit(1);
}

await loadModule();
let failed = false;
for (const file of files) {
  try {
    const sql = readFileSync(file, "utf8");
    const bytes = Buffer.from(sql, "utf8");
    const result = parseSync(sql);
    let plpgsql = 0;
    for (const { stmt, stmt_location = 0, stmt_len } of result.stmts) {
      const fn = stmt.CreateFunctionStmt;
      if (!fn) continue;
      const lang = fn.options?.find((o) => o.DefElem?.defname === "language")?.DefElem?.arg?.String?.sval;
      if (lang !== "plpgsql") continue;
      const end = stmt_len ? stmt_location + stmt_len : bytes.length;
      parsePlPgSQLSync(bytes.subarray(stmt_location, end).toString("utf8"));
      plpgsql++;
    }
    console.log(`OK: ${basename(file)}: ${result.stmts.length} statements parsed, ${plpgsql} plpgsql function bodies checked`);
  } catch (e) {
    console.error(`SQL syntax error in ${basename(file)}: ${e instanceof Error ? e.message : String(e)}`);
    failed = true;
  }
}
if (failed) process.exit(1);
