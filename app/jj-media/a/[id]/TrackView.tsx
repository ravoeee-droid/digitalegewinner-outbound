"use client";

import { useEffect } from "react";

export default function TrackView({leadId}:{leadId:string}){
  useEffect(()=>{
    void fetch("/api/jj-media/track",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({leadId,type:"microsite_view"}),
      keepalive:true,
    }).catch(()=>undefined);
  },[leadId]);
  return null;
}
