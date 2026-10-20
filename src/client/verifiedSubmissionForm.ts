import {profileSubmissionSchema} from '../data/profileSubmission';
import {prepareProfileImage,refreshProfileImagePreview,type PreparedImage} from './profileImage';
import {prepareVerifiedSubmission,submitVerifiedProfile,resendProfileConfirmation,getSubmissionStatus,type PendingSubmission} from './verifiedSubmission';
import {turnstileToken} from './turnstile';

type FormState='ready'|'submitting'|'success'|'validation-error'|'server-error';
interface Hooks{validateForm:()=>boolean;showErrorSummary:()=>void;makePayload:()=>unknown;setState:(state:FormState,title:string,message:string)=>void}
const defaultServices={prepareProfileImage,refreshProfileImagePreview,turnstileToken,prepareVerifiedSubmission,submitVerifiedProfile,resendProfileConfirmation,getSubmissionStatus};
export function setupVerifiedSubmission(form:HTMLFormElement,hooks:Hooks,overrides:Partial<typeof defaultServices>={}){
  const services={...defaultServices,...overrides};
  const element=<T extends HTMLElement>(selector:string)=>{const node=form.querySelector<T>(selector);if(!node)throw new Error('Missing submission control');return node;};
  const mode=element<HTMLSelectElement>('[data-photo-mode]'),file=element<HTMLInputElement>('[data-photo-upload]'),url=element<HTMLInputElement>('#photo-url');
  const prepare=element<HTMLButtonElement>('[data-prepare-photo]'),preview=element<HTMLImageElement>('[data-photo-preview]'),photoStatus=element('[data-photo-status]');
  const button=element<HTMLButtonElement>('[data-submit-button]'),label=element('[data-submit-label]');
  const actions=element('[data-confirmation-actions]'),resend=element<HTMLButtonElement>('[data-resend-confirmation]'),check=element<HTMLButtonElement>('[data-check-publication]');
  const publishedLink=element<HTMLAnchorElement>('[data-published-link]'),challenge=element('[data-bot-challenge]');
  let image:PreparedImage|null=null,pending:PendingSubmission|null=null,busy=false;
  let photoRevision=0;
  const bot=(action:'profile-image'|'profile-submit')=>services.turnstileToken(form.dataset.turnstileSitekey??'',challenge,action);
  function setBusy(value:boolean){
    busy=value;button.disabled=value;prepare.disabled=value;resend.disabled=value;check.disabled=value;
    form.setAttribute('aria-busy',String(value));label.textContent=value?'Please wait…':pending?'Retry submission':'Submit profile';
  }
  function photoChanged(){
    if(pending)return;
    photoRevision++;
    image=null;preview.hidden=true;preview.removeAttribute('src');prepare.textContent='Prepare photo preview';
    file.disabled=mode.value!=='upload';url.disabled=mode.value!=='remote';prepare.hidden=mode.value==='none';
    element('[data-photo-upload-field]').hidden=mode.value!=='upload';
    element('[data-photo-url-field]').hidden=mode.value!=='remote';
    if(url.disabled){url.setCustomValidity('');url.removeAttribute('aria-invalid');element('[data-error-for="photoUrl"]').textContent='';}
    photoStatus.textContent=mode.value==='none'?'A photo is optional.':'';
  }
  mode.addEventListener('change',photoChanged);file.addEventListener('change',photoChanged);url.addEventListener('input',photoChanged);
  prepare.addEventListener('click',async()=>{
    if(busy||pending)return;setBusy(true);photoStatus.textContent='preparing your photo preview…';
    const revision=photoRevision;
    try{
      let prepared:PreparedImage|null;
      if(image)prepared=await services.refreshProfileImagePreview(image);
      else{
        const input=mode.value==='upload'?{file:file.files?.[0]}:{url:url.value.trim()};
        if('file'in input&&!input.file)throw new Error('Choose a photo first.');
        if('url'in input&&!input.url)throw new Error('Enter a direct HTTPS image URL first.');
        prepared=await services.prepareProfileImage(input as {file:File}|{url:string},await bot('profile-image'));
      }
      if(revision!==photoRevision)return;
      image=prepared;
      if(!image)throw new Error('Choose a photo first.');
      preview.src=image.previewUrl;preview.hidden=false;prepare.textContent='refresh preview';
      photoStatus.textContent='';
    }catch(error){if(revision===photoRevision)photoStatus.textContent=error instanceof Error?error.message:'Photo preparation failed. Please try again.';}
    finally{setBusy(false);}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    if(!pending&&!hooks.validateForm()){hooks.setState('validation-error','Please check the form','Fix the highlighted fields and try again.');hooks.showErrorSummary();return;}
    setBusy(true);
    try{
      if(!pending){
        const revision=photoRevision;
        if(mode.value==='none')image=null;
        if(mode.value!=='none'&&!image)throw new Error('Prepare and review your photo preview before submitting.');
        const payload=profileSubmissionSchema.safeParse(hooks.makePayload());
        if(!payload.success||payload.data.companyWebsite)throw new Error('Please check the form and try again.');
        const {photoUrl:_,...profile}=payload.data.profile;
        if(image){
          const refreshed=await services.refreshProfileImagePreview(image);
          if(revision!==photoRevision)throw new Error('Your photo selection changed. Prepare and review the current photo before submitting.');
          image=refreshed;preview.src=image.previewUrl;
        }
        pending=services.prepareVerifiedSubmission({...payload.data,profile,consent:true,companyWebsite:''},image);
        // Once a request might have reached the server, its identity and payload
        // must remain stable. Do not create a second submission on retry.
        form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input,textarea,select').forEach(field=>field.disabled=true);
        prepare.hidden=true;
      }
      hooks.setState('submitting','Requesting confirmation','Please keep this page open while the request finishes.');
      await services.submitVerifiedProfile(pending,await bot('profile-submit'));
      hooks.setState('success','Check your email','Open the confirmation email and press Confirm submission. Opening the link alone will not publish your profile.');
      button.hidden=true;actions.hidden=false;
    }catch(error){
      hooks.setState('server-error',pending?'Confirmation request not yet confirmed':'Submission not sent',error instanceof Error?error.message:'Please keep this page open and try again.');
      if(pending)actions.hidden=false;
    }finally{setBusy(false);}
  });
  resend.addEventListener('click',async()=>{
    if(busy||!pending)return;setBusy(true);
    try{await services.resendProfileConfirmation(pending,await bot('profile-submit'));hooks.setState('success','Check your email','A new confirmation was requested if eligible. The previous link will no longer work. Please wait before requesting another.');}
    catch{hooks.setState('server-error','Resend could not finish','Please wait a minute and try again. Keep this page open.');}
    finally{setBusy(false);}
  });
  check.addEventListener('click',async()=>{
    if(busy||!pending)return;setBusy(true);
    try{
      const result=await services.getSubmissionStatus(pending);
      if(result.state==='published'&&typeof result.artistId==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result.artistId)){
        publishedLink.href=`/artists/${result.artistId}/`;publishedLink.hidden=false;resend.hidden=true;button.hidden=true;
        hooks.setState('success','Your profile is published','Use the link below to view your public profile.');
      }else hooks.setState('success','Publication status',result.state==='publishing'?'Publication is in progress. Check again shortly.':result.state==='pending'?'Check your email and press Confirm submission.':'This submission is unavailable or needs assistance. Contact the directory administrator.');
    }catch{hooks.setState('server-error','Status unavailable','Keep this page open and try again shortly.');}
    finally{setBusy(false);}
  });
  photoChanged();setBusy(false);
}
