import { z } from 'zod';
import { artistProfileSchema, type ArtistProfile } from '../data/artistProfile';
import type { PublicReadConfig } from './config';
import { publicPhotoUrl } from './asset-urls';

const rowSchema = z.object({
  id: z.string(), profile: z.record(z.string(), z.unknown()),
  photo_key: z.string().nullable(),
});
export function adaptArtistRow(value: unknown, config: Pick<PublicReadConfig,'R2_PUBLIC_BASE_URL'>): ArtistProfile {
  const row = rowSchema.parse(value);
  // Strict public schema rejects extra fields even if the DB contract drifts.
  return artistProfileSchema.parse({ ...row.profile, id: row.id,
    ...(row.photo_key ? { photoUrl: publicPhotoUrl(config, row.photo_key) } : {}),
  });
}
// Deliberately uses the restricted key, including on the server. No privileged fallback.
export async function readPublishedArtists(config: PublicReadConfig, fetcher: typeof fetch = fetch): Promise<ArtistProfile[]> {
  const result: ArtistProfile[] = [];
  const seen=new Set<string>();
  let cursor:string|undefined;const signal=AbortSignal.timeout(15000);
  for (;;) {
    const url = new URL('/rest/v1/artist_profiles', config.SUPABASE_URL);
    const query=new URLSearchParams({select:'id,profile,photo_key',status:'eq.published',order:'id.asc',limit:'500'});
    if(cursor)query.set('id',`gt.${cursor}`);url.search=query.toString();
    const response = await fetcher(url, { headers: { apikey: config.SUPABASE_PUBLISHABLE_KEY }, cache: 'no-store', signal });
    if (!response.ok) throw new Error('Published artist database unavailable');
    const rows = z.array(rowSchema).parse(await response.json());
    if(!rows.length)return result;
    const artists=rows.map(row=>adaptArtistRow(row,config));
    for(const artist of artists){if(seen.has(artist.id))throw new Error('Repeated artist database record');seen.add(artist.id);cursor=artist.id;result.push(artist);}
    // Continue to an empty page: project row caps can be smaller than our limit.
  }
}

export async function readPublishedArtist(config:PublicReadConfig,id:string,fetcher:typeof fetch=fetch):Promise<ArtistProfile|null>{
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))return null;
  const url=new URL('/rest/v1/artist_profiles',config.SUPABASE_URL);
  url.search=new URLSearchParams({select:'id,profile,photo_key',status:'eq.published',id:`eq.${id}`,limit:'1'}).toString();
  const response=await fetcher(url,{headers:{apikey:config.SUPABASE_PUBLISHABLE_KEY},cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Published artist database unavailable');
  const rows=z.array(rowSchema).max(1).parse(await response.json());
  if(!rows.length)return null;
  const artist=adaptArtistRow(rows[0],config);if(artist.id!==id)throw new Error('Unexpected artist record');return artist;
}
