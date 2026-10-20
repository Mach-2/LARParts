import type {ArtistProfile} from '../data/artistProfile';
import {kingdomDirectory,kingdomSlug} from '../data/kingdomDirectory';
import {loadPublicReadConfig,type PublicReadConfig} from './config';
import {readPublishedArtist,readPublishedArtists} from './artists';

export type PageFailure={ok:false;status:404|503};
type PageData<T>={ok:true;status:200;data:T}|PageFailure;
export interface PublicPageDependencies{config?:PublicReadConfig;env?:NodeJS.ProcessEnv;fetcher?:typeof fetch}
const config=(deps:PublicPageDependencies)=>deps.config??loadPublicReadConfig(deps.env);
export async function directoryPage(deps:PublicPageDependencies={}):Promise<PageData<ArtistProfile[]>>{
  try{return{ok:true,status:200,data:await readPublishedArtists(config(deps),deps.fetcher)};}
  catch{return{ok:false,status:503};}
}
export async function artistPage(id:string|undefined,deps:PublicPageDependencies={}):Promise<PageData<ArtistProfile>>{
  if(!id||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))return{ok:false,status:404};
  try{const artist=await readPublishedArtist(config(deps),id,deps.fetcher);return artist?{ok:true,status:200,data:artist}:{ok:false,status:404};}
  catch{return{ok:false,status:503};}
}
export async function kingdomPage(slug:string|undefined,deps:PublicPageDependencies={}):Promise<PageData<{kingdom:string;artists:ArtistProfile[]}>>{
  if(!slug||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return{ok:false,status:404};
  const directory=await directoryPage(deps);if(!directory.ok)return directory;
  const entry=kingdomDirectory(directory.data).find(k=>kingdomSlug(k.name)===slug);
  return entry?{ok:true,status:200,data:{kingdom:entry.name,artists:directory.data}}:{ok:false,status:404};
}
// Explicitly prevent browser, generic CDN and Netlify edge response caching,
// including errors/404s that could otherwise conceal a newly published record.
export function publicPageResponse(response:{status?:number;headers:Headers},status:number){
  response.status=status;
  for(const name of ['Cache-Control','CDN-Cache-Control','Netlify-CDN-Cache-Control'])response.headers.set(name,'no-store');
  if(status===503)response.headers.set('Retry-After','60');
}
