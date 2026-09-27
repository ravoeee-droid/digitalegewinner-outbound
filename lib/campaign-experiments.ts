export type VariantMetrics={
  variant:string;
  assigned:number;
  sent:number;
  replies:number;
  positiveReplies:number;
  appointments:number;
  bounces:number;
};

export type VariantDecision=VariantMetrics&{
  replyRate:number;
  positiveReplyRate:number;
  appointmentRate:number;
  bounceRate:number;
  wilsonLow:number;
  wilsonHigh:number;
  status:"insufficient_data"|"running"|"candidate";
};

function rate(num:number,den:number){return den>0?num/den:0}

function wilson(successes:number,total:number,z=1.96){
  if(total<=0)return {low:0,high:1};
  const p=successes/total;
  const z2=z*z;
  const denom=1+z2/total;
  const centre=(p+z2/(2*total))/denom;
  const margin=(z*Math.sqrt((p*(1-p)+z2/(4*total))/total))/denom;
  return {low:Math.max(0,centre-margin),high:Math.min(1,centre+margin)};
}

export function evaluateVariants(rows:VariantMetrics[]){
  const decisions:VariantDecision[]=rows.map((row)=>{
    const interval=wilson(row.positiveReplies||row.replies,row.sent);
    const enough=row.sent>=30;
    return {
      ...row,
      replyRate:rate(row.replies,row.sent),
      positiveReplyRate:rate(row.positiveReplies,row.sent),
      appointmentRate:rate(row.appointments,row.sent),
      bounceRate:rate(row.bounces,row.sent),
      wilsonLow:interval.low,
      wilsonHigh:interval.high,
      status:enough?"running":"insufficient_data",
    };
  });
  const eligible=decisions.filter(v=>v.sent>=30).sort((a,b)=>b.wilsonLow-a.wilsonLow);
  if(eligible.length>=2){
    const [best,runnerUp]=eligible;
    // Conservative candidate flag: lower confidence bound of the best must clear
    // the upper bound of the runner-up. Autopilot may later act on candidates,
    // but the foundation never pauses traffic merely on raw percentages.
    if(best.wilsonLow>runnerUp.wilsonHigh)best.status="candidate";
  }
  return decisions;
}
