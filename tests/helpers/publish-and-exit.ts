// Only launched by the disposable PostgreSQL suite. Exit inside the mock
// external adapter to simulate process death before local completion.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { createPrismaReviewStore } from "../../src/lib/reviews/prisma-store";
import { publishApproved } from "../../src/lib/reviews/approve";
async function main() {
  const [connectionString, schema, reviewId, responseId] =
    process.argv.slice(2);
  const url = new URL(connectionString);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname != "/review_integrity" ||
    !schema.startsWith("rr_integrity_")
  )
    throw new Error("Disposable test database required");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString }, { schema }),
  });
  await publishApproved({
    reviewId,
    responseId,
    store: createPrismaReviewStore(db),
    google: {
      async reply() {
        process.exit(23);
      },
    },
  });
  throw new Error("Expected simulated crash");
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
