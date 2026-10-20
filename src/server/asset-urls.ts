// Public asset URL resolution has no SDK or privileged-credential dependency.
export function safeObjectKey(key:string):string{
  if(!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(key)||key.split('/').some(p=>p==='.'||p==='..'))throw new Error('Invalid object key');
  return key;
}
export function publicPhotoUrl(config:{R2_PUBLIC_BASE_URL:string},key:string):string{
  return `${config.R2_PUBLIC_BASE_URL.replace(/\/$/,'')}/${safeObjectKey(key)}`;
}
