import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalReviews, pendingReviews, approvedToday, avgRating] =
      await Promise.all([
        prisma.review.count(),
        prisma.review.count({
          where: { status: { in: ["pending", "draft_ready"] } },
        }),
        prisma.auditLog.count({
          where: {
            action: { in: ["response_approved", "auto_approved"] },
            createdAt: { gte: today },
          },
        }),
        prisma.review.aggregate({ _avg: { rating: true } }),
      ]);

    const [sentimentCounts, platformCounts] = await Promise.all([
      prisma.review.groupBy({ by: ["sentiment"], _count: true }),
      prisma.review.groupBy({ by: ["platform"], _count: true }),
    ]);

    return NextResponse.json({
      totalReviews,
      pendingReviews,
      approvedToday,
      avgRating: avgRating._avg.rating
        ? Number(avgRating._avg.rating.toFixed(1))
        : 0,
      sentimentBreakdown: Object.fromEntries(
        sentimentCounts.map((s: { sentiment: string; _count: number }) => [
          s.sentiment,
          s._count,
        ])
      ),
      platformBreakdown: Object.fromEntries(
        platformCounts.map((p: { platform: string; _count: number }) => [
          p.platform,
          p._count,
        ])
      ),
    });
  } catch (err) {
    console.error("Error fetching stats:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
