import {tripDestination} from '@/lib/auth-destination';

/** Keep OAuth's redirect URL exact; carry only validated local paths in a short-lived cookie. */
export async function POST(request:Request) {
  const url=new URL(request.url);
  if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Invalid origin.'},{status:403});
  try {
    const text=await request.text();if(text.length>512)throw Error();
    const body=JSON.parse(text);
    const next=tripDestination(body?.next);
    if(body?.next!==null&&!next)throw Error();
    return Response.json({saved:true},{headers:{
      'Cache-Control':'private, no-store',
      'Set-Cookie':`tripsync-auth-next=${encodeURIComponent(next||'')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${next?600:0}${url.protocol==='https:'?'; Secure':''}`,
    }});
  }catch{return Response.json({error:'Invalid return destination.'},{status:400});}
}
