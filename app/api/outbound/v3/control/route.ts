import { getRuntimeControlPlane, runtimeUpdateSchema, updateRuntimeControlPlane } from "@/lib/outbound-control-plane";

export const runtime="nodejs";

export async function GET(){
  try{
    return Response.json({ok:true,...await getRuntimeControlPlane()});
  }catch(error){
    return Response.json(
      {ok:false,error:error instanceof Error?error.message:"Control plane status failed."},
      {status:503},
    );
  }
}

export async function PUT(request:Request){
  try{
    const input=runtimeUpdateSchema.parse(await request.json());
    const result=await updateRuntimeControlPlane(input);
    if(result.blocked)return Response.json(result,{status:409});
    if(result.conflict)return Response.json(result,{status:409});
    return Response.json(result);
  }catch(error){
    return Response.json(
      {ok:false,error:error instanceof Error?error.message:"Control plane update failed."},
      {status:400},
    );
  }
}
