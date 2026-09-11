import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const DEFAULT_SETTINGS = [
  {
    key: "brand_voice",
    value: {
      systemPrompt: `You are responding to reviews for Mitch from Transylvania, a Romanian street food restaurant. Use warm, friendly tone with a touch of Romanian hospitality. Be genuine, not corporate.

Guidelines:
- For 4-5 stars: Thank warmly, reference specific dish if mentioned, invite back
- For 3 stars: Thank, acknowledge concern, mention improvement commitment
- For 1-2 stars: Apologize sincerely, acknowledge issue, offer offline resolution
- Keep response 2-4 sentences
- Never be defensive
- Reference specific items they mentioned`,
      menuHighlights: [
        "sarmale",
        "mici",
        "covrigi",
        "papanași",
        "ciorbă de burtă",
        "plăcintă",
        "langos",
      ],
    },
  },
  {
    key: "auto_approve",
    value: { enabled: false },
  },
  {
    key: "llm_provider",
    value: {
      primary: "claude",
      fallback: "openai",
      local: "lm-studio",
    },
  },
  {
    key: "notifications",
    value: {
      onNewReview: true,
      onNegativeReview: true,
      onResponsePosted: true,
    },
  },
];

async function main() {
  console.log("Seeding database...");

  for (const setting of DEFAULT_SETTINGS) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: { key: setting.key, value: setting.value },
    });
    console.log(`  Setting: ${setting.key}`);
  }

  console.log("Seed complete.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
