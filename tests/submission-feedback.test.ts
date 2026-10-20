import assert from 'node:assert/strict';
import test from 'node:test';
import {resendProfileConfirmation,type PendingSubmission} from '../src/client/verifiedSubmission';

test('browser shows safe cooldown and limit messages rather than the generic server error',async()=>{
  const original=globalThis.fetch;
  const submission={requestId:'synthetic',capability:'synthetic'} as PendingSubmission;
  try{
    for(const scenario of [
      {status:429,body:{code:'resend_cooldown',retryAfter:119},message:/five minutes.*2 minutes/},
      {status:409,body:{code:'resend_limit'},message:/all three resends/},
      {status:409,body:{code:'resend_unavailable'},message:/can no longer receive/},
      {status:429,body:{code:'hourly_email_limit',retryAfter:1800},message:/three confirmation requests per hour.*30 minutes/},
      {status:429,body:{code:'hourly_ip_limit',limit:5,retryAfter:60},message:/5 attempts.*1 minute\./},
      {status:429,body:{code:'unrecognized',error:'sensitive-provider-data'},message:/next hour begins/},
      {status:422,body:{error:'sensitive-provider-data'},message:/request could not finish/},
    ]){
      globalThis.fetch=async()=>Response.json(scenario.body,{status:scenario.status});
      await assert.rejects(resendProfileConfirmation(submission,'synthetic'),error=>{
        assert.ok(error instanceof Error);assert.match(error.message,scenario.message);assert.ok(!error.message.includes('sensitive-provider-data'));return true;
      });
    }
  }finally{globalThis.fetch=original;}
});
