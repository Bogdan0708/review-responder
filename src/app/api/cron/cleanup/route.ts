import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const RETENTION_DAYS = 90;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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
