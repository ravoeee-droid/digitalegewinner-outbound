import { z } from "zod";
import { analyzeTravelLead } from "@/lib/travel-intelligence";

export const runtime = "nodejs";
export const maxDuration = 45;

const manualSchema = z.object({
  instagramUrl:z.string().url().optional().or(z.literal("")),
  facebookUrl:z.string().url().optional().or(z.literal("")),
  tiktokUrl:z.string().url().optional().or(z.literal("")),
  youtubeUrl:z.string().url().optional().or(z.literal("")),
  pinterestUrl:z.string().url().optional().or(z.literal("")),
  linkedinUrl:z.string().url().optional().or(z.literal("")),
  instagramFollowers:z.number().int().min(0).max(100_000_000).optional(),
  instagramPosts90:z.number().int().min(0).max(10_000).optional(),
  instagramReels90:z.number().int().min(0).max(10_000).optional(),
  youtubeVideos:z.number().int().min(0).max(1_000_000).optional(),
  youtubeShorts:z.number().int().min(0).max(1_000_000).optional(),
  reviewCount:z.number().int().min(0).max(10_000_000).optional(),
  rating:z.number().min(0).max(5).optional(),
  lastPostDays:z.number().int().min(0).max(10_000).optional(),
}).partial().default({});

const schema = z.object({
  company:z.string().trim().min(2).max(200),
  website:z.string().trim().min(3).max(1000),
  city:z.string().trim().max(200).optional().default(""),
  manual:manualSchema,
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const intelligence = await analyzeTravelLead(input);
    return Response.json({ intelligence });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Travel Intelligence konnte nicht erstellt werden.";
    return Response.json({ error:message }, { status:400 });
  }
}
