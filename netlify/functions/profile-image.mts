import type { Config,Context } from '@netlify/functions';
import { imageEndpoint } from '../../src/server/image-handler';
export default (request:Request,context:Context)=>imageEndpoint(request,context.ip??'');
export const config:Config={path:'/api/profile-image'};
