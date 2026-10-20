import definitions from './kingdoms.json';
import type {ArtistProfile} from './artistProfile';

export const kingdomSlug=(value:string)=>value.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export function kingdomDirectory(artists:ArtistProfile[]){
  const counts=new Map<string,number>();
  for(const artist of artists){const name=artist.kingdom?.trim();if(name)counts.set(name,(counts.get(name)??0)+1);}
  const configured=new Set(definitions.map(d=>d.name));
  return [...definitions,...[...counts.keys()].filter(name=>!configured.has(name)).map(name=>({name,fullName:name}))]
    .map(d=>({name:d.name,fullName:d.fullName,isPrincipality:d.fullName.toLowerCase().includes('principality'),artistCount:counts.get(d.name)??0,href:`/kingdoms/${kingdomSlug(d.name)}/`,image:'image'in d&&typeof d.image==='string'?d.image:''}))
    .sort((a,b)=>a.name.localeCompare(b.name));
}
