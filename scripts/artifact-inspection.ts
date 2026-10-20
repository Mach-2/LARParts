export const inspectedPackages=['braces','node-forge','@netlify/dev','@netlify/functions-dev','ipx','listhen'] as const;
export function artifactPackageReferences(path:string,source:string):string[]{
  return inspectedPackages.filter(pkg=>{
    // Fixed package names have no regular-expression metacharacters. Metadata
    // dependency names alone are not evidence of executable imports/code.
    const reference=new RegExp(String.raw`(?:node_modules/${pkg}/|(?:from\s*|(?:require|import)\s*\(\s*)['"]${pkg}(?:/|['"]))`);
    return reference.test(path.replaceAll('\\','/'))||reference.test(source);
  });
}
