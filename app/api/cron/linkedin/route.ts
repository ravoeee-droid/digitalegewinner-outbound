import { query } from "@/lib/db";
import { ensureLinkedinSchema, linkedinConnection, publishLinkedinText, LinkedinPublishError, type LinkedinPost } from "@/lib/linkedin-content";

export const runtime = "nodejs";
export const maxDuration = 60;
function authorized(req: Request) {
  const secret=process.env.CRON_SECRET;
  return Boolean(secret && req.headers.get("authorization") === "Bearer " + secret);
}
async function run(request:Request) {
  if (!authorized(request)) return Response.json({error:"Unauthorized"},{status:401});
  // No network publishing until the app has an authorized, non-expired token.
  const linked=await linkedinConnection();
  if(!linked.connected || !linked.authorUrn) {
    return Response.json({ok:false,reason:"linkedin_not_connected_or_token_expired"},{status:503});
  }
  await ensureLinkedinSchema();
  // Unknown prior deliveries are intentionally NOT retried automatically:
  // a timeout may mean LinkedIn published the post even without an ID response.
  await query(
    "update dg_linkedin_posts set status='uncertain',error='Worker unterbrochen: auf LinkedIn manuell prüfen',updated_at=now() " +
    "where status='publishing' and updated_at<now()-interval '5 minutes'"
  );
  const posts=await query<LinkedinPost>(
    "with due as (select id from dg_linkedin_posts where status='scheduled' and scheduled_at<=now() " +
    "order by scheduled_at asc for update skip locked limit 5) " +
    "update dg_linkedin_posts p set status='publishing',attempts=attempts+1,updated_at=now() " +
    "from due where p.id=due.id returning p.id,p.text,p.scheduled_at,p.status,p.attempts,p.post_urn,p.published_at,p.error,p.created_at"
  );
  const results: Array<{id:string;status:string}> = [];
  for(const p of posts) {
    try {
      const urn=await publishLinkedinText(p.text,linked.accessToken,linked.authorUrn);
      await query("update dg_linkedin_posts set status='published',post_urn=$2,published_at=now(),error=null,updated_at=now() where id=$1 and status='publishing'",[p.id,urn]);
      results.push({id:p.id,status:"published"});
    } catch (error) {
      // Transport failures or 429/5xx may have succeeded remotely; do not re-queue.
      const uncertain=!(error instanceof LinkedinPublishError) || error.uncertain;
      const status=uncertain?"uncertain":"failed";
      await query("update dg_linkedin_posts set status=$2,error=$3,updated_at=now() where id=$1 and status='publishing'",
        [p.id,status,error instanceof Error?error.message.slice(0,700):"Unbekannter Fehler"]);
      results.push({id:p.id,status});
    }
  }
  return Response.json({ok:true,processed:results.length,results});
}
export async function GET(request:Request){return run(request);}
export async function POST(request:Request){return run(request);}
