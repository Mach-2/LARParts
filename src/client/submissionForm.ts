import {setupVerifiedSubmission} from './verifiedSubmissionForm';

export function initSubmissionForm(){

			const MAX_SKILLS = 20;

			function requireElement<T extends Element>(selector: string): T {
				const element = document.querySelector<T>(selector);
				if (!element) {
					throw new Error(`Missing required form element: ${selector}`);
				}
				return element;
			}

			const form = requireElement<HTMLFormElement>("[data-profile-form]");
			const status = requireElement<HTMLElement>("[data-form-status]");
			const statusTitle = requireElement<HTMLElement>("[data-status-title]");
			const statusMessage = requireElement<HTMLElement>("[data-status-message]");
			const errorSummary = requireElement<HTMLElement>("[data-error-summary]");
			const errorList = requireElement<HTMLUListElement>("[data-error-list]");
			const skillsInput = requireElement<HTMLTextAreaElement>("#skills");
			const urlInputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="url"]'));
			const validatedInputs = Array.from(
				form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not(.honeypot input), textarea"),
			);
			const kingdomSelect = requireElement<HTMLSelectElement>("#kingdom");

			type FormState = "ready" | "submitting" | "success" | "validation-error" | "server-error";

			function setState(state: FormState, title: string, message: string) {
				status.dataset.state = state;
				statusTitle.textContent = title;
				statusMessage.textContent = message;
			}

			function splitList(value: string) {
				return value
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean);
			}

			function findDuplicate(items: string[]) {
				const seen = new Set<string>();
				for (const item of items) {
					const normalized = item.toLocaleLowerCase();
					if (seen.has(normalized)) {
						return item;
					}
					seen.add(normalized);
				}
				return "";
			}

			function setFieldError(field: HTMLInputElement | HTMLTextAreaElement, message: string) {
				field.setCustomValidity(message);
				field.setAttribute("aria-invalid", message ? "true" : "false");
				const error = form.querySelector<HTMLElement>(`[data-error-for="${field.name}"]`);
				if (error) {
					error.textContent = message;
				}
			}

			function validateRequiredField(field: HTMLInputElement | HTMLTextAreaElement) {
				setFieldError(field, "");
				if (field.required && !field.value.trim()) {
					setFieldError(field, "Please fill out this field.");
					return;
				}
				if (field.validity.tooLong) {
					setFieldError(field, `Please use ${field.maxLength} characters or fewer.`);
				}
			}

			function validateEmail() {
				const field = requireElement<HTMLInputElement>("#submitter-email");
				validateRequiredField(field);
				if (!field.value || field.validity.valueMissing) {
					return;
				}
				if (field.validity.typeMismatch) {
					setFieldError(field, "Enter a valid email address, such as name@example.com.");
				}
			}

			function validateUrl(field: HTMLInputElement) {
				setFieldError(field, "");
				if (field.disabled) return;
				if (!field.value.trim()) {
					return;
				}
				try {
					const url = new URL(field.value);
					if (url.protocol !== "https:") {
						throw new Error("HTTPS required");
					}
				} catch {
					setFieldError(field, "Enter a complete HTTPS URL, starting with https://.");
				}
			}

			function validateList(field: HTMLTextAreaElement, label: string, maximum: number) {
				validateRequiredField(field);
				if (field.validationMessage) {
					return;
				}
				const items = splitList(field.value);
				if (items.length > maximum) {
					setFieldError(field, `Add no more than ${maximum} ${label.toLowerCase()}.`);
					return;
				}
				const duplicate = findDuplicate(items);
				if (duplicate) {
					setFieldError(field, `Remove the duplicate ${label.toLowerCase()} “${duplicate}”.`);
				}
			}

			function validateForm() {
				kingdomSelect.setCustomValidity(
					kingdomSelect.value ? "" : "Please choose your kingdom.",
				);
				kingdomSelect.setAttribute(
					"aria-invalid",
					kingdomSelect.validationMessage ? "true" : "false",
				);
				const kingdomError = form.querySelector<HTMLElement>('[data-error-for="kingdom"]');
				if (kingdomError) {
					kingdomError.textContent = kingdomSelect.validationMessage;
				}
				for (const field of validatedInputs) {
					if (field.type !== "url" && field.type !== "email" && field.type !== "checkbox") {
						validateRequiredField(field);
					}
				}
				validateEmail();
				for (const field of urlInputs) {
					validateUrl(field);
				}
				validateList(skillsInput, "Skills", MAX_SKILLS);
				return form.checkValidity();
			}

			function showErrorSummary() {
				errorList.replaceChildren();
				const invalidFields = Array.from(
					form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(":invalid"),
				);
				for (const field of invalidFields) {
					const label = form.querySelector<HTMLLabelElement>(`label[for="${field.id}"]`);
					const item = document.createElement("li");
					const link = document.createElement("a");
					link.href = `#${field.id}`;
					link.textContent = `${label?.textContent?.replace("*", "").trim() ?? "Field"}: ${field.validationMessage}`;
					item.append(link);
					errorList.append(item);
				}
				errorSummary.hidden = invalidFields.length === 0;
				if (invalidFields.length > 0) {
					errorSummary.focus();
				}
			}

			function optionalValue(formData: FormData, name: string) {
				const value = String(formData.get(name) ?? "").trim();
				return value || undefined;
			}

			function makePayload() {
				const formData = new FormData(form);
				const contact = Object.fromEntries(
					["website", "instagram", "facebook", "discord", "tiktok", "other"]
						.map((name) => [name, optionalValue(formData, name)])
						.filter((entry): entry is [string, string] => Boolean(entry[1])),
				);

				return {
					profile: {
						displayName: String(formData.get("displayName") ?? "").trim(),
						kingdom: String(formData.get("kingdom") ?? "").trim(),
						homePark: String(formData.get("homePark") ?? "").trim(),
						skills: splitList(String(formData.get("skills") ?? "")),
						awards: formData
							.getAll("awards")
							.map((value) => String(value).trim())
							.filter(Boolean),
						memberSince: optionalValue(formData, "memberSince"),
						biography: optionalValue(formData, "biography"),
						photoUrl: optionalValue(formData, "photoUrl"),
						contact,
					},
					submitterEmail: String(formData.get("submitterEmail") ?? "").trim(),
					upgradeNotifications: formData.get("upgradeNotifications") === "true",
					// Legacy API flag; publication still requires explicit email confirmation.
					consent: true,
					companyWebsite: String(formData.get("companyWebsite") ?? ""),
				};
			}

			form.addEventListener("input", (event) => {
				const field = event.target;
				if (field === kingdomSelect) {
					kingdomSelect.setCustomValidity("");
					kingdomSelect.setAttribute("aria-invalid", "false");
					const error = form.querySelector<HTMLElement>('[data-error-for="kingdom"]');
					if (error) {
						error.textContent = "";
					}
				}
				if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
					if (field !== kingdomSelect) {
						return;
					}
				} else {
					setFieldError(field, "");
				}
				errorSummary.hidden = true;
				if (status.dataset.state !== "submitting" && status.dataset.state !== "success") {
					setState("ready", "Ready to submit", "Required fields are marked with an asterisk.");
				}
			});

  setupVerifiedSubmission(form,{validateForm,showErrorSummary,makePayload,setState});
  form.dataset.clientReady='true';
}
