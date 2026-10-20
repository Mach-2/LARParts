import type {Config,Context} from '@netlify/functions';
import {publicationEndpoint} from '../../src/server/publication-handler';
export default(request:Request,context:Context)=>publicationEndpoint(request,context.ip??'');
export const config:Config={path:['/api/verified-profile','/confirm-profile']};
