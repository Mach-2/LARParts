// Future submission-form adapter. Capabilities stay in memory, never in URLs or storage.
export interface PreparedImage {sessionId:string;capability:string;assetId:string;previewUrl:string;expiresIn:number}
const endpoint='/api/profile-image';
async function operation(body:unknown,capability?:string){
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',...(capability?{authorization:`Bearer ${capability}`}:{})},body:JSON.stringify(body),cache:'no-store',credentials:'same-origin'});
  if(!response.ok)throw new Error('The photo could not be prepared. Check the image and try again.');
  return response.json();
}
export async function prepareProfileImage(input:{file:File}|{url:string}|null,turnstileToken:string):Promise<PreparedImage|null>{
  if(!input){await operation({action:'start',mode:'none',turnstileToken});return null;}
  const upload='file' in input;
  if(upload && (input.file.size<1 || input.file.size>5*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(input.file.type)))throw new Error('Choose a JPEG, PNG or WebP up to 5 MB.');
  const start=await operation({action:'start',mode:upload?'upload':'remote',...(upload?{bytes:input.file.size,type:input.file.type}:{}),turnstileToken});
  if(upload){
    // Browser supplies signed Content-Length automatically from the File body.
    const response=await fetch(start.uploadUrl,{method:'PUT',headers:{'content-type':input.file.type},body:input.file,credentials:'omit',referrerPolicy:'no-referrer'});
    if(!response.ok)throw new Error('The photo upload failed. Try again.');
  }
  const result=await operation({action:'process',sessionId:start.sessionId,...(!upload?{sourceUrl:input.url}:{})},start.capability);
  return {...result,capability:start.capability};
}
export async function refreshProfileImagePreview(image:PreparedImage):Promise<PreparedImage>{
  return {...image,...await operation({action:'preview',sessionId:image.sessionId},image.capability)};
}
