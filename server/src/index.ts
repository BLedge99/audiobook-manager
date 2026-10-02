import { buildApp } from "./app";

const PORT = parseInt(process.env.PORT || "3000", 10);

async function main() {
  const app = await buildApp({ logger: true });
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`[server] listening on 0.0.0.0:${PORT}`);
}

main().catch((err) => {
  console.error("[server] startup failed", err);
  process.exit(1);
});
