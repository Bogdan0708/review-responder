import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const platform = searchParams.get("platform");
    const sentiment = searchParams.get("sentiment");
    const page = parseInt(searchParams.get("page") ?? "1");
    const limit = parseInt(searchParams.get("limit") ?? "20");

    const where: Prisma.ReviewWhereInput = {};
    if (status && status !== "all") where.status = status;
    if (platform && platform !== "all") where.platform = platform;
    if (sentiment && sentiment !== "all") where.sentiment = sentiment;

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        include: { responses: { orderBy: { generatedAt: "desc" }, take: 1 } },
        orderBy: { ingestedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.review.count({ where }),
    ]);

    return NextResponse.json({
      reviews,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("Error fetching reviews:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
