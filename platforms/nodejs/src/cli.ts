#!/usr/bin/env node
import "named-logs-context";
import { createServer, type Env } from "purgatory-app";
import { serve } from "@hono/node-server";
import { RemoteLibSQL } from "remote-sql-libsql";
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { loadEnv } from "ldenv";

const __dirname = import.meta.dirname;

loadEnv({
  defaultEnvFile: path.join(__dirname, "../.env.default"),
});

type NodeJSEnv = Env & {
  DB: string;
};

async function main() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../package.json"), "utf-8"),
  );
  const program = new Command();

  program
    .name("purgatory-nodejs")
    .version(pkg.version)
    .usage(`purgatory-nodejs [--port 2000] [--rpc-url <url>]`)
    .description("run purgatory-nodejs as a node process")
    .option("-p, --port <port>", "port to listen on", "2000")
    .option("-r, --rpc-url <url>", "RPC URL for the Ethereum node to proxy to");

  program.parse(process.argv);

  type Options = {
    port?: string;
    rpcUrl?: string;
  };

  const options: Options = program.opts();
  const port = options.port ? parseInt(options.port) : 2000;

  // CLI arguments override environment variables
  const env: NodeJSEnv = {
    ...(process.env as NodeJSEnv),
    RPC_URL: options.rpcUrl || process.env.RPC_URL || "http://localhost:8545",
  };

  const db = env.DB;

  const client = createClient({
    url: db,
  });
  const remoteSQL = new RemoteLibSQL(client);

  const app = createServer<NodeJSEnv>({
    getDB: () => remoteSQL,
    getEnv: () => env,
  });

  if (db === ":memory:") {
    // console.log(`executing setup...`);
    // can fetch an admin route with the token if needed
  }

  serve({
    fetch: app.fetch,
    port,
  });

  console.log(`Server is running on http://localhost:${port}`);
  console.log(`RPC proxy configured to: ${env.RPC_URL || "(not configured)"}`);
  console.log(`Endpoints:`);
  console.log(`  - POST /rpc - JSON-RPC proxy endpoint`);
  console.log(`  - GET /health - Health check`);
  console.log(`  - GET /health/upstream - Upstream node health check`);
}
main();
