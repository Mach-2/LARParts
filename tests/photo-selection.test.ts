import assert from 'node:assert/strict';
import test from 'node:test';
import {setupVerifiedSubmission} from '../src/client/verifiedSubmissionForm';
import type {PreparedImage} from '../src/client/profileImage';
import type {PendingSubmission} from '../src/client/verifiedSubmission';

function deferred<T>(){
  let resolve!:(value:T)=>void,reject!:(error:Error)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return{promise,resolve,reject};
}
class Control{
  value='';hidden=false;disabled=false;textContent='';src='';files=[new File(['photo'],'a.png',{type:'image/png'})];
  dataset:Record<string,string>={};
  listeners=new Map<string,(event:{preventDefault:()=>void})=>unknown>();
  addEventListener(name:string,listener:(event:{preventDefault:()=>void})=>unknown){this.listeners.set(name,listener);}
  dispatch(name:string){return this.listeners.get(name)?.({preventDefault(){}});}
  setAttribute(){}setCustomValidity(){}
  removeAttribute(name:string){if(name==='src')this.src='';}
}
const photo:PreparedImage={sessionId:'12345678-1234-4234-8234-123456789abc',capability:'a'.repeat(43),assetId:'asset',previewUrl:'https://private.example/preview',expiresIn:60};
function harness(overrides:Parameters<typeof setupVerifiedSubmission>[2]={}){
  const controls=new Map<string,Control>();
  const get=(selector:string)=>{let control=controls.get(selector);if(!control){control=new Control();controls.set(selector,control);}return control;};
  const form=Object.assign(new Control(),{querySelector:get,querySelectorAll:()=>[]});
  get('[data-photo-mode]').value='upload';
  const preparation=deferred<PreparedImage|null>(),refresh=deferred<PreparedImage>();
  const submissions:PendingSubmission[]=[],errors:string[]=[];
  setupVerifiedSubmission(form as unknown as HTMLFormElement,{
    validateForm:()=>true,showErrorSummary(){},
    makePayload:()=>({profile:{displayName:'Test Artist',kingdom:'Northern Lights',homePark:'Test Park',skills:['Sewing'],awards:[],contact:{}},submitterEmail:'test@example.invalid',consent:true,upgradeNotifications:false,companyWebsite:''}),
    setState:(state,_title,message)=>{if(state==='server-error')errors.push(message);},
  },{turnstileToken:async()=> 'synthetic',prepareProfileImage:()=>preparation.promise,refreshProfileImagePreview:()=>refresh.promise,
    submitVerifiedProfile:async value=>{submissions.push(value);return{};},...overrides});
  return{get,form,preparation,refresh,submissions,errors};
}

for(const change of ['none','file','url'] as const){
  test(`ignores completed preparation after changing photo to ${change}`,async()=>{
    const h=harness(),running=h.get('[data-prepare-photo]').dispatch('click');
    if(change==='none'){h.get('[data-photo-mode]').value='none';h.get('[data-photo-mode]').dispatch('change');}
    else if(change==='file'){h.get('[data-photo-upload]').files=[new File(['new'],'b.png',{type:'image/png'})];h.get('[data-photo-upload]').dispatch('change');}
    else {h.get('[data-photo-mode]').value='remote';h.get('[data-photo-mode]').dispatch('change');h.get('#photo-url').value='https://example.com/b.png';h.get('#photo-url').dispatch('input');}
    h.preparation.resolve(photo);await running;
    assert.equal(h.get('[data-photo-preview]').hidden,true);
    assert.equal(h.get('[data-photo-preview]').src,'');
    await h.form.dispatch('submit');
    if(change==='none'){assert.equal(h.submissions.length,1);assert.equal(h.submissions[0].image,null);}
    else {assert.equal(h.submissions.length,0);assert.match(h.errors[0],/Prepare and review/);}
  });
}
test('obsolete preparation failure does not replace the new selection status',async()=>{
  const h=harness(),running=h.get('[data-prepare-photo]').dispatch('click');
  h.get('[data-photo-mode]').value='none';h.get('[data-photo-mode]').dispatch('change');
  h.preparation.reject(new Error('Old request failed'));await running;
  assert.equal(h.get('[data-photo-status]').textContent,'A photo is optional.');
  assert.equal(h.get('[data-submit-button]').disabled,false);
});
for(const action of ['preview','submit'] as const){
  test(`ignores stale refresh during ${action} and allows the updated no-photo submission`,async()=>{
    const h=harness(),initial=h.get('[data-prepare-photo]').dispatch('click');h.preparation.resolve(photo);await initial;
    assert.equal(h.get('[data-photo-preview]').hidden,false);
    const running=action==='preview'?h.get('[data-prepare-photo]').dispatch('click'):h.form.dispatch('submit');
    h.get('[data-photo-mode]').value='none';h.get('[data-photo-mode]').dispatch('change');
    h.refresh.resolve({...photo,previewUrl:'https://private.example/refreshed'});await running;
    assert.equal(h.get('[data-photo-preview]').hidden,true);assert.equal(h.get('[data-photo-preview]').src,'');
    assert.equal(h.submissions.length,0);
    await h.form.dispatch('submit');assert.equal(h.submissions.length,1);assert.equal(h.submissions[0].image,null);
  });
}
test('unchanged prepared selection is previewed and submitted',async()=>{
  const h=harness(),initial=h.get('[data-prepare-photo]').dispatch('click');h.preparation.resolve(photo);await initial;
  assert.equal(h.get('[data-photo-preview]').src,photo.previewUrl);
  const running=h.form.dispatch('submit');h.refresh.resolve(photo);await running;
  assert.equal(h.submissions.length,1);assert.equal(h.submissions[0].image?.sessionId,photo.sessionId);
});

test('no-photo failure hides confirmation controls; successful retry reuses the same request',async()=>{
  const requests:PendingSubmission[]=[];let managementCalls=0;
  const h=harness({submitVerifiedProfile:async value=>{requests.push(value);if(requests.length===1)throw new Error('Rejected');return{};},
    resendProfileConfirmation:async()=>{managementCalls++;return{};},getSubmissionStatus:async()=>{managementCalls++;return{state:'pending'};}});
  h.get('[data-photo-mode]').value='none';h.get('[data-photo-mode]').dispatch('change');
  await h.form.dispatch('submit');
  assert.equal(h.get('[data-confirmation-actions]').hidden,true);
  assert.equal(h.get('[data-submit-button]').hidden,false);
  assert.equal(h.get('[data-submit-button]').disabled,false);
  await h.get('[data-resend-confirmation]').dispatch('click');await h.get('[data-check-publication]').dispatch('click');
  assert.equal(managementCalls,0);
  await h.form.dispatch('submit');assert.equal(requests.length,2);assert.strictEqual(requests[0],requests[1]);assert.equal(requests[0].image,null);
  assert.equal(h.get('[data-confirmation-actions]').hidden,false);assert.equal(h.get('[data-submit-button]').hidden,true);
});
