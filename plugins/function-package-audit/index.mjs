import {auditFunctionPackages} from '../../scripts/function-package-audit.mjs';

export async function onPostBuild({constants,utils}){
  let report;
  try{
    report=await auditFunctionPackages(constants.FUNCTIONS_DIST,{linux:process.platform==='linux'});
  }catch{
    // Never attach raw archive/parser errors: entry names may contain private data.
    utils.build.failBuild('Function package inspection could not complete. Expected six final ZIP packages in FUNCTIONS_DIST. No package contents or private values were logged.');
    return;
  }
  console.log('Function package audit',JSON.stringify(report));
  if(!report.passed){utils.build.failBuild('Function package inspection failed. Review the fixed violation codes in the audit report.');return;}
  utils.status.show({title:'Function package audit passed',summary:`Inspected ${report.packages.length} function ZIPs; no checked private data or unwanted tooling found.`});
}
