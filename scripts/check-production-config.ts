import {loadPublicationConfig} from '../src/server/publication-config';
import {loadBackendConfig,BackendConfigurationError} from '../src/server/config';

// Read-only local shape/pin check. Never print values or claim cloud validation.
try{
  loadBackendConfig();
  const config=loadPublicationConfig();
  if(config.backend.APP_ENV!=='production')throw new Error();
  console.log(JSON.stringify({configurationValid:true,environment:'production',
    databaseUriPresent:!!process.env.PRODUCTION_DATABASE_URL,
    importConfirmationPresent:!!process.env.PRODUCTION_IMPORT_CONFIRM,
    turnstileSitePresent:!!process.env.TURNSTILE_SITE_KEY,
    turnstileSecretPresent:!!process.env.TURNSTILE_SECRET_KEY,
    submissionEnabled:process.env.VERIFIED_SUBMISSIONS_ENABLED==='true',
    imagesEnabled:process.env.IMAGE_INGESTION_ENABLED==='true',
    recoveryEnabled:process.env.PUBLICATION_JOBS_ENABLED==='true',
    cleanupEnabled:process.env.IMAGE_CLEANUP_ENABLED==='true',
    cloudResourcesVerified:false}));
}catch(error){
  if(error instanceof BackendConfigurationError)console.error(JSON.stringify({code:error.code,fields:error.fields}));
  const required=['SITE_URL','VERIFICATION_TOKEN_SECRET','EMAIL_PROVIDER_API_KEY','FROM_EMAIL','NOTIFICATION_EMAILS'];
  console.error(JSON.stringify({missingPublicationVariables:required.filter(name=>!process.env[name])}));
  console.error('Production publication configuration incomplete or mismatched; values withheld');
  process.exitCode=1;
}
