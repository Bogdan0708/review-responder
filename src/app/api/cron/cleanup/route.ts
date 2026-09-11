import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { secretsMatch } from "@/lib/secrets";

const RETENTION_DAYS = 90;

export async function POST(request: NextRequest) {
  // The middleware exempts /api/cron, so this shared secret is the only thing
  // guarding the endpoint: an unset CRON_SECRET must fail closed, not open.
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 }
    );
  }

  if (!secretsMatch(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

    const result = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    return NextResponse.json({
      success: true,
      deleted: result.count,
      cutoffDate: cutoff.toISOString(),
    });
  } catch (err) {
    console.error("Cleanup cron failed:", err);
    return NextResponse.json(
      {
        error: "Cleanup failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
